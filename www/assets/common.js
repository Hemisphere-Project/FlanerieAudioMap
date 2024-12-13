// LOGS functions
//

//  if url contains 'flanerie'
const FRONT_LOGS = window.location.href.includes('flanerie')

// copy console.log and console.error to $('#logs')
console._log = console.log
if ($('#logs').length && FRONT_LOGS) 
console.log = function(...message) {
    console._log(message)
    if (typeof message === 'object') {
        message = JSON.stringify(message)
    }
    $('#logs').append(message + '<br/>')
   $('#logs').scrollTop($('#logs')[0].scrollHeight)
}
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

// FETCH functions
//

function post(path, data) {
    return fetch(path, {
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
    return fetch(path, {
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
    path = new URLSearchParams(data).toString() ? path + '?' + new URLSearchParams(data).toString() : path
    return fetch(path)
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

    emit(event, ...args) {
        if (this._events[event]) {
            this._events[event].forEach(listener => listener(...args))
        }
        return this
    }
}