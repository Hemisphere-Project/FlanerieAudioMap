var DISTANCE_RDV = 20; // 20m (to validate RDV)

var COLOR_DONE = 'grey';
var COLOR_NEXT = 'blue';
var COLOR_CURRENT = '#43FAF2';

var DEVMODE = localStorage.getItem('devmode') == 'true' || false;

// GLOBALS
//
var noSleep = null;
var CHECKGEO = null;

// BATTERY STATUS
var BATTERY = 0
window.addEventListener("batterystatus", (status) => {
    console.log("Battery Level: " + status.level + " isPlugged: " + status.isPlugged);
    BATTERY = status.level;
}, false);


// RESTORE 
PARCOURS.restore(); // Restore parcours from localStorage

// 
// PAGE SELECT
//
var PAGES = {}
var PAGES_CLEANUP = {}
var currentPage = '';
var NOTIF_TIMER = null;
var NOTIF_PERMISSION_TIMER = null;
var NOTIF_PERMISSION_ATTEMPTS = 0;
const NOTIF_PERMISSION_POLL_MS = 1000;
const NOTIF_PERMISSION_MAX_ATTEMPTS = 15;
var BATTOPT_TIMER = null;
var BATTOPT_ATTEMPTS = 0;
const BATTOPT_POLL_MS = 1500;
const BATTOPT_MAX_ATTEMPTS = 10;
var BGLOC_TIMER = null;
const BGLOC_POLL_MS = 1500;
var MOTION_TIMER = null;
const MOTION_WAIT_MS = 8000;
var GPSREVOKED = false;

function clearWakeupNotification(clearPending = true)
{
    if (NOTIF_TIMER) {
        clearTimeout(NOTIF_TIMER);
        NOTIF_TIMER = null;
    }

    if (!clearPending) return;
    if (PLATFORM != 'android' && PLATFORM != 'ios') return;
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.notification || !cordova.plugins.notification.local) return;

    cordova.plugins.notification.local.clear(NOTIF_COUNTER, () => {
        console.log('NOTIF: cleared wakeup notification', NOTIF_COUNTER);
    });
}

function clearNotificationPermissionCheck()
{
    if (NOTIF_PERMISSION_TIMER) {
        clearTimeout(NOTIF_PERMISSION_TIMER);
        NOTIF_PERMISSION_TIMER = null;
    }
    NOTIF_PERMISSION_ATTEMPTS = 0;
}

function clearBatteryOptCheck()
{
    if (BATTOPT_TIMER) {
        clearTimeout(BATTOPT_TIMER);
        BATTOPT_TIMER = null;
    }
    BATTOPT_ATTEMPTS = 0;
}

function clearBgLocCheck()
{
    if (BGLOC_TIMER) {
        clearTimeout(BGLOC_TIMER);
        BGLOC_TIMER = null;
    }
}

function clearMotionCheck()
{
    if (MOTION_TIMER) {
        clearTimeout(MOTION_TIMER);
        MOTION_TIMER = null;
    }
}

PAGES_CLEANUP['parcours']           = () => {
    clearWakeupNotification();
    GPSLOST_PLAYER.stop();
    $('#gpslost-overlay').hide();
};
PAGES_CLEANUP['checknotifications'] = () => clearNotificationPermissionCheck();
PAGES_CLEANUP['checkbatteryopt']    = () => clearBatteryOptCheck();
PAGES_CLEANUP['checkbgloc']         = () => clearBgLocCheck();
PAGES_CLEANUP['checkmotion']        = () => clearMotionCheck();

function PAGE(name, ...args)
{
    if (currentPage === name) return;
    console.log('PAGE', name, args);
    if (PAGES_CLEANUP[currentPage]) PAGES_CLEANUP[currentPage]();
    document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
    try { document.getElementById(name).style.display = 'block'; } catch (e) {}
    currentPage = name;
    if (PAGES[name]) PAGES[name](...args);
}

function NEXTPAGE() {
    var pages = Object.keys(PAGES);
    var index = pages.indexOf(currentPage);
    if (index < pages.length - 1) PAGE(pages[index + 1]);
}

function TYPEWRITE(id, delay = 50, initialDelay = 0) {
    var div = document.getElementById(id);
    var content = $(div).text().replace(/\|/g, '');
    var typewriter = new Typewriter(div, {delay: delay});
    return typewriter
            .pauseFor(initialDelay)
            .typeString(content)
            .start();
}

//
// TITLE 
//
PAGES['title'] = () => {
    TYPEWRITE('title', 90, 1000)
        .pauseFor(2000)
        .callFunction(() => {if(currentPage=='title') PAGE('intro')} );

    $('#title').off('click').on('click', () => {
        PAGE('intro') 
    });
}

//
// INTRO
//
PAGES['intro'] = () => {
    try {
        noSleep = new NoSleep();
        noSleep.enable();
        console.log('NoSleep enabled');
    }
    catch(e) {
        console.log('NoSleep not available');
    }

    TYPEWRITE('intro')
        .pauseFor(2000)
        .callFunction(() => {if(currentPage=='intro') PAGE('checkdata')} )
        
    $('#intro').off('click').on('click', () => PAGE('checkdata') );

    if (DEVMODE) PAGE('checkdata');
}


//
// CHECK DATA 
//
PAGES['checkdata'] = () => 
{
    // PARCOURS resume
    if (PARCOURS.valid()) return PAGE('checkgeo');

    // if not, check if parcours are available online
    get('/list')
        .then(parcours => {
            console.log('PARCOURS', parcours);

            var availableParcours = parcours.filter(p => p.status == 'public' || (p.status == 'test' && DEVMODE));

            console.log('AVAILABLE PARCOURS', availableParcours);
            // for (let k in parcours) {
            //    console.log('PARCOURS', parcours[k], GEO.distance(parcours[k]));
            // }

            if (availableParcours.length > 0) PAGE('select', availableParcours);
            else PAGE('noparcours');
        })
        .catch(error => PAGE('nodata'));
}
    
PAGES['nodata'] = () => {
    TYPEWRITE('nodata-retry')
        .pauseFor(2000)
        .callFunction(() => PAGE('checkdata') )
}

PAGES['noparcours'] = () => {
    TYPEWRITE('noparcours-retry')
}

PAGES['nomedia'] = () => {
    $('#nomedia-retry-btn').off().on('click', () => PAGE('load', true));
    TYPEWRITE('nomedia-retry')
}

//
// SELECT PARCOURS
//
PAGES['select'] = (list) => {

    // List
    var select = document.getElementById('select-parcours');
    select.innerHTML = '';
    list.forEach(p => {
        var li = document.createElement('li');
        li.innerHTML = p.name;
        li.addEventListener('click', () => {
            PAGE('preload', p)
        });
        // ad class 
        if (p.status == 'test') li.classList.add('testparcours');
        select.appendChild(li);
    });

    // Only one parcours => click it
    if (list.length == 1) select.querySelector('li').click();

    // DEV: diagnostic button
    $('#select-diagnostic').off().on('click', () => PAGE('diagnostic'));
}

