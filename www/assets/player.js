class PlayerSimple extends EventEmitter
{
    constructor(loop = false, fadetime = 1500) {
        super()
        this._loop = loop
        this._fadeTime = fadetime 
        this._player = null
        this.isGoingOut = null
    }

    load(src) {
        this.clear()
        this._player = new Howl({
            src: src,
            loop: this._loop,
            autoplay: false,
            volume: 0
        })
        this._player.on('end', () => {
            this.emit('end', this._player._src)
            console.log('PlayerSimple end:', this._player._src)
        })
        this._player.on('stop', () => {
            this.emit('stop', this._player._src)
            console.log('PlayerSimple stop:', this._player._src)
        })
        this._player.on('play', () => {
            this.emit('play', this._player._src)
            console.log('PlayerSimple play:', this._player._src)
        })
        this._player.on('pause', () => {
            this.emit('pause', this._player._src)
            console.log('PlayerSimple pause:', this._player._src)
        })
        this._player.on('load', () => {
            this.emit('load', this._player._src)
            console.log('PlayerSimple load:', this._player._src)
        })
        console.log('PlayerSimple loaded:', src)
    }

    clear() {  
        if (this._player !== null) {
            this._player.stop()
            this._player.unload()
            this._player = null
        }
    }

    loop(value) {
        if (value !== undefined) {
            this._loop = value
            this._player.loop(value)
        }
        return this._loop
    }

    play(seek=0, volume=1) {
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        else if (this._player.playing()) return

        if (seek >= 0) this._player.seek(seek)
        this._player.play()

        if (volume < 0) volume = this._player.volume()

        if (this._fadeTime > 0) this._player.fade(0, volume, this._fadeTime)
        else this._player.volume(volume)
    }

    resume(volume=1) {
        this.play(-1, volume)
    }

    stop() {
        this._player.stop()
    }

    pause() {
        if (!this._player.playing()) return
        this._player.pause()
    }

    volume(value) {
        this._player.volume(value)
    }

    isPlaying() {
        return this._player.playing() && !this.isGoingOut
    }

    stopOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        if (!this._player.playing()) return

        this._player.fade(this._player.volume(), 0, d)
        this.isGoingOut = setTimeout(() => {
            this._player.stop()
            // console.log('PlayerSimple stopOut done')
            this.isGoingOut = null
        }, d+10)
    }

    pauseOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (!this._player.playing() || this.isGoingOut) return

        this._player.fade(this._player.volume(), 0, d)
        this.isGoingOut = setTimeout(() => {
            this._player.pause()
            this._player.seek(this._player.seek() - d/1000)
            // console.log('PlayerSimple pauseOut done')
            this.isGoingOut = null
        }, d+10)
    }
}



class PlayerStep extends EventEmitter 
{
    constructor() {
        super()
        this.voice   = new PlayerSimple()
        this.music   = new PlayerSimple()
        this.ambiant = new PlayerSimple(true)
        this.offlimit = new PlayerSimple(true, 500)
        this.state = 'off'

        this.voice.on('end', () => {
            if (this.state == 'play') this.state = 'afterplay'
        })
        this.music.on('end', () => {
            if (this.state == 'play') this.state = 'afterplay'
        })
    }

    load(src) {
        this.voice.load(src.voice)
        this.music.load(src.music)
        this.ambiant.load(src.ambiant)
        this.offlimit.load(src.offlimit)
        this.state = 'stop'
    }

    clear() {
        this.voice.clear()
        this.music.clear()
        this.ambiant.clear()
        this.offlimit.clear()
        this.state = 'stop'
    }

    play() {
        this.offlimit.stop()
        this.voice.play()
        this.music.play()
        this.ambiant.play()
        this.state = 'play'
    }

    stop() {
        this.voice.stopOut()
        this.music.stopOut()
        this.ambiant.stopOut()
        this.offlimit.stopOut()
        this.state = 'stop'
    }

    volume(value) {
        this.voice.volume(value)
        this.music.volume(value)
        this.ambiant.volume(value)
        this.offlimit.volume(value)
    }

    isPlaying() {
        return this.state !== 'stop'
    }

    isOfflimit() {
        return this.state == 'offlimit'
    }

    crossLimit(out=true) 
    {
        if (out && this.state == 'play') {
            this.voice.pauseOut()
            this.music.pauseOut()
            this.offlimit.play()
            this.state = 'offlimit'
        }
        else if (!out && this.state == 'offlimit') {
            this.offlimit.stopOut()
            this.voice.resume()
            this.music.resume()
            this.state = 'play'
        }
    }
}