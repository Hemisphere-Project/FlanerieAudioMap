// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/control';
})

// Toast
var toastElList = [].slice.call(document.querySelectorAll('.toast'))
var toastList = toastElList.map(function (toastEl) {
    return new bootstrap.Toast(toastEl)
})

function toastSuccess(txt) {
    // discard previous toasts
    $('#successToast').toast('dispose')
    $('#successToast').toast('show').find('.toast-body').text(txt)
}

function toastError(txt) {
    // discard previous toasts
    $('#errorToast').toast('dispose')
    $('#errorToast').toast('show').find('.toast-body').text(txt)
}

// current file from url
const parcoursID = window.location.pathname.split('/').pop()
var parcours = {}
var markersSTEPS = []
var markersZONES = []

// LOAD
//
// Get parcours json
function load() {
    return get('/control/p/' + parcoursID + '/json')
        .then(data => {
            console.log(data)
            
            if (data && 'name' in data) {
                parcours = data
                
                document.getElementById('pName').value = data.name
                document.getElementById('pStatus').value = data.status
                
                if (data.coords) {
                    // intialize map (on first load)
                    if (!document.getElementById('pCoords').value) {
                        const [zoom, lat, lon] = data.coords.split('/')
                        map.setView([lat, lon], zoom)
                    }
                    document.getElementById('pCoords').value = data.coords
                }
                else document.getElementById('pCoords').value = ''
                document.getElementById('pCoordsLink').href = 'https://www.openstreetmap.org/#map=' + data.coords 
                
                if (data.zones) {
                    document.getElementById('pZones').innerHTML = ""

                    // remove all markers from map
                    for (let i = 0; i < markersZONES.length; i++) map.removeLayer(markersZONES[i])
                    markersZONES = []

                    data.zones.forEach( (zone, i) => {

                        // Fill zones list
                        const li = document.createElement('li')
                        li.classList.add('list-group-item')
                        li.innerHTML = `Zone ${i}`
                        li.onclick = () => gotoPoint(zone.lat, zone.lon)
                        document.getElementById('pZones').appendChild(li)

                        // Add zones markers on map
                        const marker = L.circle([zone.lat, zone.lon],
                            {
                                color: 'green',
                                fillColor: '#0f0',
                                fillOpacity: 0.3,
                                radius: zone.radius,
                                type: 'zones',
                                index: i,
                            })
                            .addTo(map)
                        marker.enableEdit()
                        marker.bindTooltip("Zone " + i);
                        markersZONES.push(marker)
                    })
                }

                if (data.steps) {

                    document.getElementById('pSteps').innerHTML = ""

                    // remove all markers from map
                    for (let i = 0; i < markersSTEPS.length; i++) map.removeLayer(markersSTEPS[i])
                    markersSTEPS = []

                    data.steps.forEach( (step, i) => {

                        // Fill steps list
                        const li = document.createElement('li')
                        li.classList.add('list-group-item')
                        li.innerHTML = `Etape ${i}`
                        li.onclick = () => gotoPoint(step.lat, step.lon)
                        document.getElementById('pSteps').appendChild(li)

                        // Add steps markers on map
                        const marker = L.circle([step.lat, step.lon],
                            {
                                color: 'red',
                                fillColor: '#f03',
                                fillOpacity: 0.5,
                                radius: step.radius,
                                type: 'steps',
                                index: i,
                            })
                            .addTo(map)
                        marker.enableEdit()
                        marker.bindTooltip("Etape " + i);
                        markersSTEPS.push(marker)
                    })

                }

               

            }
            else throw new Error('No data')
        })
        .catch(error => {
            console.error(error)
            toastError('Erreur lors du chargement du parcours..')
        })
}

// SAVE
//
function save() {
    parcours.name = document.getElementById('pName').value
    parcours.coords = document.getElementById('pCoords').value

    return post('/control/p/' + parcoursID + '/json', parcours)
        .then(() => {
            console.log('saved')
            toastSuccess('Parcours enregistré !')
        })
        .catch(error => {
            console.error(error)
            toastError('Erreur lors de l\'enregistrement du parcours..')
        })
}

