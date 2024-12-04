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

var instru1 = null

// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/';
})

// current file from url
var parcoursID = window.location.pathname.split('/').pop()
var parcours = {}
var markers = []

// LOAD
//

// Get parcours json
function load(pID) {
    if (!pID) pID = parcoursID
    
    return get('/control/p/' + pID + '/json')
        .then(data => {
            // console.log(data)          
            
            if (data && 'name' in data) {
                parcours = data

                // Set name
                document.getElementById('title').innerHTML = data.name + ' (' + data.status + ')'

                // Set map position
                if (data.coords) {
                    const [zoom, lat, lon] = data.coords.split('/')
                    map.setView([lat, lon], zoom)  
                }

                // remove all markers from map
                for (let i = 0; i < markers.length; i++) map.removeLayer(markers[i])
                markers = []
                
                // Draw zones
                if (data.zones) 
                {
                    data.zones.forEach( (zone, i) => {
                        // Add zones markers on map
                        const marker = L.circle([zone.lat, zone.lon],
                            {
                                color: 'green',
                                fillColor: '#0f0',
                                fillOpacity: 0.3,
                                radius: zone.radius,
                                type: 'zones',
                                index: i,
                                selected: false,
                            })
                            .addTo(map)
                        marker.bindTooltip("Zone " + i);
                        // marker.on('click', () => { selectPoint('zones', i) })
                        markers.push(marker)
                    })
                }

                // Draw steps
                if (data.steps) 
                {
                    data.steps.forEach( (step, i) => {
                        // Add steps markers on map
                        const marker = L.circle([step.lat, step.lon],
                            {
                                color: 'red',
                                fillColor: '#f03',
                                fillOpacity: 0.5,
                                radius: step.radius,
                                type: 'steps',
                                index: i,
                                selected: false,
                            })
                            .addTo(map)
                        marker.bindTooltip("Etape " + i);
                        // marker.on('click', () => { selectPoint('steps', i) })
                        markers.push(marker)
                    })
                }
            }
            else throw new Error('No data')
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

function initGeoloc() 
{
    console.log('Recherche de la position en cours...')

    // remove already exisitn map move event
    map.off('move')

    // stop existing geoloc
    if (watchId) navigator.geolocation.clearWatch(watchId)
    watchId = null

    firstMeasure = null
    initialPosition = null
    lastPosition = null
    lastTrackPosition = null
    initializing = true
    polyline.setLatLngs([])

    // load instrumentals , set volume at 0
    if (!instru1) instru1 = new Howl({src: ['/media/instru1.wav'], loop: true})
    instru1.play()
    instru1.volume(0)
}


function startGeoloc() 
{   
    initGeoloc()

    if (navigator.geolocation) 
    {   
        if (!watchId) watchId = navigator.geolocation.watchPosition(successCallback, errorCallback, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
        })
    }
    else console.error('La géolocalisation n\'est pas supportée par votre navigateur')
}

function simulateGeoloc()
{
    initGeoloc()

    // call successCallback with map center on map move
    map.on('move', function() {
        successCallback({
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


function successCallback(position) 
{
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

    // adjusting initial position during first 10 seconds if accuracy is better
    if (!position.simulate && firstMeasure.timestamp + CALIBRATION_TIME*1000 > position.timestamp) 
    {
        if (position.coords.accuracy < initialPosition.coords.accuracy) initialPosition = position
        document.getElementById('distance').innerHTML = "<i>-</i>"
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
        if (!lastTrackPosition || distance(lastTrackPosition, position) > 3) {
            lastTrackPosition = position
            polyline.addLatLng([position.coords.latitude, position.coords.longitude])
        }
        
        // map follow position
        map.setView([position.coords.latitude, position.coords.longitude], map.getZoom())
        markerPosition.setLatLng([position.coords.latitude, position.coords.longitude])

        document.getElementById('distance').innerHTML = Math.round(distance(initialPosition, position), 2) + ' m'

        // // set volume according to distance
        // var crossfadeDistance = CROSSFADE_DISTANCE
        // var dist = distance(initialPosition, position)
        
        // var vol1 = Math.min(1, Math.max(0, 1 - (dist-1) / crossfadeDistance))
        // var vol2 = Math.min(1, Math.max(0, (dist-1) / crossfadeDistance))

        // // slow fade
        // var crossFadeDump = CROSSFADE_DUMP
        // vol1 = Math.min(1, Math.max(0, instru1.volume() + (vol1 - instru1.volume()) / crossFadeDump))


        // instru1.volume(vol1)
        // console.log('Volume: ' + vol1)
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

// INIT
//
load()