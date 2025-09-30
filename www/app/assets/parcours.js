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
        
        // Clear info
        this.pID = null;
        this.info = {
            name: '',
            status: '',
            coords: ''
        };

        // Clear state
        this.clearState();
    }

    clearState() {
        this.state = {
            stepIndex: -2,
            geoMode: null,
            medialoaded: false,
            mediaPack: [],
            mediaPackSize: 0,
            mediaPackLoaded: 0
        };
    }

    currentStep(s = null) {
        if (s !== null) {
            this.state.stepIndex = s;
            this.store();
        }
        return this.state.stepIndex;
    }

    find(type, index) {
        return this.spots[type].find(s => s._index === index);
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

    setCoords() {
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
                            console.warn('Error loading media', error);
                            throw error;
                        });
                }, Promise.resolve());

                downloadSequence
                    .then(() => {
                        if (!dryrun) this.state.medialoaded = true;
                        this.store();
                        resolve();
                    })
                    .catch(error => {
                        this.store();
                        reject(error);
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
            s.on('fire', () => this.emit('fire', s));
            s.on('done', () => this.emit('done', s));
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
        try { localStorage.setItem('currentparcours', JSON.stringify(this.export(true))); } 
        catch (error) { console.error('Error storing parcours:', error); }
    }

    // Restore parcours from localStorage
    restore() {
        let stored = localStorage.getItem('currentparcours');
        try { 
            console.log('Restoring parcours from localStorage:', JSON.parse(stored));
            this.build(JSON.parse(stored)); 
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

    update(position) {

        let offlimit = false;

        // process offlimits
        if (this.spots['offlimits']) {
            this.spots['offlimits'].map(s => { 
                let inside = s.updatePosition(position);
                if (inside) offlimit = true;
            });
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
        this.state.geoMode = GEO.mode();
        GEO.on('position', (position) => {
            this.update(position)
        })
        this.store();
    }

    // Give current geo mode
    geomode() {
        if (this.state.geoMode) return this.state.geoMode;
    }

    pauseAudio(types) {
        // if not array convert to array
        if (!types) {
            for (let type in this.spots) this.spots[type].map(s => s.player.pause());
        }
        else {
            if (!Array.isArray(types)) types = [types];
            for (let type of types)
                this.spots[type].map(s => s.player.pause());
        }
    }


    stopAudio(type) {
        if (type) {
            if (this.spots[type]) this.spots[type].map(s => s.player.stop());
        }
        else {
            for (let type in this.spots) {
                console.log('Stopping audio for type', type);
                this.spots[type].map(s => {
                    s.player.stop(0)
                    // if (s.player.isPlaying()) 
                    //     console.warn('IS PLAYING:', s.name(), s.player._media);
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