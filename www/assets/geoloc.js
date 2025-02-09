const CALIBRATION_TIME = 2

function geo_coords(c) {
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


function geo_distance(pos1, pos2) {
    pos1 = geo_coords(pos1)
    pos2 = geo_coords(pos2)

    if ((pos1[0] == pos2[0]) && (pos1[1] == pos2[1])) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * pos1[0] / 180
        var radlat2 = Math.PI * pos2[0] / 180
        var theta = pos1[1] - pos2[1]
        var radtheta = Math.PI * theta / 180
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
        if (dist > 1) dist = 1
        dist = Math.acos(dist)
        dist = dist * 180 / Math.PI
        dist = dist * 60 * 1.1515 * 1.609344 * 1000
        return dist
    }
}

// Shortest distance in meters from a point to a segment,
// where a segment is defined by two points.
// pos is the point, segA and segB are the two points defining the segment.
// All points are in the form [lat, lng].
function geo_distance_to_segment(pos, segA, segB) {
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

class GeoLoc extends EventEmitter {
    constructor() {
        super();
        this.watchId = null;
        this.firstMeasure = null;
        this.initialPosition = null;
        this.lastPosition = null;
        this.initializing = true;

        this.follow = false;
        this.map = null;

        this.runMode = 'off';   // off, gps, simulate
    }

    _callbackPosition(position) {
        // first measure
        if (!this.firstMeasure) {
            this.firstMeasure = position;
            this.initialPosition = position;
        }

        // adjusting initial position during CALIBRATION_TIME if accuracy is better
        if (!position.simulate && this.firstMeasure.timestamp + CALIBRATION_TIME * 1000 > position.timestamp) {
            if (position.coords.accuracy < this.initialPosition.coords.accuracy) this.initialPosition = position;
            console.log('Initialisation en cours..');
        } else {
            // first run
            if (this.initializing) {
                this.initializing = false;
                console.log('Initialisation terminée');
            }

            // MAP follow position
            if (this.follow && !position.simulate && this.map)
                this.map.setView([position.coords.latitude, position.coords.longitude], this.map.getZoom());

            this.emit('position', position);
        }

        // next measure
        this.lastPosition = position;
    }

    _callbackError(error) {
        this.emit('error', error);
    }

    // Fake position (center of the map)
    fakePosition() {
        let p = {
            coords: {
                latitude: 45.76776,
                longitude: 4.91376,
                accuracy: 10,
                speed: 0,
            },
            timestamp: Date.now(),
            simulate: true,
        };
        if (this.map) {
            p.coords.latitude = this.map.getCenter().lat;
            p.coords.longitude = this.map.getCenter().lng;
        } 
        return p;
    }

    // Fake update event (triggered by map move, simulate GPS new position event)
    fakeUpdate() {
        this._callbackPosition(this.fakePosition());
    }

    // Test if geoloc is supported
    testGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) reject('La géolocalisation n\'est pas supportée par votre navigateur');
            navigator.geolocation.getCurrentPosition(
                position => {
                    console.log('GEO TEST OK:', position);
                    resolve(position);
                },
                error => {
                    console.error('GEO TEST ERROR:', error);
                    reject(error);
                }
            );
        });
    }

    // Set map and apply bindings
    setMap(map) {
        this.map = map;

        if (!this.map) return;
        this.map.off('move', ()=>this.fakeUpdate());

        if (this.runMode == 'gps') 
        {
            this.map.dragging.disable();
        }
        else if (this.runMode == 'simulate') 
        {
            this.map.dragging.enable();
            this.map.on('move', ()=>this.fakeUpdate());
            setTimeout(()=>this.fakeUpdate(), 300);
        }
    }

    // Init geolocation
    init(mode) {
        console.log('Init geoloc');

        // unbind all events
        this.removeAllListeners();

        // stop existing geoloc
        if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;

        this.firstMeasure = null;
        this.initialPosition = null;
        this.lastPosition = null;
        this.initializing = true;

        this.runMode = mode;
        this.setMap(this.map);
    }

    // Start simulated geoloc
    simulateGeoloc() {
        this.init('simulate');
        console.log('>> Mode Simulation basée sur le déplacement de la carte !');
    }

    // Start real geoloc
    startGeoloc() {
        return new Promise((resolve, reject) => {
            this.init('gps');
            return this.testGPS().then(() => {
                this.watchId = navigator.geolocation.watchPosition(this._callbackPosition.bind(this), this._callbackError.bind(this), {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0,
                });
                resolve();
            })
            .catch(error => {
                reject(error);
            });
        });
    }

    position() {
        return this.lastPosition || this.fakePosition();
    }

    distance(pos) {
        return geo_distance(this.position(), pos);
    }

    followMe() {
        this.follow = true;
        if (this.map) this.map.flyTo(geo_coords(this.position()), document.MAP.getZoom())
    }
}

// Init geoloc
document.GEO = new GeoLoc();