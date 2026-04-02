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

    var GPS_INTERVAL = 5000;    // min 5s between GPS logs
    var FLUSH_INTERVAL = 30000; // flush every 30s
    var BUFFER_CAP = 500;
    var STORAGE_KEY = 'telemetry_session';

    function _generateId() {
        var now = new Date();
        var d = now.toISOString().slice(0,10).replace(/-/g, '');
        var t = now.toTimeString().slice(0,8).replace(/:/g, '');
        var r = Math.random().toString(36).substring(2, 6);
        return d + '_' + t + '_' + r;
    }

    function start(pId, pName) {
        try {
            // Try to resume previous session for same parcours
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                stored = JSON.parse(stored);
                if (stored.parcoursId === pId) {
                    sessionId = stored.sessionId;
                    parcoursId = pId;
                    parcoursName = pName;
                    buffer = [];
                    _log('session_resume', {});
                    _startFlushTimer();
                    console.log('[TELEMETRY] Resumed session', sessionId);
                    return;
                }
            }
            // New session
            sessionId = _generateId();
            parcoursId = pId;
            parcoursName = pName;
            buffer = [];
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                sessionId: sessionId,
                parcoursId: parcoursId
            }));
            _log('session_start', {parcoursId: pId, parcoursName: pName});
            _startFlushTimer();
            console.log('[TELEMETRY] Started session', sessionId);
        } catch(e) { console.warn('[TELEMETRY] start error', e); }
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
                events: events
            };
            var _fetch = (typeof fetchRemote !== 'undefined') ? fetchRemote : fetch;
            _fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                redirect: 'follow'
            }).then(function(response) {
                console.log('[TELEMETRY] response:', response.status, response.url);
                if (response.status !== 200) {
                    return response.text().then(function(body) {
                        throw new Error('HTTP ' + response.status + ': ' + body.substring(0, 200));
                    });
                }
                return response.text();
            }).then(function(r) {
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
        if (!sessionId || buffer.length === 0) return;
        var payload = JSON.stringify({
            sessionId: sessionId,
            parcoursId: parcoursId,
            parcoursName: parcoursName,
            events: buffer.splice(0, buffer.length)
        });
        // sendBeacon survives page unload; fall back to async post
        var url = (typeof prep === 'function') ? prep('/telemetry-push') : '/telemetry-push';
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], {type: 'application/json'}));
        } else {
            var _fetch = (typeof fetchRemote !== 'undefined') ? fetchRemote : fetch;
            _fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            }).catch(function() {});
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
        log: log,
        gps: gps,
        flush: flush,
        end: end
    };

})();
