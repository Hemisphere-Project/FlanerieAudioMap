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

function unselectSpots() {
    ALLSPOTS.map(s => s.unselect())
}

function selectSpot(type, index, exclusive = true)
{
    // unsellect all
    if (exclusive) unselectSpots()
    
    // select the one
    let spot = findSpot(type, index)
    if (!spot) return 

    spot.select()
}



// Generic class Spot, implementing Events
class Spot extends EventEmitter
{
    constructor(spot, map, index, color, type)
    {
        super()
        this._spot = spot
        this._map = map
        this._index = index
        this._player = null

        // Leaflet Circle
        this._marker = L.circle([spot.lat, spot.lon],
            {
                color: color,
                fillColor: color,
                fillOpacity: 0.3,
                radius: spot.radius,
                type: type,
                index: index,
                selected: false,
            })
            .addTo(map)

        // Register
        registerSpot(this)

    }

    marker() {
        return this._marker
    }

    distance(pos) {
        return geo_distance(pos, {coords: {latitude: this._spot.lat, longitude: this._spot.lon}})
    }

    inside(pos) {
        return this.distance(pos) < this._spot.radius
    }

    editable() {
        this._marker.enableEdit()
        this._marker.on('click', () => this.select())
        return this
    }

    center() {
        map.setView([this._spot.lat, this._spot.lon], 19)
        return this
    }

    clear() {
        this._map.removeLayer(this._marker)
    }
    
    select(exclusive = true) {
        if (exclusive) unselectSpots()
        
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

    updatePosition(pos) {
        // to be implemented by children
    }
    


}


class Zone extends Spot
{
    constructor(zone, map, index) 
    {
        // Call parent constructor
        super(zone, map, index, '#17a2b8', 'zones')

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.media)

        // player
        this.player = new PlayerSimple(true)
    }

    loadAudio() {
        this.player.load('/media/Objets/' + this._spot.media)        
    }

    updatePosition(position) {
        if (this.inside(position)) {
            let vol = 1 - this.distance(position) / this._spot.radius
            this.player.volume(vol)
            this.player.resume()
        }
        else this.player.pause()
    }

    clear() {
        super.clear()
        this.player.stop()
    }
}    


var allSteps = []

class Step extends Spot
{
    constructor(step, map, index) 
    {
        // Call parent constructor
        super(step, map, index, 'red', 'steps')

        if (!this._spot.folder) 
            this._spot.folder = 'Etape '+index
        
        // player
        this.player = new PlayerTri()

        // Leaflet Tooltip
        this._marker.bindTooltip("Etape " + index)
    }

    loadAudio() {
        // Add to allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
        allSteps.push(this)

        // Players
        this.player.load({
            voice: '/media/' + this._spot.folder + '/VOICE.mp3',
            music: '/media/' + this._spot.folder + '/MUSIC.mp3',
            ambiant: '/media/' + this._spot.folder + '/AMBIANT.mp3',
            offlimit: '/media/' + this._spot.folder + '/OFF.mp3',
        })
    }

    updatePosition(position) {
        if (this.sound === null) return

        // If inside
        if (this.inside(position) && !this.player.isPlaying()) 
        {
            // Stop all other steps
            allSteps.filter(s => s._index !== this._index).map( s => s.player.stop() )
            
            // Play
            this.player.play()
        }

        // If too far
        if (this.player.isPlaying() && this.distance(position) > this._spot.radius*3) 
        {
            this.player.crossLimit(true)
        }

        // If back inside
        if (this.player.didPlay() && this.distance(position) < this._spot.radius*3)
        {
            this.player.crossLimit(false)
        }
    }

    clear() {
        super.clear()
        this.player.clear()
        
        // Remove from allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
    }
}