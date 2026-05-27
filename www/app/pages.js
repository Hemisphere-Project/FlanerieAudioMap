var DISTANCE_RDV = 20; // 20m (to validate RDV)

var COLOR_DONE    = 'grey';
var COLOR_FUTURE  = '#1a4a8a';
var COLOR_CURRENT = '#43FAF2';

var DEVMODE = localStorage.getItem('devmode') == 'true' || false;

// GLOBALS
//
var noSleep = null;
var CHECKGEO = null;
// PARCOURS event handlers registered by PAGES['parcours'] — tracked so they
// can be torn down on page exit (and not stacked on a page re-entry). The
// module-scope lost/recover handlers are NOT in here — those are intentionally
// permanent.
var PARCOURS_PAGE_HANDLERS = [];

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
var PARCOURS_BOOT_TOKEN = 0;
// On a resume (kill+relaunch mid-walk) motion was already validated before the
// walk started; GEO.motionAuthorized just resets to undefined on every reload.
// Don't hard-block a pocketed walker — give a short grace, then proceed.
// A genuine mid-walk revocation is caught by the P3.3d health monitoring.
const MOTION_RESUME_GRACE_MS = 3000;
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

function resetAudioSessionForFreshParcoursStart()
{
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.audiofocus ||
        typeof cordova.plugins.audiofocus.resetAudioSession !== 'function') {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        cordova.plugins.audiofocus.resetAudioSession(
            () => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_session_reset', {});
                // The native reset reactivates the session before the walk starts.
                // Mirror that in the JS gate so the first silent / zone-triggered
                // plays do not immediately fall back into requestFocus() again.
                if (typeof AUDIOFOCUS !== 'undefined') AUDIOFOCUS = 1;
                resolve(true);
            },
            (err) => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_session_reset_error', {error: String(err)});
                resolve(false);
            }
        );
    });
}

PAGES_CLEANUP['parcours']           = () => {
    clearWakeupNotification();
    stopGpsStatusPaint();
    clearTimeout(GPS_DOZE_TIMER);
    GPS_DOZE_TIMER = null;
    GPSLOST_PLAYER.stop();
    LOST_PLAYER.stop();
    RESUME_PLAYER.stop();
    $('#gpslost-overlay').hide();
    $('#lost-band').hide();
    // Close the recovery map cleanly so the next visit starts from a known state.
    if (typeof closeMapForRecovery === 'function') closeMapForRecovery({source: 'page_exit'});
    updateStepsMarkers = null;
    // Detach the parcours-page PARCOURS handlers so a re-entry doesn't stack them.
    PARCOURS_PAGE_HANDLERS.forEach(h => PARCOURS.off(h.event, h.fn));
    PARCOURS_PAGE_HANDLERS = [];
    // Release the audiofocus mediaPlayback keepalive — leaving the parcours
    // page (end or page-switch) means no more sustained audio is expected,
    // and a lingering foreground service after walk end is exactly the kind
    // of "battery hog" signal we don't want to give the OEM next session.
    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.audiofocus &&
        typeof cordova.plugins.audiofocus.stopKeepalive === 'function') {
        cordova.plugins.audiofocus.stopKeepalive(
            () => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_keepalive_stopped', {}); },
            (err) => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_keepalive_error', {phase: 'stop', error: String(err)}); }
        );
    }
};
PAGES_CLEANUP['checknotifications'] = () => clearNotificationPermissionCheck();
PAGES_CLEANUP['checkbatteryopt']    = () => clearBatteryOptCheck();
PAGES_CLEANUP['checkbgloc']         = () => clearBgLocCheck();
PAGES_CLEANUP['checkmotion']        = () => clearMotionCheck();
// #gps-status / #gps-precision live in the parcours page DOM, so the painter
// runs while we're on checkgeo (preparation) and on parcours (the walk).
// Stop it on every other page to avoid running it for the whole app lifetime.
function stopGpsStatusPaint() {
    if (CHECKGEO) { clearInterval(CHECKGEO); CHECKGEO = null; }
}
function startGpsStatusPaint() {
    stopGpsStatusPaint();
    CHECKGEO = setInterval(() => {
        const gpsImg = document.getElementById('gps-status');
        if (gpsImg) gpsImg.src = gpsImg.src.replace(/gps-(on|off)\.png/, GEO.alive() ? 'gps-on.png' : 'gps-off.png');

        // GPS precision badge: bucket-coloured, refreshed every tick alongside
        // the on/off icon. Hidden when no recent fix is known.
        const $prec = $('#gps-precision');
        let p = GEO && GEO.lastPosition;
        if (!GEO.alive() || !p || !p.coords || typeof p.coords.accuracy !== 'number') {
            $prec.attr('class', 'bucket-unknown').text('—');
        } else {
            let acc = Math.round(p.coords.accuracy);
            let bucket = typeof gpsAccuracyBucket === 'function' ? gpsAccuracyBucket(acc) : 'unknown';
            $prec.attr('class', 'bucket-' + bucket).text(acc + ' m');
        }
    }, 1000);
}
PAGES_CLEANUP['checkgeo']           = stopGpsStatusPaint;

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
    // PARCOURS resume — A6: opportunistic freshness check against the server
    // before reusing the cached parcours. If offline, fall through to the
    // cached version (the walk must work without data once preloaded).
    if (PARCOURS.valid()) {
        get('/list')
            .then(parcours => {
                try {
                    var match = parcours.find(p => p.file === PARCOURS.pID);
                    var serverTime = match ? new Date(match.time).getTime() : null;
                    var cachedTime = parseInt(localStorage.getItem('parcoursMTime_' + PARCOURS.pID) || '0', 10);
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('parcours_freshness_check', {
                        pID: PARCOURS.pID,
                        server_time: serverTime,
                        cached_time: cachedTime || null,
                        match_found: !!match,
                        stale: !!(serverTime && cachedTime && serverTime > cachedTime),
                    });
                    if (serverTime && cachedTime && serverTime > cachedTime) {
                        return PAGE('parcoursupdate', { match: match, serverTime: serverTime, cachedTime: cachedTime });
                    }
                } catch (e) { console.warn('Freshness check failed:', e); }
                PAGE('checkgeo');
            })
            .catch(() => PAGE('checkgeo'));  // offline → use cached
        return;
    }

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

