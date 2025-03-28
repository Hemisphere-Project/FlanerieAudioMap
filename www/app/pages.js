var DISTANCE_MATCH = 100000000000000;

var DEVMODE = true;

var noSleep = null;

// GLOBALS
//
const PARCOURS = document.PARCOURS;
const GEO = document.GEO;

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
// TITLE ANIMATION
//
PAGES['title'] = () => {
    TYPEWRITE('title', 90, 1000)
    $('#title').off('click').on('click', () => PAGE('intro') );
}


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
        .callFunction(() => {if(currentPage=='intro') PAGE('checkgeo')} )
        
    $('#intro').off('click').on('click', () => PAGE('checkgeo') );
}

PAGES['checkgeo'] = () => {

    if (!DEVMODE) {
        GEO.startGeoloc()
            .then(()=>PAGE('checkdata'))
            .catch(()=>PAGE('nogeo'))
    }
    else {
        $('#checkgeo-select').show();
        $('#checkgeo-select-gps').off('click').on('click', () => {
            GEO.startGeoloc()
                .then(()=>PAGE('checkdata'))
                .catch(()=>PAGE('nogeo'))
        })
        $('#checkgeo-select-simul').off('click').on('click', () => {
            GEO.simulateGeoloc()
            PAGE('checkdata')
        });
    }
}

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
            var availableParcours = parcours.filter(p => GEO.distance(p) < DISTANCE_MATCH);
            // if (availableParcours.length > 0) 
                PAGE('select', availableParcours);
            // else PAGE('noparcours');
        })
        .catch(error => PAGE('nodata'));
}


PAGES['nodata'] = () => {
    TYPEWRITE('nodata-retry')
        .pauseFor(2000)
        .callFunction(() => PAGE('checkdata') )
}

PAGES['nogeo'] = () => {
    TYPEWRITE('nogeo-retry')
        .pauseFor(2000)
        .callFunction(() => PAGE('checkgeo') )
}

PAGES['noparcours'] = () => {
    TYPEWRITE('noparcours-retry')
}

PAGES['select'] = (list) => {

    // List
    var select = document.getElementById('select-parcours');
    select.innerHTML = '';
    list.forEach(p => {
        var li = document.createElement('li');
        li.innerHTML = p.name;
        li.addEventListener('click', () => PAGE('load', p));
        select.appendChild(li);
    });

    // Only one parcours => click it
    if (list.length == 1) select.querySelector('li').click();
}

PAGES['load'] = (p) => {
    var progress = setInterval(() => {
        var p = PARCOURS.loadprogress();
        $('#load-progress').text(p + '%');
    }, 1000);

    PARCOURS.load(p.file).then(() => {
        clearInterval(progress);
        PAGE('parcours')
    })
    .catch(() => {
        clearInterval(progress);
        PAGE('nodata')
    })
}

PAGES['parcours'] = () => {
    console.log('PARCOURS', PARCOURS);
    // if (!PARCOURS.valid()) return PAGE('select')

    // MAP
    var MAP = initMap('parcours-map', {
            zoom: 17,
            zoomControl: false,
            dragging: false,
        })
    
    PARCOURS.hideSpotMarkers()
    MAP.showPositionMarker()
    
    if (GEO.mode() == 'simulate') {
        // set GEO position to 10m from parcours start
        var position = PARCOURS.find('steps', 0).getCenterPosition()
        position[0] += 0.0005
        console.log('SET POSITION', position)
        GEO.setPosition(position)
    }
    MAP.toPosition(true)
    setTimeout(() => PARCOURS.showSpotMarker('steps', 0, true, false), 1000)
    // setTimeout(() => GEO.followMe(), 5000)
    

    $('#parcours-title').text(PARCOURS.info.name);
    TYPEWRITE('parcours-init')
        // .pauseFor(2000)
        .callFunction(() => GEO.followMe() )

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
            sNext = PARCOURS.find('steps', i)
        }


        // First step
        if (s._index == 0) {
            $('#parcours-init').text("Suivez la guide ...")
            TYPEWRITE('parcours-init')

            // Show objects
            PARCOURS.spots.zones.map(z => z.showMarker())
        }
        
    })

    // ON step done: hide
    PARCOURS.on('done', (s) => {
        if (s._type != 'steps') return
        s.showMarker('grey', 0.5)

        // Last step
        if (s._index + 1 == PARCOURS.spots.steps.length) {
            console.log('END OF PARCOURS')
            PAGE('end')
        }
    })
}


// End
PAGES['end'] = () => {

    var ending = true
    function end() {
        if (!ending) return;
        TYPEWRITE('parcours-end')
            .typeString('C\'est la fin...')
            .pauseFor(2000)
            .deleteAll()
            .typeString('Merci de votre participation !')
            .pauseFor(2000)
            .deleteAll()
            .typeString('A bientôt.')
            .pauseFor(2000)
            .deleteAll()
            .pauseFor(5000)  
            .callFunction(() => end())
    }
    end();
    
}





// START
PAGE('title');
// PAGE('checkgeo');