//
// DIAGNOSTIC
//
PAGES['diagnostic'] = () => {
    var runner = DIAGNOSTIC
    var $title = $('#diag-title')
    var $progress = $('#diag-progress')
    var $progressDetail = $('#diag-progress-detail')
    var $progressFill = $('#diag-progress-fill')
    var $instructions = $('#diag-instructions')
    var $metrics = $('#diag-metrics')
    var $question = $('#diag-question')
    var $qtext = $('#diag-question-text')
    var $result = $('#diag-result')
    var $badge = $('#diag-result-badge')
    var $report = $('#diag-report')
    var $start = $('#diag-start')
    var $next = $('#diag-next')
    var $skip = $('#diag-skip')
    var liveMetrics = {}
    var progressTimer = null
    var answerAdvanceTimer = null
    var reportUploadPromise = null

    // Start a telemetry session for diagnostics
    TELEMETRY.start('__diagnostic__', 'Diagnostic')

    function stopProgressTimer() {
        if (progressTimer) clearInterval(progressTimer)
        progressTimer = null
    }

    function clearAnswerAdvanceTimer() {
        if (answerAdvanceTimer) clearTimeout(answerAdvanceTimer)
        answerAdvanceTimer = null
    }

    function formatRemaining(ms) {
        return Math.max(0, Math.ceil(ms / 1000)) + 's restantes'
    }

    function setProgressState(ratio, detail) {
        var bounded = Math.max(0, Math.min(1, ratio || 0))
        $progressFill.css('width', Math.round(bounded * 100) + '%')
        $progressDetail.text(detail || '')
    }

    function showResultBadge(result) {
        $result.show()
        if (result.result === 'pass') $badge.attr('class', 'badge-pass').text('✓ PASS')
        else if (result.result === 'fail') $badge.attr('class', 'badge-fail').text('✗ FAIL')
        else $badge.attr('class', 'badge-skip').text('— SKIP')
    }

    function logDiagnosticResult(result) {
        TELEMETRY.log('diag_result', { test_id: result.test_id, result: result.result, metrics: result.metrics, user_answer: result.user_answer })
    }

    function timedProgress(test, result) {
        if (!test || !test.duration || !result || result.ended_at || !result.started_at) return null
        var elapsed = Date.now() - result.started_at
        var ratio = Math.max(0, Math.min(1, elapsed / test.duration))
        return {
            ratio: ratio,
            detail: Math.round(ratio * 100) + '% • ' + formatRemaining(test.duration - elapsed)
        }
    }

    function displayNumber(index) {
        return index + 1
    }

    function displayLabel(index) {
        return 'Test ' + displayNumber(index)
    }

    function actualProgress(test, metrics) {
        if (!test || !metrics) return null

        if (test.id === 'T0') {
            var startupRatio = (metrics.gps_started ? 0.5 : 0) + (metrics.first_callback ? 0.5 : 0)
            if (!startupRatio) return null
            return {
                ratio: startupRatio,
                detail: metrics.first_callback ? 'Premier callback GPS reçu' : 'GPS démarré, attente du premier callback'
            }
        }

        if (test.id === 'T1') {
            if (metrics.fix_obtained && metrics.accuracy_min < 20) {
                return { ratio: 1, detail: 'Fix obtenu, précision < 20m' }
            }
            if (metrics.fix_obtained) {
                var accuracyRatio = 0.6
                if (metrics.accuracy_min !== undefined && metrics.accuracy_min < 999) {
                    accuracyRatio = Math.max(0.6, Math.min(0.95, 1 - ((metrics.accuracy_min - 20) / 25)))
                }
                return {
                    ratio: accuracyRatio,
                    detail: metrics.accuracy_min !== undefined && metrics.accuracy_min < 999
                        ? 'Fix obtenu, meilleure précision: ' + Math.round(metrics.accuracy_min) + 'm'
                        : 'Fix obtenu, amélioration de la précision…'
                }
            }
            if (metrics.raw_callbacks !== undefined && metrics.raw_callbacks > 0) {
                return {
                    ratio: 0.25,
                    detail: metrics.raw_callbacks + ' callback(s) GPS reçus, attente d\'un fix utile'
                }
            }
        }

        if (test.id === 'T5' && metrics.positions !== undefined) {
            return null
        }

        if (test.id === 'T6') {
            if (metrics.triggered) return { ratio: 1, detail: 'Zone atteinte, son déclenché' }
            if (metrics.waiting_for_accuracy) return { ratio: 0.1, detail: 'Attente d\'une précision GPS < 15m' }
            if (metrics.distance_from_start !== undefined) {
                return {
                    ratio: Math.min(metrics.distance_from_start / 15, 1),
                    detail: 'Rayon depuis le depart: ' + metrics.distance_from_start + '/15m'
                }
            }
        }

        if (test.id === 'T7' && metrics.bg_positions !== undefined) {
            return {
                ratio: Math.min(metrics.bg_positions / 3, 1),
                detail: Math.min(metrics.bg_positions, 3) + '/3 positions GPS en arrière-plan'
            }
        }

        if (test.id === 'T10' && metrics.heartbeat_count !== undefined) {
            var expectedHeartbeats = Math.max(1, Math.round(test.duration / 15000))
            return {
                ratio: Math.min(metrics.heartbeat_count / expectedHeartbeats, 1),
                detail: metrics.heartbeat_count + '/' + expectedHeartbeats + ' heartbeats keepalive'
            }
        }

        if (test.id === 'T9') {
            if (metrics.triggered) return { ratio: 1, detail: 'Zone atteinte, son déclenché' }
            if (metrics.waiting_for_accuracy) return { ratio: 0.1, detail: 'Attente d\'une précision GPS < 15m' }
            if (metrics.distance_from_start !== undefined) {
                return {
                    ratio: Math.min(metrics.distance_from_start / 10, 0.85),
                    detail: 'Rayon depuis le depart: ' + metrics.distance_from_start + '/10m'
                }
            }
            if (metrics.bg_positions !== undefined && metrics.bg_positions > 0) {
                return {
                    ratio: Math.min(metrics.bg_positions / 3, 0.35),
                    detail: metrics.bg_positions + ' positions reçues téléphone verrouillé'
                }
            }
        }

        return null
    }

    function renderProgress() {
        var test = runner.current()
        var result = runner.currentResult()
        var metrics = result && result.ended_at ? result.metrics : liveMetrics

        if (!test || !result) {
            setProgressState(0, '')
            return
        }

        if (test.id === 'T11') {
            setProgressState(1, 'Rapport final')
            return
        }

        if (!result.started_at) {
            setProgressState(0, 'Appuyez sur Demarrer quand vous etes pret')
            return
        }

        if (result.result === 'skip') {
            setProgressState(1, 'Test passé')
            return
        }

        if (result.ended_at) {
            setProgressState(1, test.userQuestion && result.result !== 'skip' ? 'Réponse requise' : 'Test terminé')
            return
        }

        if (test.id === 'T5') {
            var elapsed = Date.now() - result.started_at
            var seconds = Math.min(Math.ceil(elapsed / 1000), Math.ceil(test.duration / 1000))
            var usefulPositions = metrics.positions || 0
            var distance = metrics.total_distance !== undefined ? Math.round(metrics.total_distance) + 'm' : '0m'
            setProgressState(
                Math.max(0, Math.min(1, elapsed / test.duration)),
                'Minimum: ' + Math.min(usefulPositions, 5) + '/5 positions utiles • Duree: ' + seconds + '/' + Math.ceil(test.duration / 1000) + 's • Distance: ' + distance
            )
            return
        }

        var timed = timedProgress(test, result)
        var actual = actualProgress(test, metrics)
        var preferActual = test.id === 'T0' || test.id === 'T1'
        var chosen = timed || { ratio: 0, detail: '' }
        if (preferActual && actual) chosen = actual
        else if (actual && actual.ratio >= chosen.ratio) chosen = actual
        setProgressState(chosen.ratio, chosen.detail)
    }

    function startProgressTimer() {
        stopProgressTimer()
        renderProgress()
        var test = runner.current()
        if (!test || test.id === 'T11' || !test.duration) return
        progressTimer = setInterval(renderProgress, 500)
    }

    function scheduleAnswerAdvance(result) {
        clearAnswerAdvanceTimer()
        setProgressState(1, 'Réponse enregistrée, suite…')
        $next.hide()
        $skip.hide()
        answerAdvanceTimer = setTimeout(() => {
            if (runner.currentResult() === result) runner.next()
        }, 700)
    }

    function shouldAutoAdvance(test, result) {
        return !!(test && result && test.auto && !test.userQuestion && result.result === 'pass')
    }

    function setActionState(test, options) {
        var started = !!options.started
        var showResult = !!options.showResult
        var isReport = test.id === 'T11'

        if (isReport) {
            $start.hide()
            $next.text('Fermer').show()
            $skip.hide()
            return
        }

        if (!started) {
            $start.show()
            $next.hide()
            $skip.show()
            return
        }

        $start.hide()
        if (showResult) {
            return
        }

        if (test.auto) {
            $next.hide()
            $skip.show()
        } else {
            $next.text('Terminer le test').show()
            $skip.show()
        }
    }

    function showTest(test, index) {
        var total = runner.tests.length - 1 // exclude report test from count
        var isReport = test.id === 'T11'
        liveMetrics = {}
        reportUploadPromise = null
        clearAnswerAdvanceTimer()
        $title.text(test.name)
        $progress.text(isReport ? 'Terminé' : 'Phase ' + test.phase + ' — ' + displayLabel(index) + '/' + total)
        $instructions.text(test.instructions)
        $metrics.text('')
        $question.hide()
        $result.hide()
        $report.hide()
        setActionState(test, { started: false, showResult: false })

        if (isReport) {
            showReport()
        }

        startProgressTimer()
    }

    function showMetrics(m) {
        liveMetrics = { ...m }
        var parts = []
        // T0: GPS startup
        if (m.plugin_available !== undefined) parts.push('Plugin: ' + (m.plugin_available ? 'OK' : 'absent'))
        if (m.gps_started !== undefined) parts.push('GPS: ' + (m.gps_started ? 'démarré ✓' : 'erreur ✗'))
        if (m.first_callback) parts.push('1er callback ✓')
        if (m.accuracy_on_start !== undefined && m.accuracy_on_start !== null) parts.push('Précision init: ' + m.accuracy_on_start + 'm')
        if (m.error) parts.push('Erreur: ' + m.error)
        // T1: GPS acquisition + accuracy
        if (m.accuracy_min !== undefined && m.accuracy_min < 999) parts.push('Précision: ' + Math.round(m.accuracy_min) + 'm')
        if (m.raw_accuracy !== undefined) parts.push('Brut: ' + m.raw_accuracy + 'm')
        if (m.raw_callbacks !== undefined && m.raw_callbacks > 0) parts.push('Callbacks bruts: ' + m.raw_callbacks)
        if (m.positions !== undefined) parts.push('Positions utiles: ' + m.positions)
        if (m.first_fix_ms !== undefined && m.first_fix_ms !== null) parts.push('1er fix: ' + (m.first_fix_ms / 1000).toFixed(1) + 's')
        // T3/T4: Audio
        if (m.play_ok) parts.push('Audio: OK ✓')
        if (m.had_error) parts.push('Audio: ERREUR ✗')
        if (m.audio_interrupted) parts.push('Audio interrompu ✗')
        if (m.trigger_mode) parts.push('Mode trigger: ' + m.trigger_mode)
        if (m.prewarm_ready !== undefined) parts.push('Préchargé: ' + (m.prewarm_ready ? '✓' : '✗'))
        if (m.prime_ok !== null && m.prime_ok !== undefined) parts.push('Primé: ' + (m.prime_ok ? '✓' : '✗'))
        if (m.prime_error) parts.push('Erreur prime: ' + m.prime_error)
        if (m.player_loaded_at_trigger !== undefined) parts.push('Chargé au trigger: ' + (m.player_loaded_at_trigger ? '✓' : '✗'))
        if (m.triggered_in_background !== undefined) parts.push('Trigger arrière-plan: ' + (m.triggered_in_background ? '✓' : '✗'))
        if (m.play_started_in_background !== undefined) parts.push('Play arrière-plan: ' + (m.play_started_in_background ? '✓' : '✗'))
        if (m.ctx_state !== undefined) parts.push('Ctx: ' + m.ctx_state)
        if (m.ctx_state_on_unlock !== undefined) parts.push('Ctx@unlock: ' + m.ctx_state_on_unlock)
        if (m.ctx_resumed !== undefined) parts.push('Ctx reprise: ' + m.ctx_resumed)
        if (m.ctx_alive !== undefined) parts.push('Ctx vivant: ' + (m.ctx_alive ? '✓' : '✗'))
        // T5/T6/T7/T9: movement
        if (m.total_distance !== undefined) parts.push('Distance parcourue: ' + Math.round(m.total_distance) + 'm')
        if (m.max_gap_ms !== undefined && m.max_gap_ms > 0) parts.push('Gap max: ' + (m.max_gap_ms / 1000).toFixed(1) + 's')
        if (m.gps_gap_max_ms !== undefined && m.gps_gap_max_ms > 0) parts.push('Gap GPS: ' + (m.gps_gap_max_ms / 1000).toFixed(1) + 's')
        if (m.waiting_for_accuracy) parts.push('Attente précision…')
        if (m.distance_from_start !== undefined) parts.push('Rayon depuis depart: ' + m.distance_from_start + 'm')
        if (m.triggered) parts.push('Déclenché ✓')
        if (m.fg_positions !== undefined) parts.push('Pos. avant-plan: ' + m.fg_positions)
        if (m.bg_positions !== undefined) parts.push('Pos. arrière-plan: ' + m.bg_positions)
        // T10: keepalive + motion
        if (m.heartbeat_count !== undefined) parts.push('Heartbeats: ' + m.heartbeat_count)
        if (m.gps_lost_events !== undefined && m.gps_lost_events > 0) parts.push('GPS perdus: ' + m.gps_lost_events)
        if (m.gps_recovered !== undefined && m.gps_recovered > 0) parts.push('GPS récupérés: ' + m.gps_recovered)
        if (m.motion_stationary !== undefined) parts.push('Immobile détecté: ' + (m.motion_stationary ? '✓' : '—'))
        $metrics.text(parts.join(' | '))
        renderProgress()
    }

    function showResult(result) {
        var test = runner.tests[runner.currentIndex]
        stopProgressTimer()
        $start.hide()
        $result.hide()

        // If there's a user question, show it
        if (test.userQuestion && result.result !== 'skip') {
            askQuestion(test.userQuestion)
        } else if (shouldAutoAdvance(test, result)) {
            showResultBadge(result)
            logDiagnosticResult(result)
            $next.hide()
            $skip.hide()
        } else {
            showResultBadge(result)
            logDiagnosticResult(result)
            $next.text('Test suivant →').show()
            $skip.hide()
        }

        renderProgress()
    }

    function askQuestion(text) {
        $qtext.text(text)
        $question.show()
        $next.hide()
        $skip.hide()
    }

    function showReport() {
        stopProgressTimer()
        var report = runner.getReport()
        var reportResult = runner.currentResult()
        $instructions.text('Résultats du diagnostic :')
        $metrics.text('')
        $skip.hide()
        $question.hide()
        $result.hide()
        setProgressState(0.95, 'Envoi du rapport de télémétrie…')

        if (reportResult && !reportResult.started_at) {
            reportResult.started_at = Date.now()
            reportResult.result = 'running'
        }

        var lines = []
        report.tests.forEach((r, reportIndex) => {
            var icon = r.result === 'pass' ? '✓' : r.result === 'fail' ? '✗' : '—'
            var userNote = ''
            if (r.user_answer === true) userNote = ' [utilisateur: oui]'
            if (r.user_answer === false) userNote = ' [utilisateur: non]'
            lines.push(icon + ' ' + displayLabel(reportIndex) + ' ' + r.test_name + ': ' + r.result.toUpperCase() + userNote)
        })
        lines.push('')
        lines.push('Plateforme: ' + report.platform)
        lines.push('Appareil: ' + report.device)
        lines.push('Batterie: ' + (report.battery || '?') + '%')
        $report.text(lines.join('\n')).show()

        // Upload report via telemetry
        TELEMETRY.log('diag_report', report)
        reportUploadPromise = Promise.resolve(TELEMETRY.flush()).then((flushResult) => {
            var ok = !!(flushResult && flushResult.ok)
            if (reportResult) {
                reportResult.ended_at = Date.now()
                reportResult.result = ok ? 'pass' : 'fail'
                reportResult.metrics = {
                    telemetry_flush: ok ? 'ok' : ((flushResult && flushResult.skipped) ? 'skipped' : 'failed')
                }
            }
            showResultBadge({ result: ok ? 'pass' : 'fail' })
            setProgressState(1, ok ? 'Rapport télémétrique envoyé' : 'Échec envoi télémétrique')
            return flushResult
        })

        $next.text('Fermer').show()
    }

    // Wire events
    runner.clearAllListeners()  // clear previous listeners

    runner.on('test', (test, index) => showTest(test, index))
    runner.on('started', (test) => {
        setActionState(test, { started: true, showResult: false })
        renderProgress()
    })
    runner.on('metrics', (m) => showMetrics(m))
    runner.on('autoFinish', () => {
        runner.finishCurrent()
        // Auto tests without a user question that passed: advance automatically after a brief pause.
        // Identity check prevents double-advance if user clicks "Test suivant" before timeout fires.
        var test = runner.current()
        var result = runner.currentResult()
        if (shouldAutoAdvance(test, result)) {
            setTimeout(() => {
                if (runner.currentResult() === result) runner.next()
            }, 1500)
        }
    })
    runner.on('result', (result) => {
        showResult(result)
    })
    runner.on('complete', () => {
        stopProgressTimer()
        clearAnswerAdvanceTimer()
        PAGE('select')
    })

    // Button handlers
    $next.off().on('click', () => {
        var test = runner.current()
        if (!test) { PAGE('select'); return }
        var result = runner.currentResult()

        // On report page, close
        if (test.id === 'T11') {
            PAGE('select')
            return
        }

        if (result && !result.started_at) {
            runner.startCurrent()
            return
        }

        // If result already shown, advance
        if (result && result.ended_at) {
            runner.next()
        } else {
            // Manual test: finish it
            runner.finishCurrent()
        }
    })

    $start.off().on('click', () => {
        runner.startCurrent()
    })

    $skip.off().on('click', () => {
        runner.skip()
    })

    // User question buttons
    $('#diag-yes').off().on('click', () => {
        var result = runner.currentResult()
        if (!result) return
        if (result) result.user_answer = true
        TELEMETRY.log('diag_user_answer', { test_id: result.test_id, answer: true })
        showResultBadge(result)
        logDiagnosticResult(result)
        $question.hide()
        scheduleAnswerAdvance(result)
    })

    $('#diag-no').off().on('click', () => {
        var result = runner.currentResult()
        if (!result) return
        result.user_answer = false
        // Override result to fail if user says no
        result.result = 'fail'
        TELEMETRY.log('diag_user_answer', { test_id: result.test_id, answer: false })
        showResultBadge(result)
        logDiagnosticResult(result)
        $question.hide()
        scheduleAnswerAdvance(result)
    })

    // Start the runner
    runner.start()
}

