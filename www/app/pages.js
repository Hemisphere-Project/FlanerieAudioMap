var DISTANCE_MATCH = 20; // 20m 
var DISTANCE_RDV = 20; // 10m (to validate RDV)

var DEVMODE = localStorage.getItem('devmode') == 'true' || false;

var PLATFORM = 'browser';
try {
    if (cordova.platformId) PLATFORM = cordova.platformId;
} catch (e) {}

// GLOBALS
//
var noSleep = null;

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
var currentPage = '';

function PAGE(name, ...args) 
{
    if (currentPage === name) return;
    console.log('PAGE', name, args);
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

            // GPS: check distance (< 10km)
            // if (GEO.mode() != 'simulate') {
            //     availableParcours = availableParcours.filter(p => GEO.distance(p) < DISTANCE_MATCH);
            // }

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
    .catch(() => {
        clearInterval(progress);
        PAGE('nodata')
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

    // Not Android or no permissions plugin: skip
    if (PLATFORM != 'android' || cordova.plugins.permissions == undefined) 
        return PAGE('rdv');

    // Check Android version >= 13
    var apiLevel = parseInt(device.version.split('.')[0], 10); // "13" for Android 13
    if (apiLevel < 13) return PAGE('rdv');

    $('#checknotifications-settings').show().off().on('click', () => GEO.showAppSettings());

    function checkNotif() {
        var permissions = cordova.plugins.permissions;
        permissions.checkPermission(permissions.POST_NOTIFICATIONS, function(status) {
            console.log('Notification permission status:', status.hasPermission);
            if (status.hasPermission && APP_VISIBILITY == 'foreground') PAGE('rdv')
            else setTimeout(() => { checkNotif() }, 1000);
            }, function(e) {
                // Error handling
                console.error('Error checking notification permission', e);
                return PAGE('rdv');
            });
    }
    checkNotif();
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
        delete testplayer
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
var timersBG = null
PAGES['checkbackground'] = () => {
    
    // not WebApp: skip
    if (!document.WEBAPP_URL || GEO.mode() == 'simulate') {
        return PAGE('sas');
    }

    // Players
    var playerTEST = new Howl({
        src: BASEURL+'/images/background-test.mp3', autoplay: false, volume: 1, html5: (PLATFORM == 'ios')
    })
    var playerOK = new Howl({
        src: BASEURL+'/images/background-ok.mp3', autoplay: false, volume: 1, html5: (PLATFORM == 'ios')
    })
    var playerKO = new Howl({
        src: BASEURL+'/images/background-ko.mp3', autoplay: false, volume: 1, html5: (PLATFORM == 'ios')
    })

    function cleanupTest() {
        stopTest();
        delete playerTEST;
        delete playerOK;
        delete playerKO;
    }
    function stopTest() {
        clearTimeout(timersBG);
        document.removeEventListener('pause', wentBG);
        document.removeEventListener('resume', wentFG);
        playerTEST.stop();
        playerOK.stop();
        playerKO.stop();
    }

    // Skip button
    $('#checkbackground-force').toggle(DEVMODE).off().on('click', () => {
        cleanupTest();
        PAGE('sas');
    })

    var testResult = false;
    var testCount = 0;
    stopTest();

    // Background test
    function wentBG() {
        console.log('[STATE] APP_VISIBILITY', APP_VISIBILITY);
        stopTest();
        document.addEventListener('resume', wentFG);        // listen for foreground
        playerTEST.play();
        console.log('[BACKGROUND] test started, playing wait instructions');
        clearTimeout(timersBG);
        testResult = false; 
        timersBG = setTimeout(() => {
            testResult = GEO.alive(5000);
        }, 10000);
        testCount++;
    }

    // Foreground test
    function wentFG() {
        console.log('[STATE] APP_VISIBILITY', APP_VISIBILITY);
        stopTest();
     
        if (testResult) 
        {
            console.log('[BACKGROUND] test success');
            $('#checkbackground-desc').html('TEST réussi ! Le GPS fonctionne bien en arrière-plan.');  
            $('#checkbackground-force').toggle(DEVMODE)
            playerOK.play();
            setTimeout(() => {
                cleanupTest();
                PAGE('sas');
            }, 4000);
        } 
        else {
            console.log('[BACKGROUND] test failed');
            playerKO.play();
            $('#checkbackground-desc').html('ECHEC DU TEST: Veuillez vérifier les paramètres de localisation, désactivez le mode économie d\'énergie et réessayer de mettre en veille<br /><br />\
                Demandez de l\'aide à un membre de l\'équipe si besoin.');
            document.addEventListener('pause', wentBG);
            if (testCount > 1) $('#checkbackground-force').show()
        }
    }

    document.addEventListener('pause', wentBG);
}

//
// SAS
//
PAGES['sas'] = () => {
    if (timersBG) clearTimeout(timersBG);
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
                PAGE('parcours')
                $('#sas-code').off()
            }
            else $('#sas-help').click()
            $('#sas-code').attr('disabled', false).val('').focus() 
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
SILENT_PLAYER.load(BASEURL+'/images/', 'flanerie.mp3', false);

PAGES['parcours'] = () => {

    SILENT_PLAYER.play(); // Play silent track
    
    // Dummy player
    if (testplayer) {
        testplayer.stop();
        delete testplayer;
    }
    testplayer = new Howl({
        src: BASEURL+'/images/flanerie.mp3',
        loop: true,
        autoplay: false,
        volume: 1,
        html5: (PLATFORM == 'ios')
    })
    testplayer.play()
    testplayer.on('play', () => {
        console.log('[AUDIO] Playing silent track');
    })
    testplayer.on('pause', () => {
        console.log('[AUDIO] Paused silent track');
    })




    console.log('PARCOURS', PARCOURS);
    // if (!PARCOURS.valid()) return PAGE('select')

    if (Howler.ctx) Howler.ctx.resume();

    var isResume = PARCOURS.valid() && PARCOURS.currentStep() >= 0;

    // MAP
    var MAP = initMap('parcours-map', {
            zoom: 19,
            maxZoom: 19,
            zoomControl: false,
            dragging: false,
        })
    
    PARCOURS.hideSpotMarkers()

    // Function to update markers
    function updateStepsMarkers() {

        // Mark passed steps in grey, current step in yellow
        PARCOURS.spots.steps.forEach((s, i) => {
            if (i < PARCOURS.currentStep()) {
                s.showMarker('grey', 0.5)
            }
            else if (i == PARCOURS.currentStep()) {
                s.showMarker('yellow')
            }
        })

        // Show next steps in red
        let i = PARCOURS.currentStep() + 1;
        let sNext = PARCOURS.find('steps', i)
        while (sNext) {
            sNext.showMarker('red')
            if (!sNext._spot.optional) break;
            i++;
            if (!DEVMODE) break;    // show only next step in normal mode
            sNext = PARCOURS.find('steps', i)
        }
    }

    // ON step fire: show next
    PARCOURS.on('fire', (s) => {
        if (s._type != 'steps') return
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

        isResume = false;
    })

    // ON step done: hide
    PARCOURS.on('done', (s) => {
        if (s._type != 'steps') return
        s.showMarker('grey', 0.5)

        // Last step
        if (s._index + 1 == PARCOURS.spots.steps.length) {
            console.log('END OF PARCOURS')
            if (!DEVMODE) PAGE('end')
        }
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

    // First RUN
    if (PARCOURS.currentStep() < 0) {
        console.log('FIRST RUN')
        TYPEWRITE('parcours-init')
        PARCOURS.find('steps', 0).showMarker('red')
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
        position[0] += 0.0004
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
    PARCOURS.currentStep(-2) // Reset current step
    PARCOURS.stopAudio()

    // set all steps markers to red
    PARCOURS.spots.steps.forEach((s, i) => {
        s.showMarker('red')
    })

    setTimeout(() => document.MAP.fire('move'), 2000)
})

$('#parcours-restart').click(() => {
    console.log('RESTART');
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