// Load Map 
document.MAP = null

function initMap(id, options = {}) {

    var GEO = document.GEO
    var PARCOURS = document.PARCOURS

    var _options = {
        editable: true,
        center: [43, 1],
        zoom: 16, 
        maxZoom: 19,
        minZoom: 5,
        ...options
    }

    this.markerPosition = null
    
    console.log('initMap', id, _options)

    if (document.MAP) {
        console.warn('Remove previous map')
        document.MAP.off();
        document.MAP.remove();
    }
    document.MAP = L.map(id, _options)
    document.MAP.doubleClickZoom.disable(); // disable double click zoom
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 21}).addTo(document.MAP)
    
    document.MAP.setView(_options.center, _options.zoom)

    // maxZoom
    document.MAP.maxZoom = () => _options.maxZoom

    // show position
    document.MAP.showPositionMarker = () => {
        if (this.markerPosition) return
        this.markerPosition = L.marker(geo_coords(GEO.position()), {
            icon: L.divIcon({
                className: 'position-icon',
                html: '<div class="position-icon"></div>',
            }),
        }).addTo(document.MAP)
    }

    // to position
    document.MAP.toPosition = (quick = false) => {
        var position = GEO.position()
        if (!position) return
        if (quick) {
            document.MAP.setView(geo_coords(position), document.MAP.getZoom())
        } else {
            document.MAP.flyTo(geo_coords(position), document.MAP.getZoom())
        }
    }

    if (PARCOURS) PARCOURS.setMap(document.MAP)

    if (GEO) {
        GEO.setMap(document.MAP)
        GEO.on('position', position => {
            if (this.markerPosition) this.markerPosition.setLatLng(geo_coords(position))
        })
    }
    return document.MAP
}