//
// CHECK MEDIA
//
PAGES['preload'] = (p) => {
    // Check loaded media
    PARCOURS.load(p.file).then(() => 
    {
        let dlNeeded = PARCOURS.state.mediaPackSize - PARCOURS.state.mediaPackLoaded
        if (dlNeeded == 0) PAGE('load', false);
        else PAGE('confirmload', dlNeeded);
    })
    .catch(error => {
        console.error('Failed to load parcours data:', error);
        PAGE('nodata');
    })
    TYPEWRITE('preload-desc')
}

PAGES['confirmload'] = (dlNeeded) => {
    $('#confirmload-title').text(PARCOURS.info.name);
    
    dlNeeded = Math.round(dlNeeded / 1024.0 / 1024.0, 2);
    $('#confirmload-size').text(dlNeeded + ' Mo');

    // Confirm download
    $('#confirmload-accept').off().on('click', () => {
        PAGE('load', true);
    })
}

//
// DOWNLOAD MEDIA
//
PAGES['load'] = (showProgress) => {

    var progress = setInterval(() => {
        var p = PARCOURS.loadprogress();
        if (p > 0 && showProgress)
            $('#load-desc').text("Téléchargement en cours: " + p + "%");
    }, 500);

    PARCOURS.loadmedia().then(() => {
        clearInterval(progress);
        PARCOURS.store(); // Store parcours in localStorage
        PAGE('checkgeo')
    })
    .catch((error) => {
        clearInterval(progress);
        console.error('Media loading failed:', error);
        PAGE('nomedia')
    })
}