// Name on change => save
document.getElementById('pName').addEventListener('change', () => {

    // check if name is valid
    const name = document.getElementById('pName').value
    if (name.length < 3) {
        toastError('Nom trop court')
        $('#pName').addClass('is-invalid')
        return
    }
    $('#pName').removeClass('is-invalid')

    save().then(load)
})

// Coords on change => save
document.getElementById('pCoords').addEventListener('change', () => {

    // check if coords is valid (OpenStreetMap format like 19/45.760691/4.914754)
    const coords = document.getElementById('pCoords').value
    if (coords && !coords.match(/^\d+\/\d+\.\d+\/\d+\.\d+$/)) {
        toastError('Coordonnées invalides')
        $('#pCoords').addClass('is-invalid')
        return
    }
    $('#pCoords').removeClass('is-invalid')


    save().then(load).then(loadMap)
})

// Load Map 
var startPoint = [43.1249, 1.254];
var map = L.map('map', {editable: true}).setView(startPoint, 16)

// Drag marker
map.on('editable:vertex:dragend', function (e) {
    let marker = e.layer; // marker that was dragged
    try {
        parcours[marker.options.type][marker.options.index].lat = marker.getLatLng().lat
        parcours[marker.options.type][marker.options.index].lon = marker.getLatLng().lng
        save()
    }
    catch (error) {
        console.error(error)
        toastError('Erreur lors du déplacement du marker..')
        load()
    }
});

map.doubleClickZoom.disable(); // disable double click zoom

map.on('mouseup',function(e){ map.removeEventListener('mousemove'); }) // hack to enable cicrle drag

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
}).addTo(map)

function loadMap() {
    const coords = document.getElementById('pCoords').value
    if (coords) {
        const [zoom, lat, lon] = coords.split('/')
        map.setView([lat, lon], zoom)
        // markerStart.setLatLng([lat, lon])
    }
}

// set coords (from map to pCoords)
$('#setCoords').click(() => {
    const coords = map.getZoom() + '/' + map.getCenter().lat + '/' + map.getCenter().lng
    document.getElementById('pCoords').value = coords
    save().then(load)
})


// Double click on map to add a marker
var popupNewStep = L.popup();
function onMapDblClick(e) {
    popupNewStep
        .setLatLng(e.latlng)
        .setContent("\
            <button class='btn btn-sm btn-info' onclick='addStep(" + e.latlng.lat + "," + e.latlng.lng + "); popupNewStep.remove();'>Etape</button> \
            <button class='btn btn-sm btn-info' onclick='addZone(" + e.latlng.lat + "," + e.latlng.lng + "); popupNewStep.remove();'>Zone</button> \
        ")
        .openOn(map);
}
map.on('dblclick', onMapDblClick);


// Add step
function addStep(lat, lon) {
    const step = {
        lat: lat,
        lon: lon,
        radius: 3,
    }
    if (!parcours.steps) parcours.steps = []
    parcours.steps.push(step)
    save().then(load)
}

// Add zone
function addZone(lat, lon) {
    const zone = {
        lat: lat,
        lon: lon,
        radius: 10,
    }
    if (!parcours.zones) parcours.zones = []
    parcours.zones.push(zone)
    save().then(load)
}

// Goto point
function gotoPoint(lat, lon) {
    map.setView([lat, lon], 19)
}

// // Start point marker
// var markerStart = L.marker([45.7663, 4]).addTo(map)

// // Track line
// var polyline = L.polyline([], {color: 'blue'}).addTo(map)

// // Position marker: round style
// var markerPosition = L.marker([45.7663, 4], {
//     icon: L.divIcon({
//         className: 'round-icon',
//         html: '<div class="round-icon"></div>',
//     }),
// }).addTo(map)



// INIT
//
load().then(loadMap)