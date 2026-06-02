// Telemetry — lightweight event logger for walk sessions
// Buffers events client-side, flushes to server periodically.
// Recovers session after app crash via localStorage.

var TELEMETRY = (function() {

    var sessionId = null;
    var parcoursId = null;
    var parcoursName = null;
    var buffer = [];
    var flushTimer = null;
    var lastGpsTime = 0;
    var sessionStartedAt = null;
    var sessionHasFlushed = false;
    var sessionMeta = null;
    var gpsSummary = null;

    // Events logged before any session exists (cold-start onboarding, before the
    // onboarding/walk session is opened). Stashed here rather than dropped, then
    // replayed into the live buffer on the next start(). See _log / _drainPre.
    var preSessionBuffer = [];

    var GPS_INTERVAL = 5000;    // min 5s between GPS logs
    var FLUSH_INTERVAL = 30000; // flush every 30s
    var BUFFER_CAP = 500;
    var PRE_BUFFER_CAP = 120;   // cap for pre-session stash (onboarding burst)
    var STORAGE_KEY = 'telemetry_session';
    var RESUME_MAX_AGE = 4 * 60 * 60 * 1000;
    var SCHEMA_VERSION = 2;

    function _resetGpsSummary() {
        return {
            startedAt: Date.now(),
            samples: 0,
            rejectedSamples: 0,
            backgroundSamples: 0,
            heartbeatSamples: 0,
            stationarySamples: 0,
            freshSamples: 0,
            staleSamples: 0,
            startupGradeSamples: 0,
            bucketCounts: {
                excellent: 0,
                good: 0,
                fair: 0,
                poor: 0,
                bad: 0,
                unknown: 0
            },
            minAcc: null,
            maxAcc: null,
            lastAcc: null,
            lastSource: null,
            minGapMs: null,
            maxGapMs: null,
            totalGapMs: 0,
            gapSamples: 0,
            maxAgeMs: null,
            totalAgeMs: 0,
            ageSamples: 0
        };
    }

    function _accuracyBucket(acc) {
        if (typeof acc !== 'number' || isNaN(acc)) return 'unknown';
        if (acc <= 10) return 'excellent';
        if (acc <= 20) return 'good';
        if (acc <= 40) return 'fair';
        if (acc <= 80) return 'poor';
        return 'bad';
    }

    function _recordGpsSample(data) {
        if (!gpsSummary) gpsSummary = _resetGpsSummary();

        gpsSummary.samples += 1;
        if (data.rejected) gpsSummary.rejectedSamples += 1;
        if (data.visibility === 'background') gpsSummary.backgroundSamples += 1;
        if (data.source === 'heartbeat') gpsSummary.heartbeatSamples += 1;
        if (data.source === 'bg_stationary') gpsSummary.stationarySamples += 1;

        var bucket = _accuracyBucket(data.acc);
        if (!(bucket in gpsSummary.bucketCounts)) bucket = 'unknown';
        gpsSummary.bucketCounts[bucket] += 1;

        if (typeof data.acc === 'number' && !isNaN(data.acc)) {
            gpsSummary.minAcc = gpsSummary.minAcc == null ? data.acc : Math.min(gpsSummary.minAcc, data.acc);
            gpsSummary.maxAcc = gpsSummary.maxAcc == null ? data.acc : Math.max(gpsSummary.maxAcc, data.acc);
            gpsSummary.lastAcc = data.acc;
        }

        if (typeof data.callbackGapMs === 'number' && !isNaN(data.callbackGapMs)) {
            gpsSummary.minGapMs = gpsSummary.minGapMs == null ? data.callbackGapMs : Math.min(gpsSummary.minGapMs, data.callbackGapMs);
            gpsSummary.maxGapMs = gpsSummary.maxGapMs == null ? data.callbackGapMs : Math.max(gpsSummary.maxGapMs, data.callbackGapMs);
            gpsSummary.totalGapMs += data.callbackGapMs;
            gpsSummary.gapSamples += 1;
        }

        if (typeof data.ageMs === 'number' && !isNaN(data.ageMs)) {
            if (data.ageMs <= 12000) gpsSummary.freshSamples += 1;
            else gpsSummary.staleSamples += 1;
            gpsSummary.maxAgeMs = gpsSummary.maxAgeMs == null ? data.ageMs : Math.max(gpsSummary.maxAgeMs, data.ageMs);
            gpsSummary.totalAgeMs += data.ageMs;
            gpsSummary.ageSamples += 1;
        }

        if (typeof data.acc === 'number' && !isNaN(data.acc) &&
            typeof data.ageMs === 'number' && !isNaN(data.ageMs) &&
            data.acc <= 10 && data.ageMs <= 12000) {
            gpsSummary.startupGradeSamples += 1;
        }

        gpsSummary.lastSource = data.source || gpsSummary.lastSource;
    }

    function _flushGpsSummary(reason) {
        if (!sessionId || !gpsSummary || gpsSummary.samples === 0) return;

        var summary = gpsSummary;
        gpsSummary = _resetGpsSummary();

        _log('gps_quality_summary', {
            reason: reason || 'interval',
            windowMs: Date.now() - summary.startedAt,
            samples: summary.samples,
            rejectedSamples: summary.rejectedSamples,
            backgroundSamples: summary.backgroundSamples,
            heartbeatSamples: summary.heartbeatSamples,
            stationarySamples: summary.stationarySamples,
            freshSamples: summary.freshSamples,
            staleSamples: summary.staleSamples,
            startupGradeSamples: summary.startupGradeSamples,
            accuracyBuckets: summary.bucketCounts,
            minAcc: summary.minAcc,
            maxAcc: summary.maxAcc,
            lastAcc: summary.lastAcc,
            avgGapMs: summary.gapSamples ? Math.round(summary.totalGapMs / summary.gapSamples) : null,
            minGapMs: summary.minGapMs,
            maxGapMs: summary.maxGapMs,
            avgAgeMs: summary.ageSamples ? Math.round(summary.totalAgeMs / summary.ageSamples) : null,
            maxAgeMs: summary.maxAgeMs,
            lastSource: summary.lastSource
        });
    }

    function _readStored() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            return JSON.parse(stored);
        } catch (e) {
            console.warn('[TELEMETRY] invalid stored session, resetting', e);
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }
    }

    function _parseSessionTime(id) {
        if (!id || typeof id !== 'string') return null;
        var m = id.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
        if (!m) return null;
        return new Date(
            Number(m[1]),
            Number(m[2]) - 1,
            Number(m[3]),
            Number(m[4]),
            Number(m[5]),
            Number(m[6])
        ).getTime();
    }

    function _writeStored() {
        if (!sessionId) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            sessionId: sessionId,
            parcoursId: parcoursId,
            parcoursName: parcoursName,
            startedAt: sessionStartedAt,
            updatedAt: Date.now(),
            hasFlushed: sessionHasFlushed,
            schemaVersion: SCHEMA_VERSION
        }));
    }

    // A5 — persistent device identity. UUID is generated once per app install and
    // never rotated; lets analyze.mjs tell "Xiaomi 2201117TY used twice" apart
    // from "two different visitors' phones that share a model number" (GIVORS
    // 2026-05-20 ffqz/avm3 case). is_loan is an operator-toggled flag (devmode
    // tools page) that distinguishes the rental fleet from BYOD visitors.
    function _getDeviceUuid() {
        try {
            var existing = localStorage.getItem('device_uuid');
            if (existing) return existing;
        } catch (e) {}
        var uuid = '';
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                uuid = window.crypto.randomUUID();
            }
        } catch (e) {}
        if (!uuid) {
            // RFC4122-v4-shaped fallback for environments without crypto.randomUUID
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }
        try { localStorage.setItem('device_uuid', uuid); } catch (e) {}
        return uuid;
    }

    function _isLoanDevice() {
        try { return localStorage.getItem('is_loan_device') === 'true'; } catch (e) { return false; }
    }

    function _setLoanDevice(value) {
        try { localStorage.setItem('is_loan_device', value ? 'true' : 'false'); } catch (e) {}
    }

    function _buildSessionMeta() {
        var meta = {
            platform: (typeof PLATFORM !== 'undefined' && PLATFORM) ? PLATFORM : ((navigator && navigator.platform) || 'unknown'),
            language: (navigator && navigator.language) ? navigator.language : null,
            userAgent: (navigator && navigator.userAgent) ? navigator.userAgent : null,
            isCordova: typeof cordova !== 'undefined',
            deviceUuid: _getDeviceUuid(),
            isLoanDevice: _isLoanDevice()
        };

        if (typeof cordova !== 'undefined' && cordova.version) meta.cordovaVersion = cordova.version;
        if (typeof window !== 'undefined' && window.APP_VERSION) meta.appVersion = window.APP_VERSION;
        // Build provenance on every session's client meta (small, session-level):
        //   appVersion   — apk build number (document.APPVERSION, set by the launcher)
        //   webappCommit — running webapp commit (window.BUILD_COMMIT, baked into the zip)
        // so any session — including onboarding-only ones with no session_diag — is
        // matchable to an exact apk build + webapp push. Plugin versions are heavier and
        // logged once per session in session_diag / the checkgeo onboarding_page event.
        if (typeof document !== 'undefined' && document.APPVERSION && document.APPVERSION !== '0') {
            meta.appVersion = document.APPVERSION;
        }
        if (typeof window !== 'undefined' && window.BUILD_COMMIT) meta.webappCommit = window.BUILD_COMMIT;
        if (typeof window !== 'undefined' && window.BUILD_TIME) meta.webappBuiltAt = window.BUILD_TIME;
        if (typeof device !== 'undefined') {
            if (device.model) meta.deviceModel = device.model;
            if (device.version) meta.osVersion = device.version;
            if (device.platform) meta.devicePlatform = device.platform;
            if (device.manufacturer) meta.deviceManufacturer = device.manufacturer;
            if (typeof device.isVirtual !== 'undefined') meta.isVirtualDevice = device.isVirtual;
        }

        Object.keys(meta).forEach(function(key) {
            if (meta[key] == null) delete meta[key];
        });

        return meta;
    }

    function _postTelemetry(url, payload) {
        var hasNativeFetch = typeof fetch === 'function';
        var transport = hasNativeFetch ? fetch : fetchRemote;
        console.log('[TELEMETRY] transport:', hasNativeFetch ? 'fetch' : 'fetchRemote');
        return transport(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
    }

    function _generateId() {
        var now = new Date();
        var d = now.toISOString().slice(0,10).replace(/-/g, '');
        var t = now.toTimeString().slice(0,8).replace(/:/g, '');
        var r = Math.random().toString(36).substring(2, 6);
        return d + '_' + t + '_' + r;
    }

    function start(pId, pName, options) {
        try {
            options = options || {};
            // options.extra (object): merged into the session_start/resume payload.
            // Used by the parcours page to attach restored state (resume_seek_pos,
            // step_index, lost) so a single session_resume event is enough to know
            // whether the kill+relaunch round-trip preserved playback position.
            // Field test 2026-05-18: without this, validating P3.5 on iOS required
            // cross-referencing across multiple event types.
            var extra = (options.extra && typeof options.extra === 'object') ? options.extra : null;
            var now = Date.now();
            var stableParcoursId = pId || pName || '';
            var stableParcoursName = pName || pId || '';
            var stored = _readStored();
            var storedStartedAt = stored && (stored.startedAt || _parseSessionTime(stored.sessionId));
            var canResume = !!(
                !options.forceNew &&
                stored &&
                stored.sessionId &&
                stored.parcoursId === stableParcoursId &&
                storedStartedAt &&
                (now - storedStartedAt) <= RESUME_MAX_AGE
            );

            if (canResume) {
                sessionId = stored.sessionId;
                parcoursId = stableParcoursId;
                parcoursName = stableParcoursName;
                sessionStartedAt = storedStartedAt;
                sessionHasFlushed = !!stored.hasFlushed;
                sessionMeta = _buildSessionMeta();
                buffer = [];
                _drainPre();
                gpsSummary = _resetGpsSummary();
                lastGpsTime = 0;
                _writeStored();
                var resumePayload = {
                    parcoursId: parcoursId,
                    parcoursName: parcoursName
                };
                if (extra) Object.keys(extra).forEach(function(k) { resumePayload[k] = extra[k]; });
                _log(sessionHasFlushed ? 'session_resume' : 'session_start', resumePayload);
                _startFlushTimer();
                console.log('[TELEMETRY] Resumed session', sessionId);
                return;
            }

            sessionId = _generateId();
            parcoursId = stableParcoursId;
            parcoursName = stableParcoursName;
            sessionStartedAt = now;
            sessionHasFlushed = false;
            sessionMeta = _buildSessionMeta();
            buffer = [];
            _drainPre();
            gpsSummary = _resetGpsSummary();
            lastGpsTime = 0;
            _writeStored();
            var startPayload = {parcoursId: parcoursId, parcoursName: parcoursName};
            // F-R1 — derive idle window from the last persisted session_end ts.
            try {
                var lastEnd = parseInt(localStorage.getItem('last_session_end_ts') || '0', 10);
                if (Number.isFinite(lastEnd) && lastEnd > 0) {
                    startPayload.inter_session_idle_ms = Math.max(0, now - lastEnd);
                }
            } catch (e) {}
            if (extra) Object.keys(extra).forEach(function(k) { startPayload[k] = extra[k]; });
            _log('session_start', startPayload);
            _startFlushTimer();
            console.log('[TELEMETRY] Started session', sessionId);
        } catch(e) { console.warn('[TELEMETRY] start error', e); }
    }

    // True once start() has succeeded and a session id exists, false during the
    // pre-init window (notably while parcours.restore() runs at pages.js parse
    // time, before any page calls TELEMETRY.start). Callers in that window must
    // stash and replay rather than _log() into the void.
    function hasSession() { return !!sessionId; }

    function restart(reason, pId, pName) {
        try {
            if (sessionId) {
                _log('session_restart', {reason: reason || 'manual'});
                end();
            }
            start(pId || parcoursId || '', pName || parcoursName || '', {forceNew: true});
            _log('session_restart_target', {reason: reason || 'manual'});
        } catch(e) { console.warn('[TELEMETRY] restart error', e); }
    }

    // Onboarding sessions — opened at the top of the permission gauntlet (checkgeo)
    // so the geo / motion / notification / battery flow is captured and FLUSHED LIVE
    // even when the visitor never reaches the walk page (the iOS Motion-auth hang is
    // exactly that: blocked before the walk session would ever open). Kept as its own
    // session, namespaced 'onb:<pID>', so the walk session stays a clean session_start
    // with the resume_step_index extras the analyzer keys on (common.mjs line 139).
    // endOnboarding() closes it right before the walk session starts.
    function startOnboarding(pId, pName) {
        try {
            pId = pId || '';
            // Don't clobber a resumable WALK session (mid-walk crash resume for this
            // same parcours): the walk page must still be able to resume it. A stored
            // walk session only exists when a walk was interrupted within RESUME_MAX_AGE
            // (end() clears storage on clean finish).
            var stored = _readStored();
            if (stored && stored.parcoursId === pId) {
                var storedStartedAt = stored.startedAt || _parseSessionTime(stored.sessionId);
                if (storedStartedAt && (Date.now() - storedStartedAt) <= RESUME_MAX_AGE) return;
            }
            // Don't clobber a live in-memory walk session either.
            if (sessionId && parcoursId && parcoursId.indexOf('onb:') !== 0) return;
            start('onb:' + pId, pName || pId || '', { extra: { phase: 'onboarding' } });
        } catch(e) { console.warn('[TELEMETRY] startOnboarding error', e); }
    }

    // Close the onboarding session (final flush via end()) just before the walk
    // session opens. No-op unless the live session is an onboarding one, so calling
    // it on a mid-walk resume path (where no onboarding session was opened) is safe.
    function endOnboarding() {
        try {
            if (!sessionId) return;
            if (parcoursId && parcoursId.indexOf('onb:') === 0) {
                end({ skipIdleStamp: true, data: { phase: 'onboarding' } });
            }
        } catch(e) { console.warn('[TELEMETRY] endOnboarding error', e); }
    }

    function _startFlushTimer() {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = setInterval(flush, FLUSH_INTERVAL);
    }

    // Replay any pre-session events captured before this session existed. Their
    // original timestamps are preserved, and they are drained ahead of the
    // session_start event so the analyzer sees the onboarding lead-in in order.
    function _drainPre() {
        if (!preSessionBuffer.length) return;
        var pre = preSessionBuffer;
        preSessionBuffer = [];
        for (var i = 0; i < pre.length; i++) buffer.push(pre[i]);
    }

    function _log(type, data) {
        if (!sessionId) {
            // No session yet — stash (capped) for replay on the next start().
            if (preSessionBuffer.length >= PRE_BUFFER_CAP) preSessionBuffer.shift();
            preSessionBuffer.push({ t: Date.now(), type: type, data: data || {} });
            return;
        }
        if (buffer.length >= BUFFER_CAP) {
            buffer = buffer.slice(Math.floor(BUFFER_CAP * 0.1));
        }
        buffer.push({ t: Date.now(), type: type, data: data || {} });
        _writeStored();
        console.log('[TELEMETRY] buffered event:', type, 'buffer size:', buffer.length);
    }

    function log(type, data) {
        try { _log(type, data); }
        catch(e) { console.warn('[TELEMETRY] log error', e); }
    }

    function gps(position, meta) {
        try {
            var now = Date.now();
            meta = meta || {};

            var data = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                acc: Math.round(position.coords.accuracy),
                spd: position.coords.speed,
                source: meta.source || 'unknown',
                visibility: meta.visibility || 'unknown'
            };

            if (typeof meta.callbackGapMs === 'number') data.callbackGapMs = Math.round(meta.callbackGapMs);
            if (typeof meta.ageMs === 'number') data.ageMs = Math.round(meta.ageMs);
            if (typeof meta.motionStationary === 'boolean') data.motionStationary = meta.motionStationary;
            if (meta.rejected) data.rejected = true;
            if (meta.reason) data.reason = meta.reason;

            _recordGpsSample(data);

            if (now - lastGpsTime < GPS_INTERVAL) return;
            lastGpsTime = now;
            _log('gps', data);
        } catch(e) { console.warn('[TELEMETRY] gps error', e); }
    }

    function flush() {
        try {
            if (typeof PLATFORM !== 'undefined' && PLATFORM === 'browser') {
                console.log('[TELEMETRY] flush skipped: browser mode');
                return Promise.resolve({ ok: false, skipped: true, reason: 'browser-mode' });
            }
            _flushGpsSummary('interval');
            if (!sessionId || buffer.length === 0) {
                console.log('[TELEMETRY] flush skipped: sessionId=' + sessionId + ' buffer=' + buffer.length);
                return Promise.resolve({ ok: false, skipped: true, reason: 'empty-buffer' });
            }
            var events = buffer.splice(0, buffer.length);
            var url = (typeof prep === 'function') ? prep('/telemetry-push') : '/telemetry-push';
            console.log('[TELEMETRY] flushing', events.length, 'events to', url);
            var payload = {
                sessionId: sessionId,
                parcoursId: parcoursId,
                parcoursName: parcoursName,
                schemaVersion: SCHEMA_VERSION,
                client: sessionMeta,
                events: events
            };
            return _postTelemetry(url, payload).then(function(response) {
                console.log('[TELEMETRY] response:', response.status, response.url);
                if (response.status !== 200) {
                    return response.text().then(function(body) {
                        throw new Error('HTTP ' + response.status + ': ' + body.substring(0, 200));
                    });
                }
                return response.text();
            }).then(function(r) {
                sessionHasFlushed = true;
                _writeStored();
                console.log('[TELEMETRY] flush OK:', r);
                return { ok: true, responseText: r };
            }).catch(function(e) {
                buffer = events.concat(buffer);
                if (buffer.length > BUFFER_CAP) buffer = buffer.slice(-BUFFER_CAP);
                console.warn('[TELEMETRY] flush FAILED:', (e && e.message) ? e.message : String(e));
                return { ok: false, skipped: false, error: (e && e.message) ? e.message : String(e) };
            });
        } catch(e) {
            console.warn('[TELEMETRY] flush error', e);
            return Promise.resolve({ ok: false, skipped: false, error: String(e) });
        }
    }

    function end(opts) {
        try {
            opts = opts || {};
            _flushGpsSummary('end');
            _log('session_end', opts.data || {});
            if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
            localStorage.removeItem(STORAGE_KEY);
            // F-R1 — stamp when this session ended so the next session_start can
            // log inter_session_idle_ms. Lets analyze.mjs correlate P7 (silent
            // audio on loan-phone re-arm) with time-since-last-walk: if the
            // failure rate scales with idle minutes, the engine staleness is
            // time-decay rather than state-decay. Skipped when closing an
            // onboarding session so the idle clock measures walk-to-walk gaps,
            // not the few seconds between onboarding end and walk start.
            if (!opts.skipIdleStamp) {
                try { localStorage.setItem('last_session_end_ts', String(Date.now())); } catch (e) {}
            }
            // Flush synchronously via sendBeacon if available, else async
            _flushFinal();
            console.log('[TELEMETRY] Ended session', sessionId);
            sessionId = null;
            gpsSummary = null;
        } catch(e) { console.warn('[TELEMETRY] end error', e); }
    }

    // Best-effort flush for page unload / session end
    function _flushFinal() {
        if (typeof PLATFORM !== 'undefined' && PLATFORM === 'browser') return;
        _flushGpsSummary('final');
        if (!sessionId || buffer.length === 0) return;
        var payload = JSON.stringify({
            sessionId: sessionId,
            parcoursId: parcoursId,
            parcoursName: parcoursName,
            schemaVersion: SCHEMA_VERSION,
            client: sessionMeta,
            events: buffer.splice(0, buffer.length)
        });
        // sendBeacon survives page unload; fall back to async post
        var url = (typeof prep === 'function') ? prep('/telemetry-push') : '/telemetry-push';
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], {type: 'application/json'}));
        } else {
            _postTelemetry(url, JSON.parse(payload)).catch(function() {});
        }
    }

    // Flush on page hide / unload (mobile: visibilitychange is more reliable)
    try {
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden' && sessionId) flush();
        });
        window.addEventListener('beforeunload', function() {
            if (sessionId) _flushFinal();
        });
    } catch(e) { /* non-browser environment */ }

    return {
        start: start,
        startOnboarding: startOnboarding,
        endOnboarding: endOnboarding,
        restart: restart,
        log: log,
        gps: gps,
        flush: flush,
        end: end,
        hasSession: hasSession,
        // A5 — device identity accessors. UUID is read-only (generated lazily on
        // first access). isLoanDevice is settable by the devmode tools page.
        deviceUuid: _getDeviceUuid,
        isLoanDevice: _isLoanDevice,
        setLoanDevice: _setLoanDevice
    };

})();
