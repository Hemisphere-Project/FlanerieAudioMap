const ZOOM = 19
const CROSSFADE_DISTANCE = 10
const CROSSFADE_DUMP = 4
const CALIBRATION_TIME = 2

var refreshTimer = null
var watchId = null
var firstMeasure = null
var initialPosition = null
var lastPosition = null
var lastTrackPosition = null
var initializing = true


// var instru1 = document.getElementById('player-instrumental1')
// var instru2 = document.getElementById('player-instrumental2')
// var voice = document.getElementById('player-voice')

var instru1 = null
var instru2 = null
var voice = null


function geo_distance(pos1, pos2) {
    if ((pos1.coords.latitude == pos2.coords.latitude) && (pos1.coords.longitude == pos2.coords.longitude)) {
        return 0;
    }
    else {
        var radLat1 = Math.PI * pos1.coords.latitude/180;
        var radLat2 = Math.PI * pos2.coords.latitude/180;
        var theta = pos1.coords.longitude-pos2.coords.longitude;
        var radtheta = Math.PI * theta/180;
        var dist = Math.sin(radLat1) * Math.sin(radLat2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180/Math.PI;
        dist = dist * 60 * 1.1515 * 1.609344 * 1000
        return dist;
    }
}

function startGeoloc() 
{   
    if (!instru1) instru1 = new Howl({src: ['media/instrumental1.mp3'], loop: true})
    if (!instru2) instru2 = new Howl({src: ['media/instrumental2.mp3'], loop: true})

    document.getElementById('logs').innerHTML = 'Recherche de la position en cours...'

    // load instrumentals , set volume at 0
    instru1.play()
    instru1.volume(0)

    instru2.play()
    instru2.volume(0)

    if (navigator.geolocation) {
        
        document.getElementById('map').style.opacity = 0
        document.getElementById('setstart').style.display = 'none'
        firstMeasure = null
        initialPosition = null
        lastPosition = null
        lastTrackPosition = null
        initializing = true
        polyline.setLatLngs([])
        
        if (!watchId) watchId = navigator.geolocation.watchPosition(successCallback, errorCallback, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
        })
    }
    else document.getElementById('logs').innerHTML = 'La géolocalisation n\'est pas supportée par votre navigateur'
}

function successCallback(position) {
    document.getElementById('lat').innerHTML = position.coords.latitude
    document.getElementById('long').innerHTML = position.coords.longitude
    document.getElementById('prec').innerHTML = Math.round(position.coords.accuracy, 2) + ' m'
    document.getElementById('speed').innerHTML = Math.round(position.coords.speed, 2) + ' m/s'
    document.getElementById('time').innerHTML = new Date(position.timestamp).toLocaleTimeString()
    
    // first measure
    if (!firstMeasure) {
        firstMeasure = position
        initialPosition = position
    }
    lastPosition = position

    if (!lastTrackPosition || geo_distance(lastTrackPosition, position) > 1) {
        lastTrackPosition = position
        polyline.addLatLng([position.coords.latitude, position.coords.longitude])
    }

    // adjusting initial position during first 10 seconds if accuracy is better
    if (firstMeasure.timestamp + CALIBRATION_TIME*1000 > position.timestamp) 
    {
        if (position.coords.accuracy < initialPosition.coords.accuracy) initialPosition = position
        document.getElementById('distance').innerHTML = "<i>-</i>"
        document.getElementById('logs').innerHTML = 'Initialisation en cours..'
    }
    // getting distance
    else {

        // first run
        if (initializing) {
            initializing = false
            document.getElementById('logs').innerHTML = 'Initialisation terminée'

            markerStart.setLatLng([position.coords.latitude, position.coords.longitude])
            map.setView([position.coords.latitude, position.coords.longitude], ZOOM)

            // On map move: initMap with new map center
            map.off('move')
            map.on('move', function() {
                initialPosition = {
                    coords: {
                        latitude: map.getCenter().lat,
                        longitude: map.getCenter().lng,
                    }
                }
                markerStart.setLatLng([initialPosition.coords.latitude, initialPosition.coords.longitude])
            })

            // map opacity
            document.getElementById('map').style.opacity = 1
            document.getElementById('setstart').style.display = 'block'
        }

        markerPosition.setLatLng([position.coords.latitude, position.coords.longitude])
        document.getElementById('logs').innerHTML = 'Position mise à jour'


        document.getElementById('distance').innerHTML = Math.round(geo_distance(initialPosition, position), 2) + ' m'

        // set volume according to distance
        var crossfadeDistance = CROSSFADE_DISTANCE
        var dist = geo_distance(initialPosition, position)
        
        var vol1 = Math.min(1, Math.max(0, 1 - (dist-1) / crossfadeDistance))
        var vol2 = Math.min(1, Math.max(0, (dist-1) / crossfadeDistance))

        // slow fade
        var crossFadeDump = CROSSFADE_DUMP
        vol1 = Math.min(1, Math.max(0, instru1.volume() + (vol1 - instru1.volume()) / crossFadeDump))
        vol2 = Math.min(1, Math.max(0, instru2.volume() + (vol2 - instru2.volume()) / crossFadeDump))


        instru1.volume(vol1)
        instru2.volume(vol2)

        document.getElementById('instru1-volume').innerHTML = Math.round(instru1.volume() * 100) + '%'
        document.getElementById('instru2-volume').innerHTML = Math.round(instru2.volume() * 100) + '%'
    }
}

function errorCallback(error) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        document.getElementById('logs').innerHTML = 'L\'utilisateur a refusé la demande de géolocalisation'
        break
      case error.POSITION_UNAVAILABLE:
        document.getElementById('logs').innerHTML = 'L\'emplacement de l\'utilisateur n\'a pas pu être déterminé'
        break
      case error.TIMEOUT:
        document.getElementById('logs').innerHTML = 'Le service n\'a pas répondu à temps';
        break
    }
    setTimeout(startGeoloc, 5000)
}

document.getElementById('refresh').addEventListener('click', startGeoloc)

document.getElementById('setstart').addEventListener('click', () => {
    initialPosition = lastPosition
    markerStart.setLatLng([initialPosition.coords.latitude, initialPosition.coords.longitude])
    map.setView([initialPosition.coords.latitude, initialPosition.coords.longitude], ZOOM)
    polyline.setLatLngs([])
})

// map
var map = L.map('map').setView([45.7663, 4], ZOOM)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: ZOOM,
    minZoom: ZOOM,
}).addTo(map)

// Start point marker
var markerStart = L.marker([45.7663, 4]).addTo(map)

// Track line
var polyline = L.polyline([], {color: 'blue'}).addTo(map)

// Position marker: round style
var markerPosition = L.marker([45.7663, 4], {
    icon: L.divIcon({
        className: 'round-icon',
        html: '<div class="round-icon"></div>',
    }),
}).addTo(map)



