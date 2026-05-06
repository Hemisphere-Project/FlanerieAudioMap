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

    var GPS_INTERVAL = 5000;    // min 5s between GPS logs
    var FLUSH_INTERVAL = 30000; // flush every 30s
    var BUFFER_CAP = 500;
    var STORAGE_KEY = 'telemetry_session';
    var RESUME_MAX_AGE = 4 * 60 * 60 * 1000;
    var SCHEMA_VERSION = 1;

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

    function _buildSessionMeta() {
        var meta = {
            platform: (typeof PLATFORM !== 'undefined' && PLATFORM) ? PLATFORM : ((navigator && navigator.platform) || 'unknown'),
            language: (navigator && navigator.language) ? navigator.language : null,
            userAgent: (navigator && navigator.userAgent) ? navigator.userAgent : null,
            isCordova: typeof cordova !== 'undefined'
        };

        if (typeof cordova !== 'undefined' && cordova.version) meta.cordovaVersion = cordova.version;
        if (typeof window !== 'undefined' && window.APP_VERSION) meta.appVersion = window.APP_VERSION;
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
                _writeStored();
                _log(sessionHasFlushed ? 'session_resume' : 'session_start', {
                    parcoursId: parcoursId,
                    parcoursName: parcoursName
                });
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
            _writeStored();
            _log('session_start', {parcoursId: parcoursId, parcoursName: parcoursName});
            _startFlushTimer();
            console.log('[TELEMETRY] Started session', sessionId);
        } catch(e) { console.warn('[TELEMETRY] start error', e); }
    }

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

    function _startFlushTimer() {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = setInterval(flush, FLUSH_INTERVAL);
    }

    function _log(type, data) {
        if (!sessionId) { console.warn('[TELEMETRY] _log skipped, no sessionId'); return; }
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

    function gps(position) {
        try {
            var now = Date.now();
            if (now - lastGpsTime < GPS_INTERVAL) return;
            lastGpsTime = now;
            _log('gps', {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                acc: Math.round(position.coords.accuracy),
                spd: position.coords.speed
            });
        } catch(e) { console.warn('[TELEMETRY] gps error', e); }
    }

    function flush() {
        try {
            if (typeof PLATFORM !== 'undefined' && PLATFORM === 'browser') {
                console.log('[TELEMETRY] flush skipped: browser mode');
                return;
            }
            if (!sessionId || buffer.length === 0) {
                console.log('[TELEMETRY] flush skipped: sessionId=' + sessionId + ' buffer=' + buffer.length);
                return;
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
            _postTelemetry(url, payload).then(function(response) {
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
            }).catch(function(e) {
                buffer = events.concat(buffer);
                if (buffer.length > BUFFER_CAP) buffer = buffer.slice(-BUFFER_CAP);
                console.warn('[TELEMETRY] flush FAILED:', (e && e.message) ? e.message : String(e));
            });
        } catch(e) { console.warn('[TELEMETRY] flush error', e); }
    }

    function end() {
        try {
            _log('session_end', {});
            if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
            localStorage.removeItem(STORAGE_KEY);
            // Flush synchronously via sendBeacon if available, else async
            _flushFinal();
            console.log('[TELEMETRY] Ended session', sessionId);
            sessionId = null;
        } catch(e) { console.warn('[TELEMETRY] end error', e); }
    }

    // Best-effort flush for page unload / session end
    function _flushFinal() {
        if (typeof PLATFORM !== 'undefined' && PLATFORM === 'browser') return;
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
        restart: restart,
        log: log,
        gps: gps,
        flush: flush,
        end: end
    };

})();