//
// GEOLOCATION
//
PAGES['checkgeo'] = () => {
    $('#checkgeo-select').hide();
    $('#checkgeo-settings').hide().off().on('click', () => GEO.showLocationSettings())

    var recheck = null;
    function checkGeo() {
        GEO.checkEnabled() 
            .then(() => {
                console.log('GEO ENABLED');
                clearTimeout(recheck);
                recheck = null;
                PAGE('confirmgeo')
            }) 
            .catch(() => {
                console.log('GEO DISABLED');
                $('#checkgeo-status').text('Vous devez activer la géolocalisation dans les paramètres de votre appareil pour continuer...');
                if (PLATFORM == 'ios') 
                    $('#checkgeo-status').append('<br><br>Réglages > Confidentialité > Services de localisation > Activez !');
                else if (PLATFORM == 'android') 
                    $('#checkgeo-settings').show();
                recheck = setTimeout(() => checkGeo(), 1000);
            })
    }

    if (!DEVMODE) {
    // if (false) {
        checkGeo()
    }
    else if (PARCOURS.geomode() == 'simulate') {
        GEO.simulateGeoloc()
        PAGE('rdv')
    }
    else if (PARCOURS.geomode() == 'gps') {
        checkGeo()
    }
    else {
        $('#checkgeo-select').show();
        $('#checkgeo-select-gps').off('click').on('click', () => {
            checkGeo()
        })
        $('#checkgeo-select-simul').off('click').on('click', () => {
            GEO.simulateGeoloc()
            PAGE('rdv')
        });
    }

    if (CHECKGEO) clearInterval(CHECKGEO);
    CHECKGEO = setInterval(() => {
        const gpsImg = document.getElementById('gps-status');
        gpsImg.src = gpsImg.src.replace(/gps-(on|off)\.png/, GEO.alive() ? 'gps-on.png' : 'gps-off.png');
    }, 1000);
}

var retryAuth = 0;
PAGES['confirmgeo'] = () => {
    $('#confirmgeo-settings').hide().off().on('click', () => GEO.showAppSettings())

    // if (PLATFORM == 'ios') 
    //     $('#confirmgeo-desc').append('<br><br>Réglages > Confidentialité > Services de localisation > Activez !');
    // if (PLATFORM == 'android') 
        // $('#confirmgeo-desc').text('Vous devrez autoriser l\'application et');

    if (retryAuth > 0) {
        if (PLATFORM == 'ios') {
            $('#confirmgeo-desc').html(`Vous devez régler l'autorisation de Localisation sur <u>"Toujours"</u> dans les réglages de votre appareil !
                <br><br>Réglages > Confidentialité > Services de localisation > Flanerie > "Toujours"`);
            $('#confirmgeo-settings').show().text('Réglages')
        }
        else if (PLATFORM == 'android') {
            $('#confirmgeo-desc').html(`Vous devez donnez les permissions "Localisation" et "Notifications" à l'application Flanerie dans les paramètres de votre appareil !
                <br><br>Réglages > Applications > Flanerie > Permissions > "Localisation" et "Notifications"`);
            $('#confirmgeo-settings').show().text('Paramètres')
        }
        $('#confirmgeo-accept').hide()
    }
    
    var recheck = null;
    function checkAuth() {
        GEO.checkAuthorized()
            .then(() => {
                console.log('GEO AUTHORIZED');
                clearTimeout(recheck);
                PAGE('startgeo')
            })
            .catch((e) => {
                console.log('GEO NOT AUTHORIZED', e);
                if (e === 'gps-error-authorization' && PLATFORM === 'ios') {
                    // User picked "While Using App" — iOS initial dialog has no "Always" option.
                    // Show guidance immediately instead of silently polling.
                    $('#confirmgeo-desc').html(`Vous avez autorisé la localisation <u>"Pendant l'utilisation"</u>. Pour fonctionner lorsque le téléphone est en poche écran éteint, l'application a besoin de l'autorisation <u>"Toujours"</u>.<br><br>Réglages > Confidentialité > Services de localisation > Flanerie > <u>"Toujours"</u>`);
                    $('#confirmgeo-settings').show().text('Réglages');
                    $('#confirmgeo-accept').hide();
                }
                recheck = setTimeout(() => checkAuth(), 1000);
            })
    }
    checkAuth()

    $('#confirmgeo-accept').off().on('click', () => {
        if (PLATFORM == 'android') {
            alert('Vous devrez également autoriser les notifications pour que la localisation fonctionne en arrière plan !');
        }
        clearTimeout(recheck);
        PAGE('startgeo')
    })
}

PAGES['startgeo'] = () => {
    GEO.startGeoloc()
            .then(()=>{
                // iOS: AUTHORIZED here already implies "Toujours" (startGeoloc rejects on partial auth),
                // so the old confirmios reminder is redundant — go straight to motion check.
                if (PLATFORM == 'ios') PAGE('checkmotion')
                else if (PLATFORM == 'android') PAGE('checkbgloc')
                else PAGE('rdv')
            })
            .catch((e)=>{
                retryAuth++;
                PAGE('confirmgeo')
            })
}

//
// CHECK BACKGROUND LOCATION (Android 10+)
// bg-geo's checkStatus reports AUTHORIZED based on FINE/COARSE alone, so a user
// who picked "While using" passes startGeoloc — but BG tracking will die at lock.
// Block startup here until ACCESS_BACKGROUND_LOCATION is granted.
//
PAGES['checkbgloc'] = () => {
    clearBgLocCheck();
    $('#checkbgloc-retry').hide().off();
    $('#checkbgloc-settings').off().on('click', () => GEO.showAppSettings());

    var attempts = 0;
    var firstFail = true;

    function queueRetry() {
        $('#checkbgloc-retry').show().off().on('click', () => { clearBgLocCheck(); check(); });
        clearBgLocCheck();
        BGLOC_TIMER = setTimeout(check, BGLOC_POLL_MS);
    }

    function check() {
        BGLOC_TIMER = null;
        if (currentPage !== 'checkbgloc') return;

        GEO.checkBackgroundLocationAndroid()
            .then(() => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('bg_location', {granted: true, attempts});
                PAGE('checknotifications');
            })
            .catch(() => {
                attempts++;
                if (firstFail) {
                    firstFail = false;
                    // First attempt: ask the system. Android 10 may show the dialog;
                    // Android 11+ silently denies (must use Settings).
                    if (cordova.plugins && cordova.plugins.permissions && cordova.plugins.permissions.ACCESS_BACKGROUND_LOCATION) {
                        cordova.plugins.permissions.requestPermission(
                            cordova.plugins.permissions.ACCESS_BACKGROUND_LOCATION,
                            (s) => {
                                if (s.hasPermission) check();
                                else queueRetry();
                            },
                            () => queueRetry()
                        );
                        return;
                    }
                }
                queueRetry();
            });
    }
    check();
}

//
// CHECK MOTION (iOS)
// CMMotionActivityManager is started by bg-geo, but the auth prompt result is
// not surfaced. Without motion events, stationary detection breaks and the
// GPS-lost overlay fires spuriously during pocketed pauses. Hard-block until
// the first 'activity' event arrives, with a Settings deep link as escape.
//
PAGES['checkmotion'] = () => {
    clearMotionCheck();
    $('#checkmotion-desc').text('Vérification du capteur de mouvement...');
    $('#checkmotion-settings').hide().off().on('click', () => GEO.showAppSettings());
    $('#checkmotion-retry').hide().off().on('click', () => { clearMotionCheck(); start = Date.now(); poll(); });

    // Already received a motion event from a previous startGeoloc cycle? skip.
    if (GEO.motionAuthorized) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: true, waited_ms: 0});
        return PAGE('rdv');
    }

    var start = Date.now();
    var warningShown = false;
    function poll() {
        MOTION_TIMER = null;
        if (currentPage !== 'checkmotion') return;
        if (GEO.motionAuthorized) {
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: true, waited_ms: Date.now() - start});
            return PAGE('rdv');
        }
        if (!warningShown && Date.now() - start >= MOTION_WAIT_MS) {
            warningShown = true;
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: false, waited_ms: Date.now() - start});
            $('#checkmotion-desc').html(
                "Flanerie a besoin du capteur de mouvement pour détecter vos pauses pendant la marche.<br /><br />" +
                "Sans cette autorisation, des fausses alertes \"GPS perdu\" se déclencheront en poche.<br /><br />" +
                "Réglages > Flanerie > <u>Mouvement et forme</u>"
            );
            $('#checkmotion-settings').show();
            $('#checkmotion-retry').show();
        }
        MOTION_TIMER = setTimeout(poll, warningShown ? 1000 : 500);
    }
    poll();
}

