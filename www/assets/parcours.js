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
var markers = []

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

                // remove all markers from map
                for (let i = 0; i < markers.length; i++) map.removeLayer(markers[i])
                markers = []
                
                if (data.zones) {
                    document.getElementById('pZones').innerHTML = ""

                    data.zones.forEach( (zone, i) => {

                        // Fill zones list
                        const li = document.createElement('li')
                        li.classList.add('list-group-item')
                        li.innerHTML = `Zone ${i}`
                        li.onclick = () => {
                            gotoPoint(zone.lat, zone.lon)
                            selectPoint('zones', i)
                        }
                        document.getElementById('pZones').appendChild(li)

                        // add delete button
                        const button = document.createElement('button')
                        button.classList.add('btn', 'btn-sm', 'btn-danger', 'float-end', 'p-1')
                        button.innerHTML = '<i class="bi bi-trash"></i>'
                        button.onclick = () => {
                            if (confirm('Supprimer la zone ' + i + ' ?')) {
                                parcours.zones.splice(i, 1)
                                save().then(load)
                            }
                        }
                        li.appendChild(button)

                        // add up/down buttons
                        const buttonUp = document.createElement('button')
                        buttonUp.classList.add('btn', 'btn-sm', 'btn-info', 'float-end', 'p-1', 'me-1')
                        buttonUp.innerHTML = '<i class="bi bi-arrow-up"></i>'
                        buttonUp.onclick = () => {
                            if (i > 0) {
                                [parcours.zones[i], parcours.zones[i - 1]] = [parcours.zones[i - 1], parcours.zones[i]]
                                save().then(load).then(() => selectPoint('zones', i - 1))
                            }
                        }
                        li.appendChild(buttonUp)

                        const buttonDown = document.createElement('button')
                        buttonDown.classList.add('btn', 'btn-sm', 'btn-info', 'float-end', 'p-1', 'me-1')
                        buttonDown.innerHTML = '<i class="bi bi-arrow-down"></i>'
                        buttonDown.onclick = () => {
                            if (i < parcours.zones.length - 1) {
                                [parcours.zones[i], parcours.zones[i + 1]] = [parcours.zones[i + 1], parcours.zones[i]]
                                save().then(load).then(() => selectPoint('zones', i + 1))
                            }
                        }
                        li.appendChild(buttonDown)                     

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
                        marker.enableEdit()
                        marker.bindTooltip("Zone " + i);
                        marker.on('click', () => { selectPoint('zones', i) })
                        markers.push(marker)
                    })
                }

                if (data.steps) {

                    document.getElementById('pSteps').innerHTML = ""

                    data.steps.forEach( (step, i) => {

                        // Fill steps list
                        const li = document.createElement('li')
                        li.classList.add('list-group-item')
                        li.innerHTML = `Etape ${i}`
                        li.onclick = () => {
                            gotoPoint(step.lat, step.lon)
                            selectPoint('steps', i)
                        }
                        document.getElementById('pSteps').appendChild(li)

                        // add delete button
                        const button = document.createElement('button')
                        button.classList.add('btn', 'btn-sm', 'btn-danger', 'float-end', 'p-1')
                        button.innerHTML = '<i class="bi bi-trash"></i>'
                        button.onclick = () => {
                            if (confirm('Supprimer l\'étape ' + i + ' ?')) {
                                parcours.steps.splice(i, 1)
                                save().then(load)
                            }
                        }
                        li.appendChild(button)

                        // add up/down buttons
                        const buttonUp = document.createElement('button')
                        buttonUp.classList.add('btn', 'btn-sm', 'btn-info', 'float-end', 'p-1', 'me-1')
                        buttonUp.innerHTML = '<i class="bi bi-arrow-up"></i>'
                        buttonUp.onclick = () => {
                            if (i > 0) {
                                [parcours.steps[i], parcours.steps[i - 1]] = [parcours.steps[i - 1], parcours.steps[i]]
                                save().then(load).then(() => selectPoint('steps', i - 1))
                            }
                        }
                        li.appendChild(buttonUp)

                        const buttonDown = document.createElement('button')
                        buttonDown.classList.add('btn', 'btn-sm', 'btn-info', 'float-end', 'p-1', 'me-1')
                        buttonDown.innerHTML = '<i class="bi bi-arrow-down"></i>'
                        buttonDown.onclick = () => {
                            if (i < parcours.steps.length - 1) {
                                [parcours.steps[i], parcours.steps[i + 1]] = [parcours.steps[i + 1], parcours.steps[i]]
                                save().then(load).then(() => selectPoint('steps', i + 1))
                            }
                        }
                        li.appendChild(buttonDown)

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
                        marker.enableEdit()
                        marker.bindTooltip("Etape " + i);
                        marker.on('click', () => { selectPoint('steps', i) })
                        markers.push(marker)
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
        parcours[marker.options.type][marker.options.index].radius = marker.getRadius()
        save()

        // select the marker
        selectPoint(marker.options.type, marker.options.index)
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

// Select point
function selectPoint(type, index) {
    
    // unsellect all
    markers.forEach(marker => { 
        marker.options.selected = false
        L.DomUtil.removeClass(marker._path, 'selected');
    })
    
    // select the one
    markers.filter(marker => marker.options.type == type && marker.options.index == index)[0].options.selected = true
    L.DomUtil.addClass(markers.filter(marker => marker.options.type == type && marker.options.index == index)[0]._path, 'selected');

    // update list
    document.getElementById('pZones').childNodes.forEach(li => {
        li.classList.remove('active')
    })
    document.getElementById('pSteps').childNodes.forEach(li => {
        li.classList.remove('active')
    })

    document.getElementById('p' + type.charAt(0).toUpperCase() + type.slice(1)).childNodes[index].classList.add('active')

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
