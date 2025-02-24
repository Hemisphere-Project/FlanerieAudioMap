const LOAD_EXTRARADIUS = 10
var stepIndex = -1


// Generic class Spot, implementing Events
class Spot extends EventEmitter
{
    constructor(spot, map, index, type, color = 'blue', parcoursID)
    {
        super()
        this.pID = parcoursID
        this._spot = spot
        this._map = map
        this._index = index
        this._type = type
        this._color = color
        this._loadRadius = 1
        this._wasInside = false

        this.player = null

        // Marker
        this.createMarker()

        // Register
        document.PARCOURS.add(this)
    }

    createMarker() {

        // Leaflet Circle
        if (typeof this._spot.radius === 'number') {
            this._marker = L.circle([this._spot.lat, this._spot.lon],
                {
                    color: this._color,
                    opacity: 0.7,
                    weight: 1,
                    fillColor: this._color,
                    fillOpacity: 0.35,
                    radius: this._spot.radius,
                    type: this._type,
                    index: this._index,
                    selected: false,
                })
            
            if (this._map) this._marker.addTo(this._map)

            this._loadRadius = this._spot.radius + LOAD_EXTRARADIUS
        }

        // Leaflet Polygon.
        else {
            this._marker = L.polygon(this._spot.radius,
                {
                    color: this._color,
                    opacity: 0.7,
                    weight: 1,
                    fillColor: this._color,
                    fillOpacity: 0.35,
                    type: this._type,
                    index: this._index,
                    selected: false,
                })

            if (this._map) this._marker.addTo(this._map)

            // Compute radius
            this._loadRadius = Math.max(...this._spot.radius.map(c => 
                this.distanceToCenter({coords: {latitude: c[0], longitude: c[1]}})
            ))+LOAD_EXTRARADIUS
        }

        // Load Circle
        // L.circle(this.getCenterPosition(),
        //         {
        //             color: 'yellow',
        //             opacity: 0.3,
        //             fillColor: 'yellow',
        //             fillOpacity: 0,
        //             radius: this._loadRadius,
        //             selected: false,
        //         })
        //         .addTo(map).bringToBack()

    
        // Editable
        if (this._editable) this.editable()
    }

    setMap(map) {
        this._map = map
        this.createMarker()
    }

    marker() {
        return this._marker
    }

    showMarker(color, opacity) {
        if (color) {
            this._color = color
            this._marker.setStyle({color: color, fillColor: color})
        }
        if (opacity) this._marker.setStyle({
            fillOpacity: opacity/2,
            opacity: opacity,
        })

        if (this._map) this._map.removeLayer(this._marker)
        if (this._map) this._map.addLayer(this._marker)
        return this
    }

    hideMarker() {
        if (this._map) this._map.removeLayer(this._marker)
        return this
    }

    near(position) {
        return this.distanceToCenter(position) < this._loadRadius
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
        let p
        if (typeof this._spot.radius === 'number')
            p = this._marker.getLatLng()
        else
            p = this._marker.getBounds().getCenter()
        return geo_coords(p)
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

        if (this._map) this._map.removeLayer(this._marker)
        this.createMarker()
    }

    convertToCircle() {
        if (typeof this._spot.radius === 'number') return
        
        // Max distance between center and corners
        let radius = Math.max(...this._spot.radius.map(c => 
            this.distanceToCenter({coords: {latitude: c[0], longitude: c[1]}})
        ))

        this._spot.radius = radius

        if (this._map) this._map.removeLayer(this._marker)
        this.createMarker()
    }

