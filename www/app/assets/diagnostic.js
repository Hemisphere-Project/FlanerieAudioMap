// ============================================================
// DIAGNOSTIC TEST PARCOURS
// A sequential test runner for diagnosing GPS + Audio issues
// DEV mode only — no parcours JSON needed
// ============================================================

class DiagnosticRunner extends EventEmitter {

    constructor() {
        super()
        this.tests = []
        this.results = []
        this.currentIndex = -1
        this._listeners = []     // tracked GEO listeners for cleanup
        this._timers = []        // tracked timers for cleanup
        this._players = []       // tracked Howl instances for cleanup
        this._collecting = false
        this._metrics = {}
        this.platform = 'browser'
        try { if (cordova.platformId) this.platform = cordova.platformId } catch(e) {}
        this.device = navigator.userAgent
        this._buildTests()
    }

    // ---- Test definitions ----

    _buildTests() {
        this.tests = [

            // ====== PHASE 1: Static checks ======

            {
                id: 'T1', phase: 1,
                name: 'Acquisition GPS',
                instructions: 'Restez immobile à l\'extérieur.\nLe test vérifie l\'obtention d\'un signal GPS.',
                duration: 30000,
                auto: true,
                run: (ctx) => this._testGpsAcquire(ctx),
                pass: (m) => m.fix_obtained && m.accuracy_min < 50,
            },
            {
                id: 'T2', phase: 1,
                name: 'Précision GPS',
                instructions: 'Restez immobile.\nLe test vérifie que la précision s\'améliore.',
                duration: 30000,
                auto: true,
                run: (ctx) => this._testGpsWarmup(ctx),
                pass: (m) => m.accuracy_min < 20,
            },
            {
                id: 'T3', phase: 1,
                name: 'Lecture audio',
                instructions: 'Mettez vos écouteurs.\nUn son de test va être joué.',
                duration: 10000,
                auto: true,
                run: (ctx) => this._testAudioPlay(ctx),
                pass: (m) => m.play_ok && m.ctx_state === 'running',
                userQuestion: 'Avez-vous entendu le son ?',
            },
            {
                id: 'T4', phase: 1,
                name: 'Audio en veille',
                instructions: 'Un son va jouer.\nVerrouillez votre téléphone.\nAttendez 15 secondes, puis déverrouillez.',
                duration: 25000,
                auto: false,  // user presses next
                run: (ctx) => this._testAudioLock(ctx),
                pass: (m) => m.play_ok && !m.had_error,
                userQuestion: 'Le son jouait-il toujours quand vous avez déverrouillé ?',
            },

            // ====== PHASE 2: Short movement ======

            {
                id: 'T5', phase: 2,
                name: 'Suivi GPS en marchant',
                instructions: 'Marchez environ 15 mètres dans une direction.\nLe test compte les positions GPS reçues.',
                duration: 30000,
                auto: true,
                run: (ctx) => this._testGpsTracking(ctx),
                pass: (m) => m.positions >= 5 && m.max_gap_ms < 5000,
            },
            {
                id: 'T6', phase: 2,
                name: 'Déclenchement audio par GPS',
                instructions: 'Marchez lentement dans n\'importe quelle direction (~10m).\nUn son doit se déclencher automatiquement quand vous atteignez la zone.',
                duration: 60000,
                auto: false,
                run: (ctx) => this._testGpsTrigger(ctx),
                pass: (m) => m.triggered,
                userQuestion: 'Avez-vous entendu le son se déclencher en marchant ?',
            },
            {
                id: 'T7', phase: 2,
                name: 'GPS verrouillé en marchant',
                instructions: 'Verrouillez votre téléphone.\nMarchez environ 15 mètres.\nPuis déverrouillez.',
                duration: 40000,
                auto: false,
                run: (ctx) => this._testLockedGpsTracking(ctx),
                pass: (m) => m.bg_positions >= 3,
            },

            // ====== PHASE 3: Stress ======

            {
                id: 'T8', phase: 3,
                name: 'GPS immobile (90s)',
                instructions: 'Restez complètement immobile pendant 90 secondes.\nLe test vérifie que le GPS ne se déconnecte pas.',
                duration: 95000,
                auto: true,
                run: (ctx) => this._testStationaryKeepAlive(ctx),
                pass: (m) => m.gps_lost_events === 0,
                userQuestion: 'Avez-vous entendu un son de "GPS perdu" pendant le test ?',
            },
            {
                id: 'T9', phase: 3,
                name: 'Audio verrouillé + GPS',
                instructions: 'Verrouillez votre téléphone et mettez-le en poche.\nMarchez lentement ~10m.\nUn son doit se déclencher.\nDéverrouillez après ~30s.',
                duration: 60000,
                auto: false,
                run: (ctx) => this._testLockedAudioTrigger(ctx),
                pass: (m) => m.triggered,
                userQuestion: 'Avez-vous entendu un son se déclencher dans votre poche ?',
            },
            {
                id: 'T10', phase: 3,
                name: 'Survie longue (2 min veille)',
                instructions: 'Verrouillez votre téléphone.\nRestez immobile pendant 2 minutes.\nPuis déverrouillez.',
                duration: 135000,
                auto: false,
                run: (ctx) => this._testLongLockSurvival(ctx),
                pass: (m) => m.ctx_alive && m.heartbeat_count > 0,
                userQuestion: 'L\'application semblait-elle toujours active quand vous avez déverrouillé ?',
            },

            // ====== PHASE 4: Report ======
            {
                id: 'T11', phase: 4,
                name: 'Rapport',
                instructions: '',
                duration: 0,
                auto: false,
                run: () => {},
                pass: () => true,
            },
        ]
    }

