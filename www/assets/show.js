// title click -> back to control
document.getElementById('title').addEventListener('click', () => {
    window.location.href = '/';
})

// current file from url
var parcoursID = window.location.pathname.split('/').pop()
var parcours = {}
var markers = []

// LOAD
//
// Get parcours json
function load(pID) {
    if (!pID) pID = parcoursID
    
    return get('/control/p/' + pID + '/json')
        .then(data => {
            console.log(data)          
            
            if (data && 'name' in data) {
                parcours = data

                // Set name
                document.getElementById('title').innerHTML = data.name + ' (' + data.status + ')'

                // Set map position
                if (data.coords) {
                    const [zoom, lat, lon] = data.coords.split('/')
                    map.setView([lat, lon], zoom)  
                }

                // remove all markers from map
                for (let i = 0; i < markers.length; i++) map.removeLayer(markers[i])
                markers = []
                
                // Draw zones
                if (data.zones) 
                {
                    data.zones.forEach( (zone, i) => {
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
                        marker.bindTooltip("Zone " + i);
                        // marker.on('click', () => { selectPoint('zones', i) })
                        markers.push(marker)
                    })
                }

                // Draw steps
                if (data.steps) 
                {
                    data.steps.forEach( (step, i) => {
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
                        marker.bindTooltip("Etape " + i);
                        // marker.on('click', () => { selectPoint('steps', i) })
                        markers.push(marker)
                    })
                }
            }
            else throw new Error('No data')
        })
        .catch(error => {
            console.error(error)
        })
}

// Load Map 
var startPoint = [43.1249, 1.254];
var map = L.map('map', {editable: true}).setView(startPoint, 16)

map.doubleClickZoom.disable(); // disable double click zoom

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
}).addTo(map)


// INIT
//
load()