'use strict';

var MODULE_NAME = 'backend-spotify';

var mkdirp = require('mkdirp');
var url = require('url');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var stream = require('stream');
var xml2js = require('xml2js');
var spotifyWeb = require('spotify-web');

var nodeplayerConfig = require('nodeplayer').config;
var coreConfig = nodeplayerConfig.getConfig();
var defaultConfig = require('./default-config.js');
var config = nodeplayerConfig.getConfig(MODULE_NAME, defaultConfig);

var spotifyBackend = {};
spotifyBackend.name = 'spotify';

var player;
var logger;

var replaceSongID = function(songID) {
    return songID.replace(/:/g, "_");
}

var unReplaceSongID = function(songID) {
    return songID.replace(/_/g, ":");
}

// TODO: seeking
var encodeSong = function(origStream, seek, song, progCallback, errCallback) {
    var incompletePath = coreConfig.songCachePath + '/spotify/incomplete/' + song.songID + '.opus';
    var incompleteStream = fs.createWriteStream(incompletePath, {flags: 'w'});
    var encodedPath = coreConfig.songCachePath + '/spotify/' + song.songID + '.opus';

    var command = ffmpeg(origStream)
        .noVideo()
        //.inputFormat('s16le')
        //.inputOption('-ac 2')
        .audioCodec('libopus')
        .audioBitrate('192')
        .format('opus')
        .on('error', function(err) {
            logger.error('error while transcoding ' + song.songID + ': ' + err);
            if(fs.existsSync(incompletePath))
                fs.unlinkSync(incompletePath);
            errCallback(song, err);
        })

    var opusStream = command.pipe(null, {end: true});
    opusStream.on('data', function(chunk) {
        incompleteStream.write(chunk, undefined, function() {
            progCallback(song, chunk.length, false);
        });
    });
    opusStream.on('end', function() {
        incompleteStream.end(undefined, undefined, function() {
            logger.verbose('transcoding ended for ' + song.songID);

            // TODO: we don't know if transcoding ended successfully or not,
            // and there might be a race condition between errCallback deleting
            // the file and us trying to move it to the songCache

            // atomically move result to encodedPath
            if(fs.existsSync(incompletePath)) {
                fs.renameSync(incompletePath, encodedPath);
                progCallback(song, 0, true);
            } else {
                progCallback(song, 0, false);
            }
        });
    });

    logger.verbose('transcoding ' + song.songID + '...');
    return function(err) {
        command.kill();
        logger.verbose('canceled preparing: ' + song.songID + ': ' + err);
        if(fs.existsSync(incompletePath))
            fs.unlinkSync(incompletePath);
        errCallback(song, 'canceled preparing: ' + song.songID + ': ' + err);
    };
};

var spotifyDownload = function(song, progCallback, errCallback) {
    var cancelEncoding;
    spotifyBackend.spotify.get(unReplaceSongID(song.songID), function(err, track) {
        if(err) {
            errCallback(song, err);
        } else {
            cancelEncoding = encodeSong(track.play(), 0, song, progCallback, errCallback);
        }
    });
    return function(err) {
        cancelEncoding(err);
    };
};

// cache song to disk.
// on success: progCallback must be called with true as argument
// on failure: errCallback must be called with error message
// returns a function that cancels preparing
spotifyBackend.prepareSong = function(song, progCallback, errCallback) {
    var filePath = coreConfig.songCachePath + '/spotify/' + song.songID + '.opus';

    if(fs.existsSync(filePath)) {
        // true as first argument because there is song data
        progCallback(song, true, true);
    } else {
        return spotifyDownload(song, progCallback, errCallback);
    }
};

spotifyBackend.isPrepared = function(song) {
    var filePath = coreConfig.songCachePath + '/spotify/' + song.songID + '.opus';
    return fs.existsSync(filePath);
};

spotifyBackend.search = function(query, callback, errCallback) {
    var results = {};
    results.songs = {};

    var offset = 0;
    spotifyBackend.spotify.search(query.terms, function(err, xml) {
        if(err) {
            errCallback('error while searching spotify: ' + err);
        } else {
            var parser = new xml2js.Parser();
            parser.on('end', function(searchResult) {
                // this format is 100% WTF
                var tracks = searchResult.result.tracks[0].track;

                if(tracks) {
                    for(var i = 0; i < tracks.length; i++) {
                        var track = tracks[i];
                        var trackUri = spotifyWeb.id2uri('track', track.id[0].toString());
                        results.songs[trackUri] = {
                            artist: track.artist ? track.artist[0] : null,
                            title: track.title ? track.title[0] : null,
                            album: track.album ? track.album[0] : null,
                            albumArt: null, // TODO
                            duration: track.length ? track.length[0] : null,
                            songID: replaceSongID(trackUri),
                            score: track.popularity ? 100 * track.popularity[0] : null,
                            backendName: spotifyBackend.name,
                            format: 'opus'
                        };
                    }
                }

                callback(results);
            });
            parser.parseString(xml);
        }
    });
};

spotifyBackend.init = function(_player, _logger, callback) {
    player = _player;
    logger = _logger;

    mkdirp.sync(coreConfig.songCachePath + '/spotify/incomplete');

    // initialize google play music backend
    spotifyWeb.login(config.login, config.password, function(err, spotifySession) {
        if(err) {
            callback(err);
        } else {
            spotifyBackend.spotify = spotifySession;
            callback();
        }
    });
};
module.exports = spotifyBackend;