PAGES['parcoursupdate'] = (ctx) => {
    var match = ctx && ctx.match ? ctx.match : null;
    var serverTime = ctx && ctx.serverTime ? ctx.serverTime : null;
    var cachedTime = ctx && ctx.cachedTime ? ctx.cachedTime : null;
    var detail = '';
    if (match && match.name) detail = 'Parcours: ' + match.name;
    if (serverTime) detail += (detail ? ' · ' : '') + 'Serveur: ' + new Date(serverTime).toLocaleString('fr-FR');
    if (cachedTime) detail += (detail ? ' · ' : '') + 'Local: ' + new Date(cachedTime).toLocaleString('fr-FR');
    $('#parcoursupdate-detail').text(detail);
    $('#parcoursupdate-refresh').off().on('click', () => {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('parcours_update_chosen', { action: 'refresh', pID: PARCOURS.pID });
        // Clear cached state and route through preload → load with the same pID.
        try { PARCOURS.clearStore(); } catch (e) {}
        PAGE('preload', match || { file: PARCOURS.pID });
    });
    $('#parcoursupdate-skip').off().on('click', () => {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('parcours_update_chosen', { action: 'skip', pID: PARCOURS.pID });
        PAGE('checkgeo');
    });
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

    // DEV: diagnostic + tools buttons
    $('#select-diagnostic').off().on('click', () => PAGE('diagnostic'));
    $('#select-tools').off().on('click', () => PAGE('tools'));

    // App version (operator-facing): shows the build number set by the
    // launcher (`document.APPVERSION` from cordova.getAppVersion). Useful
    // for support: walker reads the number to the operator before handing
    // the phone. Falls back gracefully outside Cordova (browser dev).
    var versionStr = '';
    if (typeof document.APPVERSION !== 'undefined' && document.APPVERSION) {
        versionStr = 'v' + document.APPVERSION;
    }
    if (typeof PLATFORM !== 'undefined' && PLATFORM) {
        versionStr = versionStr ? (versionStr + ' · ' + PLATFORM) : PLATFORM;
    }
    $('#select-version').text(versionStr);
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
// TOOLS (devmode only)
//
PAGES['tools'] = () => {
    if (!DEVMODE) return PAGE('select');

    let $out = $('#tools-output');
    $out.text('');
    function appendOutput(line) {
        let ts = new Date().toLocaleTimeString();
        $out.append('[' + ts + '] ' + line + '\n');
        $out.scrollTop($out[0].scrollHeight);
    }

    function activeStep() {
        if (typeof PARCOURS === 'undefined' || !PARCOURS.spots || !PARCOURS.spots.steps) return null;
        let idx = PARCOURS.currentStep();
        if (idx < 0) return null;
        return PARCOURS.find('steps', idx);
    }

    function nextStep() {
        if (typeof PARCOURS === 'undefined' || !PARCOURS.spots || !PARCOURS.spots.steps) return null;
        let idx = PARCOURS.currentStep();
        let candidate = idx < 0 ? 0 : idx + 1;
        return PARCOURS.find('steps', candidate);
    }

    // Force LOST: synthesize the same event evaluateLostState would emit.
    // Reuses the lost handler so band, vibration, audio gates all fire.
    $('#tools-force-lost').off().on('click', () => {
        let target = activeStep() && activeStep()._active ? activeStep() : nextStep();
        if (!target) { appendOutput('force-lost: no target step (parcours not started?)'); return; }
        if (PARCOURS.state.lost) { appendOutput('force-lost: already LOST'); return; }
        PARCOURS.state.lost = true;
        PARCOURS.state.lostSince = Date.now();
        PARCOURS._lostBeyondSince = null;
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('tools_force_lost', {step: PARCOURS.currentStep(), target: target._index});
        PARCOURS.emit('lost', {target, distance: 999});
        appendOutput('force-lost: emitted (target=' + target._spot.name + ')');
    });

    // Sortir de LOST: synthesize recover. Skips distance check.
    $('#tools-clear-lost').off().on('click', () => {
        if (!PARCOURS.state.lost) { appendOutput('clear-lost: not LOST'); return; }
        PARCOURS.state.lost = false;
        PARCOURS.state.lostSince = null;
        PARCOURS._lostBeyondSince = null;
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('tools_clear_lost', {step: PARCOURS.currentStep()});
        PARCOURS.emit('recover', {target: null, distance: 0});
        appendOutput('clear-lost: emitted recover');
    });

    // Force voice failure on the active step: emit playerror directly on the
    // step's voice player. Fix B's handler in PlayerStep will route through
    // startAfterplay so the LATE fallback can be observed end-to-end.
    $('#tools-force-voice-fail').off().on('click', () => {
        let s = activeStep();
        if (!s || !s.player || !s.player.voice) { appendOutput('force-voice-fail: no active step'); return; }
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('tools_force_voice_fail', {step: s._index});
        // Synthesize what PlayerSimple emits on a real failure.
        s.player.voice.emit('playerror', s.player.voice._src(), 'forced-by-tools');
        appendOutput('force-voice-fail: emitted playerror on step ' + s._index + ' (' + s._spot.name + ')');
    });

    // Force afterplay fallback: flip the step's afterplay to default and play it.
    // Useful to validate the DEFAULT_AFTERPLAY_PLAYER routing without breaking
    // the parcours' real afterplay data.
    $('#tools-force-afterplay-fallback').off().on('click', () => {
        let s = activeStep();
        if (!s || !s.player) { appendOutput('force-afterplay: no active step'); return; }
        if (typeof DEFAULT_AFTERPLAY_PLAYER === 'undefined' || !DEFAULT_AFTERPLAY_PLAYER.isLoaded()) {
            appendOutput('force-afterplay: DEFAULT_AFTERPLAY_PLAYER not loaded (images/afterplay.mp3 missing?)');
            return;
        }
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('tools_force_afterplay_fallback', {step: s._index});
        // Stop whatever's currently playing on this step, then route to default.
        if (s.player.voice) s.player.voice.stop();
        if (s.player.afterplay) s.player.afterplay.stop();
        s.player._defaultAfterplayActive = true;
        s.player.playstate = 'afterplay';
        s.player.state = 'afterplay';
        DEFAULT_AFTERPLAY_PLAYER.stop();
        DEFAULT_AFTERPLAY_PLAYER.play();
        appendOutput('force-afterplay: routed step ' + s._index + ' to DEFAULT_AFTERPLAY_PLAYER');
    });

    // Show resume overlay: simulate AUDIOFOCUS_LOSS so the periodic-retry
    // logic (Fix G) can be observed. Stay on the tools page and wait ~60s
    // — the retry interval allows currentPage === 'tools' in devmode.
    $('#tools-show-resume-overlay').off().on('click', () => {
        AUDIOFOCUS = 0;
        $('#resume-overlay').css('display', 'flex');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('tools_show_resume_overlay', {});
        appendOutput('resume-overlay: shown, AUDIOFOCUS=0 — retry should fire in ~60s');
    });

    // Snapshot: dump enough state to debug a stuck walker.
    $('#tools-snapshot').off().on('click', () => {
        let s = activeStep();
        let n = nextStep();
        let snap = {
            currentPage: typeof currentPage !== 'undefined' ? currentPage : null,
            AUDIOFOCUS: typeof AUDIOFOCUS !== 'undefined' ? AUDIOFOCUS : null,
            GPSSIGNAL_OK: typeof GPSSIGNAL_OK !== 'undefined' ? GPSSIGNAL_OK : null,
            GPSREVOKED: typeof GPSREVOKED !== 'undefined' ? GPSREVOKED : null,
            DEVMODE: DEVMODE,
            parcoursState: PARCOURS.state,
            activeStep: s ? {
                index: s._index,
                name: s._spot.name,
                active: s._active,
                done: s._done,
                playerState: s.player ? s.player.state : null,
                playstate: s.player ? s.player.playstate : null,
                defaultAfterplay: s.player ? s.player._defaultAfterplayActive : null,
            } : null,
            nextStep: n ? { index: n._index, name: n._spot.name } : null,
            playersPlaying: (typeof ALL_PLAYERS !== 'undefined' ? ALL_PLAYERS : []).filter(p => p.isPlaying()).map(p => p._src()),
            pausedPlayers: (typeof PAUSED_PLAYERS !== 'undefined' ? PAUSED_PLAYERS : []).map(p => p._src()),
        };
        appendOutput(JSON.stringify(snap, null, 2));
    });

    // A5 — toggle the device's loan flag. Sticky in localStorage; echoed in
    // every subsequent session_diag and POST /devices. Also displays the
    // device's persistent UUID so the operator can read it back during support.
    function refreshLoanLabel() {
        var v = (typeof TELEMETRY !== 'undefined' && typeof TELEMETRY.isLoanDevice === 'function') ? TELEMETRY.isLoanDevice() : false;
        $('#tools-toggle-loan').text('Téléphone de prêt: ' + (v ? 'OUI' : 'non'));
    }
    refreshLoanLabel();
    if (typeof TELEMETRY !== 'undefined' && typeof TELEMETRY.deviceUuid === 'function') {
        appendOutput('device_uuid: ' + TELEMETRY.deviceUuid());
        appendOutput('is_loan: ' + TELEMETRY.isLoanDevice());
    }
    $('#tools-toggle-loan').off().on('click', () => {
        if (typeof TELEMETRY === 'undefined' || typeof TELEMETRY.setLoanDevice !== 'function') {
            appendOutput('toggle-loan: TELEMETRY.setLoanDevice unavailable'); return;
        }
        var newVal = !TELEMETRY.isLoanDevice();
        TELEMETRY.setLoanDevice(newVal);
        refreshLoanLabel();
        TELEMETRY.log('tools_set_loan_device', {is_loan: newVal});
        appendOutput('loan-device: ' + (newVal ? 'OUI' : 'non'));
    });

    $('#tools-back').off().on('click', () => PAGE('select'));
}

//
// CHECK MEDIA
//
PAGES['preload'] = (p) => {
    // A6: stash the server-reported mtime alongside the parcours so the next
    // checkdata can compare and detect remote updates.
    if (p && p.time && p.file) {
        try { localStorage.setItem('parcoursMTime_' + p.file, String(new Date(p.time).getTime())); } catch (e) {}
    }
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

    startGpsStatusPaint();
}

var retryAuth = 0;
PAGES['confirmgeo'] = () => {
    $('#confirmgeo-settings').hide().off().on('click', () => GEO.showAppSettings())

    // D1 — iOS 26.0–26.3.x background-GPS regression (GIVORS 2026-05-20 §S1 / P1.34):
    // three iPhones on iOS 26.3.1 had 8–14-min background-GPS blackouts mid-walk.
    // iOS 26.4.2 sessions had shorter gaps but completed; iOS 18.x was clean.
    // Surface a soft warning so the operator can offer a loan phone (or push the
    // visitor to update). Visitor can still proceed — the underlying fix lives
    // in workstream D (B4 watchdog, D3/D4/D5 CLLocationManager reacquire); this
    // is operational mitigation only, not a substitute.
    if (PLATFORM === 'ios' && typeof device !== 'undefined' && typeof device.version === 'string') {
        let parts = device.version.split('.')
        let major = parseInt(parts[0], 10)
        let minor = parseInt(parts[1] || '0', 10)
        if (major === 26 && minor < 4) {
            $('#confirmgeo-desc2').html(`<strong>Attention :</strong> votre version d'iOS (${device.version}) a un défaut connu de localisation en arrière-plan qui peut interrompre la balade. Mettez à jour iOS (Réglages > Général > Mise à jour logicielle) ou demandez à l'équipe un téléphone de prêt.`)
                .css('color', '#c00')
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('ios_version_warning', {
                version: device.version,
                major: major,
                minor: minor,
            })
        }
    }

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

    // Resume path: don't hard-block — short grace then proceed (see MOTION_RESUME_GRACE_MS).
    var isResume = PARCOURS.valid() && PARCOURS.currentStep() >= 0;

    var start = Date.now();
    var warningShown = false;
    function poll() {
        MOTION_TIMER = null;
        if (currentPage !== 'checkmotion') return;
        if (GEO.motionAuthorized) {
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: true, waited_ms: Date.now() - start});
            return PAGE('rdv');
        }
        if (isResume && Date.now() - start >= MOTION_RESUME_GRACE_MS) {
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: false, resumed: true, waited_ms: Date.now() - start});
            return PAGE('rdv');
        }
        if (!isResume && !warningShown && Date.now() - start >= MOTION_WAIT_MS) {
            warningShown = true;
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('motion_check', {granted: false, waited_ms: Date.now() - start});
            $('#checkmotion-desc').html(
                "Flanerie a besoin du capteur de mouvement pour détecter vos pauses pendant la marche.<br /><br />" +
                "Sans cette autorisation, des fausses alertes \"GPS perdu\" se déclencheront en poche.<br /><br />" +
                "Ouvrez les Réglages, puis activez <u>Mouvement et fitness</u> pour Flanerie :<br />" +
                "<b>Réglages &gt; Apps &gt; Flanerie &gt; Mouvement et fitness</b>"
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

    // device.version is the Android OS version string ("13" for Android 13 = API 33).
    // The minimum API for isIgnoringBatteryOptimizations is 23 = Android 6.0.
    // Threshold must be compared against OS version (<6), NOT API level (<23).
    var osVersion = parseInt(device.version.split('.')[0], 10);
    if (osVersion < 6) return PAGE('rdv');

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

        // Gate 0: power-save mode. Hard-block before everything else — if the
        // phone-wide battery saver is on, Doze exemption and bg-restriction
        // fixes are irrelevant, the OS will still throttle us mid-walk.
        // IsPowerSaveMode() is a synchronous OS query wrapped in Cordova, so it
        // resolves almost instantly.
        var powerSaveCheck = (typeof plugin.IsPowerSaveMode === 'function')
            ? plugin.IsPowerSaveMode().catch(() => false)
            : Promise.resolve(false);

        powerSaveCheck.then(psOn => {
            if (currentPage !== 'checkbatteryopt') return;
            $('#checkbatteryopt-powersave').toggle(!!psOn);
            if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('power_save_mode', {on: !!psOn});
            if (psOn) {
                // Hard-block. Poll loop auto-advances the moment it's disabled.
                BATTOPT_TIMER = setTimeout(check, BATTOPT_POLL_MS);
                return;
            }

            // Gate 1: background restriction (API 28+). Hard-block if the user /
            // OEM policy explicitly restricted background activity for the app.
            // Field test 2026-05-18 traced Samsung A41 mid-walk kills to this layer.
            var bgRestrictedCheck = (typeof plugin.IsBackgroundRestricted === 'function')
                ? plugin.IsBackgroundRestricted()
                : Promise.resolve(false);

            bgRestrictedCheck.then(isRestricted => {
                if (currentPage !== 'checkbatteryopt') return;
                if (isRestricted) {
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('background_restricted', {
                        manufacturer: device.manufacturer, model: device.model, os_version: osVersion,
                    });
                    $('#checkbatteryopt-desc').hide();
                    $('#checkbatteryopt-restricted').show();
                    $('#checkbatteryopt-settings').show();
                    BATTOPT_TIMER = setTimeout(check, BATTOPT_POLL_MS);
                    return;
                }
                $('#checkbatteryopt-restricted').hide();
                $('#checkbatteryopt-desc').show();
                runDozeCheck();
            }).catch(error => {
                console.warn('[BATTOPT] IsBackgroundRestricted probe failed:', error);
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('background_restricted', { error: String(error) });
                runDozeCheck();
            });
        });
    }

    function runDozeCheck() {
        if (currentPage !== 'checkbatteryopt') return;
        plugin.IsIgnoringBatteryOptimizations()
            .then(isIgnoring => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { ignoring: isIgnoring, manufacturer: device.manufacturer, family, os_version: osVersion });
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
    var fatalReason = null;
    function failAudio(reason, html) {
        ok = false;
        fatalReason = reason;
        $('#checkaudio-accept').hide();
        $('#checkaudio-help').show();
        $('#checkaudio-desc').html(html).css('color', 'red');
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('checkaudio_fail', {reason});
    }
    testplayer.on('loaderror', (src, error) => {
        console.log('[AUDIO] loaderror', src, error);
        failAudio('loaderror', "Erreur de lecture audio. Votre appareil ne semble pas compatible...");
    })
    testplayer.on('playerror', (src, error) => {
        console.log('[AUDIO] playerror', src, error);
        failAudio('playerror', "Erreur de lecture audio. Votre appareil ne semble pas compatible...");
    })
    testplayer.on('play', (src) => { console.log('[AUDIO] OK!', src); })

    // Gate 1: AudioFocus plugin failed to initialize. Without it, Android can lose
    // audio routing silently mid-walk; on iOS the AVAudioSession category is also
    // set via this plugin, so its absence means the session may not be in Playback mode.
    if (typeof PLATFORM !== 'undefined' && (PLATFORM === 'android' || PLATFORM === 'ios') && AUDIOFOCUS === -1) {
        failAudio('audiofocus_unavailable',
            "Le module audio n'est pas disponible. L'application ne peut pas garantir une lecture continue.<br /><br />" +
            "Demandez à un membre de l'équipe."
        );
    }

    console.log('[AUDIO] testing via PlayerSimple, basepath:', BASEURL+'/images/');
    testplayer.load(BASEURL+'/images/', {src: 'test.mp3', master: 1}, false)

    // Gate 2 (iOS only): the test player fell back to Howler because httpToNativePath
    // returned null — usually because LOCALMEDIA_PATH_NATIVE / LOCALAPP_PATH_NATIVE
    // weren't captured. Howler cannot start playback from a background GPS callback
    // on a locked iPhone, so the walk would die silently in the pocket.
    if (ok && PLATFORM === 'ios' && (testplayer._isNativeFallback || IOS_NATIVE_FALLBACK_DETECTED)) {
        failAudio('ios_native_fallback',
            "Erreur de compatibilité audio (iOS).<br /><br />" +
            "Demandez à un membre de l'équipe."
        );
    }

    testplayer.play(0)

    // Skip the typewriter animation when a fatal gate already painted the red
    // error — TYPEWRITE reads .text() (strips HTML) and would overwrite the error.
    if (!fatalReason) {
        TYPEWRITE('checkaudio-desc')
            .pauseFor(4000)
            .callFunction(() => {
                if (ok) {
                    $('#checkaudio-accept').show()
                    $('#checkaudio-help').show()
                }
            })
    }

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

PAGES['parcours'] = async () => {

    var parcoursBootToken = ++PARCOURS_BOOT_TOKEN;

    var isResume = PARCOURS.valid() && PARCOURS.currentStep() >= 0;

    // Fresh visitor starts need a hard audio-session reset before the walk's
    // first sustained playback. Resume flows deliberately skip this so a crash
    // recovery keeps its current audio state rather than tearing it down again.
    if (!isResume) {
        await resetAudioSessionForFreshParcoursStart();
        if (currentPage !== 'parcours' || parcoursBootToken !== PARCOURS_BOOT_TOKEN) return;
    }

    SILENT_PLAYER.play(); // Play silent track to keep audio session alive
    scheduleWakeupNotification();
    // The #gps-status / #gps-precision badges live in this page's DOM, so the
    // painter has to run here. checkgeo also starts it for its own gating, but
    // its cleanup tears it down before we arrive — restart it on the walk.
    startGpsStatusPaint();

    // Hold the audiofocus plugin's mediaPlayback foreground service ACTIVE
    // for the duration of the walk, not just while audio focus is held.
    // Field test 2026-05-18: Samsung A41 (Android 12) consistently killed the
    // process during silent gaps (background loading of the next step's audio
    // while the current voice was playing). The FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    // flag is the documented Android signal for "this process is doing user-
    // visible media work — do not kill"; keeping it asserted continuously
    // closes the kill window. iOS path is defensive (setActive:YES + ensures
    // the interruption observer is registered ahead of the first play).
    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.audiofocus &&
        typeof cordova.plugins.audiofocus.startKeepalive === 'function') {
        cordova.plugins.audiofocus.startKeepalive(
            () => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_keepalive_started', {}); },
            (err) => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_keepalive_error', {phase: 'start', error: String(err)}); }
        );
    }
    
    if (testplayer) {
        testplayer.stop();
        testplayer.clear();
        testplayer = null;
    }

    console.log('PARCOURS', PARCOURS);
    // if (!PARCOURS.valid()) return PAGE('select')

    resumeAudioContext('parcours');

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

    // Paint exactly one cyan target — `lostTarget()` resolves it (active step
    // if narration is still running there, otherwise next step). Done steps
    // stay grey. All other upcoming steps stay hidden in normal mode so the
    // walker's instruction is unambiguous: "Rejoignez la zone bleue claire".
    // In DEVMODE we keep painting upcoming steps for debugging (greyed out).
    updateStepsMarkers = function updateStepsMarkers() {
        let target = PARCOURS.lostTarget();
        let targetIdx = target ? target._index : -1;
        let doneIdx = PARCOURS.currentStep();

        PARCOURS.spots.steps.forEach((s, i) => {
            if (i < doneIdx || (i === doneIdx && i !== targetIdx)) {
                s.showMarker(COLOR_DONE, 0.5);
            }
            else if (i === targetIdx) {
                s.showMarker(COLOR_CURRENT, 0.7);
            }
            else if (DEVMODE) {
                s.showMarker(COLOR_FUTURE);
            }
            else {
                s.hideMarker();
            }
        });
    }

    // Register PARCOURS handlers via onParcours so PAGES_CLEANUP['parcours']
    // can detach them. Clear any that survived first (defensive against a
    // missed cleanup / page re-entry) so handlers never stack.
    PARCOURS_PAGE_HANDLERS.forEach(h => PARCOURS.off(h.event, h.fn));
    PARCOURS_PAGE_HANDLERS = [];
    function onParcours(event, fn) {
        PARCOURS.on(event, fn);
        PARCOURS_PAGE_HANDLERS.push({event: event, fn: fn});
    }

    // ON step fire: show next
    onParcours('fire', (s, meta = {}) => {
        if (s._type != 'steps') return
        if (!meta.refire) TELEMETRY.log('step_fire', {step: s._index, name: s._spot.name});
        updateStepsMarkers()

        // First fire of the run — swap the pre-start title for the run title.
        // Keys on visibility, not step index: a fresh parcours can fire any
        // optional step (the sequential-fire-gate short-circuits at currentStep
        // == -2), so gating on `s._index == 0` left "Rendez vous au point de
        // départ" stuck behind the recovery map whenever the walker entered
        // mid-parcours.
        if ($('#parcours-init').is(':visible')) {
            $('#parcours-init').hide()
            $('#parcours-run').show()
            TYPEWRITE('parcours-run')
        }

        // Hide map back into audio-first immersion after the first step fires.
        // Note: openMapForRecovery / closeMapForRecovery handle the map+button
        // state machine — call closeMapForRecovery so the button label and
        // map controls reset together.
        if (!DEVMODE && s._index==PARCOURS.currentStep() && !isResume) {
            closeMapForRecovery({source: 'first_step_fire'});
        }

        // Last step: prepare GPS cutoff
        if (PARCOURS.currentStep() + 1 == PARCOURS.spots.steps.length) {
            if (PARCOURS.info.cutoff === undefined || PARCOURS.info.cutoff <= 0) return;
            console.log('LAST STEP: prepare GPS cutoff in '+PARCOURS.info.cutoff+' seconds');
            setTimeout(() => {
                if (PARCOURS.currentStep() + 1 == PARCOURS.spots.steps.length) {
                    console.log('LAST STEP: cut GPS');
                    PARCOURS.stopTracking()
                    GEO.stopGeoloc()
                }
            }, PARCOURS.info.cutoff * 1000); // seconds
        }

        isResume = false;
    })

    // ON step done: hide
    onParcours('done', (s) => {
        if (s._type != 'steps') return
        TELEMETRY.log('step_done', {step: s._index, name: s._spot.name});
        // Repaint markers so the next step picks up the cyan target before
        // the walker arrives at it — otherwise the map shows no target between
        // 'done' on the current step and 'fire' on the next.
        updateStepsMarkers()

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
    onParcours('fire', function onLastStepFire(s) {
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
    onParcours('enter', (s) => {
        if (s._type === 'offlimits') TELEMETRY.log('offlimit_enter', {name: s._spot.name, step: PARCOURS.currentStep()});
    })
    onParcours('leave', (s) => {
        if (s._type === 'offlimits') TELEMETRY.log('offlimit_leave', {name: s._spot.name, step: PARCOURS.currentStep()});
    })

    // INIT PARCOURS
    //

    // Info
    $('#parcours-title').toggle(!DEVMODE)
    $('#parcours-title-dev').text(PARCOURS.info.name).toggle(DEVMODE)
    $('#parcours-run').hide()

    // "Je suis perdu·e" button toggles the recovery map. Always visible during
    // the walk — the label flips between "Je suis perdu·e" and "Retour à
    // l'écoute", driven by openMapForRecovery / closeMapForRecovery.
    $('#parcours-lost').show().off().on('click', () => {
        if (MAP_RECOVERY_OPEN) closeMapForRecovery({source: 'manual_dismiss'});
        else openMapForRecovery({source: 'manual'});
    })

    // Activate Parcours
    PARCOURS.startTracking()
    // Key the telemetry session on the stable pID (the parcours file id), not
    // info.name — info carries only {name,status,coords,cutoff}, so file/id are
    // always undefined and sessions would otherwise group by human name.
    // Pass restored state via options.extra so the session_start / session_resume
    // event itself carries the resume position — field test 2026-05-18 showed the
    // resume_seek_pos field was absent from every session_resume payload, which
    // made the P3.5 iOS double-kill diagnostic impossible to evaluate.
    TELEMETRY.start(
        PARCOURS.pID || PARCOURS.info.name || '',
        PARCOURS.info.name || PARCOURS.pID || '',
        {
            extra: {
                resume_seek_pos: (PARCOURS.state && PARCOURS.state.resumeStepVoicePos) || 0,
                resume_step_index: PARCOURS.state ? PARCOURS.state.stepIndex : -2,
                resume_step_done: PARCOURS.state ? !!PARCOURS.state.stepDone : false,
                resume_lost: PARCOURS.state ? !!PARCOURS.state.lost : false,
                is_resume_branch: !!(PARCOURS.valid() && PARCOURS.currentStep() >= 0),
            }
        }
    );
    // Drain any telemetry parcours stashed before the session existed
    // (parcours_restore from build()@parse-time, etc.).
    if (typeof PARCOURS.flushPendingTelemetry === 'function') PARCOURS.flushPendingTelemetry();

    // Diagnostic snapshot at parcours entry — the earliest point where TELEMETRY
    // has a session. checkbatteryopt runs before TELEMETRY.start() so anything
    // logged there is silently dropped; this is the only reliable place to
    // capture device + plugin + power state for post-hoc analysis.
    (function() {
        var po = (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.PowerOptimization)
            ? cordova.plugins.PowerOptimization : null;
        var af = (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.audiofocus)
            ? cordova.plugins.audiofocus : null;

        // A5 — persistent identity (UUID generated once on first launch) +
        // operator-toggled loan flag. Both echo to session_diag every walk so
        // analyze.mjs can bucket and filter without manual cross-referencing.
        var deviceUuid   = (typeof TELEMETRY.deviceUuid   === 'function') ? TELEMETRY.deviceUuid()   : null;
        var isLoanDevice = (typeof TELEMETRY.isLoanDevice === 'function') ? TELEMETRY.isLoanDevice() : false;

        // Synchronous facts — logged immediately.
        TELEMETRY.log('session_diag', {
            // APK build number + downloaded webapp zip hash (changes on every deploy)
            apk_version:  document.APPVERSION  || null,
            webapp_hash:  localStorage.getItem('APPHASH') || null,
            // Device identity
            platform:     PLATFORM,
            manufacturer: (typeof device !== 'undefined') ? device.manufacturer : null,
            model:        (typeof device !== 'undefined') ? device.model        : null,
            os_version:   (typeof device !== 'undefined') ? device.version      : null,
            // A5 — persistent identity
            device_uuid:  deviceUuid,
            is_loan:      isLoanDevice,
            // Plugin presence
            plugin_power_opt:   !!po,
            plugin_power_IsPowerSaveMode:        !!(po && typeof po.IsPowerSaveMode          === 'function'),
            plugin_power_IsBackgroundRestricted: !!(po && typeof po.IsBackgroundRestricted   === 'function'),
            plugin_power_IsIgnoringBattOpt:      !!(po && typeof po.IsIgnoringBatteryOptimizations === 'function'),
            plugin_power_GetLastExitReasons:     !!(po && typeof po.GetLastExitReasons       === 'function'),
            plugin_power_GetMemoryInfo:          !!(po && typeof po.GetMemoryInfo            === 'function'),
            plugin_power_GetStandbyBucket:       !!(po && typeof po.GetStandbyBucket         === 'function'),
            plugin_audiofocus:  !!af,
            plugin_audiofocus_getSessionState:   !!(af && typeof af.getAudioSessionState     === 'function'),
            plugin_bgloc_getCLState:             !!(typeof BackgroundGeolocation !== 'undefined' && typeof BackgroundGeolocation.getCLState    === 'function'),
            plugin_bgloc_getPowerState:          !!(typeof BackgroundGeolocation !== 'undefined' && typeof BackgroundGeolocation.getPowerState  === 'function'),
            plugin_bgloc_forceReacquire:         !!(typeof BackgroundGeolocation !== 'undefined' && typeof BackgroundGeolocation.forceReacquire === 'function'),
            plugin_bgloc:       !!(typeof BackgroundGeolocation !== 'undefined'),
            plugin_permissions: !!(typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.permissions),
            // Runtime flags
            devmode: !!DEVMODE,
        });

        // A5 — register/refresh the device on the server so operators have a
        // dashboard of "which phones exist and when each was last seen". One
        // POST per parcours entry; offline failures are non-fatal (the device
        // identity still echoes in every session payload).
        if (deviceUuid && PLATFORM !== 'browser') {
            try {
                var devicePayload = {
                    uuid:         deviceUuid,
                    is_loan:      isLoanDevice,
                    platform:     PLATFORM,
                    manufacturer: (typeof device !== 'undefined') ? device.manufacturer : null,
                    model:        (typeof device !== 'undefined') ? device.model        : null,
                    os_version:   (typeof device !== 'undefined') ? device.version      : null,
                    apk_version:  document.APPVERSION || null,
                    webapp_hash:  localStorage.getItem('APPHASH') || null,
                };
                var devUrl = (typeof prep === 'function') ? prep('/devices') : '/devices';
                var transport = (typeof fetch === 'function') ? fetch : (typeof fetchRemote === 'function' ? fetchRemote : null);
                if (transport) {
                    transport(devUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(devicePayload),
                        redirect: 'follow',
                    }).catch(function(e) { console.warn('[A5] device register failed:', e && e.message); });
                }
            } catch (e) { console.warn('[A5] device register threw:', e); }
        }

        // Async power state — separate event so the sync facts land first.
        if (!po || PLATFORM !== 'android') return;
        var ps  = (typeof po.IsPowerSaveMode          === 'function') ? po.IsPowerSaveMode().catch(function(e)          { return 'error:'+e; }) : Promise.resolve('n/a');
        var br  = (typeof po.IsBackgroundRestricted   === 'function') ? po.IsBackgroundRestricted().catch(function(e)   { return 'error:'+e; }) : Promise.resolve('n/a');
        var ig  = (typeof po.IsIgnoringBatteryOptimizations === 'function') ? po.IsIgnoringBatteryOptimizations().catch(function(e) { return 'error:'+e; }) : Promise.resolve('n/a');
        var sb  = (typeof po.GetStandbyBucket         === 'function') ? po.GetStandbyBucket().catch(function(e)         { return 'error:'+e; }) : Promise.resolve('n/a');
        var ler = (typeof po.GetLastExitReasons       === 'function') ? po.GetLastExitReasons().catch(function(e)       { return 'error:'+e; }) : Promise.resolve('n/a');
        Promise.all([ps, br, ig, sb, ler]).then(function(r) {
            TELEMETRY.log('power_state_at_parcours', {
                power_save:         r[0],
                bg_restricted:      r[1],
                ignoring_batt_opt:  r[2],
                standby_bucket:     r[3],
                last_exit_reasons:  r[4],
            });
        });
    })();

    // C2 — passive media integrity check. Runs once at parcours entry, async,
    // non-blocking. Flags any missing or truncated media file so a recurring
    // R7.1-class audio_playerror can be correlated with a known-bad pack
    // without a separate diagnostic pass. Skipped silently in WEB mode and
    // when the server's /update/media is unreachable.
    if (typeof PARCOURS.verifyMediaIntegrity === 'function') {
        PARCOURS.verifyMediaIntegrity().then(function(result) {
            TELEMETRY.log('media_integrity_check', {
                total:        result.total,
                ok:           result.ok,
                failed:       result.failed,
                skipped:      !!result.skipped,
                error:        result.error || null,
                failed_files: result.failed_files,
            });
            if (result.failed > 0) {
                console.warn('[C2] media integrity:', result.failed, 'of', result.total, 'files failed:', result.failed_files);
            }
        }).catch(function(e) { console.warn('[C2] verifyMediaIntegrity threw:', e); });
    }

    // First RUN — paint step 0 as the single cyan target (matches updateStepsMarkers).
    if (PARCOURS.currentStep() < 0) {
        console.log('FIRST RUN')
        TYPEWRITE('parcours-init')
        updateStepsMarkers()
    }

    // RESUME
    else if (PARCOURS.valid() && PARCOURS.currentStep() >= 0)
    {
        console.log('RESUME PARCOURS', PARCOURS.currentStep());
        $('#parcours-init').hide()
        $('#parcours-run').show()
        // TYPEWRITE('parcours-run')
        updateStepsMarkers()

        // Audio cue so the walker isn't dropped into silence while GPS warms up
        // or while they walk back into the active step zone. Map is already
        // visible on resume (the hide-on-first-fire path is gated by !isResume).
        if (RESUME_PLAYER.isLoaded()) RESUME_PLAYER.play()

        // LOST state restored from a prior session: paint the band and start
        // the loop immediately. evaluateLostState will fire 'recover' on the
        // next position tick if the walker already came back into range.
        if (PARCOURS.state.lost) applyLostUI()
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

    // Walk is over — stop position processing AND the native GPS service so it
    // doesn't keep draining battery in the background after the parcours.
    PARCOURS.stopTracking();
    GEO.stopGeoloc();

    // Cleanup: stop all background audio
    PARCOURS.stopAudio();
    GPSLOST_PLAYER.stop();
    SILENT_PLAYER.stop();
    LOST_PLAYER.stop();
    RESUME_PLAYER.stop();
    clearLostUI();
    if (testplayer) { testplayer.stop(); testplayer.clear(); testplayer = null; }

    // G1/A1: fully release the session-scoped audiofocus state. stopKeepalive
    // alone tears down the foreground service, but it intentionally leaves some
    // audio-session state alive; that's useful across page switches, but wrong
    // at the real end of a walk where the next visitor needs a fresh engine.
    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.audiofocus &&
        typeof cordova.plugins.audiofocus.releaseSession === 'function') {
        cordova.plugins.audiofocus.releaseSession(
            () => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_session_released', {}); },
            (err) => { if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_session_release_error', {error: String(err)}); }
        );
    }

    // A7 — explicit end-of-walk telemetry shutdown so the session closes cleanly
    // server-side instead of bleeding events for hours (m3 / 7p2j, xuyx, 9hjo,
    // mwbo on 2026-05-20). The periodic intervals are already gated on
    // currentPage === 'parcours' so they stop firing here; the explicit
    // walk_end_shutdown + flush + end seals the session.
    if (typeof TELEMETRY !== 'undefined') {
        TELEMETRY.log('walk_end_shutdown', {
            visibility: typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            // Record what was actually torn down so the report can confirm the
            // sequence ran end-to-end on each device.
            stopped: ['tracking', 'geoloc', 'audio', 'silent', 'gpslost', 'lost', 'resume'],
        });
        try {
            Promise.resolve(TELEMETRY.flush()).finally(() => TELEMETRY.end());
        } catch (e) {
            console.warn('[A7] telemetry flush/end failed:', e);
            TELEMETRY.end();
        }
    }

    // A7 lock-screen typewriter: generic copy that works for both loan and
    // personal phones, and signals the show continues with a non-phone chapter
    // rather than implying the visitor is being dismissed or asked to return
    // the device. 5-tap-anywhere still reloads via the generic body handler.
    var ending = true
    function end() {
        if (!ending) return;
        TYPEWRITE('parcours-end')
            .typeString('La balade est terminée.')
            .pauseFor(2500)
            .deleteAll()
            .typeString('Tu peux enlever tes écouteurs.')
            .pauseFor(2500)
            .deleteAll()
            .typeString('Tu peux ranger le téléphone.')
            .pauseFor(2500)
            .deleteAll()
            .typeString('La suite t\'attend.')
            .pauseFor(4000)
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
                PARCOURS.stopTracking();
                TELEMETRY.log('session_restart_click', {reason: 'restart_tap'});
                TELEMETRY.end();
                tapLocked = true;
                setTimeout(() => { PARCOURS.clearStore(); alert('Application réinitialisée'); location.reload(); }, 300);
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
    // F-R2 — snapshot the audio + GPS engine state at re-arm. Today the rearm
    // logic just resets parcours state without rebuilding the audio engine,
    // which is the P7 root cause Justine flagged (4-5 silent-audio recoveries
    // per day on the SM-A515F loan phone). Once A2 (engine reset at session
    // start) ships in phase 2 we'll be able to confirm the snapshot improves;
    // without the snapshot we can't tell whether the staleness is in
    // AUDIOFOCUS, SILENT_PLAYER, PAUSED_PLAYERS, or somewhere else.
    if (typeof TELEMETRY !== 'undefined') {
        try {
            TELEMETRY.log('rearm_pre_state', {
                audiofocus:           typeof AUDIOFOCUS !== 'undefined' ? AUDIOFOCUS : null,
                silent_player_state:  (typeof SILENT_PLAYER !== 'undefined' && SILENT_PLAYER && typeof SILENT_PLAYER.loadState === 'function') ? SILENT_PLAYER.loadState() : null,
                silent_player_playing: (typeof SILENT_PLAYER !== 'undefined' && SILENT_PLAYER && typeof SILENT_PLAYER.isPlaying === 'function') ? SILENT_PLAYER.isPlaying() : null,
                paused_players_count: (typeof PAUSED_PLAYERS !== 'undefined') ? PAUSED_PLAYERS.length : null,
                ducked_players_count: (typeof DUCKED_PLAYERS !== 'undefined' && DUCKED_PLAYERS && typeof DUCKED_PLAYERS.size === 'number') ? DUCKED_PLAYERS.size : null,
                all_players_count:    (typeof ALL_PLAYERS !== 'undefined') ? ALL_PLAYERS.length : null,
                ios_native_fallback:  typeof IOS_NATIVE_FALLBACK_DETECTED !== 'undefined' ? !!IOS_NATIVE_FALLBACK_DETECTED : null,
                gpssignal_ok:         typeof GPSSIGNAL_OK !== 'undefined' ? GPSSIGNAL_OK : null,
                gps_revoked:          typeof GPSREVOKED !== 'undefined' ? GPSREVOKED : null,
                last_real_callback_age_ms: (typeof GEO !== 'undefined' && GEO.lastRealCallbackTime) ? (Date.now() - GEO.lastRealCallbackTime) : null,
                parcours_step:        (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
                parcours_lost:        (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? !!PARCOURS.state.lost : null,
                visibility:           typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
            });
        } catch (e) { console.warn('[F-R2] rearm_pre_state log failed:', e); }
    }
    TELEMETRY.restart(
        'rearm_button',
        PARCOURS.pID || PARCOURS.info.name || '',
        PARCOURS.info.name || PARCOURS.pID || ''
    );
    PARCOURS.currentStep(-2) // Reset current step
    PARCOURS.state.lost = false
    PARCOURS.state.lostSince = null
    PARCOURS._lostBeyondSince = null
    clearLostUI()
    closeMapForRecovery({source: 'rearm'})
    openMapForRecovery({source: 'rearm'})
    PARCOURS.startTracking()
    PARCOURS.stopAudio()

    if (updateStepsMarkers) updateStepsMarkers();

    setTimeout(() => document.MAP.fire('move'), 2000)
})

$('#parcours-restart').click(() => {
    console.log('RESTART');
    PARCOURS.stopTracking();
    TELEMETRY.log('session_restart_click', {reason: 'restart_button'});
    TELEMETRY.end();
    setTimeout(() => { PARCOURS.clearStore(); alert('Application réinitialisée'); location.reload(); }, 300);
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

// LATE state fallback: shared loop played when a step's voice ends but the
// step has no afterplay (or its afterplay file failed to load). Silently
// silent if images/afterplay.mp3 isn't bundled — PlayerStep.startAfterplay
// gates on isLoaded() before routing here.
var DEFAULT_AFTERPLAY_PLAYER = new PlayerSimple(true, 0);
DEFAULT_AFTERPLAY_PLAYER.load(BASEURL+'/images/', {src: 'afterplay.mp3', master: 1}, false);

// P1.29 / R7.2 — when the generic "you are late" afterplay loop kicks in for
// a *broken* step afterplay (reason: loaderror), surface the recovery map so
// the walker gets a visual cue back onto the route. Suppress for reason:
// no_src — that is the normal path on parcours like FLANERIE_GIVORS where no
// step ships a per-step afterplay (firing the map ~150 times per walk).
// The currentPage guard keeps this off the devmode tools page.
DEFAULT_AFTERPLAY_PLAYER.on('play', () => {
    if (currentPage !== 'parcours') return;
    var reason = (typeof window !== 'undefined') ? window.DEFAULT_AFTERPLAY_LAST_REASON : null;
    if (reason !== 'loaderror') return;
    if (typeof openMapForRecovery === 'function') {
        openMapForRecovery({source: 'default_afterplay', reason: reason});
    }
});

// RESUME cue: short one-shot played on app relaunch so the walker hears
// something while GPS warms up / they walk back into the active zone.
// Silently silent if images/resume.mp3 isn't bundled.
var RESUME_PLAYER = new PlayerSimple(false, 0);
RESUME_PLAYER.load(BASEURL+'/images/', {src: 'resume.mp3', master: 1}, false);

// LOST state: looped message while the walker is too far from the active /
// next step. Silently silent if images/youlost.mp3 isn't bundled.
var LOST_PLAYER = new PlayerSimple(true, 0);
LOST_PLAYER.load(BASEURL+'/images/', {src: 'youlost.mp3', master: 1}, false);

// Tracks current GEO signal state (mirrors GEO.on('stateUpdate')). LOST is
// gated on this — GPS-lost takes priority and suppresses the LOST band while
// the bg-geo plugin reports no usable fix.
var GPSSIGNAL_OK = true;

// LOST state UI helpers — split out so the resume path can repaint the band
// on a kill-and-relaunch without duplicating the entry handler's audio gates.
// LOST_BAND_MUTED_UNTIL: timestamp until which the band stays hidden after a
// manual dismiss. LOST state itself (PARCOURS.state.lost) is unaffected — the
// audio loop also pauses but a still-lost walker gets a band re-appearance
// after 60s if they haven't recovered.
var LOST_BAND_MUTED_UNTIL = 0;
var LOST_BAND_MUTE_TIMER = null;
const LOST_BAND_MUTE_MS = 60000;

function applyLostUI() {
    if (Date.now() >= LOST_BAND_MUTED_UNTIL) {
        $('#lost-band').css('display', 'flex');
        if (typeof LOST_PLAYER !== 'undefined' && LOST_PLAYER.isLoaded()) LOST_PLAYER.play();
    }
    openMapForRecovery({source: 'lost'});
}
function clearLostUI() {
    if (typeof LOST_PLAYER !== 'undefined') LOST_PLAYER.stop();
    $('#lost-band').hide();
    LOST_BAND_MUTED_UNTIL = 0;
    if (LOST_BAND_MUTE_TIMER) { clearTimeout(LOST_BAND_MUTE_TIMER); LOST_BAND_MUTE_TIMER = null; }
    closeMapForRecovery({source: 'recover'});
}

// Map open/close as a single path so manual help (#parcours-lost tap) and the
// auto LOST state get identical treatment: visible map, drag + zoom unlocked,
// auto-framed on the walker + target, and the live distance updater running.
// On close, the map re-locks and returns to immersion.
var MAP_RECOVERY_OPEN = false;
var updateStepsMarkers = null;
var LOST_DISTANCE_LISTENER = null;
var LOST_DISTANCE_LAST = null;

// Instruction text under the map. Always ends with "Rejoignez la zone bleue
// claire."; prefixed with "Vous semblez un peu perdu." while LOST is active.
function updateMapInstruction() {
    let lost = PARCOURS.state && PARCOURS.state.lost;
    let prefix = lost ? 'Vous semblez un peu perdu. ' : '';
    $('#map-instruction-text').html(
        prefix + 'Rejoignez la zone <b class="zone-color-target">bleue claire</b>.'
    );
}

function fitTargetBounds() {
    if (!document.MAP) return;
    let target = PARCOURS.lostTarget();
    let pos = GEO.lastPosition;
    if (!target) return;

    let targetCenter = target.getCenterPosition();
    if (!pos || !pos.coords) {
        // No fix yet — at least centre on the target so the walker sees where to go.
        try { document.MAP.setView(targetCenter, 18); } catch(e) {}
        return;
    }
    try {
        document.MAP.fitBounds(
            [[pos.coords.latitude, pos.coords.longitude], targetCenter],
            { padding: [50, 50], maxZoom: 19 }
        );
    } catch(e) { console.warn('[MAP] fitBounds failed:', e); }
}

function updateLostDistance(position) {
    let $d = $('#map-instruction-distance');
    let target = PARCOURS.lostTarget();
    if (!target) { $d.text(''); return; }
    let pos = position || GEO.lastPosition;
    if (!pos || !pos.coords) { $d.text('→ — m'); return; }

    // distanceToBorder is negative when the walker is already inside the zone —
    // clamp to 0 so the indicator never shows a meaningless negative value.
    let d = Math.max(0, Math.round(target.distanceToBorder(pos)));
    $d.text('→ ' + d + ' m');

    // Trend coloring: green if shrinking, red if growing, neutral otherwise.
    if (LOST_DISTANCE_LAST !== null) {
        if (d < LOST_DISTANCE_LAST - 1) $d.removeClass('is-receding').addClass('is-approaching');
        else if (d > LOST_DISTANCE_LAST + 1) $d.removeClass('is-approaching').addClass('is-receding');
    }
    LOST_DISTANCE_LAST = d;
}

function startLostDistanceUpdater() {
    if (LOST_DISTANCE_LISTENER) return;
    LOST_DISTANCE_LAST = null;
    $('#map-instruction-distance').removeClass('is-approaching is-receding');
    updateLostDistance(); // paint once immediately
    LOST_DISTANCE_LISTENER = (pos) => updateLostDistance(pos);
    GEO.on('position', LOST_DISTANCE_LISTENER);
}

function stopLostDistanceUpdater() {
    if (LOST_DISTANCE_LISTENER) {
        try { GEO.off('position', LOST_DISTANCE_LISTENER); } catch(e) {}
        LOST_DISTANCE_LISTENER = null;
    }
    LOST_DISTANCE_LAST = null;
    $('#map-instruction-distance').removeClass('is-approaching is-receding');
}

function openMapForRecovery(opts) {
    opts = opts || {};
    if (currentPage !== 'parcours') return;
    let alreadyOpen = MAP_RECOVERY_OPEN;
    MAP_RECOVERY_OPEN = true;
    if (typeof TELEMETRY !== 'undefined' && !alreadyOpen) TELEMETRY.log('map_opened', {source: opts.source || 'unknown'});

    if (updateStepsMarkers) updateStepsMarkers();
    $('#parcours-map').css('opacity', 1);
    $('#parcours-lost').text('Retour à l\'écoute');

    if (document.MAP) {
        try { document.MAP.dragging.enable(); } catch(e) {}
        try { document.MAP.touchZoom.enable(); } catch(e) {}
        try { document.MAP.scrollWheelZoom.enable(); } catch(e) {}
        try { document.MAP.doubleClickZoom.enable(); } catch(e) {}
        document.MAP.options.maxZoom = 20;
        if (!document.MAP._zoomControl) {
            document.MAP._zoomControl = L.control.zoom({position: 'topright'}).addTo(document.MAP);
        }
    }

    fitTargetBounds();
    updateMapInstruction();
    $('#map-instruction').show();
    startLostDistanceUpdater();
}

function closeMapForRecovery(opts) {
    opts = opts || {};
    let wasOpen = MAP_RECOVERY_OPEN;
    MAP_RECOVERY_OPEN = false;
    if (typeof TELEMETRY !== 'undefined' && wasOpen) TELEMETRY.log('map_closed', {source: opts.source || 'unknown'});

    $('#parcours-map').css('opacity', 0);
    $('#parcours-lost').text('Je suis perdu·e');

    if (document.MAP) {
        try { document.MAP.dragging.disable(); } catch(e) {}
        try { document.MAP.touchZoom.disable(); } catch(e) {}
        try { document.MAP.scrollWheelZoom.disable(); } catch(e) {}
        try { document.MAP.doubleClickZoom.disable(); } catch(e) {}
        document.MAP.options.maxZoom = 19;
        if (document.MAP._zoomControl) {
            document.MAP.removeControl(document.MAP._zoomControl);
            document.MAP._zoomControl = null;
        }
    }

    stopLostDistanceUpdater();
    $('#map-instruction').hide();
}

PARCOURS.on('lost', (info) => {
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('user_lost', {
        step: PARCOURS.currentStep(),
        target_index: info && info.target ? info.target._index : null,
        target_name: info && info.target ? info.target._spot.name : null,
        distance: info ? Math.round(info.distance) : null,
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 600]);

    // Pause the active step's audio (voice or afterplay) — store() in
    // evaluateLostState already snapshotted the voice position above.
    let activeStep = PARCOURS.find('steps', PARCOURS.currentStep());
    if (activeStep && activeStep.player && activeStep.player.isPlaying()) {
        activeStep.player.pause();
    }

    // Stop interruption zones outright (Re-crossing while LOST must not re-trigger
    // them — Parcours.update early-returns during LOST so that's automatic, but
    // we also kill any audio currently playing).
    PARCOURS.stopAudio('zones');

    // LOST masks offlimit: silence offlimit loops too.
    PARCOURS.stopAudio('offlimits');

    applyLostUI();
});

// Manual dismiss: hide the band + pause the loop for LOST_BAND_MUTE_MS.
// LOST state stays active so the recovery overlay / distance updater keep
// working; only the visual + audio nag are muted. After the timer, if still
// LOST, applyLostUI() re-paints the band.
$('#lost-band-dismiss').off().on('click', (e) => {
    e.stopPropagation();
    LOST_BAND_MUTED_UNTIL = Date.now() + LOST_BAND_MUTE_MS;
    $('#lost-band').hide();
    if (typeof LOST_PLAYER !== 'undefined') LOST_PLAYER.stop();
    if (LOST_BAND_MUTE_TIMER) clearTimeout(LOST_BAND_MUTE_TIMER);
    LOST_BAND_MUTE_TIMER = setTimeout(() => {
        LOST_BAND_MUTE_TIMER = null;
        if (PARCOURS.state.lost && currentPage === 'parcours' && GPSSIGNAL_OK) applyLostUI();
    }, LOST_BAND_MUTE_MS);
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('lost_band_dismissed', {
        step: PARCOURS.currentStep(),
        muted_ms: LOST_BAND_MUTE_MS,
    });
});

PARCOURS.on('recover', (info) => {
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('user_recovered', {
        step: PARCOURS.currentStep(),
        // distanceToBorder returns negative when inside the polygon — clamp to 0
        // for the telemetry so the field always reads as "distance from boundary".
        distance: info ? Math.max(0, Math.round(info.distance)) : null,
    });
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);

    clearLostUI();

    // Resume the audio that on('lost') paused. Step.updatePosition runs again
    // later in this same update() pass, but it early-returns for a _done step
    // (afterplay phase, spot.js) and never reaches its resume branch — so a
    // walker who caught up standing inside a finished step's looping afterplay
    // would otherwise stay silent. Resume the active step directly here when
    // the walker recovered INTO it (info.target is that same step). If they
    // caught up by reaching a later step instead, leave it: Step.updatePosition
    // fires that step. resume() is a no-op once the player is already playing.
    let recoveredInto = info && info.target;
    let activeStep = PARCOURS.find('steps', PARCOURS.currentStep());
    if (activeStep && recoveredInto === activeStep &&
        activeStep.player && activeStep.player.isPaused()) {
        activeStep.player.resume();
    }
});

// GPS LOST
var GPSLOST_PLAYER = new PlayerSimple(true, 0);
GPSLOST_PLAYER.load(BASEURL+'/images/', {src: 'gpslost.mp3', master: 1}, false);

GEO.stateUpdateTimeout = 30 * 1000; // 30s on all platforms — must exceed the 15s native keepalive interval

// Default GPS-lost copy (reset whenever we re-show the overlay for a transient signal loss).
const GPSLOST_TEXT_DEFAULT = 'Signal GPS perdu.<br/><br/>Déplacez-vous vers un espace dégagé.<br/>La progression reprend automatiquement dès le retour du signal.';

// GPS Doze escalation (R4.3 option 0 — P1.31).
// Motorola moto g(7) power and TCL T433D (field tests 2026-05-15 and 2026-05-18)
// exhibited 10-14 min GPS callback blackouts while the native location service
// stayed alive — the OS Doze layer stopped delivering callbacks to the foreground
// service without killing it. stateUpdate('lost') fires after 30s of silence and
// shows the generic "GPS perdu" overlay, but that copy is useless when the actual
// fix is to wake the screen. After GPS_DOZE_ESCALATION_MS more seconds without
// recovery, we overwrite the overlay with actionable Doze-specific copy.
const GPS_DOZE_ESCALATION_MS = 30000;  // 30s after GPS-lost fires = ~60s from last real callback
const GPSLOST_TEXT_DOZE =
    '<b>Téléphone en veille</b><br/><br/>' +
    'Votre téléphone a suspendu la localisation GPS en arrière-plan.<br/><br/>' +
    'Déverrouillez l\'écran quelques secondes — la progression reprend automatiquement.';
var GPS_DOZE_TIMER = null;

// Returns a "Précision GPS: <Xm>" prefix when we have a recent fix, otherwise ''.
// Helps the walker correlate "no signal" with the last known accuracy.
function gpsPrecisionPrefix() {
    let p = GEO && GEO.lastPosition;
    if (!p || !p.coords || typeof p.coords.accuracy !== 'number') return '';
    return '<b>Dernière précision GPS:</b> ' + Math.round(p.coords.accuracy) + ' m<br /><br />';
}

function setGpsLostOverlay(opts) {
    opts = opts || {};
    let body = opts.html || GPSLOST_TEXT_DEFAULT;
    // Prepend precision only on the default (transient signal-loss) copy.
    // Auth-revoked / battery-kill copies already explain a concrete cause.
    if (!opts.html) body = gpsPrecisionPrefix() + body;
    $('#gpslost-overlay-desc').html(body);
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

// Called GPS_DOZE_ESCALATION_MS after GPS-lost fires if signal hasn't recovered.
// Overwrites the generic "Signal GPS perdu" copy with actionable Doze guidance.
// Guards re-checked at call time so we don't fire on a now-stationary walker
// or if a more specific overlay (revoked / battery-kill) already took over.
function showDozeEscalation() {
    GPS_DOZE_TIMER = null;
    if (currentPage !== 'parcours') return;
    if (GPSSIGNAL_OK) return;          // signal came back before timer fired
    if (GPSREVOKED) return;            // revoked overlay already showing
    if (GEO.motionIsStationary) return;// walker stopped — Doze is expected here
    if (GEO.mode() === 'simulate') return;
    var gapMs = (GEO.lastTimeUpdate != null) ? (Date.now() - GEO.lastTimeUpdate) : null;
    console.warn('GPS Doze escalation: no callback for', gapMs, 'ms');
    TELEMETRY.log('gps_doze_suspect', {
        step: PARCOURS.currentStep(),
        gap_ms: gapMs ? Math.round(gapMs) : null,
        motion_stationary: !!GEO.motionIsStationary,
        platform: typeof PLATFORM !== 'undefined' ? PLATFORM : 'unknown',
        manufacturer: (typeof device !== 'undefined' && device) ? device.manufacturer : null,
    });
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    setGpsLostOverlay({html: GPSLOST_TEXT_DOZE});
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
        // GPS-lost takes priority over LOST. Always suppress the LOST band /
        // loop, even if the UX gates below skip the gpslost overlay — the
        // signal is unreliable, so we must not let LOST run on top.
        GPSSIGNAL_OK = false;
        if (PARCOURS.state.lost) {
            $('#lost-band').hide();
            LOST_PLAYER.stop();
        }

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
        // Arm the Doze escalation: if signal doesn't return within
        // GPS_DOZE_ESCALATION_MS, overwrite the generic copy with actionable
        // "déverrouillez l'écran" guidance (R4.3 option 0).
        clearTimeout(GPS_DOZE_TIMER);
        GPS_DOZE_TIMER = setTimeout(showDozeEscalation, GPS_DOZE_ESCALATION_MS);
    }
    if (state == 'ok') {
        // Signal recovered — cancel any pending Doze escalation.
        clearTimeout(GPS_DOZE_TIMER);
        GPS_DOZE_TIMER = null;
        GPSSIGNAL_OK = true;
        // Drop any stale sustain timestamp — a value from before the signal
        // dropped would let LOST fire on the very first recovered tick instead
        // of giving the walker a fresh window to get back on course.
        PARCOURS._lostBeyondSince = null;
        // If LOST was active going into the GPS-lost window, repaint the
        // band+loop now that GPS is back. evaluateLostState will exit LOST on
        // the next position tick if the walker is already in range.
        if (PARCOURS.state.lost && currentPage === 'parcours') applyLostUI();

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

// F-K3 — periodic re-check of the Android power-restriction state during the
// walk. checkbatteryopt only runs once at onboarding; Samsung One UI's auto
// policies can flip "Background usage limits → Restricted" mid-walk on
// infrequently-used apps. Cheap probe (5 min cadence) catches the flip and
// surfaces it post-hoc — phase 1B may turn this into a live mid-walk hard
// block once we know how often it fires.
setInterval(() => {
    if (currentPage !== 'parcours') return;
    if (PLATFORM !== 'android') return;
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.PowerOptimization) return;
    var po = cordova.plugins.PowerOptimization;
    var psPromise  = (typeof po.IsPowerSaveMode          === 'function') ? po.IsPowerSaveMode().catch(function(e)          { return 'error:'+e; }) : Promise.resolve('n/a');
    var brPromise  = (typeof po.IsBackgroundRestricted   === 'function') ? po.IsBackgroundRestricted().catch(function(e)   { return 'error:'+e; }) : Promise.resolve('n/a');
    var igPromise  = (typeof po.IsIgnoringBatteryOptimizations === 'function') ? po.IsIgnoringBatteryOptimizations().catch(function(e) { return 'error:'+e; }) : Promise.resolve('n/a');
    var sbPromise  = (typeof po.GetStandbyBucket         === 'function') ? po.GetStandbyBucket().catch(function(e)         { return 'error:'+e; }) : Promise.resolve('n/a');
    var memPromise = (typeof po.GetMemoryInfo            === 'function') ? po.GetMemoryInfo().catch(function(e)            { return 'error:'+e; }) : Promise.resolve('n/a');
    Promise.all([psPromise, brPromise, igPromise, sbPromise, memPromise]).then(function(r) {
        TELEMETRY.log('bg_restrictions_recheck', {
            power_save:        r[0],
            bg_restricted:     r[1],
            ignoring_batt_opt: r[2],
            standby_bucket:    r[3],
            memory_info:       r[4],
            step:              (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
        });
    });
}, 5 * 60 * 1000);

// F-A2 — periodic native audio session state snapshot (audiofocus plugin v1.6.0 AF-6).
// Calls getAudioSessionState() once per minute while on the parcours page to confirm
// the iOS AVAudioSession / Android AudioManager is not silently degraded mid-walk
// (e.g. session inactive after a background restart or an unhandled route change).
setInterval(() => {
    if (currentPage !== 'parcours') return;
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.audiofocus) return;
    var af = cordova.plugins.audiofocus;
    if (typeof af.getAudioSessionState !== 'function') return;
    af.getAudioSessionState().then(function(state) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_session_state', Object.assign({}, state, {
            step: (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
        }));
    }).catch(function(e) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audio_session_state', {
            error: String(e),
            step: (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
        });
    });
}, 60000);

// F-G1b (BG-4) — iOS native power state snapshot once per minute (bg-geo v2.5.0).
// Returns lowPowerMode + batteryLevel + batteryState via the plugin CDV action.
// Complements the Android bg_restrictions_recheck interval for post-hoc
// low-power-mode correlation with P1.34 GPS blackouts.
setInterval(() => {
    if (currentPage !== 'parcours') return;
    if (PLATFORM !== 'ios') return;
    var bgGeoPS = (typeof BackgroundGeolocation !== 'undefined') ? BackgroundGeolocation : null;
    if (!bgGeoPS || typeof bgGeoPS.getPowerState !== 'function') return;
    bgGeoPS.getPowerState().then(function(state) {
        if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('ios_power_state', Object.assign({}, state, {
            step: (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
        }));
    }).catch(function(e) { /* non-fatal */ });
}, 60000);

// B4 diagnostic — periodic real-callback freshness sample. Fires every 30s
// while on parcours and logs how stale the last *real* GPS callback is, plus
// motion + visibility context. With keepalive ticks confusing the existing
// stateUpdateTimeout, this is the cleanest baseline to confirm S1/P1.34
// (iOS 26.3.x background-GPS blackouts) and P1.31 (Android Doze) on the next
// field test. UI band / gps_frozen escalation lands in phase 1B once we've
// seen the distribution.
setInterval(() => {
    if (currentPage !== 'parcours') return;
    if (typeof GEO === 'undefined') return;
    if (GEO.mode && GEO.mode() === 'simulate') return;
    var lastReal = GEO.lastRealCallbackTime;
    var lastAny  = GEO.lastTimeUpdate;
    var now = Date.now();
    TELEMETRY.log('real_callback_freshness', {
        real_age_ms:    lastReal != null ? now - lastReal : null,
        any_age_ms:     lastAny  != null ? now - lastAny  : null,
        motion_stationary: !!GEO.motionIsStationary,
        visibility:     typeof APP_VISIBILITY !== 'undefined' ? APP_VISIBILITY : 'unknown',
        state:          GEO.stateUpdate,
    });
    // F-G1 (BG-3) — CLLocationManager state snapshot alongside each freshness sample (iOS only, bg-geo v2.5.0).
    // Captures allowsBackgroundLocationUpdates, pausesLocationUpdatesAutomatically,
    // authorizationStatus, and timestamp age so post-hoc analysis can correlate
    // CLLocationManager degradation with real-callback blackouts (P1.34).
    if (PLATFORM === 'ios') {
        var bgGeoFG1 = (typeof BackgroundGeolocation !== 'undefined') ? BackgroundGeolocation : null;
        if (bgGeoFG1 && typeof bgGeoFG1.getCLState === 'function') {
            bgGeoFG1.getCLState().then(function(clState) {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('cl_state', Object.assign({}, clState, {
                    real_age_ms: lastReal != null ? Date.now() - lastReal : null,
                    step: (typeof PARCOURS !== 'undefined' && PARCOURS.state) ? PARCOURS.state.stepIndex : null,
                }));
            }).catch(function(e) { /* non-fatal */ });
        }
    }
}, 30000);

// Periodic re-request of AUDIOFOCUS while the resume overlay is still up.
// Some Android OEMs (and occasionally iOS) drop the AUDIOFOCUS_GAIN callback
// after a transient loss, leaving the walker silent in their pocket with no
// way to recover unless they look at the screen and tap. We re-ask once a
// minute and vibrate the first few attempts to nudge them.
var AUDIOFOCUS_RETRY_COUNT = 0;
setInterval(() => {
    // Allow the tools page in devmode so the show-resume-overlay test fires
    // its retry without forcing the tester onto a live parcours.
    if (currentPage !== 'parcours' && !(DEVMODE && currentPage === 'tools')) return;
    if (typeof AUDIOFOCUS === 'undefined' || AUDIOFOCUS !== 0) {
        AUDIOFOCUS_RETRY_COUNT = 0;
        return;
    }
    if (!$('#resume-overlay').is(':visible')) {
        AUDIOFOCUS_RETRY_COUNT = 0;
        return;
    }
    if (GPSREVOKED) return; // revoked overlay takes priority

    AUDIOFOCUS_RETRY_COUNT++;
    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('audiofocus_auto_retry', {attempt: AUDIOFOCUS_RETRY_COUNT});
    if (AUDIOFOCUS_RETRY_COUNT <= 3 && navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);

    if (typeof requestAudioFocus === 'function') {
        requestAudioFocus().catch((e) => console.warn('[AudioFocus] auto-retry failed:', e));
    }
}, 60000);

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


