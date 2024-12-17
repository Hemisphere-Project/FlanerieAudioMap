
function deleteParcours(file) {
    post('/deleteParcours', {file: file})
        .then(() => {
            refreshList();
        })    
}


function refreshList() {
    // fetch parcours list
    fetch('/list')
    .then(response => response.json())
    .then(data => {
        const list = document.getElementById('parcours');
        list.innerHTML = '';
        data.forEach(parcours => {
        const tr = document.createElement('tr');
            
            // Name
            const tdName = document.createElement('td');
            tdName.innerHTML = parcours.name;
            tr.appendChild(tdName);

            // Update time
            const tdTime = document.createElement('td');
            // format date to jj/MM/YYYY HH:mm:ss
            tdTime.innerHTML = new Date(parcours.time).toLocaleString('fr-FR');
            tr.appendChild(tdTime);

            // Status
            const tdStatus = document.createElement('td');
            tdStatus.innerHTML = parcours.status;
            tr.appendChild(tdStatus);
            const tdLink = document.createElement('td');
            
            // show button
            const buttonShow = document.createElement('button');
            buttonShow.classList.add('btn', 'btn-warning', 'btn-sm', 'mr-1');
            buttonShow.innerHTML = 'Show';
            buttonShow.addEventListener('click', () => {
                window.location.href = '/show/' + parcours.file;
            })
            tdLink.appendChild(buttonShow);

            // button edit
            const buttonEdit = document.createElement('button');
            buttonEdit.classList.add('btn', 'btn-primary', 'btn-sm', 'mr-1');
            buttonEdit.innerHTML = 'Edit';
            buttonEdit.addEventListener('click', () => {
                window.location.href = '/edit/' + parcours.file;
            })
            tdLink.appendChild(buttonEdit);

            // button delete
            const buttonDelete = document.createElement('button');
            buttonDelete.classList.add('btn', 'btn-danger', 'btn-sm', 'mr-1');
            buttonDelete.innerHTML = 'Delete';
            buttonDelete.addEventListener('click', () => { 
                if (confirm('Supprimer le parcours ' + parcours.name + ' ?')) deleteParcours(parcours.file) 
            });
            tdLink.appendChild(buttonDelete);

            // button clone
            const buttonClone = document.createElement('button');
            buttonClone.classList.add('btn', 'btn-info', 'btn-sm', 'mr-1');
            buttonClone.innerHTML = 'Clone';
            buttonClone.addEventListener('click', () => {
                var prevName = parcours.name + ' - Copie';
                var name = prompt('Enter the name of the new parcours', prevName).trim()
                if (!name) return;
                post('/cloneParcours', {file: parcours.file, name: name})
                    .then(() => {
                        refreshList();
                    })
            })
            tdLink.appendChild(buttonClone);

            tr.appendChild(tdLink);
            list.appendChild(tr);
        });
    });
}


// New Parcours btn
document.getElementById('newParcours').addEventListener('click', () => {

    // prompt
    const name = prompt('Enter the name of the new parcours').trim()
    if (!name) return;

    post('/newParcours', {name: name})
        .then(() => {
            refreshList();
        })
});

refreshList()