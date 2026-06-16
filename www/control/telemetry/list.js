/* Telemetry page — session list rendering.
 * Pinned IN PROGRESS section, day sections with stats + timeline strip,
 * device groups (uuid) with onboarding folding and restart chips,
 * error badges with popovers, per-group track maps, day exports. */
window.TM = window.TM || {};

TM.list = (function() {
    var esc = function(s) { return TM.util.esc(s); };

    var ERROR_BADGE_KINDS = {
        gap: {
            label: 'Callback gaps',
            types: ['gps_callback_gap'],
            sortKey: function(event) { return -(Number(event.data && event.data.gapMs) || 0); },
            describe: function(event) {
                var data = event.data || {};
                return [
                    data.gapMs != null ? 'gap:' + TM.util.formatGap(Number(data.gapMs)) : null,
                    data.source ? 'src:' + data.source : null,
                    data.visibility ? 'vis:' + data.visibility : null,
                    data.acc != null ? 'acc:' + data.acc + 'm' : null
                ].filter(Boolean).join(' · ');
            }
        },
        sleep: {
            label: 'Sleep suspects',
            types: ['gps_sleep_suspect'],
            describe: function(event) {
                var data = event.data || {};
                return [
                    data.gapMs != null ? 'gap:' + TM.util.formatGap(Number(data.gapMs)) : null,
                    data.source ? 'src:' + data.source : null,
                    data.acc != null ? 'acc:' + data.acc + 'm' : null,
                    data.motionStationary != null ? 'still:' + data.motionStationary : null
                ].filter(Boolean).join(' · ');
            }
        },
        stale: {
            label: 'Stale callbacks',
            types: ['gps_stale_callback'],
            describe: function(event) {
                var data = event.data || {};
                return [
                    data.ageMs != null ? 'age:' + TM.util.formatGap(Number(data.ageMs)) : null,
                    data.source ? 'src:' + data.source : null
                ].filter(Boolean).join(' · ');
            }
        },
        reject: {
            label: 'Rejected fixes',
            types: ['gps_trigger_rejected'],
            describe: function(event) {
                var data = event.data || {};
                return [
                    data.reason ? 'reason:' + data.reason : null,
                    data.acc != null ? 'acc:' + data.acc + 'm' : null,
                    data.source ? 'src:' + data.source : null,
                    data.visibility ? 'vis:' + data.visibility : null
                ].filter(Boolean).join(' · ');
            }
        },
        audio: {
            label: 'Audio errors',
            types: ['audio_loaderror', 'audio_playerror', 'audio_play_timeout'],
            describe: function(event) {
                var data = event.data || {};
                var src = data.src || '';
                var fileName = src ? src.split('/').pop() : '';
                return [
                    event.type,
                    data.error ? 'error:' + data.error : null,
                    fileName ? 'file:' + fileName : null
                ].filter(Boolean).join(' · ');
            }
        }
    };

    var activeErrorPopover = null;
    var dayToggles = new Map();       // dayKey -> bool (user override: true=open)
    var onbExpanded = new Set();      // groupDomKey
    var trackMapOpen = new Map();     // trackKey -> explicit bool (overrides default)
    var trackMapModes = new Map();    // trackKey -> 'tracks' | 'accuracy'
    var trackMapHandles = [];         // destroyed on each render
    var trackMapRenderToken = 0;      // guards superseded async map builds
    var LIVE_MAP_KEY = 'live:all';    // shared IN PROGRESS map
    var timelineView = new Map();     // tlKey -> { factor, center } (zoom state)
    var selectedIds = new Set();      // multi-selection (selective delete/archive)
    var lastCheckedId = null;         // shift-click range anchor

    // ---- Status helpers ----

    function statusShort(status) {
        if (status === 'live') return 'live';
        if (status === 'ended-complete') return 'complete';
        if (status === 'ended-partial') return 'partial';
        return 'interrupted';
    }

    function statusPill(summary) {
        var status = TM.api.statusOf(summary);
        if (status === 'live') return '<span class="badge text-bg-info">LIVE</span>';
        if (status === 'ended-complete') return '<span class="badge text-bg-success">✓ complete</span>';
        if (status === 'ended-partial') return '<span class="badge text-bg-secondary">ended' + (summary.finalStep != null ? ' @' + esc(summary.finalStep) : '') + '</span>';
        return '<span class="badge border border-danger text-danger bg-transparent">interrupted</span>';
    }

    function statusColor(status) {
        if (status === 'live') return '#0dcaf0';
        if (status === 'ended-complete') return '#198754';
        if (status === 'ended-partial') return '#6c757d';
        return '#dc3545';
    }

    // ---- Filtering ----

    function parcoursLabel(summary) {
        return String(summary.parcoursName || summary.parcoursId || '').replace(/^onb:/, '');
    }

    function getFilteredSessions() {
        var archived = TM.state.archived();
        var sessions = TM.api.getSessions(archived);
        var parcoursValue = TM.state.get('parcours');
        var kind = TM.state.get('kind');
        var sim = TM.state.get('sim');
        var statuses = TM.state.statusSet();
        var dev = TM.state.get('dev');
        var query = TM.state.get('q').trim().toLowerCase();
        var hours = TM.state.hourRange();
        var prog = TM.state.progRange();
        var progFiltered = prog[0] > 0 || prog[1] < 100;

        return sessions.filter(function(summary) {
            if (parcoursValue && parcoursLabel(summary) !== parcoursValue) return false;
            if (kind === 'walk' && summary.kind !== 'walk') return false;
            if (kind === 'onb' && summary.kind !== 'onboarding') return false;
            if (sim === 'hide' && summary.isSimulation) return false;
            if (sim === 'only' && !summary.isSimulation) return false;
            if (dev && summary.deviceUuid !== dev) return false;
            if (query && String(summary.sessionId || '').toLowerCase().indexOf(query) === -1) return false;

            var start = new Date(summary.startTime);
            if (!isNaN(start.getTime())) {
                var hour = start.getHours();
                if (hour < hours[0] || hour >= hours[1]) return false;
            }

            if (progFiltered) {
                if (summary.progressPct == null) return false;
                if (summary.progressPct < prog[0] || summary.progressPct > prog[1]) return false;
            }

            if (statuses && !statuses.has(statusShort(TM.api.statusOf(summary)))) return false;
            return true;
        });
    }

    function parcoursOptions() {
        var labels = new Set();
        TM.api.getSessions(TM.state.archived()).forEach(function(summary) {
            var label = parcoursLabel(summary);
            if (label) labels.add(label);
        });
        return Array.from(labels).sort();
    }

    function deviceLabelFor(summary) {
        var device = TM.api.getDevice(summary.deviceUuid);
        if (device && device.friendly_name) return device.friendly_name;
        return summary.deviceModel || summary.devicePlatform || 'unknown device';
    }

    // Highest appVersion seen among same-day sessions — the reference for
    // "this phone ran an older build than the rest of the fleet that day".
    function dayMaxApk(dayKeyStr) {
        var max = 0;
        TM.api.getSessions(TM.state.archived()).forEach(function(summary) {
            if (TM.util.dayKey(summary.startTime) !== dayKeyStr) return;
            var v = Number(summary.appVersion);
            if (Number.isFinite(v)) max = Math.max(max, v);
        });
        return max || null;
    }

    function deviceOptions() {
        var byUuid = new Map();
        TM.api.getSessions(TM.state.archived()).forEach(function(summary) {
            if (!summary.deviceUuid) return;
            if (!byUuid.has(summary.deviceUuid)) {
                byUuid.set(summary.deviceUuid, deviceLabelFor(summary) + ' · ' + summary.deviceUuid.slice(0, 4) + (summary.isLoanDevice ? ' · loan' : ''));
            }
        });
        return Array.from(byUuid.entries()).sort(function(a, b) { return a[1].localeCompare(b[1]); });
    }

    // ---- View model ----

    function groupKeyFor(summary) {
        return summary.deviceUuid || ('label:' + (summary.deviceModel || 'unknown'));
    }

    function buildGroups(sessions) {
        var groups = new Map();
        sessions.forEach(function(summary) {
            var key = groupKeyFor(summary);
            if (!groups.has(key)) groups.set(key, { key: key, sessions: [] });
            groups.get(key).sessions.push(summary);
        });

        var groupList = Array.from(groups.values());
        if (TM.state.get('sort') === 'worst') {
            groupList.sort(function(a, b) {
                var worstA = Math.min.apply(null, a.sessions.map(TM.util.healthScore));
                var worstB = Math.min.apply(null, b.sessions.map(TM.util.healthScore));
                return worstA - worstB;
            });
        } else {
            groupList.sort(function(a, b) { return new Date(a.sessions[0].startTime) - new Date(b.sessions[0].startTime); });
        }
        return groupList;
    }

    function buildDays(sessions) {
        var byDay = new Map();
        sessions.forEach(function(summary) {
            var key = TM.util.dayKey(summary.startTime);
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(summary);
        });

        var dayKeys = Array.from(byDay.keys()).sort().reverse();
        return dayKeys.map(function(dayKey) {
            var daySessions = byDay.get(dayKey);
            daySessions.sort(function(a, b) { return new Date(a.startTime) - new Date(b.startTime); });

            // Split per parcours so multi-parcours days (testing) keep their
            // timelines, maps and device groups distinct.
            var byParcours = new Map();
            daySessions.forEach(function(summary) {
                var label = parcoursLabel(summary) || '—';
                if (!byParcours.has(label)) byParcours.set(label, []);
                byParcours.get(label).push(summary);
            });
            var multi = byParcours.size > 1;
            var sections = Array.from(byParcours.entries()).map(function(entry) {
                var prefix = multi ? dayKey + '|' + entry[0] : dayKey;
                return {
                    label: entry[0],
                    sessions: entry[1],
                    prefix: prefix,
                    trackKey: 'day:' + prefix,
                    groups: buildGroups(entry[1])
                };
            }).sort(function(a, b) { return new Date(a.sessions[0].startTime) - new Date(b.sessions[0].startTime); });

            var walks = daySessions.filter(function(s) { return s.kind === 'walk'; });
            var stats = {
                devices: new Set(daySessions.map(groupKeyFor)).size,
                walks: walks.length,
                complete: walks.filter(function(s) { return TM.api.statusOf(s) === 'ended-complete'; }).length,
                onboarding: daySessions.length - walks.length,
                anomaly: daySessions.some(function(s) {
                    return Number(s.sleepSuspects) > 0 || TM.api.statusOf(s) === 'interrupted';
                })
            };

            return { dayKey: dayKey, sessions: daySessions, sections: sections, multi: multi, stats: stats };
        });
    }

    // ---- Row rendering ----

    // One overall GPS-quality chip (avg accuracy, coloured by bucket).
    function accChip(summary) {
        var accuracy = Number(summary.avgAccuracy);
        if (!Number.isFinite(accuracy)) {
            return '<span class="tm-chip-q" style="color:rgba(255,255,255,0.4)" title="no GPS data">gps ?</span>';
        }
        var color = TM.maps.ACC_BUCKETS[TM.maps.accBucket(accuracy)].color;
        return '<span class="tm-chip-q" style="color:' + color + '" title="avg GPS accuracy">' +
            '<span class="tm-chip-dot" style="background:' + color + '"></span>' +
            esc(TM.util.formatNumber(accuracy, 1)) + 'm</span>';
    }

    // Health score chip (0..100, 100 = clean); click opens the anomaly popover.
    function healthChip(summary) {
        var score = TM.util.healthScore(summary);
        return '<span class="badge tm-health-chip" style="background:' + TM.util.healthColor(score) + '" ' +
            'tabindex="0" role="button" title="health ' + score + '/100 — click for anomalies">' + esc(score) + '</span>';
    }

    // Step segments: green = fired, red = reached but never fired (missed),
    // dark grey = not reached yet, pulsing blue = current step of a live walk.
    // Shared by the row progress bar and the day timeline bars.
    function stepSegmentsHtml(summary, withTitles) {
        var live = TM.api.statusOf(summary) === 'live';
        var fired = new Set(Array.isArray(summary.firedSteps) ? summary.firedSteps : []);
        var reachedUpTo = Number.isInteger(summary.finalStep) ? summary.finalStep : -1;
        var segments = '';
        for (var i = 0; i < summary.totalSteps; i++) {
            var color;
            var hint;
            var cls = '';
            if (live && i === reachedUpTo) { color = '#0dcaf0'; hint = 'step ' + i + ' — LIVE, walker here'; cls = ' class="tm-step-live"'; }
            else if (fired.has(i)) { color = '#198754'; hint = 'step ' + i + ' fired'; }
            else if (i <= reachedUpTo) { color = '#dc3545'; hint = 'step ' + i + ' MISSED'; }
            else { color = 'rgba(255,255,255,0.13)'; hint = 'step ' + i + ' not reached'; }
            segments += '<span' + cls + ' style="background:' + color + '"' + (withTitles ? ' title="' + esc(hint) + '"' : '') + '></span>';
        }
        return segments;
    }

    function progressHtml(summary) {
        if (summary.kind !== 'walk' || !(summary.totalSteps > 0)) {
            return '<span class="tm-progress-label">' + (summary.finalStep != null ? 'step ' + esc(summary.finalStep) : '—') + '</span>';
        }
        return '<div class="tm-progress">' +
            '<div class="tm-stepbar">' + stepSegmentsHtml(summary, true) + '</div>' +
            '<span class="tm-progress-label">' + (summary.finalStep != null ? (summary.finalStep + 1) : '?') + '/' + esc(summary.totalSteps) + '</span>' +
        '</div>';
    }

    function renderRow(summary, opts) {
        var options = opts || {};
        var status = TM.api.statusOf(summary);
        var expanded = TM.detail.currentSessionId() === summary.sessionId;
        var note = TM.api.getNote(summary.sessionId);
        var chips = [];
        if (Number(summary.resumeCount) > 0) chips.push('<span class="badge text-bg-secondary">resume x' + esc(summary.resumeCount) + '</span>');
        if (note) chips.push('<span class="tm-note-ic" title="' + esc(note) + '">✎</span>');

        var ago = status === 'live'
            ? ' <span class="small text-info" data-role="ago" data-last="' + esc(summary.lastEvent || '') + '"></span>'
            : '';

        var shortCode = String(summary.sessionId || '').split('_').pop();

        return '<div class="tm-row' + (expanded ? ' active' : '') + (options.alt ? ' tm-row-alt' : '') + (summary.kind === 'onboarding' ? ' tm-row-onb' : '') + (summary.isSimulation ? ' tm-row-sim' : '') + '" ' +
            'data-session-id="' + esc(summary.sessionId) + '" title="' + esc(summary.sessionId + ' · ' + status + (summary.isSimulation ? ' · simulation' : '')) + '">' +
            '<div class="tm-row-checkcell"><input type="checkbox" class="form-check-input tm-row-check"' + (selectedIds.has(summary.sessionId) ? ' checked' : '') + '></div>' +
            '<div class="tm-row-time">' + esc(TM.util.formatTime(summary.startTime)) +
                '<span class="tm-row-code">' + esc(shortCode) + '</span></div>' +
            '<div class="tm-row-parcours">' + esc(parcoursLabel(summary) || '-') +
                (summary.kind === 'onboarding' ? ' <span class="badge text-bg-dark">onb</span>' : '') +
                (summary.isSimulation ? ' <span class="badge tm-sim-badge" title="GPS-simulated walk">sim</span>' : '') +
                (chips.length ? ' ' + chips.join(' ') : '') + '</div>' +
            '<div class="tm-row-duration">' + esc(TM.util.formatDuration(summary.durationMs)) + '</div>' +
            '<div class="tm-row-prog">' + progressHtml(summary) + '</div>' +
            '<div class="tm-row-q">' + accChip(summary) + healthChip(summary) + ago + '</div>' +
            '<div class="tm-row-chevron">›</div>' +
        '</div>';
    }

    function renderGroup(group, dayKey, prefix) {
        var domKey = prefix + '/' + group.key;
        var first = group.sessions[0];
        var device = TM.api.getDevice(first.deviceUuid);
        var friendly = device && device.friendly_name;
        var label = friendly || deviceLabelFor(first);
        var walks = group.sessions.filter(function(s) { return s.kind === 'walk'; });
        var onbs = group.sessions.filter(function(s) { return s.kind === 'onboarding'; });
        var fleetApk = dayMaxApk(dayKey);
        var apk = first.appVersion != null ? Number(first.appVersion) : (device ? Number(device.apk_version) : null);
        var apkStale = fleetApk && Number.isFinite(apk) && apk < fleetApk;

        var header = '<div class="tm-group-header">' +
            '<input type="checkbox" class="form-check-input tm-group-check" title="select all sessions of this device">' +
            '<span class="tm-group-device">📱 ' + esc(label) + '</span>' +
            (friendly ? '<span class="text-secondary small">' + esc(deviceLabelFor(Object.assign({}, first, { deviceUuid: null }))) + '</span>' : '') +
            (first.deviceUuid
                ? '<span class="tm-group-uuid">' + esc(first.deviceUuid.slice(0, 8)) + '</span>' +
                  '<button class="tm-rename-btn" data-action="rename-device" data-uuid="' + esc(first.deviceUuid) + '" title="Rename device">✎</button>'
                : '') +
            (first.isLoanDevice ? '<span class="badge tm-loan-badge" title="loan-fleet device">loan</span>' : '') +
            (apk != null && Number.isFinite(apk) ? '<span class="badge text-bg-' + (apkStale ? 'secondary' : 'dark') + '"' + (apkStale ? ' title="older than the day\'s fleet max"' : '') + '>apk ' + esc(apk) + (apkStale ? ' stale' : '') + '</span>' : '') +
            '<div class="tm-group-meta">' +
                '<span>' + walks.length + ' walk' + (walks.length > 1 ? 's' : '') + (onbs.length ? ' + ' + onbs.length + ' onb' : '') + '</span>' +
                (walks.length > 1 ? '<button class="btn btn-outline-secondary btn-sm py-0" data-action="toggle-tracks" data-track-key="' + esc(domKey) + '">Tracks</button>' : '') +
            '</div>' +
        '</div>';

        var kind = TM.state.get('kind');
        var rows = '';
        var visibleIndex = 0;
        group.sessions.forEach(function(summary) {
            if (summary.kind === 'onboarding' && kind === 'all' && !onbExpanded.has(domKey)) return;
            rows += renderRow(summary, { alt: visibleIndex % 2 === 1 });
            visibleIndex += 1;
            if (TM.detail.currentSessionId() === summary.sessionId) {
                rows += '<div class="tm-detail-host" data-host-for="' + esc(summary.sessionId) + '"></div>';
            }
        });

        var fold = '';
        if (onbs.length && kind === 'all') {
            fold = '<div class="tm-onb-fold" data-action="toggle-onb" data-onb-key="' + esc(domKey) + '">' +
                (onbExpanded.has(domKey) ? '▾ hide' : '▸ ' + onbs.length) + ' onboarding session' + (onbs.length > 1 ? 's' : '') +
                (onbExpanded.has(domKey) ? '' : ' (' + onbs.map(function(s) { return TM.util.formatDuration(s.durationMs); }).join(', ') + ')') +
            '</div>';
        }

        return '<div class="tm-group">' + header + trackHostHtml(domKey) + rows + fold + '</div>';
    }

    // Day/parcours timeline: each bar is the session's step-block graph
    // placed on the time axis, with a thin health-coloured strip underneath
    // and an hourly grid behind. Zoomable (full span down to a 2 h window)
    // with horizontal scrolling; zoom state is kept per timeline in
    // timelineView so it survives re-renders.
    var TIMELINE_MIN_WINDOW_MS = 2 * 3600 * 1000;

    function renderTimeline(sessions, tlKey) {
        if (sessions.length < 2) return '';
        var starts = sessions.map(function(s) { return new Date(s.startTime).getTime(); });
        var ends = sessions.map(function(s, i) { return Math.max(Number(s.lastEvent) || 0, starts[i]); });
        var min = Math.min.apply(null, starts);
        var max = Math.max.apply(null, ends);
        var span = Math.max(60000, max - min);

        var maxFactor = Math.max(1, span / TIMELINE_MIN_WINDOW_MS);
        var view = timelineView.get(tlKey);
        var factor = Math.min(maxFactor, Math.max(1, (view && view.factor) || 1));

        var rows = sessions.map(function(summary, index) {
            var left = ((starts[index] - min) / span) * 100;
            var width = Math.max(0.6 / factor, ((ends[index] - starts[index]) / span) * 100);
            var status = TM.api.statusOf(summary);
            var health = TM.util.healthScore(summary);

            var steps = (summary.kind === 'walk' && summary.totalSteps > 0)
                ? stepSegmentsHtml(summary, false)
                : '<span style="background:' + statusColor(status) + ';opacity:0.45"></span>';

            return '<div class="tm-timeline-row"><div class="tm-timeline-bar" ' +
                'style="left:' + left.toFixed(3) + '%;width:' + width.toFixed(3) + '%" ' +
                'data-timeline-session="' + esc(summary.sessionId) + '" ' +
                'title="' + esc(summary.sessionId + ' · ' + deviceLabelFor(summary) + ' · ' + TM.util.formatDuration(summary.durationMs) + ' · ' + status + ' · health ' + health + '/100') + '">' +
                '<div class="tm-tlbar-steps">' + steps + '</div>' +
                '<div class="tm-tlbar-health" style="background:' + TM.util.healthColor(health) + '"></div>' +
            '</div></div>';
        }).join('');

        // Hourly grid lines; labels thinned only when they would crowd the
        // visible window.
        var grid = '';
        var axis = '';
        var labelStep = Math.max(1, Math.ceil((span / 3600000) / (10 * factor)));
        var tick = new Date(min);
        tick.setMinutes(0, 0, 0);
        var tickMs = tick.getTime();
        while (tickMs <= min) tickMs += 3600000;
        for (var hourIndex = 0; tickMs < max; tickMs += 3600000, hourIndex++) {
            var x = ((tickMs - min) / span) * 100;
            grid += '<div class="tm-timeline-gridline" style="left:' + x.toFixed(3) + '%"></div>';
            if (hourIndex % labelStep === 0) {
                axis += '<span style="left:' + x.toFixed(3) + '%">' + new Date(tickMs).getHours() + 'h</span>';
            }
        }

        var zoom = maxFactor > 1
            ? '<div class="tm-timeline-top"><div class="btn-group btn-group-sm">' +
                '<button class="btn btn-outline-secondary py-0" data-action="tl-zoom" data-dir="out" data-tl-key="' + esc(tlKey) + '"' + (factor <= 1 ? ' disabled' : '') + '>−</button>' +
                '<button class="btn btn-outline-secondary py-0" data-action="tl-zoom" data-dir="in" data-tl-key="' + esc(tlKey) + '"' + (factor >= maxFactor ? ' disabled' : '') + '>+</button>' +
              '</div></div>'
            : '';

        return zoom +
            '<div class="tm-timeline-wrap" data-tl-key="' + esc(tlKey) + '">' +
                '<div class="tm-timeline-inner" style="width:' + (factor * 100).toFixed(1) + '%">' +
                    '<div class="tm-timeline">' + grid + rows + '</div>' +
                    '<div class="tm-timeline-axis">' + axis + '</div>' +
                '</div>' +
            '</div>';
    }

    function restoreTimelineScroll() {
        document.querySelectorAll('.tm-timeline-wrap[data-tl-key]').forEach(function(wrap) {
            var view = timelineView.get(wrap.dataset.tlKey);
            if (!view || !view.factor || view.factor <= 1) return;
            var center = Number.isFinite(view.center) ? view.center : 0.5;
            wrap.scrollLeft = Math.max(0, center * wrap.scrollWidth - wrap.clientWidth / 2);
        });
    }

    function isDayOpen(dayKey, index) {
        if (dayToggles.has(dayKey)) return dayToggles.get(dayKey);
        return dayKey === TM.util.dayKey(Date.now()); // only today open by default
    }

    // The day/parcours-section summary map is shown by default (when its day is
    // expanded); per-device group maps default closed. A user toggle stores an
    // explicit override either way.
    function isTrackOpen(trackKey, defaultOpen) {
        return trackMapOpen.has(trackKey) ? trackMapOpen.get(trackKey) : !!defaultOpen;
    }

    function trackHostHtml(trackKey, defaultOpen) {
        if (!isTrackOpen(trackKey, defaultOpen)) return '';
        var mode = trackMapModes.get(trackKey) || 'tracks';
        return '<div class="tm-trackmap-bar">' +
            '<div class="btn-group btn-group-sm">' +
                '<button class="btn btn-outline-secondary py-0' + (mode === 'tracks' ? ' active' : '') + '" data-action="trackmap-mode" data-mode="tracks" data-track-key="' + esc(trackKey) + '">Tracks</button>' +
                '<button class="btn btn-outline-secondary py-0' + (mode === 'accuracy' ? ' active' : '') + '" data-action="trackmap-mode" data-mode="accuracy" data-track-key="' + esc(trackKey) + '" title="median GPS accuracy per ~25m cell across devices, all walks aggregated">Avg accuracy</button>' +
            '</div></div>' +
            '<div class="tm-group-map" data-track-map="' + esc(trackKey) + '"></div>';
    }

    function renderDay(day, index) {
        var open = isDayOpen(day.dayKey, index);
        var stats = day.stats;

        var statsHtml = '<div class="tm-day-stats">' +
            (stats.anomaly ? '<span class="tm-day-anomaly" title="sleep suspects or interrupted sessions"></span>' : '') +
            '<span>' + stats.devices + ' device' + (stats.devices > 1 ? 's' : '') + '</span>' +
            '<span>' + stats.walks + ' walk' + (stats.walks > 1 ? 's' : '') + (stats.walks ? ' (' + stats.complete + ' ✓)' : '') + '</span>' +
            (stats.onboarding ? '<span>' + stats.onboarding + ' onb</span>' : '') +
            (day.multi ? '<span>' + day.sections.length + ' parcours</span>' : '') +
        '</div>';

        var dayMapOpen = !day.multi && isTrackOpen(day.sections[0].trackKey, open);
        var actions = '<div class="tm-day-actions">' +
            (day.multi ? '' : '<button class="btn btn-outline-secondary btn-sm py-0" data-action="toggle-tracks" data-track-key="' + esc(day.sections[0].trackKey) + '" title="All day tracks on one map">' + (dayMapOpen ? 'Hide map' : 'Map') + '</button>') +
            '<div class="dropdown">' +
                '<button class="btn btn-outline-secondary btn-sm py-0 dropdown-toggle" data-bs-toggle="dropdown">⋯</button>' +
                '<ul class="dropdown-menu dropdown-menu-end">' +
                    '<li><a class="dropdown-item" href="#" data-action="export-day" data-format="csv" data-day="' + esc(day.dayKey) + '">Export day CSV</a></li>' +
                    '<li><a class="dropdown-item" href="#" data-action="export-day" data-format="json" data-day="' + esc(day.dayKey) + '">Export day JSON</a></li>' +
                '</ul>' +
            '</div>' +
        '</div>';

        var body = day.sections.map(function(section) {
            var sectionMapOpen = isTrackOpen(section.trackKey, open);
            var head = day.multi
                ? '<div class="tm-parcours-head">' +
                    '<span class="tm-parcours-title">' + esc(section.label) + '</span>' +
                    '<span class="text-secondary small">' + section.sessions.length + ' session' + (section.sessions.length > 1 ? 's' : '') + '</span>' +
                    '<button class="btn btn-outline-secondary btn-sm py-0 ms-auto" data-action="toggle-tracks" data-track-key="' + esc(section.trackKey) + '">' + (sectionMapOpen ? 'Hide map' : 'Map') + '</button>' +
                  '</div>'
                : '';
            var inner = head +
                renderTimeline(section.sessions, section.prefix) +
                trackHostHtml(section.trackKey, open) +
                section.groups.map(function(group) { return renderGroup(group, day.dayKey, section.prefix); }).join('');
            return day.multi ? '<div class="tm-parcours-section">' + inner + '</div>' : inner;
        }).join('');

        return '<div class="tm-day' + (open ? '' : ' collapsed') + '" data-day="' + esc(day.dayKey) + '">' +
            '<div class="tm-day-header" data-action="toggle-day" data-day-key="' + esc(day.dayKey) + '">' +
                '<span class="tm-day-caret">▼</span>' +
                '<span class="tm-day-title">' + esc(TM.util.dayLabel(day.dayKey)) + '</span>' +
                statsHtml + actions +
            '</div>' +
            '<div class="tm-day-body">' + body + '</div>' +
        '</div>';
    }

    // ---- Group track maps ----

    function renderTrackMaps(filteredByKey) {
        trackMapHandles.forEach(function(handle) { try { handle.destroy(); } catch (e) {} });
        trackMapHandles = [];
        // Each render gets a generation token. Track map builds are async
        // (they fetch walk details first); a render that supersedes this one
        // bumps the token, so a late-resolving build bails instead of calling
        // L.map() on a container the next render already initialized.
        var token = ++trackMapRenderToken;

        document.querySelectorAll('[data-track-map]').forEach(function(mapEl) {
            var key = mapEl.dataset.trackMap;
            var isLiveMap = key === LIVE_MAP_KEY;
            var mode = isLiveMap ? 'tracks' : (trackMapModes.get(key) || 'tracks');
            var sessions = filteredByKey.get(key) || [];
            // The accuracy heat reflects real-world GPS quality, so exclude
            // GPS-simulated walks (their faked fixes would distort the cells).
            if (mode === 'accuracy') sessions = sessions.filter(function(s) { return !s.isSimulation; });
            // Track readability caps at 8; the live map shows the whole fleet's
            // current positions, the accuracy heat aggregates many more.
            sessions = sessions.slice(0, isLiveMap ? 20 : (mode === 'accuracy' ? 24 : 8));
            if (!sessions.length) return;

            // The live map needs current data — pull each session's incremental
            // tail (updates the cache) so the "now" markers actually advance.
            var fetchItem = function(summary) {
                var get = isLiveMap
                    ? TM.api.getDetailTail(summary.sessionId, false).then(function() { return TM.api.getDetail(summary.sessionId, false); })
                    : TM.api.getDetail(summary.sessionId, TM.state.archived());
                return get.then(function(data) { return { session: summary, data: data }; });
            };

            Promise.all(sessions.map(fetchItem)).then(function(items) {
                var ids = Array.from(new Set(items.map(function(item) {
                    return String(item.data.parcoursId || item.data.parcoursName || '').replace(/^onb:/, '');
                }).filter(Boolean)));
                var overlayPromise = ids.length === 1 ? TM.api.loadParcoursOverlay(ids[0]) : Promise.resolve(null);
                return overlayPromise.then(function(overlay) {
                    // Superseded by a newer render, or the element was rebuilt
                    // out of the DOM — don't init a map on a stale container.
                    if (token !== trackMapRenderToken || !mapEl.isConnected) return;
                    trackMapHandles.push(TM.maps.renderGroupMap(mapEl, items, overlay, {
                        viewKey: 'tracks:' + key,
                        mode: mode,
                        live: isLiveMap,
                        onTrackHover: previewRow,
                        onTrackClick: jumpToRow
                    }));
                });
            }).catch(function(error) {
                if (token !== trackMapRenderToken || !mapEl.isConnected) return;
                mapEl.innerHTML = '<div class="text-danger p-2">Failed to load tracks: ' + esc(String(error)) + '</div>';
            });
        });
    }

    // ---- Error popovers (ported) ----

    function dismissErrorPopover() {
        if (!activeErrorPopover) return;
        try { activeErrorPopover.popover.dispose(); } catch (e) {}
        activeErrorPopover = null;
        document.removeEventListener('click', onDocumentClickForPopover, true);
        document.removeEventListener('keydown', onKeydownForPopover, true);
    }

    function getActivePopoverEl() {
        if (!activeErrorPopover) return null;
        var id = activeErrorPopover.trigger.getAttribute('aria-describedby');
        return id ? document.getElementById(id) : null;
    }

    function onDocumentClickForPopover(event) {
        if (!activeErrorPopover) return;
        var trigger = activeErrorPopover.trigger;
        var popoverEl = getActivePopoverEl();
        if (trigger && trigger.contains(event.target)) return;
        if (popoverEl && popoverEl.contains(event.target)) return;
        dismissErrorPopover();
    }

    function onKeydownForPopover(event) {
        if (event.key === 'Escape') dismissErrorPopover();
    }

    function healthPopoverBody(summary) {
        var lines = [];
        var fired = new Set(Array.isArray(summary.firedSteps) ? summary.firedSteps : []);
        var reached = (Number.isInteger(summary.finalStep) ? summary.finalStep : -1) + 1;
        var missed = 0;
        for (var i = 0; i < reached; i++) if (!fired.has(i)) missed++;
        if (missed > 0) lines.push([null, 'Missed steps ×' + missed + ' (content not delivered)']);
        if (summary.maxGapMs != null && Number(summary.maxGapMs) >= 8000) {
            lines.push(['gap', 'Worst callback gap ' + TM.util.formatGap(Number(summary.maxGapMs))]);
        }
        if (Number(summary.sleepSuspects) > 0) lines.push(['sleep', 'Sleep suspects ×' + summary.sleepSuspects]);
        if (Number(summary.staleCallbacks) > 0) lines.push(['stale', 'Stale callbacks ×' + summary.staleCallbacks]);
        if (Number(summary.rejectedFixes) > 0) lines.push(['reject', 'Rejected fixes ×' + summary.rejectedFixes]);
        if (Number(summary.audioErrors) > 0) lines.push(['audio', 'Audio errors ×' + summary.audioErrors]);
        if (Number(summary.userLostCount) > 0) lines.push([null, 'User lost ×' + summary.userLostCount]);
        // fragile-but-recovered signals
        if (Number(summary.heartbeatRecoveries) > 0) lines.push([null, 'GPS heartbeat rescues ×' + summary.heartbeatRecoveries]);
        if (Number(summary.afterplayFallbackLoadError) > 0) lines.push(['audio', 'Afterplay load errors ×' + summary.afterplayFallbackLoadError + ' (fallback used)']);
        if (Number(summary.audiofocusRetryCount) > 0) lines.push([null, 'AudioFocus retries ×' + summary.audiofocusRetryCount]);
        if (Number(summary.resumeCount) > 0) lines.push([null, 'Session resumes ×' + summary.resumeCount]);

        var acc = Number(summary.avgAccuracy);
        var header = '<div class="error-event-time mb-1">avg acc ' +
            (Number.isFinite(acc) ? esc(TM.util.formatNumber(acc, 1)) + 'm' : '?') +
            ' · health ' + esc(TM.util.healthScore(summary)) + '/100</div>';

        if (!lines.length) return header + '<div class="text-secondary">No anomalies recorded.</div>';

        var rows = lines.map(function(line) {
            return '<div class="error-event-row tm-pop-line" role="button"' +
                (line[0] ? ' data-error-kind="' + esc(line[0]) + '"' : '') + '>' + esc(line[1]) + '</div>';
        }).join('');

        return header + rows + '<div class="error-popover-footer">click a line to open the matching events</div>';
    }

    function showHealthPopover(triggerEl, summary) {
        if (activeErrorPopover && activeErrorPopover.trigger === triggerEl) { dismissErrorPopover(); return; }
        dismissErrorPopover();

        var popover = new bootstrap.Popover(triggerEl, {
            title: summary.sessionId,
            content: healthPopoverBody(summary),
            html: true,
            trigger: 'manual',
            placement: 'auto',
            customClass: 'error-popover',
            sanitize: false
        });
        popover.show();
        activeErrorPopover = { trigger: triggerEl, popover: popover };

        var popoverEl = getActivePopoverEl();
        if (popoverEl) {
            popoverEl.querySelectorAll('.tm-pop-line').forEach(function(lineEl) {
                lineEl.addEventListener('click', function() {
                    var kind = lineEl.dataset.errorKind || null;
                    dismissErrorPopover();
                    openDetailFor(summary.sessionId, { openEvents: true, errorFilterKind: kind });
                });
            });
        }

        setTimeout(function() {
            document.addEventListener('click', onDocumentClickForPopover, true);
            document.addEventListener('keydown', onKeydownForPopover, true);
        }, 0);
    }

    // ---- Day export ----

    function buildSummaryRow(summary) {
        return {
            sessionId: summary.sessionId,
            parcours: parcoursLabel(summary),
            kind: summary.kind,
            device: deviceLabelFor(summary),
            deviceUuid: summary.deviceUuid,
            isLoanDevice: summary.isLoanDevice,
            startTime: summary.startTime,
            durationMs: summary.durationMs,
            status: TM.api.statusOf(summary),
            eventCount: summary.eventCount,
            lastStep: summary.finalStep,
            totalSteps: summary.totalSteps,
            progressPct: summary.progressPct,
            uniqueSteps: summary.uniqueStepCount,
            resumeCount: summary.resumeCount,
            gpsCount: summary.gpsCount,
            avgAccuracy: summary.avgAccuracy,
            maxGapMs: summary.maxGapMs,
            sleepSuspects: summary.sleepSuspects,
            staleCallbacks: summary.staleCallbacks,
            rejectedFixes: summary.rejectedFixes,
            heartbeatRecoveries: summary.heartbeatRecoveries,
            gpsLostCount: summary.gpsLostCount,
            audioErrors: summary.audioErrors,
            appVersion: summary.appVersion,
            webappCommit: summary.webappCommit,
            note: TM.api.getNote(summary.sessionId)
        };
    }

    function exportDay(dayKey, format) {
        var rows = getFilteredSessions()
            .filter(function(summary) { return TM.util.dayKey(summary.startTime) === dayKey; })
            .sort(function(a, b) { return new Date(a.startTime) - new Date(b.startTime); })
            .map(buildSummaryRow);
        if (format === 'csv') TM.util.downloadText('telemetry-' + dayKey + '.csv', TM.util.toCsv(rows), 'text/csv;charset=utf-8');
        else TM.util.downloadText('telemetry-' + dayKey + '.json', JSON.stringify(rows, null, 2), 'application/json');
    }

    // ---- Main render ----

    function render() {
        dismissErrorPopover();
        var liveSectionEl = document.getElementById('live-section');
        var daysEl = document.getElementById('days-container');
        var metaEl = document.getElementById('results-meta');
        var loadMoreBtn = document.getElementById('load-more-days');
        if (!daysEl) return;

        if (!TM.api.isLoaded(TM.state.archived())) {
            daysEl.innerHTML = '<div class="text-muted p-3">Loading…</div>';
            liveSectionEl.innerHTML = '';
            return;
        }

        var filtered = getFilteredSessions();
        var walks = filtered.filter(function(s) { return s.kind === 'walk'; }).length;
        metaEl.textContent = filtered.length + ' session' + (filtered.length > 1 ? 's' : '') +
            ' (' + walks + ' walk' + (walks > 1 ? 's' : '') + ', ' + (filtered.length - walks) + ' onb) match current filters.';

        // Pinned IN PROGRESS section (active tab only)
        var liveSessions = TM.state.archived() ? [] : filtered.filter(function(s) { return TM.api.statusOf(s) === 'live'; });
        if (liveSessions.length) {
            var liveWalks = liveSessions.filter(function(s) { return s.kind === 'walk'; });
            // One shared map for all live walkers' current positions + tracks.
            var liveMapHtml = liveWalks.length
                ? '<div class="tm-group-map tm-live-map" data-track-map="' + LIVE_MAP_KEY + '"></div>'
                : '';
            liveSectionEl.innerHTML = '<div class="tm-live-section"><h6>● IN PROGRESS</h6>' +
                liveMapHtml +
                liveSessions.map(function(summary) {
                    var html = renderRow(summary, {});
                    if (TM.detail.currentSessionId() === summary.sessionId) {
                        html += '<div class="tm-detail-host" data-host-for="' + esc(summary.sessionId) + '"></div>';
                    }
                    return html;
                }).join('') + '</div>';
        } else {
            liveSectionEl.innerHTML = '';
        }

        // If the expanded/deep-linked session vanished from the filtered set,
        // drop the detail so view state stays coherent.
        var targetId = TM.detail.currentSessionId() || TM.state.get('s');
        if (targetId && !filtered.some(function(s) { return s.sessionId === targetId; })) {
            if (TM.detail.currentSessionId()) TM.detail.close();
            targetId = null;
        }

        var rest = filtered.filter(function(s) { return liveSessions.indexOf(s) === -1; });
        var days = buildDays(rest);
        var ndays = Math.max(1, Number(TM.state.get('ndays')) || 7);

        // Make sure the expanded session's day section is shown and open.
        if (targetId) {
            days.forEach(function(day, index) {
                if (!day.sessions.some(function(s) { return s.sessionId === targetId; })) return;
                if (index >= ndays) ndays = index + 1;
                if (!isDayOpen(day.dayKey, index)) dayToggles.set(day.dayKey, true);
            });
        }

        var shown = days.slice(0, ndays);

        daysEl.innerHTML = shown.length
            ? shown.map(renderDay).join('')
            : '<div class="text-muted p-3">No sessions match the current filters.</div>';

        if (loadMoreBtn) {
            loadMoreBtn.style.display = days.length > ndays ? '' : 'none';
            loadMoreBtn.textContent = 'Load older days (' + (days.length - ndays) + ' more)';
        }

        // Track-map data: filtered sessions grouped by track key
        var byKey = new Map();
        var isWalk = function(s) { return s.kind === 'walk'; };
        if (liveSessions.length) byKey.set(LIVE_MAP_KEY, liveSessions.filter(isWalk));
        days.forEach(function(day) {
            day.sections.forEach(function(section) {
                byKey.set(section.trackKey, section.sessions.filter(isWalk));
                section.groups.forEach(function(group) {
                    byKey.set(section.prefix + '/' + group.key, group.sessions.filter(isWalk));
                });
            });
        });
        renderTrackMaps(byKey);

        // Remount the open detail panel into its (rebuilt) host
        var host = document.querySelector('[data-host-for]');
        if (host && TM.detail.currentSessionId() === host.dataset.hostFor) {
            TM.detail.remount(host);
        }

        restoreTimelineScroll();
        updateSelectionUI();
        updateAgoTickers();
    }

    function updateAgoTickers() {
        var now = TM.api.nowServer();
        document.querySelectorAll('[data-role="ago"]').forEach(function(el) {
            var last = Number(el.dataset.last);
            if (Number.isFinite(last) && last > 0) el.textContent = 'last evt ' + TM.util.formatAgo(now - last) + ' ago';
        });
    }

    // ---- Interaction (delegated) ----

    function findSession(sessionId) {
        return TM.api.getSession(sessionId, TM.state.archived());
    }

    function rowFor(sessionId) {
        return document.querySelector('.tm-row[data-session-id="' + CSS.escape(sessionId) + '"]');
    }

    // Hover preview from the timeline strip or a group-map track.
    function previewRow(sessionId, on) {
        var row = rowFor(sessionId);
        if (row) row.classList.toggle('tm-row-prehl', !!on);
    }

    function jumpToRow(sessionId) {
        var row = rowFor(sessionId);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('tm-row-flash');
        void row.offsetWidth; // restart the animation on repeat clicks
        row.classList.add('tm-row-flash');
        setTimeout(function() { row.classList.remove('tm-row-flash'); }, 2600);
    }

    // ---- Multi-selection (selective archive/delete/export) ----

    function visibleRowIds() {
        return Array.prototype.map.call(
            document.querySelectorAll('.tm-row[data-session-id]'),
            function(row) { return row.dataset.sessionId; });
    }

    function updateSelectionUI() {
        // prune ids that vanished from the current scope
        Array.from(selectedIds).forEach(function(id) { if (!findSession(id)) selectedIds.delete(id); });

        document.querySelectorAll('.tm-row[data-session-id]').forEach(function(row) {
            var checkbox = row.querySelector('.tm-row-check');
            if (checkbox) checkbox.checked = selectedIds.has(row.dataset.sessionId);
        });
        document.querySelectorAll('.tm-group').forEach(function(groupEl) {
            var checkbox = groupEl.querySelector('.tm-group-check');
            if (!checkbox) return;
            var ids = Array.prototype.map.call(groupEl.querySelectorAll('.tm-row[data-session-id]'),
                function(row) { return row.dataset.sessionId; });
            var selectedCount = ids.filter(function(id) { return selectedIds.has(id); }).length;
            checkbox.checked = ids.length > 0 && selectedCount === ids.length;
            checkbox.indeterminate = selectedCount > 0 && selectedCount < ids.length;
        });

        var bar = document.getElementById('tm-selection-bar');
        if (!bar) return;
        bar.hidden = selectedIds.size === 0;
        document.getElementById('sel-count').textContent = selectedIds.size + ' selected';
        var archived = TM.state.archived();
        document.getElementById('sel-archive').hidden = archived;
        document.getElementById('sel-unarchive').hidden = !archived;
    }

    function toggleSelect(sessionId, checked, shiftKey) {
        if (shiftKey && lastCheckedId && lastCheckedId !== sessionId) {
            var ids = visibleRowIds();
            var a = ids.indexOf(lastCheckedId);
            var b = ids.indexOf(sessionId);
            if (a !== -1 && b !== -1) {
                for (var i = Math.min(a, b); i <= Math.max(a, b); i++) {
                    if (checked) selectedIds.add(ids[i]);
                    else selectedIds.delete(ids[i]);
                }
            }
        } else {
            if (checked) selectedIds.add(sessionId);
            else selectedIds.delete(sessionId);
        }
        lastCheckedId = sessionId;
        updateSelectionUI();
    }

    function clearSelection() {
        selectedIds.clear();
        lastCheckedId = null;
        updateSelectionUI();
    }

    function bindSelectionBar() {
        var bar = document.getElementById('tm-selection-bar');
        if (!bar) return;

        document.getElementById('sel-clear').addEventListener('click', clearSelection);

        document.getElementById('sel-all').addEventListener('click', function() {
            getFilteredSessions().forEach(function(summary) { selectedIds.add(summary.sessionId); });
            updateSelectionUI();
        });

        document.getElementById('sel-export').addEventListener('click', function() {
            var rows = Array.from(selectedIds).map(findSession).filter(Boolean).map(buildSummaryRow);
            TM.util.downloadText('telemetry-selection.csv', TM.util.toCsv(rows), 'text/csv;charset=utf-8');
        });

        document.getElementById('sel-archive').addEventListener('click', function() {
            var ids = Array.from(selectedIds);
            if (!ids.length) return;
            if (!confirm('Archive ' + ids.length + ' selected session' + (ids.length > 1 ? 's' : '') + '?')) return;
            TM.api.archiveBulk(ids)
                .then(function(result) {
                    (result.archived || []).forEach(function(id) { TM.api.removeLocal(id, false); });
                    var skipped = (result.skipped || []).length;
                    if (skipped) alert(skipped + ' session(s) skipped');
                    clearSelection();
                    render();
                })
                .catch(function(error) { alert('Failed to archive: ' + error); });
        });

        document.getElementById('sel-unarchive').addEventListener('click', function() {
            var ids = Array.from(selectedIds);
            if (!ids.length) return;
            if (!confirm('Unarchive ' + ids.length + ' selected session' + (ids.length > 1 ? 's' : '') + '?')) return;
            Promise.allSettled(ids.map(function(id) { return TM.api.unarchiveSession(id); }))
                .then(function(results) {
                    var failed = results.filter(function(r) { return r.status === 'rejected'; }).length;
                    if (failed) alert(failed + ' session(s) failed to unarchive');
                    clearSelection();
                    render();
                });
        });

        document.getElementById('sel-delete').addEventListener('click', function() {
            var ids = Array.from(selectedIds);
            if (!ids.length) return;
            if (!confirm('Permanently DELETE ' + ids.length + ' selected session' + (ids.length > 1 ? 's' : '') + '? This cannot be undone.')) return;
            var archived = TM.state.archived();
            Promise.allSettled(ids.map(function(id) { return TM.api.deleteSession(id, archived); }))
                .then(function(results) {
                    var failed = results.filter(function(r) { return r.status === 'rejected'; }).length;
                    if (failed) alert(failed + ' session(s) failed to delete');
                    clearSelection();
                    render();
                });
        });
    }

    function openDetailFor(sessionId, opts) {
        var row = document.querySelector('.tm-row[data-session-id="' + CSS.escape(sessionId) + '"]');
        if (!row) return;
        document.querySelectorAll('.tm-row.active').forEach(function(el) { el.classList.remove('active'); });
        document.querySelectorAll('.tm-detail-host').forEach(function(el) { el.remove(); });
        row.classList.add('active');
        var host = document.createElement('div');
        host.className = 'tm-detail-host';
        host.dataset.hostFor = sessionId;
        row.parentNode.insertBefore(host, row.nextSibling);
        TM.detail.open(sessionId, host, opts);
    }

    function onContainerClick(event) {
        var actionEl = event.target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;

            if (action === 'toggle-day') {
                // Clicks on the header's action cluster (Map button, kebab menu)
                // must not collapse the day.
                if (event.target.closest('.tm-day-actions')) return;
                var dayKey = actionEl.dataset.dayKey;
                var dayEl = actionEl.closest('.tm-day');
                var nowOpen = dayEl.classList.contains('collapsed');
                if (nowOpen) {
                    // Accordion: opening a day collapses the others.
                    document.querySelectorAll('.tm-day').forEach(function(el) {
                        if (el !== dayEl) dayToggles.set(el.dataset.day, false);
                    });
                }
                dayToggles.set(dayKey, nowOpen);
                render();
                return;
            }
            if (action === 'toggle-onb') {
                var onbKey = actionEl.dataset.onbKey;
                if (onbExpanded.has(onbKey)) onbExpanded.delete(onbKey);
                else onbExpanded.add(onbKey);
                render();
                return;
            }
            if (action === 'toggle-tracks') {
                event.stopPropagation();
                var trackKey = actionEl.dataset.trackKey;
                // Toggle relative to the current effective (possibly default) state.
                var currentlyOpen = !!document.querySelector('[data-track-map="' + CSS.escape(trackKey) + '"]');
                trackMapOpen.set(trackKey, !currentlyOpen);
                render();
                return;
            }
            if (action === 'trackmap-mode') {
                event.stopPropagation();
                trackMapModes.set(actionEl.dataset.trackKey, actionEl.dataset.mode);
                render();
                return;
            }
            if (action === 'tl-zoom') {
                event.stopPropagation();
                var tlKey = actionEl.dataset.tlKey;
                var wrap = document.querySelector('.tm-timeline-wrap[data-tl-key="' + CSS.escape(tlKey) + '"]');
                var view = timelineView.get(tlKey) || { factor: 1, center: 0.5 };
                if (wrap && wrap.scrollWidth > 0) {
                    view.center = (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth;
                }
                view.factor = actionEl.dataset.dir === 'in' ? view.factor * 1.6 : view.factor / 1.6;
                if (view.factor <= 1.05) view.factor = 1;
                timelineView.set(tlKey, view);
                render();
                return;
            }
            if (action === 'export-day') {
                event.preventDefault();
                event.stopPropagation();
                exportDay(actionEl.dataset.day, actionEl.dataset.format);
                return;
            }
            if (action === 'rename-device') {
                event.stopPropagation();
                var uuid = actionEl.dataset.uuid;
                var device = TM.api.getDevice(uuid);
                var name = prompt('Friendly name for device ' + uuid.slice(0, 8) + '…', (device && device.friendly_name) || '');
                if (name === null) return;
                TM.api.renameDevice(uuid, name.trim())
                    .then(render)
                    .catch(function(error) { alert('Rename failed: ' + error); });
                return;
            }
        }

        var rowCheck = event.target.closest('.tm-row-check');
        if (rowCheck) {
            event.stopPropagation();
            var checkRow = rowCheck.closest('.tm-row');
            if (checkRow) toggleSelect(checkRow.dataset.sessionId, rowCheck.checked, event.shiftKey);
            return;
        }

        var groupCheck = event.target.closest('.tm-group-check');
        if (groupCheck) {
            event.stopPropagation();
            var checkGroup = groupCheck.closest('.tm-group');
            if (checkGroup) {
                checkGroup.querySelectorAll('.tm-row[data-session-id]').forEach(function(row) {
                    if (groupCheck.checked) selectedIds.add(row.dataset.sessionId);
                    else selectedIds.delete(row.dataset.sessionId);
                });
                updateSelectionUI();
            }
            return;
        }

        var chip = event.target.closest('.tm-health-chip');
        if (chip) {
            event.stopPropagation();
            var chipRow = chip.closest('.tm-row');
            var summary = chipRow && findSession(chipRow.dataset.sessionId);
            if (summary) showHealthPopover(chip, summary);
            return;
        }

        var bar = event.target.closest('[data-timeline-session]');
        if (bar) {
            event.stopPropagation();
            jumpToRow(bar.dataset.timelineSession);
            return;
        }

        var row = event.target.closest('.tm-row');
        if (row && !event.target.closest('.tm-detail')) {
            var sessionId = row.dataset.sessionId;
            if (TM.detail.currentSessionId() === sessionId) {
                TM.detail.close();
                row.classList.remove('active');
                document.querySelectorAll('.tm-detail-host').forEach(function(el) { el.remove(); });
            } else {
                openDetailFor(sessionId, {});
            }
        }
    }

    function onContainerHover(event) {
        var bar = event.target.closest('[data-timeline-session]');
        if (bar) previewRow(bar.dataset.timelineSession, event.type === 'mouseover');
    }

    function bind() {
        ['live-section', 'days-container'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', onContainerClick);
                el.addEventListener('mouseover', onContainerHover);
                el.addEventListener('mouseout', onContainerHover);
            }
        });
        var loadMoreBtn = document.getElementById('load-more-days');
        if (loadMoreBtn) loadMoreBtn.addEventListener('click', function() {
            TM.state.set({ ndays: String((Number(TM.state.get('ndays')) || 7) + 7) });
        });
        bindSelectionBar();
    }

    return {
        ERROR_BADGE_KINDS: ERROR_BADGE_KINDS,
        render: render,
        bind: bind,
        statusPill: statusPill,
        getFilteredSessions: getFilteredSessions,
        buildSummaryRow: buildSummaryRow,
        dayMaxApk: dayMaxApk,
        parcoursOptions: parcoursOptions,
        deviceOptions: deviceOptions,
        openDetailFor: openDetailFor,
        updateAgoTickers: updateAgoTickers,
        clearSelection: clearSelection
    };
})();