PAGES['checknotifications'] = () => {
    const defaultMessage = 'Vous devez autoriser les notifications pour que la localisation fonctionne en arrière plan.<br /><br />Aucune notification ne vous sera envoyée.';
    const timeoutMessage = 'Les notifications ne sont toujours pas autorisées.<br /><br />Ouvrez les paramètres, activez les notifications pour Flanerie, puis revenez dans l\'application. Sans cette autorisation, le fonctionnement en arrière plan ne sera pas fiable.';
    const permissions = cordova.plugins.permissions;

    clearNotificationPermissionCheck();
    $('#checknotifications-desc').html(defaultMessage);
    $('#checknotifications-retry').hide().off();

    // Not Android or no permissions plugin: skip notifications, still check battery opt
    if (PLATFORM != 'android' || cordova.plugins.permissions == undefined)
        return PAGE('checkbatteryopt');

    // Check Android version >= 13 (POST_NOTIFICATIONS required since API 33)
    var apiLevel = parseInt(device.version.split('.')[0], 10);
    if (apiLevel < 13) return PAGE('checkbatteryopt');

    $('#checknotifications-settings').show().off().on('click', () => GEO.showAppSettings());
    let permissionRequested = false;
    var notifStartTime = Date.now();

    function queueCheck() {
        NOTIF_PERMISSION_TIMER = setTimeout(checkNotif, NOTIF_PERMISSION_POLL_MS);
    }

    function maybeRequestPermission() {
        if (permissionRequested) return;
        permissionRequested = true;

        if (typeof permissions.requestPermission !== 'function') return;

        permissions.requestPermission(permissions.POST_NOTIFICATIONS, function(status) {
            console.log('Notification permission request result:', status.hasPermission);
        }, function(error) {
            console.warn('Notification permission request failed:', error);
        });
    }

    function checkNotif() {
        NOTIF_PERMISSION_TIMER = null;
        if (currentPage !== 'checknotifications') return;
        permissions.checkPermission(permissions.POST_NOTIFICATIONS, function(status) {
            console.log('Notification permission status:', status.hasPermission);
            if (status.hasPermission) {
                if (APP_VISIBILITY == 'foreground') {
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('notif_permission', {granted: true, elapsed: Date.now() - notifStartTime});
                    PAGE('checkbatteryopt');
                } else {
                    queueCheck();
                }
                return;
            }

            NOTIF_PERMISSION_ATTEMPTS++;
            if (NOTIF_PERMISSION_ATTEMPTS === 1) maybeRequestPermission();

            if (NOTIF_PERMISSION_ATTEMPTS >= NOTIF_PERMISSION_MAX_ATTEMPTS) {
                $('#checknotifications-desc').html(timeoutMessage);
                $('#checknotifications-retry').show().off().on('click', () => {
                    clearNotificationPermissionCheck();
                    $('#checknotifications-desc').html(defaultMessage);
                    $('#checknotifications-retry').hide();
                    checkNotif();
                });
                return;
            }

            queueCheck();
        }, function(e) {
            console.error('Error checking notification permission', e);
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('notif_permission', {granted: false, reason: 'error', error: String(e)});
            return PAGE('rdv');
        });
    }
    checkNotif();
}

// Manufacturer family detection — Doze whitelist alone is rarely enough on
// OEM-modified Android. We show tailored Settings instructions per family.
function batteryKillFamily() {
    if (typeof device === 'undefined' || !device.manufacturer) return null;
    var m = device.manufacturer.toLowerCase();
    if (m.includes('samsung')) return 'samsung';
    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return 'xiaomi';
    if (m.includes('huawei')) return 'huawei';
    if (m.includes('honor')) return 'honor';
    if (m.includes('oneplus')) return 'oneplus';
    if (m.includes('oppo') || m.includes('realme')) return 'oppo';
    if (m.includes('vivo')) return 'vivo';
    if (m.includes('asus')) return 'asus';
    return null;
}

function batteryKillCopy(family) {
    switch(family) {
        case 'samsung': return {
            title: 'Réglages Samsung',
            steps:
                "Maintenance > Batterie > Limites d'utilisation en arrière-plan > <u>Apps en veille profonde</u>: retirez Flanerie de la liste.<br /><br />" +
                "Apps > Flanerie > Batterie: choisir <u>Non restreint</u>."
        };
        case 'xiaomi': return {
            title: 'Réglages Xiaomi / Redmi / POCO',
            steps:
                "Sécurité > Autorisations > <u>Démarrage automatique</u>: activez Flanerie.<br /><br />" +
                "Économiseur de batterie > Choisir des apps > Flanerie: <u>Pas de restrictions</u>.<br /><br />" +
                "Verrouillez Flanerie dans les apps récentes (icône cadenas)."
        };
        case 'huawei':
        case 'honor': return {
            title: 'Réglages Huawei / Honor',
            steps:
                "Batterie > Lancement d'apps > Flanerie: passer en <u>Manuel</u>, puis activer <u>Démarrage automatique</u> + <u>Démarrage secondaire</u> + <u>Exécution en arrière-plan</u>."
        };
        case 'oneplus': return {
            title: 'Réglages OnePlus',
            steps:
                "Batterie > Optimisation de la batterie > Flanerie: <u>Ne pas optimiser</u>.<br /><br />" +
                "Batterie > Optimisation avancée: <u>Désactiver</u> l'optimisation en veille profonde si présente."
        };
        case 'oppo': return {
            title: 'Réglages Oppo / Realme',
            steps:
                "Batterie > Optimisation de la batterie > Flanerie: <u>Ne pas optimiser</u>.<br /><br />" +
                "Confidentialité > Démarrage > Flanerie: <u>Autoriser</u>."
        };
        case 'vivo': return {
            title: 'Réglages Vivo',
            steps:
                "Batterie > Consommation en arrière-plan > Flanerie: <u>Haute priorité</u>.<br /><br />" +
                "Démarrage automatique: activer Flanerie."
        };
        case 'asus': return {
            title: 'Réglages Asus',
            steps: "Gestionnaire de démarrage automatique > Flanerie: <u>Autorisé</u>."
        };
        default: return null;
    }
}

//
// CHECK BATTERY OPTIMIZATION (Android 6+ / API 23+)
// Requires: snt1017/cordova-plugin-power-optimization
// Hard-blocks startup until the app is whitelisted from Android battery optimization.
// OEM-specific guidance is rendered up front based on Build.MANUFACTURER, since
// Doze whitelist (the only thing the plugin can verify) is not enough on most
// modern OEM Androids.
//
PAGES['checkbatteryopt'] = () => {
    if (DEVMODE) return PAGE('rdv');

    const plugin = (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.PowerOptimization)
        ? cordova.plugins.PowerOptimization : null;

    if (!plugin || PLATFORM !== 'android' || typeof device === 'undefined') return PAGE('rdv');

    var apiLevel = parseInt(device.version.split('.')[0], 10);
    if (apiLevel < 23) return PAGE('rdv');

    clearBatteryOptCheck();
    var family = batteryKillFamily();
    var oemCopy = family ? batteryKillCopy(family) : null;

    // The plugin's RequestOptimizationsMenu has an inverted conditional and only
    // opens the system page when the app is already whitelisted — useless when
    // we actually need it. Use bg-geo's showAppSettings (app details page) instead.
    $('#checkbatteryopt-settings').hide().off().on('click', () => GEO.showAppSettings());
    $('#checkbatteryopt-oem-btn').hide().off().on('click', () => {
        // ProtectedAppCheck(true) fires the OEM intent if any is callable.
        // If none (modern OEMs that no longer expose intents), fall back to app settings.
        plugin.ProtectedAppCheck(true).catch(() => GEO.showAppSettings());
    });
    $('#checkbatteryopt-retry').hide().off().on('click', () => { clearBatteryOptCheck(); check(); });
    $('#checkbatteryopt-oem').hide();

    // Render manufacturer-tailored copy up front, before the user can fail.
    if (oemCopy) {
        $('#checkbatteryopt-oem').show().html('<b>' + oemCopy.title + '</b><br /><br />' + oemCopy.steps);
        $('#checkbatteryopt-oem-btn').show();
    }

    // Also probe the plugin's intent table — covers a few older OEM activities
    // not in our manufacturer match. Show the deep-link button if any are callable.
    // bug-fix: HaveProtectedAppsCheck returns {skip_message, found_intent}, not a boolean.
    plugin.HaveProtectedAppsCheck()
        .then(result => {
            if (!result || !result.found_intent) return;
            if (currentPage !== 'checkbatteryopt') return;
            if (!oemCopy) {
                // Manufacturer not in our table but OS exposes an OEM activity: generic banner.
                $('#checkbatteryopt-oem').show().text(
                    "Votre téléphone a des réglages de batterie spécifiques. Ouvrez les paramètres fabricant et autorisez Flanerie en arrière-plan."
                );
            }
            $('#checkbatteryopt-oem-btn').show();
        })
        .catch(() => {});

    var dialogShown = false;
    function check() {
        BATTOPT_TIMER = null;
        if (currentPage !== 'checkbatteryopt') return;

        plugin.IsIgnoringBatteryOptimizations()
            .then(isIgnoring => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { ignoring: isIgnoring, manufacturer: device.manufacturer, family, apiLevel });
                if (isIgnoring) { PAGE('rdv'); return; }

                // First failure: trigger native dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                if (!dialogShown) {
                    dialogShown = true;
                    plugin.RequestOptimizations()
                        .catch(() => $('#checkbatteryopt-settings').show()); // fallback if dialog unavailable
                }

                BATTOPT_ATTEMPTS++;
                if (BATTOPT_ATTEMPTS >= BATTOPT_MAX_ATTEMPTS) {
                    $('#checkbatteryopt-retry').show();
                    $('#checkbatteryopt-settings').show();
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { blocked: true, manufacturer: device.manufacturer, family });
                    return;
                }
                BATTOPT_TIMER = setTimeout(check, BATTOPT_POLL_MS);
            })
            .catch(error => {
                console.error('[BATTOPT] check error:', error);
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { error: String(error) });
                PAGE('rdv');
            });
    }

    check();
}

