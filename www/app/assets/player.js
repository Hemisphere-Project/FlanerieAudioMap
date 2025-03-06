class PlayerSimple extends EventEmitter
{
    constructor(loop = false, fadetime = 1500) {
        super()
        this._loop = loop
        this._fadeTime = fadetime 
        this._player = null
        this.isGoingOut = null
        this._volume = 0

        this._media = null
    }

    load(basepath, media) {
        this.clear()

        this._media = media
        
        if (!media.src || media.src == '-') return

        if (document.LOCALAPP_PATH) basepath = document.LOCALAPP_PATH + basepath
        
        this._player = new Howl({
            src: basepath + media.src,
            loop: this._loop,
            autoplay: false,
            volume: 0
        })
        this._player.on('end', () => {
            if (this._player) {
                this.emit('end', this._player._src)
                // console.log('PlayerSimple end:', this._player._src)
            }
        })
        this._player.on('stop', () => {
            if (this._player) {
                this.emit('stop', this._player._src)
                // console.log('PlayerSimple stop:', this._player._src)
            }
        })
        this._player.on('play', () => {
            if (this._player) {
                this.emit('play', this._player._src)
                // console.log('PlayerSimple play:', this._player._src)
            }
        })
        this._player.on('pause', () => {
            if (this._player) {
                this.emit('pause', this._player._src)
                // console.log('PlayerSimple pause:', this._player._src)

                if (this._rewindOnPause !== undefined) {
                    let d = this._rewindOnPause > 0 ? this._rewindOnPause : this._fadeTime
                    this._player.seek(this._player.seek() - d / 1000)
                }
            }
        })
        this._player.on('load', () => {
            if (this._player) {
                this.emit('load', this._player._src)
                // console.log('PlayerSimple ready:', this._player._src)
            }
        })

        this.master(media.master)
        // console.log('PlayerSimple load:', media.src)
    }

    clear() {  
        if (this._player !== null) {
            this._player.stop()
            this._player.unload()
            this._player = null
        }
    }

    loop(value) {
        if (!this._player) return
        if (value !== undefined) {
            this._loop = value
            this._player.loop(value)
        }
        return this._loop
    }

    play(seek=0, volume=1.0) {
        if (!this._player) return
        if (this.isGoingOut) {
            clearTimeout(this.isGoingOut)
            this.isGoingOut = null
            this._player.pause()
        }
        else if (this._player.playing()) return

        if (seek >= 0) this._player.seek(seek)
        this._player.play()
        
        if (this._fadeTime > 0) {
            this._volume = volume
            this._player.fade(this._player.volume() , this._volume * this._media.master, this._fadeTime)
        }
        else this.volume(volume)
    }

    resume(volume=1.0) {
        this.play(-1, volume)
    }

    stop() {
        if (!this._player) return
        if (!this._player.playing()) return
        this._player.stop()
    }

    pause() {
        if (!this._player) return
        if (!this._player.playing()) return
        if (this.isGoingOut) return
        this._player.pause()
    }

    toggle() {
        if (this.isPlaying()) this.pause()
        else this.resume()
    }

    volume(value) {
        if (value !== undefined) {
            this._volume = value
            if (this._player)
                this._player.volume(this._volume * this._media.master)
            // this._player.fade(this._volume * this._media.master, this._volume * this._media.master, 0)  // cancel other fade
        }
        return this._volume
    }

    master(value) {
        if (value !== undefined) {
            value = Math.round(value * 100) / 100
            if (value < 0) value = 0
            if (value > 1) value = 1
            let didChange = this._media.master !== value
            this._media.master = value
            if (this._player)
                this._player.volume(this._volume * this._media.master)
            if (didChange) this.emit('master', this._media.master)
        }
        return this._media.master
    }

    masterDec(value = 0.01) {
        this.master(this._media.master - value)
    }

    masterInc(value = 0.01) {
        this.master(this._media.master + value)
    }

    isPaused() {
        return this._player && this._player.paused()
    }

    isPlaying() {
        return this._player.playing() && !this.isGoingOut
    }

    isLoaded() {
        return this._player !== null || (this._media && this._media.src == '-')
    }

    rewindOnPause(value = -1) {
        this._rewindOnPause = value
    }

    stopOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (this.isGoingOut) clearTimeout(this.isGoingOut)
        if (!this._player || !this._player.playing()) return

        // Fade out
        this._player.fade(this._player.volume(), 0, d)
        this._volume = 0

        this.isGoingOut = setTimeout(() => {
            this._player.stop()
            this.isGoingOut = null
            // console.log('PlayerSimple stopOut done')
        }, d)
    }

    pauseOut(d=-1) {
        if (d < 0) d = this._fadeTime
        if (!this._player || !this._player.playing() || this.isGoingOut) return

        // Fade out
        this._player.fade(this._player.volume(), 0, d)
        this._volume = 0

        this.isGoingOut = setTimeout(() => {
            this._player.pause()
            this.isGoingOut = null
            // console.log('PlayerSimple pauseOut done')
        }, d)
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

        this.voice.rewindOnPause(3000)
        this.voice.on('end', () => { 
            if (this.state == 'play') {
                this.state = 'afterplay' 
                this.emit('done')
            }
        })

        this.music.rewindOnPause(3000)
        this.music.on('end', () => { 
            if (this.state == 'play') {
                this.state = 'afterplay' 
                this.emit('done')
            }    
        })
        

    }

    load(basepath, media) {
        this.voice.load(basepath, media.voice)
        this.music.load(basepath, media.music)
        this.ambiant.load(basepath, media.ambiant)
        this.offlimit.load(basepath, media.offlimit)
        this.state = 'stop'
    }

    clear() {
        this.voice.clear()
        this.music.clear()
        this.ambiant.clear()
        this.offlimit.clear()
        let wasNotStop = this.state !== 'stop'
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    play() {
        this.offlimit.stop()
        this.voice.play()
        this.music.play()
        this.ambiant.play()
        let wasNotPlay = this.state !== 'play'
        this.state = 'play'
        if (wasNotPlay) this.emit('play')
    }

    stop() {
        this.voice.stopOut()
        this.music.stopOut()
        this.ambiant.stopOut()
        this.offlimit.stopOut()
        let wasNotStop = this.state !== 'stop'
        this.state = 'stop'
        if (wasNotStop) this.emit('stop')
    }

    pause() {
        if (!this.isPlaying()) return
        this.voice.pauseOut()
        this.music.pauseOut()
        this.ambiant.pauseOut()
        this.offlimit.pauseOut()
        let wasNotPause = this.state !== 'pause'
        this.state = 'pause'
        if (wasNotPause) this.emit('pause')
    }

    resume() {
        this.voice.resume()
        this.music.resume()
        this.ambiant.resume()
        this.offlimit.resume()
        let wasNotPlay = this.state !== 'play'
        this.state = 'play'
        if (wasNotPlay) this.emit('play')
    }

    volume(value) {
        this.voice.volume(value)
        this.music.volume(value)
        this.ambiant.volume(value)
        this.offlimit.volume(value)
    }

    isPaused() {
        return this.state == 'pause'
    }

    isPlaying() {
        // return this.state !== 'stop' && this.state !== 'off'
        return this.state == 'play'
    }

    isLoaded() {
        return this.voice.isLoaded() && this.music.isLoaded() && this.ambiant.isLoaded() && this.offlimit.isLoaded()
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
            this.emit('offlimit')
        }
        else if (!out && this.state == 'offlimit') {
            this.offlimit.stopOut()
            this.voice.resume()
            this.music.resume()
            this.state = 'play'
            this.emit('resume')
        }
    }
}