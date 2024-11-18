
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
            const tdName = document.createElement('td');
            tdName.innerHTML = parcours.name;
            tr.appendChild(tdName);
            const tdStatus = document.createElement('td');
            tdStatus.innerHTML = parcours.status;
            tr.appendChild(tdStatus);
            const tdLink = document.createElement('td');

            // button edit
            const buttonEdit = document.createElement('button');
            buttonEdit.classList.add('btn', 'btn-primary', 'btn-sm');
            buttonEdit.innerHTML = 'Edit';
            buttonEdit.addEventListener('click', () => {
                window.location.href = '/control/p/' + parcours.file;
            })
            tdLink.appendChild(buttonEdit);

            // button delete
            const buttonDelete = document.createElement('button');
            buttonDelete.classList.add('btn', 'btn-danger', 'btn-sm', 'ml-1');
            buttonDelete.innerHTML = 'Delete';
            buttonDelete.addEventListener('click', () => { 
                if (confirm('Supprimer le parcours ' + parcours.name + ' ?')) deleteParcours(parcours.file) 
            });
            tdLink.appendChild(buttonDelete);

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