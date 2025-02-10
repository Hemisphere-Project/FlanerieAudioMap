// CONF
const CROSSFADE_DISTANCE = 10
const CROSSFADE_DUMP = 4

// GLOBALS
const PARCOURS = document.PARCOURS
const GEO = document.GEO

// MAP
const MAP = initMap('map')

// title click -> back to control
$('#title').click(() => window.location.href = '/control')

// current file from url
var parcoursID = window.location.pathname.split('/').pop()

// GEOLOC
//

// Track line
var lastTrackPosition = null

// Position marker: round style
var markerPosition = L.marker([45.7663, 4], {
    icon: L.divIcon({
        className: 'position-icon',
        html: '<div class="position-icon"></div>',
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
    

    // track
    // if (!lastTrackPosition || geo_distance(lastTrackPosition, position) > 3) {
    //     lastTrackPosition = position
    //     polyline.addLatLng([position.coords.latitude, position.coords.longitude])
    // }

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

$('#start').click(() => {
    lastTrackPosition = null
    GEO.startGeoloc()
    GEO.followMe()
    GEO.on('position', updatePosition)
    GEO.on('error', errorCallback)
    $('.status').hide()
    $('.status-geoloc').show()
})

$('#simulate').click(() => {
    lastTrackPosition = null

    var position = PARCOURS.find('steps', 0).getCenterPosition()
    position.lat += 0.0005

    GEO.simulateGeoloc(position)
    GEO.followMe()
    GEO.on('position', updatePosition)
    
    
    $('.status').hide()
    $('.status-simulate').show()
})

// Stop and reload
$('#rearm').click(() => {
    stepIndex = -2
    PARCOURS.stopAudio()
    setTimeout(() => MAP.fire('move'), 2000)
})

// Reload page
$('#reload').click(() => location.reload())


var noSleep = new NoSleep();

// INIT
//
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