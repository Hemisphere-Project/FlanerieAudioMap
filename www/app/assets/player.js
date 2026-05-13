var ALL_PLAYERS = []
var PAUSED_PLAYERS = []  // Interrupted players that are paused and can be resumed later
var DUCKED_PLAYERS = new Map()
var AUDIOFOCUS = -1  // Audio focus state, -1 means not available, 0 means no focus, 1 means focus gained
var AUDIOFOCUS_DUCK_FACTOR = 0.25
// Sticky flag: any iOS PlayerSimple that fell back to Howler sets this true.
// checkaudio reads it to fail-fast before the user starts walking with a
// broken locked-screen audio path. Reset on app reload only.
var IOS_NATIVE_FALLBACK_DETECTED = false

function showResumeOverlayIfNeeded(pausedCount) {
    if (pausedCount > 0) $('#resume-overlay').css('display', 'flex');
    else $('#resume-overlay').hide();
}

Howler.autoUnlock = true; // Enable automatic context unlocking
Howler.autoSuspend = false; // Prevent automatic context suspension

// Converts a WKWebView http://localhost/... URL back to a file:// native path
// needed by cordova-plugin-media, which bypasses the WKWebView HTTP server.
function httpToNativePath(httpPath) {
    if (!httpPath) return null
    if (document.LOCALMEDIA_PATH && document.LOCALMEDIA_PATH_NATIVE &&
        httpPath.startsWith(document.LOCALMEDIA_PATH)) {
        return document.LOCALMEDIA_PATH_NATIVE + httpPath.slice(document.LOCALMEDIA_PATH.length)
    }
    if (document.LOCALAPP_PATH && document.LOCALAPP_PATH_NATIVE &&
        httpPath.startsWith(document.LOCALAPP_PATH)) {
        return document.LOCALAPP_PATH_NATIVE + httpPath.slice(document.LOCALAPP_PATH.length)
    }
    return null
}

// Watch for audio focus changes
document.addEventListener('deviceready', function() {
    if (typeof cordova.plugins.audiofocus === 'undefined') {
        console.warn('[AudioFocus] plugin not available. Audio focus will not be handled.');
        return;
    }
    cordova.plugins.audiofocus.onFocusChange(function(focusState) {
        console.log('[AudioFocus] change:', focusState);
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_change', {state: focusState});
        if (focusState === "AUDIOFOCUS_LOSS" || focusState === "AUDIOFOCUS_LOSS_TRANSIENT") {
            // Distinctive triple-pulse so a pocketed user can feel that audio paused
            // — a single 300ms pulse is easy to miss against walking motion.
            if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
            let pausedCount = pauseAllPlayers();
            AUDIOFOCUS = 0;
            showResumeOverlayIfNeeded(pausedCount);
        } else if (focusState === "AUDIOFOCUS_GAIN") {
            if (navigator.vibrate) navigator.vibrate([100, 80, 100]);
            restoreDuckedPlayers();
            resumeAllPlayers();
            AUDIOFOCUS = 1;
            $('#resume-overlay').hide();
        } else if (focusState === "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK") {
            duckPlayingPlayers();
        }
    });
    console.log('[AudioFocus] plugin available. Audio focus will be handled.');
    requestAudioFocus();
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
    // Additive: do not reset PAUSED_PLAYERS — a second call (e.g. document.pause
    // then AUDIOFOCUS_LOSS for the same phone call) must not wipe the list that
    // the first call already built, or resumeAllPlayers() will have nothing to restore.
    let pausedCount = 0;
    ALL_PLAYERS.forEach(player => {
        if (player.isPlaying() && !PAUSED_PLAYERS.includes(player)) {
            player.pause();
            PAUSED_PLAYERS.push(player);
            pausedCount++;
            console.log('Paused player:', player._src);
        }
    });
    return pausedCount;
}

function resumeAllPlayers() {
    PAUSED_PLAYERS.forEach(player => {
        player.resume();
        console.log('Resumed player:', player._src);
    });
    PAUSED_PLAYERS = [];
}

function duckPlayingPlayers() {
    ALL_PLAYERS.forEach(player => {
        if (!player.isPlaying() || DUCKED_PLAYERS.has(player)) return;
        let volume = player.volume();
        DUCKED_PLAYERS.set(player, volume);
        player.volume(volume * AUDIOFOCUS_DUCK_FACTOR);
        console.log('Ducked player:', player._src);
    });
}

function restoreDuckedPlayers() {
    DUCKED_PLAYERS.forEach((volume, player) => {
        if (!ALL_PLAYERS.includes(player)) return;
        player.volume(volume);
        console.log('Restored player volume:', player._src);
    });
    DUCKED_PLAYERS.clear();
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
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_request_ok', {
                    visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                    platform: typeof PLATFORM !== 'undefined' ? PLATFORM : 'unknown',
                })
                restoreDuckedPlayers();
                resumeAllPlayers();
                AUDIOFOCUS = 1;  // Focus gained
                $('#resume-overlay').hide();
                resolve();
            },
            function(error) {
                console.error('[AudioFocus] failed to request:', error);
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_request_fail', {
                    visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                    platform: typeof PLATFORM !== 'undefined' ? PLATFORM : 'unknown',
                    error: String(error),
                })
                let pausedCount = pauseAllPlayers();
                AUDIOFOCUS = 0;  // No focus
                showResumeOverlayIfNeeded(pausedCount);
                reject(error);
            }
        );
    });
}

