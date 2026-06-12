/* Telemetry page — URL-hash state.
 * Every filter and view toggle lives in location.hash so a reload restores the
 * exact view and any view is a shareable deep link. Only non-default values
 * are serialized. */
window.TM = window.TM || {};

TM.state = (function() {
    var DEFAULTS = {
        tab: 'sessions',      // sessions | beacons | archive
        parcours: '',
        kind: 'all',          // all | walk | onb
        status: '',           // csv of live,complete,partial,interrupted ('' = all)
        dev: '',              // deviceUuid
        q: '',                // sessionId substring
        h: '0-24',            // hour range (session start hour, local)
        prog: '0-100',        // progress % range
        s: '',                // expanded sessionId
        live: '1',            // live auto-refresh
        view: 'prog',         // detail map view: prog (step status) | gps (quality)
        zones: '0',           // detail map: 1 = all zones, 0 = steps only
        sort: 'time',         // time | worst
        ndays: '7'            // day sections shown before "load more"
    };

    var state = Object.assign({}, DEFAULTS);
    var listeners = [];

    function parseHash() {
        var hash = location.hash.replace(/^#/, '');
        var parsed = Object.assign({}, DEFAULTS);
        hash.split('&').forEach(function(pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            if (i === -1) return;
            var key = decodeURIComponent(pair.slice(0, i));
            var value = decodeURIComponent(pair.slice(i + 1));
            if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) parsed[key] = value;
        });
        state = parsed;
    }

    function serialize() {
        var parts = [];
        Object.keys(DEFAULTS).forEach(function(key) {
            if (state[key] !== DEFAULTS[key]) {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(state[key]));
            }
        });
        return parts.join('&');
    }

    function writeHash() {
        var serialized = serialize();
        var url = serialized ? '#' + serialized : location.pathname + location.search;
        history.replaceState(null, '', url);
    }

    function notify(changedKeys) {
        listeners.forEach(function(listener) { listener(changedKeys); });
    }

    function set(partial) {
        var changed = [];
        Object.keys(partial).forEach(function(key) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
            var value = String(partial[key]);
            if (state[key] !== value) {
                state[key] = value;
                changed.push(key);
            }
        });
        if (!changed.length) return;
        writeHash();
        notify(changed);
    }

    function get(key) { return state[key]; }

    function resetFilters() {
        set({
            parcours: DEFAULTS.parcours, kind: DEFAULTS.kind, status: DEFAULTS.status,
            dev: DEFAULTS.dev, q: DEFAULTS.q, h: DEFAULTS.h, prog: DEFAULTS.prog,
            sort: DEFAULTS.sort
        });
    }

    function rangeOf(key, lo, hi) {
        var match = /^(\d+)-(\d+)$/.exec(state[key] || '');
        if (!match) return [lo, hi];
        var a = Math.max(lo, Math.min(hi, Number(match[1])));
        var b = Math.max(lo, Math.min(hi, Number(match[2])));
        return a <= b ? [a, b] : [b, a];
    }

    function hourRange() { return rangeOf('h', 0, 24); }
    function progRange() { return rangeOf('prog', 0, 100); }

    // null = no status filter; otherwise a Set of short codes
    function statusSet() {
        var raw = (state.status || '').split(',').filter(Boolean);
        if (!raw.length) return null;
        return new Set(raw);
    }

    function isLive() { return state.live === '1'; }
    function mapView() { return state.view === 'gps' ? 'gps' : 'prog'; }
    function allZones() { return state.zones === '1'; }
    function archived() { return state.tab === 'archive'; }

    function onChange(listener) { listeners.push(listener); }

    parseHash();
    window.addEventListener('hashchange', function() {
        parseHash();
        notify(Object.keys(DEFAULTS));
    });

    return {
        get: get,
        set: set,
        resetFilters: resetFilters,
        hourRange: hourRange,
        progRange: progRange,
        statusSet: statusSet,
        isLive: isLive,
        mapView: mapView,
        allZones: allZones,
        archived: archived,
        onChange: onChange
    };
})();
