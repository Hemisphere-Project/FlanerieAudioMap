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
        zoom: 19, 
        maxZoom: 20,
        minZoom: 16,
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

    let BASE = null

    // WEB VERSION:
    if (!document.WEBAPP_URL) {
        BASE = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: _options.maxZoom}).addTo(document.MAP)
    }

    // CORDOVA VERSION:
    else {
        BASE = L.tileLayerCordova('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: _options.maxZoom,
            // these are specific to L.TileLayer.Cordova and mostly specify where to store the tiles on disk
            folder: 'LeafCache',
            name:   'example',
            debug:   true
        }, () => {
            // this is called when the tile layer is ready
            console.log("LEAFLET CORDOVA: Tile layer ready, starting to cache tiles...");
            // cacheLayer(BASE, _options) // Uncomment to cache tiles
        })
    }

    // Add to MAP
    BASE.addTo(document.MAP)

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
            // console.log('zoom paused');
            return;
        }
        if (e.deltaY < 0) {
            // console.log('zoom in', e.deltaY);
            document.MAP.zoomIn();
        } else {
            // console.log('zoom out', e.deltaY);
            document.MAP.zoomOut();
        }
        this.zoomPaused = true;
        this.zoomTimeout = setTimeout(() => {
            if (this.zoomPaused) {
                this.zoomPaused = false;
                // console.log('zoom unpaused');
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

function cacheLayer(layer, options) {
    // Caching
    // calculate a tile pyramid starting at a lat/lon and going down to a stated range of zoom levels
    var tile_list = layer.calculateXYZListFromPyramid(options.center[0], options.center[1], 15, 20);
    layer.downloadXYZList(
        // 1st param: a list of XYZ objects indicating tiles to download
        tile_list,
        // 2nd param: overwrite existing tiles on disk?
        // if no then a tile already on disk will be kept, which can be a big time saver
        false,
        // 3rd param: progress callback
        // receives the number of tiles downloaded and the number of tiles total
        // caller can calculate a percentage, update progress bar, etc.
        // Cancel: if the progress callback returns false (not null or undefined, but false)
        // then layer.downloadXYZList() interprets that as a cancel order and will cease downloading tiles
        // great for a cancel button!
        function (done,total) {
            var percent = Math.round(100 * done / total);
            // status_block.innerHTML = done  + " / " + total + " = " + percent + "%";
            console.log("LEAFLET CACHE:", done + " / " + total + " = " + percent + "%");
        },
        // 4th param: complete callback
        // no parameters are given, but we know we're done!
        function () {
            // for this demo, on success we use another L.TileLayer.Cordova feature and show the disk usage!
            layer.getDiskUsage(function (filecount,bytes) {
                var kilobytes = Math.round( bytes / 1024 );
                // status_block.innerHTML = "Done" + "<br/>" + filecount + " files" + "<br/>" + kilobytes + " kB";
                console.log("LEAFLET CACHE: Done", filecount + " files", kilobytes + " kB");
            });
            // layer.goOffline();
            console.log("LEAFLET CACHE: Offline mode enabled");
        },
        // 5th param: error callback
        // parameter is the error message string
        function (error) {
            // alert("Failed\nError code: " + error.code);
            console.error("LEAFLET CACHE: Failed", error);
        }
    );
}

