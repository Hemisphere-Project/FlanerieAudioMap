// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/control';
})

$(document).bind('mousedown selectstart', function(e) {
    return $(e.target).is('input, textarea, select, option, html');
});

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
var parcoursID = window.location.pathname.split('/').pop()
var parcours = {}

// LOAD
//
// Get parcours json
function load() {
    return get('/edit/' + parcoursID + '/json')
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

                // Clear previous spots
                clearSpots()
                
                // Etapes
                //
                if (data.steps) {
                    document.getElementById('pSteps').innerHTML = ""

                    data.steps.forEach( (step, i) => {

                        // Add steps markers on map
                        var s = new Step(step, map, i)
                        s.editable()
                        s.loadAudio()

                        // Fill steps list
                        const li = $('<li class="list-group-item spots-edit steps-edit">')
                        li.appendTo('#pSteps')
                        
                        // header div : title + buttons
                        const header = $('<div>').addClass('edit-header').appendTo(li)
                        header.append($('<span>').addClass('badge bg-danger me-3').text(i))
                        header.append($('<span>').addClass('edit-media me-1').text(step.folder))

                        // body: audio name edit
                        const body = $('<div>').addClass('edit-body').appendTo(li)
                        body.append($('<span>').addClass('badge bg-danger me-1').text(i))

                        const editname = $('<input>').addClass('form-control').val(step.name).appendTo(body)
                            .change(() => {
                                step.name = editname.val()
                                save().then(load).then(() => selectSpot('steps', i))
                            })

                        const media = $('<div>').addClass('edit-media-list mt-2').appendTo(body)
                        const mediaList = step.media ? Object.keys(step.media) : []

                        // buttons
                        body.append($('<button>').addClass('btn btn-sm btn-danger btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                            if (confirm('Supprimer ' + s.name() + ' ?')) 
                            {
                                parcours.steps.splice(i, 1)
                                save().then(load)
                            }
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-up"></i>').click(() => {
                            if (i > 0) {
                                [parcours.steps[i], parcours.steps[i - 1]] = [parcours.steps[i - 1], parcours.steps[i]]
                                save().then(load).then(() => selectSpot('steps', i - 1))
                            }
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-down"></i>').click(() => {
                            if (i < parcours.steps.length - 1) {
                                [parcours.steps[i], parcours.steps[i + 1]] = [parcours.steps[i + 1], parcours.steps[i]]
                                save().then(load).then(() => selectSpot('steps', i + 1))
                            }
                        }))

                        // +/- buttons increment/ decrement each master
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-plus"></i>').click(() => {
                            if (step.media && mediaList.some(m => step.media[m].master >= 1)) return
                            mediaList.forEach(m => s.player[m].masterInc(0.01))
                            save().then(load).then(() => selectSpot('steps', i))
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-dash"></i>').click(() => {
                            if (step.media && mediaList.some(m => step.media[m].master <= 0)) return
                            mediaList.forEach(m => s.player[m].masterDec(0.01))
                            save().then(load).then(() => selectSpot('steps', i))
                        }))

                        // button switch to Circle/Polygon
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-circle"></i>').click(() => {
                            s.convertToCircle()
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-pentagon"></i>').click(() => {
                            s.convertToPolygon()
                        }))

                        // Optional toggle
                        const formCheck = $('<div class="form-check form-switch">').appendTo(body)
                        const input = $('<input class="form-check-input" type="checkbox" role="switch">').attr('id', 'flexSwitchCheck' + i).appendTo(formCheck)
                        input.prop('checked', step.optional)
                        input.change(() => {
                            step.optional = input.prop('checked')
                            save().then(load).then(() => selectSpot('steps', i))
                        })
                        formCheck.append($('<label class="form-check-label" for="flexSwitchCheck' + i + '">').text('Facultative'))

                        mediaList.forEach(m => {
                            const div = $('<div>').addClass('edit-media mt-2').appendTo(media)

                            // upload button
                            div.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-start p-1 me-1').html('<i class="bi bi-upload"></i>').click(() => {
                                // remove previous input
                                div.find('input').remove()
                                const input = $('<input class="ms-5">').attr('type', 'file').attr('accept', 'audio/*').appendTo(div)
                                input.change(() => {
                                    const file = input[0].files[0]
                                    if (file) {
                                        const formData = new FormData()
                                        formData.append('file', file)
                                        postFile('/mediaUpload/' + parcoursID + '/' + step.folder, formData)
                                            .then(() => {
                                                input.remove()
                                                step.media[m].src = file.name
                                                save().then(load).then(() => selectSpot('steps', i))
                                            })
                                            .catch(error => {
                                                console.error(error)
                                                toastError('Erreur lors de l\'upload du fichier..')
                                            })
                                    }
                                })
                                input.click()
                            }))

                            // badge with media type fixed width
                            div.append($('<span>').addClass('badge bg-danger me-1').text(m).css('width', '63px'))
                            
                            // media button
                            if (step.media && step.media[m].src != '-') {
                                div.append($('<span>').addClass('edit-media me-1').text(step.media[m].src.substring(0, 25)))
                                div.append($('<button>').addClass('btn btn-sm btn-danger btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                                    if (confirm('Supprimer ' + step.folder + '/' +step.media[m].src + ' ?')) {
                                        get('/mediaRemove/' + parcoursID + '/' + step.folder + '/' + step.media[m].src)
                                        step.media[m].src = '-'
                                        step.media[m].master = 1
                                        save().then(load).then(() => selectSpot('steps', i))
                                    }
                                }))
                                div.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1 btn-preview').html('<i class="bi bi-play"></i>').click(() => {
                                    if (s.player[m].isPlaying()) s.player[m].pause()
                                    else s.player[m].resume()
                                }))
                                s.player[m].on('play', () => div.find('.btn-preview').html('<i class="bi bi-pause"></i>'))
                                s.player[m].on('pause', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                s.player[m].on('stop', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                s.player[m].on('end', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                
                                
                                // volume integer input
                                div.append($('<input class="input-volume float-end me-1 ">').attr('type', 'number').attr('min', 0).attr('max', 100).attr('step', 1)
                                    .val( Math.round(step.media[m].master*100) )
                                    .change(() => {
                                        s.player[m].master(div.find('.input-volume').val()/100.0)
                                        save().then(load).then(() => selectSpot('steps', i))
                                    }))
                                s.player[m].on('master', (vol) => div.find('.input-volume').val(Math.round(vol*100)))
                            }

                        })

                        // Add click event
                        li.click(() => s.select().center())

                        // on select
                        s.on('selected', () => {
                            if (!li.hasClass('active')) s.player.play()
                            li.addClass('active')
                        })
                        s.on('unselected', () => {
                            li.removeClass('active')
                            s.player.stop()
                        })

                    })
                }

                // Objets
                //
                if (data.zones) {
                    document.getElementById('pZones').innerHTML = ""

                    data.zones.forEach( (zone, i) => {

                        // Add zones markers on map
                        var z = new Zone(zone, map, i)
                        z.editable()
                        z.loadAudio()

                        // Fill zones list
                        // const li = document.createElement('li')
                        const li = $('<li class="list-group-item spots-edit zones-edit">')
                        li.appendTo('#pZones')
                        
                        // header div : title + buttons
                        const header = $('<div>').addClass('edit-header').appendTo(li)
                        header.append($('<span>').addClass('badge me-3').addClass(zone.mode == 'Ambiance' ? 'bg-success' : 'bg-info').text(i))
                        header.append($('<span>').addClass('edit-media me-1').text(zone.media.src))
                        

                        // body: audio select 
                        const body = $('<div>').addClass('edit-body').appendTo(li)
                        body.append($('<span>').addClass('badge bg-info me-1').text(i))
                        const select = $('<select>').addClass('form-select').appendTo(body)
                            .append($('<option>').attr('value', '').text('-').val(''))
                            .append($('<option>').attr('value', '*').text(':: upload ::').val('*'))
                            .change(() => {
                                
                                if (select.val() == '*') {
                                    // upload media
                                    const input = $('<input class="ms-5">').attr('type', 'file').attr('accept', 'audio/*').appendTo(body)
                                    input.change(() => {
                                        const file = input[0].files[0]
                                        if (file) {
                                            // add enctype="multipart/form-data"
                                            const formData = new FormData()
                                            formData.append('file', file)
                                            console.log('uploading', file)
                                            postFile('/mediaUpload/' + parcoursID + '/Objets', formData)
                                                .then(() => {
                                                    input.remove()
                                                    zone.media.src = file.name
                                                    save()
                                                        .then(loadMediaList)
                                                        .then(load)
                                                        .then(() => selectSpot('zones', i))
                                                })
                                                .catch(error => {
                                                    console.error(error)
                                                    toastError('Erreur lors de l\'upload du fichier..')
                                                })
                                        }
                                    })
                                    input.click()
                                }
                                else {
                                    zone.media.src = select.val()
                                    save().then(load).then(() => selectSpot('zones', i))
                                }
                                
                            })

                        // audio play/stop button
                        const play = $('<button>').addClass('btn btn-sm btn-secondary btn-sm p-1 me-1').html('<i class="bi bi-play btn-play"></i>').click(() => {
                            if (z.player.isPlaying()) z.player.pause()
                            else z.player.resume()
                        })
                        z.player.on('play', () => play.html('<i class="bi bi-pause btn-play"></i>'))
                        z.player.on('pause', () => play.html('<i class="bi bi-play btn-play"></i>'))
                        z.player.on('stop', () => play.html('<i class="bi bi-play btn-play"></i>'))
                        z.player.on('end', () => play.html('<i class="bi bi-play btn-play"></i>'))
                        body.append(play)

                        // buttons
                        body.append($('<button>').addClass('btn btn-sm btn-danger btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                            if (confirm('Supprimer ' + z.name() + ' ?')) {
                                parcours.zones.splice(i, 1)
                                save().then(load)
                            }
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-up"></i>').click(() => {
                            if (i > 0) {
                                [parcours.zones[i], parcours.zones[i - 1]] = [parcours.zones[i - 1], parcours.zones[i]]
                                save().then(load).then(() => selectSpot('zones', i - 1))
                            }
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-down"></i>').click(() => {
                            if (i < parcours.zones.length - 1) {
                                [parcours.zones[i], parcours.zones[i + 1]] = [parcours.zones[i + 1], parcours.zones[i]]
                                save().then(load).then(() => selectSpot('zones', i + 1))
                            }
                        }))
                            
                        // volume integer input
                        body.append($('<input class="input-volume float-end me-1 ">').attr('type', 'number').attr('min', 0).attr('max', 100).attr('step', 1).val(zone.media.master*100).change(() => {
                            zone.media.master = body.find('input').val()/100.0
                            save().then(load).then(() => selectSpot('zones', i))
                        }))

                        // button switch to Circle/Polygon
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-circle"></i>').click(() => {
                            z.convertToCircle()
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-pentagon"></i>').click(() => {
                            z.convertToPolygon()
                        }))
                        
                        // fill select with media list from folder 'Objets'
                        if (MEDIALIST && MEDIALIST['Objets']) {
                            MEDIALIST['Objets'].forEach(media => {
                                const option = $('<option>').attr('value', media).text(media).val(media)
                                if (media == zone.media.src) option.attr('selected', 'selected')
                                select.append(option)
                            })
                        }

                        // Objet / Ambiance mode toggle
                        const formCheck = $('<div class="form-check form-switch">').appendTo(body)
                        const input = $('<input class="form-check-input" type="checkbox" role="switch">').attr('id', 'flexSwitchCheck' + i).appendTo(formCheck)
                        input.prop('checked', zone.mode == 'Ambiance')
                        input.change(() => {
                            zone.mode = input.prop('checked') ? 'Ambiance' : 'Objet'
                            save().then(load).then(() => selectSpot('zones', i))
                        })
                        formCheck.append($('<label class="form-check-label" for="flexSwitchCheck' + i + '">').text( zone.mode == 'Ambiance' ? 'Ambiance' : 'Objet Ponctuel' ))

                        // Add click event
                        li.click(() => z.select().center())

                        // on select
                        z.on('selected', () => {
                            if (!li.hasClass('active')) z.player.resume()
                            li.addClass('active')
                        })
                        z.on('unselected', () => {
                            li.removeClass('active')
                            z.player.stop()
                        })

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

