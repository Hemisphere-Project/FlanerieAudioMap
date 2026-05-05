var DISTANCE_RDV = 20; // 20m (to validate RDV)

var COLOR_DONE = 'grey';
var COLOR_NEXT = 'blue';
var COLOR_CURRENT = '#43FAF2';

var DEVMODE = localStorage.getItem('devmode') == 'true' || false;

var PLATFORM = 'browser';
try {
    if (cordova.platformId) PLATFORM = cordova.platformId;
} catch (e) {}

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

PAGES_CLEANUP['parcours']           = () => {
    clearWakeupNotification();
    GPSLOST_PLAYER.stop();
    $('#gpslost-overlay').hide();
};
PAGES_CLEANUP['checknotifications'] = () => clearNotificationPermissionCheck();
PAGES_CLEANUP['checkbatteryopt']    = () => clearBatteryOptCheck();

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
    var $instructions = $('#diag-instructions')
    var $metrics = $('#diag-metrics')
    var $question = $('#diag-question')
    var $qtext = $('#diag-question-text')
    var $result = $('#diag-result')
    var $badge = $('#diag-result-badge')
    var $report = $('#diag-report')
    var $next = $('#diag-next')
    var $skip = $('#diag-skip')

    // Start a telemetry session for diagnostics
    TELEMETRY.start('__diagnostic__', 'Diagnostic')

    function showTest(test, index) {
        var total = runner.tests.length - 1 // exclude report test from count
        var isReport = test.id === 'T11'
        $title.text('🔧 ' + test.name)
        $progress.text(isReport ? 'Terminé' : 'Phase ' + test.phase + ' — Test ' + (index + 1) + '/' + total)
        $instructions.text(test.instructions)
        $metrics.text('')
        $question.hide()
        $result.hide()
        $report.hide()
        $next.show()
        $skip.show()

        if (isReport) {
            showReport()
            $skip.hide()
        } else if (test.auto) {
            $next.hide()
            $skip.show()
        } else {
            $next.text('Suivant')
        }
    }

    function showMetrics(m) {
        var parts = []
        if (m.accuracy_min !== undefined && m.accuracy_min < 999) parts.push('Précision: ' + Math.round(m.accuracy_min) + 'm')
        if (m.positions !== undefined) parts.push('Positions: ' + m.positions)
        if (m.first_fix_ms !== undefined && m.first_fix_ms !== null) parts.push('1er fix: ' + (m.first_fix_ms / 1000).toFixed(1) + 's')
        if (m.play_ok) parts.push('Audio: OK ✓')
        if (m.had_error) parts.push('Audio: ERREUR ✗')
        if (m.total_distance !== undefined) parts.push('Distance: ' + Math.round(m.total_distance) + 'm')
        if (m.max_gap_ms !== undefined && m.max_gap_ms > 0) parts.push('Gap max: ' + (m.max_gap_ms / 1000).toFixed(1) + 's')
        if (m.distance_to_zone !== undefined) parts.push('Zone: ' + m.distance_to_zone + 'm')
        if (m.triggered) parts.push('Déclenché ✓')
        if (m.bg_positions !== undefined) parts.push('Pos. arrière-plan: ' + m.bg_positions)
        if (m.heartbeat_count !== undefined) parts.push('Heartbeats: ' + m.heartbeat_count)
        if (m.gps_lost_events !== undefined && m.gps_lost_events > 0) parts.push('GPS perdus: ' + m.gps_lost_events)
        $metrics.text(parts.join(' | '))
    }

    function showResult(result) {
        var test = runner.tests[runner.currentIndex]
        $result.show()
        if (result.result === 'pass') $badge.attr('class', 'badge-pass').text('✓ PASS')
        else if (result.result === 'fail') $badge.attr('class', 'badge-fail').text('✗ FAIL')
        else $badge.attr('class', 'badge-skip').text('— SKIP')

        TELEMETRY.log('diag_result', { test_id: result.test_id, result: result.result, metrics: result.metrics, user_answer: result.user_answer })

        // If there's a user question, show it
        if (test.userQuestion && result.result !== 'skip') {
            askQuestion(test.userQuestion)
        } else {
            $next.text('Test suivant →').show()
            $skip.hide()
        }
    }

    function askQuestion(text) {
        $qtext.text(text)
        $question.show()
        $next.hide()
        $skip.hide()
    }

    function showReport() {
        var report = runner.getReport()
        $instructions.text('Résultats du diagnostic :')
        $metrics.text('')
        $skip.hide()

        var lines = []
        report.tests.forEach(r => {
            var icon = r.result === 'pass' ? '✓' : r.result === 'fail' ? '✗' : '—'
            var userNote = ''
            if (r.user_answer === true) userNote = ' [utilisateur: oui]'
            if (r.user_answer === false) userNote = ' [utilisateur: non]'
            lines.push(icon + ' ' + r.test_id + ' ' + r.test_name + ': ' + r.result.toUpperCase() + userNote)
        })
        lines.push('')
        lines.push('Plateforme: ' + report.platform)
        lines.push('Appareil: ' + report.device)
        lines.push('Batterie: ' + (report.battery || '?') + '%')
        $report.text(lines.join('\n')).show()

        // Upload report via telemetry
        TELEMETRY.log('diag_report', report)
        TELEMETRY.flush()

        $next.text('Fermer').show()
    }

    // Wire events
    runner.clearAllListeners()  // clear previous listeners

    runner.on('test', (test, index) => showTest(test, index))
    runner.on('metrics', (m) => showMetrics(m))
    runner.on('autoFinish', () => {
        runner.finishCurrent()
    })
    runner.on('result', (result) => {
        showResult(result)
    })
    runner.on('complete', () => {
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

        // If result already shown, advance
        if (result && result.ended_at) {
            runner.next()
        } else {
            // Manual test: finish it
            runner.finishCurrent()
        }
    })

    $skip.off().on('click', () => {
        runner.skip()
    })

    // User question buttons
    $('#diag-yes').off().on('click', () => {
        var result = runner.currentResult()
        if (result) result.user_answer = true
        TELEMETRY.log('diag_user_answer', { test_id: result.test_id, answer: true })
        $question.hide()
        $next.text('Test suivant →').show()
    })

    $('#diag-no').off().on('click', () => {
        var result = runner.currentResult()
        if (result) {
            result.user_answer = false
            // Override result to fail if user says no
            result.result = 'fail'
            $badge.attr('class', 'badge-fail').text('✗ FAIL')
        }
        TELEMETRY.log('diag_user_answer', { test_id: result.test_id, answer: false })
        $question.hide()
        $next.text('Test suivant →').show()
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
                console.log('GEO NOT AUTHORIZED');
                recheck = setTimeout(() => checkAuth(), 1000);
                onError()
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
                if (PLATFORM == 'ios') PAGE('confirmios')
                else if (PLATFORM == 'android') PAGE('checknotifications')
                else PAGE('rdv')
            })
            .catch((e)=>{
                retryAuth++;
                PAGE('confirmgeo')
            })
}

