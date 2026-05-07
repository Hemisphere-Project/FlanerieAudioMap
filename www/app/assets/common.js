// LOGS functions
//

//  if url contains 'flanerie'
// const FRONT_LOGS = window.location.href.includes('flanerie')
const FRONT_LOGS = true

// copy console.log and console.error to $('#logs')
console._log = console.log
console._warn = console.warn
console._error = console.error

function _logsAppend(color, ...message) {
    let text
    if (typeof message === 'object') {
        try { text = JSON.stringify(message, null, 2) }
        catch (e) { text = String(message) }
    } else {
        text = String(message)
    }
    const $line = $('<span>').text(text)
    if (color) $line.css('color', color)
    $('#logs').append($line).append('<br/>')
}

if ($('#logs').length && FRONT_LOGS) {
    console.log = function(...message) {
        console._log(message)
        _logsAppend(null, ...message)
    }

    console.warn = function(...message) {
        console._warn(message)
        _logsAppend('orange', ...message)
    }

    console.error = function(...message) {
        console._error(message)
        _logsAppend('red', ...message)
    }
}

// PLATFORM detection — must be defined before player.js registers its deviceready
// handler, because after document.write() Cordova may fire deviceready synchronously.
var PLATFORM = 'browser';
try { if (cordova.platformId) PLATFORM = cordova.platformId; } catch (e) {}

// PATH functions
//
function prep(path) {
    if (path.startsWith('http') || !document.WEBAPP_URL) return path
    if (!path.startsWith('/')) path = '/' + path
     return document.WEBAPP_URL + path
}
// FETCH functions
//

// if not defined fetchRemote, use fetch
if (typeof fetchRemote === 'undefined') {
    fetchRemote = fetch
}

function post(path, data) {
    path = prep(path)
    return fetchRemote(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (response.status !== 200) {
            // check if there was JSON
            const contentType = response.headers.get('Content-Type')
            if (contentType && contentType.includes('application/json')) {
                // return a rejected Promise that includes the JSON
                return response.json().then((json) => Promise.reject(json.error))
            }
            // no JSON, just throw an error
            throw new Error('Erreur ' + response.status + ' sur ' + path)
        }
        else {
            const contentType = response.headers.get('Content-Type')
            if (contentType && contentType.includes('application/json')) {
                return response.json()
            }
            else {
                return response.text()
            }
        }
    })
    .catch(error => {
        console.warn('POST ' + path + ':', error)
        return Promise.reject(error)
    })
}

function postFile(path, data) {
    path = prep(path)
    return fetchRemote(path, {
        method: 'POST',
        body: data
    })
    .then(response => {
        if (response.status !== 200) {
            // check if there was JSON
            const contentType = response.headers.get('Content-Type')
            if (contentType && contentType.includes('application/json')) {
                // return a rejected Promise that includes the JSON
                return response.json().then((json) => Promise.reject(json.error))
            }
            // no JSON, just throw an error
            throw new Error('Erreur ' + response.status + ' sur ' + path)
        }
        else {
            const contentType = response.headers.get('Content-Type')
            if (contentType && contentType.includes('application/json')) {
                return response.json()
            }
            else {
                return response.text()
            }
        }
    })
    .catch(error => console.warn('POST file ' + path + ':', error))
}


function get(path, data) {
    path = prep(path)
    path = new URLSearchParams(data).toString() ? path + '?' + new URLSearchParams(data).toString() : path
    return fetchRemote(path)
        .then(response => {
            if (response.status !== 200) {
                // check if there was JSON
                const contentType = response.headers.get('Content-Type')
                if (contentType && contentType.includes('application/json')) {
                    // return a rejected Promise that includes the JSON
                    return response.json().then((json) => Promise.reject(json.error))
                }
                // no JSON, just throw an error
                throw new Error('Erreur ' + response.status + ' sur ' + path)
            }
            else {
                return response.text().then((text) => {
                    try {
                        return JSON.parse(text)
                    } catch (e) {
                        // if JSON parsing fails, return the text
                        return text
                    }
                })
            }
        })
}

// EventEmitter class
//
class EventEmitter {
    constructor() {
        this._events = {}
    }

    on(event, listener) {
        if (!this._events[event]) {
            this._events[event] = []
        }
        this._events[event].push(listener)
        return this
    }

    once(event, listener) {
        const onceListener = (...args) => {
            listener(...args)
            this.off(event, onceListener)
        }
        return this.on(event, onceListener)
    }

    emit(event, ...args) {
        if (this._events[event]) {
            this._events[event].forEach(listener => listener(...args))
        }
        return this
    }

    off(event, listener) {
        if (this._events[event]) {
            this._events[event] = this._events[event].filter(l => l !== listener)
        }
        return this
    }

    removeAllListeners(event) {
        delete this._events[event]
        return this
    }
}