// VARS

const CROSSFADE_DISTANCE = 10
const CROSSFADE_DUMP = 4




// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/';
})

// current file from url
var parcoursID = window.location.pathname.split('/').pop()

// Load Map 
var MAP = initMap('map')

// GEOLOC
//

// Track line
var polyline = L.polyline([], {color: 'blue'}).addTo(MAP)
var lastTrackPosition = null

// Position marker: round style
var markerPosition = L.marker([45.7663, 4], {
    icon: L.divIcon({
        className: 'round-icon',
        html: '<div class="round-icon"></div>',
    }),
}).addTo(MAP)


// On move callback
function updatePosition(position) 
{   
    // Update position on screen
    document.getElementById('lat').innerHTML = position.coords.latitude
    document.getElementById('long').innerHTML = position.coords.longitude
    document.getElementById('prec').innerHTML = Math.round(position.coords.accuracy, 2) + ' m'
    document.getElementById('speed').innerHTML = Math.round(position.coords.speed, 2) + ' m/s'
    document.getElementById('time').innerHTML = new Date(position.timestamp).toLocaleTimeString()
    
    // marker follow position
    markerPosition.setLatLng([position.coords.latitude, position.coords.longitude])

    // track
    if (!lastTrackPosition || geo_distance(lastTrackPosition, position) > 3) {
        lastTrackPosition = position
        polyline.addLatLng([position.coords.latitude, position.coords.longitude])
    }

    // update spots
    PARCOURS.update(position)
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
    // setTimeout(()=>{GEO.startGeoloc(MAP, updatePosition, errorCallback)}, 5000)
}

document.getElementById('start').addEventListener('click', () => {
    polyline.setLatLngs([])
    lastTrackPosition = null
    GEO.startGeoloc(MAP, updatePosition, errorCallback)
    $('.status').hide()
    $('.status-geoloc').show()
})

document.getElementById('simulate').addEventListener('click', () => {
    polyline.setLatLngs([])
    lastTrackPosition = null
    GEO.simulateGeoloc(MAP, updatePosition)
    $('.status').hide()
    $('.status-simulate').show()
})

document.getElementById('rearm').addEventListener('click', () => {
    stepIndex = -2
    PARCOURS.stopAudio()
    setTimeout(() => {
        MAP.fire('move')
    }, 2000)
})
document.getElementById('reload').addEventListener('click', () => {
    location.reload()
})

var noSleep = new NoSleep();

// INIT
//
PARCOURS.setMap(MAP)
PARCOURS.load(parcoursID)
    .then(() => {
        // Set name
        document.getElementById('title').innerHTML = PARCOURS.info.name + ' (' + PARCOURS.info.status + ')'
    })

// START action
//
$('.overlay').click(() => {
    $('.overlay').hide()
    noSleep.enable();
    // load spots players
    // PARCOURS.loadAudio()
})