$('body').on('click', (e) => {
    if ($(e.target).hasClass('base-layer')) {
        unselectSpots()
    }
})

// SAVE
//
var scheduledSave = null
function save() {
    parcours.name = document.getElementById('pName').value
    parcours.coords = document.getElementById('pCoords').value

    return new Promise((resolve, reject) => {
        if (scheduledSave) {
            clearTimeout(scheduledSave)
            scheduledSave = null
        }
        scheduledSave = setTimeout(() => {
            post('/edit/' + parcoursID + '/json', parcours)
                .then(data => {
                    console.log(data)
                    toastSuccess('Sauvegardé')
                    resolve(data)
                })
                .catch(error => {
                    console.error(error)
                    toastError('Erreur lors de la sauvegarde..')
                    reject(error)
                })
        }, 300)
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
    // find spot
    let spot = findSpot(marker.options.type, marker.options.index)

    try {
        console.log('dragend', marker.options.type, marker.options.index, parcours)
        parcours[marker.options.type][marker.options.index].lat = spot.getCenterPosition().lat
        parcours[marker.options.type][marker.options.index].lon = spot.getCenterPosition().lng
        parcours[marker.options.type][marker.options.index].radius = spot.getRadius()

        save()

        // select the marker
        selectSpot(marker.options.type, marker.options.index)
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
            <button class='btn btn-sm btn-info' onclick='addZone(" + e.latlng.lat + "," + e.latlng.lng + "); popupNewStep.remove();'>Objet</button> \
        ")
        .openOn(map);
}
map.on('dblclick', onMapDblClick);


// Add step
function addStep(lat, lon) {
    const step = {
        lat: lat,
        lon: lon,
        radius: 10,
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

function loadMediaList() {
    return get('/mediaList/'+ parcoursID)
        .then(data => { MEDIALIST = data })
        .catch(error => {
            console.error(error)
            toastError('Erreur lors du chargement des médias..')
        })
}


// INIT
//

// first get media list json tree
var MEDIALIST = null
loadMediaList()
    .then(load)
    .then(loadMap)

