var ALL_PLAYERS = []
var PAUSED_PLAYERS = []  // Interrupted players that are paused and can be resumed later
var DUCKED_PLAYERS = new Map()
var AUDIOFOCUS = -1  // Audio focus state, -1 means not available, 0 means no focus, 1 means focus gained
var AUDIOFOCUS_DUCK_FACTOR = 0.25
// Sticky flag: any iOS PlayerSimple that fell back to Howler sets this true.
// checkaudio reads it to fail-fast before the user starts walking with a
// broken locked-screen audio path. Reset on app reload only.
var IOS_NATIVE_FALLBACK_DETECTED = false

// Android audio backend selector — 'howler' (legacy WebView-bound) or
// 'exoplayer' (cordova-plugin-audio-simple, AndroidX Media3, hosted in a
// MediaSessionService for background-reliable playback; this is what the
// renamed plugin still uses on Android). Default 'exoplayer' from Round 21
// (2026-05-28) so the field test exercises the new backend.
// Set window.AUDIO_BACKEND_ANDROID = 'howler' before the first PlayerSimple
// is constructed to fall back to the legacy backend if needed. Per-session
// value is captured into session_diag and into audio_uri_resolved /
// audio_*error events via the `backend` field so analyze.mjs can bucket
// post-rollout comparisons cleanly.
if (typeof AUDIO_BACKEND_ANDROID === 'undefined') {
    var AUDIO_BACKEND_ANDROID = (typeof window !== 'undefined' && window.AUDIO_BACKEND_ANDROID) ? window.AUDIO_BACKEND_ANDROID : 'exoplayer'
}

// iOS audio backend selector (R25, Workstream I.B in mobile-audit.md) — 'audio-simple'
// (cordova-plugin-audio-simple v0.3.0's AVAudioPlayer pool with single-owner
// AVAudioSession) or 'native-media' (legacy cordova-plugin-media via
// NativeMediaPlayer wrapper). Default 'audio-simple' from R25 so the field
// test exercises the new backend; set window.AUDIO_BACKEND_IOS = 'native-media'
// for emergency rollback. The `backend` field on audio_uri_resolved /
// audio_*error telemetry events buckets post-rollout comparisons. Distinct
// from AUDIO_BACKEND_ANDROID because the underlying engines (AVAudioPlayer
// vs ExoPlayer) and platform behaviours diverge.
if (typeof AUDIO_BACKEND_IOS === 'undefined') {
    var AUDIO_BACKEND_IOS = (typeof window !== 'undefined' && window.AUDIO_BACKEND_IOS) ? window.AUDIO_BACKEND_IOS : 'audio-simple'
}

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

