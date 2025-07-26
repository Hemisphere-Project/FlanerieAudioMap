var ALL_PLAYERS = []
var PAUSED_PLAYERS = []  // Interrupted players that are paused and can be resumed later
var AUDIOFOCUS = -1  // Audio focus state, -1 means not available, 0 means no focus, 1 means focus gained

Howler.autoUnlock = true; // Enable automatic context unlocking
Howler.autoSuspend = false; // Prevent automatic context suspension

// Watch for audio focus changes
document.addEventListener('deviceready', function() {
    if (typeof cordova.plugins.audiofocus === 'undefined') {
        console.warn('[AudioFocus] plugin not available. Audio focus will not be handled.');
        return;
    }
    cordova.plugins.audiofocus.onFocusChange( function(focusState) {
            console.log('[AudioFocus] change:', focusState);
            if (focusState === "AUDIOFOCUS_LOSS" || focusState === "AUDIOFOCUS_LOSS_TRANSIENT") {
                // Pause your audio playback here
                pauseAllPlayers();
                AUDIOFOCUS = 0;  // No focus
                $('#resume-overlay').show();
            } else if (focusState === "AUDIOFOCUS_GAIN") {
                // Resume your audio playback here
                resumeAllPlayers();
                AUDIOFOCUS = 1;  // Focus gained
                $('#resume-overlay').hide();
            } else if (focusState === "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK") {
                // Optionally lower your audio volume ("duck")
            }
        });
    console.log('[AudioFocus] plugin available. Audio focus will be handled.');
    requestAudioFocus()
});

// setInterval(() => {
//     // List all players and state, every 5 seconds
//     let playingPlayers = ALL_PLAYERS.filter(player => player.playing());
//     console.log('PLAYING:', playingPlayers.map(player => ({
//         src: player._src,
//         playing: player.playing(),
//         volume: player.volume()
//     })));
// }, 5000);

function pauseAllPlayers() {
    // Pause your audio playback here
    PAUSED_PLAYERS = [];
    ALL_PLAYERS.forEach(player => {
        if (player.isPlaying()) {
            player.pause();
            PAUSED_PLAYERS.push(player);
            console.log('Paused player:', player._src);
        }
    });
}

function resumeAllPlayers() {
    PAUSED_PLAYERS.forEach(player => {
        player.resume();
        console.log('Resumed player:', player._src);
    });
    PAUSED_PLAYERS = [];
}

function requestAudioFocus() {
    // if (!cordova || !cordova.plugins.audiofocus) return Promise.resolve();
    // check if cordova and cordova.plugins.audiofocus are defined
    if (typeof cordova === 'undefined' || typeof cordova.plugins.audiofocus === 'undefined') {
        console.warn('[AudioFocus] plugin not available. Audio focus will not be requested.');
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        cordova.plugins.audiofocus.requestFocus(
            function() {
                console.log('[AudioFocus] requested successfully.');
                resumeAllPlayers();
                AUDIOFOCUS = 1;  // Focus gained
                $('#resume-overlay').hide();
                resolve();
            },
            function(error) {
                console.error('[AudioFocus] failed to request:', error);
                pauseAllPlayers();
                AUDIOFOCUS = 0;  // No focus
                $('#resume-overlay').show();
                reject(error);
            }
        );
    });
}

$('#resume-button').on('click', function() { requestAudioFocus() })
$('#resume-overlay').hide();


class PlayerSimple extends EventEmitter
{
    constructor(loop = false, fadetime = 1500) {
        super()
        this._loop = loop
        this._fadeTime = fadetime 
        this._player = null
        this.isGoingOut = null
        this._playRequested = false
        this._volume = 0
        this._media = null
    }

    load(basepath, media, usemediapath = true) {
        this._media = media
        
        if (!media || !media.src || media.src == '-') return

        if (usemediapath && document.LOCALMEDIA_PATH) {
            let localpath = document.LOCALMEDIA_PATH.split('/')
            let lastlocalelement = localpath[localpath.length - 1] || localpath[localpath.length - 2]
            let firstBasePath = basepath.split('/')[0] || basepath.split('/')[1]

            if (lastlocalelement == firstBasePath)
                basepath = document.LOCALMEDIA_PATH + basepath.substr(basepath.indexOf(firstBasePath) + firstBasePath.length)
            else
                basepath = document.LOCALMEDIA_PATH + basepath
        }
        
        console.log('PlayerSimple load:', basepath + media.src)

        let html5enabled = false
        try { html5enabled = (cordova.platformId == 'ios') } catch (e) {}

        this.clear()
        this._player = new Howl({
            src: basepath + media.src,
            loop: this._loop,
            autoplay: false,
            volume: 1,
            html5: html5enabled
        })

        // Register the player in the global ALL_PLAYERS array
        ALL_PLAYERS.push(this)

        this._player.on('end', () => {
            if (!this._player) return
            console.log('PlayerSimple end:', this._player._src)
            this._playRequested = false
            this.emit('end', this._player._src)
            // console.log('PlayerSimple end:', this._player._src)
        })
        this._player.on('stop', () => {
            if (!this._player) return
            console.log('PlayerSimple stop:', this._player._src)
            this._playRequested = false
            if (this._player) {
                this.emit('stop', this._player._src)
                console.log('PlayerSimple stop:', this._player._src)
            }
        })
        this._player.on('play', () => {
            if (!this._player) return
            if (!this._playRequested) {
                console.warn('PlayerSimple play but is not requested ...')
                this._player.stop()
                return
            }
            this._playRequested = false
            this.emit('play', this._player._src)
            console.log('PlayerSimple play:', this._player._src)
        })
        this._player.on('pause', () => {
            if (!this._player) return
            console.log('PlayerSimple pause:', this._player._src)
            this.emit('pause', this._player._src)
            // console.log('PlayerSimple pause:', this._player._src)

            if (this._rewindOnPause !== undefined) {
                let d = this._rewindOnPause > 0 ? this._rewindOnPause : this._fadeTime
                this._player.seek(this._player.seek() - d / 1000)
            }
        })
        this._player.on('load', () => {
            if (this._player) {
                this.emit('load', this._player._src)
                // console.log('PlayerSimple ready:', this._player._src)
            }
        })

        this.master(media.master)
        // console.log('PlayerSimple load:', media.src)
    }