function shouldRequestAudioFocusForPlay() {
    if (typeof cordova === 'undefined' || typeof cordova.plugins.audiofocus === 'undefined') return false
    // NativeMediaPlayer activates AVAudioSession itself on play(); no pre-request needed.
    // Request focus only when it was explicitly lost (phone call, other app).
    return AUDIOFOCUS === 0
}

function primeHowlForBackground(howl, options) {
    options = options || {}
    if (!howl || PLATFORM !== 'ios') return Promise.resolve({ ok: false, reason: 'unsupported' })
    if (howl.__backgroundPrimed) return Promise.resolve({ ok: true, reason: 'already-primed' })
    if (howl.__backgroundPrimingPromise) return howl.__backgroundPrimingPromise

    let state = typeof howl.state === 'function' ? howl.state() : 'unknown'

    let originalVolume = 1
    try { originalVolume = howl.volume() } catch (e) {}

    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_prime_attempt', {
        src: options.src || null,
        reason: options.reason || 'unknown',
        visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
    })

    howl.__isPrimingForBackground = true
    howl.__backgroundPrimingPromise = new Promise(resolve => {
        let settled = false
        let timeoutId = null

        let settle = (ok, extra) => {
            if (settled) return
            settled = true
            if (timeoutId) clearTimeout(timeoutId)
            howl.__isPrimingForBackground = false
            howl.__backgroundPrimingPromise = null
            try { howl.volume(originalVolume) } catch (e) {}
            if (ok) howl.__backgroundPrimed = true

            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log(ok ? 'audio_prime_ok' : 'audio_prime_fail', Object.assign({
                src: options.src || null,
                reason: options.reason || 'unknown',
                visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            }, extra || {}))

            resolve({ ok: ok, reason: ok ? 'played' : ((extra && extra.error) || 'failed') })
        }

        let onPlay = () => {
            try {
                howl.pause()
                howl.seek(0)
            }
            catch (e) {}
            settle(true)
        }

        let onPlayError = (id, error) => {
            try {
                howl.stop()
                howl.seek(0)
            }
            catch (e) {}
            settle(false, { error: String(error) })
        }

        howl.once('play', onPlay)
        howl.once('playerror', onPlayError)
        timeoutId = setTimeout(() => settle(false, { error: 'prime-timeout' }), 3000)

        try {
            howl.volume(0)
            howl.play()
        }
        catch (error) {
            settle(false, { error: String(error) })
        }
    })

    return howl.__backgroundPrimingPromise
}

$('#resume-button').on('click', function() { requestAudioFocus() })
$('#resume-overlay').hide();


// Wraps cordova-plugin-media for iOS background audio.
// AVAudioPlayer is not subject to the WebKit user-gesture restriction that
// blocks HTML5 audio initiated from GPS callbacks while the screen is locked.
class NativeMediaPlayer extends EventEmitter {
    constructor(src, options) {
        super()
        this._src = src
        this._loop = (options && options.loop) || false
        this._nativeState = 0   // mirrors Media.MEDIA_* (NONE=0 STARTING=1 RUNNING=2 PAUSED=3 STOPPED=4)
        this._volume = 1
        this._positionSec = 0
        this._positionPollInterval = null
        this._pendingSeekSec = null     // seek queued before media is prepared
        this._fadeInterval = null
        this._loaded = false            // true once first MEDIA_RUNNING received (file prepared)
        this._playIntent = false        // true while waiting for RUNNING after play() call
        this._stoppedByCall = false     // distinguishes stop() from natural track end
        this.__isPrimingForBackground = false  // keeps PlayerSimple event handler compat

        this._media = new Media(
            src,
            () => this._onSuccess(),
            (err) => this._onError(err),
            (status) => this._onStatus(status)
        )
    }

