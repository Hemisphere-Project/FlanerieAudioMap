var CALIBRATION_TIME = 2
var APP_VISIBILITY = 'foreground' // foreground, background
var LAST_AUDIO_CONTEXT_STATE = null
var AUDIO_CONTEXT_STATE_BOUND = false
// Native keepalive (P0.5 Fix 1b: NSTimer on iOS, Handler on Android) re-delivers
// last-known position every 15s. A gap of 15-20s between callbacks is the normal
// keepalive cadence — not a problem. Thresholds raised above the keepalive
// interval so the gap detector only fires on real interruptions.
// Field test 2026-05-18: iPhone 13 mini emitted 55 false-positive gap events at
// ~15s intervals matching the NSTimer cycle (Sony Xperia X had the same pattern
// on Android 8). With these thresholds, those become quiet.
var GPS_CALLBACK_GAP_THRESHOLD = 20000
var GPS_SLEEP_SUSPECT_THRESHOLD = 30000
var ACTIVE_GEO_BACKGROUND_TASK = null
var IOS_GEO_BACKGROUND_TASK_TIMEOUT = 8000
var STARTUP_FIX_MAX_AGE_MS = 12000
// Flat startup accuracy bar (2026-06-10). A single 20 m threshold, no time-based
// relaxation. Replaces the 15 m base + 15→25 m adaptive relax (2026-06-09 #2):
// that relax set `ready` against a widening bar while the gate's own re-check
// (startupReady) still applied the strict 15 m, so the two diverged and a
// weak-GPS device was reported ready yet stayed stranded at rdv. With one flat
// bar, acceptance and the gate agree by construction. A device that cannot hold a
// fix at 20 m stays BLOCKED → loan phone (operator decision: don't walk a bad
// walk). Freshness stays strict — a stale fix means GPS isn't delivering, which a
// wider accuracy bar must never mask.
var STARTUP_FIX_MAX_ACCURACY_M = 20
var STARTUP_REQUIRED_FIXES = 2
// A4 (2026-06-11) — accuracy-collapse detector thresholds (telemetry-only
// phase 1). Calibrated from the iPhone-8 `4och` walk: normal segments held
// p50 ≈ 10 m, the collapsed segment p50 ≈ 40 m / p95 ≈ 200 m — 35 m splits
// them cleanly. Sustain filters single-blip noise (urban canyon corners).
var DEGRADED_ACCURACY_M = 35
var DEGRADED_SUSTAIN_MS = 60000
var STARTUP_SECOND_FIX_MIN_GAP_MS = 5000
var STARTUP_SECOND_FIX_MIN_MOVEMENT_M = 8

function gpsAccuracyBucket(acc) {
    if (typeof acc !== 'number' || isNaN(acc)) return 'unknown'
    if (acc <= 10) return 'excellent'
    if (acc <= 20) return 'good'
    if (acc <= 40) return 'fair'
    if (acc <= 80) return 'poor'
    return 'bad'
}

function _geoTaskTelemetry(type, data) {
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log(type, data)
}

function getBackgroundGeolocationPlugin() {
    if (typeof BackgroundGeolocation !== 'undefined' && BackgroundGeolocation) {
        return BackgroundGeolocation
    }

    if (typeof window !== 'undefined' && window.BackgroundGeolocation) {
        return window.BackgroundGeolocation
    }

    if (typeof cordova !== 'undefined' && typeof cordova.require === 'function') {
        try {
            let plugin = cordova.require('cordova-background-geolocation-plugin.BackgroundGeolocation')
            if (plugin && typeof window !== 'undefined' && !window.BackgroundGeolocation) {
                window.BackgroundGeolocation = plugin
            }
            return plugin || null
        }
        catch (e) {
            return null
        }
    }

    return null
}

function _finishGeoBackgroundTask(task, status, extra) {
    if (!task || task.ended) return

    task.ended = true
    if (task.timeoutId) {
        clearTimeout(task.timeoutId)
        task.timeoutId = null
    }

    let payload = Object.assign({
        taskKey: task.taskKey,
        reason: task.reason,
        retained: task.retained,
        duration_ms: Date.now() - task.startedAt,
    }, task.meta || {}, extra || {})

    _geoTaskTelemetry('ios_bg_task_end', Object.assign({ status: status }, payload))

    try {
        let bgGeo = getBackgroundGeolocationPlugin()
        if (bgGeo && typeof bgGeo.endTask === 'function') {
            bgGeo.endTask(task.taskKey)
        }
    }
    catch (e) {
        console.warn('[BG-TASK] endTask failed', e)
    }
}

function runWithGeoBackgroundTask(taskKey, reason, meta, work) {
    if (PLATFORM !== 'ios') {
        work(null)
        return
    }

    let task = {
        taskKey: taskKey,
        reason: reason,
        startedAt: Date.now(),
        retained: false,
        ended: false,
        timeoutId: null,
        meta: Object.assign({ visibility: APP_VISIBILITY }, meta || {})
    }

    ACTIVE_GEO_BACKGROUND_TASK = task
    _geoTaskTelemetry('ios_bg_task_begin', {
        taskKey: task.taskKey,
        reason: task.reason,
        visibility: task.meta.visibility,
        acc: task.meta.acc,
    })

    try {
        work(task)
    }
    finally {
        ACTIVE_GEO_BACKGROUND_TASK = null
        if (!task.retained) {
            _finishGeoBackgroundTask(task, 'sync-complete')
        }
        else {
            _geoTaskTelemetry('ios_bg_task_deferred', {
                taskKey: task.taskKey,
                reason: task.reason,
                visibility: task.meta.visibility,
            })
        }
    }
}

function claimBackgroundGeoTask(meta) {
    if (PLATFORM !== 'ios' || !ACTIVE_GEO_BACKGROUND_TASK) return null

    let task = ACTIVE_GEO_BACKGROUND_TASK
    task.retained = true
    task.meta = Object.assign({}, task.meta || {}, meta || {})

    if (!task.timeoutId) {
        task.timeoutId = setTimeout(() => {
            _finishGeoBackgroundTask(task, 'timeout', { visibility: APP_VISIBILITY })
        }, IOS_GEO_BACKGROUND_TASK_TIMEOUT)
    }

    _geoTaskTelemetry('ios_bg_task_claim', {
        taskKey: task.taskKey,
        reason: task.reason,
        visibility: task.meta.visibility,
        src: task.meta.src,
        loaded_before_play: task.meta.loaded_before_play,
    })

    return task
}

function resolveBackgroundGeoTask(task, status, meta) {
    _finishGeoBackgroundTask(task, status, meta)
}

function logAudioContextState(reason = 'unknown', force = false) {
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    let state = Howler.ctx.state
    if (!force && LAST_AUDIO_CONTEXT_STATE === state) return

    LAST_AUDIO_CONTEXT_STATE = state
    console.log('[AUDIO] AudioContext state:', reason, state)
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_context_state', {reason: reason, state: state})
}

function bindAudioContextState() {
    if (AUDIO_CONTEXT_STATE_BOUND) return
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    let previousHandler = Howler.ctx.onstatechange
    Howler.ctx.onstatechange = function(event) {
        if (typeof previousHandler === 'function') previousHandler.call(this, event)
        logAudioContextState('statechange', true)
    }

    AUDIO_CONTEXT_STATE_BOUND = true
    logAudioContextState('bind', true)
}

function resumeAudioContext(reason = 'unknown') {
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    bindAudioContextState()
    logAudioContextState(reason)
    if (Howler.ctx.state === 'running') return

    console.log('[AUDIO] Resuming AudioContext:', reason, Howler.ctx.state)
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_context_resume', {reason: reason, state: Howler.ctx.state})

    try {
        let result = Howler.ctx.resume()
        if (result && typeof result.then === 'function') {
            result.then(() => logAudioContextState(reason + ':resolved', true))
        }
        if (result && typeof result.catch === 'function') {
            result.catch(error => console.warn('[AUDIO] Failed to resume AudioContext:', reason, error))
        }
        else {
            logAudioContextState(reason + ':sync', true)
        }
    }
    catch (error) {
        console.warn('[AUDIO] Failed to resume AudioContext:', reason, error)
    }
}

function geo_coords(c) {
    if (c.coords) return geo_coords(c.coords)

    // parse coords from string zoom/lat/lon
    if (typeof c == 'string') {
        var [zoom, lat, lon] = c.split('/')
        return [parseFloat(lat), parseFloat(lon)]
    }

    // parse coords from object
    var lat = c.latitude || c.lat || c[0]
    var lng = c.longitude || c.lng || c.lon || c[1]
    if (lat && lng) return [lat, lng]
    else console.error('Invalid coords:', c)
}


function geo_distance(pos1, pos2) {
    pos1 = geo_coords(pos1)
    pos2 = geo_coords(pos2)

    try {
        if ((pos1[0] == pos2[0]) && (pos1[1] == pos2[1])) {
            return 0;
        }
        else {
            var radlat1 = Math.PI * pos1[0] / 180
            var radlat2 = Math.PI * pos2[0] / 180
            var theta = pos1[1] - pos2[1]
            var radtheta = Math.PI * theta / 180
            var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
            if (dist > 1) dist = 1
            dist = Math.acos(dist)
            dist = dist * 180 / Math.PI
            dist = dist * 60 * 1.1515 * 1.609344 * 1000
            return dist
        }
    }
    catch (e) {
        console.error('Error calculating distance:', e)
        return 1000000
    }
}

