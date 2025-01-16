// VARS

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

// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/';
})

// current file from url
var parcoursID = window.location.pathname.split('/').pop()
var parcours = {}
var spots = []


// LOAD
//

// Get parcours json
function load(pID) {
    if (!pID) pID = parcoursID
    
    return get('/edit/' + pID + '/json')
        .then(data => {
            if (!data || !('name' in data)) throw new Error('No data')

            parcours = data

            // Set name
            document.getElementById('title').innerHTML = data.name + ' (' + data.status + ')'

            // Set map position
            if (data.coords) {
                const [zoom, lat, lon] = data.coords.split('/')
                map.setView([lat, lon], zoom)  
            }

            // Clear previous spots
            for (let i = 0; i < spots.length; i++) spots[i].clear()
            spots = []
            
            // Draw zones
            if (data.zones) 
            {
                data.zones.forEach( (zone, i) => {
                    var z = new Zone(zone, map, i)
                    spots.push(z)
                })
            }

            // Draw steps
            if (data.steps) 
            {
                data.steps.forEach( (step, i) => {
                    var s = new Step(step, map, i)
                    spots.push(s)
                })
            }
        })
        .catch(error => {
            console.error(error)
        })
}

// Load Map 
var startPoint = [43.1249, 1.254];
var map = L.map('map', {editable: true}).setView(startPoint, 16)

map.doubleClickZoom.disable(); // disable double click zoom

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
}).addTo(map)


// GEOLOC
//

// Track line
var polyline = L.polyline([], {color: 'blue'}).addTo(map)

// Position marker: round style
var markerPosition = L.marker([45.7663, 4], {
    icon: L.divIcon({
        className: 'round-icon',
        html: '<div class="round-icon"></div>',
    }),
}).addTo(map)

// Init 
function initGeoloc() 
{
    console.log('Recherche de la position en cours...')

    // remove already exisitn map move event
    map.off('move')
    $('.status').hide()

    // stop existing geoloc
    if (watchId) navigator.geolocation.clearWatch(watchId)
    watchId = null

    firstMeasure = null
    initialPosition = null
    lastPosition = null
    lastTrackPosition = null
    initializing = true
    polyline.setLatLngs([])
}

// Start real geoloc
function startGeoloc() 
{   
    initGeoloc()
    $('.status-geoloc').show()

    // Disable map draggable
    map.dragging.disable()

    if (navigator.geolocation) 
    {   
        if (!watchId) watchId = navigator.geolocation.watchPosition(updatePosition, errorCallback, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
        })
    }
    else console.error('La géolocalisation n\'est pas supportée par votre navigateur')
}

// Start simulated geoloc
function simulateGeoloc()
{
    initGeoloc()
    $('.status-simulate').show()

    // Enable map draggable
    map.dragging.enable()

    // call updatePosition with map center on map move
    map.on('move', function() {
        updatePosition({
            coords: {
                latitude: map.getCenter().lat,
                longitude: map.getCenter().lng,
                accuracy: 10,
                speed: 0,
            },
            timestamp: Date.now(),
            simulate: true,
        })
    })

    // trigger first move
    map.fire('move')

    console.log('>> Mode Simulation basée sur le déplacement de la carte !')
}

// On move callback
function updatePosition(position) 
{   
    // Update position on screen
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

    // adjusting initial position during CALIBRATION_TIME if accuracy is better
    if (!position.simulate && firstMeasure.timestamp + CALIBRATION_TIME*1000 > position.timestamp) 
    {
        if (position.coords.accuracy < initialPosition.coords.accuracy) initialPosition = position
        console.log('Initialisation en cours..')
    }
    // getting distance
    else {

        // first run
        if (initializing) {
            initializing = false

            console.log('Initialisation terminée')
        }

        // track
        if (!lastTrackPosition || geo_distance(lastTrackPosition, position) > 3) {
            lastTrackPosition = position
            polyline.addLatLng([position.coords.latitude, position.coords.longitude])
        }
        
        // map follow position
        if (!position.simulate)
            map.setView([position.coords.latitude, position.coords.longitude], map.getZoom())
        
        // marker follow position
        markerPosition.setLatLng([position.coords.latitude, position.coords.longitude])

        // document.getElementById('distance').innerHTML = Math.round(geo_distance(initialPosition, position), 2) + ' m'

        // update spots
        spots.forEach(spot => spot.updatePosition(position))
    }

    // next measure
    lastPosition = position
}

function errorCallback(error) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        console.error('L\'utilisateur a refusé la demande de géolocalisation')
        break
      case error.POSITION_UNAVAILABLE:
        console.error('L\'emplacement de l\'utilisateur n\'a pas pu être déterminé')
        break
      case error.TIMEOUT:
        console.error('Le service n\'a pas répondu à temps')
        break
    }
    // setTimeout(startGeoloc, 5000)
}

document.getElementById('start').addEventListener('click', startGeoloc)
document.getElementById('simulate').addEventListener('click', simulateGeoloc)
document.getElementById('rearm').addEventListener('click', () => {
    stepIndex = -2
    spots.forEach(spot => spot.player.stop())
    setTimeout(() => {
        map.fire('move')
    }, 2000)
})
document.getElementById('reload').addEventListener('click', () => {
    location.reload()
})

var noSleep = new NoSleep();

// INIT
//
load()

$('.overlay').click(() => {
    $('.overlay').hide()
    noSleep.enable();
    // load spots players
    // spots.forEach(spot => spot.loadAudio())
})