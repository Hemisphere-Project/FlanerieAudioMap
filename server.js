// Import dotenv
require('dotenv').config();

// Import express
const http = require('http')
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs')

// Create express app
const app = express();
const upload = multer({ dest: 'media/' })


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
app.get('/edit/:file', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'edit.html'));
})

// get parcours json
app.get('/edit/:file/json', (req, res) => {
  const fileName = req.params.file;
  const filePath = './parcours/' + fileName + '.json';
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json(content);
})

// save parcours json
app.post('/edit/:file/json', express.json(), (req, res) => {
  try {
    const fileName = req.params.file;
    const filePath = './parcours/' + fileName + '.json';
    var content = req.body;

    // Objets Media folders exists
    if (!fs.existsSync('./media/' + fileName + '/Objets'))
      fs.mkdirSync('./media/' + fileName + '/Objets');

    // Objets name update
    if (content.zones)
      content.zones.forEach((objet, i) => {
        if (!objet.name || objet.name.startsWith('Objet')) content.zones[i].name = 'Objet ' + i;
      });

    // Steps Media folders renaming
    if (content.steps)
      content.steps.forEach((step, i) => 
      {
        if (!step.folder) content.steps[i].folder = 'Etape';
        if (!step.name || step.name.startsWith('Etape')) content.steps[i].name = 'Etape ' + i;

        var oldFolder = './media/' + fileName + '/' + step.folder;
        var newFolder = './media/' + fileName + '/' + step.name;
        
        if (oldFolder === newFolder && fs.existsSync(newFolder)) return;

        // add _ to folder name if already exists
        while(fs.existsSync(newFolder)) {
          newFolder += '_';
          content.steps[i].name += '_';
        }

        if (fs.existsSync(oldFolder)) {
          console.log('oldFolder exists, rename to newFolder', oldFolder, newFolder);
          fs.renameSync(oldFolder, newFolder);
          content.steps[i].folder = content.steps[i].name;
        }
        else {
          console.log('no folder, create newFolder', newFolder);
          fs.mkdirSync(newFolder); 
          content.steps[i].folder = content.steps[i].name;
        }
      });

    // Rename folder with trailing space in media/
    fs.readdirSync('./media/' + fileName).forEach(folder => {
      if (folder.endsWith('_')) {
        const basePath = './media/' + fileName + '/';
        var newFolder = folder.replace(/^\_+|\_+$/g, '');
        while(fs.existsSync(basePath+newFolder)) newFolder += '_';
        fs.renameSync(basePath+folder, basePath+newFolder);
        console.log('rename folder', folder, newFolder);
        // apply to content
        if (content.steps) content.steps.forEach((objet, i) => {
          if (objet.folder === folder) {
            content.steps[i].folder = newFolder;
            content.steps[i].name = newFolder;
          }
        });
      }
    })

    // write beautiful json file
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    res.json(content);
  } 
  catch (error) {
    res.status(500).json({error: error.message});
  }
})

// Media json file tree (one deep) with folders as keys and files as values list
app.get('/mediaList/:parcours', (req, res) => {

  // validExt : audio and video
  const validExt = ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'];

  const mediaFolder = './media/'+req.params.parcours+'/';

  // Create folder if not exists
  if (!fs.existsSync(mediaFolder)) fs.mkdirSync(mediaFolder);

  const media = {'.':[]};
  fs.readdirSync(mediaFolder).forEach(folder => {
    if (fs.lstatSync(mediaFolder + folder).isDirectory())
      media[folder] = fs.readdirSync(mediaFolder + folder)
          .filter(file => !fs.lstatSync(mediaFolder + folder + '/' + file).isDirectory())
          .filter(file => validExt.includes(file.split('.').pop()))
    else 
      if (validExt.includes(folder.split('.').pop()))
        media['.'].push(folder);
  });
  res.json(media);
})  

// Upload media file with folder argument from file argument
app.post('/mediaUpload/:parcours/:folder/:name?', upload.single('file'), (req, res) => 
{
  const filename = req.params.name ? req.params.name + '.' + req.file.originalname.split('.').pop() : req.file.originalname;

  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder + '/';
  const filePath = mediaFolder + filename;

  fs.renameSync(req.file.path, filePath);
  res.status(200).send();
})

// Remove media file
app.get('/mediaRemove/:parcours/:folder/:file', (req, res) => {
  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder + '/';
  const filePath = mediaFolder + req.params.file;
  fs.unlinkSync(filePath, (err) => {
    if (err) console.error(err);
  })
  res.status(200).send();
})

// Remove folder and all files inside
app.get('/mediaRemoveFolder/:parcours/:folder', (req, res) => {
  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder
  if (req.params.folder)
    fs.rm(mediaFolder, { recursive: true }, (err) => {
      if (err) console.error(err);
    })
  console.log('mediaRemoveFolder', mediaFolder);
  res.status(200).send();
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

