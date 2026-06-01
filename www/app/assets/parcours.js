var allSteps = [];

// LOST entry threshold (metres of distanceToBorder to the nearest reachable
// step). Recovery is not a distance threshold — the walker exits LOST when
// they are back INSIDE any reachable step (see evaluateLostState), which
// syncs the band hiding with the position tick that resumes/fires audio.
const LOST_ENTER_M = 50;
// Sustain window: only enter LOST after the walker has been beyond
// LOST_ENTER_M continuously for this long. Filters single bad GPS fixes.
const LOST_SUSTAIN_MS = 15000;

// A step is mandatory unless it is explicitly marked optional. The editor
// creates new steps with { optional: false }, so an absent flag is treated as
// mandatory too — the safer default for a guided walk (don't let walkers skip
// steps unless a step is explicitly opted out). Drives both reachableSteps()
// and the Step.updatePosition sequential fire-gate (see P1.25 / former P1.8).
function isStepMandatory(step) {
    return !step || !step._spot || step._spot.optional !== true;
}

class Parcours extends EventEmitter {
    constructor() {
        super()
        this.map = null;
        // Telemetry events captured before TELEMETRY.start() has run (notably
        // parcours_restore, which fires during the module-load restore() at the
        // top of pages.js, ~1500 lines before the parcours-page TELEMETRY.start).
        // Drained by flushPendingTelemetry() once the session is live.
        this._pendingTelemetry = [];
        this.clear();
    }

    // Either log immediately if a session is active, or stash to be drained
    // when one becomes active. Field test 2026-05-18: parcours_restore events
    // were lost across all 22 sessions because build() runs at parse time and
    // _log() is a no-op without a sessionId.
    _logOrStash(type, data) {
        if (typeof TELEMETRY === 'undefined') return;
        if (typeof TELEMETRY.hasSession === 'function' && TELEMETRY.hasSession()) {
            TELEMETRY.log(type, data);
        } else {
            this._pendingTelemetry.push({type: type, data: data});
        }
    }

    flushPendingTelemetry() {
        if (!this._pendingTelemetry.length) return;
        if (typeof TELEMETRY === 'undefined') return;
        var drained = this._pendingTelemetry;
        this._pendingTelemetry = [];
        drained.forEach(function(e) { TELEMETRY.log(e.type, e.data); });
    }

    add(spot) {
        if (!this.spots[spot._type]) this.spots[spot._type] = [];
        this.spots[spot._type].push(spot);
    }

    remove(spot) {
        this.spots[spot._type] = this.spots[spot._type].filter(s => s !== spot);
    }

    clear() {

        // Clear all spots        
        for (let type in this.spots) {
            this.spots[type].map(s => s.clear());
            this.spots[type] = [];
        }

        // Clear internals
        this.spots = {};
        this.coords = null;
        allSteps = [];
        
        // Clear info
        this.pID = null;
        this.info = {
            name: '',
            status: '',
            coords: '',
            cutoff: -1
        };

        // Clear state
        this.clearState();
    }

    clearState() {
        this.state = {
            stepIndex: -2,
            globalOfflimit: false,
            geoMode: null,
            medialoaded: false,
            mediaPack: [],
            mediaPackSize: 0,
            mediaPackLoaded: 0,
            resumeStepVoicePos: 0,
            // True once the step at stepIndex has completed its audio. Persisted
            // because Step._done is in-memory only — without this, a reload
            // points the LOST target back at the finished step instead of the
            // next one. Reset to false whenever a new step becomes current.
            stepDone: false,
            // LOST state — true while the walker is too far from where they
            // should be. Persisted via store() so a kill-and-relaunch wakes
            // back up in LOST instead of silent.
            lost: false,
            lostSince: null,
            // R21: stamp every successful store() so a cold relaunch can
            // compare against the native NSUserDefaults snapshot and pick the
            // fresher seek position. 0 means "never stored on this session".
            lastUpdatedMs: 0
        };
        // Sustain timer is local-only — on relaunch the GPS picture is fresh
        // so we restart the accumulator rather than trusting a stale value.
        this._lostBeyondSince = null;
        // Last (step|reason|playstate) key emitted as voice_snapshot_skipped —
        // see _maybeLogSnapshotSkipped for the throttling rationale.
        this._lastSnapshotSkipKey = null;
    }