// R23 / BG-11 (iOS, v2.10.0): build the GPS wake-up rail for a parcours.
// One CLCircularRegion at the geographic midpoint between each pair of
// consecutive step centroids, 100 m radius. The rail's sole purpose is to
// wake the app when CLLocationManager standard updates stall — it does NOT
// participate in step audio triggering. Bounded by the iOS region-monitor
// limit (20 per app, app-wide); a 17-step parcours produces 16 rail
// regions, well under the limit.
function computeGpsRail(parcours) {
    var steps = parcours && parcours.spots && parcours.spots.steps || [];
    var ordered = steps.slice().sort(function(a, b) { return a._index - b._index; });
    if (ordered.length < 2) return [];

    var rail = [];
    for (var i = 0; i < ordered.length - 1; i++) {
        var a = ordered[i] && ordered[i]._spot;
        var b = ordered[i+1] && ordered[i+1]._spot;
        if (!a || !b) continue;
        if (typeof a.lat !== 'number' || typeof b.lat !== 'number') continue;
        if (typeof a.lon !== 'number' || typeof b.lon !== 'number') continue;
        rail.push({
            id:     'rail_' + ordered[i]._index + '_' + ordered[i+1]._index,
            lat:    (a.lat + b.lat) / 2,
            lon:    (a.lon + b.lon) / 2,
            radius: 100  // metres — see Workstream H Decision 1.A in mobile-audit.md
        });
    }
    return rail;
}

// Shortest distance in meters from a point to a segment,
// where a segment is defined by two points.
// pos is the point, segA and segB are the two points defining the segment.
// All points are in the form [lat, lng].
function geo_distance_to_segment(pos, segA, segB) {
    // convert coords to array
    if (pos.coords) pos = [pos.coords.latitude, pos.coords.longitude]
    if (pos.lat) pos = [pos.lat, pos.lng]
    if (segA.coords) segA = [segA.coords.latitude, segA.coords.longitude]
    if (segA.lat) segA = [segA.lat, segA.lng]
    if (segB.coords) segB = [segB.coords.latitude, segB.coords.longitude]
    if (segB.lat) segB = [segB.lat, segB.lng]

    var a = pos[0] - segA[0]
    var b = pos[1] - segA[1]
    var c = segB[0] - segA[0]
    var d = segB[1] - segA[1]

    var dot = a * c + b * d
    var len_sq = c * c + d * d
    var param = -1
    if (len_sq != 0) // in case of 0 length line
        param = dot / len_sq

    var xx, yy

    if (param < 0) {
        xx = segA[0]
        yy = segA[1]
    }
    else if (param > 1) {
        xx = segB[0]
        yy = segB[1]
    }
    else {
        xx = segA[0] + param * c
        yy = segA[1] + param * d
    }

    return geo_distance(pos, [xx, yy])
}


// Init geoloc
// 

class GeoLoc extends EventEmitter {
    constructor() {
        super();
        this.watchId = null;
        this.firstMeasure = null;
        this.initialPosition = null;
        this.lastPosition = null;
        this.initializing = true;
        this.lastTimeUpdate = null;
        // B4 — real-callback freshness. lastTimeUpdate is refreshed by both real
        // OS callbacks AND the NSTimer/Handler keepalive (P0.5 Fix 1b), so a
        // multi-minute background-GPS blackout doesn't trip the 30 s lost
        // timeout — the keepalive ticks every 15 s and resets the clock with a
        // stale cached position. Tracking real callbacks separately is the
        // single missing signal needed to surface S1/P1.34 (iOS) and P1.31
        // (Android Doze) blackouts. Phase 1A: diagnostic only.
        this.lastRealCallbackTime = null;
        // User-facing GPS liveness follows the timestamp of the freshest fix,
        // not merely the arrival of a callback. This prevents stale keepalive
        // replays from masking GPS-lost.
        this.lastUsableFixTime = null;
        this.lastUsablePosition = null;

        this.startupFixMaxAgeMs = STARTUP_FIX_MAX_AGE_MS;
        this.startupFixMaxAccuracyM = STARTUP_FIX_MAX_ACCURACY_M;
        this.startupRequiredFixes = STARTUP_REQUIRED_FIXES;
        this.startupSecondFixMinGapMs = STARTUP_SECOND_FIX_MIN_GAP_MS;
        this.startupSecondFixMinMovementM = STARTUP_SECOND_FIX_MIN_MOVEMENT_M;
        this.startupReadiness = null;
        this._resetStartupReadiness();

        this.follow = false;
        this.map = null;

        this.runMode = 'off';   // off, gps, simulate

        this.stateUpdate = 'off'; // off, acquiring, ok, frozen, lost
        this.stateUpdateMeta = { state: 'off', reason: 'service_off' };
        this.stateUpdateTimeout = 10000; // 10 seconds
        this.lastAccuracyBucket = null;

        // A4 — accuracy-collapse episode tracker (see _trackAccuracyDegradation)
        this._degradedSince = null;
        this._degradedActive = false;
        this._degradedWorstAcc = null;
        this._degradedFixCount = 0;

        this.stateUpdateTimer = setInterval(() => {
            let snapshot = this._signalStateSnapshot(Date.now())
            this._applySignalState(snapshot)

            // Proactive heartbeat: approaching timeout but not yet lost.
            // On iOS, stationary periods suppress CLLocation delegate callbacks but
            // CLLocationManager.location (cached) may still be available. Probe it
            // before the freshness timeout fully expires so active fixes can recover
            // the stream without stale keepalive callbacks keeping GPS falsely alive.
            if (this.stateUpdate === 'ok' &&
                snapshot.fixAgeMs !== null &&
                snapshot.fixAgeMs > this.stateUpdateTimeout * 0.6 &&
                this.runMode === 'gps' &&
                getBackgroundGeolocationPlugin()) {
                this._heartbeat();
            }

            // Reactive heartbeat: stale or fully silent stream — try to recover.
            if ((this.stateUpdate === 'frozen' || this.stateUpdate === 'lost') &&
                this.runMode === 'gps' &&
                getBackgroundGeolocationPlugin()) {
                this._heartbeat();
            }

            // B4 watchdog — if real GPS callbacks have stalled for >60 s on iOS,
            // trigger a CLLocationManager stop/restart via forceReacquire (bg-geo v2.6.0 BG-2).
            // iOS-only: Android is covered natively by the AlarmManager keepalive (BG-5).
            // Rate-limited: max 10 per session (#6b — aligned with the native rail
            // cap; a 45-min walk with several iOS-26 blackouts can legitimately need
            // more than the old 3), no more than once per 90 s.
            if (PLATFORM === 'ios' &&
                this.runMode === 'gps' &&
                this.lastRealCallbackTime !== null &&
                (Date.now() - this.lastRealCallbackTime) > 60000 &&
                this._forceReacquireCount < 10 &&
                (Date.now() - this._lastForceReacquireTime) >= 90000) {
                let bgGeo = getBackgroundGeolocationPlugin();
                if (bgGeo && typeof bgGeo.forceReacquire === 'function') {
                    this._forceReacquireCount++;
                    this._lastForceReacquireTime = Date.now();
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('force_reacquire_triggered', {
                        real_age_ms: Date.now() - this.lastRealCallbackTime,
                        count: this._forceReacquireCount,
                        visibility: APP_VISIBILITY,
                    });
                    bgGeo.forceReacquire().catch(function(e) {
                        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('force_reacquire_failed', {error: String(e)});
                    });
                }
            }

            // D1 hardening (#2, 2026-06-10) — timer-based JS-liveness ack,
            // decoupled from GPS delivery: a GPS blackout with a live JS loop
            // must not read as a frozen renderer to the native watchdog (which
            // would vibrate "Flânerie en pause" mid-blackout). ~25 s cadence;
            // Chromium intensive throttling clamps background timers to 1/min,
            // still inside the native 90 s stall bar. Per-fix acks in
            // _callbackPosition stay as belt-and-braces (bridge callbacks keep
            // flowing when timers are throttled).
            if (PLATFORM === 'android' &&
                (Date.now() - this._lastWatchdogAckTime) >= 25000) {
                this._lastWatchdogAckTime = Date.now();
                let ackGeo = getBackgroundGeolocationPlugin();
                if (ackGeo && typeof ackGeo.ackAlive === 'function') {
                    try { ackGeo.ackAlive(function(){}, function(){}) } catch (e) {}
                }
                // #4 — same cadence: re-poke the in-renderer Web Audio keepalive
                // in case Chromium suspended the AudioContext after the one-shot
                // visibilitychange poke (the lock-time race the audit flagged).
                if (typeof RENDERER_KEEPALIVE !== 'undefined') {
                    try { RENDERER_KEEPALIVE.poke() } catch (e) {}
                }
            }
        }, 1000);

        this._heartbeatInProgress = false;
        this._lastHeartbeatTime = 0;
        this._lastWatchdogAckTime = 0;

        // B4 watchdog (BG-2 / Round 13) — iOS forceReacquire counter + throttle.
        // Resets on each new GPS session (init()). Max 10 triggers per session (#6b).
        this._forceReacquireCount = 0;
        this._lastForceReacquireTime = 0;
    }

