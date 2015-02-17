var mkdirp = require('mkdirp');
var url = require('url');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var creds = require(process.env.HOME + '/.spotifyCreds.json');
var stream = require('stream');

var xml2js = require('xml2js');
var spotifyWeb = require('spotify-web');

var spotifyBackend = {};
spotifyBackend.name = 'spotify';

var config, player;

// TODO: seeking
var encodeSong = function(origStream, seek, songID, progCallback, errCallback) {
    var incompletePath = config.songCachePath + '/spotify/incomplete/' + songID + '.opus';
    var incompleteStream = fs.createWriteStream(incompletePath, {flags: 'w'});
    var encodedPath = config.songCachePath + '/spotify/' + songID + '.opus';

    var command = ffmpeg(origStream)
        .noVideo()
        //.inputFormat('s16le')
        //.inputOption('-ac 2')
        .audioCodec('libopus')
        .audioBitrate('192')
        .format('opus')
        .on('error', function(err) {
            console.log('spotify: error while transcoding ' + songID + ': ' + err);
            if(fs.existsSync(incompletePath))
                fs.unlinkSync(incompletePath);
            errCallback(err);
        })

    var opusStream = command.pipe(null, {end: true});
    opusStream.on('data', function(chunk) {
        incompleteStream.write(chunk, undefined, function() {
            progCallback(chunk.length, false);
        });
    });
    opusStream.on('end', function() {
        incompleteStream.end(undefined, undefined, function() {
            console.log('transcoding ended for ' + songID);

            // TODO: we don't know if transcoding ended successfully or not,
            // and there might be a race condition between errCallback deleting
            // the file and us trying to move it to the songCache

            // atomically move result to encodedPath
            if(fs.existsSync(incompletePath)) {
                fs.renameSync(incompletePath, encodedPath);
                progCallback(0, true);
            } else {
                progCallback(0, false);
            }
        });
    });

    console.log('transcoding ' + songID + '...');
    return function(err) {
        command.kill();
        console.log('spotify: canceled preparing: ' + songID + ': ' + err);
        if(fs.existsSync(incompletePath))
            fs.unlinkSync(incompletePath);
        errCallback('canceled preparing: ' + songID + ': ' + err);
    };
};

var spotifyDownload = function(songID, progCallback, errCallback) {
    var cancelEncoding;
    spotifyBackend.spotify.get(songID, function(err, track) {
        if(err) {
            errCallback(err);
        } else {
            cancelEncoding = encodeSong(track.play(), 0, songID, progCallback, errCallback);
        }
    });
    return function(err) {
        cancelEncoding(err);
    };
};

// cache songID to disk.
// on success: progCallback must be called with true as argument
// on failure: errCallback must be called with error message
// returns a function that cancels preparing
spotifyBackend.prepareSong = function(songID, progCallback, errCallback) {
    var filePath = config.songCachePath + '/spotify/' + songID + '.opus';

    if(fs.existsSync(filePath)) {
        // true as first argument because there is song data
        progCallback(true, true);
    } else {
        return spotifyDownload(songID, progCallback, errCallback);
    }
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
                            songID: trackUri,
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

spotifyBackend.init = function(_player, callback) {
    player = _player;
    config = _player.config;

    mkdirp(config.songCachePath + '/spotify/incomplete');

    // initialize google play music backend
    spotifyWeb.login(creds.login, creds.password, function(err, spotifySession) {
        if(err) {
            callback(err);
        } else {
            spotifyBackend.spotify = spotifySession;
            callback();
        }
    });
};
module.exports = spotifyBackend;
