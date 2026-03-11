
function deleteParcours(file) {
    post('/deleteParcours', {file: file})
        .then(() => {
            refreshList();
        })    
}


function refreshList() {
    // fetch parcours list
    fetchRemote('/list')
    .then(response => response.json())
    .then(data => {
        const list = document.getElementById('parcours');
        list.innerHTML = '';

        // reorder data by .name
        data.sort((a, b) => {
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });

        // put all .name starting with a dot at the end
        data.sort((a, b) => {
            if (a.name.startsWith('.') && !b.name.startsWith('.')) return 1;
            if (!a.name.startsWith('.') && b.name.startsWith('.')) return -1;
            return 0;
        });

        console.log(data)
        data.forEach(parcours => {
            const tr = document.createElement('tr')
            tr.classList.add('status-'+parcours.status);
            tr.classList.add('parcours-row');
            list.appendChild(tr);

            // Name
            const tdName = document.createElement('td')
            tdName.innerHTML = parcours.name;
            tr.appendChild(tdName);

            // Update time
            const tdTime = document.createElement('td');
            // format date to jj/MM/YYYY HH:mm:ss
            tdTime.innerHTML = new Date(parcours.time).toLocaleString('fr-FR');
            tr.appendChild(tdTime);

            // Status
            const tdStatus = document.createElement('td');
            var status = parcours.status;
            if (status == 'draft') status = '<i>Brouillon</i>'
            else if (status == 'test') status = 'Test'
            else if (status == 'public') status = '<strong>Publiée</strong>'
            else if (status == 'old') status = 'Archive'

            tdStatus.innerHTML = status;
            tr.appendChild(tdStatus);
            const tdLink = document.createElement('td');
            tr.appendChild(tdLink);
            
            // show button
            // const buttonShow = document.createElement('button');
            // buttonShow.classList.add('btn', 'btn-warning', 'btn-sm', 'mr-1');
            // buttonShow.innerHTML = 'Show';
            // buttonShow.addEventListener('click', () => {
            //     window.location.href = '/show/' + parcours.file;
            // })
            // tdLink.appendChild(buttonShow);

            // button edit
            const buttonEdit = document.createElement('button');
            buttonEdit.classList.add('btn', 'btn-primary', 'btn-sm', 'mr-1');
            buttonEdit.innerHTML = 'Edit';
            buttonEdit.addEventListener('click', () => {
                window.location.href = '/edit/' + parcours.file;
            })
            tdLink.appendChild(buttonEdit);

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

            // button delete
            const buttonDelete = document.createElement('button');
            buttonDelete.classList.add('btn', 'btn-danger', 'btn-sm', 'mr-1');
            buttonDelete.innerHTML = 'Delete';
            buttonDelete.addEventListener('click', () => { 
                if (parcours.status == 'draft') {
                    if (confirm('Supprimer le parcours ' + parcours.name + ' ?')) deleteParcours(parcours.file) 
                }
                else alert('Le parcours doit être en brouillon pour être supprimé !')
            });
            if (parcours.status == 'draft') tdLink.appendChild(buttonDelete);

        });
    });
}


// New Parcours btn
document.getElementById('newParcours').addEventListener('click', () => {
    let name;
    if (USER_ROLE === 'guest') {
        name = prompt('Nom du nouveau parcours');
        if (!name) return;
        name = 'GUEST_' + name.trim();
    } else {
        name = prompt('Enter the name of the new parcours');
        if (!name) return;
        name = name.trim();
    }
    if (!name) return;

    post('/newParcours', {name: name})
        .then(() => {
            refreshList();
        })
});

// Restart server
document.getElementById('restartServer').addEventListener('click', () => {
    if (confirm('Restart server ?')) {
        get('/restartServer')
            .then(() => {
                setTimeout(() => {
                    alert('Server restarted');
                    location.reload();
                }, 3000);
            })
    }
})

// Guest Password management
document.getElementById('guestPassword').addEventListener('click', () => {
    fetchRemote('/guestPassword')
        .then(r => r.json())
        .then(data => {
            const newPassword = prompt('Mot de passe Guest actuel: ' + data.password + '\n\nNouveau mot de passe:', data.password);
            if (newPassword === null) return;
            if (!newPassword.trim()) { alert('Le mot de passe ne peut pas être vide'); return; }
            post('/guestPassword', { password: newPassword.trim() })
                .then(() => alert('Mot de passe Guest mis à jour'))
        })
})

// Fetch role and initialize
var USER_ROLE = 'guest';
fetchRemote('/auth/role')
    .then(r => r.json())
    .then(data => {
        USER_ROLE = data.role;
        if (USER_ROLE === 'guest') {
            document.getElementById('restartServer').style.display = 'none';
            document.getElementById('guestPassword').style.display = 'none';
        }
        refreshList();
    })
    .catch(() => refreshList());