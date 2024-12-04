// Import dotenv
require('dotenv').config();

// Import express
const http = require('http')
const express = require('express');
const path = require('path');
const fs = require('fs')

// Create express app
const app = express();

// Set the port
const port = process.env.PORT || 3000;

// Apply Github Hooks
require('./modules/github-hook.js')(app, '/webhook', process.env.GITHOOK_SECRET);

// Set the static path
app.use(express.static(path.join(__dirname, 'www')));

// static audio files
app.use('/media', express.static(path.join(__dirname, 'media')));

// Default endpoint: redirect to /list
app.get("/", (req, res) => {
  res.redirect('/control');
})

// Default endpoint
app.get('/control', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'list.html'));
}); 

// Proto endpoint
app.get('/proto', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'proto.html'));
});

// List parcours
app.get('/list', (req, res) => {
  // list of parcours name and status based on json files in parcours folder
  const parcoursFolder = './parcours/';
  const parcours = [];
  fs.readdirSync(parcoursFolder).forEach(file => {
    if (!file.endsWith('.json')) return;
    const parcoursFileName = file.split('.json')[0];
    const parcoursContent = JSON.parse(fs.readFileSync(parcoursFolder + file, 'utf8'));
    parcours.push({file: parcoursFileName, name: parcoursContent.name, status: parcoursContent.status});
  });
  res.json(parcours);  
})

// new parcours
app.post('/newParcours', express.json(), (req, res) => {
  const name = req.body.name;
  const fileName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  if (fileName.length < 3) {
    res.status(400).json({error: 'Name too short'});
    return;
  }

  const filePath = './parcours/' + fileName + '.json';


  const content = {name: name, status: 'draft'};

  // write beautiful json file
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  res.status(200).send();
})

// delete parcours
app.post('/deleteParcours', express.json(), (req, res) => {
  const fileName = req.body.file;
  const filePath = './parcours/' + fileName + '.json';
  fs.unlinkSync(filePath);
  res.status(200).send();
})

// edit parcours
app.get('/control/p/:file', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'parcours.html'));
})

// get parcours json
app.get('/control/p/:file/json', (req, res) => {
  const fileName = req.params.file;
  const filePath = './parcours/' + fileName + '.json';
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json(content);
})

// save parcours json
app.post('/control/p/:file/json', express.json(), (req, res) => {
  try {
    const fileName = req.params.file;
    const filePath = './parcours/' + fileName + '.json';
    const content = req.body;
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    res.status(200).send();
  } catch (error) {
    res.status(500).json({error: error.message});
  }
})

// Show parcours
app.get('/show/:file', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'show.html'));
})

// Start the server
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

