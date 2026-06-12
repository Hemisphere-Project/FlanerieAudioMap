/* Telemetry page — Parcours view.
 * Cross-day aggregation for one parcours: walk/completion stats, step
 * reliability (cross-walk fire rates, in a list and coloured on the map),
 * device-robust average-accuracy heat over all walks, health distribution,
 * recent walks with jump links. Reads BOTH active and archive stores. */
window.TM = window.TM || {};

TM.parcoursView = (function() {
    var esc = function(s) { return TM.util.esc(s); };

    var heatCap = 25;       // walks aggregated into the heat map
    var mapHandle = null;
    var renderToken = 0;

    function parcoursLabelOf(summary) {
        return String(summary.parcoursName || summary.parcoursId || '').replace(/^onb:/, '');
    }

    function allWalks() {
        return TM.api.getSessions(false).concat(TM.api.getSessions(true))
            .filter(function(s) { return s.kind === 'walk'; });
    }

    function labels() {
        var set = new Set();
        allWalks().forEach(function(s) {
            var label = parcoursLabelOf(s);
            if (label) set.add(label);
        });
        return Array.from(set).sort();
    }

    function walksFor(label) {
        return allWalks()
            .filter(function(s) { return parcoursLabelOf(s) === label; })
            .sort(function(a, b) { return new Date(b.startTime) - new Date(a.startTime); });
    }

    function deviceLabelFor(summary) {
        var device = TM.api.getDevice(summary.deviceUuid);
        if (device && device.friendly_name) return device.friendly_name;
        return summary.deviceModel || summary.devicePlatform || 'unknown device';
    }

    // Per step index: how many walks reached it, how many fired it.
    function stepStats(walks, totalSteps) {
        var stats = new Map();
        for (var i = 0; i < totalSteps; i++) stats.set(i, { reached: 0, fired: 0 });
        walks.forEach(function(walk) {
            var fired = new Set(Array.isArray(walk.firedSteps) ? walk.firedSteps : []);
            var finalStep = Number.isInteger(walk.finalStep) ? walk.finalStep : -1;
            for (var i = 0; i < totalSteps; i++) {
                var stat = stats.get(i);
                if (i <= finalStep || fired.has(i)) stat.reached += 1;
                if (fired.has(i)) stat.fired += 1;
            }
        });
        return stats;
    }

    function median(values) {
        if (!values.length) return null;
        var sorted = values.slice().sort(function(a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function rateColor(rate) {
        return rate >= 0.95 ? '#198754' : (rate >= 0.8 ? '#fd7e14' : '#dc3545');
    }

    function renderStats(walks) {
        var statuses = walks.map(function(w) { return TM.api.statusOf(w); });
        var completes = statuses.filter(function(s) { return s === 'ended-complete'; }).length;
        var devices = new Set(walks.map(function(w) { return w.deviceUuid || w.deviceModel; })).size;
        var durations = walks.map(function(w) { return Number(w.durationMs) || 0; }).filter(Boolean);
        var healths = walks.map(TM.util.healthScore);
        var oldest = walks[walks.length - 1];
        var newest = walks[0];

        var cards = [
            ['Walks', walks.length],
            ['Complete', walks.length ? Math.round((completes / walks.length) * 100) + '%' : '-'],
            ['Devices', devices],
            ['Period', oldest && newest
                ? new Date(oldest.startTime).toLocaleDateString('fr-FR') + ' → ' + new Date(newest.startTime).toLocaleDateString('fr-FR')
                : '-'],
            ['Median duration', durations.length ? TM.util.formatDuration(median(durations)) : '-'],
            ['Median health', healths.length ? median(healths) + '/100' : '-']
        ];
        return '<div class="metrics-grid">' + cards.map(function(card) {
            return '<div class="metric-card"><span class="label">' + esc(card[0]) + '</span><span class="value">' + esc(card[1]) + '</span></div>';
        }).join('') + '</div>';
    }

    function renderStepList(stats, stepNames) {
        var rows = '';
        stats.forEach(function(stat, index) {
            var name = stepNames && stepNames[index] ? stepNames[index] : '';
            var rate = stat.reached > 0 ? stat.fired / stat.reached : null;
            var bar = rate == null
                ? '<div class="pv-step-bar"><div style="width:0"></div></div>'
                : '<div class="pv-step-bar"><div style="width:' + Math.round(rate * 100) + '%;background:' + rateColor(rate) + '"></div></div>';
            var labelText = rate == null
                ? 'never reached'
                : stat.fired + '/' + stat.reached + ' (' + Math.round(rate * 100) + '%)';
            rows += '<div class="pv-step" title="' + esc(name) + '">' +
                '<span class="pv-step-idx">#' + index + '</span>' +
                '<span class="pv-step-name">' + esc(name) + '</span>' +
                bar +
                '<span class="pv-step-rate"' + (rate != null && rate < 0.95 ? ' style="color:' + rateColor(rate) + '"' : '') + '>' + esc(labelText) + '</span>' +
            '</div>';
        });
        return rows || '<div class="text-secondary small">No step data.</div>';
    }

    function renderHealthHisto(walks) {
        var buckets = [0, 0, 0, 0, 0]; // 0-19, 20-39, 40-59, 60-79, 80-100
        walks.forEach(function(walk) {
            var score = TM.util.healthScore(walk);
            buckets[Math.min(4, Math.floor(score / 20))] += 1;
        });
        var max = Math.max.apply(null, buckets.concat([1]));
        var labelsTxt = ['0-19', '20-39', '40-59', '60-79', '80-100'];
        var colors = ['#dc3545', '#dc3545', '#ffc107', '#ffc107', '#198754'];
        return '<div class="pv-histo">' + buckets.map(function(count, index) {
            return '<div class="pv-histo-col" title="' + count + ' walk(s) at ' + labelsTxt[index] + '">' +
                '<div class="pv-histo-bar" style="height:' + Math.round((count / max) * 100) + '%;background:' + colors[index] + '"></div>' +
                '<span>' + labelsTxt[index] + '</span><strong>' + count + '</strong>' +
            '</div>';
        }).join('') + '</div>';
    }

    function renderRecent(walks) {
        return walks.slice(0, 12).map(function(walk) {
            var score = TM.util.healthScore(walk);
            return '<div class="pv-recent-row" data-pv-session="' + esc(walk.sessionId) + '" data-pv-archived="' + (walk.archived ? '1' : '0') + '" role="button">' +
                '<span class="pv-recent-date">' + esc(new Date(walk.startTime).toLocaleDateString('fr-FR')) + ' ' + esc(TM.util.formatTime(walk.startTime)) + '</span>' +
                '<span class="pv-recent-dev">' + esc(deviceLabelFor(walk)) + '</span>' +
                TM.list.statusPill(walk) +
                '<span class="badge tm-health-chip" style="background:' + TM.util.healthColor(score) + '">' + score + '</span>' +
            '</div>';
        }).join('') || '<div class="text-secondary small">No walks.</div>';
    }

    function legendHtml() {
        var acc = TM.maps.ACC_BUCKETS.map(function(bucket) {
            return '<span><span class="tm-legend-swatch" style="background:' + bucket.color + '"></span>' + esc(bucket.label) + '</span>';
        }).join('');
        return '<div class="tm-map-legend">' + acc +
            '<span><span class="tm-legend-swatch" style="background:#198754"></span>step ≥95%</span>' +
            '<span><span class="tm-legend-swatch" style="background:#fd7e14"></span>step ≥80%</span>' +
            '<span><span class="tm-legend-swatch" style="background:#dc3545"></span>step &lt;80%</span>' +
        '</div>';
    }

    function renderHeatMap(label, walks, stats) {
        var statusEl = document.getElementById('pv-map-status');
        var token = ++renderToken;
        var capped = walks.slice(0, heatCap);
        if (!capped.length) {
            if (statusEl) statusEl.textContent = 'No walks to aggregate.';
            return;
        }
        if (statusEl) statusEl.textContent = 'Aggregating ' + capped.length + ' of ' + walks.length + ' walk(s)…';

        Promise.all(capped.map(function(walk) {
            return TM.api.getDetail(walk.sessionId, !!walk.archived).then(function(data) {
                return { session: walk, data: data };
            }).catch(function() { return null; });
        })).then(function(items) {
            if (token !== renderToken) return;
            items = items.filter(Boolean);
            return TM.api.loadParcoursOverlay(label).then(function(overlay) {
                if (token !== renderToken) return;
                if (mapHandle) { try { mapHandle.destroy(); } catch (e) {} mapHandle = null; }
                var mapEl = document.getElementById('pv-map');
                if (!mapEl) return;
                mapHandle = TM.maps.renderGroupMap('pv-map', items, overlay, {
                    mode: 'accuracy',
                    stepRates: stats,
                    viewKey: 'pv:' + label
                });
                if (statusEl) statusEl.textContent = items.length + ' walk(s) aggregated · accuracy = median across devices per ~25m cell · step zones coloured by cross-walk fire rate';
            });
        }).catch(function(error) {
            if (statusEl) statusEl.textContent = 'Failed to aggregate: ' + String(error);
        });
    }

    function render() {
        var root = document.getElementById('pv-root');
        if (!root) return;

        var available = labels();
        if (!available.length) {
            root.innerHTML = '<div class="text-muted p-3">No walk sessions found (active + archive).</div>';
            return;
        }

        var selected = TM.state.get('pv');
        if (!selected || available.indexOf(selected) === -1) selected = available[0];

        var walks = walksFor(selected);
        var totalSteps = 0;
        walks.forEach(function(walk) { if (walk.totalSteps > totalSteps) totalSteps = walk.totalSteps; });
        var stats = stepStats(walks, totalSteps);

        root.innerHTML =
            '<div class="d-flex gap-3 align-items-center flex-wrap mb-3">' +
                '<select id="pv-select" class="form-select form-select-sm" style="max-width:340px">' +
                    available.map(function(label) {
                        return '<option value="' + esc(label) + '"' + (label === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
                    }).join('') +
                '</select>' +
                '<div class="d-flex align-items-center gap-2 small text-secondary">heat over last' +
                    '<select id="pv-cap" class="form-select form-select-sm" style="width:auto">' +
                        [10, 25, 50].map(function(cap) {
                            return '<option value="' + cap + '"' + (cap === heatCap ? ' selected' : '') + '>' + cap + '</option>';
                        }).join('') +
                    '</select>walks</div>' +
            '</div>' +
            renderStats(walks) +
            '<div class="pv-main">' +
                '<div>' +
                    '<div id="pv-map-status" class="tm-meta">Loading…</div>' +
                    '<div id="pv-map" class="pv-map"></div>' +
                    legendHtml() +
                '</div>' +
                '<div class="pv-side">' +
                    '<h6>Step reliability <span class="text-secondary small">(fired / walks that reached)</span></h6>' +
                    '<div class="pv-steps">' + renderStepList(stats, null) + '</div>' +
                    '<h6 class="mt-3">Health distribution</h6>' +
                    renderHealthHisto(walks) +
                    '<h6 class="mt-3">Recent walks</h6>' +
                    '<div class="pv-recent">' + renderRecent(walks) + '</div>' +
                '</div>' +
            '</div>';

        // Step names arrive with the overlay; refresh the list once loaded.
        TM.api.loadParcoursOverlay(selected).then(function(overlay) {
            if (!overlay || !overlay.data || !overlay.data.spots) return;
            var names = (overlay.data.spots.steps || []).map(function(step) { return step.name || ''; });
            var stepsEl = root.querySelector('.pv-steps');
            if (stepsEl) stepsEl.innerHTML = renderStepList(stats, names);
        });

        renderHeatMap(selected, walks, stats);
    }

    function bind() {
        var root = document.getElementById('pv-root');
        if (!root) return;

        root.addEventListener('change', function(event) {
            if (event.target.id === 'pv-select') TM.state.set({ pv: event.target.value });
            else if (event.target.id === 'pv-cap') {
                heatCap = Number(event.target.value) || 25;
                render();
            }
        });

        root.addEventListener('click', function(event) {
            var row = event.target.closest('[data-pv-session]');
            if (!row) return;
            TM.state.set({
                tab: row.dataset.pvArchived === '1' ? 'archive' : 'sessions',
                s: row.dataset.pvSession
            });
        });
    }

    return { render: render, bind: bind };
})();