    clear() {  
        if (this._player !== null) {
            // remove from global ALL_PLAYERS array
            ALL_PLAYERS = ALL_PLAYERS.filter(player => player !== this)
            PAUSED_PLAYERS = PAUSED_PLAYERS.filter(player => player !== this)
            this._player.stop()
            this._player.unload()
            this._player = null
            this._playRequested = false
        }
    }

    loop(value) {
        if (!this._player) return
        if (value !== undefined) {
            this._loop = value
            this._player.loop(value)
        }
        return this._loop
    }

    play(seek=0, volume=1.0) {
        if (!this._player) return
        if (this._playRequested) {
            console.warn('PlayerSimple play requested but already requesting ...')
            return
        }
        
        if (this.isGoingOut) {
            clearTimeout(this.isGoingOut)
            this.isGoingOut = null
            console.warn('PlayerSimple play requested but going out ...')
            this._player.pause()
        }
        else if (this._player.playing()) {
            return
        }
        this._player.pause()


        if (seek >= 0) this._player.seek(seek)
        this._playRequested = true
        console.log('PlayerSimple play requested:', this._player._src, 'seek:', seek, 'volume:', volume)

        if (PLATFORM == 'ios' || AUDIOFOCUS < 1) {
            if (!this._player) return
            this._player.play()

            console.log('PlayerSimple PLAY:', this._player._src, 'seek:', seek, 'volume:', volume)

            if (this._fadeTime > 0) {
                this._volume = volume
                this._player.fade(this._player.volume(), this._volume * this._media.master, this._fadeTime)
            }
            else this.volume(volume)
        }
        else {
            requestAudioFocus().then(() => {
                if (!this._player) return
                this._player.play()
                console.log('PlayerSimple PLAY:', this._player._src, 'seek:', seek, 'volume:', volume)
    
                if (this._fadeTime > 0) {
                    this._volume = volume
                    this._player.fade(this._player.volume(), this._volume * this._media.master, this._fadeTime)
                }
                else this.volume(volume)
            })
            .catch(error => {
                console.error('[AudioFocus] Error requesting focus:', error);
                this._playRequested = false;
            });
        }
    }

    resume(volume=1.0) {
        this.play(-1, volume)
    }

    stop() {
        if (!this._player) return
        if (this._playRequested) {
            console.warn('PlayerSimple stop but play requesting ...')
            this._playRequested = false
            return
        }
        if (!this._player.playing()) return
        this._player.stop()
    }

    pause() {
        if (!this._player) return
        if (!this._player.playing()) return
        if (this.isGoingOut) return
        this._player.pause()
    }

    toggle() {
        if (this.isPlaying()) this.pause()
        else this.resume()
    }

    volume(value) {
        if (value !== undefined) {
            this._volume = value
            if (this._player)
                this._player.volume(this._volume * this._media.master)
            // this._player.fade(this._volume * this._media.master, this._volume * this._media.master, 0)  // cancel other fade
        }
        return this._volume
    }

    master(value) {
        if (value !== undefined) {
            value = Math.round(value * 100) / 100
            if (value < 0) value = 0
            if (value > 1) value = 1
            let didChange = this._media.master !== value
            this._media.master = value
            if (this._player)
                this._player.volume(this._volume * this._media.master)
            if (didChange) this.emit('master', this._media.master)
        }
        return this._media.master
    }

    masterDec(value = 0.01) {
        this.master(this._media.master - value)
    }

    masterInc(value = 0.01) {
        this.master(this._media.master + value)
    }

    isPaused() {
        return this._player && this._player.paused()
    }

    isPlaying() {
        return this._player && (this._player.playing() || this._playRequested) && !this.isGoingOut
    }

    isLoaded() {
        return this._player !== null || (this._media && this._media.src == '-')
    }

