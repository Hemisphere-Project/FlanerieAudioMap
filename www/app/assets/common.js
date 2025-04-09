// LOGS functions
//

//  if url contains 'flanerie'
// const FRONT_LOGS = window.location.href.includes('flanerie')
const FRONT_LOGS = true

// copy console.log and console.error to $('#logs')
// console._log = console.log
// if ($('#logs').length && FRONT_LOGS) 
// console.log = function(...message) {
//     console._log(message)
//     if (typeof message === 'object') {
//         message = JSON.stringify(message)
//     }
//     $('#logs').append(message + '<br/>')
//    $('#logs').scrollTop($('#logs')[0].scrollHeight)
// }
console._error = console.error
if ($('#logs').length && FRONT_LOGS) 
console.error = function(...message) {
    console._error(message) 
    if (typeof message === 'object') {
        message = JSON.stringify(message)
    }
    $('#logs').append('<span style="color:red">' + message + '</span><br/>')
    $('#logs').scrollTop($('#logs')[0].scrollHeight)
}

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
            throw new Error('Something went wrong..')
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
    .catch(error => alert(error))
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
            throw new Error('Something went wrong..')
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
    .catch(error => alert(error))
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
                throw new Error('Something went wrong..')
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