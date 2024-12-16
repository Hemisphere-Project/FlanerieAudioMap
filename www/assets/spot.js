var ALLSPOTS = []

function registerSpot(spot) {
    ALLSPOTS.push(spot)
}

function clearSpots() {
    ALLSPOTS.map(s => s.clear())
    ALLSPOTS = []
}

function findSpot(type, index) {
    return ALLSPOTS.find(s => s.marker().options.type === type && s.marker().options.index === index)
}

function unselectSpots(except = null) {
    ALLSPOTS.map(s => {
        if (s !== except) s.unselect()
    })
}

function selectSpot(type, index, exclusive = true)
{
    // select the one
    let spot = findSpot(type, index)
    
    // unsellect all
    if (exclusive) unselectSpots(spot)
        
    if (!spot) return 
    spot.select()
}

function removeSpot(type, index)
{
    let spot = findSpot(type, index)
    if (spot) spot.clear()

    ALLSPOTS = ALLSPOTS.filter(s => s !== spot)
    
    // reindex (rename) higher indexes
    ALLSPOTS.filter(s => s.marker().options.type === type && s._index > index)
        .map(s => s.index(s._index-1))

}



// Generic class Spot, implementing Events
class Spot extends EventEmitter
{
    constructor(spot, map, index, type, color = 'blue')
    {
        super()
        this._spot = spot
        this._map = map
        this._index = index
        this._type = type
        this._color = color

        this.player = null

        // Marker
        this.createMarker()

        // Register
        registerSpot(this)

    }

    createMarker() {

        // Leaflet Circle
        if (typeof this._spot.radius === 'number') {
            this._marker = L.circle([this._spot.lat, this._spot.lon],
                {
                    color: this._color,
                    fillColor: this._color,
                    fillOpacity: 0.3,
                    radius: this._spot.radius,
                    type: this._type,
                    index: this._index,
                    selected: false,
                })
                .addTo(map)
        }

        // Leaflet Polygon.
        else {
            this._marker = L.polygon(this._spot.radius,
                {
                    color: this._color,
                    fillColor: this._color,
                    fillOpacity: 0.3,
                    type: this._type,
                    index: this._index,
                    selected: false,
                })
                .addTo(map)
        }

        // Editable
        if (this._editable) this.editable()
    }

    marker() {
        return this._marker
    }

    inside(position) {
        if (typeof this._spot.radius === 'number') {
            return this._marker.getLatLng().distanceTo([position.coords.latitude, position.coords.longitude]) < this._spot.radius
        }
        else 
        {
            // Ray-casting algorithm
            let x = position.coords.latitude
            let y = position.coords.longitude
            let inside = false

            for (let i = 0, j = this._spot.radius.length - 1; i < this._spot.radius.length; j = i++) {
                let xi = this._spot.radius[i][0], yi = this._spot.radius[i][1]
                let xj = this._spot.radius[j][0], yj = this._spot.radius[j][1]

                let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
                if (intersect) inside = !inside
            }
            
            return inside
        }
    }

    getCenterPosition() {
        if (typeof this._spot.radius === 'number')
            return this._marker.getLatLng()
        else
            return this._marker.getBounds().getCenter()
    }

    getRadius() {
        if (typeof this._spot.radius === 'number')
            return this._marker.getRadius()
        else
            return this._marker.getLatLngs()[0].map(c => [c.lat, c.lng])
    }

    convertToPolygon() {
        if (typeof this._spot.radius !== 'number') return
        
        let radius = this._spot.radius / 111111

        this._spot.radius = [
            [this._spot.lat + radius/1.4, this._spot.lon + radius],
            [this._spot.lat + radius/1.4, this._spot.lon - radius],
            [this._spot.lat - radius/1.4, this._spot.lon - radius],
            [this._spot.lat - radius/1.4, this._spot.lon + radius],
        ]

        this._map.removeLayer(this._marker)
        this.createMarker()
    }

    convertToCircle() {
        if (typeof this._spot.radius === 'number') return
        
        // Max distance between center and corners
        let radius = Math.max(...this._spot.radius.map(c => 
            this.distanceToCenter({coords: {latitude: c[0], longitude: c[1]}})
        ))

        this._spot.radius = radius

        this._map.removeLayer(this._marker)
        this.createMarker()
    }

    index(i) {
        if (i !== undefined) {
            this._index = i
            this._marker.options.index = i
        }
        return this
    }

    name(name) {
        if (name !== undefined) this._spot.name = name
        return this._spot.name
    }

    distanceToCenter(pos) {
        if (typeof this._spot.radius === 'number')
            return this._marker.getLatLng().distanceTo([pos.coords.latitude, pos.coords.longitude])
        else
            return geo_distance(pos, this.getCenterPosition())
    }

