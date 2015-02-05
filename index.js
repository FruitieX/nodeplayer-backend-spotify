var mkdirp = require('mkdirp');
var url = require('url');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var creds = require(process.env.HOME + '/.spotifyCreds.json');

var spotifyBackend = {};
spotifyBackend.spotify = require('node-spotify')({
    appkeyFile: process.env.HOME + '/.spotify_appkey.key'
});

var config, player;

// TODO: seeking
var encodeSong = function(origStream, seek, songID, callback, errCallback) {
    var incompletePath = config.songCachePath + '/spotify/incomplete/' + songID + '.opus';
    var encodedPath = config.songCachePath + '/spotify/' + songID + '.opus';

    var command = ffmpeg(origStream)
        .noVideo()
        .inputFormat('s16le')
        .inputOption('-ac 2')
        .audioCodec('libopus')
        .audioBitrate('192')
        .on('end', function() {
            console.log('successfully transcoded ' + songID);

            // atomically (I hope so) move result to encodedPath
            fs.renameSync(incompletePath, encodedPath);
            callback();
        })
    .on('error', function(err) {
        console.log('spotify: error while transcoding ' + songID + ': ' + err);
        if(fs.existsSync(incompletePath))
            fs.unlinkSync(incompletePath);
        errCallback();
    })
    .save(incompletePath);

    console.log('transcoding ' + songID + '...');
    return function(err) {
        command.kill();
        console.log('spotify: canceled preparing: ' + songID + ': ' + err);
        if(fs.existsSync(incompletePath))
            fs.unlinkSync(incompletePath);
        errCallback();
    };
};

var spotifyDownload = function(songID, callback, errCallback) {
    var track = spotifyBackend.spotify.createFromLink(songID);
    var cancelCallback;

    var stream = require('stream');
    var bufStream = new stream.PassThrough();

    var audioHandler = function(err, buffer) {
        if(err) {
            console.log('error from spotify audioHandler' + err);
            cancelCallback();
            errCallback(err);
        } else {
            bufStream.push(buffer);
            return true;
        }
    };
    spotifyBackend.spotify.useNodejsAudio(audioHandler);
    spotifyBackend.spotify.player.play(track);
    spotifyBackend.spotify.player.on({'endOfTrack': function() {
        bufStream.end();
    }});

    cancelCallback = encodeSong(bufStream, 0, songID, callback, errCallback);
    return cancelCallback;
};

// cache songID to disk.
// on success: callback must be called
// on failure: errCallback must be called with error message
spotifyBackend.prepareSong = function(songID, callback, errCallback) {
    var filePath = config.songCachePath + '/spotify/' + songID + '.opus';

    if(fs.existsSync(filePath)) {
        // song was found from cache
        if(callback)
            callback();
        return;
    } else {
        return spotifyDownload(songID, callback, errCallback);
    }
};
spotifyBackend.search = function(query, callback, errCallback) {
    var results = {};
    results.songs = {};

    var offset = 0;
    var search = new spotifyBackend.spotify.Search(query.terms, offset, config.searchResultCnt);
    search.execute(function(err, searchResult) {
        if(err) {
            errCallback('error while searching spotify: ' + err);
        } else {
            for(var i = 0; i < searchResult.numTracks; i++) {
                var track = searchResult.getTrack(i);
                results.songs[track.link] = {
                    artist: track.artists ? track.artists[0].name : null,
                    title: track.name,
                    album: track.album ? track.album.name : null,
                    albumArt: null, // TODO
                    duration: track.duration * 1000,
                    songID: track.link,
                    score: track.popularity,
                    backendName: 'spotify',
                    format: 'opus'
                };
            }

            callback(results);
        }
    });
};

spotifyBackend.init = function(_player, callback, errCallback) {
    player = _player;
    config = _player.config;

    mkdirp(config.songCachePath + '/spotify/incomplete');

    // initialize google play music backend
    spotifyBackend.spotify.on({
        ready: callback,
        logout: errCallback
    });
    spotifyBackend.spotify.login(creds.login, creds.password, false, false);
};
module.exports = spotifyBackend;