// C1 — classify audio errors so telemetry can distinguish corrupt-file from
// network from decode-stall from missing-file. Cordova Media (iOS) MediaError.code
// and Howler.js loaderror codes both follow the same 1–4 convention.
//   1 = ABORTED (user-initiated)
//   2 = NETWORK
//   3 = DECODE
//   4 = SRC_NOT_SUPPORTED  (also commonly emitted on file-not-found by Howler)
// Falls back to string heuristics if no code is present. Pre-classify the
// 'timeout' and 'stuck' kinds emitted by the R4.4 watchdog so analyze.mjs gets
// a single error_type field across all audio failures.
function classifyAudioErrorType(kind, code, message) {
    if (kind === 'audio_play_timeout') return 'timeout'
    if (kind === 'audio_play_stuck') return 'stuck'
    if (code === 1) return 'aborted'
    if (code === 2) return 'network'
    if (code === 3) return 'decode_failed'
    if (code === 4) return 'src_unsupported'
    let m = (message || '').toLowerCase()
    if (m.indexOf('not found') >= 0 || m.indexOf('404') >= 0 || m.indexOf('does not exist') >= 0
        || m.indexOf('no such file') >= 0) return 'not_found'
    if (m.indexOf('network') >= 0 || m.indexOf('connection') >= 0) return 'network'
    if (m.indexOf('decode') >= 0 || m.indexOf('decod') >= 0) return 'decode_failed'
    if (m.indexOf('unsupport') >= 0 || m.indexOf('format') >= 0) return 'src_unsupported'
    return 'unknown'
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
        // AF-4/AF-5/AF-3: plugin v1.6.0 delivers structured JSON events alongside
        // plain-string focus states. Detect and dispatch before the string comparisons
        // so existing AUDIOFOCUS_LOSS/GAIN paths remain unaffected.
        if (typeof focusState === 'string' && focusState.length > 0 && focusState[0] === '{') {
            try {
                var evt = JSON.parse(focusState);
                if (evt.event === 'AUDIO_ROUTE_CHANGED') {
                    // AF-5: BT disconnect / headphone unplug / output route override
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_route_changed', {
                        reason:        evt.reason        || null,
                        previous_port: evt.previous_port || null,
                        current_port:  evt.current_port  || null,
                    });
                } else if (evt.event === 'POWER_SAVE_CHANGED') {
                    // AF-4: instant native broadcast on power-save toggle
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('power_save_changed', {
                        is_power_save_mode: !!evt.isPowerSaveMode,
                    });
                } else if (evt.event === 'AUDIOFOCUS_SERVICE_RESTARTED') {
                    // AF-3: AudioFocusService was restarted by Android while our process
                    // survived (START_STICKY). The native side has already re-requested
                    // audio focus. Log for diagnostics; AUDIOFOCUS_GAIN will arrive
                    // separately if focus was granted.
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_service_restarted', {});
                }
            } catch (e) { /* malformed JSON — ignore */ }
            return;
        }
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
        } else if (focusState === "AUDIOFOCUS_GAIN_AVAILABLE") {
            // C6 (iOS): interruption ended but the system did NOT signal
            // ShouldResume (typical after Siri, alarms, sometimes calls). The
            // native side has already successfully called setActive:YES, so
            // the session is live; we just don't have the system's blessing
            // to auto-resume. For the Flanerie sole-app walking experience
            // (pocketed walker, no other audio context to preserve), the
            // walker-correct behaviour IS to resume — otherwise audio stays
            // paused forever and the walker doesn't see the resume overlay
            // through their pocket. Use a softer double-pulse to signal the
            // difference vs a hard GAIN, then resume.
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
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

    // Safety retry: if the app comes to foreground and we're still in a
    // "focus lost, players paused" state (e.g. iOS interruption that didn't
    // emit ShouldResume AND the GAIN_AVAILABLE path didn't reach us because
    // the JS layer was suspended), re-request focus on the next user gesture.
    // This is a no-op when audio is already running (AUDIOFOCUS === 1) so it
    // can't accidentally fight a healthy state.
    document.addEventListener('resume', function() {
        if (AUDIOFOCUS === 0 && PAUSED_PLAYERS.length > 0) {
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_resume_retry', {paused: PAUSED_PLAYERS.length});
            requestAudioFocus();
        }
    });
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
                    this._positionSec = this._pendingSeekSec
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
                (pos) => { if (pos > 0) this._positionSec = pos },
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
        this._playStuckRetries = 0
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
        // C1 — extract a numeric code first (MediaError on iOS, Howler errors on
        // Android both follow the 1=aborted / 2=network / 3=decode / 4=src_unsupported
        // convention). Then derive a useful message — JSON.stringify on class
        // instances commonly produces "{}" which is what GIVORS field reports
        // showed as "[object Object]" — defend against that.
        let code = null
        let message = ''
        if (typeof error === 'string') message = error
        else if (typeof error === 'number') { code = error; message = 'code:' + error }
        else if (error && typeof error === 'object') {
            if (typeof error.code === 'number') code = error.code
            if (typeof error.message === 'string' && error.message) message = error.message
            else if (code !== null) message = 'MediaError:' + code
            else {
                try { message = JSON.stringify(error) } catch (e) { message = '<unserializable>' }
                if (!message || message === '{}') message = '<empty error object>'
            }
        }
        else if (error == null) message = '<null>'
        else message = String(error)

        let errorType = classifyAudioErrorType(type, code, message)

        let signature = type + '|' + (src || '-') + '|' + message
        let now = Date.now()

        if (signature === this._lastTelemetryErrorSignature && (now - this._lastTelemetryErrorAt) < 30000) return

        this._lastTelemetryErrorSignature = signature
        this._lastTelemetryErrorAt = now

        if (typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log(type, Object.assign({
                src: src,
                error: message,
                error_type: errorType,
                error_code: code,
                backend: this._backend || (this._isNativeFallback ? 'howler-fallback'
                    : (PLATFORM === 'ios' ? 'native' : 'howler')),
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

        // Default master gain — a media object from parcours JSON may omit it,
        // which would make volume() compute _volume * undefined = NaN.
        if (typeof media.master !== 'number') media.master = 1

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
        this._backend = 'howler'   // default; set per-branch below
        if (PLATFORM === 'ios') {
            let nativeSrc = httpToNativePath(fullSrc)
            if (nativeSrc
                && AUDIO_BACKEND_IOS === 'audio-simple'
                && typeof cordova !== 'undefined'
                && cordova.plugins && cordova.plugins.audio
                && typeof cordova.plugins.audio.Player === 'function') {
                // R25 iOS native engine: AVAudioPlayer pool with single-owner
                // AVAudioSession. Same Howler-shaped Player class used on
                // Android (ExoPlayer backend) so this branch can share JS.
                this._player = new cordova.plugins.audio.Player(nativeSrc, { loop: this._loop, volume: 1.0 })
                this._backend = 'audio-simple'
            } else if (nativeSrc) {
                // Legacy iOS path — cordova-plugin-media via NativeMediaPlayer.
                // Kept as the AUDIO_BACKEND_IOS='native-media' rollback target.
                this._player = new NativeMediaPlayer(nativeSrc, { loop: this._loop })
                this._backend = 'native'
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
                this._backend = 'howler-fallback'
            }
        } else if (AUDIO_BACKEND_ANDROID === 'exoplayer'
                   && typeof cordova !== 'undefined'
                   && cordova.plugins && cordova.plugins.audio) {
            // Android Media3 (ExoPlayer) backend. Prefer a file:// URI so
            // Media3 reads directly via FileDataSource and bypasses the
            // embedded HTTP server. httpToNativePath() returns null when the
            // native path was never populated (pre-apputils-patch builds);
            // ExoPlayer can still read http://localhost via DefaultHttpDataSource,
            // just slower — fall back rather than refusing to play.
            let nativeSrc = httpToNativePath(fullSrc) || fullSrc
            this._player = new cordova.plugins.audio.Player(nativeSrc, { loop: this._loop, volume: 1.0 })
            this._backend = 'exoplayer'
        } else {
            this._player = new Howl({ src: fullSrc, loop: this._loop, autoplay: false, volume: 1, html5: false })
            this._backend = 'howler'
        }

        // Register the player in the global ALL_PLAYERS array
        ALL_PLAYERS.push(this)

        // C1 — log the resolved URI per-load so post-hoc analysis can confirm
        // the player got the URL it expected (and which backend it ended up on).
        // Pairs naturally with audio_loaderror/audio_playerror, which the GIVORS
        // §P2 drill-down couldn't disambiguate because the path/URI used at
        // play time was never recorded.
        if (typeof TELEMETRY !== 'undefined') {
            let resolvedSrc = (this._player && this._player._src) || fullSrc
            TELEMETRY.log('audio_uri_resolved', {
                src: this._src(),
                resolved: resolvedSrc,
                base: basepath,
                media_src: media.src,
                backend: this._backend,
            })
        }

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
            this._playStuckRetries = 0
            this._isActive = true
            this.emit('play', this._player._src)
            console.log('PlayerSimple play:', this._player._src)
            // F-A1 — duration from play() request to actual play event.
            let loadDurationMs = (typeof this._playRequestedAt === 'number')
                ? (Date.now() - this._playRequestedAt) : null
            this._playRequestedAt = null
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_started', {
                src: this._src(),
                visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                loaded_before_play: this.isReady(),
                prepared_before_play: this.isLoaded(),
                load_state: this.loadState(),
                load_duration_ms: loadDurationMs,
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
        // F-A1 — measure how long it takes between requesting play() and the
        // actual 'play' event firing. Surfaces cold-load outliers on weak
        // devices (Samsung/Xiaomi A-series); a 4–8s value vs a normal 200ms
        // is a strong leading indicator for the audio stack issues in S2.
        this._playRequestedAt = Date.now()
        clearTimeout(this._playRequestedTimeout)
        this._playRequestedTimeout = setTimeout(() => {
            if (!this._playRequested) return
            // 15s window covers slow filesystems / large MP3 loads. loaderror/playerror
            // fire on real failures and resolve the geo task earlier; this is the
            // last-resort safety net. Field test 2026-05-18: the previous version
            // logged a timeout and walked away, even if audio was in fact playing
            // — and made no attempt to recover when it was genuinely stuck (Android
            // first-voice cold-load failed silently for 5+ minutes on multiple
            // devices). Now: cross-check actual state, only escalate if truly stuck,
            // retry once before giving up.
            let actuallyPlaying = false
            let seekPos = 0
            try {
                if (this._player) {
                    if (typeof this._player.playing === 'function') actuallyPlaying = !!this._player.playing()
                    if (typeof this._player.seek === 'function') {
                        let s = this._player.seek()
                        if (typeof s === 'number' && !isNaN(s) && s > 0) seekPos = s
                    }
                }
            } catch(e) {}

            // Play event lost but audio is in fact running. Don't fight it —
            // emit the same audio_play_started the play handler would have, mark
            // the player active, resolve the geo task. The watchdog did its job.
            if (actuallyPlaying || seekPos > 0) {
                console.warn('PlayerSimple play timeout: audio is in fact playing (seek=' + seekPos + ', playing=' + actuallyPlaying + '), recording as self-healed')
                this._playRequested = false
                this._playStuckRetries = 0
                let wasActive = this._isActive
                this._isActive = true
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_timeout_self_healed', {
                    src: this._player ? this._player._src : null,
                    seek: seekPos,
                    actually_playing: actuallyPlaying,
                    was_active: wasActive,
                })
                if (!wasActive) this.emit('play', this._player ? this._player._src : null)
                this._resolveGeoTask('play-timeout-self-healed')
                return
            }

            // Genuinely stuck. Retry once: stop the underlying, re-issue play.
            // On Android (Howler path) the first voice cold-load can hang the
            // Howl in 'loading' forever; a stop+play forces a fresh attempt.
            // A8 deferred-play via once('load') should prevent this path on cold
            // starts, but keep the retry as a safety net for other stuck states.
            // Cap at 1 retry so we don't loop on a hopeless file.
            const MAX_STUCK_RETRIES = 1
            if (this._playStuckRetries < MAX_STUCK_RETRIES) {
                this._playStuckRetries++
                console.warn('PlayerSimple play timeout: stuck, retry attempt', this._playStuckRetries, this._player ? this._player._src : '?')
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_play_stuck_retry', {
                    src: this._player ? this._player._src : null,
                    attempt: this._playStuckRetries,
                    ms: 15000,
                })
                this._playRequested = false
                // Resolve the stuck task explicitly so the next play() can claim
                // a fresh one without leaking the previous slot.
                this._resolveGeoTask('play-retry-arm')
                try {
                    if (this._player && typeof this._player.stop === 'function') this._player.stop()
                } catch(e) {}
                // Let stop() unwind on the next tick before re-issuing play().
                setTimeout(() => {
                    if (!this._player) return
                    try { this.play(seek, this._volume || 1.0) } catch(e) {
                        console.warn('PlayerSimple retry play failed', e)
                        this._resolveGeoTask('play-retry-error')
                    }
                }, 0)
                return
            }

            // Out of retries — accept the failure, log, free the geo task.
            console.warn('PlayerSimple play timeout: giving up after', this._playStuckRetries, 'retries', this._player ? this._player._src : '?')
            this._playRequested = false
            this._playStuckRetries = 0
            if (typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('audio_play_stuck', {
                    src: this._player ? this._player._src : null,
                    retries: MAX_STUCK_RETRIES,
                    ms: 15000,
                })
                // Keep the legacy event name so existing dashboards/queries don't
                // silently lose count. New fields tell the truth about state.
                TELEMETRY.log('audio_play_timeout', {
                    src: this._player ? this._player._src : null,
                    ms: 15000,
                    actually_playing: false,
                    seek: 0,
                    retries: MAX_STUCK_RETRIES,
                })
            }
            this._resolveGeoTask('play-timeout')
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
        // Belt-and-suspenders deferred play for the Android Howler cold-load
        // race (M4/P9): when the file is still loading at play() time, Howler's
        // internal play-queue silently fails on Android WebView. Calling play()
        // again from the 'load' event fires it the moment the file is ready.
        // The 'play' event handler guards against double-fire via _playRequested.
        const _deferIfLoading = () => {
            if (!this._player) return
            if (typeof this._player.state === 'function' && this._player.state() === 'loading') {
                this._player.once('load', () => {
                    if (this._player && this._playRequested && !this._player.playing()) this._player.play()
                })
            }
        }

        if (!needsFocusRequest) {
            if (!this._player) return
            this._player.play()
            _deferIfLoading()

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
                _deferIfLoading()
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
        if (this._player.playing() || this._isUnderlyingPaused()) {
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
        return this._isUnderlyingPaused()
    }

    // Howler's Howl has no public paused() — peek at the first sound's _paused
    // flag. NativeMediaPlayer exposes paused() directly so prefer that when present.
    _isUnderlyingPaused() {
        if (!this._player) return false
        if (typeof this._player.paused === 'function') return this._player.paused()
        let sounds = this._player._sounds
        return !!(sounds && sounds[0] && sounds[0]._paused && !sounds[0]._ended)
    }

    isPlaying() {
        return this._player && (this._player.playing() || this._playRequested) && !this.isGoingOut
    }

    isLoaded() {
        return (this._player !== null && !this._loadError) || (this._media && this._media.src == '-')
    }

    // seek([seconds]) — getter/setter in seconds, proxied to the underlying
    // Howl / NativeMediaPlayer. Without this, snapshotVoicePosition() in
    // parcours.js could never read a position and resume-with-progress (P3.5)
    // silently always restarted the step from 0.
    // Howler's no-arg seek() returns the Howl object itself in some states —
    // guard with typeof so callers always get a clean number.
    seek(seconds) {
        if (!this._player) return 0
        if (seconds === undefined) {
            let p = this._player.seek()
            return (typeof p === 'number' && !isNaN(p)) ? p : 0
        }
        this._player.seek(seconds)
        return this
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
            if (this._isUnderlyingPaused()) this._player.stop()
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
    constructor(step = null) {
        super()
        // Back-ref to the owning Step. Read-only here — used to tag telemetry
        // with step_index / step_name (was logged as null/null before, which
        // made it impossible to tell which step's afterplay was missing in the
        // FLANERIE_GIVORS_V7_CBR field test).
        this._step = step
        this.voice   = new PlayerSimple()
        this.afterplay = new PlayerSimple(true)
        this.state = 'off'       // play, afterplay, pause, stop, offlimit
        this.playstate = 'play'  // play, afterplay
        this._doneFired = false
        // True while this step's afterplay phase is being served by the shared
        // DEFAULT_AFTERPLAY_PLAYER (because the step's own afterplay is missing
        // or failed to load). All afterplay-routed ops must check this flag.
        this._defaultAfterplayActive = false
        // C4 — playerror retry counter reset in load() per voice assignment;
        // tracks how many times this step's voice has fired playerror so we
        // can attempt one reset+reload before giving up to afterplay.
        this._voicePlayerrorCount = 0
        this._lastLoadBasepath = null
        this._lastLoadMedia = null

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
                step: this._step ? this._step._index : null,
                step_name: this._step && this._step._spot ? this._step._spot.name : null,
            })
            this.startAfterplay()
        }
        this.voice.on('loaderror', () => onVoiceFail('loaderror'))
        // C4: first playerror on iOS → reset audio engine and reload before
        // falling back to afterplay. Targets the rumx/vigi stale-ref cluster
        // (R7.1) where the file is fine but the cordova-plugin-media handle is
        // dead after a process restart. Second playerror or no plugin → falls
        // through to afterplay as before.
        this.voice.on('playerror', () => {
            if (this.state !== 'play') return
            this._voicePlayerrorCount++
            if (this._voicePlayerrorCount === 1 &&
                this._lastLoadBasepath && this._lastLoadMedia &&
                typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.audiofocus &&
                typeof cordova.plugins.audiofocus.resetAudioSession === 'function') {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_playerror_retry', {
                    attempt: 1,
                    step: this._step ? this._step._index : null,
                    step_name: this._step && this._step._spot ? this._step._spot.name : null,
                })
                cordova.plugins.audiofocus.resetAudioSession(
                    () => {
                        if (this.state !== 'play') return
                        this.voice.load(this._lastLoadBasepath, this._lastLoadMedia.voice)
                        this.voice.play()
                    },
                    () => {
                        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_playerror_retry', {
                            attempt: 1, gave_up: true, reason: 'reset_failed',
                            step: this._step ? this._step._index : null,
                        })
                        onVoiceFail('playerror')
                    }
                )
            } else {
                if (this._voicePlayerrorCount > 1 && typeof TELEMETRY !== 'undefined') {
                    TELEMETRY.log('audio_playerror_retry', {
                        attempt: this._voicePlayerrorCount, gave_up: true,
                        step: this._step ? this._step._index : null,
                        step_name: this._step && this._step._spot ? this._step._spot.name : null,
                    })
                }
                onVoiceFail('playerror')
            }
        })

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
            let isLastStep = this._step && allSteps.length > 0 && !allSteps.some(s => s._index > this._step._index)
            if (!isLastStep) {
                this._defaultAfterplayActive = true
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('step_afterplay_fallback', {
                    reason: this.afterplay._loadError ? 'loaderror' : 'no_src',
                    step: this._step ? this._step._index : null,
                    step_name: this._step && this._step._spot ? this._step._spot.name : null,
                })
                if (typeof DEFAULT_AFTERPLAY_PLAYER !== 'undefined' && DEFAULT_AFTERPLAY_PLAYER) {
                    // Stop first — the singleton is shared, so another step may
                    // still be fading it out from its own teardown.
                    DEFAULT_AFTERPLAY_PLAYER.stop()
                    // R7.2: surface the routing reason to the play handler so
                    // it can suppress the recovery-map auto-open when the step
                    // simply never had an afterplay (no_src is normal for
                    // parcours like FLANERIE_GIVORS).
                    if (typeof window !== 'undefined') {
                        window.DEFAULT_AFTERPLAY_LAST_REASON = this.afterplay._loadError ? 'loaderror' : 'no_src'
                    }
                    if (DEFAULT_AFTERPLAY_PLAYER.isLoaded()) DEFAULT_AFTERPLAY_PLAYER.play()
                    // If isLoaded() is false the bundled afterplay.mp3 is missing —
                    // stay silent rather than retry or surface an error.
                }
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
        // C4: store load args so the playerror retry handler can reload the
        // same file after resetAudioSession() clears the stale engine state.
        this._lastLoadBasepath = basepath
        this._lastLoadMedia = media
        this._voicePlayerrorCount = 0
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
