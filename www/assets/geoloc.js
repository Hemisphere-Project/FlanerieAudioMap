const CALIBRATION_TIME = 2

function geo_coords(c)
{
    if (c.coords) return geo_coords(c.coords)
        
    // parse coords from string zoom/lat/lon
    if (typeof c == 'string') {
        var [zoom, lat, lon] = c.split('/')
        return [parseFloat(lat), parseFloat(lon)]
    }

    // parse coords from object
    var lat = c.latitude || c.lat
    var lng = c.longitude || c.lng || c.lon
    if (lat && lng) return [lat, lng]
}


function geo_distance(pos1, pos2) 
{   
    pos1 = geo_coords(pos1)
    pos2 = geo_coords(pos2)

    if ((pos1[0] == pos2[0]) && (pos1[1] == pos2[1])) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * pos1[0]/180
        var radlat2 = Math.PI * pos2[0]/180
        var theta = pos1[1]-pos2[1]
        var radtheta = Math.PI * theta/180
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
        if (dist > 1) dist = 1
        dist = Math.acos(dist)
        dist = dist * 180/Math.PI
        dist = dist * 60 * 1.1515 * 1.609344 * 1000
        return dist
    }
}

// Shortest distance in meters from a point to a segment,
// where a segment is defined by two points.
// pos is the point, segA and segB are the two points defining the segment.
// All points are in the form [lat, lng].
function geo_distance_to_segment(pos, segA, segB) 
{
    // convert coords to array
    if (pos.coords) pos = [pos.coords.latitude, pos.coords.longitude]
    if (pos.lat) pos = [pos.lat, pos.lng]
    if (segA.coords) segA = [segA.coords.latitude, segA.coords.longitude]
    if (segA.lat) segA = [segA.lat, segA.lng]
    if (segB.coords) segB = [segB.coords.latitude, segB.coords.longitude]
    if (segB.lat) segB = [segB.lat, segB.lng]

    var a = pos[0] - segA[0]
    var b = pos[1] - segA[1]
    var c = segB[0] - segA[0]
    var d = segB[1] - segA[1]

    var dot = a * c + b * d
    var len_sq = c * c + d * d
    var param = -1
    if (len_sq != 0) // in case of 0 length line
        param = dot / len_sq

    var xx, yy

    if (param < 0) {
        xx = segA[0]
        yy = segA[1]
    }
    else if (param > 1) {
        xx = segB[0]
        yy = segB[1]
    }
    else {
        xx = segA[0] + param * c
        yy = segA[1] + param * d
    }

    return geo_distance(pos, [xx, yy])
}


// Init geoloc
// 
var GEO = {
    watchId: null,
    firstMeasure: null,
    initialPosition: null,
    lastPosition: null,
    initializing : true,
    map: null,

    _updateCallback: null,
    _errorCallback: null,

    _callbackPosition: (position) => {
        // first measure
        if (!this.firstMeasure) {
            this.firstMeasure = position
            this.initialPosition = position
        }

        // adjusting initial position during CALIBRATION_TIME if accuracy is better
        if (!position.simulate && this.firstMeasure.timestamp + CALIBRATION_TIME*1000 > position.timestamp) 
        {
            if (position.coords.accuracy < this.initialPosition.coords.accuracy) this.initialPosition = position
            console.log('Initialisation en cours..')
        }
        // getting distance
        else {
            // first run
            if (this.initializing) {
                this.initializing = false
                console.log('Initialisation terminée')
            }
            
            // MAP follow position
            if (!position.simulate)
                MAP.setView([position.coords.latitude, position.coords.longitude], MAP.getZoom())
            
            // CALLBACK
            if (this._updateCallback) this._updateCallback(position)
        }
    
        // next measure
        this.lastPosition = position

    },

    _callbackError: (error) => {
        if (this._errorCallback) this._errorCallback(error)
    },

    // Init geolocation
    init: function(map) {
        console.log('Init geoloc')
        if (map) this.map = map

        // remove already exisitn MAP move event
        if (this.map) this.map.off('move')

        // stop existing geoloc
        if (this.watchId) navigator.geolocation.clearWatch(this.watchId)
        this.watchId = null

        this.firstMeasure = null
        this.initialPosition = null
        this.lastPosition = null
        this.initializing = true
    },

    // Start simulated geoloc
    simulateGeoloc: function(map, updateCallback)
    {
        this.init(map)

        // Enable MAP draggable
        if (this.map) this.map.dragging.enable()

        if (updateCallback) this._updateCallback = updateCallback

        // call updatePosition with map center on map move
        if (this.map)
            this.map.on('move', () => {
                this._updateCallback({
                    coords: {
                        latitude: MAP.getCenter().lat,
                        longitude: MAP.getCenter().lng,
                        accuracy: 10,
                        speed: 0,
                    },
                    timestamp: Date.now(),
                    simulate: true,
                })
            })

        // trigger first move
        if (this.map) this.map.fire('move')

        console.log('>> Mode Simulation basée sur le déplacement de la carte !')
    },

    // Start real geoloc
    startGeoloc: function(map, updateCallback, errorCallback) 
    {   
        this.init(map)

        // Disable MAP draggable
        if (this.map) this.map.dragging.disable()

        if (updateCallback) this._updateCallback = updateCallback
        if (errorCallback) this._errorCallback = errorCallback

        if (navigator.geolocation) 
        {   
            if (!this.watchId) this.watchId = navigator.geolocation.watchPosition(this._updateCallback, this._errorCallback, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            })
        }
        else console.error('La géolocalisation n\'est pas supportée par votre navigateur')
    }
}