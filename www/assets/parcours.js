//
// PARCOURS 
//

var PARCOURS = 
{
    // data
    info: {
        name: '',
        status: '',
        coords: ''
    },
    spots: {},

    // internal
    coords: null,
    map: null,
    pID: null,

    add: function(spot) {
        if (!this.spots[spot._type]) this.spots[spot._type] = []
        this.spots[spot._type].push(spot)
    },

    remove: function(spot) {
        this.spots[spot._type] = this.spots[spot._type].filter(s => s !== spot)
    },

    clear: function() {
        
    },

    find: function(type, index) {
        return this.spots[type].find(s => s._index === index)
    },

    select: function(type, index, exclusive = true) {
        let spot = this.find(type, index)
        if (spot) spot.select(exclusive)
    },

    unselectAll: function(exception = null) {
        for (let type in this.spots) {
            this.spots[type].map(s => {
                if (s !== exception) s.unselect()
            })
        }
    },

    valid: function () {
        return this.pID !== null
    },

    setMap: function(map) {
        this.map = map
        // set for each spot
        for (let type in this.spots) {
            this.spots[type].map(s => s.setMap(map))
        }
        if (this.coords) this.map.setView(geo_coords(this.coords), this.map.getZoom())
    },

    load: function(parcoursID) {

        // promise
        return new Promise((resolve, reject) => {

            if (!parcoursID) parcoursID = this.pID
            else this.pID = parcoursID

            if(!parcoursID) {
                reject('No parcours ID')
                return
            }

            // request parcours json
            get('/edit/' + parcoursID + '/json')
                .then(data => {
                    if (!data || !('info' in data)) throw new Error('No data')
                    
                    // clear 
                    for (let type in this.spots) {
                        this.spots[type].map(s => s.clear())
                        this.spots[type] = []
                    }

                    // coords
                    const [zoom, lat, lng] = data.info.coords.split('/')
                    this.coords = {lat: lat, lng: lng}

                    // first load: center map
                    if (this.map && data.info.coords && !this.info.coords) {
                        this.map.setView(geo_coords(this.coords), zoom)  
                    }

                    // load
                    this.info = data.info
                    for (let type in data.spots)
                        data.spots[type].forEach((spot, i) => this.addSpot(type, spot))
                    
                    resolve()
                })
                .catch(error => {
                    this.pID = null
                    reject(error)
                })
        })
    },

    addSpot: function(type, spot) {
        let index = 0
        if (this.spots[type]) index = this.spots[type].length
        if (type === 'zones') new Zone(spot, this.map, index)
        if (type === 'steps') new Step(spot, this.map, index)
        return this
    },

    deleteSpot: function(type, index) {
        this.spots[type].splice(index, 1)[0].clear()
        return this
    },

    // swap two indexes
    moveSpot: function(type, source, target) {
        if (source < 0 || source >= this.spots[type].length) return this
        if (target < 0 || target >= this.spots[type].length) return this
        
        let temp = this.spots[type][source]
        this.spots[type][source] = this.spots[type][target]
        this.spots[type][target] = temp

        // update index
        this.spots[type].map((s, i) => s.index(i))
        return this
    },

    hideSpotMarkers: function() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.hideMarker())
        }
        return this
    },

    showSpotMarker: function(type, index, center = false) {
        // remove all other markers
        this.hideSpotMarkers()
        if (this.spots[type][index]) {
            this.spots[type][index].showMarker()
            if (center) this.spots[type][index].center()
        }
        return this
    },

    export: function() {
        var data = {
            info: this.info,
            spots: {}
        }
        for (let type in this.spots)
            data.spots[type] = this.spots[type].map(s => s._spot)
        return data
    },

    save: function() {
        return new Promise((resolve, reject) => {
            post('/edit/' + this.pID + '/json', this.export())
                .then(data => {
                    if (data) resolve(data)
                    else {
                        console.error(data)
                        reject('Error saving parcours')
                    }
                })
                .catch(error => {
                    reject(error)
                })
        })
    },

    update: function(position) {
        for (let type in this.spots) {
            this.spots[type].map(s => s.updatePosition(position))
        }
    },

    stopAudio: function() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.player.stop())
        }
    },

    loadAudio: function() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.loadAudio())
        }
    },

    editable: function() {
        for (let type in this.spots) {
            this.spots[type].map(s => s.editable())
        }
    }
}