    // Fired by cordova-plugin-media when the track completes naturally (not on stop()).
    // Looped players use AVAudioPlayer.numberOfLoops = -1 (native infinite loop), so
    // successCallback never fires for them — no JS roundtrip gap, no session deactivation window.
    _onSuccess() {
        this.emit('end', this._src)
    }

    _onError(err) {
        this._stopPositionPoll()
        this._stopFade()
        this._playIntent = false
        this.emit('playerror', this._src, err)
    }

    _onStatus(status) {
        this._nativeState = status

        if (status === 2) {  // MEDIA_RUNNING
            if (!this._loaded) {
                this._loaded = true
                this.emit('load', this._src)
                if (this._pendingSeekSec !== null) {
                    this._media.seekTo(this._pendingSeekSec * 1000)
                    this._pendingSeekSec = null
                }
            }
            this._startPositionPoll()
            if (this._playIntent) {
                this._playIntent = false
                this.emit('play', this._src)
            }
        }
        else if (status === 3) {  // MEDIA_PAUSED
            this._stopPositionPoll()
            this.emit('pause', this._src)
        }
        else if (status === 4) {  // MEDIA_STOPPED
            this._stopPositionPoll()
            if (this._stoppedByCall) {
                this._stoppedByCall = false
                this.emit('stop', this._src)
            }
            // natural end: _onSuccess() handles the event, not here
        }
    }

    _startPositionPoll() {
        this._stopPositionPoll()
        this._positionPollInterval = setInterval(() => {
            if (!this._media) return
            this._media.getCurrentPosition(
                (pos) => { if (pos >= 0) this._positionSec = pos },
                () => {}
            )
        }, 250)
    }

    _stopPositionPoll() {
        if (this._positionPollInterval) {
            clearInterval(this._positionPollInterval)
            this._positionPollInterval = null
        }
    }

    _stopFade() {
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval)
            this._fadeInterval = null
        }
    }

    // Howler-compatible API

    state() {
        if (this._nativeState === 0) return 'unloaded'
        if (this._nativeState === 1) return 'loading'
        return 'loaded'  // RUNNING(2), PAUSED(3), STOPPED(4) — all prepared
    }

    playing() { return this._nativeState === 2 }
    paused()  { return this._nativeState === 3 }

    play() {
        if (!this._media) return
        this._stopFade()
        this._stoppedByCall = false
        this._playIntent = true
        this._media.setVolume(this._volume)
        // numberOfLoops: -1 → AVAudioPlayer.numberOfLoops = -2 (any negative = infinite loop).
        // CDVSound subtracts 1 from the JS value before assigning to AVAudioPlayer.
        this._media.play(this._loop ? { numberOfLoops: -1 } : undefined)
    }

    pause() {
        // Only valid when RUNNING; mirrors Howler which ignores pause() on stopped sounds.
        // Prevents spurious 'pause' events (and rewindOnPause seeks) from PlayerSimple's
        // stabilization call to pause() before every play().
        if (!this._media || this._nativeState !== 2) return
        this._stopFade()
        this._media.pause()
    }

    stop() {
        if (!this._media) return
        this._stopFade()
        this._stopPositionPoll()
        this._playIntent = false
        this._stoppedByCall = true
        this._positionSec = 0
        this._media.stop()
    }

    // seek(seconds)  getter/setter in seconds, matching Howler's API
    seek(seconds) {
        if (seconds === undefined) return this._positionSec
        if (seconds < 0) return
        if (this._loaded) {
            this._media.seekTo(seconds * 1000)
        } else {
            this._pendingSeekSec = seconds
        }
    }

    volume(v) {
        if (v === undefined) return this._volume
        this._volume = Math.max(0, Math.min(1, v))
        if (this._media) this._media.setVolume(this._volume)
        return this._volume
    }

    fade(from, to, duration) {
        this._stopFade()
        this.volume(from)
        const totalSteps = Math.max(1, Math.round(duration / 50))
        const stepVol = (to - from) / totalSteps
        const stepMs = duration / totalSteps
        let step = 0
        this._fadeInterval = setInterval(() => {
            step++
            const v = step >= totalSteps ? to : from + stepVol * step
            this.volume(v)
            if (step >= totalSteps) {
                clearInterval(this._fadeInterval)
                this._fadeInterval = null
            }
        }, stepMs)
    }

    loop(value) {
        if (value !== undefined) this._loop = value
        return this._loop
    }

    unload() {
        this._stopFade()
        this._stopPositionPoll()
        this._playIntent = false
        this._stoppedByCall = false
        if (this._media) {
            this._media.stop()
            this._media.release()
            this._media = null
        }
        this._nativeState = 0
        this._loaded = false
        this._positionSec = 0
        this._pendingSeekSec = null
    }
}


