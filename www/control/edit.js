const PARCOURS = document.PARCOURS

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

// FILL Spots
//
function fillZones(type, divID, mediaFolder) {
    $(divID).html('')
    if (type in PARCOURS.spots) 
        for (let i = 0; i < PARCOURS.spots[type].length; i++) {
            const z = PARCOURS.spots[type][i]
            const zone = z._spot

            // Default mode (Objet)
            let modeClass = 'bg-info'
            if (zone.mode == 'Ambiance') modeClass = 'bg-ambiant'
            if (zone.mode == 'Offlimit') modeClass = 'bg-danger'

            // li element
            const li = $('<li class="list-group-item spots-edit zones-edit">')
                            .appendTo(divID)
                            .click(() => z.select().center())
            
            
            // header div : title + buttons
            const header = $('<div>').addClass('edit-header').appendTo(li)
            header.append($('<span>').addClass('badge me-3').addClass(modeClass).text(i))
            header.append($('<span>').addClass('edit-media me-1').text(zone.media.src))
        
            // body: audio select 
            const body = $('<div>').addClass('edit-body').appendTo(li)
            body.append($('<span>').addClass('badge me-1').addClass(modeClass).text(i))
            const select = $('<select>').addClass('form-select').appendTo(body)
                .append($('<option>').attr('value', '').text('-').val(''))
                .append($('<option>').attr('value', '*').text(':: upload ::').val('*'))
                .change(() => {
                    
                    // upload media
                    if (select.val() == '*') {
                        const input = $('<input class="ms-5">').attr('type', 'file').attr('accept', 'audio/*').appendTo(body)
                        input.change(() => {
                            const file = input[0].files[0]
                            if (!file) {input.remove(); return}
                            const formData = new FormData()
                            formData.append('file', file)
                            console.log('uploading', file)
                            postFile('/mediaUpload/' + parcoursID + '/' + mediaFolder, formData)
                                .then(() => {
                                    zone.media.src = file.name
                                    save().then(() => PARCOURS.select(type, i))
                                })
                                .catch(error => console.error(error) && toastError('Erreur lors de l\'upload du fichier..'))
                                .finally(() => input.remove())
                        })
                        input.click()
                    }
                    // select existing media
                    else {
                        zone.media.src = select.val() 
                        save().then(() => PARCOURS.select(type, i))
                    }
                    
                })

            // audio play/stop button
            const play = $('<button>').addClass('btn btn-sm btn-secondary btn-sm p-1 me-1').html('<i class="bi bi-play btn-play"></i>').click(() => z.player.toggle() )
            z.player.on('play', () => play.html('<i class="bi bi-pause btn-play"></i>'))
            z.player.on('pause', () => play.html('<i class="bi bi-play btn-play"></i>'))
            z.player.on('stop', () => play.html('<i class="bi bi-play btn-play"></i>'))
            z.player.on('end', () => play.html('<i class="bi bi-play btn-play"></i>'))
            body.append(play)

            // buttons
            body.append($('<button>').addClass('btn btn-sm btn-danger btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                if (confirm('Supprimer ' + z.name() + ' ?')) PARCOURS.deleteSpot(type, i) && save()
            }))
            body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-up"></i>').click(() => {
                PARCOURS.moveSpot(type, i, i - 1) && save().then(()=> PARCOURS.select(type, i - 1))
            }))
            body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-down"></i>').click(() => {
                PARCOURS.moveSpot(type, i, i + 1) && save().then(()=> PARCOURS.select(type, i + 1))
            }))
                
            // volume integer input
            body.append($('<input class="input-volume float-end me-1 ">').attr('type', 'number').attr('min', 0).attr('max', 100).attr('step', 1).val(zone.media.master*100).change(() => {
                zone.media.master = body.find('input').val()/100.0 
                save().then(() => PARCOURS.select(type, i))
            }))

            // button switch to Circle/Polygon
            body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-circle"></i>').click(() => z.convertToCircle()))
            body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-pentagon"></i>').click(() => z.convertToPolygon()))
            
            // fill select with media list from folder 
            if (MEDIALIST && MEDIALIST[mediaFolder]) {
                MEDIALIST[mediaFolder].forEach(media => {
                    const option = $('<option>').attr('value', media).text(media).val(media)
                    if (media == zone.media.src) option.attr('selected', 'selected')
                    select.append(option)
                })
            }

            // Objet / Ambiance mode toggle
            if (type == 'zones') {
                const formCheck = $('<div class="form-check form-switch">').appendTo(body)
                const input = $('<input class="form-check-input" type="checkbox" role="switch">').attr('id', 'flexSwitchCheck' + i).prop('checked', zone.mode == 'Ambiance').appendTo(formCheck)
                input.change(() => {
                    zone.mode = input.prop('checked') ? 'Ambiance' : 'Objet' 
                    save().then(() => PARCOURS.select(type, i)) 
                })
                formCheck.append($('<label class="form-check-label" for="flexSwitchCheck' + i + '">').text( zone.mode == 'Ambiance' ? 'Ambiance' : 'Objet Ponctuel' ))
            }

            // on select
            // z.on('selected', () => li.addClass('active') && z.player ? z.player.resume() : null)
            z.on('selected', () => li.addClass('active'))
            z.on('unselected', () => li.removeClass('active') && z.player ? z.player.stop() : null)
        }
} 

