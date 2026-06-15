/* Telemetry page — Leaflet rendering.
 * Detail map (accuracy-coloured track, accuracy ribbon, GPS-problem pins,
 * step-zone fire status, time scrubber) and multi-session group map. */
window.TM = window.TM || {};

TM.maps = (function() {
    var ACC_BUCKETS = [
        { max: 5, color: '#198754', label: '≤5m' },
        { max: 10, color: '#0dcaf0', label: '≤10m' },
        { max: 20, color: '#ffc107', label: '≤20m' },
        { max: Infinity, color: '#dc3545', label: '>20m' }
    ];

    var PROBLEM_STYLES = {
        gps_callback_gap: { color: '#fd7e14', label: 'gap' },
        gps_sleep_suspect: { color: '#dc3545', label: 'sleep' },
        gps_stale_callback: { color: '#ffc107', label: 'stale' },
        gps_trigger_rejected: { color: '#6f42c1', label: 'reject' }
    };

    var TRACK_PALETTE = ['#0dcaf0', '#ffc107', '#20c997', '#fd7e14', '#ff6b6b', '#6f42c1', '#adb5bd', '#7ae582'];

    // View persistence across re-renders/refreshes, keyed by caller-chosen key.
    var viewStates = new Map();

    function accBucket(acc) {
        var value = Number(acc);
        if (!Number.isFinite(value)) return ACC_BUCKETS.length - 1;
        for (var i = 0; i < ACC_BUCKETS.length; i++) {
            if (value <= ACC_BUCKETS[i].max) return i;
        }
        return ACC_BUCKETS.length - 1;
    }

    function getGpsEvents(events) {
        return (events || []).filter(function(event) {
            return event.type === 'gps' && event.data
                && typeof event.data.lat === 'number' && typeof event.data.lng === 'number';
        });
    }

    function distanceMeters(a, b) {
        // Equirectangular approximation — plenty for decimation distances.
        var dLat = (b[0] - a[0]) * 111320;
        var dLng = (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng);
    }

    // Deterministic wheel zoom, replacing Leaflet's timer-based handler.
    // Leaflet batches wheel deltas per debounce window and rounds every window
    // UP to a full zoomSnap step, so bursts longer than the window — or
    // residual deltas from high-resolution wheels — produce extra zoom steps
    // that replay after the animation (the "double fire" glitch). Here a step
    // only fires when the accumulated wheel distance crosses STEP_PX; the
    // remainder carries within a gesture and resets after a short idle, and
    // the zoom is applied without animation so nothing can queue.
    function attachWheelZoom(map) {
        var STEP_PX = 100;     // accumulated wheel distance per zoom step
        var STEP_ZOOM = 0.5;   // zoom amount per step
        var IDLE_MS = 250;     // gesture separator: residual delta is dropped
        var acc = 0;
        var lastWheelAt = 0;

        map.getContainer().addEventListener('wheel', function(event) {
            event.preventDefault();
            event.stopPropagation();

            // Normalize to pixels (Leaflet's own line/page factors).
            var delta = event.deltaY;
            if (event.deltaMode === 1) delta *= 60;
            else if (event.deltaMode === 2) delta *= 800;

            var now = Date.now();
            if (now - lastWheelAt > IDLE_MS || (acc !== 0 && (acc > 0) !== (delta > 0))) acc = 0;
            lastWheelAt = now;

            acc += delta;
            var steps = Math.trunc(acc / STEP_PX);
            if (!steps) return;
            acc -= steps * STEP_PX;

            var targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() - steps * STEP_ZOOM));
            if (targetZoom === map.getZoom()) return;
            map.setZoomAround(map.mouseEventToContainerPoint(event), targetZoom, { animate: false });
        }, { passive: false });
    }

    function createBaseMap(container) {
        // Accepts an id string or an element. If the element was already
        // initialized by a prior (racing) render, tear that down first so
        // L.map() doesn't throw "Map container is already initialized".
        var el = typeof container === 'string' ? document.getElementById(container) : container;
        if (el && el._leaflet_id != null) {
            el._leaflet_id = null;
            el.innerHTML = '';
        }
        var map = L.map(el || container, {
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            scrollWheelZoom: false
        }).setView([45.75, 4.85], 15);
        attachWheelZoom(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        return map;
    }

    function normalizeLatLng(point) {
        if (!point) return null;
        if (Array.isArray(point) && point.length >= 2) return [Number(point[0]), Number(point[1])];
        if (typeof point.lat === 'number' && (typeof point.lng === 'number' || typeof point.lon === 'number')) {
            return [Number(point.lat), Number(point.lng != null ? point.lng : point.lon)];
        }
        if (typeof point.latitude === 'number' && (typeof point.longitude === 'number' || typeof point.lon === 'number')) {
            return [Number(point.latitude), Number(point.longitude != null ? point.longitude : point.lon)];
        }
        return null;
    }

    function addSpotGeometry(group, spot, style, tooltip) {
        var layer = null;
        if (Array.isArray(spot.radius) && Array.isArray(spot.radius[0])) {
            var points = spot.radius.map(normalizeLatLng).filter(Boolean);
            if (points.length > 2) layer = L.polygon(points, style);
        } else if (typeof spot.radius === 'number') {
            layer = L.circle([spot.lat, spot.lon], Object.assign({ radius: Number(spot.radius) }, style));
        } else if (typeof spot.lat === 'number' && typeof spot.lon === 'number') {
            layer = L.circleMarker([spot.lat, spot.lon], Object.assign({ radius: 5, fillOpacity: 0.85 }, style));
        }
        if (!layer) return null;
        layer.bindTooltip(tooltip.trim());
        group.addLayer(layer);
        return layer;
    }

    // Step zones. When fireCounts is given, colour each step zone by outcome:
    // fired = green, refired = amber, never fired = red dashed. lightSteps
    // renders them subdued (background context for the GPS-quality view).
    // Ambiance zones + offlimits only appear with allZones.
    function addOverlayZones(group, overlay, opts) {
        if (!overlay || !overlay.data || !overlay.data.spots) return;
        var spots = overlay.data.spots;
        var options = opts || {};
        var fireCounts = options.fireCounts || null;

        (spots.steps || []).forEach(function(step, index) {
            var style;
            if (options.greySteps) {
                // Neutral background context (multi-track day map): just shows
                // where the steps are without competing with the track colours.
                style = { color: '#adb5bd', weight: 1, opacity: 0.5, fillOpacity: 0.04 };
            } else if (options.lightSteps) {
                style = { color: '#ffc107', weight: 1, opacity: 0.45, fillOpacity: 0.03 };
            } else {
                style = { color: '#ffc107', weight: 2, fillOpacity: 0.08 };
            }
            var label = 'Step ' + index + ': ' + (step.name || '');
            // Cross-walk reliability colouring (Parcours view): rate = fired /
            // walks that reached this step.
            if (options.stepRates) {
                var stat = options.stepRates.get(index);
                if (!stat || stat.reached === 0) {
                    style = { color: '#6c757d', weight: 1, dashArray: '4 4', fillOpacity: 0.02 };
                    label += ' — never reached';
                } else {
                    var rate = stat.fired / stat.reached;
                    var color = rate >= 0.95 ? '#198754' : (rate >= 0.8 ? '#fd7e14' : '#dc3545');
                    style = { color: color, weight: 2, fillOpacity: 0.12 };
                    label += ' — fired ' + stat.fired + '/' + stat.reached + ' walks (' + Math.round(rate * 100) + '%)';
                }
                addSpotGeometry(group, step, style, label);
                return;
            }
            if (fireCounts) {
                var count = fireCounts.get(index) || 0;
                if (count === 0) {
                    style = { color: '#dc3545', weight: 2, fillOpacity: 0.05, dashArray: '6 4' };
                    label += ' — NEVER FIRED';
                } else if (count > 1) {
                    style = { color: '#fd7e14', weight: 2, fillOpacity: 0.1 };
                    label += ' — fired x' + count;
                } else {
                    style = { color: '#198754', weight: 2, fillOpacity: 0.1 };
                    label += ' — fired';
                }
            }
            addSpotGeometry(group, step, style, label);
        });
        if (options.allZones) {
            (spots.offlimits || []).forEach(function(spot, index) {
                addSpotGeometry(group, spot, { color: '#dc3545', weight: 2, fillOpacity: 0.12 }, 'Offlimit ' + index + ': ' + (spot.name || ''));
            });
            (spots.zones || []).forEach(function(spot, index) {
                addSpotGeometry(group, spot, { color: '#20c997', weight: 2, fillOpacity: 0.05 }, 'Zone ' + index + ': ' + (spot.name || ''));
            });
        }
    }

    // Accuracy-coloured track: batch consecutive fixes whose pair-bucket
    // (worse endpoint) is identical into one polyline per run.
    function addColoredTrack(group, gpsEvents) {
        if (gpsEvents.length < 2) return;
        var runPoints = [[gpsEvents[0].data.lat, gpsEvents[0].data.lng]];
        var runBucket = null;

        for (var i = 1; i < gpsEvents.length; i++) {
            var prev = gpsEvents[i - 1];
            var curr = gpsEvents[i];
            var bucket = Math.max(accBucket(prev.data.acc), accBucket(curr.data.acc));
            var point = [curr.data.lat, curr.data.lng];

            if (runBucket === null) runBucket = bucket;
            if (bucket === runBucket) {
                runPoints.push(point);
            } else {
                group.addLayer(L.polyline(runPoints, { color: ACC_BUCKETS[runBucket].color, weight: 3, opacity: 0.9 }));
                runPoints = [runPoints[runPoints.length - 1], point];
                runBucket = bucket;
            }
        }
        if (runPoints.length > 1) {
            group.addLayer(L.polyline(runPoints, { color: ACC_BUCKETS[runBucket].color, weight: 3, opacity: 0.9 }));
        }
    }

    function addFlatTrack(group, gpsEvents, color) {
        if (!gpsEvents.length) return;
        var latlngs = gpsEvents.map(function(event) { return [event.data.lat, event.data.lng]; });
        group.addLayer(L.polyline(latlngs, { color: color || '#0dcaf0', weight: 3, opacity: 0.92 }));
    }

    // Translucent accuracy circles, decimated so dense tracks stay readable.
    function addAccuracyRibbon(group, gpsEvents) {
        var lastKept = null;
        gpsEvents.forEach(function(event, index) {
            var point = [event.data.lat, event.data.lng];
            var acc = Number(event.data.acc);
            if (!Number.isFinite(acc) || acc <= 0) return;
            if (lastKept && distanceMeters(lastKept, point) < 8 && index % 10 !== 0) return;
            lastKept = point;
            group.addLayer(L.circle(point, {
                radius: acc,
                color: ACC_BUCKETS[accBucket(acc)].color,
                weight: 1,
                opacity: 0.35,
                fillOpacity: 0.18,
                interactive: false
            }));
        });
    }

    function nearestFixBefore(gpsEvents, t) {
        var found = null;
        for (var i = 0; i < gpsEvents.length; i++) {
            if (gpsEvents[i].t > t) break;
            found = gpsEvents[i];
        }
        return found || gpsEvents[0] || null;
    }

    function describeProblem(event) {
        var data = event.data || {};
        return [
            event.type,
            data.gapMs != null ? 'gap:' + TM.util.formatGap(Number(data.gapMs)) : null,
            data.ageMs != null ? 'age:' + TM.util.formatGap(Number(data.ageMs)) : null,
            data.reason ? 'reason:' + data.reason : null,
            data.acc != null ? 'acc:' + data.acc + 'm' : null,
            data.source ? 'src:' + data.source : null,
            new Date(event.t).toLocaleTimeString('fr-FR')
        ].filter(Boolean).join(' · ');
    }

    // Pin GPS problems where they happened — the prospecting payoff.
    function addProblemMarkers(group, events, gpsEvents) {
        if (!gpsEvents.length) return;
        (events || []).forEach(function(event) {
            var style = PROBLEM_STYLES[event.type];
            if (!style) return;
            if (event.type === 'gps_callback_gap') {
                var gap = Number(event.data && event.data.gapMs);
                if (!Number.isFinite(gap) || gap < 8000) return;
            }
            var fix = nearestFixBefore(gpsEvents, event.t);
            if (!fix) return;
            group.addLayer(L.circleMarker([fix.data.lat, fix.data.lng], {
                radius: 6,
                color: '#ffffff',
                weight: 1,
                fillColor: style.color,
                fillOpacity: 0.95
            }).bindTooltip(describeProblem(event)));
        });
    }

    function addStartEndMarkers(group, gpsEvents, labelPrefix) {
        if (!gpsEvents.length) return;
        var first = gpsEvents[0];
        var last = gpsEvents[gpsEvents.length - 1];
        group.addLayer(L.circleMarker([first.data.lat, first.data.lng], { radius: 7, color: '#198754', fillOpacity: 0.8 })
            .bindTooltip((labelPrefix || '') + 'Start'));
        group.addLayer(L.circleMarker([last.data.lat, last.data.lng], { radius: 7, color: '#dc3545', fillOpacity: 0.8 })
            .bindTooltip((labelPrefix || '') + 'End'));
    }

    function addStepFireMarkers(group, events, gpsEvents) {
        (events || []).filter(function(event) { return event.type === 'step_fire'; }).forEach(function(event) {
            var fix = nearestFixBefore(gpsEvents, event.t);
            if (!fix) return;
            group.addLayer(L.circleMarker([fix.data.lat, fix.data.lng], {
                radius: 5,
                color: '#ffffff',
                fillColor: '#ffc107',
                fillOpacity: 0.9,
                weight: 1
            }).bindTooltip((event.data && event.data.name) || ('Step ' + (event.data && event.data.step))));
        });
    }

    function computeFireCounts(events) {
        var counts = new Map();
        (events || []).forEach(function(event) {
            if (event.type !== 'step_fire' || !event.data || !Number.isInteger(event.data.step)) return;
            counts.set(event.data.step, (counts.get(event.data.step) || 0) + 1);
        });
        return counts;
    }

    function captureView(map) {
        var center = map.getCenter();
        return { center: [center.lat, center.lng], zoom: map.getZoom() };
    }

    /**
     * Detail map handle.
     * opts: { colored (default true), ribbon, problems, fireStatus, lightSteps,
     *         allZones, viewKey }
     * Returns { map, refresh(newOpts), appendEvents(), setScrub(gpsIndex), destroy() }.
     */
    function renderDetailMap(containerId, data, overlay, opts) {
        var options = Object.assign({ colored: true, ribbon: false, problems: false, fireStatus: false, lightSteps: false, allZones: false }, opts || {});
        var viewKey = options.viewKey || ('detail:' + data.sessionId);

        var map = createBaseMap(containerId);
        var featureGroup = L.featureGroup().addTo(map);
        var scrubMarker = null;
        var destroyed = false;
        var firstDraw = true;

        function draw() {
            featureGroup.clearLayers();
            var events = data.events || [];
            var gpsEvents = getGpsEvents(events);

            addOverlayZones(featureGroup, overlay, {
                fireCounts: options.fireStatus ? computeFireCounts(events) : null,
                lightSteps: options.lightSteps,
                allZones: options.allZones
            });
            if (options.colored) addColoredTrack(featureGroup, gpsEvents);
            else addFlatTrack(featureGroup, gpsEvents);
            if (options.ribbon) addAccuracyRibbon(featureGroup, gpsEvents);
            addStepFireMarkers(featureGroup, events, gpsEvents);
            if (options.problems) addProblemMarkers(featureGroup, events, gpsEvents);
            addStartEndMarkers(featureGroup, gpsEvents);

            if (firstDraw) {
                var saved = viewStates.get(viewKey);
                if (saved) map.setView(saved.center, saved.zoom, { animate: false });
                else if (featureGroup.getLayers().length > 0) map.fitBounds(featureGroup.getBounds().pad(0.08));
                firstDraw = false;
            }
        }

        map.on('moveend zoomend', function() {
            if (!destroyed) viewStates.set(viewKey, captureView(map));
        });

        draw();
        setTimeout(function() { if (!destroyed) map.invalidateSize(); }, 80);

        return {
            map: map,
            refresh: function(newOpts) {
                Object.assign(options, newOpts || {});
                draw();
            },
            appendEvents: function() {
                // data.events was mutated by the api tail merge — just redraw.
                draw();
            },
            setScrub: function(gpsIndex) {
                var gpsEvents = getGpsEvents(data.events || []);
                var fix = gpsEvents[gpsIndex];
                if (!fix) return null;
                var point = [fix.data.lat, fix.data.lng];
                if (!scrubMarker) {
                    scrubMarker = L.circleMarker(point, {
                        radius: 9,
                        color: '#ffffff',
                        weight: 2,
                        fillColor: '#0d6efd',
                        fillOpacity: 0.95
                    }).addTo(map);
                } else {
                    scrubMarker.setLatLng(point);
                }
                return fix;
            },
            destroy: function() {
                destroyed = true;
                viewStates.set(viewKey, captureView(map));
                map.remove();
            }
        };
    }

    // Average-accuracy heat, robust to faulty devices: fixes are binned into
    // ~25 m cells, averaged PER DEVICE first, then the cell value is the
    // MEDIAN across devices — one phone with bad GPS is outvoted wherever at
    // least two phones passed. Cells are drawn as overlapping meter-scaled
    // blobs so areas read as zones, not point clouds; single-device cells are
    // dimmed (low confidence) and cells with under 3 fixes are dropped.
    function addAccuracyHeat(group, items) {
        var CELL_M = 25;
        var MIN_FIXES = 3;
        var cells = new Map(); // key -> { perDevice: Map(dev -> {sum,n}), latSum, lngSum, n }

        items.forEach(function(item) {
            var device = (item.session && item.session.deviceUuid) || item.session.sessionId;
            getGpsEvents(item.data.events || []).forEach(function(event) {
                var acc = Number(event.data.acc);
                if (!Number.isFinite(acc) || acc <= 0) return;
                var dLat = CELL_M / 111320;
                var dLng = CELL_M / (111320 * Math.cos(event.data.lat * Math.PI / 180));
                var key = Math.round(event.data.lat / dLat) + '_' + Math.round(event.data.lng / dLng);
                var cell = cells.get(key);
                if (!cell) { cell = { perDevice: new Map(), latSum: 0, lngSum: 0, n: 0 }; cells.set(key, cell); }
                var deviceAgg = cell.perDevice.get(device);
                if (!deviceAgg) { deviceAgg = { sum: 0, n: 0 }; cell.perDevice.set(device, deviceAgg); }
                deviceAgg.sum += acc;
                deviceAgg.n += 1;
                cell.latSum += event.data.lat;
                cell.lngSum += event.data.lng;
                cell.n += 1;
            });
        });

        cells.forEach(function(cell) {
            if (cell.n < MIN_FIXES) return;
            var deviceMeans = Array.from(cell.perDevice.values())
                .map(function(agg) { return agg.sum / agg.n; })
                .sort(function(a, b) { return a - b; });
            var mid = Math.floor(deviceMeans.length / 2);
            var median = deviceMeans.length % 2 ? deviceMeans[mid] : (deviceMeans[mid - 1] + deviceMeans[mid]) / 2;
            var deviceCount = deviceMeans.length;

            group.addLayer(L.circle([cell.latSum / cell.n, cell.lngSum / cell.n], {
                radius: CELL_M * 0.8,
                weight: 0,
                fillColor: ACC_BUCKETS[accBucket(median)].color,
                fillOpacity: deviceCount >= 2 ? 0.4 : 0.18
            }).bindTooltip(
                median.toFixed(1) + 'm · median of ' + deviceCount + ' device' + (deviceCount > 1 ? 's' : '') +
                ' · ' + cell.n + ' fixes' + (deviceCount < 2 ? ' · low confidence' : '')
            ));
        });
    }

    /**
     * Group map. mode 'tracks' (default): one coloured track per session with
     * hover/click callbacks. mode 'accuracy': aggregated avg-accuracy heat.
     * opts.stepRates colours step zones by cross-walk fire rate (Parcours view).
     * items: [{ session, data }]; overlay drawn when all sessions share a parcours.
     */
    function renderGroupMap(containerId, items, overlay, opts) {
        var options = opts || {};
        var viewKey = options.viewKey || ('group:' + containerId);
        var map = createBaseMap(containerId);
        // Overlay zones live in their own group: the initial view fits the
        // PARCOURS area, not the data — outlier fixes (old simulations far
        // from the parcours) must not blow up the zoom.
        var overlayGroup = L.featureGroup().addTo(map);
        var featureGroup = L.featureGroup().addTo(map);

        // Neutral grey steps as background context (or reliability-coloured
        // ones in the Parcours view), to keep tracks/heat readable.
        addOverlayZones(overlayGroup, overlay, options.stepRates
            ? { stepRates: options.stepRates }
            : { greySteps: true });

        if (options.mode === 'accuracy') {
            addAccuracyHeat(featureGroup, items);
            finishGroupMap(map, featureGroup, viewKey, overlayGroup);
            return { map: map, destroy: function() { map.remove(); } };
        }

        items.forEach(function(item, index) {
            var color = TRACK_PALETTE[index % TRACK_PALETTE.length];
            var gpsEvents = getGpsEvents(item.data.events || []);
            if (!gpsEvents.length) return;

            var latlngs = gpsEvents.map(function(event) { return [event.data.lat, event.data.lng]; });
            var track = L.polyline(latlngs, { color: color, weight: 3, opacity: 0.92 })
                .bindTooltip(item.session.sessionId + ' · ' + (item.session.deviceModel || ''));

            track.on('mouseover', function() {
                track.setStyle({ weight: 6, opacity: 1 });
                if (options.onTrackHover) options.onTrackHover(item.session.sessionId, true);
            });
            track.on('mouseout', function() {
                track.setStyle({ weight: 3, opacity: 0.92 });
                if (options.onTrackHover) options.onTrackHover(item.session.sessionId, false);
            });
            track.on('click', function() {
                if (options.onTrackClick) options.onTrackClick(item.session.sessionId);
            });

            featureGroup.addLayer(track);
            featureGroup.addLayer(L.circleMarker(latlngs[0], {
                radius: 5, color: color, fillColor: color, fillOpacity: 0.7, weight: 1
            }).bindTooltip('Start ' + item.session.sessionId));
            featureGroup.addLayer(L.circleMarker(latlngs[latlngs.length - 1], {
                radius: 5, color: '#ffffff', fillColor: color, fillOpacity: 0.95, weight: 1
            }).bindTooltip('End ' + item.session.sessionId));
        });

        finishGroupMap(map, featureGroup, viewKey, overlayGroup);
        return {
            map: map,
            destroy: function() { map.remove(); }
        };
    }

    function finishGroupMap(map, featureGroup, viewKey, overlayGroup) {
        var saved = viewStates.get(viewKey);
        if (saved) {
            map.setView(saved.center, saved.zoom, { animate: false });
        } else if (overlayGroup && overlayGroup.getLayers().length > 0) {
            map.fitBounds(overlayGroup.getBounds().pad(0.08));
        } else if (featureGroup.getLayers().length > 0) {
            map.fitBounds(featureGroup.getBounds().pad(0.08));
        }

        map.on('moveend zoomend', function() { viewStates.set(viewKey, captureView(map)); });
        setTimeout(function() { map.invalidateSize(); }, 80);
    }

    return {
        ACC_BUCKETS: ACC_BUCKETS,
        PROBLEM_STYLES: PROBLEM_STYLES,
        TRACK_PALETTE: TRACK_PALETTE,
        accBucket: accBucket,
        getGpsEvents: getGpsEvents,
        renderDetailMap: renderDetailMap,
        renderGroupMap: renderGroupMap
    };
})();