class PlayerSimple extends EventEmitter
{
    constructor(loop = false, fadetime = 1500) {
        super()
        this._loop = loop
        this._fadeTime = fadetime 
        this._player = null
        this.isGoingOut = null
        this._playRequested = false
        this._playRequestedTimeout = null
        this._isActive = false
        this._volume = 0
        this._media = null
        this._loadError = false
        this._lastTelemetryErrorSignature = null
        this._lastTelemetryErrorAt = 0
        this._pendingGeoTask = null
    }

    _src() {
        if (this._player && this._player._src) return this._player._src
        if (this._media && this._media.src) return this._media.src
        return null
    }

    loadState() {
        if (this._media && this._media.src == '-') return 'empty'
        if (!this._player) return 'unloaded'
        if (typeof this._player.state === 'function') return this._player.state()
        return 'unknown'
    }

    isReady() {
        return this.loadState() === 'loaded' || (this._media && this._media.src == '-')
    }

    _logAudioTelemetry(type, error, extra = {}) {
        let src = this._src()
        let message = String(error)
        let signature = type + '|' + (src || '-') + '|' + message
        let now = Date.now()

        if (signature === this._lastTelemetryErrorSignature && (now - this._lastTelemetryErrorAt) < 30000) return

        this._lastTelemetryErrorSignature = signature
        this._lastTelemetryErrorAt = now

        if (typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log(type, Object.assign({
                src: src,
                error: message,
                cleared: !this._player
            }, extra))
        }
    }

    _claimGeoTask(meta) {
        if (typeof claimBackgroundGeoTask !== 'function') return null
        let task = claimBackgroundGeoTask(Object.assign({
            src: this._src(),
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            loaded_before_play: this.isReady(),
            prepared_before_play: this.isLoaded(),
            load_state_before_play: this.loadState(),
        }, meta || {}))
        if (task) this._pendingGeoTask = task
        return task
    }