    _resetStartupReadiness() {
        this.startupReadiness = {
            ready: false,
            fixCount: 0,
            requiredFixCount: this.startupRequiredFixes,
            maxAccuracyM: this.startupFixMaxAccuracyM,
            maxAgeMs: this.startupFixMaxAgeMs,
            lastReason: 'waiting_first_fix',
            lastSource: null,
            lastAccuracy: null,
            lastAgeMs: null,
            lastSeparationMs: null,
            lastMovementM: null,
            lastAcceptedFixTime: null,
            lastAcceptedPosition: null,
        }
    }

    _updateStartupReadiness(position, info = {}) {
        if (!this.startupReadiness) this._resetStartupReadiness()

        let tracker = this.startupReadiness
        let accuracy = info.accuracy
        let ageMs = info.positionAgeMs
        let usableFixTime = info.usableFixTime
        let source = info.source || 'unknown'
        let reason = null

        if (position.simulate) reason = 'simulate'
        else if (typeof ageMs !== 'number' || isNaN(ageMs)) reason = 'unknown_age'
        else if (ageMs > this.startupFixMaxAgeMs) reason = 'stale'
        else if (typeof accuracy !== 'number' || isNaN(accuracy)) reason = 'no_accuracy'
        else if (accuracy > STARTUP_FIX_MAX_ACCURACY_M) reason = 'accuracy'

        let next = Object.assign({}, tracker, {
            lastSource: source,
            lastAccuracy: accuracy,
            lastAgeMs: ageMs,
            lastSeparationMs: null,
            lastMovementM: null,
        })

        next.maxAccuracyM = STARTUP_FIX_MAX_ACCURACY_M

        if (reason) {
            next.lastReason = reason
            this.startupReadiness = next
            // A2 (2026-06-11): once the gate has been satisfied it never
            // un-readies (startupReady() re-checks freshness separately), so a
            // post-ready accuracy blip mid-walk must not re-emit rejections —
            // they read as gate failures in B4 calibration queries (`hxgs` ×5).
            if (!tracker.ready && tracker.lastReason !== reason && typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_startup_rejected', {
                    reason: reason,
                    fix_count: tracker.fixCount,
                    required_fix_count: this.startupRequiredFixes,
                    max_accuracy_m: STARTUP_FIX_MAX_ACCURACY_M,
                    age_ms: ageMs,
                    acc: accuracy,
                    source: source,
                })
            }
            return
        }

        if (tracker.ready) {
            next.lastReason = 'ready'
            this.startupReadiness = next
            return
        }

        if (tracker.fixCount === 0) {
            next.fixCount = 1
            next.lastReason = this.startupRequiredFixes > 1 ? 'waiting_second_fix' : 'ready'
            next.lastAcceptedFixTime = usableFixTime
            next.lastAcceptedPosition = position
            next.ready = next.fixCount >= this.startupRequiredFixes
            this.startupReadiness = next
            if (typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_startup_fix', {
                    fix_count: next.fixCount,
                    required_fix_count: this.startupRequiredFixes,
                    age_ms: ageMs,
                    acc: accuracy,
                    source: source,
                })
                if (next.ready) {
                    TELEMETRY.log('gps_startup_ready', {
                        fix_count: next.fixCount,
                        required_fix_count: this.startupRequiredFixes,
                        age_ms: ageMs,
                        acc: accuracy,
                        source: source,
                    })
                }
            }
            return
        }

        let separationMs = usableFixTime - tracker.lastAcceptedFixTime
        let movementM = Math.round(geo_distance(tracker.lastAcceptedPosition, position))
        next.lastSeparationMs = separationMs
        next.lastMovementM = movementM

        if (separationMs >= this.startupSecondFixMinGapMs || movementM >= this.startupSecondFixMinMovementM) {
            next.fixCount = tracker.fixCount + 1
            next.lastAcceptedFixTime = usableFixTime
            next.lastAcceptedPosition = position
            next.ready = next.fixCount >= this.startupRequiredFixes
            next.lastReason = next.ready ? 'ready' : 'waiting_second_fix'
            this.startupReadiness = next
            if (typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_startup_fix', {
                    fix_count: next.fixCount,
                    required_fix_count: this.startupRequiredFixes,
                    separation_ms: separationMs,
                    movement_m: movementM,
                    age_ms: ageMs,
                    acc: accuracy,
                    source: source,
                })
                if (next.ready) {
                    TELEMETRY.log('gps_startup_ready', {
                        fix_count: next.fixCount,
                        required_fix_count: this.startupRequiredFixes,
                        separation_ms: separationMs,
                        movement_m: movementM,
                        age_ms: ageMs,
                        acc: accuracy,
                        source: source,
                    })
                    this.emit('startupReady', Object.assign({}, next, { lastAcceptedPosition: null }))
                }
            }
            return
        }

        next.lastReason = 'fixes_too_similar'
        this.startupReadiness = next
        if (tracker.lastReason !== 'fixes_too_similar' && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_startup_rejected', {
                reason: 'fixes_too_similar',
                fix_count: tracker.fixCount,
                required_fix_count: this.startupRequiredFixes,
                separation_ms: separationMs,
                min_gap_ms: this.startupSecondFixMinGapMs,
                movement_m: movementM,
                min_movement_m: this.startupSecondFixMinMovementM,
                age_ms: ageMs,
                acc: accuracy,
                source: source,
            })
        }
    }

    startupStatus() {
        if (!this.startupReadiness) this._resetStartupReadiness()
        let tracker = this.startupReadiness
        return {
            ready: !!tracker.ready,
            fixCount: tracker.fixCount,
            requiredFixCount: tracker.requiredFixCount,
            maxAccuracyM: tracker.maxAccuracyM,
            maxAgeMs: tracker.maxAgeMs,
            lastReason: tracker.lastReason,
            lastSource: tracker.lastSource,
            lastAccuracy: tracker.lastAccuracy,
            lastAgeMs: tracker.lastAgeMs,
            lastSeparationMs: tracker.lastSeparationMs,
            lastMovementM: tracker.lastMovementM,
        }
    }

    startupReady() {
        if (!this.startupReadiness || !this.startupReadiness.ready) return false
        let fixTime = this.lastUsableFixTime != null ? this.lastUsableFixTime : this.lastTimeUpdate
        let position = this.usablePosition()
        if (!fixTime || !position || !position.coords) return false
        let ageMs = Date.now() - fixTime
        let accuracy = position.coords.accuracy
        if (typeof accuracy !== 'number' || isNaN(accuracy)) return false
        return ageMs <= this.startupFixMaxAgeMs && accuracy <= this.startupFixMaxAccuracyM
    }

    _signalStateSnapshot(now = Date.now()) {
        let fixAgeMs = this.lastUsableFixTime != null ? Math.max(0, now - this.lastUsableFixTime) : null
        let anyAgeMs = this.lastTimeUpdate != null ? Math.max(0, now - this.lastTimeUpdate) : null
        let realAgeMs = this.lastRealCallbackTime != null ? Math.max(0, now - this.lastRealCallbackTime) : null

        if (this.runMode === 'off') {
            return { state: 'off', reason: 'service_off', fixAgeMs, anyAgeMs, realAgeMs }
        }

        if (this.runMode === 'simulate') {
            return { state: this.lastPosition ? 'ok' : 'acquiring', reason: 'simulate', fixAgeMs, anyAgeMs, realAgeMs }
        }

        if (fixAgeMs !== null && fixAgeMs < this.stateUpdateTimeout) {
            return { state: 'ok', reason: 'fresh_fix', fixAgeMs, anyAgeMs, realAgeMs }
        }

        if (fixAgeMs === null) {
            return {
                state: 'acquiring',
                reason: anyAgeMs === null ? 'awaiting_first_fix' : 'callback_without_usable_fix',
                fixAgeMs,
                anyAgeMs,
                realAgeMs,
            }
        }

        if (anyAgeMs !== null && anyAgeMs < this.stateUpdateTimeout) {
            return { state: 'frozen', reason: 'stale_fix_recent_callback', fixAgeMs, anyAgeMs, realAgeMs }
        }

        return {
            state: 'lost',
            reason: anyAgeMs === null ? 'no_callback_since_start' : 'callback_stream_silent',
            fixAgeMs,
            anyAgeMs,
            realAgeMs,
        }
    }

    // A4 (2026-06-11) — accuracy-collapse detector, TELEMETRY-ONLY (phase 1).
    // The freshness-based state machine cannot see a stream that delivers
    // fresh but grossly inaccurate fixes (iPhone 8 `4och`: 8 min at p50=40 m /
    // p95=200 m, position 137 m off → zones 2–3 never fired and the walker got
    // no warning). Emits `gps_degraded` once the collapse sustains and
    // `gps_degraded_recovered` when a good fix lands. No walker-facing
    // behaviour — phase 2 (escalation UX, reusing the frozen-escalation path)
    // is conditional on how often VILLEURBANNE telemetry shows this firing.
    // NOT gated on motionIsStationary (the backpack walk read stationary
    // mid-collapse); the flag is recorded so the analyzer can slice instead.
    _trackAccuracyDegradation(accuracy, source, motionStationary, now) {
        if (typeof accuracy !== 'number' || isNaN(accuracy)) return
        if (this.runMode !== 'gps') return
        if (accuracy <= DEGRADED_ACCURACY_M) {
            if (this._degradedActive && typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_degraded_recovered', {
                    duration_ms: this._degradedSince != null ? now - this._degradedSince : null,
                    fix_count: this._degradedFixCount,
                    worst_acc: this._degradedWorstAcc,
                    acc: accuracy,
                    motion_stationary: motionStationary,
                    visibility: APP_VISIBILITY,
                })
            }
            this._degradedSince = null
            this._degradedActive = false
            this._degradedWorstAcc = null
            this._degradedFixCount = 0
            return
        }
        if (this._degradedSince == null) {
            this._degradedSince = now
            this._degradedWorstAcc = accuracy
            this._degradedFixCount = 0
        }
        this._degradedFixCount++
        if (accuracy > this._degradedWorstAcc) this._degradedWorstAcc = accuracy
        if (!this._degradedActive && (now - this._degradedSince) >= DEGRADED_SUSTAIN_MS) {
            this._degradedActive = true
            if (typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_degraded', {
                    sustained_ms: now - this._degradedSince,
                    fix_count: this._degradedFixCount,
                    worst_acc: this._degradedWorstAcc,
                    acc: accuracy,
                    max_accuracy_m: DEGRADED_ACCURACY_M,
                    source: source,
                    motion_stationary: motionStationary,
                    visibility: APP_VISIBILITY,
                    step: (typeof PARCOURS !== 'undefined' && typeof PARCOURS.currentStep === 'function') ? PARCOURS.currentStep() : null,
                })
            }
        }
    }

    _applySignalState(snapshot) {
        if (!snapshot) return

        let changed = this.stateUpdate !== snapshot.state
            || !this.stateUpdateMeta
            || this.stateUpdateMeta.reason !== snapshot.reason

        this.stateUpdate = snapshot.state
        this.stateUpdateMeta = snapshot

        if (!changed) return

        this.emit('stateUpdate', snapshot.state, snapshot)
        if (typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_state', {
                state: snapshot.state,
                reason: snapshot.reason,
                fix_age_ms: snapshot.fixAgeMs,
                any_age_ms: snapshot.anyAgeMs,
                real_age_ms: snapshot.realAgeMs,
                visibility: APP_VISIBILITY,
            })
        }
    }

    // Active GPS recovery: when updates have stopped, try getCurrentLocation
    // to nudge the OS into resuming GPS and feed a position back into the pipeline.
    // Throttled to once per 15 s — must be larger than the inner timeout to avoid
    // back-to-back requests.
    _heartbeat() {
        if (this._heartbeatInProgress) return;
        if (Date.now() - this._lastHeartbeatTime < 15000) return;
        this._heartbeatInProgress = true;
        this._lastHeartbeatTime = Date.now();

        console.log('[HEARTBEAT] GPS lost — requesting current location');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_heartbeat', {visibility: APP_VISIBILITY});

        this._activeFix('heartbeat', {timeout: 5000})
            .catch(() => {})
            .finally(() => { this._heartbeatInProgress = false });
    }

    // Shared active-fix path used by:
    //   - _heartbeat() (reactive: recover from stall, throttled, 5 s timeout)
    //   - warmupPosition() (proactive: prime receiver from page transitions)
    // Calls bg-geo getCurrentLocation (or navigator.geolocation in the no-bg-geo
    // fallback path), normalizes the result, and pumps it through
    // _callbackPosition so lastPosition / lastTimeUpdate / stateUpdate all
    // update as if a passive fix had arrived.
    //
    // Emits gps_active_fix_ok / gps_active_fix_fail with a `reason` tag so
    // analyze.mjs can attribute warmups to their call site (heartbeat,
    // startgeo-prime, rdv-warmup, etc.) and measure TTFF distributions per
    // call site.
    _activeFix(reason, opts = {}) {
        let timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000
        let maximumAge = typeof opts.maximumAge === 'number' ? opts.maximumAge : 0
        let startedAt = Date.now()

        let normalize = (location) => {
            if (!location) return null
            if (location.coords) return location  // already navigator-shape
            return {
                simulate: false,
                timestamp: typeof location.time === 'number' ? location.time : Date.now(),
                coords: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy: location.accuracy,
                    speed: location.speed,
                }
            }
        }

        let inject = (raw) => {
            let position = normalize(raw)
            if (position) this._callbackPosition(position, {source: reason, visibility: APP_VISIBILITY})
            return position
        }

        let logOk = (position) => {
            if (typeof TELEMETRY === 'undefined') return
            TELEMETRY.log('gps_active_fix_ok', {
                reason: reason,
                ms: Date.now() - startedAt,
                acc: position && position.coords ? Math.round(position.coords.accuracy) : null,
                visibility: APP_VISIBILITY,
            })
        }

        let logFail = (error) => {
            if (typeof TELEMETRY === 'undefined') return
            TELEMETRY.log('gps_active_fix_fail', {
                reason: reason,
                ms: Date.now() - startedAt,
                code: error && typeof error.code !== 'undefined' ? error.code : null,
                message: String(error && error.message || error),
                visibility: APP_VISIBILITY,
            })
        }

        let bgGeo = getBackgroundGeolocationPlugin()
        if (bgGeo) {
            return new Promise((resolve, reject) => {
                bgGeo.getCurrentLocation(
                    (location) => { let p = inject(location); logOk(p); resolve(p) },
                    (error)    => { logFail(error); reject(error) },
                    {enableHighAccuracy: true, timeout: timeout, maximumAge: maximumAge}
                )
            })
        }

        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject('no navigator.geolocation'); return }
            navigator.geolocation.getCurrentPosition(
                (position) => { let p = inject(position); logOk(p); resolve(p) },
                (error)    => { logFail(error); reject(error) },
                {enableHighAccuracy: true, timeout: timeout, maximumAge: maximumAge}
            )
        })
    }

    _callbackPosition(position, telemetryMeta = {})
    {
        resumeAudioContext('position')

        let now = Date.now()
        // F-N3 — stamp the JS-side receive time so downstream telemetry
        // (step_fire latency in spot.js) can measure how long the JS event
        // loop took to react to the OS position callback. Surfaces decode-
        // induced JS stalls on weak Android (matches the B1 unload premise).
        position._jsReceivedAt = now
        let callbackGapMs = this.lastTimeUpdate == null ? null : now - this.lastTimeUpdate
        let positionAgeMs = typeof position.timestamp === 'number' ? Math.max(0, now - position.timestamp) : null
        let usableFixTime = typeof position.timestamp === 'number' ? Math.min(now, position.timestamp) : now
        let accuracy = position && position.coords ? Math.round(position.coords.accuracy) : null
        let visibility = telemetryMeta.visibility || APP_VISIBILITY
        let source = telemetryMeta.source || (position.simulate ? 'simulate' : 'unknown')
        let motionStationary = !!this.motionIsStationary
        let accuracyBucket = gpsAccuracyBucket(accuracy)

        telemetryMeta.source = source
        position._source = source   // P1.4 — stamp so route_probe can tag sim-vs-real triggering
        telemetryMeta.visibility = visibility
        telemetryMeta.motionStationary = motionStationary
        if (callbackGapMs !== null) telemetryMeta.callbackGapMs = callbackGapMs
        if (positionAgeMs !== null) telemetryMeta.ageMs = positionAgeMs

        if (callbackGapMs !== null && callbackGapMs >= GPS_CALLBACK_GAP_THRESHOLD && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_callback_gap', {
                gapMs: Math.round(callbackGapMs),
                source: source,
                visibility: visibility,
                acc: accuracy,
                ageMs: positionAgeMs,
                motionStationary: motionStationary
            })
        }

        if (callbackGapMs !== null && visibility === 'background' && callbackGapMs >= GPS_SLEEP_SUSPECT_THRESHOLD && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_sleep_suspect', {
                gapMs: Math.round(callbackGapMs),
                source: source,
                acc: accuracy,
                ageMs: positionAgeMs,
                motionStationary: motionStationary
            })
        }

        if (positionAgeMs !== null && positionAgeMs >= 10000 && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_stale_callback', {
                ageMs: Math.round(positionAgeMs),
                source: source,
                visibility: visibility,
                acc: accuracy
            })
        }

        if (accuracyBucket !== this.lastAccuracyBucket) {
            if (this.lastAccuracyBucket !== null && typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_accuracy_bucket', {
                    from: this.lastAccuracyBucket,
                    to: accuracyBucket,
                    acc: accuracy,
                    source: source,
                    visibility: visibility,
                    gapMs: callbackGapMs
                })
            }
            this.lastAccuracyBucket = accuracyBucket
        }

        // first measure
        if (!this.firstMeasure) {
            this.firstMeasure = position;
            this.initialPosition = position;
        }

        // adjusting initial position during CALIBRATION_TIME if accuracy is better
        if (!position.simulate && this.firstMeasure.timestamp + CALIBRATION_TIME * 1000 > position.timestamp) {
            if (position.coords.accuracy < this.initialPosition.coords.accuracy) this.initialPosition = position;
            console.log('Initialisation en cours..');
        } else {
            // first run
            if (this.initializing) {
                this.initializing = false;
                console.log('Initialisation terminée');
            }

            // MAP follow position
            if (this.follow && !position.simulate && this.map)
                this.map.setView([position.coords.latitude, position.coords.longitude], this.map.getZoom());

            // polyline track
            if (this.follow && this.polyTrack) {
                if (!this.lastTrackPosition || geo_distance(this.lastTrackPosition, position) > 3) {
                    this.polyTrack.addLatLng([position.coords.latitude, position.coords.longitude]);
                    this.lastTrackPosition = position;
                }
            }

            // Accuracy gate: reject inaccurate fixes for step triggering
            if (!position.simulate && position.coords.accuracy > 30) {
                console.warn('GPS accuracy too low (' + Math.round(position.coords.accuracy) + 'm), position ignored for triggers');
                telemetryMeta.rejected = true
                telemetryMeta.reason = 'accuracy'
                if (typeof TELEMETRY !== 'undefined') {
                    TELEMETRY.log('gps_trigger_rejected', {
                        reason: 'accuracy',
                        acc: Math.round(position.coords.accuracy),
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        source: source,
                        visibility: visibility,
                        gapMs: callbackGapMs,
                        ageMs: positionAgeMs,
                        motionStationary: motionStationary
                    });
                }
                // Still update lastPosition/lastTimeUpdate so callback telemetry
                // and the visible map position reflect the incoming stream.
            } else if (this.runMode === 'simulate' && !position.simulate) {
                // P1.4 — in simulation mode, real GPS fixes (rdv-warmup / navigator /
                // bg-geo keepalive) still arrive but must NOT drive triggering, else the
                // real position "overrides" the simulated one (Baptiste 06/06). They
                // still update lastPosition / startup readiness / telemetry below.
                telemetryMeta.rejected = true
                telemetryMeta.reason = 'real_fix_during_simulate'
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_trigger_rejected', {
                    reason: 'real_fix_during_simulate', source: source, acc: accuracy, visibility: visibility
                })
            } else {
                this.emit('position', position);
            }
        }

        // next measure
        this.lastPosition = position;
        this.lastTimeUpdate = Date.now();
        if (this.lastUsableFixTime == null || usableFixTime >= this.lastUsableFixTime) {
            this.lastUsableFixTime = usableFixTime;
            this.lastUsablePosition = position;
        }
        this._updateStartupReadiness(position, {
            source: source,
            accuracy: accuracy,
            positionAgeMs: positionAgeMs,
            usableFixTime: usableFixTime,
        })
        // A4 — judge accuracy collapse on REAL fixes only: a keepalive /
        // heartbeat replay re-delivers the old fix's accuracy and would
        // double-count the same measurement into the episode.
        if (source !== 'heartbeat' && source !== 'simulate' && source !== 'keepalive' && !position.simulate) {
            this._trackAccuracyDegradation(accuracy, source, motionStationary, now)
        }
        // B4 diagnostic half — only count this as a "real" callback if the
        // source isn't heartbeat / simulate / keepalive. The 'unknown' default
        // (bg-geo native callbacks that don't tag a source) IS real.
        if (source !== 'heartbeat' && source !== 'simulate' && source !== 'keepalive') {
            this.lastRealCallbackTime = Date.now();
            // D1 (v2.15.0, Android) — JS-liveness heartbeat to the native
            // watchdog. This dispatch only runs when the JS event loop is alive;
            // when a locked-pocket walk freezes the renderer, these acks stop and
            // the AlarmManager-backed watchdog escalates. Fire-and-forget; iOS
            // errbacks (JS stays alive via the location bg-mode).
            if (PLATFORM === 'android') {
                let bgGeo = getBackgroundGeolocationPlugin()
                if (bgGeo && typeof bgGeo.ackAlive === 'function') {
                    try { bgGeo.ackAlive(function(){}, function(){}) } catch (e) {}
                }
                // #4 (2026-06-10) — bridge-delivered fixes keep arriving during
                // the soft-throttle phase even when JS timers stall, so this is
                // the most reliable place to resurrect a suspended AudioContext
                // before the hard freeze lands. poke() is a cheap no-op when the
                // keepalive is inactive or already playing.
                if (typeof RENDERER_KEEPALIVE !== 'undefined') {
                    try { RENDERER_KEEPALIVE.poke() } catch (e) {}
                }
            }
        }
        this._applySignalState(this._signalStateSnapshot(now))
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.gps(position, telemetryMeta);

        // Snapshot voice position while JS is awake inside the GPS background task window.
        // Covers the gap between document.pause (backgrounding) and a potential system kill.
        if (APP_VISIBILITY === 'background' && typeof PARCOURS !== 'undefined' && typeof PARCOURS.store === 'function') {
            PARCOURS.store()
        }
    }

    _callbackError(error) {
        this.emit('error', error);
    }

    setPosition(pos) {
        this.fakeUpdate(pos);
    }

    // Fake position (center of the map)
    fakePosition(pos) {
        let p = {
            coords: {
                latitude: 45.76776,
                longitude: 4.91376,
                accuracy: 10,
                speed: 0,
            },
            timestamp: Date.now(),
            simulate: true,
        };
        if (pos) {
            pos = geo_coords(pos);
            p.coords.latitude = pos[0];
            p.coords.longitude = pos[1];
        } 
        return p;
    }

    // Fake update event (triggered by map move, simulate GPS new position event)
    fakeUpdate(pos = null) {
        this._callbackPosition(this.fakePosition(pos), {source: 'simulate', visibility: APP_VISIBILITY});
    }

    // Test if geoloc is supported
    testGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) reject('La géolocalisation n\'est pas supportée par votre navigateur');
            navigator.geolocation.getCurrentPosition(
                position => {
                    console.log('GEO TEST OK:', position);
                    resolve(position);
                },
                error => {
                    console.error('GEO TEST ERROR:', error);
                    reject(error);
                }
            );
        });
    }

    // Set map and apply bindings
    setMap(map) {
        this.map = map;

        if (!this.map) return;
        this.map.off('move', ()=>this.fakeUpdate(this.map.getCenter()));

        if (this.runMode == 'gps') 
        {
            this.map.dragging.disable();
        }
        else if (this.runMode == 'simulate') 
        {
            this.map.dragging.enable();
            this.map.on('move', ()=>{
                if (this.follow) this.fakeUpdate(this.map.getCenter());
            });
            setTimeout(()=>this.fakeUpdate(this.map.getCenter()), 300);
        }

        // polyline track
        if (this.polyTrack) this.polyTrack.remove();
        this.polyTrack = L.polyline([], {color: 'blue'}).addTo(this.map);
    }

    mode() {
        return this.runMode;
    }

    // Init geolocation
    init(mode) {
        console.log('Init geoloc: ', mode);

        // NOTE: previously called this.removeAllListeners() here ("unbind all
        // events") — but EventEmitter.removeAllListeners() with no argument is
        // a no-op (it does `delete this._events[undefined]`). The call did
        // nothing and removing it is intentional: the GEO listeners registered
        // by pages.js (stateUpdate / authorizationChanged / bgServiceStop) and
        // map.js (position) must survive an init(). parcours.js clears its own
        // 'position' listener explicitly by name in build().

        // stop existing geoloc
        if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;

        this.firstMeasure = null;
        this.initialPosition = null;
        this.lastPosition = null;
        this.initializing = true;
        this.lastTimeUpdate = null;
        this.lastRealCallbackTime = null;
        this.lastUsableFixTime = null;
        this.lastUsablePosition = null;
        this.stateUpdate = 'off';
        this.stateUpdateMeta = { state: 'off', reason: 'service_off' };
        this.lastAccuracyBucket = null;
        // A4 — drop any open accuracy-collapse episode on mode change (no
        // recovered event: this is a teardown, not a recovery).
        this._degradedSince = null;
        this._degradedActive = false;
        this._degradedWorstAcc = null;
        this._degradedFixCount = 0;
        this._resetStartupReadiness();

        this.runMode = mode;
        // P1.4 — visible SIMULATION banner so a stale/forgotten simulate mode is never
        // silent (Baptiste's ykvf ran a whole "real GPS" test in simulation unknowingly).
        this._updateSimulationBanner();
        this._forceReacquireCount = 0;
        this._lastForceReacquireTime = 0;
        this.setMap(this.map);
    }

    // P1.4 — show/hide the persistent SIMULATION banner based on runMode.
    _updateSimulationBanner() {
        try {
            var b = document.getElementById('simulation-banner');
            if (b) b.style.display = (this.runMode === 'simulate') ? 'block' : 'none';
        } catch (e) {}
    }

    ready() {
        this.checkPosition()
        return !this.initializing;
    }

    alive(timeout=5000) {
        let freshnessTime = this.lastUsableFixTime != null ? this.lastUsableFixTime : this.lastTimeUpdate;
        if (!freshnessTime) return false;
        return (Date.now() - freshnessTime) < timeout;
    }

    // Start simulated geoloc
    simulateGeoloc(pos=null) {
        this.init('simulate');
        console.log('>> Mode Simulation basée sur le déplacement de la carte !');
        this.fakeUpdate(pos);
    }

    // showSystemSettings()
    showLocationSettings() {
        let bgGeo = getBackgroundGeolocationPlugin()
        if (!bgGeo) {
            console.warn('BackgroundGeolocation is not defined');
            return;
        }
        if (cordova.platformId == 'android') {
            bgGeo.showLocationSettings();
        }
        else if (cordova.platformId == 'ios') {
            // Apple removed support for `prefs:` deep-links to system pages, but
            // openURL: UIApplicationOpenSettingsURLString still opens the app's own
            // Settings page (Réglages > Flanerie) where Position can be toggled.
            bgGeo.showAppSettings();
        }
    }

    // showAppSettings()
    showAppSettings() {
        let bgGeo = getBackgroundGeolocationPlugin()
        if (bgGeo) {
            bgGeo.showAppSettings();
            return;
        }
        // Fallback: call native method directly via Cordova bridge if the plugin
        // global is unreachable (can happen if document.write() was used to load
        // the app HTML without re-running cordova.js).
        if (typeof cordova !== 'undefined' && cordova.exec) {
            console.warn('BackgroundGeolocation global missing — calling showAppSettings via cordova.exec');
            cordova.exec(null, null, 'BackgroundGeolocation', 'showAppSettings', []);
            return;
        }
        console.warn('BackgroundGeolocation is not defined and cordova.exec unavailable');
    }

    // Check if geoloc is enabled
    checkEnabled() {
        return new Promise((resolve, reject) => {
            let bgGeo = getBackgroundGeolocationPlugin()
            if (!bgGeo) {
                console.warn('BackgroundGeolocation is not defined');
                resolve('BackgroundGeolocation is not defined');
                return;
            }
            bgGeo.checkStatus(function(status) {
                if (status.locationServicesEnabled) resolve();
                else reject('gps-no-location');
            });
        });
    }

    // Android only: BACKGROUND_LOCATION is granted only when the user picks
    // "Allow all the time". The bg-geo plugin's checkStatus reports AUTHORIZED
    // based on FINE/COARSE alone, so we verify the background tier here.
    checkBackgroundLocationAndroid() {
        return new Promise((resolve, reject) => {
            if (typeof cordova === 'undefined' || cordova.platformId !== 'android') return resolve()
            if (!cordova.plugins || !cordova.plugins.permissions) return resolve()
            if (typeof device === 'undefined') return resolve()
            let apiLevel = parseInt(device.version.split('.')[0], 10)
            if (isNaN(apiLevel) || apiLevel < 10) return resolve() // < Android 10: BG permission does not exist
            let perms = cordova.plugins.permissions
            if (!perms.ACCESS_BACKGROUND_LOCATION) return resolve() // plugin too old: skip silently
            perms.checkPermission(perms.ACCESS_BACKGROUND_LOCATION,
                (s) => s.hasPermission ? resolve() : reject('android-bg-location-denied'),
                (e) => { console.warn('[GEO] checkPermission(BG_LOCATION) failed:', e); resolve() }
            )
        })
    }

    // Best-effort one-shot health check: returns the bg-geo status snapshot
    // and the Android background-location verdict so callers can branch on
    // services/auth/bgloc independently.
    checkHealth() {
        return new Promise((resolve) => {
            let out = { servicesEnabled: null, authorization: null, bgLocationOk: null }
            let bgGeo = getBackgroundGeolocationPlugin()
            if (!bgGeo) return resolve(out)
            bgGeo.checkStatus((status) => {
                out.servicesEnabled = !!status.locationServicesEnabled
                out.authorization = status.authorization
                this.checkBackgroundLocationAndroid()
                    .then(() => { out.bgLocationOk = true; resolve(out) })
                    .catch(() => { out.bgLocationOk = false; resolve(out) })
            })
        })
    }

    // Check auth
    checkAuthorized() {
        return new Promise((resolve, reject) => {
            let bgGeo = getBackgroundGeolocationPlugin()
            if (!bgGeo) {
                console.warn('BackgroundGeolocation is not defined');
                resolve();
                return;
            }
            bgGeo.checkStatus(function(status) {
                if (status.authorization == bgGeo.AUTHORIZED) {
                    console.log('[INFO] BackgroundGeolocation auth is OK: ' + status.authorization);
                    return resolve()
                }

                if (status.authorization == bgGeo.AUTHORIZED_FOREGROUND) {
                    console.warn('[WARNING] BackgroundGeolocation auth is partial: ' + status.authorization);
                    return reject('gps-error-authorization')
                }
                
                console.error('[ERROR] BackgroundGeolocation wrong auth status: ' + status.authorization);
                return reject('gps-no-authorization')
            });
        });
    }

    // Start real geoloc — idempotent. Safe to call from confirmgeo as soon as
    // permissions are granted AND again from startgeo without re-initialising
    // the state machine (which would clear lastTimeUpdate / lastPosition and
    // briefly flip GEO.ready() back to false). backgroundGeoloc()'s checkStatus
    // path already short-circuits when the native service is running, and the
    // bg-geo plugin's listeners are guarded by backgroundGeolocSetup.
    startGeoloc() {

        return new Promise((resolve, reject) => {
            // Idempotency: only re-init the JS state machine when not already in
            // 'gps' mode. Round 22 — hoist bgGeo.start() into confirmgeo to buy
            // back the onboarding pages' worth of GPS warmup time on first runs.
            if (this.runMode !== 'gps') this.init('gps');

            // test if BackgroundGeolocation is available
            if (getBackgroundGeolocationPlugin()) {
                CALIBRATION_TIME = 1;
                return backgroundGeoloc(this._callbackPosition.bind(this), this._callbackError.bind(this))
                        .then(() => { resolve(); })
                        .catch(error => { reject(error); });
            }

            // use classic navigator geolocation
            else {
                // Idempotency in the navigator fallback path: an existing
                // watchPosition is left alone so we don't double-register.
                if (this.watchId) { resolve(); return }
                console.warn('BackgroundGeolocation is not available, TESTING classic navigator geolocation');
                return this.testGPS().then(() => {
                    console.log('classic GEO TEST OK, starting navigator geolocation');
                    this.watchId = navigator.geolocation.watchPosition(
                        position => this._callbackPosition(position, {source: 'navigator', visibility: APP_VISIBILITY}),
                        this._callbackError.bind(this),
                        {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0,
                        }
                    );
                    resolve();
                })
                .catch(error => {
                    reject(error);
                });
            }

        });

   }

    // Stop real geoloc — used at walk end (and at the info.cutoff timeout) so
    // the native foreground location service (Android) / location updates
    // (iOS) don't keep running and draining battery after the parcours.
    // Sets backgroundGeolocIntentionalStop first so the on('stop') handler
    // does not auto-restart the service.
    stopGeoloc() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        let bgGeo = getBackgroundGeolocationPlugin()
        if (bgGeo) {
            backgroundGeolocIntentionalStop = true;
            try { bgGeo.stop(); }
            catch (e) { console.warn('[GEO] stopGeoloc failed:', e); }
        }
        this.runMode = 'off';
        this._updateSimulationBanner();
    }

    checkPosition() {
        return checkBGPosition()
    }

    // iOS — manual fallback to (re-)trigger the Motion & Fitness prompt.
    // The PRIMARY motion request happens natively in MAURRawLocationProvider.onStart,
    // alongside the Location request, during bgGeo.start() (see startGeoloc). This
    // bridge is only the fallback used by checkmotion's "J'ai autorisé" retry button
    // and the resume-from-Settings re-arm. No-op off iOS or when the plugin build
    // predates the startMotionUpdates bridge method.
    startMotionUpdates() {
        let bgGeo = getBackgroundGeolocationPlugin()
        if (!bgGeo || typeof bgGeo.startMotionUpdates !== 'function') return Promise.resolve(null)
        // Resolves with the native diagnostic dict {authStatus, appState,
        // activityAvailable, pendingUntilActive} (v2.14.5+) or null on older builds /
        // failure. checkmotion logs it so the Motion-auth hang is observable.
        return new Promise((resolve) => {
            bgGeo.startMotionUpdates((info) => resolve(info || {}), () => resolve(null))
        })
    }

    // iOS (D3) — force a CLLocationManager stop/restart. Used after the onboarding
    // "Always" Settings round-trip: iOS does NOT auto-resume startUpdatingLocation
    // when the authorization changes while the app is backgrounded, so the live
    // 'location' stream stays dead on return and the rdv page hangs on
    // "En attente du GPS". Restarting the manager resumes delivery under the new
    // permission. No-op off iOS / when the plugin lacks the bridge method.
    forceReacquire() {
        let bgGeo = getBackgroundGeolocationPlugin()
        if (!bgGeo || typeof bgGeo.forceReacquire !== 'function') return Promise.resolve(false)
        return new Promise((resolve) => {
            bgGeo.forceReacquire(() => resolve(true), () => resolve(false))
        })
    }

    // Thin wrapper around _activeFix for the proactive call sites
    // (startgeo-prime, rdv-warmup). Pass {source: '<call-site>'} to tag the
    // gps_active_fix_ok / gps_active_fix_fail telemetry. Default timeout 10 s.
    warmupPosition(options = {}) {
        return this._activeFix(options.source || 'warmup', options)
    }

    usablePosition() {
        return this.lastUsablePosition || this.lastPosition || this.fakePosition();
    }

    position() {
        return this.lastPosition || this.fakePosition();
    }

    distance(pos) {
        return geo_distance(this.position(), pos);
    }

    followMe() {
        if (this.map) {
            this.map.flyTo(geo_coords(this.position()), document.MAP.getZoom())
            this.map.once('moveend', () => {
                this.follow = true;
            });
        }
    }
}