    distanceToBorder(pos) {
        if (typeof this._spot.radius === 'number') {
            return this.distanceToCenter(pos) - this._spot.radius
        }
        else {
            // For each segment of the polygon, calcultate the distance to the segment, keep the minimum
            let min = 1000
            for (let i = 0; i < this._spot.radius.length; i++) {
                let j = (i+1) % this._spot.radius.length
                let d = geo_distance_to_segment(pos, this._spot.radius[i], this._spot.radius[j])
                if (d < min) min = d
            }
            // return geo_distance_to_segment(pos, this._spot.radius[0], this._spot.radius[1])
            if (this.inside(pos)) min = -min
            return min
        }
    }


    editable() {
        this._editable = true
        this._marker.enableEdit()
        this._marker.on('click', () => {
            // this.emit('click')
            this.select()
        })
        return this
    }

    center() {
        map.setView([this._spot.lat, this._spot.lon], 19)
        return this
    }

    clear() {
        this._map.removeLayer(this._marker)
        if (this.player) this.player.clear()
        this.player = null
    }
    
    select(exclusive = true) {
        if (exclusive) unselectSpots(this)
        
        this._marker.options.selected = true
        L.DomUtil.addClass(this._marker._path, 'selected');

        this.emit('selected')
        return this
    }

    unselect() {
        if (this._marker.options.selected) 
        {
            L.DomUtil.removeClass(this._marker._path, 'selected');
            this._marker.options.selected = false
            this.emit('unselected')
        }
        return this
    }

    loadAudio() {
        // to be implemented by children
    }

    updatePosition(pos) 
    {
        // Near: load if not loaded
        if (this.player && !this.player.isLoaded() && this.distanceToBorder(pos) < 10) this.loadAudio()

        // to be implemented by children
    }

}


class Zone extends Spot
{
    constructor(zone, map, index) 
    {
        // Call parent constructor
        super(zone, map, index, 'zones', '#17a2b8' )

        if (!this._spot.folder) 
            this._spot.folder = 'Objets'

        if (!this._spot.name) 
            this._spot.name = 'Objet '+index

        if (!this._spot.media) 
            this._spot.media = {src: '-', master: 1}

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.media.src)

        // player
        this.player = new PlayerSimple(true, 0)
    }
    

    index(i) {
        if (i !== undefined) {
            super.index(i)
            this._spot.name = 'Objet '+i
        }
        return this._index
    }

    loadAudio() {
        this.player.load('/media/'+ parcoursID +'/' + this._spot.folder + '/', this._spot.media)        
    }

    updatePosition(position) 
    {
        super.updatePosition(position)

        // Inside: play with volume crossfade
        if (this.inside(position)) {
            let vol = 1 - this.distanceToCenter(position) / this._spot.radius
            this.player.volume(vol)
            this.player.resume(vol)
        }
        else this.player.pause()
    }
}    


var allSteps = []

class Step extends Spot
{
    constructor(step, map, index) 
    {
        // Call parent constructor
        super(step, map, index, 'steps', 'red' )       

        if (!this._spot.folder) 
            this._spot.folder = ''

        if (!this._spot.name) 
            this._spot.name = 'Etape '+index

        if (!this._spot.media) 
            this._spot.media = {
                voice: {src: '-', master: 1},
                music: {src: '-', master: 1},
                ambiant: {src: '-', master: 1},
                offlimit: {src: '-', master: 1},
            }

        // player
        this.player = new PlayerStep()

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.name)
    }

    index(i) {
        if (i !== undefined) {
            super.index(i)
            if (this._spot.name.startsWith('Etape'))
                this._spot.name = 'Etape '+i
        }
        return this._index
    }

    loadAudio() {
        // Add to allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
        allSteps.push(this)

        // Players
        this.player.load( '/media/' + parcoursID + '/' + this._spot.folder + '/', this._spot.media ) 
    }

    updatePosition(position) 
    {
        super.updatePosition(position)

        // If inside
        if (this.inside(position) && !this.player.isPlaying()) 
        {
            // Stop all other steps
            allSteps.filter(s => s._index !== this._index).map( s => s.player.stop() )
            
            // Play
            this.player.play()
        }

        // If too far
        if (this.player.isPlaying() && this.distanceToBorder(position) > 20) 
        {
            this.player.crossLimit(true)
        }

        // If back inside
        if (this.player.isOfflimit() && this.distanceToBorder(position) < 20)
        {
            this.player.crossLimit(false)
        }
    }

    clear() {
        super.clear()
        
        // Remove from allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
    }
}