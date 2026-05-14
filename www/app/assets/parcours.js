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
        this.clear();
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
            lostSince: null
        };
        // Sustain timer is local-only — on relaunch the GPS picture is fresh
        // so we restart the accumulator rather than trusting a stale value.
        this._lostBeyondSince = null;
    }

    snapshotVoicePosition() {
        if (this.state.stepIndex < 0) return
        let step = this.find('steps', this.state.stepIndex)
        if (!step || !step.player || step.player.playstate !== 'play') return
        let pos = step.player.voice.seek ? step.player.voice.seek() : 0
        if (pos > 0) this.state.resumeStepVoicePos = pos
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
    store() {
        if (!this.valid()) {
            console.warn('Cannot store parcours: not valid yet');
            return;
        }
        this.snapshotVoicePosition()
        try { localStorage.setItem('currentparcours', JSON.stringify(this.export(true))); }
        catch (error) { console.error('Error storing parcours:', error); }
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
            this.build(data); 
            console.log('Parcours restored from localStorage !'); 
        } 
        catch (error) { 
            console.warn('Error restoring parcours:', error); 
            this.clear(); 
            this.clearStore();
            return; 
        }
    }

    // clear Store
    clearStore() {
        try { localStorage.removeItem('currentparcours'); } 
        catch (error) { console.error('Error clearing parcours store:', error); }
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
    //     reachable step (see reachableSteps()) for a sustained LOST_SUSTAIN_MS.
    //     Measuring against the nearest reachable step means heading toward a
    //     step past an optional one is not wrongly flagged.
    //   Exit: the walker is back INSIDE any reachable step — they've caught up.
    //     update() then resumes and Step.updatePosition's own branches resume
    //     the active step or fire the step they walked into.
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

        let reachable = this.reachableSteps();
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
        this._voicePosInterval = setInterval(() => this.store(), 5000)
        // Cordova app-background (real device).
        this._pauseHandler = () => this.store()
        document.addEventListener('pause', this._pauseHandler)
        // Page-hide / tab-hide — the only signal a desktop browser reload emits.
        // Without this, a reload never triggers a final store() and the resume
        // position is stuck at whatever the last 5s tick captured.
        this._hideHandler = () => { if (document.visibilityState === 'hidden') this.store(); }
        this._pageHideHandler = () => this.store()
        document.addEventListener('visibilitychange', this._hideHandler)
        window.addEventListener('pagehide', this._pageHideHandler)
        this.store();
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