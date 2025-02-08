// Load Map 
var MAP = null

function initMap(id, options = {}) {

    let _options = {
        editable: true,
        center: [43, 1],
        zoom: 16, 
        maxZoom: 19,
        minZoom: 5,
        ...options
    }
    
    console.log('initMap', id, _options)

    MAP = L.map(id, _options)
    MAP.doubleClickZoom.disable(); // disable double click zoom
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(MAP)
    
    MAP.setView(_options.center, _options.zoom)

    return MAP
}