    // ---- Public API ----

    start() {
        this.results = []
        this.currentIndex = -1
        this.next()
    }

    current() {
        if (this.currentIndex < 0 || this.currentIndex >= this.tests.length) return null
        return this.tests[this.currentIndex]
    }

    currentResult() {
        return this.results[this.currentIndex] || null
    }

    next() {
        this._cleanup()
        this.currentIndex++
        if (this.currentIndex >= this.tests.length) {
            this.emit('complete', this.results)
            return
        }
        let test = this.tests[this.currentIndex]
        this._metrics = {}
        this.results[this.currentIndex] = {
            test_id: test.id,
            test_name: test.name,
            phase: test.phase,
            started_at: Date.now(),
            ended_at: null,
            result: 'running',
            metrics: {},
            user_answer: null,
            platform: this.platform,
            device: this.device
        }
        this.emit('test', test, this.currentIndex)
        // Run test logic (unless report)
        if (test.id !== 'T11') {
            test.run({ metrics: this._metrics, test: test })
        }
    }

    // Called when auto test completes or user presses Next
    finishCurrent(userAnswer) {
        let test = this.tests[this.currentIndex]
        let result = this.results[this.currentIndex]
        if (!result) return
        this._cleanup()
        result.ended_at = Date.now()
        result.metrics = { ...this._metrics }
        result.user_answer = userAnswer !== undefined ? userAnswer : null

        // Determine pass/fail
        let autoPassed = test.pass(result.metrics)
        if (userAnswer === false) autoPassed = false   // user override
        result.result = autoPassed ? 'pass' : 'fail'

        this.emit('result', result, this.currentIndex)
    }

    skip() {
        let result = this.results[this.currentIndex]
        if (result) {
            this._cleanup()
            result.ended_at = Date.now()
            result.metrics = { ...this._metrics }
            result.result = 'skip'
        }
        this.emit('result', result, this.currentIndex)
    }

    getReport() {
        return {
            timestamp: new Date().toISOString(),
            platform: this.platform,
            device: this.device,
            battery: typeof BATTERY !== 'undefined' ? BATTERY : null,
            tests: this.results.filter(r => r)
        }
    }

    clearAllListeners() {
        this._events = {}
    }

    // ---- Internal: tracked resource management ----

    _trackListener(event, fn) {
        GEO.on(event, fn)
        this._listeners.push({ event, fn })
    }

    _trackTimer(fn, ms) {
        let id = setTimeout(fn, ms)
        this._timers.push(id)
        return id
    }

    _trackInterval(fn, ms) {
        let id = setInterval(fn, ms)
        this._timers.push(id)
        return id
    }

    _trackPlayer(howl) {
        this._players.push(howl)
        return howl
    }

    _cleanup() {
        this._listeners.forEach(l => { try { GEO.off(l.event, l.fn) } catch(e) {} })
        this._listeners = []
        this._timers.forEach(id => { clearTimeout(id); clearInterval(id) })
        this._timers = []
        this._players.forEach(p => { try { p.stop(); p.unload() } catch(e) {} })
        this._players = []
        this._collecting = false
    }

    // ---- Utility ----

    _html5() { 
        try { return cordova.platformId === 'ios' } catch(e) { return false }
    }

    _makeTestHowl(src, loop) {
        let h = new Howl({
            src: BASEURL + '/images/' + src,
            loop: !!loop,
            autoplay: false,
            volume: 1,
            html5: this._html5()
        })
        return this._trackPlayer(h)
    }

    // ---- Test implementations ----

