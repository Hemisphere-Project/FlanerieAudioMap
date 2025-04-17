// Load Map 
document.MAP = null

// Dirty Fix multi scroll
// const pauseClass = (ele: HTMLElement, className: string, unpause = false) => {
//     const from = className.concat(unpause ? "-pause" : "")
//     const to = className.concat(unpause ? "" : "-pause")
//     Array.from(ele.getElementsByClassName(from)).forEach((ele) => ele.classList.replace(from, to))
// }

// const stopZoomAnimation = () => {
//     let paused = false
//     let timeoutId: ReturnType<typeof setTimeout>
//     const animationClass = "leaflet-zoom-animated"
//     return function (e: WheelEvent) {
//         // pause animation if it isn't already paused
//         if (!paused) {
//             pauseClass(e.target as HTMLElement, animationClass)
//             paused = true
//             console.log("pausing zoom animations");
//         }
//         // unpause after 500ms
//         clearTimeout(timeoutId);
//         timeoutId = setTimeout(() => {
//             pauseClass(e.target as HTMLElement, animationClass, true)
//             console.log("zoom animations enabled");
//             paused = false
//         }, 500);
//     };
// }

function initMap(id, options = {}) {

    var GEO = document.GEO
    var PARCOURS = document.PARCOURS

    var _options = {
        editable: true,
        center: [43, 1],
        zoom: 16, 
        maxZoom: 21,
        minZoom: 5,
        zoomDelta: 1,
        wheelPxPerZoomLevel: 240,
        wheelDebounceTime: 100,
        scrollWheelZoom: false,
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

    document.MAP.on('zoomend', function() {
        // console.log('zoomend', document.MAP.getZoom())
    });

    // Mouse wheel custom handler
    this.zoomTimeout = null;
    this.zoomPaused = false;
    document.MAP.getContainer().addEventListener('wheel', (e) => {
        if (this.zoomPaused) {
            console.log('zoom paused');
            return;
        }
        if (e.deltaY < 0) {
            console.log('zoom in', e.deltaY);
            document.MAP.zoomIn();
        } else {
            console.log('zoom out', e.deltaY);
            document.MAP.zoomOut();
        }
        this.zoomPaused = true;
        this.zoomTimeout = setTimeout(() => {
            if (this.zoomPaused) {
                this.zoomPaused = false;
                console.log('zoom unpaused');
            }    
        }, 350); // Adjust debounce as needed
    });

    // document.MAP.getContainer().onwheel = stopZoomAnimation()

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

