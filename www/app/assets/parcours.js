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
        return this.pID !== null;
    }

    setMap(map) {
        this.map = map;
        for (let type in this.spots) {
            this.spots[type].map(s => s.setMap(map));
        }
        if (this.coords) this.map.setView(geo_coords(this.coords), this.map.getZoom());
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

                    const [zoom, lat, lng] = data.info.coords.split('/');
                    this.coords = { lat: lat, lng: lng };

                    if (this.map && data.info.coords && !this.info.coords) {
                        this.map.setView(geo_coords(this.coords), zoom);
                    }

                    this.info = data.info;
                    for (let type in data.spots)
                        data.spots[type].forEach((spot, i) => this.addSpot(type, spot));

                    resolve();
                })
                .catch(error => {
                    this.pID = null;
                    reject(error);
                });
        });
    }

    addSpot(type, spot) {
        let index = 0;
        var s = null;
        if (this.spots[type]) index = this.spots[type].length;
        if (type === 'zones') s = new Zone(spot, this.map, index, this.pID);
        if (type === 'steps') s = new Step(spot, this.map, index, this.pID);
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
        for (let type in this.spots) {
            this.spots[type].map(s => s.updatePosition(position));
        }
    }

    stopAudio() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.player.stop());
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