    snapshotVoicePosition(triggerReason) {
        if (this.state.stepIndex < 0) return
        let step = this.find('steps', this.state.stepIndex)
        if (!step || !step.player) {
            this._maybeLogSnapshotSkipped({
                step: this.state.stepIndex, reason: !step ? 'no_step' : 'no_player', trigger: triggerReason,
            })
            return
        }
        let playstate = step.player.playstate
        if (playstate !== 'play') {
            this._maybeLogSnapshotSkipped({
                step: this.state.stepIndex, reason: 'playstate', playstate, trigger: triggerReason,
            })
            return
        }
        let voice = step.player.voice
        let pos = voice && voice.seek ? voice.seek() : 0
        // Cross-check whether the voice player is actually playing the audio.
        // Field test 2026-05-18 surfaced sessions where playstate='play' but
        // voice.seek() returned 0 for 5+ minutes (stuck Android cold-load).
        // Recording the underlying state distinguishes "voice never started"
        // (audio_playing=false, pos=0) from "voice just started" (audio_playing
        // true, pos=0) from "voice running normally" (audio_playing=true, pos>0).
        let actuallyPlaying = false
        let loadState = 'unknown'
        try {
            if (voice) {
                if (voice._player && typeof voice._player.playing === 'function') {
                    actuallyPlaying = !!voice._player.playing()
                }
                if (typeof voice.loadState === 'function') loadState = voice.loadState()
            }
        } catch(e) {}
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('voice_snapshot', {
            step: this.state.stepIndex, pos, playstate, trigger: triggerReason,
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            audio_playing: actuallyPlaying,
            load_state: loadState,
        })
        // A4: only persist once the new step's voice has accumulated ≥3 s of
        // playback. Pairs with the step_fire clear in spot.js so a crash within
        // the first few seconds of a fresh step resumes from 0 rather than
        // inheriting the previous step's saved position (P8 / `rumx` 2026-05-20).
        if (pos > 3) this.state.resumeStepVoicePos = pos
        // Reset the skip dedup once we've actually logged a real snapshot —
        // so the next genuine skip after a play run gets recorded once.
        this._lastSnapshotSkipKey = null
    }

    // R4.9: throttle voice_snapshot_skipped to one event per (step, reason,
    // playstate) transition. The 5s interval would otherwise produce hundreds
    // of identical events during normal afterplay phases (4,264 across the
    // 2026-05-18 test) without adding any signal beyond the first occurrence.
    _maybeLogSnapshotSkipped(payload) {
        if (typeof TELEMETRY === 'undefined') return
        let key = (payload.step != null ? payload.step : '?') + '|' + payload.reason + '|' + (payload.playstate || '-')
        if (this._lastSnapshotSkipKey === key) return
        this._lastSnapshotSkipKey = key
        TELEMETRY.log('voice_snapshot_skipped', payload)
    }

    currentStep(s = null) {
        if (s !== null) {
            this.state.stepIndex = s;
            this.state.stepDone = false; // new current step — not done yet
            this.store();
            this.prewarmUpcomingStep('current-step-change');
        }
        return this.state.stepIndex;
    }

    prewarmUpcomingStep(reason = 'unknown') {
        let nextIndex = this.state.stepIndex < 0 ? 0 : this.state.stepIndex + 1;
        let steps = this.spots.steps || [];
        steps.forEach(step => {
            if (typeof step.holdLoadedForUpcomingTrigger === 'function') {
                step.holdLoadedForUpcomingTrigger(step._index === nextIndex);
            }
        });

        let nextStep = this.find('steps', nextIndex);
        if (nextStep && typeof nextStep.prewarmForLockedStart === 'function') {
            nextStep.prewarmForLockedStart(reason);
        }
    }

    telemetryRouteProbe(position, triggerAccepted = true) {
        if (typeof TELEMETRY === 'undefined') return;

        let currentIndex = this.state.stepIndex;
        let nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
        let currentStep = currentIndex >= 0 ? this.find('steps', currentIndex) : null;
        let nextStep = this.find('steps', nextIndex) || null;

        TELEMETRY.log('route_probe', {
            acceptedForTrigger: triggerAccepted,
            currentStep: currentStep ? currentStep._index : currentIndex,
            currentName: currentStep ? currentStep._spot.name : null,
            currentDistanceToBorder: currentStep ? currentStep.distanceToBorder(position) : null,
            currentDistanceToCenter: currentStep ? currentStep.distanceToCenter(position) : null,
            nextStep: nextStep ? nextStep._index : null,
            nextName: nextStep ? nextStep._spot.name : null,
            nextDistanceToBorder: nextStep ? nextStep.distanceToBorder(position) : null,
            nextDistanceToCenter: nextStep ? nextStep.distanceToCenter(position) : null,
            gpsAccuracy: position && position.coords ? Math.round(position.coords.accuracy) : null
        });
    }

    find(type, index) {
        let list = this.spots[type];
        if (!list) return undefined;
        return list.find(s => s._index === index);
    }

    select(type, index, exclusive = true) {
        let spot = this.find(type, index);
        if (spot) spot.select(exclusive);
    }

    unselectAll(exception = null) {
        for (let type in this.spots) {
            this.spots[type].map(s => {
                if (s !== exception) s.unselect();
            });
        }
    }

    valid() {
        return this.pID !== null && this.state.medialoaded === true;
    }

    setMap(map) {
        this.map = map;
        for (let type in this.spots) {
            this.spots[type].map(s => s.setMap(map));
        }
        if (this.coords) this.map.setView(geo_coords(this.coords), this.map.getZoom());
    }

    setCoords(coords) {
        this.coords = coords;
    }