    rewindOnPause(value = -1) {
        this._rewindOnPause = value
    }

    stopOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        if (!this._player || !this._player.playing()) return

        // Fade out
        this._player.fade(this._player.volume(), 0, d)
        this._volume = 0

        this.isGoingOut = setTimeout(() => {
            if (!this._player) return
            this._player.stop()
            this.isGoingOut = null
            // console.log('PlayerSimple stopOut done')
        }, d)
    }

    pauseOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (!this._player || !this._player.playing() || this.isGoingOut) return

        // Fade out
        this._player.fade(this._player.volume(), 0, d)
        this._volume = 0

        this.isGoingOut = setTimeout(() => {
            if (!this._player) return
            this._player.pause()
            this.isGoingOut = null
            // console.log('PlayerSimple pauseOut done')
        }, d)
    }
}



class PlayerStep extends EventEmitter 
{
    constructor() {
        super()
        this.voice   = new PlayerSimple()
        this.music   = new PlayerSimple()
        this.ambiant = new PlayerSimple(true)
        this.offlimit = new PlayerSimple(true, 500)
        this.afterplay = new PlayerSimple(true)
        this.state = 'off'       // play, afterplay, pause, stop, offlimit  
        this.playstate = 'play'  // play, afterplay

        this.voice.rewindOnPause(3000)
        this.voice.on('end', () => { 
            if (this.state == 'play') {
                this.playstate = 'afterplay'
                this.state = 'afterplay'
                this.afterplay.play() 
                this.emit('done')
            }
        })

        this.music.rewindOnPause(3000)
        this.music.on('end', () => { 
            if (this.state == 'play') {
                this.playstate = 'afterplay'
                this.state = 'afterplay' 
                this.afterplay.play()
                this.emit('done')
            }    
        })
        
        this.afterplay.rewindOnPause(3000)
    }

    load(basepath, media) {
        this.voice.load(basepath, media.voice)
        this.music.load(basepath, media.music)
        this.ambiant.load(basepath, media.ambiant)
        this.offlimit.load(basepath, media.offlimit)
        this.afterplay.load(basepath, media.afterplay)
        this.state = 'stop'
    }

    clear() {
        this.voice.clear()
        this.music.clear()
        this.ambiant.clear()
        this.offlimit.clear()
        this.afterplay.clear()
        let wasNotStop = this.state !== 'stop'
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    play() {
        console.log('PlayerStep play', this.playstate)
        this.offlimit.stop()
        this.ambiant.play()

        if (this.playstate == 'afterplay') {
            this.afterplay.play()
        }
        else {
            this.voice.play()
            this.music.play()
        }
        let wasNotPlay = this.state !== this.playstate
        this.state = this.playstate
        if (wasNotPlay) this.emit('play')
    }

    stop(d=-1) {
        this.voice.stopOut(d)
        this.music.stopOut(d)
        this.ambiant.stopOut(d)
        this.offlimit.stopOut(d)
        this.afterplay.stopOut(d)


        let wasNotStop = this.state !== 'stop'
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    pause() {
        if (!this.isPlaying()) return
        this.voice.pauseOut()
        this.music.pauseOut()
        this.ambiant.pauseOut()
        this.offlimit.pauseOut()
        this.afterplay.pauseOut()
        let wasNotPause = this.state !== 'pause'
        this.state = 'pause'
        if (wasNotPause) this.emit('pause')
    }

    resume() {

        this.ambiant.resume()
        if (this.playstate == 'afterplay') {
            this.afterplay.resume()
        }
        else {
            this.voice.resume()
            this.music.resume()
        }

        let wasNotPlay = this.state !== this.playstate
        this.state = this.playstate
        if (wasNotPlay) this.emit('resume')
    }

    volume(value) {
        this.voice.volume(value)
        this.music.volume(value)
        this.ambiant.volume(value)
        this.offlimit.volume(value)
        this.afterplay.volume(value)
    }

    isPaused() {
        return this.state == 'pause'
    }

    isPlaying() {
        return this.state == 'play' || this.state == 'afterplay'
    }

    isLoaded() {
        return this.voice.isLoaded() && this.music.isLoaded() && this.ambiant.isLoaded() && this.offlimit.isLoaded() && this.afterplay.isLoaded()
    }

    isOfflimit() {
        return this.state == 'offlimit'
    }

    crossLimit(out=true) 
    {
        if (out && this.state == 'play') {
            this.voice.pauseOut()
            this.music.pauseOut()
            this.offlimit.play()
            this.state = 'offlimit'
            this.emit('offlimit')
        }
        else if (out && this.state == 'afterplay') {
            this.afterplay.pauseOut()
            this.offlimit.play()
            this.state = 'offlimit'
            this.emit('offlimit')
        }
        else if (!out && this.state == 'offlimit') {
            this.offlimit.stopOut()

            if (this.playstate == 'afterplay') {
                this.afterplay.resume()
            }
            else {
                this.voice.resume()
                this.music.resume()
            }
            this.state = this.playstate
            this.emit('resume')
        }
    }
}
