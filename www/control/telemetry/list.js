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
    var openTrackMaps = new Set();    // groupDomKey or 'day:'+dayKey
    var trackMapHandles = [];         // destroyed on each render

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

            var groups = new Map();
            daySessions.forEach(function(summary) {
                var key = groupKeyFor(summary);
                if (!groups.has(key)) groups.set(key, { key: key, sessions: [], first: summary });
                groups.get(key).sessions.push(summary);
            });

            var groupList = Array.from(groups.values());
            if (TM.state.get('sort') === 'worst') {
                groupList.sort(function(a, b) {
                    var worstA = Math.max.apply(null, a.sessions.map(TM.util.healthScore));
                    var worstB = Math.max.apply(null, b.sessions.map(TM.util.healthScore));
                    return worstB - worstA;
                });
            } else {
                groupList.sort(function(a, b) { return new Date(a.sessions[0].startTime) - new Date(b.sessions[0].startTime); });
            }

            var walks = daySessions.filter(function(s) { return s.kind === 'walk'; });
            var stats = {
                devices: groups.size,
                walks: walks.length,
                complete: walks.filter(function(s) { return TM.api.statusOf(s) === 'ended-complete'; }).length,
                onboarding: daySessions.length - walks.length,
                anomaly: daySessions.some(function(s) {
                    return Number(s.sleepSuspects) > 0 || TM.api.statusOf(s) === 'interrupted';
                })
            };

            return { dayKey: dayKey, sessions: daySessions, groups: groupList, stats: stats };
        });
    }

    // ---- Row rendering ----

    function precisionBadge(summary) {
        var accuracy = Number(summary.avgAccuracy);
        if (!Number.isFinite(accuracy)) return '<span class="badge text-bg-secondary">gps ?</span>';
        if (accuracy <= 5) return '<span class="badge text-bg-success">tight ' + esc(TM.util.formatNumber(accuracy, 1)) + 'm</span>';
        if (accuracy <= 10) return '<span class="badge text-bg-info">good ' + esc(TM.util.formatNumber(accuracy, 1)) + 'm</span>';
        if (accuracy <= 20) return '<span class="badge text-bg-warning">fair ' + esc(TM.util.formatNumber(accuracy, 1)) + 'm</span>';
        return '<span class="badge text-bg-danger">coarse ' + esc(TM.util.formatNumber(accuracy, 1)) + 'm</span>';
    }

    function errorBadge(kind, color, label) {
        return '<span class="badge text-bg-' + color + ' error-badge" data-error-kind="' + esc(kind) + '" tabindex="0" role="button" title="Click for details, alt-click to open the events panel">' + esc(label) + '</span>';
    }

    function renderGpsBadges(summary) {
        var badges = [precisionBadge(summary)];
        if (summary.maxGapMs != null && Number(summary.maxGapMs) >= 8000) {
            badges.push(errorBadge('gap', 'warning', 'gap ' + TM.util.formatGap(Number(summary.maxGapMs))));
        }
        if (Number(summary.sleepSuspects) > 0) badges.push(errorBadge('sleep', 'danger', 'sleep x' + summary.sleepSuspects));
        if (Number(summary.staleCallbacks) > 0) badges.push(errorBadge('stale', 'warning', 'stale x' + summary.staleCallbacks));
        if (Number(summary.rejectedFixes) > 0) badges.push(errorBadge('reject', 'warning', 'reject x' + summary.rejectedFixes));
        if (Number(summary.audioErrors) > 0) badges.push(errorBadge('audio', 'secondary', 'audio x' + summary.audioErrors));
        return '<div class="gps-badges">' + badges.join('') + '</div>';
    }

    function progressHtml(summary) {
        if (summary.kind !== 'walk' || summary.progressPct == null) {
            return '<span class="tm-progress-label">' + (summary.finalStep != null ? 'step ' + esc(summary.finalStep) : '—') + '</span>';
        }
        var status = TM.api.statusOf(summary);
        var barColor = status === 'ended-complete' ? 'bg-success' : (status === 'live' ? 'bg-info' : 'bg-secondary');
        return '<div class="tm-progress">' +
            '<div class="progress"><div class="progress-bar ' + barColor + '" style="width:' + summary.progressPct + '%"></div></div>' +
            '<span class="tm-progress-label">' + (summary.finalStep != null ? (summary.finalStep + 1) : '?') + '/' + esc(summary.totalSteps) + '</span>' +
        '</div>';
    }

    function renderRow(summary, opts) {
        var options = opts || {};
        var status = TM.api.statusOf(summary);
        var expanded = TM.detail.currentSessionId() === summary.sessionId;
        var health = TM.util.healthScore(summary);
        var note = TM.api.getNote(summary.sessionId);
        var chips = [];

        if (options.restartIndex > 1) chips.push('<span class="badge text-bg-warning">restart #' + options.restartIndex + '</span>');
        if (Number(summary.resumeCount) > 0) chips.push('<span class="badge text-bg-secondary">resume x' + esc(summary.resumeCount) + '</span>');
        if (note) chips.push('<span class="tm-note-ic" title="' + esc(note) + '">✎</span>');

        var ago = status === 'live'
            ? ' <span class="small text-info" data-role="ago" data-last="' + esc(summary.lastEvent || '') + '"></span>'
            : '';

        return '<div class="tm-row' + (expanded ? ' active' : '') + (summary.kind === 'onboarding' ? ' tm-row-onb' : '') + '" data-session-id="' + esc(summary.sessionId) + '">' +
            '<div class="tm-row-time">' + esc(TM.util.formatTime(summary.startTime)) + '</div>' +
            '<div class="tm-row-parcours" title="' + esc(summary.sessionId) + '">' + esc(parcoursLabel(summary) || '-') +
                (summary.kind === 'onboarding' ? ' <span class="badge text-bg-dark">onb</span>' : '') +
                (chips.length ? ' ' + chips.join(' ') : '') + '</div>' +
            '<div class="tm-row-duration">' + esc(TM.util.formatDuration(summary.durationMs)) + '</div>' +
            '<div>' + progressHtml(summary) + '</div>' +
            '<div class="tm-row-status">' + statusPill(summary) + ago +
                '<span class="tm-health" style="background:' + TM.util.healthColor(health) + '" title="health score ' + health.toFixed(1) + '"></span></div>' +
            renderGpsBadges(summary) +
            '<div class="tm-row-chevron">▶</div>' +
        '</div>';
    }

    function renderGroup(group, dayKey) {
        var domKey = dayKey + '/' + group.key;
        var first = group.sessions[0];
        var device = TM.api.getDevice(first.deviceUuid);
        var friendly = device && device.friendly_name;
        var label = friendly || deviceLabelFor(first);
        var walks = group.sessions.filter(function(s) { return s.kind === 'walk'; });
        var onbs = group.sessions.filter(function(s) { return s.kind === 'onboarding'; });
        var maxApk = TM.api.maxApkVersion();
        var apk = first.appVersion != null ? Number(first.appVersion) : (device ? Number(device.apk_version) : null);
        var apkStale = maxApk && Number.isFinite(apk) && apk < maxApk;

        var header = '<div class="tm-group-header">' +
            '<span class="tm-group-device">📱 ' + esc(label) + '</span>' +
            (friendly ? '<span class="text-secondary small">' + esc(deviceLabelFor(Object.assign({}, first, { deviceUuid: null }))) + '</span>' : '') +
            (first.deviceUuid
                ? '<span class="tm-group-uuid">' + esc(first.deviceUuid.slice(0, 8)) + '</span>' +
                  '<button class="tm-rename-btn" data-action="rename-device" data-uuid="' + esc(first.deviceUuid) + '" title="Rename device">✎</button>'
                : '') +
            (first.isLoanDevice ? '<span class="badge text-bg-warning">loan</span>' : '') +
            (apk != null && Number.isFinite(apk) ? '<span class="badge text-bg-' + (apkStale ? 'danger' : 'dark') + '">apk ' + esc(apk) + (apkStale ? ' stale' : '') + '</span>' : '') +
            '<div class="tm-group-meta">' +
                '<span>' + walks.length + ' walk' + (walks.length > 1 ? 's' : '') + (onbs.length ? ' + ' + onbs.length + ' onb' : '') + '</span>' +
                (walks.length > 1 ? '<button class="btn btn-outline-secondary btn-sm py-0" data-action="toggle-tracks" data-track-key="' + esc(domKey) + '">Tracks</button>' : '') +
            '</div>' +
        '</div>';

        // restart numbering: consecutive walk sessions on the same parcours
        var restartIndices = new Map();
        var runParcours = null;
        var runCount = 0;
        walks.forEach(function(summary) {
            if (summary.parcoursId === runParcours) runCount += 1;
            else { runParcours = summary.parcoursId; runCount = 1; }
            restartIndices.set(summary.sessionId, runCount);
        });

        var kind = TM.state.get('kind');
        var rows = '';
        group.sessions.forEach(function(summary) {
            if (summary.kind === 'onboarding' && kind === 'all' && !onbExpanded.has(domKey)) return;
            rows += renderRow(summary, { restartIndex: restartIndices.get(summary.sessionId) || 0 });
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

        var tracksHost = openTrackMaps.has(domKey)
            ? '<div class="tm-group-map" data-track-map="' + esc(domKey) + '"></div><div class="comparison-legend" data-track-legend="' + esc(domKey) + '"></div>'
            : '';

        return '<div class="tm-group">' + header + tracksHost + rows + fold + '</div>';
    }

    function renderTimeline(day) {
        if (day.sessions.length < 2) return '';
        var starts = day.sessions.map(function(s) { return new Date(s.startTime).getTime(); });
        var ends = day.sessions.map(function(s) { return Number(s.lastEvent) || new Date(s.startTime).getTime(); });
        var min = Math.min.apply(null, starts);
        var max = Math.max.apply(null, ends);
        var span = Math.max(60000, max - min);

        var rows = day.sessions.map(function(summary, index) {
            var start = starts[index];
            var end = ends[index];
            var left = ((start - min) / span) * 100;
            var width = Math.max(0.5, ((end - start) / span) * 100);
            return '<div class="tm-timeline-row"><div class="tm-timeline-bar" ' +
                'style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;background:' + statusColor(TM.api.statusOf(summary)) + '" ' +
                'data-timeline-session="' + esc(summary.sessionId) + '" ' +
                'title="' + esc(summary.sessionId + ' · ' + deviceLabelFor(summary) + ' · ' + TM.util.formatDuration(summary.durationMs)) + '"></div></div>';
        }).join('');

        return '<div class="tm-timeline">' + rows + '</div>' +
            '<div class="tm-timeline-axis"><span>' + esc(TM.util.formatTime(min)) + '</span><span>' + esc(TM.util.formatTime(max)) + '</span></div>';
    }

    function isDayOpen(dayKey, index) {
        if (dayToggles.has(dayKey)) return dayToggles.get(dayKey);
        return index < 2; // today + most recent previous day open by default
    }

    function renderDay(day, index) {
        var open = isDayOpen(day.dayKey, index);
        var stats = day.stats;
        var trackKey = 'day:' + day.dayKey;

        var statsHtml = '<div class="tm-day-stats">' +
            (stats.anomaly ? '<span class="tm-day-anomaly" title="sleep suspects or interrupted sessions"></span>' : '') +
            '<span>' + stats.devices + ' device' + (stats.devices > 1 ? 's' : '') + '</span>' +
            '<span>' + stats.walks + ' walk' + (stats.walks > 1 ? 's' : '') + (stats.walks ? ' (' + stats.complete + ' ✓)' : '') + '</span>' +
            (stats.onboarding ? '<span>' + stats.onboarding + ' onb</span>' : '') +
        '</div>';

        var actions = '<div class="tm-day-actions">' +
            '<button class="btn btn-outline-secondary btn-sm py-0" data-action="toggle-tracks" data-track-key="' + esc(trackKey) + '" title="All day tracks on one map">Map</button>' +
            '<div class="dropdown">' +
                '<button class="btn btn-outline-secondary btn-sm py-0 dropdown-toggle" data-bs-toggle="dropdown">⋯</button>' +
                '<ul class="dropdown-menu dropdown-menu-end">' +
                    '<li><a class="dropdown-item" href="#" data-action="export-day" data-format="csv" data-day="' + esc(day.dayKey) + '">Export day CSV</a></li>' +
                    '<li><a class="dropdown-item" href="#" data-action="export-day" data-format="json" data-day="' + esc(day.dayKey) + '">Export day JSON</a></li>' +
                '</ul>' +
            '</div>' +
        '</div>';

        var tracksHost = openTrackMaps.has(trackKey)
            ? '<div class="tm-group-map" data-track-map="' + esc(trackKey) + '"></div><div class="comparison-legend" data-track-legend="' + esc(trackKey) + '"></div>'
            : '';

        return '<div class="tm-day' + (open ? '' : ' collapsed') + '" data-day="' + esc(day.dayKey) + '">' +
            '<div class="tm-day-header" data-action="toggle-day" data-day-key="' + esc(day.dayKey) + '">' +
                '<span class="tm-day-caret">▼</span>' +
                '<span class="tm-day-title">' + esc(TM.util.dayLabel(day.dayKey)) + '</span>' +
                statsHtml + actions +
            '</div>' +
            '<div class="tm-day-body">' +
                renderTimeline(day) +
                tracksHost +
                day.groups.map(function(group) { return renderGroup(group, day.dayKey); }).join('') +
            '</div>' +
        '</div>';
    }

    // ---- Group track maps ----

    function renderTrackMaps(filteredByKey) {
        trackMapHandles.forEach(function(handle) { try { handle.destroy(); } catch (e) {} });
        trackMapHandles = [];

        document.querySelectorAll('[data-track-map]').forEach(function(mapEl) {
            var key = mapEl.dataset.trackMap;
            var sessions = filteredByKey.get(key) || [];
            sessions = sessions.slice(0, 8);
            if (!sessions.length) return;

            mapEl.id = 'tm-track-map-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
            var legendEl = document.querySelector('[data-track-legend="' + CSS.escape(key) + '"]');

            Promise.all(sessions.map(function(summary) {
                return TM.api.getDetail(summary.sessionId, TM.state.archived()).then(function(data) {
                    return { session: summary, data: data };
                });
            })).then(function(items) {
                var ids = Array.from(new Set(items.map(function(item) {
                    return String(item.data.parcoursId || item.data.parcoursName || '').replace(/^onb:/, '');
                }).filter(Boolean)));
                var overlayPromise = ids.length === 1 ? TM.api.loadParcoursOverlay(ids[0]) : Promise.resolve(null);
                return overlayPromise.then(function(overlay) {
                    if (!document.getElementById(mapEl.id)) return;
                    trackMapHandles.push(TM.maps.renderGroupMap(mapEl.id, items, overlay, { viewKey: 'tracks:' + key }));
                    if (legendEl) {
                        legendEl.innerHTML = items.map(function(item, index) {
                            var color = TM.maps.TRACK_PALETTE[index % TM.maps.TRACK_PALETTE.length];
                            return '<div class="comparison-legend-item"><span class="comparison-legend-color" style="background:' + color + '"></span>' +
                                '<code>' + esc(item.session.sessionId) + '</code><span>' + esc(deviceLabelFor(item.session)) + '</span></div>';
                        }).join('');
                    }
                });
            }).catch(function(error) {
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

    function renderErrorPopoverBody(kind, events) {
        var def = ERROR_BADGE_KINDS[kind];
        if (!events.length) return '<div class="text-secondary">No matching events recorded for this session.</div>';

        var sorted = events.slice();
        if (def.sortKey) sorted.sort(function(a, b) { return def.sortKey(a) - def.sortKey(b); });

        var maxRows = 25;
        var rows = sorted.slice(0, maxRows).map(function(event) {
            var when = new Date(event.t).toLocaleTimeString('fr-FR');
            return '<div class="error-event-row">' +
                '<div class="error-event-time">' + esc(when) + ' · <code>' + esc(event.type) + '</code></div>' +
                '<div class="error-event-payload">' + esc(def.describe(event)) + '</div>' +
            '</div>';
        }).join('');

        var footer = '<div class="error-popover-footer">' +
            sorted.length + ' event' + (sorted.length > 1 ? 's' : '') +
            (sorted.length > maxRows ? ' (showing top ' + maxRows + ')' : '') +
            ' · alt-click the badge to open the full events panel' +
        '</div>';

        return rows + footer;
    }

    function showErrorPopover(triggerEl, summary, kind) {
        var def = ERROR_BADGE_KINDS[kind];
        if (!def) return;
        if (activeErrorPopover && activeErrorPopover.trigger === triggerEl) { dismissErrorPopover(); return; }
        dismissErrorPopover();

        var popover = new bootstrap.Popover(triggerEl, {
            title: def.label + ' — ' + summary.sessionId,
            content: '<div class="text-secondary">Loading...</div>',
            html: true,
            trigger: 'manual',
            placement: 'auto',
            customClass: 'error-popover',
            sanitize: false
        });
        popover.show();
        activeErrorPopover = { trigger: triggerEl, popover: popover };
        setTimeout(function() {
            document.addEventListener('click', onDocumentClickForPopover, true);
            document.addEventListener('keydown', onKeydownForPopover, true);
        }, 0);

        TM.api.getDetail(summary.sessionId, TM.state.archived())
            .then(function(data) {
                if (!activeErrorPopover || activeErrorPopover.trigger !== triggerEl) return;
                var allowed = new Set(def.types);
                var matching = (data.events || []).filter(function(event) { return allowed.has(event.type); });
                var popoverEl = getActivePopoverEl();
                var bodyEl = popoverEl && popoverEl.querySelector('.popover-body');
                if (bodyEl) {
                    bodyEl.innerHTML = renderErrorPopoverBody(kind, matching);
                    popover.update();
                }
            })
            .catch(function(error) {
                var popoverEl = getActivePopoverEl();
                var bodyEl = popoverEl && popoverEl.querySelector('.popover-body');
                if (bodyEl) bodyEl.innerHTML = '<div class="text-danger">Failed to load: ' + esc(String(error)) + '</div>';
            });
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
            liveSectionEl.innerHTML = '<div class="tm-live-section"><h6>● IN PROGRESS</h6>' +
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
        days.forEach(function(day) {
            byKey.set('day:' + day.dayKey, day.sessions.filter(function(s) { return s.kind === 'walk'; }));
            day.groups.forEach(function(group) {
                byKey.set(day.dayKey + '/' + group.key, group.sessions.filter(function(s) { return s.kind === 'walk'; }));
            });
        });
        renderTrackMaps(byKey);

        // Remount the open detail panel into its (rebuilt) host
        var host = document.querySelector('[data-host-for]');
        if (host && TM.detail.currentSessionId() === host.dataset.hostFor) {
            TM.detail.remount(host);
        }

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
                var dayKey = actionEl.dataset.dayKey;
                var dayEl = actionEl.closest('.tm-day');
                var nowOpen = dayEl.classList.contains('collapsed');
                dayToggles.set(dayKey, nowOpen);
                dayEl.classList.toggle('collapsed');
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
                if (openTrackMaps.has(trackKey)) openTrackMaps.delete(trackKey);
                else openTrackMaps.add(trackKey);
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

        var badge = event.target.closest('.error-badge');
        if (badge) {
            event.stopPropagation();
            var badgeRow = badge.closest('.tm-row');
            var summary = badgeRow && findSession(badgeRow.dataset.sessionId);
            if (!summary) return;
            var kind = badge.dataset.errorKind;
            if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) {
                dismissErrorPopover();
                openDetailFor(summary.sessionId, { openEvents: true, errorFilterKind: kind });
            } else {
                showErrorPopover(badge, summary, kind);
            }
            return;
        }

        var bar = event.target.closest('[data-timeline-session]');
        if (bar) {
            event.stopPropagation();
            var barSessionId = bar.dataset.timelineSession;
            var barRow = document.querySelector('.tm-row[data-session-id="' + CSS.escape(barSessionId) + '"]');
            if (barRow) barRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    function bind() {
        ['live-section', 'days-container'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', onContainerClick);
        });
        var loadMoreBtn = document.getElementById('load-more-days');
        if (loadMoreBtn) loadMoreBtn.addEventListener('click', function() {
            TM.state.set({ ndays: String((Number(TM.state.get('ndays')) || 7) + 7) });
        });
    }

    return {
        ERROR_BADGE_KINDS: ERROR_BADGE_KINDS,
        render: render,
        bind: bind,
        statusPill: statusPill,
        getFilteredSessions: getFilteredSessions,
        buildSummaryRow: buildSummaryRow,
        parcoursOptions: parcoursOptions,
        deviceOptions: deviceOptions,
        openDetailFor: openDetailFor,
        updateAgoTickers: updateAgoTickers
    };
})();
