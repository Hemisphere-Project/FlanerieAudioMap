/* Telemetry page — data layer.
 * Session summary stores (active + archive), detail cache with incremental
 * tail support, ETag-aware polling, notes / devices / beacons / version. */
window.TM = window.TM || {};

TM.api = (function() {
    var LIVE_WINDOW_MS = 3 * 60 * 1000; // mirror of server TELEMETRY_LIVE_WINDOW_MS

    var stores = {
        active: { sessions: new Map(), etag: null, lastSync: 0, loaded: false },
        archive: { sessions: new Map(), etag: null, lastSync: 0, loaded: false }
    };
    var detailCache = new Map();   // sessionId -> full session data
    var serverTimeOffset = 0;      // serverNow - clientNow
    var notes = {};                // sessionId -> note text
    var devices = {};              // uuid -> registry entry
    var version = null;            // { commit, builtAt }
    var beacons = [];

    function scopeFor(archived) { return archived ? 'archive' : 'active'; }

    function nowServer() { return Date.now() + serverTimeOffset; }

    // Status: ended-* is final (server-computed); live/interrupted depends on
    // "now" so recompute locally on every render.
    function statusOf(summary) {
        if (summary.ended) return summary.status || 'ended-partial';
        var last = Number(summary.lastEvent) || 0;
        return (nowServer() - last) < LIVE_WINDOW_MS ? 'live' : 'interrupted';
    }

    function fetchJson(url, options) {
        return fetch(url, Object.assign({ cache: 'no-store' }, options || {})).then(function(response) {
            if (response.status === 304) return { __notModified: true, response: response };
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json().then(function(data) {
                return { data: data, response: response };
            });
        });
    }

    // List sessions. delta=true sends ?since= and merges; otherwise replaces
    // the store (so deletions/archives disappear). Returns
    // { changed, transitions } — transitions=true when only statuses moved.
    function listSessions(archived, opts) {
        var options = opts || {};
        var store = stores[scopeFor(archived)];
        var url = '/telemetry/sessions';
        var params = [];
        if (archived) params.push('archived=1');
        if (options.delta && store.lastSync) params.push('since=' + store.lastSync);
        if (params.length) url += '?' + params.join('&');

        var headers = {};
        if (store.etag) headers['If-None-Match'] = store.etag;

        return fetchJson(url, { headers: headers }).then(function(result) {
            if (result.__notModified) return { changed: false };

            var response = result.response;
            store.etag = response.headers.get('ETag') || null;
            var serverTime = Number(response.headers.get('X-Server-Time'));
            if (Number.isFinite(serverTime) && serverTime > 0) {
                serverTimeOffset = serverTime - Date.now();
            }

            var list = Array.isArray(result.data) ? result.data : [];
            if (options.delta && store.lastSync) {
                list.forEach(function(summary) { store.sessions.set(summary.sessionId, summary); });
            } else {
                store.sessions = new Map(list.map(function(summary) { return [summary.sessionId, summary]; }));
            }
            store.lastSync = Number.isFinite(serverTime) ? serverTime : Date.now();
            store.loaded = true;
            return { changed: true, count: list.length };
        });
    }

    function getSessions(archived) {
        return Array.from(stores[scopeFor(archived)].sessions.values());
    }

    function getSession(sessionId, archived) {
        return stores[scopeFor(archived)].sessions.get(sessionId) || null;
    }

    function removeSessionLocally(sessionId, archived) {
        stores[scopeFor(archived)].sessions.delete(sessionId);
        detailCache.delete(sessionId);
    }

    function isLoaded(archived) { return stores[scopeFor(archived)].loaded; }

    function detailUrl(sessionId, archived, extraQuery) {
        var url = '/telemetry/session/' + encodeURIComponent(sessionId);
        var params = [];
        if (archived) params.push('archived=1');
        if (extraQuery) params.push(extraQuery);
        if (params.length) url += '?' + params.join('&');
        return url;
    }

    function getDetail(sessionId, archived, opts) {
        var options = opts || {};
        if (options.force) detailCache.delete(sessionId);
        if (detailCache.has(sessionId)) return Promise.resolve(detailCache.get(sessionId));

        return fetchJson(detailUrl(sessionId, archived)).then(function(result) {
            detailCache.set(sessionId, result.data);
            return result.data;
        });
    }

    // Fetch only events newer than the cached tail and append them in place.
    // Resolves with the array of appended events ([] if nothing new).
    function getDetailTail(sessionId, archived) {
        var cached = detailCache.get(sessionId);
        if (!cached) return getDetail(sessionId, archived).then(function(data) { return data.events || []; });

        var events = cached.events || [];
        var lastT = events.length ? Number(events[events.length - 1].t) : 0;
        if (!lastT) return getDetail(sessionId, archived, { force: true }).then(function(data) { return data.events || []; });

        return fetchJson(detailUrl(sessionId, archived, 'afterT=' + lastT)).then(function(result) {
            var fresh = (result.data && result.data.events) || [];
            if (fresh.length) cached.events = events.concat(fresh);
            return fresh;
        });
    }

    function dropDetail(sessionId) { detailCache.delete(sessionId); }

    // ---- Notes ----

    function loadNotes() {
        return fetchJson('/telemetry/notes').then(function(result) {
            notes = (result.data && result.data.notes) || {};
            return notes;
        }).catch(function() { notes = {}; return notes; });
    }

    function getNote(sessionId) { return notes[sessionId] || ''; }

    function saveNote(sessionId, note) {
        return fetchJson('/telemetry/note/' + encodeURIComponent(sessionId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: note })
        }).then(function() {
            if (note) notes[sessionId] = note;
            else delete notes[sessionId];
        });
    }

    // ---- Device registry ----

    function loadDevices() {
        return fetchJson('/devices').then(function(result) {
            devices = {};
            ((result.data && result.data.devices) || []).forEach(function(device) {
                if (device && device.uuid) devices[device.uuid] = device;
            });
            return devices;
        }).catch(function() { devices = {}; return devices; });
    }

    function getDevice(uuid) { return (uuid && devices[uuid]) || null; }

    function maxApkVersion() {
        var max = 0;
        Object.keys(devices).forEach(function(uuid) {
            var v = Number(devices[uuid].apk_version);
            if (Number.isFinite(v)) max = Math.max(max, v);
        });
        return max || null;
    }

    function renameDevice(uuid, friendlyName) {
        return fetchJson('/devices/' + encodeURIComponent(uuid), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ friendly_name: friendlyName })
        }).then(function(result) {
            if (result.data && result.data.device) devices[uuid] = result.data.device;
        });
    }

    // ---- Version (build provenance) ----

    function loadVersion() {
        return fetchJson('/version').then(function(result) {
            version = result.data || null;
            return version;
        }).catch(function() { version = null; return null; });
    }

    function getVersion() { return version; }

    // ---- Launcher beacons ----

    function loadBeacons() {
        return fetchJson('/launcher-beacons?limit=100').then(function(result) {
            beacons = (result.data && Array.isArray(result.data.beacons)) ? result.data.beacons : [];
            return beacons;
        });
    }

    function getBeacons() { return beacons; }

    // ---- Maintenance actions ----

    function deleteSession(sessionId, archived) {
        return fetch(detailUrl(sessionId, archived), { method: 'DELETE' }).then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            removeSessionLocally(sessionId, archived);
        });
    }

    function archiveSession(sessionId) {
        return fetch('/telemetry/session/' + encodeURIComponent(sessionId) + '/archive', { method: 'POST' })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                removeSessionLocally(sessionId, false);
                stores.archive.loaded = false;
            });
    }

    function unarchiveSession(sessionId) {
        return fetch('/telemetry/session/' + encodeURIComponent(sessionId) + '/unarchive', { method: 'POST' })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                removeSessionLocally(sessionId, true);
                stores.active.loaded = false;
            });
    }

    function archiveBulk(sessionIds) {
        return fetchJson('/telemetry/archive-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionIds: sessionIds })
        }).then(function(result) { return result.data; });
    }

    function pruneShort(thresholdMs, archived) {
        return fetchJson('/telemetry/prune-short', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thresholdMs: thresholdMs, archived: !!archived })
        }).then(function(result) { return result.data; });
    }

    var parcoursCache = new Map();

    function loadParcoursOverlay(parcoursId) {
        if (!parcoursId) return Promise.resolve(null);
        var bareId = String(parcoursId).replace(/^onb:/, '');
        if (parcoursCache.has(bareId)) return Promise.resolve(parcoursCache.get(bareId));

        return fetch('/telemetry/parcours/' + encodeURIComponent(bareId), { cache: 'no-store' })
            .then(function(response) {
                if (!response.ok) return null;
                return response.json();
            })
            .then(function(data) {
                parcoursCache.set(bareId, data);
                return data;
            })
            .catch(function() { return null; });
    }

    return {
        LIVE_WINDOW_MS: LIVE_WINDOW_MS,
        nowServer: nowServer,
        statusOf: statusOf,
        listSessions: listSessions,
        getSessions: getSessions,
        getSession: getSession,
        isLoaded: isLoaded,
        getDetail: getDetail,
        getDetailTail: getDetailTail,
        dropDetail: dropDetail,
        loadNotes: loadNotes,
        getNote: getNote,
        saveNote: saveNote,
        loadDevices: loadDevices,
        getDevice: getDevice,
        maxApkVersion: maxApkVersion,
        renameDevice: renameDevice,
        loadVersion: loadVersion,
        getVersion: getVersion,
        loadBeacons: loadBeacons,
        getBeacons: getBeacons,
        deleteSession: deleteSession,
        archiveSession: archiveSession,
        unarchiveSession: unarchiveSession,
        archiveBulk: archiveBulk,
        pruneShort: pruneShort,
        loadParcoursOverlay: loadParcoursOverlay
    };
})();
