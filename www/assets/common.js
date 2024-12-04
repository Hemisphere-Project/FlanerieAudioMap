// LOGS functions
//

// copy console.log and console.error to $('#logs')
console._log = console.log
console.log = function(message) {
    console._log(message)
    if (typeof message === 'object') {
        message = JSON.stringify(message)
    }
    $('#logs').append(message + '<br/>')
    $('#logs').parent().parent().scrollTop($('#logs').parent()[0].scrollHeight)

}
console._error = console.error
console.error = function(message) {
    console._error(message) 
    if (typeof message === 'object') {
        message = JSON.stringify(message)
    }
    $('#logs').append('<span style="color:red">' + message + '</span><br/>')
    $('#logs').parent().parent().scrollTop($('#logs').parent()[0].scrollHeight)
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