    index(i) {
        if (i !== undefined) {
            this._index = i
            this._marker.options.index = i
        }
        return this._index
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

    center(quick = true) {
        if (this._map) 
            if (quick) this._map.setView([this._spot.lat, this._spot.lon], this._map.maxZoom())
            else this._map.flyTo([this._spot.lat, this._spot.lon], this._map.maxZoom())
        return this
    }

    clear() {
        if (this._map) this._map.removeLayer(this._marker)
        if (this.player) this.player.clear()
        this.player = null
    }
    
    select(exclusive = true) {
        if (exclusive) document.PARCOURS.unselectAll(this)
        
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
        if (this.player && !this.player.isLoaded() && this.near(pos)) {
            this.loadAudio()
            console.log('Spot load:', this._spot.name, this.player.isLoaded())
        }

        // Enter / Leave event
        let inside = this.inside(pos)
        if (inside && !this._wasInside) {
            this.emit('enter', pos)
            this._wasInside = true
        }
        if (!inside && this._wasInside) {
            this.emit('leave', pos)
            this._wasInside = false
        }

        // to be implemented by children

    }

}


class Zone extends Spot
{
    constructor(zone, map, index, parcoursID)
    {
        // Call parent constructor
        super(zone, map, index, 'zones', zone.mode == 'Ambiance' ? '#5958a7' : '#17a2b8', parcoursID)

        if (!this._spot.folder) 
            this._spot.folder = 'Objets'

        if (!this._spot.name) 
            this._spot.name = 'Objet '+index

        if (!this._spot.media) 
            this._spot.media = {src: '-', master: 1}

        if (!this._spot.mode)
            this._spot.mode = 'Objet'   // Objet / Ambiance

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.media.src)

        // player
        this.player = new PlayerSimple(true, zone.mode == 'Ambiance' ? 1500 : 0)
    }
    

    index(i) {
        if (i !== undefined) {
            super.index(i)
            this._spot.name = 'Objet '+i
        }
        return this._index
    }

    loadAudio() {
        this.player.load('/media/'+ this.pID +'/' + this._spot.folder + '/', this._spot.media)        
    }

    updatePosition(position) 
    {
        super.updatePosition(position)
        if (!this.player.isLoaded()) return

        // Inside
        if (this.inside(position)) {

            // Objet: play with volume crossfade
            if (this._spot.mode === 'Objet') 
            {
                let vol = 1 - this.distanceToCenter(position) / this._spot.radius
                this.player.volume(vol)
                this.player.resume(vol)
            }
            // Ambiance: play
            else this.player.resume()
        }
        else this.player.pauseOut()
    }
}    


var allSteps = []

class Step extends Spot
{
    constructor(step, map, index , parcoursID) 
    {
        // Call parent constructor
        super(step, map, index, 'steps', 'red', parcoursID) 

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
        this.player.on('done', () => { this.emit('done', this) })

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.name)

        // Add to allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
        allSteps.push(this)
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
        // Players
        this.player.load( '/media/' + this.pID + '/' + this._spot.folder + '/', this._spot.media ) 
    }

    updatePosition(position) 
    {
        super.updatePosition(position)

        // Check if we are able to play (Sequential logic)
        //

        // Already played higher steps
        if (this._index < stepIndex) return

        // If inside:
        if (!this.player.isPlaying() && this.near(position) && this.inside(position)) 
        {
            // Check if previous unrealised steps where optional
            if (this._index > stepIndex + 1 && stepIndex + 1 >= 0)
                if (allSteps.filter(s => s._index > stepIndex && s._index < this._index && s._spot.optional !== true).length > 0) return

            // Stop all other steps
            allSteps.filter(s => s._index !== this._index).map( s => {
                let wasPlaying = s.player.isPlaying()
                s.player.stop() 
                if (wasPlaying) s.emit('done', s)
            })
            
            // Play
            this.player.play()

            // Update index
            stepIndex = this._index

            console.log('== ETAPE:', this._index, this._spot.name)

            // fire event
            this.emit('fire', this)
        }

        // Handle Offlimit (if media exists)
        if (stepIndex == this._index && this._spot.media.offlimit.src !== '-') 
        {
            // If too far
            if (this.player.isPlaying() && this.distanceToBorder(position) > 3) 
            {
                this.player.crossLimit(true)
            }
    
            // If back inside
            if (this.player.isOfflimit() && this.distanceToBorder(position) < 3)
            {
                this.player.crossLimit(false)
            }
        }

    }

    clear() {
        super.clear()
        
        // Remove from allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
    }
}