    _resolveGeoTask(status, extra) {
        if (!this._pendingGeoTask || typeof resolveBackgroundGeoTask !== 'function') return
        resolveBackgroundGeoTask(this._pendingGeoTask, status, Object.assign({
            src: this._src(),
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
        }, extra || {}))
        this._pendingGeoTask = null
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
        
        let fullSrc = basepath + media.src
        console.log('PlayerSimple load:', fullSrc)

        this.clear()

        this._isNativeFallback = false
        if (PLATFORM === 'ios') {
            let nativeSrc = httpToNativePath(fullSrc)
            if (nativeSrc) {
                this._player = new NativeMediaPlayer(nativeSrc, { loop: this._loop })
            } else {
                // FATAL on iOS — Howler cannot start playback from a background GPS
                // callback when the phone is locked. checkaudio gates on this flag.
                console.error('[NativeMedia] Cannot resolve native path for:', fullSrc, '— iOS Howler fallback (BROKEN for locked-screen GPS triggers)')
                this._isNativeFallback = true
                IOS_NATIVE_FALLBACK_DETECTED = true
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('ios_native_fallback', {
                    src: fullSrc,
                    has_localmedia: !!document.LOCALMEDIA_PATH_NATIVE,
                    has_localapp: !!document.LOCALAPP_PATH_NATIVE,
                })
                this._player = new Howl({ src: fullSrc, loop: this._loop, autoplay: false, volume: 1, html5: true })
            }
        } else {
            this._player = new Howl({ src: fullSrc, loop: this._loop, autoplay: false, volume: 1, html5: false })
        }

        // Register the player in the global ALL_PLAYERS array
        ALL_PLAYERS.push(this)

        this._player.on('end', () => {
            if (!this._player) return
            console.log('PlayerSimple end:', this._player._src)
            this._playRequested = false
            if (!this._loop) this._isActive = false  // keep active so loop's next 'play' event isn't rejected
            this.emit('end', this._player._src)
            // console.log('PlayerSimple end:', this._player._src)
        })
        this._player.on('stop', () => {
            if (!this._player) return
            console.log('PlayerSimple stop:', this._player._src)
            this._playRequested = false
            this._isActive = false
            if (this._player) {
                this.emit('stop', this._player._src)
                console.log('PlayerSimple stop:', this._player._src)
            }
        })
        this._player.on('play', () => {
            if (!this._player) return
            if (this._player.__isPrimingForBackground) {
                console.log('PlayerSimple prime play:', this._player._src)
                return
            }
            if (!this._playRequested && !this._isActive) {
                console.warn('PlayerSimple play but is not requested ...')
                this._player.stop()
                return
            }
            if (!this._playRequested) return  // loop iteration — already active, skip re-emit
            this._playRequested = false
            this._isActive = true
            this.emit('play', this._player._src)
            console.log('PlayerSimple play:', this._player._src)
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_started', {
                src: this._src(),
                visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                loaded_before_play: this.isReady(),
                prepared_before_play: this.isLoaded(),
                load_state: this.loadState(),
            })
            this._resolveGeoTask('play-started', {
                loaded_before_play: this.isReady(),
                prepared_before_play: this.isLoaded(),
                load_state: this.loadState(),
            })
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
                this._loadError = false
                this.emit('load', this._player._src)
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_load_ready', {
                    src: this._src(),
                    visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                    load_state: this.loadState(),
                })
                // primeHowlForBackground removed: iOS now uses NativeMediaPlayer which
                // activates AVAudioSession natively on play() without requiring prior priming.
            }
        })
        this._player.on('loaderror', (id, error) => {
            console.error('PlayerSimple loaderror:', this._player ? this._player._src : '?', error)
            this._loadError = true
            this._playRequested = false
            clearTimeout(this._playRequestedTimeout)
            this.emit('loaderror', this._player ? this._player._src : null, error)
            this._logAudioTelemetry('audio_loaderror', error)
            this._resolveGeoTask('loaderror', { error: String(error) })
        })
        this._player.on('playerror', (id, error) => {
            if (this._player && this._player.__isPrimingForBackground) return
            console.error('PlayerSimple playerror:', this._player ? this._player._src : '?', error)
            this._loadError = true
            this._playRequested = false
            clearTimeout(this._playRequestedTimeout)
            this.emit('playerror', this._player ? this._player._src : null, error)
            this._logAudioTelemetry('audio_playerror', error)
            this._resolveGeoTask('playerror', { error: String(error) })
        })

        this.master(media.master)
        // console.log('PlayerSimple load:', media.src)
    }

    clear() {
        if (this._player !== null) {
            // remove from global ALL_PLAYERS array
            ALL_PLAYERS = ALL_PLAYERS.filter(player => player !== this)
            PAUSED_PLAYERS = PAUSED_PLAYERS.filter(player => player !== this)
            DUCKED_PLAYERS.delete(this)
            this._resolveGeoTask('cleared')
            this._player.stop()
            this._player.unload()
            this._player = null
            this._playRequested = false
            this._isActive = false
            clearTimeout(this._playRequestedTimeout)
            this._loadError = false
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
        clearTimeout(this._playRequestedTimeout)
        this._playRequestedTimeout = setTimeout(() => {
            if (this._playRequested) {
                console.warn('PlayerSimple play timeout: resetting stuck _playRequested', this._player ? this._player._src : '?')
                this._playRequested = false
                // 15s window covers slow filesystems / large MP3 loads. loaderror/playerror fire
                // on real failures and resolve the geo task earlier; this is the last-resort safety net.
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_timeout', {src: this._player ? this._player._src : null, ms: 15000})
                this._resolveGeoTask('play-timeout')
            }
        }, 15000)
        console.log('PlayerSimple play requested:', this._player._src, 'seek:', seek, 'volume:', volume)
        let bgTask = this._claimGeoTask({ seek: seek })
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_requested', {
            src: this._src(),
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            loaded_before_play: this.isReady(),
            prepared_before_play: this.isLoaded(),
            load_state_before_play: this.loadState(),
            bg_task_claimed: !!bgTask,
            seek: seek,
        })

        let needsFocusRequest = shouldRequestAudioFocusForPlay()
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_gate', {
            src: this._src(),
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            platform: typeof PLATFORM !== 'undefined' ? PLATFORM : 'unknown',
            audiofocus: AUDIOFOCUS,
            request_focus_before_play: needsFocusRequest,
        })

        // Unknown/unavailable focus state (-1) should not block playback unless
        // this specific play requires a fresh native audio-session activation.
        if (!needsFocusRequest) {
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

        // Explicit stop wins over an AUDIOFOCUS-driven pause — drop any
        // pending resume so resumeAllPlayers() can't revive a player that
        // was deliberately stopped (e.g. GPSLOST_PLAYER after recovery,
        // a step's afterplay after the next step fires).
        PAUSED_PLAYERS = PAUSED_PLAYERS.filter(p => p !== this)

        if (this._playRequested) {
            console.warn('PlayerSimple stop but play requesting ...')
            this._playRequested = false
            clearTimeout(this._playRequestedTimeout)
        }
        if (this._player.playing() || this._player.paused()) {
            this._player.stop()
        }
    }

    pause() {
        if (!this._player) return
        if (this.isGoingOut) return

        // Cancel a queued play that hasn't started yet — otherwise the audio
        // would start playing the moment load completes (e.g. when GPS-lost
        // paused everything while a step voice was still loading).
        if (this._playRequested && !this._player.playing()) {
            this._player.stop()
            return
        }

        if (!this._player.playing()) return
        this._player.pause()
    }

    toggle() {
        if (this.isPlaying()) this.pause()
        else this.resume()
    }

    volume(value) {
        if (value !== undefined) {
            this._volume = value
            if (this._player && this._media)
                this._player.volume(this._volume * this._media.master)
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
        return (this._player !== null && !this._loadError) || (this._media && this._media.src == '-')
    }

    rewindOnPause(value = -1) {
        this._rewindOnPause = value
    }

    stopOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        if (!this._player) return

        // Drop any pending resume — see PlayerSimple.stop() for the rationale.
        PAUSED_PLAYERS = PAUSED_PLAYERS.filter(p => p !== this)

        // Paused player (e.g. by AUDIOFOCUS_LOSS): can't fade, but must still
        // stop the underlying so a later AUDIOFOCUS_GAIN can't revive it.
        if (!this._player.playing()) {
            if (this._player.paused()) this._player.stop()
            return
        }

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
        this.afterplay = new PlayerSimple(true)
        this.state = 'off'       // play, afterplay, pause, stop, offlimit
        this.playstate = 'play'  // play, afterplay
        this._doneFired = false
        // True while this step's afterplay phase is being served by the shared
        // DEFAULT_AFTERPLAY_PLAYER (because the step's own afterplay is missing
        // or failed to load). All afterplay-routed ops must check this flag.
        this._defaultAfterplayActive = false

        this.voice.rewindOnPause(3000)
        this.voice.on('end', () => {
            this.startAfterplay()
        })

        // Voice playback failure: skip directly to afterplay so the step's
        // lifecycle still advances and the user doesn't end up in silence
        // staring at a dead zone they can't progress past.
        let onVoiceFail = (reason) => {
            if (this.state !== 'play') return
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('step_voice_failed', {
                reason,
                src: this.voice._src(),
            })
            this.startAfterplay()
        }
        this.voice.on('loaderror', () => onVoiceFail('loaderror'))
        this.voice.on('playerror', () => onVoiceFail('playerror'))

        this.afterplay.rewindOnPause(3000)
    }

    // Returns true if the step's own afterplay is unusable (no src, errored,
    // or otherwise not loadable) — in which case we route through the shared
    // DEFAULT_AFTERPLAY_PLAYER. Silent fallback if that file is also missing.
    _needsDefaultAfterplay() {
        if (!this.afterplay._media) return true
        if (this.afterplay._media.src === '-') return true
        if (this.afterplay._loadError) return true
        return false
    }

    startAfterplay() {
        if (this.state != 'play') return
        this.playstate = 'afterplay'
        this.state = 'afterplay'

        if (this._needsDefaultAfterplay()) {
            this._defaultAfterplayActive = true
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('step_afterplay_fallback', {
                reason: this.afterplay._loadError ? 'loaderror' : 'no_src',
            })
            if (typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined' && DEFAULT_AFTERPLAY_PLAYER) {
                // Stop first — the singleton is shared, so another step may
                // still be fading it out from its own teardown.
                DEFAULT_AFTERPLAY_PLAYER.stop()
                if (DEFAULT_AFTERPLAY_PLAYER.isLoaded()) DEFAULT_AFTERPLAY_PLAYER.play()
                // If isLoaded() is false the bundled afterplay.mp3 is missing —
                // stay silent rather than retry or surface an error.
            }
        } else {
            this.afterplay.play()
        }

        if (!this._doneFired) {
            this._doneFired = true
            this.emit('done')
        }
    }

    load(basepath, media) {
        this.voice.load(basepath, media.voice)
        this.afterplay.load(basepath, media.afterplay)
        this.playstate = 'play'
        this._doneFired = false
        this._defaultAfterplayActive = false
        this.state = 'stop'
    }

    clear() {
        this.voice.clear()
        if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
            DEFAULT_AFTERPLAY_PLAYER.stop()
        }
        this._defaultAfterplayActive = false
        this.afterplay.clear()
        let wasNotStop = this.state !== 'stop'
        this.playstate = 'play'
        this._doneFired = false
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    play(seekPos=0) {
        console.log('PlayerStep play', this.playstate)
        if (this.playstate == 'afterplay') {
            if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
                if (DEFAULT_AFTERPLAY_PLAYER.isLoaded()) DEFAULT_AFTERPLAY_PLAYER.play()
            } else {
                this.afterplay.play()
            }
        }
        else {
            this.voice.play(seekPos)
        }
        let wasNotPlay = this.state !== this.playstate
        this.state = this.playstate
        if (wasNotPlay) this.emit('play')
    }

    stop(d=-1) {
        this.voice.stopOut(d)
        if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
            DEFAULT_AFTERPLAY_PLAYER.stopOut(d)
        } else {
            this.afterplay.stopOut(d)
        }
        this._defaultAfterplayActive = false


        let wasNotStop = this.state !== 'stop'
        this._doneFired = false
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    pause() {
        if (!this.isPlaying()) return
        this.voice.pauseOut()
        if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
            DEFAULT_AFTERPLAY_PLAYER.pauseOut()
        } else {
            this.afterplay.pauseOut()
        }
        let wasNotPause = this.state !== 'pause'
        this.state = 'pause'
        if (wasNotPause) {
            this.emit('pause')
            console.log('PlayerStep pause')
        }
    }

    resume() {
        if (this.playstate == 'afterplay') {
            if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
                if (DEFAULT_AFTERPLAY_PLAYER.isLoaded()) DEFAULT_AFTERPLAY_PLAYER.resume()
            } else {
                this.afterplay.resume()
            }
        }
        else {
            this.voice.resume()
        }

        let wasNotPlay = this.state !== this.playstate
        this.state = this.playstate
        if (wasNotPlay) this.emit('resume')
    }

    volume(value) {
        this.voice.volume(value)
        if (this._defaultAfterplayActive && typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined') {
            DEFAULT_AFTERPLAY_PLAYER.volume(value)
        } else {
            this.afterplay.volume(value)
        }
    }

    isPaused() {
        return this.state == 'pause'
    }

    isPlaying() {
        return this.state == 'play' || this.state == 'afterplay' || this.state == 'offlimit'
    }

    // Voice-only: an afterplay loaderror is tolerated via the DEFAULT_AFTERPLAY
    // fallback, so it must not block the step from being considered loaded.
    isLoaded() {
        return this.voice.isLoaded()
    }

    hasError() {
        return !!this.voice._loadError
    }

    isReady() {
        return this.voice.isReady()
    }

    loadState() {
        let states = [this.voice, this.afterplay].map(player => player.loadState())
        if (states.every(state => state === 'loaded' || state === 'empty')) return 'loaded'
        if (states.every(state => state === 'unloaded' || state === 'empty')) return 'unloaded'
        return states.join(',')
    }

    isOfflimit() {
        return this.state == 'offlimit'
    }

    isNarrating() {
        return this.state == 'play'
    }

    crossLimit(out=true)
    {
        if (out && (this.state == 'play' || this.state == 'afterplay')) {
            this.state = 'offlimit'
            this.emit('offlimit')
        }
        else if (!out && this.state == 'offlimit') {
            this.state = this.playstate
            this.emit('resume')
        }
    }
}