PAGES['confirmios'] = () => {
    $('#confirmios-settings').off().on('click', () => GEO.showAppSettings())
    $('#confirmios-accept').off().on('click', () => PAGE('rdv'))
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

//
// CHECK BATTERY OPTIMIZATION (Android 6+ / API 23+)
// Requires: snt1017/cordova-plugin-power-optimization
// Hard-blocks startup until the app is whitelisted from Android battery optimization.
// OEM-specific restrictions are detected via HaveProtectedAppsCheck() — no hardcoded list.
//
PAGES['checkbatteryopt'] = () => {
    if (DEVMODE) return PAGE('rdv');

    const plugin = (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.PowerOptimization)
        ? cordova.plugins.PowerOptimization : null;

    if (!plugin || PLATFORM !== 'android' || typeof device === 'undefined') return PAGE('rdv');

    var apiLevel = parseInt(device.version.split('.')[0], 10);
    if (apiLevel < 23) return PAGE('rdv');

    clearBatteryOptCheck();

    $('#checkbatteryopt-settings').hide().off().on('click', () => plugin.RequestOptimizationsMenu());
    $('#checkbatteryopt-oem-btn').hide().off().on('click', () => plugin.ProtectedAppCheck(true));
    $('#checkbatteryopt-retry').hide().off().on('click', () => { clearBatteryOptCheck(); check(); });
    $('#checkbatteryopt-oem').hide();

    // Detect OEM-specific battery restriction layers (Samsung, Xiaomi, Huawei, etc.)
    plugin.HaveProtectedAppsCheck()
        .then(hasOEM => {
            if (hasOEM && currentPage === 'checkbatteryopt') {
                $('#checkbatteryopt-oem').show().text(
                    'Votre téléphone a des réglages de batterie spécifiques. Ouvrez les paramètres fabricant et autorisez Flanerie en arrière-plan.'
                );
                $('#checkbatteryopt-oem-btn').show();
            }
        })
        .catch(() => {});

    var dialogShown = false;
    function check() {
        BATTOPT_TIMER = null;
        if (currentPage !== 'checkbatteryopt') return;

        plugin.IsIgnoringBatteryOptimizations()
            .then(isIgnoring => {
                if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { ignoring: isIgnoring, manufacturer: device.manufacturer, apiLevel });
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
                    if (typeof TELEMETRY !== 'undefined') TELEMETRY.log('battery_opt', { blocked: true, manufacturer: device.manufacturer });
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

    // Test audio player
    let ok = true;
    if (testplayer) testplayer.pause();

    let testpath = BASEURL+'/images/test.mp3';
    console.log('[AUDIO] testing with ', testpath);

    testplayer = new Howl({
        src: testpath,
        loop: true,
        autoplay: false,
        volume: 1,
        html5: (PLATFORM == 'ios')
    })
    testplayer.on('play', () => {
        console.log('[AUDIO] OK!');
    })
    testplayer.on('loaderror', (e) => {
        console.log('[AUDIO] ERROR', e)
        ok = false
        $('#checkaudio-accept').hide()
        $('#checkaudio-help').hide()
        $('#checkaudio-desc').text("Erreur de lecture audio. Votre appareil ne semble pas compatible...");
        $('#checkaudio-desc').css('color', 'red');
    })
    testplayer.play()

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
        testplayer.unload()
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
        testplayer.unload();
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
    PARCOURS.on('fire', (s) => {
        if (s._type != 'steps') return
        TELEMETRY.log('step_fire', {step: s._index, name: s._spot.name});
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
    if (testplayer) { testplayer.stop(); testplayer.unload(); testplayer = null; }

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

// TAP RELOAD // DEVMODE
var taps = 0;
var tapTimeout = null;
$('body').off('click').on('click', () => {
    taps++;
    if (taps == 5) 
    {
        // On Title page: toggle DEVMODE
        if (currentPage == 'title') devmode(!DEVMODE);

        // On other pages: reload
        else location.reload();
    }
    if (tapTimeout) clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => taps = 0, 300);
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
    PARCOURS.clearStore()
    location.reload();
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

GEO.stateUpdateTimeout = (PLATFORM == 'android') ? 10 * 1000 : 30 * 1000; // 10s on Android, 30s on iOS
GEO.on('stateUpdate', (state) => {
    if (state == 'lost') {
        if (currentPage != 'parcours') return;                                  // only if on parcours page
        if (GEO.mode() == 'simulate') return;                                   // not in simulate mode
        if (PARCOURS.currentStep() == PARCOURS.spots.steps.length - 1) return;  // not if last step
        if (AUDIOFOCUS == 0) return;
        console.warn('GEO lost position');
        TELEMETRY.log('gps_lost', {step: PARCOURS.currentStep()});
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        pauseAllPlayers();
        GPSLOST_PLAYER.play();
        $('#gpslost-overlay').css('display', 'flex');
    }
    if (state == 'ok') {
        if (currentPage != 'parcours') return; // only if on parcours page
        if (AUDIOFOCUS == 0) return;
        console.log('GEO position ok');
        TELEMETRY.log('gps_recovered', {step: PARCOURS.currentStep()});
        if (navigator.vibrate) navigator.vibrate([200]);
        GPSLOST_PLAYER.stop();
        resumeAllPlayers();
        $('#gpslost-overlay').hide();
    }
    console.log('GEO stateUpdate', state, currentPage, AUDIOFOCUS);
})

$('#gpslost-resume').on('click', () => {
    TELEMETRY.log('gps_force_resume', {step: PARCOURS.currentStep()});
    GPSLOST_PLAYER.stop();
    resumeAllPlayers();
    $('#gpslost-overlay').hide();
})


/// NOTIFICATIONS TRIGGER
// Trigger a silent notification
const NOTIF_REPEAT = 1 * 59 * 1000; // 59 seconds
var NOTIF_COUNTER = 37;
function scheduleWakeupNotification() {
    clearWakeupNotification(false)
    if (currentPage !== 'parcours') {
        clearWakeupNotification()
        return
    }
    if (PLATFORM != 'android' && PLATFORM != 'ios') return
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


