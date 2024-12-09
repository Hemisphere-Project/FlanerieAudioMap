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

        // player
        this.sound = null

        // Leaflet Tooltip
        this._marker.bindTooltip(this._spot.media)
    }

    loadAudio() {
        if (this.sound !== null) return

        // Howler Player
        this.sound = new Howl({
            src: '/media/' + this._spot.media,
            loop: true,
            autoplay: false,
            volume: 0
        })
        this.sound.on('end', () => {
            console.log('Finished playing ' + this.sound._src)
        })
        this.sound.on('play', () => {
            console.log('Playing ' + this.sound._src)
        })
        this.sound.on('load', () => {
            console.log('Loaded ' + this.sound._src)
        })
    }

    updatePosition(position) {
        if (this.sound === null) return

        if (this.inside(position)) {
            let vol = 1 - this.distance(position) / this._spot.radius
            this.sound.volume(vol)
            if (!this.isPlaying()) this.play()
        }
        else if (this.isPlaying()) 
            this.pause()
    }

    clear() {
        super.clear()
        if (this.sound) this.sound.stop()
    }

    isPlaying() {
        return this.sound !== null && this.sound.playing()
    }

    stop() {
        if (this.sound !== null) this.sound.stop()
    }

    play() {
        if (this.sound !== null) this.sound.play()
    }

    pause() {
        if (this.sound !== null) this.sound.pause()
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
        this.sound = null

        // Leaflet Tooltip
        this._marker.bindTooltip("Etape " + index)
    }

    loadAudio() {
        if (this.sound !== null) return

        // Add to allSteps
        allSteps.push(this)

        // Players
        this.sound = {
            voice: new Howl({
                src: '/media/' + this._spot.media.voice,
                loop: false,
                autoplay: false,
                volume: 1
            }),
            music: new Howl({
                src: '/media/' + this._spot.media.music,
                loop: false,
                autoplay: false,
                volume: 1
            }),
            ambiant: new Howl({
                src: '/media/' + this._spot.media.ambiant,
                loop: true,
                autoplay: false,
                volume: 1
            })
        }

        // Events
        for (let key in this.sound) {
            this.sound[key].on('end', () => {
                console.log('Finished playing ' + this.sound[key]._src)
            })
            this.sound[key].on('play', () => {
                console.log('Playing ' + this.sound[key]._src)
            })
            this.sound[key].on('load', () => {
                console.log('Loaded ' + this.sound[key]._src)
            })
        }
    }

    updatePosition(position) {
        if (this.sound === null) return

        // If inside
        if (this.inside(position) && !this.isPlaying()) {
            
            // Stop all other steps
            allSteps.map(s => {
                if (s !== this && s.isPlaying(true)) s.stop()
            })
            
            // Play
            this.play()
        }
    }

    clear() {
        super.clear()
        if (this.sound) this.sound.stop()
        
        // Remove from allSteps
        allSteps = allSteps.filter(s => s._index !== this._index)
    }

    isPlaying(full=false) {
        return this.sound !== null &&
            (this.sound.voice.playing() || this.sound.music.playing()) ||
            (full && this.sound.ambiant.playing())
    }

    stop() {
        if (this.sound !== null) {
            this.sound.voice.stop()
            this.sound.music.stop()
            this.sound.ambiant.stop()
        }
    }

    play() {
        if (this.sound !== null) {
            this.sound.ambiant.play()
            this.sound.voice.play()
            this.sound.music.play()
        }
    }
}