var CALIBRATION_TIME = 2
var APP_VISIBILITY = 'foreground' // foreground, background
var LAST_AUDIO_CONTEXT_STATE = null
var AUDIO_CONTEXT_STATE_BOUND = false
var GPS_CALLBACK_GAP_THRESHOLD = 8000
var GPS_SLEEP_SUSPECT_THRESHOLD = 15000
var ACTIVE_GEO_BACKGROUND_TASK = null
var IOS_GEO_BACKGROUND_TASK_TIMEOUT = 8000

function gpsAccuracyBucket(acc) {
    if (typeof acc !== 'number' || isNaN(acc)) return 'unknown'
    if (acc <= 10) return 'excellent'
    if (acc <= 20) return 'good'
    if (acc <= 40) return 'fair'
    if (acc <= 80) return 'poor'
    return 'bad'
}

function _geoTaskTelemetry(type, data) {
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log(type, data)
}

function _finishGeoBackgroundTask(task, status, extra) {
    if (!task || task.ended) return

    task.ended = true
    if (task.timeoutId) {
        clearTimeout(task.timeoutId)
        task.timeoutId = null
    }

    let payload = Object.assign({
        taskKey: task.taskKey,
        reason: task.reason,
        retained: task.retained,
        duration_ms: Date.now() - task.startedAt,
    }, task.meta || {}, extra || {})

    _geoTaskTelemetry('ios_bg_task_end', Object.assign({ status: status }, payload))

    try {
        if (typeof BackgroundGeolocation !== 'undefined' && BackgroundGeolocation && typeof BackgroundGeolocation.endTask === 'function') {
            BackgroundGeolocation.endTask(task.taskKey)
        }
    }
    catch (e) {
        console.warn('[BG-TASK] endTask failed', e)
    }
}

function runWithGeoBackgroundTask(taskKey, reason, meta, work) {
    if (PLATFORM !== 'ios') {
        work(null)
        return
    }

    let task = {
        taskKey: taskKey,
        reason: reason,
        startedAt: Date.now(),
        retained: false,
        ended: false,
        timeoutId: null,
        meta: Object.assign({ visibility: APP_VISIBILITY }, meta || {})
    }

    ACTIVE_GEO_BACKGROUND_TASK = task
    _geoTaskTelemetry('ios_bg_task_begin', {
        taskKey: task.taskKey,
        reason: task.reason,
        visibility: task.meta.visibility,
        acc: task.meta.acc,
    })

    try {
        work(task)
    }
    finally {
        ACTIVE_GEO_BACKGROUND_TASK = null
        if (!task.retained) {
            _finishGeoBackgroundTask(task, 'sync-complete')
        }
        else {
            _geoTaskTelemetry('ios_bg_task_deferred', {
                taskKey: task.taskKey,
                reason: task.reason,
                visibility: task.meta.visibility,
            })
        }
    }
}

function claimBackgroundGeoTask(meta) {
    if (PLATFORM !== 'ios' || !ACTIVE_GEO_BACKGROUND_TASK) return null

    let task = ACTIVE_GEO_BACKGROUND_TASK
    task.retained = true
    task.meta = Object.assign({}, task.meta || {}, meta || {})

    if (!task.timeoutId) {
        task.timeoutId = setTimeout(() => {
            _finishGeoBackgroundTask(task, 'timeout', { visibility: APP_VISIBILITY })
        }, IOS_GEO_BACKGROUND_TASK_TIMEOUT)
    }

    _geoTaskTelemetry('ios_bg_task_claim', {
        taskKey: task.taskKey,
        reason: task.reason,
        visibility: task.meta.visibility,
        src: task.meta.src,
        loaded_before_play: task.meta.loaded_before_play,
    })

    return task
}

function resolveBackgroundGeoTask(task, status, meta) {
    _finishGeoBackgroundTask(task, status, meta)
}

function logAudioContextState(reason = 'unknown', force = false) {
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    let state = Howler.ctx.state
    if (!force && LAST_AUDIO_CONTEXT_STATE === state) return

    LAST_AUDIO_CONTEXT_STATE = state
    console.log('[AUDIO] AudioContext state:', reason, state)
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_context_state', {reason: reason, state: state})
}

