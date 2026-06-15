/* Telemetry page — bootstrap.
 * Tabs, filter controls <-> URL state sync, live polling loop (visibility-
 * aware, ETag-backed, with backoff), maintenance menu, beacons tab. */
window.TM = window.TM || {};

TM.app = (function() {
    var esc = function(s) { return TM.util.esc(s); };

    var POLL_BASE_MS = 30 * 1000;
    var POLL_SLOW_MS = 120 * 1000;
    var POLL_SLOW_AFTER = 10;

    var lastPollAt = 0;
    var unchangedPolls = 0;
    var pollInFlight = false;
    var lastLiveIds = '';
    var beaconsLoaded = false;

    // ---- Filter controls ----

    function syncControlsFromState() {
        document.getElementById('f-parcours').value = TM.state.get('parcours');
        document.getElementById('f-kind').value = TM.state.get('kind');
        document.getElementById('f-sim').value = TM.state.get('sim');
        document.getElementById('f-dev').value = TM.state.get('dev');
        document.getElementById('f-q').value = TM.state.get('q');
        document.getElementById('f-sort').value = TM.state.get('sort');

        var hours = TM.state.hourRange();
        document.getElementById('f-hmin').value = hours[0];
        document.getElementById('f-hmax').value = hours[1];
        document.getElementById('f-hours-label').textContent = hours[0] + 'h–' + hours[1] + 'h';

        var prog = TM.state.progRange();
        document.getElementById('f-pmin').value = prog[0];
        document.getElementById('f-pmax').value = prog[1];
        document.getElementById('f-prog-label').textContent = prog[0] + '–' + prog[1] + '%';

        var statuses = TM.state.statusSet();
        document.querySelectorAll('#f-status .tm-chip').forEach(function(chip) {
            chip.classList.toggle('active', !statuses || statuses.has(chip.dataset.status));
        });

        document.getElementById('live-toggle').checked = TM.state.isLive();

        document.querySelectorAll('.tm-tabs [data-tab]').forEach(function(link) {
            link.classList.toggle('active', link.dataset.tab === TM.state.get('tab'));
        });
    }

    function populateSelect(selectId, values, emptyLabel) {
        var select = document.getElementById(selectId);
        var currentValue = select.value;
        select.innerHTML = '<option value="">' + esc(emptyLabel) + '</option>';
        values.forEach(function(value) {
            var option = document.createElement('option');
            if (Array.isArray(value)) { option.value = value[0]; option.textContent = value[1]; }
            else { option.value = value; option.textContent = value; }
            select.appendChild(option);
        });
        select.value = currentValue;
        if (select.value !== currentValue) select.value = '';
    }

    function populateFilterOptions() {
        populateSelect('f-parcours', TM.list.parcoursOptions(), 'Tous parcours');
        populateSelect('f-dev', TM.list.deviceOptions(), 'Tous devices');
        syncControlsFromState();
    }

    function bindFilterControls() {
        document.getElementById('f-parcours').addEventListener('change', function() { TM.state.set({ parcours: this.value }); });
        document.getElementById('f-kind').addEventListener('change', function() { TM.state.set({ kind: this.value }); });
        document.getElementById('f-sim').addEventListener('change', function() { TM.state.set({ sim: this.value }); });
        document.getElementById('f-dev').addEventListener('change', function() { TM.state.set({ dev: this.value }); });
        document.getElementById('f-sort').addEventListener('change', function() { TM.state.set({ sort: this.value }); });

        var searchTimer = null;
        document.getElementById('f-q').addEventListener('input', function() {
            var value = this.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() { TM.state.set({ q: value }); }, 300);
        });

        function bindRangePair(minId, maxId, stateKey, lo, hi) {
            function commit() {
                var minEl = document.getElementById(minId);
                var maxEl = document.getElementById(maxId);
                var a = Number(minEl.value);
                var b = Number(maxEl.value);
                if (a > b) { var swap = a; a = b; b = swap; }
                TM.state.set((function() { var o = {}; o[stateKey] = a + '-' + b; return o; })());
            }
            [minId, maxId].forEach(function(id) {
                document.getElementById(id).addEventListener('change', commit);
                document.getElementById(id).addEventListener('input', function() {
                    // live label preview while dragging
                    var a = Number(document.getElementById(minId).value);
                    var b = Number(document.getElementById(maxId).value);
                    if (a > b) { var swap = a; a = b; b = swap; }
                    var label = stateKey === 'h'
                        ? a + 'h–' + b + 'h'
                        : a + '–' + b + '%';
                    document.getElementById(stateKey === 'h' ? 'f-hours-label' : 'f-prog-label').textContent = label;
                });
            });
        }
        bindRangePair('f-hmin', 'f-hmax', 'h', 0, 24);
        bindRangePair('f-pmin', 'f-pmax', 'prog', 0, 100);

        // Status chips were removed from the bar; the status= URL param still
        // filters (deep links) but has no on-page control.
        var statusFilterEl = document.getElementById('f-status');
        if (statusFilterEl) statusFilterEl.addEventListener('click', function(event) {
            var chip = event.target.closest('.tm-chip');
            if (!chip) return;
            var statuses = TM.state.statusSet();
            var all = ['live', 'complete', 'partial', 'interrupted'];
            var active = statuses ? Array.from(statuses) : all.slice();
            var status = chip.dataset.status;
            var index = active.indexOf(status);
            if (index === -1) active.push(status);
            else active.splice(index, 1);
            TM.state.set({ status: active.length === all.length || active.length === 0 ? '' : active.join(',') });
        });

        document.getElementById('f-reset').addEventListener('click', function() {
            TM.state.resetFilters();
        });

        var filtersToggle = document.getElementById('filters-toggle');
        if (filtersToggle) filtersToggle.addEventListener('click', function() {
            document.getElementById('tm-filters').classList.toggle('open');
        });
    }

    // ---- Tabs ----

    function showTab(tab) {
        document.getElementById('view-sessions').hidden = (tab === 'beacons' || tab === 'parcours');
        document.getElementById('view-beacons').hidden = (tab !== 'beacons');
        document.getElementById('view-parcours').hidden = (tab !== 'parcours');
        document.getElementById('tm-filters').style.display = (tab === 'beacons' || tab === 'parcours') ? 'none' : '';

        if (tab === 'beacons' && !beaconsLoaded) refreshBeacons();
        if (tab === 'parcours') {
            // The parcours view aggregates across active AND archive.
            Promise.all([
                TM.api.listSessions(false, { delta: TM.api.isLoaded(false) }),
                TM.api.listSessions(true, { delta: TM.api.isLoaded(true) })
            ]).then(function() { TM.parcoursView.render(); })
              .catch(function() { TM.parcoursView.render(); });
        }
        if ((tab === 'sessions' || tab === 'archive') && !TM.api.isLoaded(tab === 'archive')) {
            loadCurrentScope().then(function() {
                populateFilterOptions();
                TM.list.render();
            });
        }
    }

    function bindTabs() {
        document.querySelectorAll('.tm-tabs [data-tab]').forEach(function(link) {
            link.addEventListener('click', function(event) {
                event.preventDefault();
                TM.state.set({ tab: link.dataset.tab, s: '' });
            });
        });
    }

    // ---- Beacons ----

    function getBeaconDeviceLabel(beacon) {
        var parts = [];
        if (beacon.manufacturer && beacon.model && String(beacon.model).toLowerCase().indexOf(String(beacon.manufacturer).toLowerCase()) === -1) {
            parts.push(beacon.manufacturer);
        }
        if (beacon.model) parts.push(beacon.model);
        if (!parts.length && beacon.platform) parts.push(beacon.platform);
        return parts.join(' ') || '-';
    }

    function renderBeacons() {
        var meta = document.getElementById('beacon-meta');
        var tbody = document.getElementById('beacon-list');
        var beacons = TM.api.getBeacons();
        if (!beacons.length) {
            meta.textContent = 'No launcher beacons found.';
            tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No launcher beacons found.</td></tr>';
            return;
        }
        meta.textContent = beacons.length + ' recent beacon' + (beacons.length > 1 ? 's' : '');
        tbody.innerHTML = beacons.map(function(beacon) {
            var error = beacon.last_error && beacon.last_error.message
                ? beacon.last_error.stage + ': ' + beacon.last_error.message
                : '-';
            var appInfo = [beacon.platform, beacon.app_version].filter(Boolean).join(' · ') || '-';
            return '<tr>' +
                '<td>' + esc(TM.util.formatDateTime(beacon.received_at || beacon.t)) + '</td>' +
                '<td><span class="beacon-stage">' + esc(beacon.stage || '-') + '</span></td>' +
                '<td>' + esc(getBeaconDeviceLabel(beacon)) + '</td>' +
                '<td>' + esc(appInfo) + '</td>' +
                '<td class="beacon-error">' + esc(error) + '</td>' +
            '</tr>';
        }).join('');
    }

    function refreshBeacons() {
        document.getElementById('beacon-meta').textContent = 'Loading…';
        TM.api.loadBeacons()
            .then(function() { beaconsLoaded = true; renderBeacons(); })
            .catch(function(error) {
                document.getElementById('beacon-meta').textContent = 'Failed to load launcher beacons.';
                document.getElementById('beacon-list').innerHTML =
                    '<tr><td colspan="5" class="text-danger">Failed to load: ' + esc(String(error)) + '</td></tr>';
            });
    }

    // ---- Maintenance menu ----

    function formatPruneThreshold(seconds) {
        if (seconds < 60) return seconds + 's';
        var min = Math.floor(seconds / 60);
        var rem = seconds % 60;
        return rem === 0 ? min + 'min' : min + 'm' + String(rem).padStart(2, '0') + 's';
    }

    function bindMaintenance() {
        var pruneSlider = document.getElementById('prune-threshold');
        var pruneLabel = document.getElementById('prune-threshold-label');
        function updatePruneLabel() {
            pruneLabel.textContent = formatPruneThreshold(Number(pruneSlider.value) || 60);
        }
        pruneSlider.addEventListener('input', updatePruneLabel);
        // Keep the dropdown open while adjusting the slider
        pruneSlider.addEventListener('click', function(event) { event.stopPropagation(); });
        updatePruneLabel();

        document.getElementById('act-export-csv').addEventListener('click', function(event) {
            event.preventDefault();
            var rows = TM.list.getFilteredSessions().map(TM.list.buildSummaryRow);
            TM.util.downloadText('telemetry-summary.csv', TM.util.toCsv(rows), 'text/csv;charset=utf-8');
        });
        document.getElementById('act-export-json').addEventListener('click', function(event) {
            event.preventDefault();
            var rows = TM.list.getFilteredSessions().map(TM.list.buildSummaryRow);
            TM.util.downloadText('telemetry-summary.json', JSON.stringify(rows, null, 2), 'application/json');
        });

        document.getElementById('act-archive-filtered').addEventListener('click', function(event) {
            event.preventDefault();
            if (TM.state.archived()) { alert('Already browsing the archive.'); return; }
            var ids = TM.list.getFilteredSessions().map(function(s) { return s.sessionId; });
            if (!ids.length) { alert('No sessions match the current filters.'); return; }
            if (!confirm('Archive ' + ids.length + ' filtered session' + (ids.length > 1 ? 's' : '') + '?')) return;
            TM.api.archiveBulk(ids)
                .then(function(result) {
                    var archivedCount = (result.archived || []).length;
                    var skippedCount = (result.skipped || []).length;
                    alert('Archived ' + archivedCount + ' session' + (archivedCount === 1 ? '' : 's') +
                        (skippedCount ? ' (' + skippedCount + ' skipped)' : ''));
                    refreshSessions(true);
                })
                .catch(function(error) { alert('Failed to archive: ' + error); });
        });

        document.getElementById('act-prune').addEventListener('click', function(event) {
            event.preventDefault();
            var seconds = Number(pruneSlider.value) || 60;
            var scope = TM.state.archived() ? 'archived' : 'active';
            if (!confirm('Permanently delete all ' + scope + ' sessions shorter than ' + formatPruneThreshold(seconds) + '?')) return;
            TM.api.pruneShort(seconds * 1000, TM.state.archived())
                .then(function(result) {
                    alert('Pruned ' + (result.deleted || []).length + ' ' + scope + ' session(s).');
                    refreshSessions(true);
                })
                .catch(function(error) { alert('Failed to prune: ' + error); });
        });
    }

    // ---- Loading & polling ----

    var inflightLoads = {};

    function loadCurrentScope(full) {
        var scope = TM.state.archived() ? 'archive' : 'active';
        if (inflightLoads[scope]) return inflightLoads[scope];
        inflightLoads[scope] = doLoadScope(full).finally(function() { delete inflightLoads[scope]; });
        return inflightLoads[scope];
    }

    function doLoadScope(full) {
        return TM.api.listSessions(TM.state.archived(), { delta: !full }).catch(function(error) {
            var daysEl = document.getElementById('days-container');
            if (daysEl && !TM.api.isLoaded(TM.state.archived())) {
                daysEl.innerHTML = '<div class="text-danger p-3">Failed to load sessions: ' + esc(String(error)) + '</div>';
            }
            return { changed: false, error: error };
        });
    }

    function refreshSessions(full) {
        var button = document.getElementById('refresh-btn');
        button.disabled = true;
        return loadCurrentScope(full !== false)
            .then(function() {
                populateFilterOptions();
                TM.list.render();
            })
            .finally(function() { button.disabled = false; });
    }

    function liveIdsSignature() {
        if (TM.state.archived()) return '';
        return TM.api.getSessions(false)
            .filter(function(s) { return TM.api.statusOf(s) === 'live'; })
            .map(function(s) { return s.sessionId; })
            .sort()
            .join(',');
    }

    function updateLiveDot() {
        var dot = document.getElementById('live-dot');
        if (dot) dot.classList.toggle('on', TM.state.isLive() && !!liveIdsSignature());
    }

    function pollTick() {
        TM.list.updateAgoTickers();

        // Status transitions (live -> interrupted) happen without new data;
        // re-render when the set of live sessions changes.
        var signature = liveIdsSignature();
        if (signature !== lastLiveIds) {
            lastLiveIds = signature;
            updateLiveDot();
            if (TM.state.get('tab') !== 'beacons') TM.list.render();
        }

        if (!TM.state.isLive()) return;
        if (document.visibilityState !== 'visible') return;
        if (TM.state.get('tab') !== 'sessions') return;
        if (pollInFlight) return;

        var interval = unchangedPolls >= POLL_SLOW_AFTER ? POLL_SLOW_MS : POLL_BASE_MS;
        if (Date.now() - lastPollAt < interval) return;

        pollInFlight = true;
        lastPollAt = Date.now();
        loadCurrentScope(false)
            .then(function(result) {
                if (result && result.changed) {
                    unchangedPolls = 0;
                    populateFilterOptions();
                    TM.list.render();
                    // Follow the expanded session if it is live
                    var expandedId = TM.detail.currentSessionId();
                    if (expandedId) {
                        var summary = TM.api.getSession(expandedId, false);
                        if (summary && TM.api.statusOf(summary) === 'live') TM.detail.liveTick();
                    }
                } else {
                    unchangedPolls += 1;
                }
                updateLiveDot();
            })
            .finally(function() { pollInFlight = false; });
    }

    function bindHeader() {
        document.getElementById('refresh-btn').addEventListener('click', function() { refreshSessions(true); });
        document.getElementById('live-toggle').addEventListener('change', function() {
            TM.state.set({ live: this.checked ? '1' : '0' });
            unchangedPolls = 0;
            updateLiveDot();
        });
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                unchangedPolls = 0;
                pollTick();
            }
        });
    }

    // ---- State change routing ----

    var FILTER_KEYS = ['parcours', 'kind', 'sim', 'status', 'dev', 'q', 'h', 'prog', 'sort', 'ndays'];

    function onStateChange(changedKeys) {
        if (changedKeys.indexOf('tab') !== -1) {
            TM.list.clearSelection(); // selections are scoped to a tab's store
            syncControlsFromState();
            showTab(TM.state.get('tab'));
            populateFilterOptions();
            TM.list.render();
            // Jump links (e.g. from the parcours view) carry a session id.
            var deepLinked = TM.state.get('s');
            var tab = TM.state.get('tab');
            if (deepLinked && (tab === 'sessions' || tab === 'archive')) {
                if (TM.api.getSession(deepLinked, TM.state.archived())) {
                    TM.list.openDetailFor(deepLinked, {});
                } else {
                    loadCurrentScope().then(function() {
                        populateFilterOptions();
                        TM.list.render();
                        if (TM.api.getSession(deepLinked, TM.state.archived())) TM.list.openDetailFor(deepLinked, {});
                    });
                }
            }
            return;
        }
        if (changedKeys.indexOf('pv') !== -1 && TM.state.get('tab') === 'parcours') {
            TM.parcoursView.render();
        }
        var filtersChanged = changedKeys.some(function(key) { return FILTER_KEYS.indexOf(key) !== -1; });
        if (filtersChanged) {
            syncControlsFromState();
            TM.list.render();
        }
        if (changedKeys.indexOf('live') !== -1) {
            syncControlsFromState();
            updateLiveDot();
        }
    }

    // ---- Init ----

    function init() {
        bindTabs();
        bindFilterControls();
        bindHeader();
        bindMaintenance();
        TM.list.bind();
        TM.parcoursView.bind();
        TM.state.onChange(onStateChange);
        syncControlsFromState();
        showTab(TM.state.get('tab'));

        Promise.all([
            loadCurrentScope(true),
            TM.api.loadNotes(),
            TM.api.loadDevices(),
            TM.api.loadVersion()
        ]).then(function() {
            populateFilterOptions();
            TM.list.render();
            lastLiveIds = liveIdsSignature();
            updateLiveDot();

            var deepLinked = TM.state.get('s');
            if (deepLinked && TM.api.getSession(deepLinked, TM.state.archived())) {
                TM.list.openDetailFor(deepLinked, {});
            }
        });

        setInterval(pollTick, 5000);
    }

    return { init: init, refreshSessions: refreshSessions, refreshBeacons: refreshBeacons };
})();

document.addEventListener('DOMContentLoaded', TM.app.init);
