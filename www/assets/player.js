class PlayerSimple extends EventEmitter
{
    constructor(loop = false) {
        super()
        this._loop = loop
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
        })
        this._player.on('play', () => {
            this.emit('play', this._player._src)
        })
        this._player.on('load', () => {
            this.emit('load', this._player._src)
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

    play(seek=0) {
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        else if (this._player.playing()) return

        if (seek >= 0) this._player.seek(seek)
        this._player.play()
        this._player.fade(this._player.volume(), 1, 1500)
    }

    resume() {
        this.play(-1)
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
        return this._player.playing()
    }

    stopOut(d=1500) {
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        if (!this._player.playing()) return

        this._player.fade(this._player.volume(), 0, d)
        this.isGoingOut = setTimeout(() => {
            this._player.stop()
            // console.log('PlayerSimple stopOut done')
            this.isGoingOut = null
        }, d+10)
    }

    pauseOut(d=1500) {
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



class PlayerTri extends EventEmitter 
{
    constructor() {
        super()
        this.voice   = new PlayerSimple()
        this.music   = new PlayerSimple()
        this.ambiant = new PlayerSimple(true)
        this.offlimit = new PlayerSimple()
        this.state = 'off'
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
        this.offlimit.stopOut(500)
        this.state = 'stop'
    }

    volume(value) {
        this.voice.volume(value)
        this.music.volume(value)
        this.ambiant.volume(value)
        this.offlimit.volume(value)
    }

    isPlaying() {
        return this.voice.isPlaying() || this.music.isPlaying() || this.offlimit.isPlaying()
    }

    didPlay() {
        return this.ambiant.isPlaying() && !(this.voice.isPlaying() || this.music.isPlaying())
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
            this.offlimit.stopOut(500)
            this.voice.resume()
            this.music.resume()
            this.state = 'play'
        }
    }
}