//
// RENDEZ-VOUS
//
PAGES['rdv'] = () => {

    // PARCOURS resume
    if (PARCOURS.valid() && PARCOURS.currentStep() >= 0) return PAGE('parcours');

    $('#rdvdistance').hide()

    var checkpos = setInterval(() => {
        if (PLATFORM != 'browser' && !GEO.ready()) return;
        let d = PARCOURS.find('steps', 0).distanceToBorder(GEO.position())
        $('#rdvdistance').show().text('Distance: '+Math.round(d) + ' m');
        clearInterval(checkpos);
        $('#rdv-accept').show() 
        $('#rdvdistance').hide()
    }, 1000);

    // $('#rdv-desc').empty()
    TYPEWRITE('rdv-desc')
        .typeString('Rendez-vous le jour J au point de départ qui vous aura été indiqué.')
        .callFunction(() => {
            $('#rdvdistance').show()
        })

    $('#rdv-accept').hide().off().on('click', () => {
        clearInterval(checkpos);
        PAGE('checkaudio')
    })

    if (DEVMODE) PAGE('checkaudio')
}

//
// CHECK AUDIO
//
var testplayer = null;
PAGES['checkaudio'] = () => {
    $('#checkaudio-accept').hide()
    $('#checkaudio-help').hide()

    // Tear down any previous instance before creating a new one
    if (testplayer) { testplayer.stop(); testplayer.clear(); testplayer = null; }

    let ok = true;

    // Use PlayerSimple so the test exercises the same backend (NativeMediaPlayer on iOS,
    // Howler on Android/browser) that will be used during the walk.
    testplayer = new PlayerSimple(true, 0)
    testplayer.on('loaderror', (src, error) => {
        console.log('[AUDIO] loaderror', src, error)
        ok = false
        $('#checkaudio-accept').hide()
        $('#checkaudio-help').hide()
        $('#checkaudio-desc').text("Erreur de lecture audio. Votre appareil ne semble pas compatible...");
        $('#checkaudio-desc').css('color', 'red');
    })
    testplayer.on('playerror', (src, error) => {
        console.log('[AUDIO] playerror', src, error)
        ok = false
        $('#checkaudio-accept').hide()
        $('#checkaudio-help').hide()
        $('#checkaudio-desc').text("Erreur de lecture audio. Votre appareil ne semble pas compatible...");
        $('#checkaudio-desc').css('color', 'red');
    })
    testplayer.on('play', (src) => { console.log('[AUDIO] OK!', src); })

    console.log('[AUDIO] testing via PlayerSimple, basepath:', BASEURL+'/images/');
    testplayer.load(BASEURL+'/images/', {src: 'test.mp3', master: 1}, false)
    testplayer.play(0)

    TYPEWRITE('checkaudio-desc')
        .pauseFor(4000)
        .callFunction(() => {
            if (ok) {
                $('#checkaudio-accept').show()
                $('#checkaudio-help').show()
            }
        })

    $('#checkaudio-accept').off().on('click', () => {
        testplayer.stop();
        testplayer.clear()
        testplayer = null;
        PAGE('checkbattery')
    })

    $('#checkaudio-help').off().on('click', () => {
        alert('Demandez de l\'aide à un membre de l\'équipe !');
    })

    if (DEVMODE) $('#checkaudio-accept').show()
}

//
// CHECK BATTERY
//
PAGES['checkbattery'] = () => {
    
    if (BATTERY > 0 && BATTERY < 30) {
        console.warn('[BATTERY] LOW:', BATTERY);
        alert('Attention, votre batterie est faible ! Pensez à la charger avant de commencer le parcours..')
    }
    else console.log('[BATTERY] OK:', BATTERY);
    PAGE('checkbackground')
}

//
// CHECK BACKGROUND
//
PAGES['checkbackground'] = () => PAGE('sas')

//
// SAS
//
PAGES['sas'] = () => {
    $('#sas-code').hide()

    TYPEWRITE('sas-desc')
    .pauseFor(2000)
    .callFunction(() => {
        $('#sas-desc').text("Entrez dans le sas ...")
        $('#sas-code').show()
        $('#sas-accept').show() 
        $('#sas-help').show()
        $('#sas-code').off()
            .on('blur', () => {
                $('#sas-code').focus()
            })
            .on('keypress', (e) => {
                if (e.keyCode == 13) { // Enter key
                    e.preventDefault();
                    checkCode();
                }
            });
    })
    
    function checkCode() {
        let code = $('#sas-code').val();
        $('#sas-accept').attr('disabled', true)
        $('#sas-code').attr('disabled', true)
        setTimeout(() => {
            if (code == '4321') {
                $('#sas-code').off().blur()
                PAGE('parcours')
            }
            else {
                $('#sas-help').click()
                $('#sas-code').attr('disabled', false).val('').focus() 
            }
            $('#sas-accept').attr('disabled', false)
        }, 1000)
    }

    $('#sas-accept').hide().off().on('click', () => checkCode())
    $('#sas-help').hide().off().on('click', () => alert('Le code se trouve dans le sas de départ !'));

    if (DEVMODE) PAGE('parcours')
}

//
// PARCOURS
//
var SILENT_PLAYER = new PlayerSimple(true, 0);
SILENT_PLAYER.load(BASEURL+'/images/', {src: 'flanerie.mp3', master: 1}, false);

