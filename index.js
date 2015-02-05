var mkdirp = require('mkdirp');
var url = require('url');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var sp = require('libspotify');
var creds = require(process.env.HOME + '/.spotifyCreds.json');

var spotifyBackend = {};

var config, player;

// TODO: seeking
var encodeSong = function(origStream, seek, songID, callback, errCallback) {
    var incompletePath = config.songCachePath + '/spotify/incomplete/' + songID + '.opus';
    var encodedPath = config.songCachePath + '/spotify/' + songID + '.opus';

    var command = ffmpeg(origStream)
        .noVideo()
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

// cache songID to disk.
// on success: callback must be called
// on failure: errCallback must be called with error message
spotifyBackend.prepareSong = function(songID, callback, errCallback) {
    var filePath = config.songCachePath + '/gmusic/' + songID + '.opus';

    if(fs.existsSync(filePath)) {
        // song was found from cache
        if(callback)
            callback();
        return;
    } else {
        return gmusicDownload(null, songID, callback, errCallback);
    }
};
spotifyBackend.search = function(query, callback, errCallback) {
    var results = {};
    results.songs = {};

    //var search = new sp.Search('artist:"rick astley" track:"never gonna give you up"');
    var search = new sp.Search(query.terms);
    search.trackCount = config.searchResultCnt;
    search.execute();
    search.once('ready', function() {
        console.log('search results:');
        var util = require('util');
        console.log(util.inspect(search.tracks[0], {showHidden: true}));

        /*
        var track = search.tracks[0];
        var player = spotifyBackend.session.getPlayer();
        player.load(track);
        player.play();

        console.error('playing track. end in %s', track.humanDuration);
        player.on('data', function(buffer) {
            console.log(buffer);
            // buffer.length
            // buffer.rate
            // buffer.channels
            // 16bit samples
        });
        player.once('track-end', function() {
            console.error('track ended');
            player.stop();
            spotifyBackend.session.close();
        });
        */
    });
};

spotifyBackend.init = function(_player, callback, errCallback) {
    player = _player;
    config = _player.config;

    mkdirp(config.songCachePath + '/spotify/incomplete');

    // initialize google play music backend
    spotifyBackend.session = new sp.Session({
        applicationKey: process.env.HOME + '/.spotify_appkey.key'
    });
    spotifyBackend.session.login(creds.login, creds.password);
    spotifyBackend.session.once('login', function(err) {
        if(err)
            errCallback(err);
        else
            callback();
    });
};
module.exports = spotifyBackend;