    // Build parcours from data
    build(data, reloading = false) {
        
        // Check
        if (!data || !('info' in data)) throw new Error('No data');
        if (!data.spots) data.spots = {};

        this.clear();

        this.info = data.info || {};

        // Parse pID
        if (data.pID) this.pID = data.pID;

        // Coords
        if (!data.info.coords) data.info.coords = "13/45.76537/4.88377";
        const [zoom, lat, lng] = data.info.coords.split('/');
        this.coords = { lat: lat, lng: lng };

        // Map
        if (this.map && !reloading) this.map.setView(geo_coords(this.coords), zoom);

        // Spots
        for (let type in data.spots)
            data.spots[type].forEach((spot, i) => this.addSpot(type, spot));
        

        // Load State
        if (data.state) this.state = { ...this.state, ...data.state };
        this.state.medialoaded = this.state.mediaPackSize > 0 && this.state.mediaPackLoaded >= this.state.mediaPackSize;
        if (data.state) this._logOrStash('parcours_restore', {
            stepIndex: this.state.stepIndex,
            stepDone: this.state.stepDone,
            resumeStepVoicePos: this.state.resumeStepVoicePos,
            lost: this.state.lost,
            reloading,
        })

        // Restore the current step's _done flag from persisted state. Step._done
        // is in-memory only; without this, after a reload lostTarget() and the
        // spot re-fire gating would treat a finished step as still in progress.
        if (this.state.stepDone && this.state.stepIndex >= 0) {
            let curStep = this.find('steps', this.state.stepIndex);
            if (curStep) curStep._done = true;
        }

        // Link with GEO
        GEO.removeAllListeners('position');
        GEO.on('position', (position) => {
            this.update(position)
        })

        this.prewarmUpcomingStep('build')

        this.store();
        return this;
    }

    load(parcoursID, reloading = false) {
        return new Promise((resolve, reject) => {
            if (!parcoursID) parcoursID = this.pID;
            else this.pID = parcoursID;

            if (!parcoursID) {
                reject('No parcours ID');
                return;
            }

            get('/edit/' + parcoursID + '/json')
                .then(data => {

                    // BUILD PARCOURS from remote data
                    data.pID = parcoursID; // ensure pID is set
                    this.build(data, reloading);

                    // ESTIMATE MEDIA
                    this.loadmedia( true ) // true -> dryrun ! must call loadmedia() to actually load media
                        .then(() => {
                            console.log('Parcours loaded', data);
                            resolve();
                        })
                        .catch(error => {
                            console.warn('Error preloading media', error);
                            reject(error);
                        });
                })
                .catch(error => {
                    this.pID = null;
                    reject(error);
                });
        });
    }
    
    loadmedia(dryrun = false) 
    {
        return new Promise((resolve, reject) => {
            if (!this.pID) {
                reject('No parcours ID');
                return;
            }
            
            // Get media list
            get('/update/media/' + this.pID)
            .then(data => {
                console.log('MEDIA', data);

                this.state.mediaPack = Object.keys(data);

                // Cache each file's expected size so quickMediaCheck() can verify the
                // pack on disk at every startup WITHOUT a network round-trip (the
                // /update/media list can come back empty on a flaky connection — see
                // the 2026-06-01 03o0 session where it returned total:0 and the
                // integrity check passed vacuously while two files were missing).
                this.state.mediaPackInfo = {};
                this.state.mediaPack.forEach(f => { this.state.mediaPackInfo[f] = { size: data[f].size }; });

                // mediaPackSize sum of all media files size
                this.state.mediaPackSize = this.state.mediaPack.reduce((sum, file) => sum + data[file].size, 0);
                this.state.mediaPackLoaded = 0;

                // WEB MODE: skip media loading
                if (!document.WEBAPP_URL) {
                    console.log('WEB MODE: Media loading skipped');
                    this.state.medialoaded = true;
                    this.state.mediaPackLoaded = this.state.mediaPackSize;
                    this.store();
                    resolve();
                    return;
                }

                // DOWNLOAD MEDIA
                var failedFiles = [];
                const downloadSequence = this.state.mediaPack.reduce((promiseChain, file) => {
                    let info = data[file];
                    let path = this.pID + '/' + file;
                    return promiseChain.then(() => media_download(path, info, dryrun))
                        .then(() => {
                            console.log('Media loaded', path);
                            this.state.mediaPackLoaded += info.size;
                        })
                        .catch(error => {
                            if (error === 'DRYRUN') {
                                console.log('Media dryrun', path);
                                return;
                            }
                            console.warn('Error loading media', path, error);
                            failedFiles.push(path);
                            this.state.mediaPackLoaded += info.size; // count as processed
                        });
                }, Promise.resolve());

                downloadSequence
                    .then(() => {
                        if (failedFiles.length > 0) {
                            console.warn('Media download: ' + failedFiles.length + ' file(s) failed:', failedFiles);
                            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('media_download_partial', {failed: failedFiles.length, total: this.state.mediaPack.length, files: failedFiles});
                            reject('media_partial: ' + failedFiles.length + ' file(s) failed');
                            return;
                        }
                        if (!dryrun) this.state.medialoaded = true;
                        this.store();
                        resolve();
                    });
            })
            .catch(error => {
                reject(error);
            });
        });
    }

