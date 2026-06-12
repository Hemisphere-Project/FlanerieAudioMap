/* Telemetry page — expanded session detail panel.
 * Metric cards, accuracy map with Progress/GPS-quality views, time scrubber,
 * sparkline charts, operator note, virtualized events table, exports,
 * archive/delete actions, live tail updates. */
window.TM = window.TM || {};

TM.detail = (function() {
    var esc = function(s) { return TM.util.esc(s); };

    var current = null; // { sessionId, data, overlay, mapHandle, panelEl, eventsState }

    function currentSessionId() { return current ? current.sessionId : null; }

    // ---- Metrics (full-event computation; richer than the list summary) ----

    function computeMetrics(data) {
        var events = data.events || [];
        var gpsEvents = TM.maps.getGpsEvents(events);
        var stepFires = events.filter(function(e) { return e.type === 'step_fire'; });
        var uniqueSteps = new Set(stepFires.map(function(e) { return e.data && e.data.step; }).filter(Number.isInteger));

        var finalStep = null;
        for (var i = events.length - 1; i >= 0; i--) {
            var e = events[i];
            if (e.type === 'route_probe' && e.data && Number.isInteger(e.data.currentStep)) { finalStep = e.data.currentStep; break; }
        }

        var gpsAcc = gpsEvents.map(function(e) { return Number(e.data.acc); }).filter(function(v) { return !Number.isNaN(v); });
        var summaries = events.filter(function(e) { return e.type === 'gps_quality_summary'; });
        var gapFromSummary = Math.max.apply(null, [0].concat(summaries.map(function(e) { return Number(e.data && e.data.maxGapMs) || 0; })));
        var gapFromEvents = Math.max.apply(null, [0].concat(
            events.filter(function(e) { return e.type === 'gps_callback_gap'; })
                .map(function(e) { return Number(e.data && e.data.gapMs) || 0; })));
        var rejectedFromSummary = summaries.reduce(function(sum, e) { return sum + (Number(e.data && e.data.rejectedSamples) || 0); }, 0);

        function count(type) { return events.filter(function(e) { return e.type === type; }).length; }

        return {
            finalStep: finalStep,
            uniqueSteps: uniqueSteps.size,
            duplicateStepFires: Math.max(0, stepFires.length - uniqueSteps.size),
            gpsCount: gpsEvents.length,
            avgAccuracy: gpsAcc.length ? gpsAcc.reduce(function(s, v) { return s + v; }, 0) / gpsAcc.length : null,
            maxGapMs: Math.max(gapFromSummary, gapFromEvents) || null,
            sleepSuspects: count('gps_sleep_suspect'),
            staleCallbacks: count('gps_stale_callback'),
            rejectedFixes: rejectedFromSummary || count('gps_trigger_rejected'),
            heartbeatRecoveries: count('gps_heartbeat_ok'),
            gpsLost: events.filter(function(e) { return e.type === 'gps_state' && e.data && e.data.state === 'lost'; }).length,
            audioErrors: count('audio_loaderror') + count('audio_playerror'),
            resumeCount: count('session_resume'),
            userLost: count('user_lost'),
            voiceFail: count('step_voice_failed'),
            afterplayFallback: count('step_afterplay_fallback'),
            audiofocusRetry: count('audiofocus_auto_retry')
        };
    }

    var GPS_METRICS = [
        ['Last step', function(m) { return m.finalStep == null ? '-' : m.finalStep; }],
        ['Unique steps', function(m) { return m.uniqueSteps; }],
        ['Refires', function(m) { return m.duplicateStepFires; }],
        ['GPS points', function(m) { return m.gpsCount; }],
        ['Avg acc', function(m) { return m.avgAccuracy == null ? '-' : TM.util.formatNumber(m.avgAccuracy, 1) + 'm'; }],
        ['Max gap', function(m) { return m.maxGapMs == null ? '-' : TM.util.formatGap(m.maxGapMs); }],
        ['Sleep suspect', function(m) { return m.sleepSuspects; }],
        ['Stale callbacks', function(m) { return m.staleCallbacks; }],
        ['Rejected fixes', function(m) { return m.rejectedFixes; }],
        ['GPS lost', function(m) { return m.gpsLost; }],
        ['User lost', function(m) { return m.userLost; }],
        ['Resumes', function(m) { return m.resumeCount; }]
    ];
    var AUDIO_METRICS = [
        ['Audio errors', function(m) { return m.audioErrors; }],
        ['Voice fail', function(m) { return m.voiceFail; }],
        ['Afterplay fb', function(m) { return m.afterplayFallback; }],
        ['AudioFocus retry', function(m) { return m.audiofocusRetry; }]
    ];

    function renderMetricCards(metrics) {
        var items = GPS_METRICS.concat(AUDIO_METRICS);
        return items.map(function(item) {
            return '<div class="metric-card"><span class="label">' + esc(item[0]) + '</span><span class="value">' + esc(item[1](metrics)) + '</span></div>';
        }).join('');
    }

    // ---- Sidebar ----

    // Staleness must be judged against what was current AT WALK TIME, not now:
    // apk is compared to the same-day fleet max; the webapp commit is only
    // compared to the deployed /version for sessions started today.
    function deviceChips(data) {
        var client = data.client || {};
        var chips = [];
        var sessionDay = TM.util.dayKey(data.startTime);
        var isToday = sessionDay === TM.util.dayKey(Date.now());

        if (client.isLoanDevice) chips.push('<span class="badge tm-loan-badge" title="loan-fleet device">loan</span>');
        if (client.appVersion != null) {
            var dayMax = TM.list.dayMaxApk(sessionDay);
            var stale = dayMax && Number(client.appVersion) < dayMax;
            chips.push('<span class="badge text-bg-' + (stale ? 'danger' : 'secondary') + '">apk ' + esc(client.appVersion) + (stale ? ' < fleet ' + dayMax : '') + '</span>');
        }
        if (client.webappCommit) {
            var version = TM.api.getVersion();
            var staleWebapp = isToday && version && version.commit && client.webappCommit !== version.commit;
            chips.push('<span class="badge text-bg-' + (staleWebapp ? 'danger' : 'secondary') + '">web ' + esc(client.webappCommit) + (staleWebapp ? ' (stale)' : '') + '</span>');
        }
        return chips.join(' ');
    }

    function renderSidebar(data, metrics) {
        var client = data.client || {};
        var note = TM.api.getNote(data.sessionId);
        var device = TM.api.getDevice(client.deviceUuid);
        var deviceName = (device && device.friendly_name) || client.deviceModel || '-';

        return [
            '<div class="detail-meta"><strong>Session</strong><br><code>' + esc(data.sessionId) + '</code>' +
                '<button class="btn btn-link btn-sm p-0 ms-2 align-baseline" data-action="copy-link" title="Copy deep link">🔗</button></div>',
            '<div class="detail-meta"><strong>Device</strong><br>' +
                esc(deviceName) + ' / ' + esc(client.osVersion || '-') +
                (client.deviceUuid ? '<br><span class="tm-group-uuid">' + esc(client.deviceUuid) + '</span>' : '') +
                '<div class="mt-1">' + deviceChips(data) + '</div></div>',
            '<div class="detail-meta"><strong>GPS</strong><br>' + metrics.gpsCount + ' points, avg acc ' +
                esc(TM.util.formatNumber(metrics.avgAccuracy, 1)) + 'm</div>',
            '<div class="detail-meta tm-note-box"><strong>Note</strong>' +
                '<textarea class="form-control form-control-sm mt-1" data-role="note" placeholder="Observation terrain, météo, variante…">' + esc(note) + '</textarea>' +
                '<button class="btn btn-outline-secondary btn-sm mt-1" data-action="save-note">Save note</button>' +
                '<span class="ms-2 small text-secondary" data-role="note-status"></span></div>'
        ].join('');
    }

    // ---- Sparkline charts ----

    function drawSparkline(canvas, points, opts) {
        var options = opts || {};
        var dpr = window.devicePixelRatio || 1;
        var width = canvas.clientWidth || 300;
        var height = canvas.clientHeight || 70;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        if (points.length < 2) return;

        var maxY = Math.max.apply(null, points.map(function(p) { return p.v; }).concat([options.minMax || 1]));
        var t0 = points[0].t;
        var t1 = points[points.length - 1].t;
        var span = Math.max(1, t1 - t0);

        function px(p) { return ((p.t - t0) / span) * (width - 4) + 2; }
        function py(p) { return height - 4 - (Math.min(p.v, maxY) / maxY) * (height - 10); }

        if (options.threshold && options.threshold < maxY) {
            var ty = height - 4 - (options.threshold / maxY) * (height - 10);
            ctx.strokeStyle = 'rgba(255,193,7,0.4)';
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(0, ty);
            ctx.lineTo(width, ty);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.strokeStyle = options.color || '#0dcaf0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        points.forEach(function(p, i) {
            if (i === 0) ctx.moveTo(px(p), py(p));
            else ctx.lineTo(px(p), py(p));
        });
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px monospace';
        ctx.fillText(TM.util.formatNumber(maxY, 0) + (options.unit || ''), 4, 10);

        canvas.onclick = function(event) {
            if (!options.onPick) return;
            var rect = canvas.getBoundingClientRect();
            var ratio = (event.clientX - rect.left) / rect.width;
            var targetT = t0 + ratio * span;
            var best = 0;
            var bestDelta = Infinity;
            points.forEach(function(p, i) {
                var delta = Math.abs(p.t - targetT);
                if (delta < bestDelta) { bestDelta = delta; best = i; }
            });
            options.onPick(best);
        };
    }

    function renderCharts() {
        if (!current) return;
        var gpsEvents = TM.maps.getGpsEvents(current.data.events || []);
        var accCanvas = current.panelEl.querySelector('[data-role="chart-acc"]');
        var gapCanvas = current.panelEl.querySelector('[data-role="chart-gap"]');
        if (!accCanvas || !gapCanvas || gpsEvents.length < 2) return;

        var accPoints = gpsEvents.map(function(e) { return { t: e.t, v: Number(e.data.acc) || 0 }; });
        var gapPoints = gpsEvents.map(function(e, i) {
            return { t: e.t, v: i === 0 ? 0 : (e.t - gpsEvents[i - 1].t) / 1000 };
        });

        drawSparkline(accCanvas, accPoints, { color: '#0dcaf0', unit: 'm', threshold: 20, minMax: 10, onPick: setScrub });
        drawSparkline(gapCanvas, gapPoints, { color: '#fd7e14', unit: 's', threshold: 8, minMax: 5, onPick: setScrub });
    }

    // ---- Scrubber ----

    function stepAtTime(events, t) {
        var step = null;
        for (var i = 0; i < events.length; i++) {
            if (events[i].t > t) break;
            var e = events[i];
            if (e.type === 'step_fire' && e.data && Number.isInteger(e.data.step)) step = e.data.step;
            else if (e.type === 'route_probe' && e.data && Number.isInteger(e.data.currentStep)) step = e.data.currentStep;
        }
        return step;
    }

    function setScrub(index) {
        if (!current || !current.mapHandle) return;
        var slider = current.panelEl.querySelector('[data-role="scrub"]');
        var readout = current.panelEl.querySelector('[data-role="scrub-readout"]');
        var fix = current.mapHandle.setScrub(index);
        if (!fix) return;
        if (slider && Number(slider.value) !== index) slider.value = index;

        var events = current.data.events || [];
        var gpsEvents = TM.maps.getGpsEvents(events);
        var startT = events.length ? events[0].t : fix.t;
        var prev = gpsEvents[index - 1];
        var parts = [
            new Date(fix.t).toLocaleTimeString('fr-FR'),
            '+' + Math.round((fix.t - startT) / 1000) + 's',
            'acc:' + (fix.data.acc != null ? fix.data.acc + 'm' : '?'),
            fix.data.source ? 'src:' + fix.data.source : null,
            prev ? 'Δ' + TM.util.formatGap(fix.t - prev.t) : null
        ];
        var step = stepAtTime(events, fix.t);
        if (step != null) parts.push('step:' + step);
        if (readout) readout.textContent = parts.filter(Boolean).join(' · ');
    }

    // ---- Events table (windowed rendering) ----

    var EVENT_ROW_HEIGHT = 25;
    var EVENT_WINDOW = 120;

    function eventDataString(event) {
        if (event.type === 'gps' && event.data) {
            return [
                Number(event.data.lat).toFixed(5) + ', ' + Number(event.data.lng).toFixed(5),
                'acc:' + event.data.acc + 'm',
                event.data.source ? 'src:' + event.data.source : null,
                event.data.callbackGapMs ? 'gap:' + event.data.callbackGapMs + 'ms' : null,
                event.data.ageMs ? 'age:' + event.data.ageMs + 'ms' : null,
                event.data.rejected ? 'rejected' : null
            ].filter(Boolean).join(' | ');
        }
        return JSON.stringify(event.data || {});
    }

    function renderEventsWindow() {
        if (!current || !current.eventsState) return;
        var st = current.eventsState;
        var wrap = current.panelEl.querySelector('.event-table-wrap');
        var tbody = current.panelEl.querySelector('[data-role="event-tbody"]');
        if (!wrap || !tbody) return;

        var visible = st.filtered;
        var total = visible.length;
        var start = Math.max(0, Math.floor(wrap.scrollTop / EVENT_ROW_HEIGHT) - 20);
        var end = Math.min(total, start + EVENT_WINDOW);
        var startT = (current.data.events && current.data.events.length) ? current.data.events[0].t : 0;

        var html = '';
        if (start > 0) html += '<tr style="height:' + (start * EVENT_ROW_HEIGHT) + 'px"><td colspan="4"></td></tr>';
        for (var i = start; i < end; i++) {
            var event = visible[i];
            var elapsed = ((event.t - startT) / 1000).toFixed(1);
            html += '<tr class="event-row event-' + esc(event.type) + '" data-ev-index="' + i + '">' +
                '<td>' + esc(new Date(event.t).toLocaleTimeString('fr-FR')) + '</td>' +
                '<td>' + esc(elapsed) + '</td>' +
                '<td><code>' + esc(event.type) + '</code></td>' +
                '<td class="event-data" title="Click to wrap">' + esc(eventDataString(event)) + '</td>' +
            '</tr>';
        }
        if (end < total) html += '<tr style="height:' + ((total - end) * EVENT_ROW_HEIGHT) + 'px"><td colspan="4"></td></tr>';
        tbody.innerHTML = html || '<tr><td colspan="4" class="text-muted">No events match the filters.</td></tr>';
    }

    function applyEventFilters() {
        if (!current || !current.eventsState) return;
        var st = current.eventsState;
        st.filtered = (current.data.events || []).filter(function(event) { return !st.hiddenTypes.has(event.type); });
        renderEventsWindow();
    }

    function setupEventPanel(errorFilterKind) {
        var panel = current.panelEl.querySelector('.event-panel');
        var filtersEl = current.panelEl.querySelector('[data-role="event-filters"]');
        var wrap = current.panelEl.querySelector('.event-table-wrap');
        var events = current.data.events || [];
        var types = Array.from(new Set(events.map(function(e) { return e.type; }))).sort();

        var hiddenTypes;
        var kinds = TM.list.ERROR_BADGE_KINDS;
        if (errorFilterKind && kinds[errorFilterKind]) {
            var allowed = new Set(kinds[errorFilterKind].types);
            hiddenTypes = new Set(types.filter(function(type) { return !allowed.has(type); }));
        } else {
            hiddenTypes = new Set(['gps']);
        }

        current.eventsState = { hiddenTypes: hiddenTypes, filtered: [] };

        filtersEl.innerHTML = '';
        types.forEach(function(type) {
            var badge = document.createElement('span');
            badge.className = 'badge bg-secondary badge-filter' + (hiddenTypes.has(type) ? '' : ' active');
            badge.textContent = type;
            badge.addEventListener('click', function() {
                if (hiddenTypes.has(type)) hiddenTypes.delete(type);
                else hiddenTypes.add(type);
                badge.classList.toggle('active');
                applyEventFilters();
            });
            filtersEl.appendChild(badge);
        });

        wrap.addEventListener('scroll', renderEventsWindow);
        wrap.addEventListener('click', function(event) {
            var row = event.target.closest('tr.event-row');
            if (row) row.classList.toggle('wrapped');
        });

        panel.dataset.rendered = '1';
        applyEventFilters();
    }

    // ---- Panel ----

    // Two map views (kept deliberately simple):
    //  - prog: step fire-status zones + accuracy-coloured track + problem pins
    //  - gps:  light step outlines + accuracy-coloured track + accuracy ribbon
    function mapViewControls() {
        var view = TM.state.mapView();
        var allZones = TM.state.allZones();
        return '<div class="btn-group btn-group-sm" role="group">' +
                '<button type="button" class="btn btn-outline-info' + (view === 'prog' ? ' active' : '') + '" data-role="view-prog">Progress</button>' +
                '<button type="button" class="btn btn-outline-info' + (view === 'gps' ? ' active' : '') + '" data-role="view-gps">GPS quality</button>' +
            '</div>' +
            '<div class="form-check form-switch form-check-inline mb-0 ms-2">' +
                '<input class="form-check-input" type="checkbox" role="switch" data-role="opt-zones"' + (allZones ? ' checked' : '') + '>' +
                '<label class="form-check-label small">All zones</label>' +
            '</div>';
    }

    function legendHtml() {
        var view = TM.state.mapView();
        var buckets = TM.maps.ACC_BUCKETS.map(function(bucket) {
            return '<span><span class="tm-legend-swatch" style="background:' + bucket.color + '"></span>' + esc(bucket.label) + '</span>';
        }).join('');
        var extras = '';
        if (view === 'prog') {
            extras = Object.keys(TM.maps.PROBLEM_STYLES).map(function(type) {
                var style = TM.maps.PROBLEM_STYLES[type];
                return '<span><span class="tm-legend-swatch" style="background:' + style.color + ';border-radius:50%"></span>' + esc(style.label) + '</span>';
            }).join('');
            extras += '<span><span class="tm-legend-swatch" style="background:transparent;border:1px dashed #dc3545"></span>step never fired</span>';
        } else {
            extras = '<span><span class="tm-legend-swatch" style="background:rgba(13,202,240,0.25);border-radius:50%"></span>accuracy ribbon</span>';
        }
        return '<div class="tm-map-legend">' + buckets + extras + '</div>';
    }

    function statusPill(summary) {
        return TM.list.statusPill(summary);
    }

    function renderPanel(opts) {
        var options = opts || {};
        var data = current.data;
        var metrics = computeMetrics(data);
        var summary = TM.api.getSession(data.sessionId, TM.state.archived());
        var archived = TM.state.archived();
        var gpsEvents = TM.maps.getGpsEvents(data.events || []);

        current.panelEl.innerHTML =
            '<div class="d-flex justify-content-between align-items-start gap-3 mb-3 flex-wrap">' +
                '<div><h5 class="mb-1">' + esc(data.parcoursName || data.parcoursId || '-') + ' ' + (summary ? statusPill(summary) : '') + '</h5>' +
                '<div class="text-secondary">' + esc(new Date(data.startTime).toLocaleString('fr-FR')) + '</div></div>' +
                '<div class="d-flex gap-2 flex-wrap">' +
                    '<button class="btn btn-outline-secondary btn-sm" data-action="toggle-events">Events</button>' +
                    '<button class="btn btn-outline-secondary btn-sm" data-action="export-json">JSON</button>' +
                    '<button class="btn btn-outline-secondary btn-sm" data-action="export-csv">CSV</button>' +
                    (archived
                        ? '<button class="btn btn-outline-warning btn-sm" data-action="unarchive-session">Unarchive</button>'
                        : '<button class="btn btn-outline-warning btn-sm" data-action="archive-session">Archive</button>') +
                    '<button class="btn btn-outline-danger btn-sm" data-action="delete-session">Delete</button>' +
                '</div>' +
            '</div>' +
            '<div class="metrics-grid">' + renderMetricCards(metrics) + '</div>' +
            '<div class="tm-detail-grid">' +
                '<div>' +
                    '<div class="d-flex gap-2 flex-wrap mb-2 align-items-center">' +
                        mapViewControls() +
                    '</div>' +
                    '<div id="tm-detail-map" class="tm-detail-map"></div>' +
                    legendHtml() +
                    '<div class="tm-scrub">' +
                        '<input type="range" class="form-range" data-role="scrub" min="0" max="' + Math.max(0, gpsEvents.length - 1) + '" value="0">' +
                        '<span class="tm-scrub-readout" data-role="scrub-readout">—</span>' +
                    '</div>' +
                    '<div class="tm-charts">' +
                        '<div class="tm-chart"><div class="tm-chart-title">GPS accuracy (m)</div><canvas data-role="chart-acc"></canvas></div>' +
                        '<div class="tm-chart"><div class="tm-chart-title">Fix interval (s)</div><canvas data-role="chart-gap"></canvas></div>' +
                    '</div>' +
                '</div>' +
                '<div class="tm-detail-side">' + renderSidebar(data, metrics) + '</div>' +
            '</div>' +
            '<div class="event-panel' + (options.openEvents ? ' active' : '') + '">' +
                '<div class="mb-2"><strong>Event filters</strong><div data-role="event-filters" class="mt-2"></div></div>' +
                '<div class="event-table-wrap"><table class="table table-sm mb-0"><thead><tr><th>Time</th><th>+sec</th><th>Type</th><th>Data</th></tr></thead>' +
                '<tbody data-role="event-tbody"></tbody></table></div>' +
            '</div>';

        bindPanelActions(options);
        renderMap();
        renderCharts();
        if (gpsEvents.length) setScrub(gpsEvents.length - 1);
        if (options.openEvents) setupEventPanel(options.errorFilterKind);
    }

    function currentMapOpts() {
        var view = TM.state.mapView();
        return {
            colored: true,
            ribbon: view === 'gps',
            problems: view === 'prog',
            fireStatus: view === 'prog',
            lightSteps: view === 'gps',
            allZones: TM.state.allZones()
        };
    }

    function renderMap() {
        if (current.mapHandle) { current.mapHandle.destroy(); current.mapHandle = null; }
        var mapEl = current.panelEl.querySelector('#tm-detail-map');
        if (!mapEl) return;
        current.mapHandle = TM.maps.renderDetailMap('tm-detail-map', current.data, current.overlay, currentMapOpts());
    }

    function bindPanelActions(options) {
        var panel = current.panelEl;
        var data = current.data;
        var archived = TM.state.archived();

        function rerenderMapControls() {
            var controlsRow = panel.querySelector('.tm-detail-grid .d-flex');
            if (controlsRow) controlsRow.innerHTML = mapViewControls();
            var legend = panel.querySelector('.tm-map-legend');
            if (legend) legend.outerHTML = legendHtml();
            bindMapViewControls();
            if (current.mapHandle) current.mapHandle.refresh(currentMapOpts());
        }

        function bindMapViewControls() {
            var progBtn = panel.querySelector('[data-role="view-prog"]');
            var gpsBtn = panel.querySelector('[data-role="view-gps"]');
            var zonesToggle = panel.querySelector('[data-role="opt-zones"]');
            if (progBtn) progBtn.addEventListener('click', function() {
                TM.state.set({ view: 'prog' });
                rerenderMapControls();
            });
            if (gpsBtn) gpsBtn.addEventListener('click', function() {
                TM.state.set({ view: 'gps' });
                rerenderMapControls();
            });
            if (zonesToggle) zonesToggle.addEventListener('change', function() {
                TM.state.set({ zones: zonesToggle.checked ? '1' : '0' });
                if (current.mapHandle) current.mapHandle.refresh(currentMapOpts());
            });
        }
        bindMapViewControls();

        panel.querySelector('[data-role="scrub"]').addEventListener('input', function() {
            setScrub(Number(this.value));
        });

        panel.querySelector('[data-action="toggle-events"]').addEventListener('click', function() {
            var eventPanel = panel.querySelector('.event-panel');
            eventPanel.classList.toggle('active');
            if (eventPanel.classList.contains('active') && !eventPanel.dataset.rendered) {
                setupEventPanel(options.errorFilterKind);
            }
        });

        panel.querySelector('[data-action="export-json"]').addEventListener('click', function() {
            TM.util.downloadText(data.sessionId + '.json', JSON.stringify(data, null, 2), 'application/json');
        });

        panel.querySelector('[data-action="export-csv"]').addEventListener('click', function() {
            var startT = (data.events && data.events.length) ? data.events[0].t : 0;
            var rows = (data.events || []).map(function(event) {
                return {
                    time: new Date(event.t).toISOString(),
                    elapsedSeconds: ((event.t - startT) / 1000).toFixed(1),
                    type: event.type,
                    data: JSON.stringify(event.data || {})
                };
            });
            TM.util.downloadText(data.sessionId + '-events.csv', TM.util.toCsv(rows), 'text/csv;charset=utf-8');
        });

        var copyLink = panel.querySelector('[data-action="copy-link"]');
        if (copyLink) copyLink.addEventListener('click', function() {
            var url = location.origin + location.pathname + '#s=' + encodeURIComponent(data.sessionId) +
                (TM.state.archived() ? '&tab=archive' : '');
            navigator.clipboard.writeText(url).then(function() {
                copyLink.textContent = '✓';
                setTimeout(function() { copyLink.textContent = '🔗'; }, 1200);
            });
        });

        panel.querySelector('[data-action="save-note"]').addEventListener('click', function() {
            var textarea = panel.querySelector('[data-role="note"]');
            var status = panel.querySelector('[data-role="note-status"]');
            status.textContent = '…';
            TM.api.saveNote(data.sessionId, textarea.value.trim())
                .then(function() {
                    status.textContent = 'saved';
                    setTimeout(function() { status.textContent = ''; }, 1500);
                    TM.list.render();
                })
                .catch(function(error) { status.textContent = 'failed: ' + error; });
        });

        var deleteButton = panel.querySelector('[data-action="delete-session"]');
        deleteButton.addEventListener('click', function() {
            if (!confirm('Delete session ' + data.sessionId + '?')) return;
            TM.api.deleteSession(data.sessionId, archived)
                .then(function() { close(); TM.list.render(); })
                .catch(function(error) { alert('Failed to delete session: ' + error); });
        });

        var archiveButton = panel.querySelector('[data-action="archive-session"]');
        if (archiveButton) archiveButton.addEventListener('click', function() {
            if (!confirm('Archive session ' + data.sessionId + '?')) return;
            TM.api.archiveSession(data.sessionId)
                .then(function() { close(); TM.list.render(); })
                .catch(function(error) { alert('Failed to archive session: ' + error); });
        });

        var unarchiveButton = panel.querySelector('[data-action="unarchive-session"]');
        if (unarchiveButton) unarchiveButton.addEventListener('click', function() {
            if (!confirm('Unarchive session ' + data.sessionId + '?')) return;
            TM.api.unarchiveSession(data.sessionId)
                .then(function() { close(); TM.list.render(); })
                .catch(function(error) { alert('Failed to unarchive session: ' + error); });
        });
    }

    // ---- Public lifecycle ----

    function open(sessionId, hostEl, opts) {
        var options = opts || {};
        closeInternal();
        TM.state.set({ s: sessionId });

        var panelEl = document.createElement('div');
        panelEl.className = 'tm-detail';
        panelEl.innerHTML = '<div class="text-muted">Loading detail…</div>';
        hostEl.appendChild(panelEl);

        current = { sessionId: sessionId, data: null, overlay: null, mapHandle: null, panelEl: panelEl, eventsState: null };

        TM.api.getDetail(sessionId, TM.state.archived(), { force: !!options.forceReload })
            .then(function(data) {
                if (!current || current.sessionId !== sessionId) return null;
                current.data = data;
                return TM.api.loadParcoursOverlay(data.parcoursId || data.parcoursName);
            })
            .then(function(overlay) {
                if (!current || current.sessionId !== sessionId || !current.data) return;
                current.overlay = overlay;
                renderPanel(options);
            })
            .catch(function(error) {
                if (!current || current.sessionId !== sessionId) return;
                panelEl.innerHTML = '<div class="text-danger">Failed to load detail: ' + esc(String(error)) + '</div>';
            });
    }

    function closeInternal() {
        if (!current) return;
        if (current.mapHandle) current.mapHandle.destroy();
        if (current.panelEl && current.panelEl.parentNode) current.panelEl.parentNode.removeChild(current.panelEl);
        current = null;
    }

    function close() {
        closeInternal();
        TM.state.set({ s: '' });
    }

    // Reattach the live panel after a list re-render. The panel element (and
    // its Leaflet map) survives reparenting, so no rebuild — this keeps the
    // 30 s live polls from flashing the map.
    function remount(hostEl) {
        if (!current || !current.panelEl) return;
        if (current.panelEl.parentNode !== hostEl) hostEl.appendChild(current.panelEl);
        if (current.mapHandle) {
            setTimeout(function() {
                if (current && current.mapHandle) current.mapHandle.map.invalidateSize();
            }, 60);
        }
    }

    // Live tail: append new events, refresh metrics/map/charts in place.
    function liveTick() {
        if (!current || !current.data) return Promise.resolve(false);
        var sessionId = current.sessionId;
        return TM.api.getDetailTail(sessionId, TM.state.archived()).then(function(fresh) {
            if (!current || current.sessionId !== sessionId || !fresh.length) return false;
            var metrics = computeMetrics(current.data);
            var grid = current.panelEl.querySelector('.metrics-grid');
            if (grid) grid.innerHTML = renderMetricCards(metrics);
            if (current.mapHandle) current.mapHandle.appendEvents();
            var gpsEvents = TM.maps.getGpsEvents(current.data.events || []);
            var slider = current.panelEl.querySelector('[data-role="scrub"]');
            if (slider) slider.max = Math.max(0, gpsEvents.length - 1);
            renderCharts();
            if (current.eventsState) applyEventFilters();
            return true;
        }).catch(function() { return false; });
    }

    return {
        open: open,
        close: close,
        remount: remount,
        liveTick: liveTick,
        currentSessionId: currentSessionId
    };
})();