function bindAudioContextState() {
    if (AUDIO_CONTEXT_STATE_BOUND) return
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    let previousHandler = Howler.ctx.onstatechange
    Howler.ctx.onstatechange = function(event) {
        if (typeof previousHandler === 'function') previousHandler.call(this, event)
        logAudioContextState('statechange', true)
    }

    AUDIO_CONTEXT_STATE_BOUND = true
    logAudioContextState('bind', true)
}

function resumeAudioContext(reason = 'unknown') {
    if (typeof Howler === 'undefined' || !Howler.ctx) return

    bindAudioContextState()
    logAudioContextState(reason)
    if (Howler.ctx.state === 'running') return

    console.log('[AUDIO] Resuming AudioContext:', reason, Howler.ctx.state)
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_context_resume', {reason: reason, state: Howler.ctx.state})

    try {
        let result = Howler.ctx.resume()
        if (result && typeof result.then === 'function') {
            result.then(() => logAudioContextState(reason + ':resolved', true))
        }
        if (result && typeof result.catch === 'function') {
            result.catch(error => console.warn('[AUDIO] Failed to resume AudioContext:', reason, error))
        }
        else {
            logAudioContextState(reason + ':sync', true)
        }
    }
    catch (error) {
        console.warn('[AUDIO] Failed to resume AudioContext:', reason, error)
    }
}

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
        this.lastTimeUpdate = null;

        this.follow = false;
        this.map = null;

        this.runMode = 'off';   // off, gps, simulate

        this.stateUpdate = 'off'; // off, ok, lost
        this.stateUpdateTimeout = 10000; // 10 seconds
        this.lastAccuracyBucket = null;

        this.stateUpdateTimer = setInterval(() => {
            let nextStep = this.stateUpdate;
            if (this.lastTimeUpdate == null) nextStep = 'off';
            else if ( (this.lastTimeUpdate + this.stateUpdateTimeout) < Date.now()) nextStep = 'lost';
            else nextStep = 'ok';

            if (this.stateUpdate != nextStep) {
                this.stateUpdate = nextStep;
                this.emit('stateUpdate', nextStep);
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_state', {state: nextStep});
            }

            // Proactive heartbeat: approaching timeout but not yet lost.
            // On iOS, stationary periods suppress CLLocation delegate callbacks but
            // CLLocationManager.location (cached) remains valid. Refreshing lastTimeUpdate
            // from cache before the timeout fires prevents false GPS-lost declarations.
            if (this.stateUpdate === 'ok' &&
                this.lastTimeUpdate !== null &&
                (Date.now() - this.lastTimeUpdate) > this.stateUpdateTimeout * 0.6 &&
                this.runMode === 'gps' &&
                typeof BackgroundGeolocation !== 'undefined') {
                this._heartbeat();
            }

            // Reactive heartbeat: already lost — try to recover
            if (this.stateUpdate === 'lost' && this.runMode === 'gps' && typeof BackgroundGeolocation !== 'undefined') {
                this._heartbeat();
            }
        }, 1000);

        this._heartbeatInProgress = false;
        this._lastHeartbeatTime = 0;
    }

    // Active GPS recovery: when updates have stopped, try getCurrentLocation
    // to nudge the OS into resuming GPS and feed a position back into the pipeline
    _heartbeat() {
        if (this._heartbeatInProgress) return;
        // Throttle: must be larger than the getCurrentLocation timeout to avoid back-to-back requests
        if (Date.now() - this._lastHeartbeatTime < 15000) return;
        this._heartbeatInProgress = true;
        this._lastHeartbeatTime = Date.now();

        console.log('[HEARTBEAT] GPS lost — requesting current location');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_heartbeat', {visibility: APP_VISIBILITY});

        BackgroundGeolocation.getCurrentLocation(
            (location) => {
                console.log('[HEARTBEAT] Got location:', location.latitude, location.longitude, 'acc:', location.accuracy);
                var position = {
                    simulate: false,
                    timestamp: location.time,
                    coords: {
                        latitude: location.latitude,
                        longitude: location.longitude,
                        accuracy: location.accuracy,
                        speed: location.speed,
                    }
                };
                if (typeof TELEMETRY !== 'undefined') {
                    TELEMETRY.log('gps_heartbeat_ok', {
                        visibility: APP_VISIBILITY,
                        acc: Math.round(location.accuracy),
                        ageMs: typeof location.time === 'number' ? Math.max(0, Date.now() - location.time) : null
                    });
                }
                this._callbackPosition(position, {source: 'heartbeat', visibility: APP_VISIBILITY});
                this._heartbeatInProgress = false;
            },
            (error) => {
                console.warn('[HEARTBEAT] getCurrentLocation failed:', error);
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_heartbeat_fail', {code: error.code, message: error.message});
                this._heartbeatInProgress = false;
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    _callbackPosition(position, telemetryMeta = {}) 
    {
        resumeAudioContext('position')

        let now = Date.now()
        let callbackGapMs = this.lastTimeUpdate == null ? null : now - this.lastTimeUpdate
        let positionAgeMs = typeof position.timestamp === 'number' ? Math.max(0, now - position.timestamp) : null
        let accuracy = position && position.coords ? Math.round(position.coords.accuracy) : null
        let visibility = telemetryMeta.visibility || APP_VISIBILITY
        let source = telemetryMeta.source || (position.simulate ? 'simulate' : 'unknown')
        let motionStationary = !!this.motionIsStationary
        let accuracyBucket = gpsAccuracyBucket(accuracy)

        telemetryMeta.source = source
        telemetryMeta.visibility = visibility
        telemetryMeta.motionStationary = motionStationary
        if (callbackGapMs !== null) telemetryMeta.callbackGapMs = callbackGapMs
        if (positionAgeMs !== null) telemetryMeta.ageMs = positionAgeMs

        if (callbackGapMs !== null && callbackGapMs >= GPS_CALLBACK_GAP_THRESHOLD && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_callback_gap', {
                gapMs: Math.round(callbackGapMs),
                source: source,
                visibility: visibility,
                acc: accuracy,
                ageMs: positionAgeMs,
                motionStationary: motionStationary
            })
        }

        if (callbackGapMs !== null && visibility === 'background' && callbackGapMs >= GPS_SLEEP_SUSPECT_THRESHOLD && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_sleep_suspect', {
                gapMs: Math.round(callbackGapMs),
                source: source,
                acc: accuracy,
                ageMs: positionAgeMs,
                motionStationary: motionStationary
            })
        }

        if (positionAgeMs !== null && positionAgeMs >= 10000 && typeof TELEMETRY !== 'undefined') {
            TELEMETRY.log('gps_stale_callback', {
                ageMs: Math.round(positionAgeMs),
                source: source,
                visibility: visibility,
                acc: accuracy
            })
        }

        if (accuracyBucket !== this.lastAccuracyBucket) {
            if (this.lastAccuracyBucket !== null && typeof TELEMETRY !== 'undefined') {
                TELEMETRY.log('gps_accuracy_bucket', {
                    from: this.lastAccuracyBucket,
                    to: accuracyBucket,
                    acc: accuracy,
                    source: source,
                    visibility: visibility,
                    gapMs: callbackGapMs
                })
            }
            this.lastAccuracyBucket = accuracyBucket
        }

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

            // Accuracy gate: reject inaccurate fixes for step triggering
            if (!position.simulate && position.coords.accuracy > 30) {
                console.warn('GPS accuracy too low (' + Math.round(position.coords.accuracy) + 'm), position ignored for triggers');
                telemetryMeta.rejected = true
                telemetryMeta.reason = 'accuracy'
                if (typeof TELEMETRY !== 'undefined') {
                    TELEMETRY.log('gps_trigger_rejected', {
                        reason: 'accuracy',
                        acc: Math.round(position.coords.accuracy),
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        source: source,
                        visibility: visibility,
                        gapMs: callbackGapMs,
                        ageMs: positionAgeMs,
                        motionStationary: motionStationary
                    });
                }
                // Still update lastPosition/lastTimeUpdate so GPS-lost detection doesn't fire
            } else {
                this.emit('position', position);
            }
        }

        // next measure
        this.lastPosition = position;
        this.lastTimeUpdate = Date.now();
        // Immediately reflect 'ok' without waiting for the next timer tick
        if (this.stateUpdate !== 'ok') {
            this.stateUpdate = 'ok';
            this.emit('stateUpdate', 'ok');
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('gps_state', {state: 'ok'});
        }
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.gps(position, telemetryMeta);
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
        this._callbackPosition(this.fakePosition(pos), {source: 'simulate', visibility: APP_VISIBILITY});
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
        this.lastAccuracyBucket = null;

        this.runMode = mode;
        this.setMap(this.map);
    }

    ready() {
        this.checkPosition()
        return !this.initializing;
    }

    alive(timeout=5000) {
        if (!this.lastTimeUpdate) return false;
        return (Date.now() - this.lastTimeUpdate) < timeout;
    }

    // Start simulated geoloc
    simulateGeoloc(pos=null) {
        this.init('simulate');
        console.log('>> Mode Simulation basée sur le déplacement de la carte !');
        this.fakeUpdate(pos);
    }

    // showSystemSettings()
    showLocationSettings() {
        if (typeof BackgroundGeolocation === 'undefined') {
            console.warn('BackgroundGeolocation is not defined');
            return;
        }
        if (cordova.platformId == 'android') {
            BackgroundGeolocation.showLocationSettings();
        }
        else if (cordova.platformId == 'ios') {
            alert('Réglages > Confidentialité > Services de localisation > Activez!');
            // BackgroundGeolocation.showAppSettings();
        }
    }

    // showAppSettings()
    showAppSettings() {
        if (typeof BackgroundGeolocation === 'undefined') {
            console.warn('BackgroundGeolocation is not defined');
            return;
        }
        BackgroundGeolocation.showAppSettings();
    }

    // Check if geoloc is enabled
    checkEnabled() {
        return new Promise((resolve, reject) => {
            if (typeof BackgroundGeolocation === 'undefined') {
                console.warn('BackgroundGeolocation is not defined');
                resolve('BackgroundGeolocation is not defined');
                return;
            }
            BackgroundGeolocation.checkStatus(function(status) {
                if (status.locationServicesEnabled) resolve();
                else reject('gps-no-location');
            });
        });
    }

    // Check auth
    checkAuthorized() {
        return new Promise((resolve, reject) => {
            if (typeof BackgroundGeolocation === 'undefined') {
                console.warn('BackgroundGeolocation is not defined');
                resolve();
                return;
            }
            BackgroundGeolocation.checkStatus(function(status) {
                if (status.authorization == BackgroundGeolocation.AUTHORIZED) {
                    console.log('[INFO] BackgroundGeolocation auth is OK: ' + status.authorization);
                    return resolve()
                }

                if (status.authorization == BackgroundGeolocation.AUTHORIZED_FOREGROUND) {
                    console.warn('[WARNING] BackgroundGeolocation auth is partial: ' + status.authorization);
                    return reject('gps-error-authorization')
                }
                
                console.error('[ERROR] BackgroundGeolocation wrong auth status: ' + status.authorization);
                return reject('gps-no-authorization')
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
                console.warn('BackgroundGeolocation is not available, TESTING classic navigator geolocation');
                return this.testGPS().then(() => {
                    console.log('classic GEO TEST OK, starting navigator geolocation');
                    this.watchId = navigator.geolocation.watchPosition(
                        position => this._callbackPosition(position, {source: 'navigator', visibility: APP_VISIBILITY}),
                        this._callbackError.bind(this),
                        {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0,
                        }
                    );
                    resolve();
                })
                .catch(error => {
                    reject(error);
                });
            }

        });

   }

    checkPosition() {
        return checkBGPosition()
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
var backgroundGeolocIntentionalStop = false;

if (typeof BackgroundGeolocation !== 'undefined') {
    console.log('[INFO] BackgroundGeolocation is available');
    BackgroundGeolocation.removeAllListeners();
    BackgroundGeolocation.checkStatus(function(status) {
        if (status.isRunning) {
            console.log('[INFO] BackgroundGeolocation service is running, stop it');
            backgroundGeolocIntentionalStop = true;
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
            locationProvider: BackgroundGeolocation.RAW_PROVIDER,
            desiredAccuracy: BackgroundGeolocation.HIGH_ACCURACY,
            stationaryRadius: 0.01,
            distanceFilter: 0,
            pauseLocationUpdates: false,
            saveBatteryOnBackground: false,
            stopOnTerminate: false,
            startForeground: true,
            notificationTitle: 'Flanerie',
            notificationText: 'localisation en cours',
            debug: false,
            interval: 1000,
            fastestInterval: 1000,
            activitiesInterval: 1000,
            activityType: 'OtherNavigation',
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
            runWithGeoBackgroundTask(taskKey, 'location', {
                acc: location.accuracy,
                lat: location.latitude,
                lng: location.longitude,
            }, function() {
                positionCallback(position, {source: 'bg_location', visibility: APP_VISIBILITY});
            });
        });
    });

    BackgroundGeolocation.on('stationary', function(location) {
        // Stationary is informational — the plugin keeps running with RAW_PROVIDER + stopDetection:false.
        // We emit the position so GPS-lost detection stays satisfied, without stop/start churn.
        console.log('[INFO] BackgroundGeolocation stationary location: ', JSON.stringify(location));
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_stationary', {lat: location.latitude, lng: location.longitude, acc: location.accuracy});

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
            runWithGeoBackgroundTask(taskKey, 'stationary', {
                acc: location.accuracy,
                lat: location.latitude,
                lng: location.longitude,
            }, function() {
                positionCallback(position, {source: 'bg_stationary', visibility: APP_VISIBILITY});
            });
        });
    });

    BackgroundGeolocation.on('stop', function() {
        console.log('[INFO] BackgroundGeolocation service has been stopped');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_stop', {intentional: backgroundGeolocIntentionalStop});

        // Only restart if the stop was not intentional (e.g. OS killed the service)
        if (!backgroundGeolocIntentionalStop) {
            console.log('[INFO] Unexpected stop — restarting BackgroundGeolocation');
            BackgroundGeolocation.start();
        }
        backgroundGeolocIntentionalStop = false;
    });


    BackgroundGeolocation.on('error', function(error) {
        console.log('[ERROR] BackgroundGeolocation error:', error.code, error.message);
        if (backgroundGeolocReject) {
            backgroundGeolocReject(error);
            backgroundGeolocReject = null;
            backgroundGeolocResolve = null;
        } else {
            errorCallback(error);
        }
    });

    BackgroundGeolocation.on('start', function() {
        console.log('[INFO] BackgroundGeolocation service has been started');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_start', {});

        BackgroundGeolocation.checkStatus(function(status) {
            if (status.authorization !== BackgroundGeolocation.AUTHORIZED) {
                setTimeout(function() {
                    if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-error-authorization');
                        backgroundGeolocReject = null;
                        backgroundGeolocResolve = null;
                    }
                }, 200);
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
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_geo_authorization', {status: status});

        if (status !== BackgroundGeolocation.AUTHORIZED) {
            console.warn('[WARN] BackgroundGeolocation not fully authorized, status:', status);
            // Emit non-blocking event — the UI layer (pages.js) can respond without freezing GPS
            if (typeof GEO !== 'undefined') GEO.emit('authorizationChanged', status);
        }
    });

    BackgroundGeolocation.on('background', function() {
        console.log('[INFO] App is in background');
        APP_VISIBILITY = 'background';
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('app_visibility', {state: 'background'});

        // triggers document pause event
        document.dispatchEvent(new Event('pause'));
    });

    BackgroundGeolocation.on('foreground', function() {
        console.log('[INFO] App is in foreground');
        APP_VISIBILITY = 'foreground';
        resumeAudioContext('foreground');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('app_visibility', {state: 'foreground'});

        // triggers document resume event
        document.dispatchEvent(new Event('resume'));
    });

    BackgroundGeolocation.on('activity', function(activity) {
        GEO.motionIsStationary = (activity.type === 'STILL');
        if (typeof TELEMETRY !== 'undefined')
            TELEMETRY.log('motion_activity', {type: activity.type, confidence: activity.confidence});
    });

    if (!backgroundGeolocSetup) {
        document.addEventListener('pause', function() {
            console.log('[INFO] App is paused');
            APP_VISIBILITY = 'background';
        }, false);

        document.addEventListener('resume', function() {
            console.log('[INFO] App is resumed');
            APP_VISIBILITY = 'foreground';
            resumeAudioContext('resume');
            // iOS backgrounding is not an audio interruption. Let the native
            // AVAudioSession interruption callback drive pause/resume there.
            if (PLATFORM !== 'ios' && typeof requestAudioFocus === 'function') {
                requestAudioFocus().catch(function(e) { console.warn('[AudioFocus] re-request on resume failed:', e); });
            }
        }, false);
    }

    backgroundGeolocSetup = true;
    return true;
}

function checkBGPosition() {
    return new Promise((resolve, reject) => {
        if (typeof BackgroundGeolocation === 'undefined' || !BackgroundGeolocation) {
            console.warn('BackgroundGeolocation is not defined');
            resolve(GEO.lastPosition);
            return;
        }
        BackgroundGeolocation.getCurrentLocation(
            function(location) {
              // Got a location, now start background tracking
              resolve(location)
            },
            function(error) {
              // If failed, still start tracking
              reject(error)
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
    });
}


// On cordova-android 15 / targetSdk 36, BackgroundGeolocation.start() triggers its own
// requestPermissions() call from a non-foreground context, which causes the system dialog
// to appear frozen (visible but unresponsive to touch). Fix: pre-request ACCESS_FINE_LOCATION
// via cordova-plugin-android-permissions (correct Cordova Activity context) before calling
// start(), so the plugin never needs to show its own dialog.
function _geolocRequestPermissionThenStart(status) {
    const alreadyAuthorized = status.authorization === BackgroundGeolocation.AUTHORIZED ||
                              status.authorization === BackgroundGeolocation.AUTHORIZED_FOREGROUND;

    if (!alreadyAuthorized &&
        typeof cordova !== 'undefined' &&
        cordova.plugins && cordova.plugins.permissions) {

        const perms = cordova.plugins.permissions;
        perms.requestPermission(
            perms.ACCESS_FINE_LOCATION,
            function(permStatus) {
                if (permStatus.hasPermission) {
                    console.log('[INFO] ACCESS_FINE_LOCATION granted — starting BackgroundGeolocation');
                    BackgroundGeolocation.start();
                } else {
                    console.error('[ERROR] Location permission denied by user');
                    if (backgroundGeolocReject) {
                        backgroundGeolocReject('gps-no-authorization');
                        backgroundGeolocReject = backgroundGeolocResolve = null;
                    }
                }
            },
            function(err) {
                console.error('[ERROR] Permission request failed:', err);
                if (backgroundGeolocReject) {
                    backgroundGeolocReject('gps-no-authorization');
                    backgroundGeolocReject = backgroundGeolocResolve = null;
                }
            }
        );
    } else {
        // Already authorized or permissions plugin not available — start directly
        BackgroundGeolocation.start();
    }
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
                _geolocRequestPermissionThenStart(status);
            }
            else {
                console.log('[INFO] BackgroundGeolocation already running — listeners updated, resolving');
                if (backgroundGeolocResolve) {
                    backgroundGeolocResolve();
                    backgroundGeolocResolve = null;
                    backgroundGeolocReject = null;
                }
            }
        });
    
    })
}


// Init geoloc
document.GEO = new GeoLoc();
const GEO = document.GEO;