    // C2 — passive media integrity check. Iterates the cached mediaPack and
    // verifies each file is present and validates against the server-side
    // size/hash. Read-only: does NOT mutate state. Returns a Promise resolving
    // to {total, ok, failed, failed_files} so the caller can log telemetry
    // without blocking the walk. Skipped silently in WEB mode (no local FS).
    verifyMediaIntegrity() {
        return new Promise((resolve) => {
            if (!this.pID || !document.WEBAPP_URL || typeof media_download !== 'function') {
                resolve({ total: 0, ok: 0, failed: 0, failed_files: [], skipped: true });
                return;
            }
            get('/update/media/' + this.pID)
                .then(data => {
                    let files = Object.keys(data);
                    let ok = 0;
                    let failedFiles = [];
                    let chain = Promise.resolve();
                    files.forEach(file => {
                        let info = data[file];
                        let path = this.pID + '/' + file;
                        chain = chain.then(() => media_download(path, info, true))
                            .then(() => { ok++; })
                            .catch(err => {
                                if (err === 'DRYRUN') failedFiles.push(file);
                                else failedFiles.push(file + ' (' + err + ')');
                            });
                    });
                    chain.then(() => resolve({
                        total: files.length,
                        ok: ok,
                        failed: failedFiles.length,
                        failed_files: failedFiles.slice(0, 20),
                        skipped: false,
                    }));
                })
                .catch(() => resolve({ total: 0, ok: 0, failed: 0, failed_files: [], skipped: true, error: 'media_list_unreachable' }));
        });
    }

    // Fast on-disk presence + size check, run at EVERY startup (checkdata) before
    // a cached "valid" parcours is reused for a walk. `medialoaded` alone is a
    // persisted flag that survives file eviction / a hung re-download, so the walk
    // could start with missing media (2026-06-01 03o0: two voice files gone, walk
    // ran anyway). This verifies the actual files against the per-file sizes cached
    // at load time — local-only (no network, works offline) and no hashing, so it
    // stays sub-second even on a mid-walk resume. Returns Promise<{ok, missing, checked, reason}>.
    quickMediaCheck() {
        return new Promise((resolve) => {
            if (!this.pID || !document.WEBAPP_URL || typeof media_download !== 'function') {
                // WEB mode / no local FS — nothing to verify, don't block.
                resolve({ ok: true, missing: [], checked: 0, reason: 'no_fs' });
                return;
            }
            let info = this.state.mediaPackInfo || {};
            let files = Object.keys(info);
            if (files.length === 0) {
                // Legacy install loaded before sizes were cached — we can't verify
                // locally and won't make a (possibly offline) network call here, so
                // don't block. The pack is re-stamped with sizes on its next load.
                resolve({ ok: true, missing: [], checked: 0, reason: 'no_cached_sizes' });
                return;
            }
            let missing = [];
            let chain = Promise.resolve();
            files.forEach(file => {
                let path = this.pID + '/' + file;
                // size-only (no hash) → media_download dryrun resolves on a size match,
                // rejects 'DRYRUN' when the file is missing or the wrong size.
                chain = chain.then(() => media_download(path, { size: info[file].size }, true))
                    .then(() => {})
                    .catch(() => { missing.push(file); });
            });
            chain.then(() => resolve({ ok: missing.length === 0, missing: missing, checked: files.length }));
        });
    }

    loadprogress() {
        if (this.state.mediaPackSize === 0) return 0;
        return Math.round(this.state.mediaPackLoaded / this.state.mediaPackSize * 100);
    }

    addSpot(type, spot) {
        let index = 0;
        var s = null;
        console.log('addSpot', type, spot);
        if (this.spots[type]) index = this.spots[type].length;
        if (type === 'zones') s = new Zone(spot, this.map, index, this.pID);
        if (type === 'steps') s = new Step(spot, this.map, index, this.pID);
        if (type === 'offlimits') s = new Offlimit(spot, this.map, index, this.pID);
        if (s) {
            s.on('enter', () => this.emit('enter', s));
            s.on('leave', () => this.emit('leave', s));
            s.on('fire', (spot, meta) => this.emit('fire', spot, meta));
            s.on('done', () => {
                // Persist done-state for the current step so a reload guides the
                // walker to the NEXT step instead of back to this finished one.
                if (type === 'steps' && s._index === this.state.stepIndex) {
                    this.state.stepDone = true;
                    this.store();
                }
                this.emit('done', s);
            });
        }
        return this;
    }

    deleteSpot(type, index) {
        this.spots[type].splice(index, 1)[0].clear();
        return this;
    }

    moveSpot(type, source, target) {
        if (source < 0 || source >= this.spots[type].length) return this;
        if (target < 0 || target >= this.spots[type].length) return this;

        let temp = this.spots[type][source];
        this.spots[type][source] = this.spots[type][target];
        this.spots[type][target] = temp;

        this.spots[type].map((s, i) => s.index(i));
        return this;
    }