PAGES['parcours'] = () => {

    SILENT_PLAYER.play(); // Play silent track to keep audio session alive
    scheduleWakeupNotification();
    
    if (testplayer) {
        testplayer.stop();
        testplayer.clear();
        testplayer = null;
    }

    console.log('PARCOURS', PARCOURS);
    // if (!PARCOURS.valid()) return PAGE('select')

    resumeAudioContext('parcours');

    var isResume = PARCOURS.valid() && PARCOURS.currentStep() >= 0;

    // MAP
    var MAP = initMap('parcours-map', {
            zoom: 19,
            maxZoom: 19,
            zoomControl: false,
            dragging: false,
        })
    
    PARCOURS.hideSpotMarkers() // hide all markers

    // DEV: show
    if (DEVMODE) {
        PARCOURS.showSpotMarkers('offlimits');
        PARCOURS.showSpotMarkers('steps');
    } 

    // Function to update markers
    function updateStepsMarkers() {

        // Mark passed steps in grey, current step in red
        PARCOURS.spots.steps.forEach((s, i) => {
            if (i < PARCOURS.currentStep()) {
                s.showMarker(COLOR_DONE, 0.5)
            }
            else if (i == PARCOURS.currentStep()) {
                s.showMarker(COLOR_CURRENT, 0.5)
            }
        })

        // Show next steps in yellow
        let i = PARCOURS.currentStep() + 1;
        let sNext = PARCOURS.find('steps', i)
        while (sNext) {
            sNext.showMarker(COLOR_NEXT)
            if (!DEVMODE && !sNext._spot.optional) break;
            i++;
            // if (!DEVMODE) break;    // show only next step in normal mode
            sNext = PARCOURS.find('steps', i)
        }
    }

    // ON step fire: show next
    PARCOURS.on('fire', (s, meta = {}) => {
        if (s._type != 'steps') return
        if (!meta.refire) TELEMETRY.log('step_fire', {step: s._index, name: s._spot.name});
        updateStepsMarkers()

        // First step
        if (s._index == 0) {
            $('#parcours-init').hide()
            $('#parcours-run').show()
            TYPEWRITE('parcours-run')

            // Show objects
            // if (PARCOURS.spots.zones) 
            //     PARCOURS.spots.zones.map(z => z.showMarker())
        }

        // Hide map
        if (!DEVMODE && s._index==PARCOURS.currentStep() && !isResume) {
            $('#parcours-map').css('opacity', 0)
            setTimeout(() => {
                $('#parcours-lost').show()
            }, 5000)
        }

        // Last step: prepare GPS cutoff
        if (PARCOURS.currentStep() + 1 == PARCOURS.spots.steps.length) {
            if (PARCOURS.info.cutoff === undefined || PARCOURS.info.cutoff <= 0) return;
            console.log('LAST STEP: prepare GPS cutoff in '+PARCOURS.info.cutoff+' seconds');
            setTimeout(() => {
                if (PARCOURS.currentStep() + 1 == PARCOURS.spots.steps.length) {
                    console.log('LAST STEP: cut GPS');
                    PARCOURS.stopTracking()
                }
            }, PARCOURS.info.cutoff * 1000); // seconds
        }

        isResume = false;
    })

    // ON step done: hide
    PARCOURS.on('done', (s) => {
        if (s._type != 'steps') return
        TELEMETRY.log('step_done', {step: s._index, name: s._spot.name});
        s.showMarker(COLOR_DONE, 0.5)

        // Last step
        if (s._index + 1 == PARCOURS.spots.steps.length) {
            console.log('END OF PARCOURS')
            TELEMETRY.end();
            if (walkEndTimeout) clearTimeout(walkEndTimeout);
            if (!DEVMODE) PAGE('end')
        }
    })

    // Safety: if last step fires but done never comes (audio load failure), end after 5 minutes
    var walkEndTimeout = null;
    PARCOURS.on('fire', function onLastStepFire(s) {
        if (s._type != 'steps') return
        if (s._index + 1 == PARCOURS.spots.steps.length) {
            walkEndTimeout = setTimeout(() => {
                if (currentPage === 'parcours' && PARCOURS.currentStep() + 1 == PARCOURS.spots.steps.length) {
                    console.warn('Walk end timeout: last step done event never received, ending parcours');
                    TELEMETRY.log('walk_end_timeout', {step: s._index, name: s._spot.name});
                    TELEMETRY.end();
                    if (!DEVMODE) PAGE('end');
                }
            }, 5 * 60 * 1000); // 5 minutes
        }
    })

    // Offlimit telemetry
    PARCOURS.on('enter', (s) => {
        if (s._type === 'offlimits') TELEMETRY.log('offlimit_enter', {name: s._spot.name, step: PARCOURS.currentStep()});
    })
    PARCOURS.on('leave', (s) => {
        if (s._type === 'offlimits') TELEMETRY.log('offlimit_leave', {name: s._spot.name, step: PARCOURS.currentStep()});
    })

    // INIT PARCOURS
    //

    // Info
    $('#parcours-title').toggle(!DEVMODE)
    $('#parcours-title-dev').text(PARCOURS.info.name).toggle(DEVMODE)
    $('#parcours-run').hide()

    // Lost button
    $('#parcours-lost').hide().off().on('click', () => {
        console.log('LOST');
        $('#parcours-map').css('opacity', 1)
        $('#parcours-lost').hide()
    })

    // Activate Parcours
    PARCOURS.startTracking()
    TELEMETRY.start(
        PARCOURS.info.file || PARCOURS.info.id || PARCOURS.info.name || '',
        PARCOURS.info.name || PARCOURS.info.file || PARCOURS.info.id || ''
    );

    // First RUN
    if (PARCOURS.currentStep() < 0) {
        console.log('FIRST RUN')
        TYPEWRITE('parcours-init')
        PARCOURS.find('steps', 0).showMarker(COLOR_NEXT)
    }

    // RESUME
    else if (PARCOURS.valid() && PARCOURS.currentStep() >= 0)
    {
        console.log('RESUME PARCOURS', PARCOURS.currentStep());
        $('#parcours-init').hide()
        $('#parcours-run').show()
        // TYPEWRITE('parcours-run')
        updateStepsMarkers()
    }    

    // SIMULATION: set GEO position to 10m from parcours start
    if (GEO.mode() == 'simulate') 
    {
        // Set fake position
        var position = PARCOURS.find('steps', 0).getCenterPosition()
        // position[0] += 0.0004
        console.log('SET POSITION', position)
        GEO.setPosition(position)
    }

    // Show ME
    GEO.followMe()
    MAP.toPosition(true)
    MAP.showPositionMarker()
}


//
// END
//
PAGES['end'] = () => {

    // Cleanup: stop all background audio
    PARCOURS.stopAudio();
    GPSLOST_PLAYER.stop();
    SILENT_PLAYER.stop();
    if (testplayer) { testplayer.stop(); testplayer.clear(); testplayer = null; }

    var ending = true
    function end() {
        if (!ending) return;
        TYPEWRITE('parcours-end')
            .typeString('La balade est terminée.')
            .pauseFor(2000)
            .deleteAll()
            .typeString('Enlève tes écouteurs ...')
            .pauseFor(5000)
            .deleteAll()  
            .callFunction(() => end())
    }
    end();
    
}


// START
PAGE('title');   
// PAGE('checkgeo');

// TAP RELOAD // DEVMODE // RESTART
var taps = 0;
var tapZone = null;
var tapTimeout = null;
var tapLocked = false;
$('body').off('click').on('click', (e) => {
    if (tapLocked) return;
    // On Title page: split top/bottom zones
    if (currentPage == 'title') {
        let zone = (e.clientY < window.innerHeight / 2) ? 'top' : 'bottom';
        if (zone != tapZone) { taps = 0; tapZone = zone; }
        taps++;
        if (taps == 5) {
            if (zone == 'top') devmode(!DEVMODE);
            else {
                console.log('RESTART (tap)');
                TELEMETRY.log('session_restart_click', {reason: 'restart_tap'});
                TELEMETRY.end();
                PARCOURS.clearStore();
                tapLocked = true;
                setTimeout(() => { alert('Application réinitialisée'); location.reload(); }, 300);
            }
        }
    }
    // On other pages: reload after 5 taps
    else {
        taps++;
        if (taps == 5) location.reload();
    }
    if (tapTimeout) clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => { taps = 0; tapZone = null; }, 300);
})

// DEV MODE
function devmode(dev) 
{
    // save
    if (dev != DEVMODE) {
        DEVMODE = dev
        localStorage.setItem('devmode', DEVMODE);
        console.log('DEVMODE', DEVMODE);
    }

    // apply
    if (DEVMODE) {
        $('body').css('border-color', 'pink');
        $('.dev').show();
    }
    else {
        $('body').css('border-color', 'black');
        $('.dev').hide();
    }
}
devmode(DEVMODE);

// DEV TOOLS
$('#parcours-rearm').click(() => {
    console.log('REARM');
    TELEMETRY.restart(
        'rearm_button',
        PARCOURS.info.file || PARCOURS.info.id || PARCOURS.info.name || '',
        PARCOURS.info.name || PARCOURS.info.file || PARCOURS.info.id || ''
    );
    PARCOURS.currentStep(-2) // Reset current step
    PARCOURS.startTracking()
    PARCOURS.stopAudio()

    // set all steps markers to yellow
    PARCOURS.spots.steps.forEach((s, i) => {
        s.showMarker(COLOR_NEXT)
    })

    setTimeout(() => document.MAP.fire('move'), 2000)
})

$('#parcours-restart').click(() => {
    console.log('RESTART');
    TELEMETRY.log('session_restart_click', {reason: 'restart_button'});
    TELEMETRY.end();
    PARCOURS.clearStore();
    setTimeout(() => { alert('Application réinitialisée'); location.reload(); }, 300);
});


// SIDEBAR: translate 0 on swipe left, hide on click
$('#logs-title').on('click', (e) => {
    let sidebar = $('#sidepanel')[0];
    // if translate > 0 -> show sidebar else hide
    if (sidebar.style.transform == 'translateY(0px)') {
        sidebar.style.transform = 'translateY(95%)';
        $('#logs').scrollTop($('#logs')[0].scrollHeight)
    } else {
        sidebar.style.transform = 'translateY(0px)';
        $('#logs').scrollTop($('#logs')[0].scrollHeight)
    }
});

// GPS LOST
var GPSLOST_PLAYER = new PlayerSimple(true, 0);
GPSLOST_PLAYER.load(BASEURL+'/images/', {src: 'gpslost.mp3', master: 1}, false);

GEO.stateUpdateTimeout = 30 * 1000; // 30s on all platforms — must exceed the 15s native keepalive interval

// Default GPS-lost copy (reset whenever we re-show the overlay for a transient signal loss).
const GPSLOST_TEXT_DEFAULT = 'Signal GPS perdu.<br/><br/>Déplacez-vous vers un espace dégagé.<br/>La progression reprend automatiquement dès le retour du signal.';

function setGpsLostOverlay(opts) {
    opts = opts || {};
    $('#gpslost-overlay-desc').html(opts.html || GPSLOST_TEXT_DEFAULT);
    if (opts.settings) $('#gpslost-settings').show();
    else $('#gpslost-settings').hide();
    $('#gpslost-overlay').css('display', 'flex');
}

