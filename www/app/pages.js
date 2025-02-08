var DISTANCE_MATCH = 10000;

// 
// PAGE SELECT
//
var PAGES = {}
var currentPage = '';

function PAGE(name, ...args) 
{
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
    var content = $(div).text();
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
    $('#title').off('click').on('click', () => PAGE('check') );
}


PAGES['intro'] = () => {
    TYPEWRITE('intro')
        .pauseFor(2000)
        .callFunction(() => PAGE('check') )
}

PAGES['check'] = () => {

    // check if geolocation is available
    if (!navigator.geolocation) PAGE('nogeo');

    // check if user accept geolocation
    navigator.geolocation.getCurrentPosition(
        position => {

            // once position check if stored parcours is available and not too far
            if (PARCOURS.valid()) 
                if (geo_distance(position, PARCOURS) < DISTANCE_MATCH) 
                    return PAGE('parcours')

            // if not, check if parcours are available online
            get('/list')
                .then(parcours => {
                    var availableParcours = parcours.filter(p => geo_distance(position, p) < DISTANCE_MATCH);
                    if (availableParcours.length > 0) PAGE('select', availableParcours);
                    else PAGE('noparcours');
                })
                .catch(error => PAGE('nodata'));
        },
        error => PAGE('nogeo')
    );
}

PAGES['nodata'] = () => {
    TYPEWRITE('nodata-retry')
        .pauseFor(2000)
        .callFunction(() => PAGE('check') )
}

PAGES['nogeo'] = () => {
    TYPEWRITE('nogeo-retry')
        .pauseFor(2000)
        .callFunction(() => PAGE('check') )
}

PAGES['noparcours'] = () => {
    TYPEWRITE('noparcours-retry')
}

PAGES['select'] = (list) => {

    // List
    var select = document.getElementById('select-parcours');
    list.forEach(p => {
        var li = document.createElement('li');
        li.innerHTML = p.name;
        li.addEventListener('click', () => {
            // add active class
            select.querySelectorAll('li').forEach(li => li.classList.remove('active'));
            li.classList.add('active');
        });
        select.appendChild(li);
    });

    // Go
    $('#select-parcours-start').off('click').on('click', () => {
        var active = select.querySelector('.active');
        if (active) {
            var parcours = list.find(p => p.name === active.innerHTML);
            PARCOURS.load(parcours.file)
                .then(() => PAGE('parcours'))
                // .catch(error => PAGE('select'));
        }
    });
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
    PARCOURS.setMap(MAP)
    PARCOURS.hideSpotMarkers()
    
    MAP.setView(geo_coords(position), MAP.getZoom())
    
    $('#parcours-title').text(PARCOURS.info.name);
    TYPEWRITE('parcours-init')
        .callFunction(() => PARCOURS.showSpotMarker('steps', 0, true) )
}



// START
PAGE('title');