    // T1: GPS acquisition — measure time to first fix + accuracy
    _testGpsAcquire(ctx) {
        let m = ctx.metrics
        m.fix_obtained = false
        m.accuracy_min = 999
        m.accuracy_max = 0
        m.accuracy_samples = []
        m.first_fix_ms = null
        m.positions = 0
        let startTime = Date.now()

        let onPos = (pos) => {
            m.positions++
            let acc = pos.accuracy || 999
            if (!m.fix_obtained) {
                m.fix_obtained = true
                m.first_fix_ms = Date.now() - startTime
            }
            if (acc < m.accuracy_min) m.accuracy_min = acc
            if (acc > m.accuracy_max) m.accuracy_max = acc
            m.accuracy_samples.push(acc)
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        // Also try raw position if background plugin provides it
        let onRaw = (pos) => {
            if (!m.fix_obtained && pos && pos.latitude) {
                m.fix_obtained = true
                m.first_fix_ms = Date.now() - startTime
                let acc = pos.accuracy || 999
                if (acc < m.accuracy_min) m.accuracy_min = acc
                m.positions++
                this.emit('metrics', m)
            }
        }
        this._trackListener('rawPosition', onRaw)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T2: GPS warm-up — watch accuracy improve
    _testGpsWarmup(ctx) {
        let m = ctx.metrics
        m.accuracy_min = 999
        m.accuracy_max = 0
        m.accuracy_samples = []
        m.positions = 0

        let onPos = (pos) => {
            m.positions++
            let acc = pos.accuracy || 999
            if (acc < m.accuracy_min) m.accuracy_min = acc
            if (acc > m.accuracy_max) m.accuracy_max = acc
            m.accuracy_samples.push(acc)
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T3: Audio playback
    _testAudioPlay(ctx) {
        let m = ctx.metrics
        m.play_ok = false
        m.had_error = false
        m.ctx_state = Howler.ctx ? Howler.ctx.state : 'unavailable'

        let player = this._makeTestHowl('test.mp3', false)
        player.on('play', () => {
            m.play_ok = true
            m.ctx_state = Howler.ctx ? Howler.ctx.state : 'unavailable'
            this.emit('metrics', m)
        })
        player.on('loaderror', (id, err) => { m.had_error = true; m.error = String(err); this.emit('metrics', m) })
        player.on('playerror', (id, err) => { m.had_error = true; m.error = String(err); this.emit('metrics', m) })
        player.play()

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T4: Audio under lock
    _testAudioLock(ctx) {
        let m = ctx.metrics
        m.play_ok = false
        m.had_error = false
        m.was_playing_on_unlock = null

        let player = this._makeTestHowl('test.mp3', true)
        player.on('play', () => { m.play_ok = true; this.emit('metrics', m) })
        player.on('loaderror', (id, err) => { m.had_error = true; this.emit('metrics', m) })
        player.on('playerror', (id, err) => { m.had_error = true; this.emit('metrics', m) })
        player.play()

        // On resume (unlock), check if still playing
        let onResume = () => {
            m.was_playing_on_unlock = player.playing()
            m.ctx_state = Howler.ctx ? Howler.ctx.state : 'unavailable'
            this.emit('metrics', m)
            document.removeEventListener('resume', onResume)
        }
        document.addEventListener('resume', onResume)
        // cleanup handler tracked manually
        this._timers.push(setTimeout(() => {
            document.removeEventListener('resume', onResume)
        }, 60000))
    }

    // T5: GPS tracking while walking
    _testGpsTracking(ctx) {
        let m = ctx.metrics
        m.positions = 0
        m.max_gap_ms = 0
        m.total_distance = 0
        m.last_time = null
        m.last_pos = null

        let onPos = (pos) => {
            let now = Date.now()
            m.positions++
            if (m.last_time) {
                let gap = now - m.last_time
                if (gap > m.max_gap_ms) m.max_gap_ms = gap
            }
            if (m.last_pos && pos.latitude && pos.longitude) {
                m.total_distance += geo_distance([pos.latitude, pos.longitude], [m.last_pos.latitude, m.last_pos.longitude])
            }
            m.last_time = now
            m.last_pos = { latitude: pos.latitude, longitude: pos.longitude }
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T6: GPS-triggered audio — create a virtual zone at ~10m from current position
    _testGpsTrigger(ctx) {
        let m = ctx.metrics
        m.triggered = false
        m.zone_created = false
        m.positions_since_zone = 0

        let player = this._makeTestHowl('background-ok.mp3', false)

        // Wait for a fix, then create a zone 10m in a random direction
        let zoneLat = null, zoneLon = null
        let got_first = false

        let onPos = (pos) => {
            if (!got_first && pos.latitude && pos.longitude) {
                got_first = true
                // Place zone 10m north
                zoneLat = pos.latitude + (10 / 111320)
                zoneLon = pos.longitude
                m.zone_created = true
                this.emit('metrics', m)
            }
            if (m.zone_created) {
                m.positions_since_zone++
                let dist = geo_distance([pos.latitude, pos.longitude], [zoneLat, zoneLon])
                m.distance_to_zone = Math.round(dist * 10) / 10
                this.emit('metrics', m)
                if (dist < 8 && !m.triggered) {
                    m.triggered = true
                    player.play()
                    this.emit('metrics', m)
                }
            }
        }
        this._trackListener('position', onPos)
    }

    // T7: Locked GPS tracking — count background positions
    _testLockedGpsTracking(ctx) {
        let m = ctx.metrics
        m.bg_positions = 0
        m.fg_positions = 0
        m.max_gap_ms = 0
        m.last_time = null
        m.is_background = false

        document.addEventListener('pause', () => { m.is_background = true })
        document.addEventListener('resume', () => { m.is_background = false })

        let onPos = (pos) => {
            let now = Date.now()
            if (m.is_background) m.bg_positions++
            else m.fg_positions++
            if (m.last_time) {
                let gap = now - m.last_time
                if (gap > m.max_gap_ms) m.max_gap_ms = gap
            }
            m.last_time = now
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)
    }

    // T8: Stationary GPS keepalive — stand still for 90s, watch for GPS lost
    _testStationaryKeepAlive(ctx) {
        let m = ctx.metrics
        m.gps_lost_events = 0
        m.gps_recovered = 0
        m.positions = 0
        m.heartbeat_count = 0

        let onPos = () => { m.positions++; this.emit('metrics', m) }
        this._trackListener('position', onPos)

        let onState = (state) => {
            if (state === 'lost') m.gps_lost_events++
            if (state === 'ok') m.gps_recovered++
            this.emit('metrics', m)
        }
        this._trackListener('stateUpdate', onState)

        // Count heartbeats via telemetry-like approach
        let hbInterval = this._trackInterval(() => {
            // Check if GEO is still receiving
            if (GEO.lastTimeUpdate && (Date.now() - GEO.lastTimeUpdate) < 15000) {
                m.heartbeat_count++
            }
            this.emit('metrics', m)
        }, 10000)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T9: Locked audio trigger — same as T6 but phone is locked
    _testLockedAudioTrigger(ctx) {
        let m = ctx.metrics
        m.triggered = false
        m.zone_created = false
        m.bg_positions = 0
        m.is_background = false

        let player = this._makeTestHowl('background-ok.mp3', false)

        document.addEventListener('pause', () => { m.is_background = true })
        document.addEventListener('resume', () => { m.is_background = false })

        let zoneLat = null, zoneLon = null
        let got_first = false

        let onPos = (pos) => {
            if (m.is_background) m.bg_positions++
            if (!got_first && pos.latitude && pos.longitude) {
                got_first = true
                zoneLat = pos.latitude + (10 / 111320)
                zoneLon = pos.longitude
                m.zone_created = true
                this.emit('metrics', m)
            }
            if (m.zone_created && pos.latitude && pos.longitude) {
                let dist = geo_distance([pos.latitude, pos.longitude], [zoneLat, zoneLon])
                m.distance_to_zone = Math.round(dist * 10) / 10
                this.emit('metrics', m)
                if (dist < 8 && !m.triggered) {
                    m.triggered = true
                    player.play()
                    this.emit('metrics', m)
                }
            }
        }
        this._trackListener('position', onPos)
    }

    // T10: Long lock survival — 2 min locked, check everything alive
    _testLongLockSurvival(ctx) {
        let m = ctx.metrics
        m.ctx_alive = false
        m.heartbeat_count = 0
        m.notif_wakeups = 0
        m.gps_lost_events = 0
        m.positions = 0
        m.bg_positions = 0
        m.is_background = false

        document.addEventListener('pause', () => { m.is_background = true })
        document.addEventListener('resume', () => {
            m.is_background = false
            m.ctx_alive = Howler.ctx ? Howler.ctx.state === 'running' : false
            this.emit('metrics', m)
        })

        let onPos = (pos) => {
            m.positions++
            if (m.is_background) m.bg_positions++
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        let onState = (state) => {
            if (state === 'lost') m.gps_lost_events++
            this.emit('metrics', m)
        }
        this._trackListener('stateUpdate', onState)

        // Count heartbeats
        this._trackInterval(() => {
            if (GEO.lastTimeUpdate && (Date.now() - GEO.lastTimeUpdate) < 15000) {
                m.heartbeat_count++
            }
            this.emit('metrics', m)
        }, 10000)

        // Count notification wakeups if possible
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local) {
            let origHandler = null // we just count via our own listener
            let notifFn = (notification) => {
                m.notif_wakeups++
                this.emit('metrics', m)
            }
            cordova.plugins.notification.local.on('trigger', notifFn)
            this._timers.push(setTimeout(() => {
                try { cordova.plugins.notification.local.un('trigger', notifFn) } catch(e) {}
            }, 180000))
        }
    }
}

var DIAGNOSTIC = new DiagnosticRunner()