// LOAD
//
// Get parcours json
function load() {
    return PARCOURS.load(parcoursID)
            .then(() => {

                // Set info
                document.getElementById('pName').value   = PARCOURS.info.name
                document.getElementById('pStatus').value = PARCOURS.info.status
                document.getElementById('pCoords').value = PARCOURS.info.coords
                document.getElementById('pCoordsLink').href = 'https://www.openstreetmap.org/#map=' + PARCOURS.info.coords 

                // Editable all
                PARCOURS.editable()
                PARCOURS.loadAudio()

                // Fill steps list
                document.getElementById('pSteps').innerHTML = ""
                if ('steps' in PARCOURS.spots) 
                    for (let i = 0; i < PARCOURS.spots.steps.length; i++) {
                        const s = PARCOURS.spots.steps[i]
                        const step = s._spot

                        const li = $('<li class="list-group-item spots-edit steps-edit">')
                        li.appendTo('#pSteps')
                        
                        // header div : title + buttons
                        const header = $('<div>').addClass('edit-header').appendTo(li)
                        header.append($('<span>').addClass('badge bg-warning me-3').text(i))
                        header.append($('<span>').addClass('edit-media me-1').text(step.folder))

                        // body: audio name edit
                        const body = $('<div>').addClass('edit-body').appendTo(li)
                        body.append($('<span>').addClass('badge bg-warning me-1').text(i))

                        const editname = $('<input>').addClass('form-control').val(step.name).appendTo(body)
                        .change(() => {
                            step.name = editname.val()
                            save().then(() => PARCOURS.select('steps', i))
                        })

                        const media = $('<div>').addClass('edit-media-list mt-2').appendTo(body)
                        const mediaList = step.media ? Object.keys(step.media) : []

                        // buttons
                        body.append($('<button>').addClass('btn btn-sm btn-warning btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                            if (confirm('Supprimer ' + s.name() + ' ?')) PARCOURS.deleteSpot('steps', i) && save()
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-up"></i>').click(() => {
                            PARCOURS.moveSpot('steps', i, i - 1) && save().then(()=> PARCOURS.select('steps', i - 1))
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-info btn-sm float-end p-1 me-1').html('<i class="bi bi-arrow-down"></i>').click(() => {
                            PARCOURS.moveSpot('steps', i, i + 1) && save().then(()=> PARCOURS.select('steps', i + 1))
                        }))

                        // +/- buttons increment/ decrement each master
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-plus"></i>').click(() => {
                            if (step.media && mediaList.some(m => step.media[m].master >= 1)) return
                            mediaList.forEach(m => s.player[m].masterInc(0.01)) && save().then(() => PARCOURS.select('steps', i))
                        }))
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-dash"></i>').click(() => {
                            if (step.media && mediaList.some(m => step.media[m].master <= 0)) return
                            mediaList.forEach(m => s.player[m].masterDec(0.01)) && save().then(() => PARCOURS.select('steps', i))
                        }))

                        // button switch to Circle/Polygon
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-circle"></i>').click(() => s.convertToCircle()))
                        body.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1').html('<i class="bi bi-pentagon"></i>').click(() => s.convertToPolygon()))

                        // Optional toggle
                        const formCheck = $('<div class="form-check form-switch">').appendTo(body)
                        const input = $('<input class="form-check-input" type="checkbox" role="switch">').attr('id', 'flexSwitchCheck' + i).prop('checked', !step.optional).appendTo(formCheck)
                                        .change(() => {
                                            step.optional = !input.prop('checked')
                                            save().then(() => PARCOURS.select('steps', i))
                                        })
                        formCheck.append($('<label class="form-check-label" for="flexSwitchCheck' + i + '">').text('Obligatoire'))

                        // media list
                        mediaList.forEach(m => {
                            const div = $('<div>').addClass('edit-media mt-2').appendTo(media)

                            // upload button
                            div.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-start p-1 me-1').html('<i class="bi bi-upload"></i>').click(() => {
                                // remove previous input
                                div.find('input').remove()
                                const input = $('<input class="ms-5">').attr('type', 'file').attr('accept', 'audio/*').appendTo(div)
                                input.change(() => {
                                    const file = input[0].files[0]
                                    if (!file) {input.remove(); return}
                                    const formData = new FormData()
                                    formData.append('file', file)
                                    console.log('uploading', file)
                                    postFile('/mediaUpload/' + parcoursID + '/' + step.folder, formData )
                                        .then(() => {
                                            step.media[m].src = file.name 
                                            save().then(() => PARCOURS.select('steps', i))
                                        })
                                        .catch(error => console.error(error) && toastError('Erreur lors de l\'upload du fichier..'))
                                        .finally(() => input.remove())
                                })
                                input.click()
                            }))

                            // badge with media type fixed width
                            div.append($('<span>').addClass('badge bg-warning me-1').text(m).css('width', '63px'))
                            
                            // media button
                            if (step.media && step.media[m].src != '-') 
                            {
                                // media name
                                div.append($('<span>').addClass('edit-media me-1').text(step.media[m].src.substring(0, 25)))
                                div.append($('<button>').addClass('btn btn-sm btn-warning btn-sm float-end p-1 me-1').html('<i class="bi bi-trash"></i>').click(() => {
                                    if (confirm('Supprimer ' + step.folder + '/' +step.media[m].src + ' ?')) {
                                        get('/mediaRemove/' + parcoursID + '/' + step.folder + '/' + step.media[m].src)
                                        step.media[m].src = '-'
                                        step.media[m].master = 1
                                        save().then(() => PARCOURS.select('steps', i))
                                    }
                                }))

                                // play/pause button
                                div.append($('<button>').addClass('btn btn-sm btn-secondary btn-sm float-end p-1 me-1 btn-preview').html('<i class="bi bi-play"></i>')
                                                    .click(() => s.player[m].toggle() ))
                                s.player[m].on('play', () => div.find('.btn-preview').html('<i class="bi bi-pause"></i>'))
                                s.player[m].on('pause', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                s.player[m].on('stop', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                s.player[m].on('end', () => div.find('.btn-preview').html('<i class="bi bi-play"></i>'))
                                
                                
                                // volume integer input
                                div.append($('<input class="input-volume float-end me-1 ">').attr('type', 'number').attr('min', 0).attr('max', 100).attr('step', 1)
                                    .val( Math.round(step.media[m].master*100) )
                                    .change(() => {
                                        s.player[m].master(div.find('.input-volume').val()/100.0)
                                        save().then(() => PARCOURS.select('steps', i))
                                    }))
                                s.player[m].on('master', (vol) => div.find('.input-volume').val(Math.round(vol*100)))
                            }

                        })

                        // Spot select
                        li.click(() => s.select().center())

                        // on select
                        s.on('selected', () => {
                            // if (!li.hasClass('active')) s.player.play()
                            li.addClass('active')
                        })
                        s.on('unselected', () => {
                            li.removeClass('active')
                            s.player.stop()
                        })
                    }

                // Fill zones (Objets / Ambiances) list
                fillZones('zones', '#pZones', 'Objets')

                // Fill offlimits list
                fillZones('offlimits', '#pZonesOFF', 'Offlimits')

            })
}