var backgroundGeolocSetup = false;
var backgroundGeolocResolve = null;
var backgroundGeolocReject = null;
var backgroundGeolocIntentionalStop = false;
// Resolves once the native configure: has FULLY applied (locationProvider=RAW set +
// persisted). start() must wait on this — see the fresh-install race note in
// prepareBackgroundGeoloc() below.
var backgroundGeolocConfigured = null;

let initialBackgroundGeolocation = getBackgroundGeolocationPlugin()
if (initialBackgroundGeolocation) {
    console.log('[INFO] BackgroundGeolocation is available');
    initialBackgroundGeolocation.removeAllListeners();
    initialBackgroundGeolocation.checkStatus(function(status) {
        if (status.isRunning) {
            console.log('[INFO] BackgroundGeolocation service is running, stop it');
            backgroundGeolocIntentionalStop = true;
            initialBackgroundGeolocation.stop();
        }
    });
}

function prepareBackgroundGeoloc(positionCallback, errorCallback) 
{
    let bgGeo = getBackgroundGeolocationPlugin()
    if (!bgGeo) {
        console.error('BackgroundGeolocation is not defined');
        return false;
    }

    if (backgroundGeolocSetup) {
        console.log('[INFO] BackgroundGeolocation is already setup');
        // configure() already applied & persisted on a previous setup — nothing to await.
        if (!backgroundGeolocConfigured) backgroundGeolocConfigured = Promise.resolve();
    }
    else {
        console.log('[INFO] Setting up BackgroundGeolocation');

        // CRITICAL: configure() must FULLY COMPLETE before start() is called.
        // Native configure: (background thread) and start: (main thread) share an
        // unsynchronised _config ivar. On a FRESH install there is no persisted config,
        // so if start: reads _config before configure: has set it, it falls back to the
        // DEFAULT (locationProvider = DISTANCE_FILTER), starts MAURDistanceFilterLocationProvider
        // instead of MAURRawLocationProvider, and the Motion & Fitness prompt — requested only
        // in MAURRawLocationProvider.onStart — never fires. A kill+restart "fixes" it only
        // because the RAW config is persisted by then. Awaiting the configure() callback
        // (fires after the native configure: action persists RAW) closes the race.
        backgroundGeolocConfigured = new Promise(function(resolve) {
            bgGeo.configure({
                locationProvider: bgGeo.RAW_PROVIDER,
                desiredAccuracy: bgGeo.HIGH_ACCURACY,
                stationaryRadius: 0.01,
                distanceFilter: 0,
                pauseLocationUpdates: false,
                saveBatteryOnBackground: false,
                stopOnTerminate: false,
                startForeground: true,
                notificationTitle: 'Flanerie',
                notificationText: 'localisation en cours',
                debug: false,
                interval: 1000,
                fastestInterval: 1000,
                activitiesInterval: 1000,
                activityType: 'OtherNavigation',
            },
            function() {
                console.log('[INFO] BackgroundGeolocation configured (locationProvider=RAW applied)');
                resolve();
            },
            function(err) {
                console.error('[ERROR] BackgroundGeolocation configure failed:', err);
                resolve(); // proceed anyway — start: will at least read the persisted/default config
            });
        });
    }

    bgGeo.removeAllListeners();

    bgGeo.on('location', function(location) {
        console.log('[INFO] BackgroundGeolocation location: ', JSON.stringify(location));

        // handle your locations here
        // to perform long running operation on iOS
        // you need to create background task
        bgGeo.startTask(function(taskKey) {
            var position = {
                simulate: false,
                timestamp: location.time,
                coords: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy: location.accuracy,
                    speed: location.speed,
                }
            }
            runWithGeoBackgroundTask(taskKey, 'location', {
                acc: location.accuracy,
                lat: location.latitude,
                lng: location.longitude,
            }, function() {
                // F-G4: native keepalive ticks set is_keepalive=true so JS correctly skips
                //        updating lastRealCallbackTime and the B4 forceReacquire watchdog fires.
                // v2.9.0 Architecture D: dispatch_source='fused' tags Fused-fallback fixes
                //        (parallel FLP stream filling Raw stalls). Treated as a real callback
                //        but tagged separately for post-hoc analysis.
                var src;
                if (location.is_keepalive)                  src = 'keepalive';
                else if (location.dispatch_source === 'fused') src = 'fused';
                else                                        src = 'bg_location';
                positionCallback(position, {source: src, visibility: APP_VISIBILITY});
            });
        });
    });

    bgGeo.on('stationary', function(location) {
        // Stationary is informational — the plugin keeps running with RAW_PROVIDER + stopDetection:false.
        // We emit the position so GPS-lost detection stays satisfied, without stop/start churn.
        console.log('[INFO] BackgroundGeolocation stationary location: ', JSON.stringify(location));
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_stationary', {lat: location.latitude, lng: location.longitude, acc: location.accuracy});

        bgGeo.startTask(function(taskKey) {
            var position = {
                simulate: false,
                timestamp: location.time,
                coords: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy: location.accuracy,
                    speed: location.speed,
                }
            }
            runWithGeoBackgroundTask(taskKey, 'stationary', {
                acc: location.accuracy,
                lat: location.latitude,
                lng: location.longitude,
            }, function() {
                var src;
                if (location.is_keepalive)                  src = 'keepalive';
                else if (location.dispatch_source === 'fused') src = 'fused';
                else                                        src = 'bg_stationary';
                positionCallback(position, {source: src, visibility: APP_VISIBILITY});
            });
        });
    });

    bgGeo.on('stop', function() {
        console.log('[INFO] BackgroundGeolocation service has been stopped');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_stop', {intentional: backgroundGeolocIntentionalStop});

        // Re-emit so the UI can count repeated unexpected stops (OEM kill heuristic).
        if (typeof GEO !== 'undefined') GEO.emit('bgServiceStop', {intentional: backgroundGeolocIntentionalStop});

        // Only restart if the stop was not intentional (e.g. OS killed the service)
        if (!backgroundGeolocIntentionalStop) {
            console.log('[INFO] Unexpected stop — restarting BackgroundGeolocation');
            bgGeo.start();
        }
        backgroundGeolocIntentionalStop = false;
    });


    bgGeo.on('error', function(error) {
        console.log('[ERROR] BackgroundGeolocation error:', error.code, error.message);
        if (backgroundGeolocReject) {
            backgroundGeolocReject(error);
            backgroundGeolocReject = null;
            backgroundGeolocResolve = null;
        } else {
            errorCallback(error);
        }
    });

    bgGeo.on('start', function() {
        console.log('[INFO] BackgroundGeolocation service has been started');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_start', {});

        // iOS sends the 'start' event the instant requestAlwaysAuthorization() is
        // *called* (CDVBackgroundGeolocation.m), i.e. BEFORE the user taps the
        // permission dialog — so checkStatus here reports NOT_DETERMINED. The old
        // code fired a blind 200 ms reject, which bounced the WebView back to
        // confirmgeo behind the still-visible dialog (the "flash" of the Always
        // screen) and made the user's actual choice irrelevant. Instead, poll
        // checkStatus until the authorization is definitive (the user has tapped),
        // then settle the startGeoloc promise on the real decision.
        var tries = 0;
        var MAX_TRIES = 60; // ~30 s at 500 ms — generous time to read + tap
        (function settleAuth() {
            bgGeo.checkStatus(function(status) {
                if (status.authorization === bgGeo.AUTHORIZED) {
                    if (backgroundGeolocResolve) {
                        console.log('[INFO] BackgroundGeolocation service is running (authorized)');
                        backgroundGeolocResolve();
                        backgroundGeolocResolve = null;
                        backgroundGeolocReject = null;
                    }
                }
                else if (status.authorization === bgGeo.AUTHORIZED_FOREGROUND ||
                         status.authorization === bgGeo.NOT_AUTHORIZED) {
                    // Definitive non-Always decision (While-Using or Denied).
                    if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-error-authorization');
                        backgroundGeolocReject = null;
                        backgroundGeolocResolve = null;
                    }
                }
                else {
                    // NOT_DETERMINED — user still deciding. Keep polling.
                    if (++tries < MAX_TRIES) {
                        setTimeout(settleAuth, 500);
                    } else if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-error-authorization');
                        backgroundGeolocReject = null;
                        backgroundGeolocResolve = null;
                    }
                }
            });
        })();
    });

    bgGeo.on('authorization', function(status) {
        console.log('[INFO] BackgroundGeolocation authorization status: ' + status);
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_authorization', {status: status});

        if (status !== bgGeo.AUTHORIZED) {
            console.warn('[WARN] BackgroundGeolocation not fully authorized, status:', status);
            // Emit non-blocking event — the UI layer (pages.js) can respond without freezing GPS
            if (typeof GEO !== 'undefined') GEO.emit('authorizationChanged', status);
        }
    });

    bgGeo.on('background', function() {
        console.log('[INFO] App is in background');
        APP_VISIBILITY = 'background';
        // F-G2 — dedup with the document.pause/visibilitychange bridge below.
        if (GEO._lastLoggedVisibility !== 'background' && typeof TELEMETRY !== 'undefined') {
            GEO._lastLoggedVisibility = 'background';
            TELEMETRY.log('app_visibility', {state: 'background', source: 'bg-geo'});
        }

        // triggers document pause event
        document.dispatchEvent(new Event('pause'));
    });

    bgGeo.on('foreground', function() {
        console.log('[INFO] App is in foreground');
        APP_VISIBILITY = 'foreground';
        resumeAudioContext('foreground');
        if (GEO._lastLoggedVisibility !== 'foreground' && typeof TELEMETRY !== 'undefined') {
            GEO._lastLoggedVisibility = 'foreground';
            TELEMETRY.log('app_visibility', {state: 'foreground', source: 'bg-geo'});
        }

        // triggers document resume event
        document.dispatchEvent(new Event('resume'));
    });

    bgGeo.on('activity', function(activity) {
        if (!GEO.motionAuthorized) {
            GEO.motionAuthorized = true;
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_authorized', {type: activity.type});
        }
        GEO.motionIsStationary = (activity.type === 'STILL');
        if (typeof TELEMETRY !== 'undefined')
            TELEMETRY.log('motion_activity', {type: activity.type, confidence: activity.confidence});
    });

    // R23 / BG-11 (iOS, v2.10.0): rail of CLCircularRegion wake-ups. Pure
    // telemetry — the native side already restarted CLLocationManager if it
    // had stalled >30 s. Step-triggering remains owned by the fine-grained
    // JS polygon check; this event never starts audio. The payload carries
    // last_real_callback_age_ms + did_force_reacquire so post-hoc analysis
    // can quantify how often the rail saved us during an iOS-26-class GPS
    // blackout.
    bgGeo.on('region_wake', function(payload) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_rail_wake', payload || {});
    });

    // BG-11 (iOS): CLLocationManager rejected a rail region post-registration.
    // gps_rail_configured.region_count is reported synchronously from native
    // (count of regions submitted to startMonitoringForRegion:), but the OS
    // can still reject individual regions asynchronously — exceeding the
    // 20-region cap, entitlements revoked, etc. This event makes the
    // configured-vs-rejected gap auditable in post-hoc analysis.
    bgGeo.on('region_monitor_fail', function(payload) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_rail_monitor_fail', payload || {});
    });

    // R26 / BG-12 (iOS, v2.11.0): CLVisit fired. iOS infers the user has
    // stopped at a place; we log it as gps_visit_event for telemetry only.
    // Decision 5 Option B (Workstream L in mobile-audit.md) — measuring whether visit
    // detection correlates with step dwell time before considering it as a
    // step-confirm signal. Pairs naturally with E1/E2/E3 zone-overshoot
    // calibration from VILLEURBANNE field data.
    bgGeo.on('visit', function(payload) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_visit_event', payload || {});
    });

    if (!backgroundGeolocSetup) {
        // F-G2 — bridge document.pause/resume + visibilitychange into
        // app_visibility telemetry. Today the only emitter is bgGeo's
        // background/foreground callbacks, which iOS bg-geo never surfaces
        // (mobile-audit R3 finding: zero app_visibility events on iOS in the
        // 2026-05-15 test). This bridge closes that blind spot. Dedup against
        // _lastLoggedVisibility so Android (which gets both bg-geo and document
        // events) only logs once per transition.
        function _logVisibility(state, source) {
            if (typeof TELEMETRY === 'undefined') return;
            if (GEO._lastLoggedVisibility === state) return;
            GEO._lastLoggedVisibility = state;
            TELEMETRY.log('app_visibility', { state: state, source: source });
        }

        document.addEventListener('pause', function() {
            console.log('[INFO] App is paused');
            APP_VISIBILITY = 'background';
            _logVisibility('background', 'cordova-pause');
        }, false);

        document.addEventListener('resume', function() {
            console.log('[INFO] App is resumed');
            APP_VISIBILITY = 'foreground';
            _logVisibility('foreground', 'cordova-resume');
            resumeAudioContext('resume');
            // iOS backgrounding is not an audio interruption. Let the native
            // AVAudioSession interruption callback drive pause/resume there.
            if (PLATFORM !== 'ios' && typeof requestAudioFocus === 'function') {
                requestAudioFocus().catch(function(e) { console.warn('[AudioFocus] re-request on resume failed:', e); });
            }
        }, false);

        // Secondary signal: the web standard visibilitychange. Fires on tab
        // switches, lock-screen on some Android WebViews, etc. Mostly redundant
        // with pause/resume on Cordova but catches the edge cases iOS WebKit
        // doesn't translate into pause.
        document.addEventListener('visibilitychange', function() {
            var state = document.visibilityState === 'hidden' ? 'background' : 'foreground';
            APP_VISIBILITY = state;
            _logVisibility(state, 'visibilitychange');
        }, false);
    }

    backgroundGeolocSetup = true;
    return true;
}