    hideSpotMarkers() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.hideMarker());
        }
        return this;
    }

    showSpotMarkers(type = null) {
        if (type) {
            if (this.spots[type]) this.spots[type].map(s => s.showMarker());
        }
        else {
            for (let t in this.spots) {
                this.spots[t].map(s => s.showMarker());
            }
        }
        return this;
    }

    showSpotMarker(type, index, center = false, quick = true) {
        this.hideSpotMarkers();
        if (this.spots[type][index]) {
            this.spots[type][index].showMarker();
            if (center) this.spots[type][index].center(quick);
        }
        return this;
    }

    export(full = false) 
    {
        var data = {
            info: this.info,
            spots: {}
        };
        for (let type in this.spots)
            data.spots[type] = this.spots[type].map(s => s._spot);

        // export mediaPack info
        if (full) {
            data.state = this.state;
            data.pID = this.pID;
        }

        return data;
    }

    exportCSV() {
        let csv = 'type;index;name;media;voice;music;ambiant;offlimit;afterplay\n';
        for (let type in this.spots) {
            this.spots[type].forEach((spot, index) => {
                csv += `${type};${index};${spot.name()}`;
                csv += `;${spot._spot.media.src ? spot._spot.media.src : ''}`;
                csv += `;${spot._spot.media.voice ? spot._spot.media.voice.src : ''}`;
                csv += `;${spot._spot.media.music ? spot._spot.media.music.src : ''}`;
                csv += `;${spot._spot.media.ambiant ? spot._spot.media.ambiant.src : ''}`;
                csv += `;${spot._spot.media.offlimit ? spot._spot.media.offlimit.src : ''}`;
                csv += `;${spot._spot.media.afterplay ? spot._spot.media.afterplay.src : ''}\n`;
            });
        }
        return csv;
    }

    save() {
        console.log('save', this.export());
        return new Promise((resolve, reject) => {
            post('/edit/' + this.pID + '/json', this.export())
                .then(data => {
                    if (data) resolve(data);
                    else {
                        console.error(data);
                        reject('Error saving parcours');
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    // Store parcours in localStorage
    store(triggerReason) {
        if (!this.valid()) {
            console.warn('Cannot store parcours: not valid yet');
            return;
        }
        this.snapshotVoicePosition(triggerReason)
        this.state.lastUpdatedMs = Date.now();
        try {
            localStorage.setItem('currentparcours', JSON.stringify(this.export(true)));
            if (triggerReason && typeof TELEMETRY !== 'undefined') TELEMETRY.log('parcours_store', {
                trigger: triggerReason,
                stepIndex: this.state.stepIndex,
                resumeStepVoicePos: this.state.resumeStepVoicePos,
                visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            })
        }
        catch (error) { console.error('Error storing parcours:', error); }

        // R21: dual-write to NSUserDefaults (iOS only). Defensive backup of
        // resumeStepVoicePos that survives a WKWebView cache wipe. Fire-and-
        // forget — never block store() on the native bridge. R25: surface
        // migrated from cordova-plugin-audiofocus to cordova-plugin-audio-simple;
        // NSUserDefaults keys preserved across the migration so any visitor
        // snapshot written before the upgrade is still readable after.
        try {
            if (typeof PLATFORM !== 'undefined' && PLATFORM === 'ios'
                && typeof cordova !== 'undefined' && cordova.plugins
                && cordova.plugins.audio
                && typeof cordova.plugins.audio.setResumeSnapshot === 'function'
                && this.state.stepIndex >= 0) {
                cordova.plugins.audio.setResumeSnapshot({
                    stepId:     this.state.stepIndex,
                    seekPosSec: this.state.resumeStepVoicePos || 0,
                    pID:        this.pID || ''
                });
            }
        } catch (e) { /* fire-and-forget */ }
    }

    // Restore parcours from localStorage
    restore() {
        let stored = localStorage.getItem('currentparcours');
        try {
            let data = JSON.parse(stored);
            if (!data || !data.info || !data.pID || !data.spots || typeof data.spots !== 'object') {
                console.warn('Stored parcours data is structurally invalid, clearing');
                this.clear();
                this.clearStore();
                return;
            }
            console.log('Restoring parcours from localStorage:', data);
            // Capture the ACTUAL last-persistence stamp from the parsed payload
            // before build() — build() ends with store() which rewrites
            // state.lastUpdatedMs to Date.now(), and the native-snapshot
            // freshness comparator would otherwise always lose.
            let lsUpdatedAtRestore = (data.state && Number(data.state.lastUpdatedMs)) || 0;
            this.build(data);
            console.log('Parcours restored from localStorage !');
            // R21: cross-check the native NSUserDefaults snapshot. If iOS wrote
            // a fresher seek position than what just came out of localStorage
            // (possible if a WKWebView cache eviction happened after the last
            // native dual-write), override resumeStepVoicePos and emit a
            // resume_native_override event so post-hoc analysis can quantify
            // how often the native path saved us.
            this._checkNativeResumeSnapshot(lsUpdatedAtRestore);
        }
        catch (error) {
            console.warn('Error restoring parcours:', error);
            this.clear();
            this.clearStore();
            return;
        }
    }

    // R21: async cross-check the native NSUserDefaults resume snapshot against
    // what we just restored from localStorage. Override only if pID + stepId
    // match AND native is meaningfully fresher (>1 s grace to avoid flapping
    // on near-simultaneous writes). Telemetry-only when no override happens.
    _checkNativeResumeSnapshot(lsUpdatedOverride) {
        if (typeof PLATFORM === 'undefined' || PLATFORM !== 'ios') return;
        if (typeof cordova === 'undefined' || !cordova.plugins
            || !cordova.plugins.audio
            || typeof cordova.plugins.audio.getResumeSnapshot !== 'function') return;

        let lsStepId   = this.state.stepIndex;
        let lsSeekPos  = this.state.resumeStepVoicePos || 0;
        let lsPID      = this.pID;
        // Use the pre-build() snapshot of lastUpdatedMs when called from
        // restore() — otherwise build()'s trailing store() would set this to
        // ~now and the native snapshot could never look fresher.
        let lsUpdated  = (typeof lsUpdatedOverride === 'number')
            ? lsUpdatedOverride
            : (this.state.lastUpdatedMs || 0);

        cordova.plugins.audio.getResumeSnapshot().then((snap) => {
            if (!snap || !snap.found) return;
            let pidMatches  = (snap.pID === lsPID);
            let stepMatches = (Number(snap.stepId) === Number(lsStepId));
            let nativeMs    = Number(snap.savedAtMs) || 0;
            let nativeIsFresher = nativeMs > 0 && nativeMs > (lsUpdated + 1000);

            if (pidMatches && stepMatches && nativeIsFresher
                && Math.abs(Number(snap.seekPosSec) - lsSeekPos) > 0.5) {
                let prevSeek = lsSeekPos;
                this.state.resumeStepVoicePos = Number(snap.seekPosSec);
                this._logOrStash('resume_native_override', {
                    stepIndex:    lsStepId,
                    pID:          lsPID,
                    prevSeekPos:  prevSeek,
                    newSeekPos:   this.state.resumeStepVoicePos,
                    lsUpdatedMs:  lsUpdated,
                    nativeMs:     nativeMs,
                    nativeAgeMs:  snap.ageMs,
                    source:       'native'
                });
            } else if (pidMatches && stepMatches) {
                this._logOrStash('resume_snapshot_check', {
                    stepIndex:   lsStepId,
                    pID:         lsPID,
                    lsSeekPos:   lsSeekPos,
                    nativeSeekPos: Number(snap.seekPosSec),
                    lsUpdatedMs: lsUpdated,
                    nativeMs:    nativeMs,
                    source:      'localStorage'
                });
            } else {
                this._logOrStash('resume_snapshot_mismatch', {
                    lsPID:        lsPID,
                    lsStepIndex:  lsStepId,
                    nativePID:    snap.pID,
                    nativeStepId: snap.stepId,
                    reason:       !pidMatches ? 'pID' : 'stepId'
                });
            }
        }).catch(() => { /* Android or pre-R21 build — silent */ });
    }

    // clear Store
    clearStore() {
        try { localStorage.removeItem('currentparcours'); }
        catch (error) { console.error('Error clearing parcours store:', error); }
        // R21: also clear the native NSUserDefaults snapshot so a rearmed
        // loan phone does not resurrect the previous visitor's seek position.
        // R25: surface migrated to cordova-plugin-audio-simple.
        try {
            if (typeof PLATFORM !== 'undefined' && PLATFORM === 'ios'
                && typeof cordova !== 'undefined' && cordova.plugins
                && cordova.plugins.audio
                && typeof cordova.plugins.audio.clearResumeSnapshot === 'function') {
                cordova.plugins.audio.clearResumeSnapshot();
            }
        } catch (e) { /* fire-and-forget */ }
    }

    // The ordered set of steps the walker may legitimately resume into right
    // now. Steps are meant to be near-contiguous, so when the walker drifts
    // (LOST) they should be able to catch back up at:
    //   - the active step, if its audio isn't complete yet (`_done` false)
    //   - the next step in sequence
    //   - any later step, as long as every step strictly before it is optional
    //     (a mandatory step is a hard stop — reachable, but can't be skipped)
    //
    // Keys off `_done`, NOT `_active`: `_active` is an in-memory runtime flag
    // that resets on a quit/resume; `_done` correctly stays false across a
    // resume until the step's audio has actually finished.
    //
    // This single helper drives both LOST recovery (evaluateLostState) and the
    // Step.updatePosition sequential fire-gate, so the two always agree on
    // "which step can the walker be in".
    reachableSteps() {
        let steps = this.spots.steps || [];
        if (!steps.length) return [];
        let idx = this.state.stepIndex;

        // Not started yet — only step 0 is reachable (the rendezvous target).
        if (idx < 0) {
            let s0 = this.find('steps', 0);
            return s0 ? [s0] : [];
        }

        let out = [];

        // Active step, if its audio isn't done yet.
        let cur = this.find('steps', idx);
        if (cur && !cur._done) out.push(cur);

        // Walk forward: include each step; stop after the first mandatory one.
        for (let k = idx + 1; k < steps.length; k++) {
            let step = this.find('steps', k);
            if (!step) continue;
            out.push(step);
            if (isStepMandatory(step)) break;
        }
        return out;
    }

    // The set of steps the walker may legitimately be standing in for LOST
    // evaluation: reachableSteps() PLUS the current step even when its audio
    // is done. A finished step keeps looping its afterplay, so lingering there
    // is expected — LOST must not flag a walker who is correctly inside the
    // zone they just heard. reachableSteps() itself stays done-strict, because
    // the sequential fire-gate must still exclude done steps from re-firing.
    lostReachableSteps() {
        let reachable = this.reachableSteps();
        // Empty means the parcours is finished (last step done) or has no
        // steps — keep it empty so evaluateLostState bails and never enters
        // LOST after the walk is over.
        if (!reachable.length) return reachable;
        let idx = this.state.stepIndex;
        if (idx >= 0) {
            let cur = this.find('steps', idx);
            if (cur && !reachable.includes(cur)) reachable = [cur, ...reachable];
        }
        return reachable;
    }

    // The single step the walker should aim for right now — the nearest of the
    // reachable set. Used by the LOST distance UI and the map marker painter.
    // Falls back to the first reachable step when there's no position fix yet.
    //   - null if the parcours is finished (last step done) or has no steps
    lostTarget() {
        let reachable = this.reachableSteps();
        if (!reachable.length) return null;
        let pos = (typeof GEO !== 'undefined') ? GEO.lastPosition : null;
        if (!pos || !pos.coords) return reachable[0];
        let best = reachable[0];
        let bestD = best.distanceToBorder(pos);
        for (let i = 1; i < reachable.length; i++) {
            let d = reachable[i].distanceToBorder(pos);
            if (d < bestD) { bestD = d; best = reachable[i]; }
        }
        return best;
    }

    // LOST evaluation.
    //   Entry: the walker has been further than LOST_ENTER_M from the NEAREST
    //     step in lostReachableSteps() for a sustained LOST_SUSTAIN_MS.
    //     Measuring against the nearest of that set means heading toward a
    //     step past an optional one is not wrongly flagged; including the
    //     current step even when done means a walker lingering in a finished
    //     step's looping afterplay is not flagged either.
    //   Exit: the walker is back INSIDE any step of that set — they've caught
    //     up. The 'recover' handler in pages.js resumes the active step's
    //     audio; Step.updatePosition fires the step they walked into.
    // Emits 'lost' on entry and 'recover' on exit — UI/audio handlers in
    // pages.js react. The stationary gate and the GPSSIGNAL_OK gate filter
    // pocketed pauses and GPS-signal-loss windows.
    evaluateLostState(position) {
        // GPS-lost takes priority over LOST. During a signal-loss window the
        // bg-geo plugin stops emitting positions, but if a stale position
        // sneaks through we still don't want to enter LOST on top of the
        // GPS-lost overlay. State.lost from a prior moment is preserved.
        if (typeof GPSSIGNAL_OK !== 'undefined' && !GPSSIGNAL_OK) return;

        if (this.state.stepIndex < 0) return; // not started — rdv page handles distance UX

        let reachable = this.lostReachableSteps();
        if (!reachable.length) return; // last step done or no parcours

        if (this.state.lost) {
            // Recover as soon as the walker is inside ANY reachable step.
            let caughtUp = reachable.find(s => s.inside(position));
            if (caughtUp) {
                this.state.lost = false;
                this.state.lostSince = null;
                this._lostBeyondSince = null;
                this.store();
                this.emit('recover', { target: caughtUp, distance: caughtUp.distanceToBorder(position) });
            }
            return;
        }

        // Not currently LOST — check entry against the NEAREST reachable step.
        let nearest = reachable[0];
        let nearestD = nearest.distanceToBorder(position);
        for (let i = 1; i < reachable.length; i++) {
            let d = reachable[i].distanceToBorder(position);
            if (d < nearestD) { nearestD = d; nearest = reachable[i]; }
        }

        if (nearestD <= LOST_ENTER_M) {
            this._lostBeyondSince = null;
            return;
        }

        // Beyond threshold. Don't accumulate while stationary — same gate as
        // GPS-lost: a pocketed walker isn't actually wandering.
        if (typeof GEO !== 'undefined' && GEO.motionIsStationary) return;

        if (!this._lostBeyondSince) {
            this._lostBeyondSince = Date.now();
            return;
        }
        if (Date.now() - this._lostBeyondSince < LOST_SUSTAIN_MS) return;

        this.state.lost = true;
        this.state.lostSince = Date.now();
        this._lostBeyondSince = null;
        this.store();
        this.emit('lost', { target: nearest, distance: nearestD });
    }

    update(position) {
        if (this.state.geoMode === null) return;

        // Only process positions while the walker is actually on the parcours
        // page. On a kill+relaunch resume, state.geoMode is restored as 'gps'
        // (it is persisted) before the walker has navigated back to parcours —
        // without this gate, steps could fire and play audio under an
        // onboarding page (checkmotion / checkbgloc / ...), and the
        // fire/done/enter/leave handlers (registered inside PAGES['parcours'])
        // wouldn't be attached yet. geoMode stays persisted because checkgeo
        // still reads geomode() for the DEVMODE simulate-resume convenience.
        if (typeof currentPage !== 'undefined' && currentPage !== 'parcours') return;

        // F-Z1 — diagnostic: log when the walker is within 20 m of any
        // reachable step's border. Builds the accuracy distribution near zone
        // transitions that's needed to calibrate E2/E3's sustain gates (M2/P6a
        // zone overshoot) in phase 1B. Throttled to ≥2 m change or 5 s elapsed
        // since the last sample to keep volume around the ~50 events/walk
        // target in §12.6b. No behaviour change.
        try {
            let reachable = this.lostReachableSteps();
            if (reachable && reachable.length) {
                let nearest = null;
                let nearestD = Infinity;
                for (let i = 0; i < reachable.length; i++) {
                    let d = reachable[i].distanceToBorder(position);
                    if (d < nearestD) { nearestD = d; nearest = reachable[i]; }
                }
                if (nearest && nearestD < 20) {
                    let now = Date.now();
                    let last = this._lastNearBorderSample || {t: 0, d: 999};
                    if ((now - last.t) > 5000 || Math.abs(last.d - nearestD) > 2) {
                        this._lastNearBorderSample = {t: now, d: nearestD};
                        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('accuracy_near_border', {
                            step: nearest._index,
                            name: nearest._spot.name,
                            distance: Math.round(nearestD * 100) / 100,
                            accuracy: position && position.coords ? Math.round(position.coords.accuracy) : null,
                            motion_stationary: typeof GEO !== 'undefined' ? !!GEO.motionIsStationary : null,
                            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
                            inside: nearestD < 0,
                        });
                    }
                }
            }
        } catch (e) { /* never break update() on telemetry */ }

        // LOST gate runs first — when active, it suppresses all spot processing
        // (offlimits masked, zones can't re-trigger on re-crossing, steps can't
        // re-fire). Distance tracking for recovery continues via evaluateLostState.
        this.evaluateLostState(position);
        if (this.state.lost) {
            this.telemetryRouteProbe(position, false);
            return;
        }

        let offlimit = false;

        // process offlimits
        if (this.spots['offlimits']) {
            this.spots['offlimits'].map(s => {
                let inside = s.updatePosition(position);
                if (inside) offlimit = true;
            });
        }

        this.telemetryRouteProbe(position, !offlimit);

        if (this.state.globalOfflimit !== offlimit) {
            this.state.globalOfflimit = offlimit;
            if (typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log(offlimit ? 'global_offlimit_enter' : 'global_offlimit_leave', {
                    step: this.state.stepIndex
                });
            }
        }

        // process others, if not offlimit
        if (!offlimit) {
            for (let type in this.spots)
                if (type !== 'offlimits') this.spots[type].map(s => s.updatePosition(position));
        }
        // pause all types (except offlimits) if offlimit
        else {
            let types = Object.keys(this.spots).filter(t => t !== 'offlimits');
            this.pauseAudio(types);
        }
    }

    // Start tracking with GEO
    startTracking() {
        // Idempotent: clear any prior interval/listeners so a parcours-page
        // re-entry doesn't stack duplicate timers and handlers.
        this.stopTracking();
        this.state.geoMode = GEO.mode();
        // 5s periodic snapshot — tight enough that a crash loses at most a few
        // seconds of voice progress.
        this._voicePosInterval = setInterval(() => this.store('interval'), 5000)
        // Cordova app-background (real device).
        this._pauseHandler = () => this.store('pause')
        document.addEventListener('pause', this._pauseHandler)
        // Page-hide / tab-hide — the only signal a desktop browser reload emits.
        // Without this, a reload never triggers a final store() and the resume
        // position is stuck at whatever the last 5s tick captured.
        this._hideHandler = () => { if (document.visibilityState === 'hidden') this.store('visibilitychange'); }
        this._pageHideHandler = () => this.store('pagehide')
        document.addEventListener('visibilitychange', this._hideHandler)
        window.addEventListener('pagehide', this._pageHideHandler)
        this.store('startTracking');
    }

    // Stop tracking with GEO
    stopTracking() {
        this.state.geoMode = null;
        if (this._voicePosInterval) {
            clearInterval(this._voicePosInterval)
            this._voicePosInterval = null
        }
        if (this._pauseHandler) {
            document.removeEventListener('pause', this._pauseHandler)
            this._pauseHandler = null
        }
        if (this._hideHandler) {
            document.removeEventListener('visibilitychange', this._hideHandler)
            this._hideHandler = null
        }
        if (this._pageHideHandler) {
            window.removeEventListener('pagehide', this._pageHideHandler)
            this._pageHideHandler = null
        }
    }

    // Give current geo mode
    geomode() {
        if (this.state.geoMode) return this.state.geoMode;
    }

    pauseAudio(types) {
        // if not array convert to array
        if (!types) {
            for (let type in this.spots) this.spots[type].map(s => { if (s.player) s.player.pause() });
        }
        else {
            if (!Array.isArray(types)) types = [types];
            for (let type of types)
                if (this.spots[type]) this.spots[type].map(s => { if (s.player) s.player.pause() });
        }
    }


    stopAudio(type) {
        if (type) {
            if (this.spots[type]) this.spots[type].map(s => { if (s.player) s.player.stop() });
        }
        else {
            for (let type in this.spots) {
                console.log('Stopping audio for type', type);
                this.spots[type].map(s => {
                    if (s.player) s.player.stop(0)
                });
            }
        }
    }

    loadAudio() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.loadAudio());
        }
    }

    editable() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.editable());
        }
    }
}

// Init parcours
document.PARCOURS = new Parcours();
const PARCOURS = document.PARCOURS;