$('body').on('click', (e) => {
    if ($(e.target).hasClass('base-layer')) PARCOURS.unselectAll()
})

// SAVE
//
var scheduledSave = null
function save(reload = true) {

    return new Promise((resolve, reject) => {
        if (scheduledSave) {
            clearTimeout(scheduledSave)
            scheduledSave = null
        }
        scheduledSave = setTimeout(() => {

            PARCOURS.save().then(() => {
                toastSuccess('Sauvegardé')
                if (reload) loadMediaList().then(load).then(resolve)
                else resolve()
            })
            .catch(error => {
                console.error(error)
                toastError('Erreur lors de la sauvegarde..')
                load()
                reject(error)
            })
            
        // }, 300)
        }, 0)
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

    PARCOURS.info.name = name
    save()
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

    PARCOURS.info.coords = coords
    save().then(loadMap)
})

// Load Map 
var MAP = initMap('map')

// Drag marker
MAP.on('editable:vertex:dragend', function (e) {
    let marker = e.layer; // marker that was dragged
    // find spot
    let spot = PARCOURS.find(marker.options.type, marker.options.index)

    try {
        // console.log('dragend', marker.options.type, marker.options.index)
        var s = PARCOURS.find(marker.options.type, marker.options.index)._spot

        s.lat = spot.getCenterPosition()[0]
        s.lon = spot.getCenterPosition()[1]
        s.radius = spot.getRadius()

        save(false)

        // select the marker
        PARCOURS.select(marker.options.type, marker.options.index)
    }
    catch (error) {
        console.error(error)
        toastError('Erreur lors du déplacement du marker..')
        load()
    }
});



MAP.on('mouseup',function(e){ MAP.removeEventListener('mousemove'); }) // hack to enable cicrle drag

function loadMap() {
    const coords = document.getElementById('pCoords').value
    if (coords) {
        const [zoom, lat, lon] = coords.split('/')
        MAP.setView([lat, lon], zoom)
        // markerStart.setLatLng([lat, lon])
    }
}

// set coords (from map to pCoords)
$('#setCoords').click(() => {
    const coords = MAP.getZoom() + '/' + MAP.getCenter().lat + '/' + MAP.getCenter().lng
    document.getElementById('pCoords').value = coords
    PARCOURS.info.coords = coords
    save()
})

// Add spot 
function addSpot(lat, lon, type) {
    let basespot = { lat: lat, lon: lon, radius: 10}
    if (type == 'steps') basespot.optional = true
    PARCOURS.addSpot(type, basespot)
    save()
}

// Double click on map to add a marker
var popupNewStep = L.popup();
function onMapDblClick(e) {
    popupNewStep
        .setLatLng(e.latlng)
        .setContent("\
            <button class='btn btn-sm btn-warning' onclick='addSpot(" + e.latlng.lat + "," + e.latlng.lng + ", \"steps\"); popupNewStep.remove();'>Etape</button> \
            <button class='btn btn-sm btn-info' onclick='addSpot(" + e.latlng.lat + "," + e.latlng.lng + ", \"zones\"); popupNewStep.remove();'>Objet</button> \
            <button class='btn btn-sm btn-danger' onclick='addSpot(" + e.latlng.lat + "," + e.latlng.lng + ", \"offlimits\"); popupNewStep.remove();'>Interruptions</button> \
        ")
        .openOn(MAP);
}
MAP.on('dblclick', onMapDblClick);

// Goto point
function gotoPoint(lat, lon) {
    MAP.setView([lat, lon], 18)
}

function loadMediaList() {
    return get('/mediaList/'+ parcoursID)
        .then(data => { MEDIALIST = data; console.log('Media list loaded', data) })
        .catch(error => {
            console.error(error)
            toastError('Erreur lors du chargement des médias..')
        })
}


// INIT
//
PARCOURS.setMap(MAP)

// first get media list json tree
var MEDIALIST = null
loadMediaList()
    .then(load)
    .then(loadMap)