function checkBGPosition(options = {}) {
    return new Promise((resolve, reject) => {
        let bgGeo = getBackgroundGeolocationPlugin()
        let timeout = typeof options.timeout === 'number' ? options.timeout : 10000
        let maximumAge = typeof options.maximumAge === 'number' ? options.maximumAge : 0
        let enableHighAccuracy = options.enableHighAccuracy !== false
        if (!bgGeo) {
            console.warn('BackgroundGeolocation is not defined');
            resolve(GEO.lastPosition);
            return;
        }
        bgGeo.getCurrentLocation(
            function(location) {
              // Got a location, now start background tracking
              resolve(location)
            },
            function(error) {
              // If failed, still start tracking
              reject(error)
            },
            { enableHighAccuracy: enableHighAccuracy, timeout: timeout, maximumAge: maximumAge }
          );
    });
}


// On cordova-android 15 / targetSdk 36, BackgroundGeolocation.start() triggers its own
// requestPermissions() call from a non-foreground context, which causes the system dialog
// to appear frozen (visible but unresponsive to touch). Fix: pre-request ACCESS_FINE_LOCATION
// via cordova-plugin-android-permissions (correct Cordova Activity context) before calling
// start(), so the plugin never needs to show its own dialog.
function _geolocRequestPermissionThenStart(status) {
    let bgGeo = getBackgroundGeolocationPlugin()
    if (!bgGeo) {
        if (backgroundGeolocReject) {
            backgroundGeolocReject('BackgroundGeolocation is not defined');
            backgroundGeolocReject = backgroundGeolocResolve = null;
        }
        return
    }

    const alreadyAuthorized = status.authorization === bgGeo.AUTHORIZED ||
                              status.authorization === bgGeo.AUTHORIZED_FOREGROUND;

    if (!alreadyAuthorized &&
        typeof cordova !== 'undefined' &&
        cordova.plugins && cordova.plugins.permissions) {

        const perms = cordova.plugins.permissions;
        perms.requestPermission(
            perms.ACCESS_FINE_LOCATION,
            function(permStatus) {
                if (permStatus.hasPermission) {
                    console.log('[INFO] ACCESS_FINE_LOCATION granted — starting BackgroundGeolocation');
                    bgGeo.start();
                } else {
                    console.error('[ERROR] Location permission denied by user');
                    if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-no-authorization');
                        backgroundGeolocReject = backgroundGeolocResolve = null;
                    }
                }
            },
            function(err) {
                console.error('[ERROR] Permission request failed:', err);
                if (backgroundGeolocReject) {
                    backgroundGeolocReject('gps-no-authorization');
                    backgroundGeolocReject = backgroundGeolocResolve = null;
                }
            }
        );
    } else {
        // Already authorized or permissions plugin not available — start directly
        bgGeo.start();
    }
}