function showGpsRevokedOverlay(reason) {
    if (currentPage !== 'parcours') return;
    GPSREVOKED = true;
    var html;
    if (reason === 'services') {
        html = "<b>GPS désactivé</b><br/><br/>La localisation a été coupée dans les réglages système. Réactivez-la pour continuer le parcours.";
    } else {
        html = "<b>Autorisation révoquée</b><br/><br/>Flanerie n'a plus accès à votre position. Ouvrez les paramètres et réactivez la localisation sur <u>Toujours autoriser</u>.";
    }
    TELEMETRY.log('gps_revoked', {reason, step: PARCOURS.currentStep()});
    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
    pauseAllPlayers();
    GPSLOST_PLAYER.play();
    setGpsLostOverlay({html, settings: true});
}

// Mid-walk health probe: when GPS goes lost, check whether services or auth
// were toggled off in settings — those need a dedicated overlay, not just
// "move to an open area".
function probeGpsHealth() {
    if (currentPage !== 'parcours') return;
    if (typeof BackgroundGeolocation === 'undefined') return;
    GEO.checkHealth().then((h) => {
        if (h.servicesEnabled === false) return showGpsRevokedOverlay('services');
        if (h.authorization !== null && h.authorization !== BackgroundGeolocation.AUTHORIZED) return showGpsRevokedOverlay('auth');
        if (h.bgLocationOk === false) return showGpsRevokedOverlay('auth');
    });
}

// Re-emitted by geoloc.js whenever the bg-geo plugin reports a non-AUTHORIZED status.
GEO.on('authorizationChanged', (status) => {
    console.warn('GEO authorizationChanged:', status);
    if (currentPage !== 'parcours') return;
    showGpsRevokedOverlay('auth');
});

// Mid-walk OEM-kill heuristic: count unexpected bg-geo service stops in a
// rolling window. Two stops within 5 min strongly suggests the OEM battery
// layer is killing the foreground service — escalate beyond a transient
// GPS-lost overlay with manufacturer-tailored copy.
var BG_STOP_HISTORY = [];
const BG_STOP_WINDOW_MS = 5 * 60 * 1000;
const BG_STOP_THRESHOLD = 2;

function showBatteryKillOverlay() {
    if (currentPage !== 'parcours') return;
    GPSREVOKED = true;
    var oem = batteryKillCopy(batteryKillFamily());
    var body = oem
        ? oem.steps
        : "Ouvrez les paramètres et désactivez les restrictions de batterie pour Flanerie, puis revenez à l'application.";
    var html = "<b>Restriction batterie détectée</b><br /><br />" +
               "Votre téléphone interrompt l'application en arrière-plan.<br /><br />" +
               body;
    TELEMETRY.log('battery_kill_overlay', {family: batteryKillFamily(), manufacturer: (typeof device !== 'undefined' ? device.manufacturer : null), step: PARCOURS.currentStep()});
    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
    pauseAllPlayers();
    GPSLOST_PLAYER.play();
    setGpsLostOverlay({html, settings: true});
}

GEO.on('bgServiceStop', (info) => {
    if (info && info.intentional) return;
    if (currentPage !== 'parcours') return;
    var now = Date.now();
    BG_STOP_HISTORY = BG_STOP_HISTORY.filter(t => now - t < BG_STOP_WINDOW_MS);
    BG_STOP_HISTORY.push(now);
    TELEMETRY.log('bg_stop_repeated', {count: BG_STOP_HISTORY.length, windowMs: BG_STOP_WINDOW_MS, step: PARCOURS.currentStep()});
    if (BG_STOP_HISTORY.length >= BG_STOP_THRESHOLD) showBatteryKillOverlay();
});

GEO.on('stateUpdate', (state) => {
    if (state == 'lost') {
        if (currentPage != 'parcours') return;                                  // only if on parcours page
        if (GEO.mode() == 'simulate') return;                                   // not in simulate mode
        if (PARCOURS.currentStep() == PARCOURS.spots.steps.length - 1) return;  // not if last step
        if (AUDIOFOCUS == 0) return;
        if (GEO.motionIsStationary) return;                                     // standing still — gap is expected, keepalive handles it
        console.warn('GEO lost position');
        TELEMETRY.log('gps_lost', {step: PARCOURS.currentStep()});
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        pauseAllPlayers();
        GPSLOST_PLAYER.play();
        setGpsLostOverlay();
        // Concurrent with the transient-loss overlay, probe system state.
        // If GPS was revoked in settings, the probe escalates to the revoked overlay.
        probeGpsHealth();
    }
    if (state == 'ok') {
        if (currentPage != 'parcours') return; // only if on parcours page
        if (AUDIOFOCUS == 0) return;
        console.log('GEO position ok');
        TELEMETRY.log('gps_recovered', {step: PARCOURS.currentStep()});
        if (navigator.vibrate) navigator.vibrate([200]);
        GPSREVOKED = false;
        GPSLOST_PLAYER.stop();
        resumeAllPlayers();
        $('#gpslost-overlay').hide();
    }
    console.log('GEO stateUpdate', state, currentPage, AUDIOFOCUS);
})

// Periodic mid-walk poll: catches the case where the user toggles services
// or auth in settings without leaving GPS-lost yet (e.g., disable then re-enable
// quickly). Cheap call, fires every 30s only while on the parcours page.
setInterval(() => {
    if (currentPage !== 'parcours') return;
    if (GEO.mode() == 'simulate') return;
    if (typeof BackgroundGeolocation === 'undefined') return;
    GEO.checkHealth().then((h) => {
        var revoked = (h.servicesEnabled === false) ||
                      (h.authorization !== null && h.authorization !== BackgroundGeolocation.AUTHORIZED) ||
                      (h.bgLocationOk === false);
        if (revoked && !GPSREVOKED) {
            showGpsRevokedOverlay(h.servicesEnabled === false ? 'services' : 'auth');
        }
        if (!revoked && GPSREVOKED) {
            GPSREVOKED = false;
            $('#gpslost-settings').hide();
            // stateUpdate('ok') will hide the overlay when a fix arrives
        }
    });
}, 30000);

$('#gpslost-resume').on('click', () => {
    TELEMETRY.log('gps_force_resume', {step: PARCOURS.currentStep()});
    GPSLOST_PLAYER.stop();
    resumeAllPlayers();
    $('#gpslost-overlay').hide();
})

$('#gpslost-settings').on('click', () => {
    TELEMETRY.log('gps_settings_open', {step: PARCOURS.currentStep()});
    GEO.showAppSettings();
})


/// NOTIFICATIONS TRIGGER
// Trigger a silent notification
// DISABLED: silent:true makes getBuilder() return null on Android so fireEvent("trigger") is never
// reached; on iOS trigger only fires in foreground. The chain delivers zero keepalive on either
// platform. Android keepalive = BackgroundGeolocation foreground service. iOS = UIBackgroundModes
// location. Set to true only to re-enable for debugging.
const NOTIF_CHAIN_ENABLED = false;
const NOTIF_REPEAT = 1 * 59 * 1000; // 59 seconds
var NOTIF_COUNTER = 37;
function scheduleWakeupNotification() {
    if (PLATFORM == 'ios') return  // iOS keepalive is location-based; notifications accumulate silently
    if (!NOTIF_CHAIN_ENABLED) return
    clearWakeupNotification(false)
    if (currentPage !== 'parcours') {
        clearWakeupNotification()
        return
    }
    if (PLATFORM != 'android') return
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.notification || !cordova.plugins.notification.local) {
        console.warn('NOTIF: cordova.plugins.notification.local not available, notifications will not work');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('notif_schedule', {ok: false, reason: 'plugin_missing'});
        return
    }

    cordova.plugins.notification.local.schedule({
        id: NOTIF_COUNTER,
        text: 'Flanerie en cours..',
        trigger: { at: new Date(Date.now() + NOTIF_REPEAT) },
        sound: null,
        silent: true,
        launch: false,
        foreground: false
    });

    NOTIF_TIMER = setTimeout(() => {
        NOTIF_TIMER = null;
        scheduleWakeupNotification()
    }, NOTIF_REPEAT);
    console.log('NOTIF: Scheduled next wakeup notification');
}

document.addEventListener('deviceready', () => {
    console.log('Device is ready');
    if (PLATFORM != 'android' && PLATFORM != 'ios') return

    // Listen for notification triggers to wake up JS context
    if (cordova && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local) {
        cordova.plugins.notification.local.clear(NOTIF_COUNTER, () => {
            console.log('NOTIF: cleared wakeup notification', NOTIF_COUNTER);
        });

        cordova.plugins.notification.local.on('trigger', function(notification) {
            if (notification.id == NOTIF_COUNTER) {
                console.log('NOTIF: Wakeup notification triggered, JS context awakened');

                // clear the notification
                cordova.plugins.notification.local.clear(notification.id, () => {
                    console.log('NOTIF: cleared wakeup notification', notification.id);
                });
                
                resumeAudioContext('notif_wakeup');

                // Schedule next notification directly (setTimeout is unreliable in background)
                if (currentPage === 'parcours') scheduleWakeupNotification();
            }
        });
    }
    
}, false);


