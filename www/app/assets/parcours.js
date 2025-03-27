class Parcours extends EventEmitter {
    constructor() {
        super()
        this.info = {
            name: '',
            status: '',
            coords: ''
        };
        this.spots = {};
        this.coords = null;
        this.map = null;
        this.pID = null;
        this.medialoaded = false;
        this.mediaPackSize = 0;
        this.mediaPackLoaded = 0;
    }

    add(spot) {
        if (!this.spots[spot._type]) this.spots[spot._type] = [];
        this.spots[spot._type].push(spot);
    }

    remove(spot) {
        this.spots[spot._type] = this.spots[spot._type].filter(s => s !== spot);
    }

    clear() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.clear());
            this.spots[type] = [];
        }
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
        return this.pID !== null && this.medialoaded === true;
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

    load(parcoursID) {
        return new Promise((resolve, reject) => {
            if (!parcoursID) parcoursID = this.pID;
            else this.pID = parcoursID;

            if (!parcoursID) {
                reject('No parcours ID');
                return;
            }

            get('/edit/' + parcoursID + '/json')
                .then(data => {
                    if (!data || !('info' in data)) throw new Error('No data');

                    this.clear();
                    
                    if (!data.info.coords) data.info.coords = "13/45.76537/4.88377";
                    const [zoom, lat, lng] = data.info.coords.split('/');
                    this.coords = { lat: lat, lng: lng };

                    if (this.map && data.info.coords && !this.info.coords) {
                        this.map.setView(geo_coords(this.coords), zoom);
                    }

                    this.info = data.info;
                    for (let type in data.spots)
                        data.spots[type].forEach((spot, i) => this.addSpot(type, spot));

                    // DOWNLOAD MEDIA
                    this.loadmedia()
                        .then(() => {
                            console.log('Parcours loaded', data);
                            this.medialoaded = true;
                            resolve();
                        })
                        .catch(error => {
                            console.warn('Error loading media', error);
                            this.medialoaded = false;
                            reject(error);
                        });
                })
                .catch(error => {
                    this.pID = null;
                    reject(error);
                });
        });
    }
    
    loadmedia() {
        return new Promise((resolve, reject) => {
            if (!this.pID) {
                reject('No parcours ID');
                return;
            }
            if (!document.WEBAPP_URL) {
                console.log('WEB MODE: Media loading skipped');
                resolve();
                return;
            }
            
            // Get media list
            get('/update/media/' + this.pID)
            .then(data => {
                console.log('MEDIA', data);

                const mediaFiles = Object.keys(data);

                // mediaPackSize sum of all media files size
                this.mediaPackSize = mediaFiles.reduce((sum, file) => sum + data[file].size, 0);
                this.mediaPackLoaded = 0;

                const downloadSequence = mediaFiles.reduce((promiseChain, file) => {
                    let info = data[file];
                    let path = this.pID + '/' + file;
                    return promiseChain.then(() => media_download(path, info))
                        .then(() => {
                            console.log('Media loaded', path);
                            this.mediaPackLoaded += info.size;
                        })
                        .catch(error => {
                            console.warn('Error loading media', error);
                            throw error;
                        });
                }, Promise.resolve());

                downloadSequence
                    .then(() => {
                        resolve();
                    })
                    .catch(error => {
                        reject(error);
                    });
            })
            .catch(error => {
                reject(error);
            });
        });
    }

    loadprogress() {
        if (this.mediaPackSize === 0) return 0;
        return Math.round(this.mediaPackLoaded / this.mediaPackSize * 100);
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

    showSpotMarker(type, index, center = false, quick = true) {
        this.hideSpotMarkers();
        if (this.spots[type][index]) {
            this.spots[type][index].showMarker();
            if (center) this.spots[type][index].center(quick);
        }
        return this;
    }

    export() {
        var data = {
            info: this.info,
            spots: {}
        };
        for (let type in this.spots)
            data.spots[type] = this.spots[type].map(s => s._spot);
        return data;
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
            for (let type in this.spots) this.spots[type].map(s => s.player.stop());
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