function backgroundGeoloc(positionCallback, errorCallback) {

    return new Promise((resolve, reject) => {

        // check if variable is defined 
        let bgGeo = getBackgroundGeolocationPlugin()
        if (!bgGeo) {
            console.error('BackgroundGeolocation is not defined');
            reject('BackgroundGeolocation is not defined');
            return;
        }

        backgroundGeolocResolve = resolve;
        backgroundGeolocReject = reject;

        prepareBackgroundGeoloc(positionCallback, errorCallback);

        // Wait for native configure: to finish applying RAW_PROVIDER before checkStatus/start,
        // otherwise start: can race ahead with the default DISTANCE_FILTER provider on a fresh
        // install (see prepareBackgroundGeoloc note — this is the iOS Motion-prompt root cause).
        (backgroundGeolocConfigured || Promise.resolve()).then(function() {
        bgGeo.checkStatus(function(status) {
            console.log('[INFO] BackgroundGeolocation service is running', status.isRunning);
            console.log('[INFO] BackgroundGeolocation services enabled', status.locationServicesEnabled);
            console.log('[INFO] BackgroundGeolocation auth status: ' + status.authorization);

            if (!status.locationServicesEnabled) {
                alert('Vous devez activer le GPS pour utiliser cette application !');
                if (backgroundGeolocReject) {
                    backgroundGeolocReject('gps-no-location');
                    backgroundGeolocReject = null;
                    backgroundGeolocResolve = null;
                }
            }
            else if (!status.isRunning) {
                console.log('[INFO] Starting BackgroundGeolocation');
                _geolocRequestPermissionThenStart(status);
            }
            else {
                // Service is running — still verify auth level. AUTHORIZED_FOREGROUND
                // means background GPS dies when the screen locks; we must block just
                // as we do in the on('start') handler. Without this check a pending
                // checkStatus() callback that fires after bgGeo.start() can race the
                // 200 ms reject timer and resolve with only foreground permission.
                if (status.authorization !== bgGeo.AUTHORIZED) {
                    console.warn('[INFO] BackgroundGeolocation running with partial auth:', status.authorization);
                    if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-error-authorization');
                        backgroundGeolocReject = null;
                        backgroundGeolocResolve = null;
                    }
                } else {
                    console.log('[INFO] BackgroundGeolocation already running — listeners updated, resolving');
                    if (backgroundGeolocResolve) {
                        backgroundGeolocResolve();
                        backgroundGeolocResolve = null;
                        backgroundGeolocReject = null;
                    }
                }
            }
        });
        });

    })
}


// Init geoloc
document.GEO = new GeoLoc();
const GEO = document.GEO;