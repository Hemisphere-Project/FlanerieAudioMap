var CALIBRATION_TIME = 2

function geo_coords(c) {
    if (c.coords) return geo_coords(c.coords)

    // parse coords from string zoom/lat/lon
    if (typeof c == 'string') {
        var [zoom, lat, lon] = c.split('/')
        return [parseFloat(lat), parseFloat(lon)]
    }

    // parse coords from object
    var lat = c.latitude || c.lat || c[0]
    var lng = c.longitude || c.lng || c.lon || c[1]
    if (lat && lng) return [lat, lng]
    else console.error('Invalid coords:', c)
}


function geo_distance(pos1, pos2) {
    pos1 = geo_coords(pos1)
    pos2 = geo_coords(pos2)

    try {
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
    catch (e) {
        console.error('Error calculating distance:', e)
        return 1000000
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

    _callbackPosition(position) 
    {
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

            // polyline track
            if (this.follow && this.polyTrack) {
                if (!this.lastTrackPosition || geo_distance(this.lastTrackPosition, position) > 3) {
                    this.polyTrack.addLatLng([position.coords.latitude, position.coords.longitude]);
                    this.lastTrackPosition = position;
                }
            }

            this.emit('position', position);
        }

        // next measure
        this.lastPosition = position;
    }

    _callbackError(error) {
        this.emit('error', error);
    }

    setPosition(pos) {
        this.fakeUpdate(pos);
    }

    // Fake position (center of the map)
    fakePosition(pos) {
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
        if (pos) {
            pos = geo_coords(pos);
            p.coords.latitude = pos[0];
            p.coords.longitude = pos[1];
        } 
        return p;
    }

    // Fake update event (triggered by map move, simulate GPS new position event)
    fakeUpdate(pos = null) {
        this._callbackPosition(this.fakePosition(pos));
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
        this.map.off('move', ()=>this.fakeUpdate(this.map.getCenter()));

        if (this.runMode == 'gps') 
        {
            this.map.dragging.disable();
        }
        else if (this.runMode == 'simulate') 
        {
            this.map.dragging.enable();
            this.map.on('move', ()=>{
                if (this.follow) this.fakeUpdate(this.map.getCenter());
            });
            setTimeout(()=>this.fakeUpdate(this.map.getCenter()), 300);
        }

        // polyline track
        if (this.polyTrack) this.polyTrack.remove();
        this.polyTrack = L.polyline([], {color: 'blue'}).addTo(this.map);
    }

    mode() {
        return this.runMode;
    }

    // Init geolocation
    init(mode) {
        console.log('Init geoloc: ', mode);

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

    ready() {
        return !this.initializing;
    }

    // Start simulated geoloc
    simulateGeoloc(pos=null) {
        this.init('simulate');
        console.log('>> Mode Simulation basée sur le déplacement de la carte !');
        this.fakeUpdate(pos);
    }

    // passive start: only start if already authorized and enabled
    checkGeoAuth() {
        return new Promise((resolve, reject) => {
            if (typeof BackgroundGeolocation === 'undefined') {
                console.error('BackgroundGeolocation is not defined');
                reject('BackgroundGeolocation is not defined');
                return;
            }
            BackgroundGeolocation.checkStatus(function(status) {
                console.log('[INFO] BackgroundGeolocation auth status: ' + status.authorization);
                if (status.authorization !== BackgroundGeolocation.AUTHORIZED) {
                    reject('gps-no-authorization')
                }
                else if (!status.locationServicesEnabled) {
                    reject('gps-no-location')
                }
                else {
                    GEO.startGeoloc()
                        .then(() => {
                            console.log('GEO startGeoloc OK');
                            resolve();
                        })
                        .catch(error => {
                            console.error('GEO startGeoloc ERROR:', error);
                            reject(error);
                        });
                }
            });
        });
    }

    // Start real geoloc
    startGeoloc() {

        return new Promise((resolve, reject) => {
            this.init('gps');
            
            // test if BackgroundGeolocation is available
            if (typeof BackgroundGeolocation !== 'undefined') {
                CALIBRATION_TIME = 1;
                return backgroundGeoloc(this._callbackPosition.bind(this), this._callbackError.bind(this))
                        .then(() => { resolve(); })
                        .catch(error => { reject(error); });
            }
            
            // use classic navigator geolocation
            else {
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
            }

        });


    }

    position() {
        return this.lastPosition || this.fakePosition();
    }

    distance(pos) {
        return geo_distance(this.position(), pos);
    }

    followMe() {
        if (this.map) {
            this.map.flyTo(geo_coords(this.position()), document.MAP.getZoom())
            this.map.once('moveend', () => {
                this.follow = true;
            });
        }
    }
}

var backgroundGeolocSetup = false;
var backgroundGeolocResolve = null;
var backgroundGeolocReject = null;

if (typeof BackgroundGeolocation !== 'undefined') {
    console.log('[INFO] BackgroundGeolocation is available');
    BackgroundGeolocation.removeAllListeners();
    BackgroundGeolocation.checkStatus(function(status) {
        if (status.isRunning) {
            console.log('[INFO] BackgroundGeolocation service is running, stop it', );
            BackgroundGeolocation.stop();
        }
    });
}

function prepareBackgroundGeoloc(positionCallback, errorCallback) 
{
    if (typeof BackgroundGeolocation === 'undefined') {
        console.error('BackgroundGeolocation is not defined');
        return false;
    }

    if (backgroundGeolocSetup) {
        console.log('[INFO] BackgroundGeolocation is already setup');
        
    }
    else {
        console.log('[INFO] Setting up BackgroundGeolocation');
    
        BackgroundGeolocation.configure({
            locationProvider: BackgroundGeolocation.DISTANCE_FILTER_PROVIDER,
            desiredAccuracy: BackgroundGeolocation.HIGH_ACCURACY,
            stationaryRadius: 0.1,
            distanceFilter: 0,
            notificationTitle: 'Flanerie',
            notificationText: 'localisation en cours',
            debug: false,
            interval: 1000,
            fastestInterval: 1000,
            activitiesInterval: 1000,
            activityType: 'Fitness',
            stopDetection: false,
        });
    }

    BackgroundGeolocation.removeAllListeners();

    BackgroundGeolocation.on('location', function(location) {
        console.log('[INFO] BackgroundGeolocation location: ', JSON.stringify(location));

        // handle your locations here
        // to perform long running operation on iOS
        // you need to create background task
        BackgroundGeolocation.startTask(function(taskKey) {
            var position = {
                simulate: false,
                timestamp: location.time,
                coords: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy: location.accuracy,
                    speed: location.speed,
                }
            }
            positionCallback(position);
            // execute long running task
            // eg. ajax post location
            // IMPORTANT: task has to be ended by endTask
            BackgroundGeolocation.endTask(taskKey);
        });
    });

    BackgroundGeolocation.on('stationary', function(location) {
        // handle stationary locations here
        console.log('[INFO] BackgroundGeolocation stationary location: ', JSON.stringify(location));
        // BackgroundGeolocation.switchMode(BackgroundGeolocation.FOREGROUND_MODE);

        // Restart 
        BackgroundGeolocation.stop()
        
        // BackgroundGeolocation.startTask(function(taskKey) {
        //     var position = {
        //         simulate: false,
        //         timestamp: location.time,
        //         coords: {
        //             latitude: location.latitude,
        //             longitude: location.longitude,
        //             accuracy: location.accuracy,
        //             speed: location.speed,
        //         }
        //     }
        //     positionCallback(position);
        //     // execute long running task
        //     // eg. ajax post location
        //     // IMPORTANT: task has to be ended by endTask
        //     BackgroundGeolocation.endTask(taskKey);
        // });
    });

    BackgroundGeolocation.on('stop', function() {
        console.log('[INFO] BackgroundGeolocation service has been stopped');
        BackgroundGeolocation.start();
    });


    BackgroundGeolocation.on('error', function(error) {
        console.log('[ERROR] BackgroundGeolocation error:', error.code, error.message);
        if (backgroundGeolocReject) {
            backgroundGeolocReject(error);
            backgroundGeolocReject = null;
            backgroundGeolocResolve = null;
        }
        errorCallback(error);
    });

    BackgroundGeolocation.on('start', function() {
        console.log('[INFO] BackgroundGeolocation service has been started');

        BackgroundGeolocation.checkStatus(function(status) {
            if (!status.authorization) {
                alert('Vous devez autoriser l\'application à accéder à votre position !');
                reject('gps-no-authorization')
            }
            else if (backgroundGeolocResolve) {
                console.log('[INFO] BackgroundGeolocation service is running');
                backgroundGeolocResolve();
                backgroundGeolocResolve = null;
                backgroundGeolocReject = null;
            }
        })
    });

    BackgroundGeolocation.on('authorization', function(status) {
        console.log('[INFO] BackgroundGeolocation authorization status: ' + status);
        if (status !== BackgroundGeolocation.AUTHORIZED) {
            // we need to set delay or otherwise alert may not be shown
            setTimeout(function() {
                alert('Flanerie a besoin d\'acceder à votre position. Merci de modifier les permissions de l\'application !');
                return BackgroundGeolocation.showAppSettings();
            }, 1000);
        }            
    });

    BackgroundGeolocation.on('background', function() {
        console.log('[INFO] App is in background');
        // you can also reconfigure service (changes will be applied immediately)
        // BackgroundGeolocation.configure({ debug: true });
    });

    BackgroundGeolocation.on('foreground', function() {
        console.log('[INFO] App is in foreground');
        // BackgroundGeolocation.configure({ debug: false });
    });

    backgroundGeolocSetup = true;
    return true;
}


function backgroundGeoloc(positionCallback, errorCallback) {

    return new Promise((resolve, reject) => {

        // check if variable is defined 
        if (typeof BackgroundGeolocation === 'undefined') {
            console.error('BackgroundGeolocation is not defined');
            reject('BackgroundGeolocation is not defined');
            return;
        }
        if (!BackgroundGeolocation) {
            console.error('BackgroundGeolocation is not available');
            reject('BackgroundGeolocation is not available');
            return;
        }

        backgroundGeolocResolve = resolve;
        backgroundGeolocReject = reject;

        prepareBackgroundGeoloc(positionCallback, errorCallback);
    
        BackgroundGeolocation.checkStatus(function(status) {
            console.log('[INFO] BackgroundGeolocation service is running', status.isRunning);
            console.log('[INFO] BackgroundGeolocation services enabled', status.locationServicesEnabled);
            console.log('[INFO] BackgroundGeolocation auth status: ' + status.authorization);

            if (!status.locationServicesEnabled) {
                alert('Vous devez activer le GPS pour utiliser cette application !');
                if (backgroundGeolocReject) {
                    backgroundGeolocReject('gps-no-location');
                    backgroundGeolocReject = null;
                    backgroundGeolocResolve = null;
                }
            }
            else if (!status.isRunning) {
                console.log('[INFO] Starting BackgroundGeolocation');
                BackgroundGeolocation.start();
            }
            else {
                console.log('[INFO] BackgroundGeolocation already running.. restarting');
                // if (backgroundGeolocResolve) {
                //     backgroundGeolocResolve();
                //     backgroundGeolocResolve = null;
                //     backgroundGeolocReject = null;
                // }
                BackgroundGeolocation.stop();
            }
        });
    
    })
}


// Init geoloc
document.GEO = new GeoLoc();