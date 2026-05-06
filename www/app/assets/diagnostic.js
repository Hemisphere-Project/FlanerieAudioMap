// ============================================================
// DIAGNOSTIC TEST SUITE
// Sequential test runner for GPS + Audio field diagnosis.
// DEV mode only — no parcours JSON needed.
// ============================================================

class DiagnosticRunner extends EventEmitter {

    constructor() {
        super()
        this.tests = []
        this.results = []
        this.currentIndex = -1
        this._listeners = []        // GEO event listeners
        this._docListeners = []     // document event listeners
        this._timers = []           // setTimeout / setInterval ids
        this._players = []          // Howl instances
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

            // ====== PHASE 0: Init ======

            {
                id: 'T0', phase: 0,
                name: 'Démarrage GPS',
                instructions: 'Démarrage du plugin BackgroundGeolocation.\nSi une fenêtre d\'autorisation apparaît, acceptez la localisation.',
                duration: 20000,
                auto: true,
                run: (ctx) => this._testGpsStart(ctx),
                // Pass: GPS entered 'gps' runMode and got at least one raw callback
                pass: (m) => m.gps_started && m.first_callback,
            },

            // ====== PHASE 1: Static checks ======

            {
                id: 'T1', phase: 1,
                name: 'Acquisition + précision GPS',
                instructions: 'Restez immobile à l\'extérieur.\nLe test vérifie qu\'un fix GPS utile arrive puis que la précision descend sous 20m.',
                duration: 45000,
                auto: true,
                run: (ctx) => this._testGpsAcquire(ctx),
                // position event only fires when accuracy ≤ 30m (geoloc.js accuracy gate)
                pass: (m) => m.fix_obtained && m.accuracy_min < 20,
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
                auto: false,
                run: (ctx) => this._testAudioLock(ctx),
                pass: (m) => m.play_ok && !m.had_error,
                userQuestion: 'Le son jouait-il toujours quand vous avez déverrouillé ?',
            },

            // ====== PHASE 2: Short movement ======

            {
                id: 'T5', phase: 2,
                name: 'Suivi GPS en marchant',
                instructions: 'Marchez environ 15 mètres dans une direction.\nLe test compte les positions GPS reçues (≤30m).',
                duration: 30000,
                auto: true,
                run: (ctx) => this._testGpsTracking(ctx),
                pass: (m) => m.positions >= 5 && m.max_gap_ms < 5000,
            },
            {
                id: 'T6', phase: 2,
                name: 'Déclenchement audio par GPS',
                instructions: 'Marchez lentement dans n\'importe quelle direction (~15m).\nUn son doit se déclencher automatiquement quand vous atteignez la zone.',
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

            // ====== PHASE 3: Keepalive stress ======

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
                name: 'Statique verrouillé + audio (2 min)',
                instructions: 'Laissez le téléphone déverrouillé quelques secondes, sans bouger.\nUn son tourne en continu pendant tout le test.\nVerrouillez ensuite le téléphone, restez immobile pendant 2 minutes, puis déverrouillez.',
                duration: 145000,
                auto: false,
                run: (ctx) => this._testLongLockSurvival(ctx),
                // Audio must remain continuous, GPS must stay alive in background, and AudioContext must resume on unlock.
                pass: (m) => m.ctx_alive && m.bg_positions > 0 && m.gps_lost_events === 0 && m.play_ok && !m.had_error && !m.audio_interrupted,
                userQuestion: 'Le son est-il resté continu, sans coupure ni message "GPS perdu", et l\'application semblait-elle toujours active au déverrouillage ?',
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
        if (test.id !== 'T11') {
            test.run({ metrics: this._metrics, test: test })
        }
    }

    finishCurrent(userAnswer) {
        let test = this.tests[this.currentIndex]
        let result = this.results[this.currentIndex]
        if (!result) return
        this._cleanup()
        result.ended_at = Date.now()
        result.metrics = { ...this._metrics }
        result.user_answer = userAnswer !== undefined ? userAnswer : null

        let autoPassed = test.pass(result.metrics)
        if (userAnswer === false) autoPassed = false
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

    _trackDocListener(event, fn) {
        document.addEventListener(event, fn)
        this._docListeners.push({ event, fn })
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
        this._docListeners.forEach(l => { try { document.removeEventListener(l.event, l.fn) } catch(e) {} })
        this._docListeners = []
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

    _requestAudioFocus() {
        if (typeof requestAudioFocus === 'function') {
            requestAudioFocus().catch(e => console.warn('[DIAG] audio focus request failed:', e))
        }
    }

    _ctxState() {
        return Howler.ctx ? Howler.ctx.state : 'unavailable'
    }

    _projectZoneAhead(originLat, originLon, currentLat, currentLon, distanceMeters) {
        let latMeters = (currentLat - originLat) * 111320
        let avgLatRad = ((originLat + currentLat) / 2) * Math.PI / 180
        let lonMeters = (currentLon - originLon) * 111320 * Math.cos(avgLatRad)
        let displacement = Math.sqrt((latMeters * latMeters) + (lonMeters * lonMeters))

        if (!isFinite(displacement) || displacement < 3) return null

        let scale = distanceMeters / displacement
        let zoneLat = originLat + ((latMeters * scale) / 111320)
        let zoneLon = originLon + ((lonMeters * scale) / (111320 * Math.cos(avgLatRad)))
        return { zoneLat, zoneLon, displacement }
    }

    // ---- Test implementations ----

    // T0: GPS startup — start the plugin if not already running, verify first callback
    // Critical: the diagnostic is reached from select without going through startgeo,
    // so GEO.runMode is 'off'. This test ensures GPS is running before T1–T10.
    _testGpsStart(ctx) {
        let m = ctx.metrics
        m.gps_started = false
        m.first_callback = false
        m.plugin_available = typeof BackgroundGeolocation !== 'undefined'
        m.run_mode = GEO.runMode
        let completed = false

        let finishIfReady = () => {
            if (completed) return
            if (m.gps_started && m.first_callback) {
                completed = true
                this.emit('autoFinish')
            }
        }

        // Watch for first raw position callback (updates lastTimeUpdate even for filtered fixes)
        let lastKnown = GEO.lastTimeUpdate
        this._trackInterval(() => {
            if (GEO.lastTimeUpdate && GEO.lastTimeUpdate !== lastKnown) {
                lastKnown = GEO.lastTimeUpdate
                m.first_callback = true
                m.accuracy_on_start = GEO.lastPosition ? Math.round(GEO.lastPosition.coords.accuracy) : null
                this.emit('metrics', m)
                finishIfReady()
            }
        }, 500)

        if (GEO.runMode === 'gps') {
            m.gps_started = true
            m.run_mode = 'gps'
            // GPS already running — check if we're receiving callbacks
            this.emit('metrics', m)
            this._trackTimer(() => this.emit('autoFinish'), ctx.test.duration)
            finishIfReady()
            return
        }

        GEO.startGeoloc().then(() => {
            m.gps_started = true
            m.run_mode = GEO.runMode
            this.emit('metrics', m)
            this._trackTimer(() => this.emit('autoFinish'), ctx.test.duration)
            finishIfReady()
        }).catch((err) => {
            m.gps_started = false
            m.error = String(err)
            this.emit('metrics', m)
            this._trackTimer(() => this.emit('autoFinish'), 1000)
        })
    }

    // T1: GPS acquisition — verify a position passes the ≤30m accuracy gate
    // Note: GEO.on('position') only fires when accuracy ≤ 30m (_callbackPosition gate).
    // If fix_obtained stays false but raw_callbacks > 0, the plugin is working but accuracy is poor.
    _testGpsAcquire(ctx) {
        let m = ctx.metrics
        m.fix_obtained = false
        m.accuracy_min = 999
        m.accuracy_samples = []
        m.first_fix_ms = null
        m.positions = 0
        m.raw_callbacks = 0
        let startTime = Date.now()
        let lastKnown = GEO.lastTimeUpdate
        let completed = false

        let finishIfReady = () => {
            if (completed) return
            if (m.fix_obtained && m.accuracy_min < 20) {
                completed = true
                this.emit('autoFinish')
            }
        }

        // Count raw callbacks via lastTimeUpdate polling (catches positions filtered by accuracy gate)
        this._trackInterval(() => {
            if (GEO.lastTimeUpdate && GEO.lastTimeUpdate !== lastKnown) {
                m.raw_callbacks++
                lastKnown = GEO.lastTimeUpdate
                if (GEO.lastPosition) {
                    let rawAcc = GEO.lastPosition.coords.accuracy
                    m.raw_accuracy = Math.round(rawAcc)
                }
                this.emit('metrics', m)
            }
        }, 500)

        let onPos = (pos) => {
            m.positions++
            let acc = pos.coords ? pos.coords.accuracy : (pos.accuracy || 999)
            if (!m.fix_obtained) {
                m.fix_obtained = true
                m.first_fix_ms = Date.now() - startTime
            }
            if (acc < m.accuracy_min) m.accuracy_min = acc
            m.accuracy_samples.push(Math.round(acc))
            this.emit('metrics', m)
            finishIfReady()
        }
        this._trackListener('position', onPos)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T3: Audio playback — check AudioContext state and audio focus
    _testAudioPlay(ctx) {
        let m = ctx.metrics
        m.play_ok = false
        m.had_error = false
        m.ctx_state = this._ctxState()

        this._requestAudioFocus()

        let player = this._makeTestHowl('test.mp3', false)
        player.on('play', () => {
            m.play_ok = true
            m.ctx_state = this._ctxState()
            this.emit('metrics', m)
        })
        player.on('loaderror', (id, err) => { m.had_error = true; m.error = String(err); this.emit('metrics', m) })
        player.on('playerror', (id, err) => { m.had_error = true; m.error = String(err); this.emit('metrics', m) })
        player.play()

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T4: Audio under screen lock
    // Tests that audio survives the screen lock and that AudioContext is not suspended on unlock.
    _testAudioLock(ctx) {
        let m = ctx.metrics
        m.play_ok = false
        m.had_error = false
        m.ctx_state_on_unlock = null
        m.ctx_resumed = null

        this._requestAudioFocus()

        let player = this._makeTestHowl('test.mp3', true)
        player.on('play', () => { m.play_ok = true; this.emit('metrics', m) })
        player.on('loaderror', (id, err) => { m.had_error = true; this.emit('metrics', m) })
        player.on('playerror', (id, err) => { m.had_error = true; this.emit('metrics', m) })
        player.play()

        let onResume = () => {
            m.ctx_state_on_unlock = this._ctxState()
            m.was_playing_on_unlock = player.playing()
            // resumeAudioContext is defined in geoloc.js — test that the fix from P0.1b works
            if (typeof resumeAudioContext === 'function') {
                resumeAudioContext('diag_t4')
                this._trackTimer(() => {
                    m.ctx_resumed = this._ctxState()
                    this.emit('metrics', m)
                }, 500)
            }
            this.emit('metrics', m)
        }
        this._trackDocListener('resume', onResume)
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
            let lat = pos.coords ? pos.coords.latitude : pos.latitude
            let lon = pos.coords ? pos.coords.longitude : pos.longitude
            if (m.last_pos && lat && lon) {
                m.total_distance += geo_distance([lat, lon], [m.last_pos.lat, m.last_pos.lon])
            }
            m.last_time = now
            m.last_pos = { lat, lon }
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        this._trackTimer(() => {
            this.emit('autoFinish')
        }, ctx.test.duration)
    }

    // T6: GPS-triggered audio — place a virtual zone 15m ahead in the user's walking direction.
    // Zone is projected only after a good fix and a few meters of real movement, so
    // the instruction remains valid even if the user starts in an arbitrary direction.
    _testGpsTrigger(ctx) {
        let m = ctx.metrics
        m.triggered = false
        m.zone_created = false
        m.positions_since_zone = 0
        m.waiting_for_accuracy = true
        m.waiting_for_direction = false

        let player = this._makeTestHowl('background-ok.mp3', false)
        let zoneLat = null, zoneLon = null
        let originLat = null, originLon = null

        let onPos = (pos) => {
            let lat = pos.coords ? pos.coords.latitude : pos.latitude
            let lon = pos.coords ? pos.coords.longitude : pos.longitude
            let acc = pos.coords ? pos.coords.accuracy : (pos.accuracy || 999)

            if (!m.zone_created) {
                if (acc < 15) {
                    if (originLat === null || originLon === null) {
                        originLat = lat
                        originLon = lon
                        m.waiting_for_accuracy = false
                        m.waiting_for_direction = true
                        this.emit('metrics', m)
                        return
                    }

                    let projected = this._projectZoneAhead(originLat, originLon, lat, lon, 15)
                    if (projected) {
                        zoneLat = projected.zoneLat
                        zoneLon = projected.zoneLon
                        m.zone_created = true
                        m.waiting_for_direction = false
                        m.distance_to_zone = Math.max(0, Math.round((15 - projected.displacement) * 10) / 10)
                        this.emit('metrics', m)
                    }
                }
                return
            }

            m.positions_since_zone++
            let dist = geo_distance([lat, lon], [zoneLat, zoneLon])
            m.distance_to_zone = Math.round(dist * 10) / 10
            this.emit('metrics', m)

            if (dist < 8 && !m.triggered) {
                m.triggered = true
                this._requestAudioFocus()
                player.play()
                this.emit('metrics', m)
            }
        }
        this._trackListener('position', onPos)
    }

    // T7: GPS tracking while phone is locked — count background positions
    _testLockedGpsTracking(ctx) {
        let m = ctx.metrics
        m.bg_positions = 0
        m.fg_positions = 0
        m.max_gap_ms = 0
        m.last_time = null
        m.is_background = false

        let onPause = () => { m.is_background = true; this.emit('metrics', m) }
        let onResume = () => { m.is_background = false; this.emit('metrics', m) }
        this._trackDocListener('pause', onPause)
        this._trackDocListener('resume', onResume)

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

    // T9: GPS-triggered audio with phone locked.
    // Uses the same direction projection as T6, but from the first movement observed
    // while the phone may already be locked.
    _testLockedAudioTrigger(ctx) {
        let m = ctx.metrics
        m.triggered = false
        m.zone_created = false
        m.bg_positions = 0
        m.is_background = false
        m.waiting_for_accuracy = true
        m.waiting_for_direction = false

        let player = this._makeTestHowl('background-ok.mp3', false)
        let zoneLat = null, zoneLon = null
        let originLat = null, originLon = null

        let onPause = () => { m.is_background = true; this.emit('metrics', m) }
        let onResume = () => { m.is_background = false; this.emit('metrics', m) }
        this._trackDocListener('pause', onPause)
        this._trackDocListener('resume', onResume)

        let onPos = (pos) => {
            let lat = pos.coords ? pos.coords.latitude : pos.latitude
            let lon = pos.coords ? pos.coords.longitude : pos.longitude
            let acc = pos.coords ? pos.coords.accuracy : (pos.accuracy || 999)

            if (m.is_background) m.bg_positions++

            if (!m.zone_created) {
                if (acc < 15) {
                    if (originLat === null || originLon === null) {
                        originLat = lat
                        originLon = lon
                        m.waiting_for_accuracy = false
                        m.waiting_for_direction = true
                        this.emit('metrics', m)
                        return
                    }

                    let projected = this._projectZoneAhead(originLat, originLon, lat, lon, 10)
                    if (projected) {
                        zoneLat = projected.zoneLat
                        zoneLon = projected.zoneLon
                        m.zone_created = true
                        m.waiting_for_direction = false
                        m.distance_to_zone = Math.max(0, Math.round((10 - projected.displacement) * 10) / 10)
                        this.emit('metrics', m)
                    }
                }
                return
            }

            let dist = geo_distance([lat, lon], [zoneLat, zoneLon])
            m.distance_to_zone = Math.round(dist * 10) / 10
            this.emit('metrics', m)

            if (dist < 8 && !m.triggered) {
                m.triggered = true
                this._requestAudioFocus()
                player.play()
                this.emit('metrics', m)
            }
        }
        this._trackListener('position', onPos)
    }

    // T10: Static endurance with lock-screen survival (>2 min)
    // Key checks:
    // - Looping audio starts in foreground and remains continuous while the phone is locked
    // - GPS positions received while background (BackgroundGeolocation foreground service / UIBackgroundModes)
    // - No GPS-lost state while stationary
    // - AudioContext state on resume (validates P0.1b resumeAudioContext('foreground') fix)
    // Note: notification wakeup counter removed — the 59s chain is disabled (NOTIF_CHAIN_ENABLED=false).
    // Background keepalive is now purely GPS-driven on both platforms.
    _testLongLockSurvival(ctx) {
        let m = ctx.metrics
        m.ctx_alive = false
        m.ctx_state_on_unlock = null
        m.heartbeat_count = 0
        m.gps_lost_events = 0
        m.positions = 0
        m.bg_positions = 0
        m.is_background = false
        m.motion_stationary = false
        m.gps_gap_max_ms = 0
        m.last_pos_time = null
        m.play_ok = false
        m.had_error = false
        m.audio_interrupted = false

        this._requestAudioFocus()
        let player = this._makeTestHowl('test.mp3', true)
        player.on('play', () => {
            m.play_ok = true
            this.emit('metrics', m)
        })
        player.on('loaderror', (id, err) => {
            m.had_error = true
            m.error = String(err)
            this.emit('metrics', m)
        })
        player.on('playerror', (id, err) => {
            m.had_error = true
            m.error = String(err)
            this.emit('metrics', m)
        })
        player.play()

        let onPause = () => { m.is_background = true; this.emit('metrics', m) }
        let onResume = () => {
            m.is_background = false
            m.ctx_state_on_unlock = this._ctxState()
            if (m.play_ok && !player.playing()) {
                m.audio_interrupted = true
            }
            // Give resumeAudioContext() (P0.1b foreground handler) 300ms to run
            this._trackTimer(() => {
                m.ctx_alive = this._ctxState() === 'running'
                this.emit('metrics', m)
            }, 300)
        }
        this._trackDocListener('pause', onPause)
        this._trackDocListener('resume', onResume)

        let onPos = (pos) => {
            let now = Date.now()
            m.positions++
            if (m.is_background) m.bg_positions++
            if (m.last_pos_time) {
                let gap = now - m.last_pos_time
                if (gap > m.gps_gap_max_ms) m.gps_gap_max_ms = gap
            }
            m.last_pos_time = now
            this.emit('metrics', m)
        }
        this._trackListener('position', onPos)

        let onState = (state) => {
            if (state === 'lost') m.gps_lost_events++
            this.emit('metrics', m)
        }
        this._trackListener('stateUpdate', onState)

        // Heartbeat + motion tracking while continuous audio is expected to stay alive.
        this._trackInterval(() => {
            if (GEO.lastTimeUpdate && (Date.now() - GEO.lastTimeUpdate) < 20000) {
                m.heartbeat_count++
            }
            if (m.play_ok && !player.playing()) {
                m.audio_interrupted = true
            }
            m.motion_stationary = GEO.motionIsStationary === true
            this.emit('metrics', m)
        }, 15000)
    }
}

var DIAGNOSTIC = new DiagnosticRunner()
