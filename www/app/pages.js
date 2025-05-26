var DISTANCE_MATCH = 20; // 20m 
var DISTANCE_RDV = 20; // 10m (to validate RDV)

var DEVMODE = localStorage.getItem('devmode') == 'true' || false;
var SELECTED_PARCOURS = localStorage.getItem('selectedparcours') || null;

var PLATFORM = 'browser';
try {
    if (cordova.platformId) PLATFORM = cordova.platformId;
} catch (e) {}

// GLOBALS
//
const PARCOURS = document.PARCOURS;
const GEO = document.GEO;

var noSleep = null;

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
    // once position check if stored parcours is available and not too far
    if (PARCOURS.valid()) 
        if (GEO.distance(PARCOURS) < DISTANCE_MATCH) 
            return PAGE('parcours')

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
        // .catch(error => PAGE('nodata'));
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
        let dlNeeded = PARCOURS.mediaPackSize - PARCOURS.mediaPackLoaded
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

//
// RENDEZ-VOUS
//
PAGES['rdv'] = () => {
    $('#rdvdistance').hide()

    var checkpos = setInterval(() => {
        if (!GEO.ready()) return;
        let d = PARCOURS.find('steps', 0).distanceToBorder(GEO.position())

        

        $('#rdvdistance').show().text('Distance: '+Math.round(d) + ' m');
        // if (d < 0) {
            // if (d < DISTANCE_RDV) {
        clearInterval(checkpos);
        $('#rdv-accept').show() 
        $('#rdvdistance').hide()
        // }
        
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
    if (testplayer) testplayer.stop();

    let testpath = BASEURL+'/images/test.mp3';
    console.log('[AUDIO] testing with ', testpath);

    let html5enabled = (PLATFORM == 'ios')

    testplayer = new Howl({
        src: testpath,
        loop: true,
        autoplay: false,
        volume: 1,
        html5: html5enabled
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
        PAGE('sas')
    })

    $('#checkaudio-help').off().on('click', () => {
        alert('Demandez de l\'aide à un membre de l\'équipe !');
    })

    if (DEVMODE) $('#checkaudio-accept').show()
}

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
        $('#sas-code').off().on('blur', () => {
            $('#sas-code').focus()
        })
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
PAGES['parcours'] = () => {
    console.log('PARCOURS', PARCOURS);
    // if (!PARCOURS.valid()) return PAGE('select')

    Howler.ctx.resume();

    // MAP
    var MAP = initMap('parcours-map', {
            zoom: 19,
            maxZoom: 19,
            zoomControl: false,
            dragging: false,
        })
    
    PARCOURS.hideSpotMarkers()

    // Info
    $('#parcours-title').text(PARCOURS.info.name);
    $('#parcours-run').hide()

    // Lost button
    $('#parcours-lost').hide().off().on('click', () => {
        console.log('LOST');
        $('#parcours-map').css('opacity', 1)
        $('#parcours-lost').hide()
    })

    // Activate Parcours (TODO: move it somehere else)
    GEO.on('position', (position) => {
        PARCOURS.update(position)
    })

    // ON step fire: show next
    PARCOURS.on('fire', (s) => {
        if (s._type != 'steps') return
        s.showMarker('yellow')

        let i = s.index() + 1;
        let sNext = PARCOURS.find('steps', i)
        while (sNext) {
            sNext.showMarker('red')
            if (!sNext._spot.optional) break;
            i++;
            if (!DEVMODE) break;    // show only next step in normal mode
            sNext = PARCOURS.find('steps', i)
        }


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
        if (!DEVMODE) {
            $('#parcours-map').css('opacity', 0)
            $('#parcours-lost').show()
        }
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

    TYPEWRITE('parcours-init')
    PARCOURS.find('steps', 0).showMarker('red')
    

    // SIMULATION: set GEO position to 10m from parcours start
    if (GEO.mode() == 'simulate') 
    {
        // Set fake position
        var position = PARCOURS.find('steps', 0).getCenterPosition()
        position[0] += 0.0003
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
    stepIndex = -2
    PARCOURS.stopAudio()
    setTimeout(() => document.MAP.fire('move'), 2000)
})