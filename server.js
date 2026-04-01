// Import dotenv
import dotenv from 'dotenv';
dotenv.config();

// Import express
import http from 'http';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

// Simple Auth
import { useSimpleAuth, requireAuth, requireAdmin, handleLogin, getUserRole, getGuestPassword, setGuestPassword } from './modules/simpleAuth.js';

// Create express app
const app = express();
const upload = multer({ dest: 'media/' });

// Use simple auth (cookie parser)
useSimpleAuth(app);

// Set the port
const port = process.env.PORT || 3000;

// Get __dirname equivalent in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Apply Github Hooks
import applyGithubHook from './modules/github-hook.js';
// applyGithubHook(app, '/webhook', process.env.GITHOOK_SECRET);

// Apply updater
import applyUpdater from './modules/updater.js';
applyUpdater(app);

// Apply map download
import applyMapDownload from './modules/mapdownload.js';
applyMapDownload(app);

// Set the static path
app.use(express.static(path.join(__dirname, 'www')));

// static audio files
app.use('/media', express.static(path.join(__dirname, 'media')));

// static parcours files
app.use('/parcours', express.static(path.join(__dirname, 'parcours')));

// utils
function walkDir(basePath, currentPath, list = {}) {
  const files = fs.readdirSync(currentPath);
  files.forEach(file => {
    const filePath = path.join(currentPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(basePath, filePath, list);
    } else {
      const relativePath = path.relative(basePath, filePath).replace(/\\/g, '/');
      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash('md5');
      hashSum.update(fileBuffer);
      const hex = hashSum.digest('hex');
      list[relativePath] = hex;
    }
  });
}


// Unified list route for media and parcours
// /list/:type where type is 'media' or 'parcours'
app.get('/list/:type', (req, res) => {
  const { type } = req.params;
  let dir;
  if (type === 'media') {
    dir = path.join(__dirname, 'media');
  } else if (type === 'parcours') {
    dir = path.join(__dirname, 'parcours');
  } else {
    res.status(400).json({ error: 'Invalid list type' });
    return;
  }
  const fileList = {};
  walkDir(dir, dir, fileList);
  res.json(fileList);
});


// Unified sync route for media and parcours
// /sync/:type/:subdomain where type is 'media' or 'parcours'
app.get('/sync/:type/:subdomain', async (req, res) => {
  const { type, subdomain } = req.params;
  const domain = process.env.DOMAIN || 'example.com';
  let listUrl, localDir, remoteList, localList = {}, fileUrlPrefix;
  if (type === 'media') {
    listUrl = `https://${subdomain}.${domain}/list/media`;
    localDir = path.join(__dirname, 'media');
    fileUrlPrefix = `https://${subdomain}.${domain}/media/`;
  } else if (type === 'parcours') {
    listUrl = `https://${subdomain}.${domain}/list/parcours`;
    localDir = path.join(__dirname, 'parcours');
    fileUrlPrefix = `https://${subdomain}.${domain}/parcours/`;
  } else {
    res.status(400).json({ error: 'Invalid sync type' });
    return;
  }
  console.log(`Syncing ${type} from`, listUrl);
  try {
    const response = await fetch(listUrl);
    if (!response.ok) throw new Error(`Failed to fetch ${type} list: ${response.statusText}`);
    remoteList = await response.json();
    walkDir(localDir, localDir, localList);
    const filesToDownload = [];
    for (const [filePath, remoteChecksum] of Object.entries(remoteList)) {
      if (localList[filePath] !== remoteChecksum) {
        filesToDownload.push(filePath);
      }
    }
    console.log('Files to download:', filesToDownload);
    for (const filePath of filesToDownload) {
      const fileUrl = fileUrlPrefix + filePath;
      const localFilePath = path.join(localDir, filePath);
      const localDirPath = path.dirname(localFilePath);
      if (!fs.existsSync(localDirPath)) fs.mkdirSync(localDirPath, { recursive: true });
      console.log('Downloading', fileUrl);
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        console.error(`Failed to download ${fileUrl}: ${fileResponse.statusText}`);
        continue;
      }
      const fileStream = fs.createWriteStream(localFilePath);
      const { pipeline } = await import('stream/promises');
      await pipeline(fileResponse.body, fileStream);
      console.log('Downloaded', filePath);
    }
    res.json({ message: `${type.charAt(0).toUpperCase() + type.slice(1)} sync completed`, filesDownloaded: filesToDownload.length });
  } catch (error) {
    console.error(`Error during ${type} sync:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Login route
app.all('/login', (req, res) => handleLogin(req, res));

// Logout route
app.get('/logout', (req, res) => {
  res.clearCookie('simple_auth');
  res.redirect('/login');
});

// Auth role endpoint
app.get('/auth/role', requireAuth, (req, res) => {
  res.json({ role: req.userRole });
});

// Guest password management (admin only)
app.get('/guestPassword', requireAdmin, (req, res) => {
  res.json({ password: getGuestPassword() });
});

app.post('/guestPassword', requireAdmin, express.json(), (req, res) => {
  const password = req.body.password;
  if (!password || password.length < 1) {
    return res.status(400).json({ error: 'Password is required' });
  }
  setGuestPassword(password);
  res.json({ ok: true });
});

// Default endpoint: redirect to /app
app.get("/", (req, res) => {
  res.redirect('/app');
});

// Protected /control
app.get('/control', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'control', 'list.html'));
}); 

// Proto endpoint (not protected)
app.get('/proto', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'control', 'proto.html'));
});

// Telemetry admin page
app.get('/control/telemetry', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'control', 'telemetry.html'));
});

// Error handler: receive json report from catch-all-errors front lib
// append it to a file in logs folder YYYY-MM-MDD.log
app.post('/errorhandler', express.urlencoded({ extended: true }), (req, res) => {
  console.log('Parsed body:', req.body);

  const errorLog = path.join(__dirname, 'logs', `${new Date().toISOString().split('T')[0]}.log`);
  const errorData = {
    timestamp: new Date().toISOString(),
    report: req.body
  };
  
  // Ensure logs directory exists
  if (!fs.existsSync(path.join(__dirname, 'logs'))) {
    fs.mkdirSync(path.join(__dirname, 'logs'));
  }

  // Append error data to log file
  fs.appendFileSync(errorLog, JSON.stringify(errorData) + '\n');
  
  res.status(200).send('Error logged');
});


// Telemetry: receive events from app (CORS for Cordova app on file://)
app.options('/telemetry', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
app.post('/telemetry', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  console.log('[Telemetry] POST /telemetry hit, content-type:', req.headers['content-type'], 'content-length:', req.headers['content-length']);
  next();
}, express.json({limit: '1mb'}), (err, req, res, next) => {
  // JSON parse error
  console.error('[Telemetry] JSON parse error:', err.message);
  res.status(400).json({ error: 'Invalid JSON: ' + err.message });
}, (req, res) => {
  console.log('[Telemetry] POST /telemetry received, body keys:', Object.keys(req.body || {}));
  const { sessionId, parcoursId, parcoursName, events } = req.body;
  if (!sessionId || !events || !Array.isArray(events)) {
    console.warn('[Telemetry] Invalid data: sessionId=' + sessionId + ' events=' + typeof events);
    return res.status(400).send('Invalid data');
  }

  // Sanitize sessionId to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeId || safeId.length > 60) {
    console.warn('[Telemetry] Invalid session ID:', sessionId);
    return res.status(400).send('Invalid session ID');
  }

  const telemetryDir = path.join(__dirname, 'telemetry');
  if (!fs.existsSync(telemetryDir)) fs.mkdirSync(telemetryDir);

  const filePath = path.join(telemetryDir, safeId + '.json');

  let session;
  if (fs.existsSync(filePath)) {
    session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else {
    session = {
      sessionId: safeId,
      parcoursId: parcoursId || '',
      parcoursName: parcoursName || '',
      startTime: new Date().toISOString(),
      events: []
    };
  }

  session.events = session.events.concat(events);
  fs.writeFileSync(filePath, JSON.stringify(session));
  console.log('[Telemetry] Saved', events.length, 'events for session', safeId, '(total:', session.events.length + ')');
  res.status(200).send('OK');
});

// Telemetry: list sessions
app.get('/telemetry/sessions', requireAdmin, (req, res) => {
  const telemetryDir = path.join(__dirname, 'telemetry');
  if (!fs.existsSync(telemetryDir)) return res.json([]);

  const sessions = [];
  fs.readdirSync(telemetryDir).forEach(file => {
    if (!file.endsWith('.json')) return;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8'));
      sessions.push({
        sessionId: data.sessionId,
        parcoursId: data.parcoursId,
        parcoursName: data.parcoursName,
        startTime: data.startTime,
        eventCount: data.events.length,
        lastEvent: data.events.length > 0 ? data.events[data.events.length - 1].t : null
      });
    } catch(e) { /* skip corrupt files */ }
  });

  sessions.sort((a, b) => (b.lastEvent || 0) - (a.lastEvent || 0));
  res.json(sessions);
});

// Telemetry: get session detail
app.get('/telemetry/session/:id', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  const filePath = path.join(__dirname, 'telemetry', safeId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json(data);
});

// Telemetry: delete session
app.delete('/telemetry/session/:id', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  const filePath = path.join(__dirname, 'telemetry', safeId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  fs.unlinkSync(filePath);
  res.status(200).send('Deleted');
});


// List parcours
app.get('/list', (req, res) => {
  const role = getUserRole(req);
  const parcoursFolder = './parcours/';
  const parcours = [];
  fs.readdirSync(parcoursFolder).forEach(file => {
    if (!file.endsWith('.json')) return;
    const parcoursFileName = file.split('.json')[0];
    const parcoursContent = JSON.parse(fs.readFileSync(parcoursFolder + file, 'utf8'));

    // Guest filtering: only GUEST_ prefixed, non-archived
    if (role === 'guest') {
      if (!parcoursContent.info.name.startsWith('GUEST_')) return;
      if (parcoursContent.info.status === 'old') return;
    }

    parcours.push({
      file: parcoursFileName, 
      name: parcoursContent.info.name, 
      status: parcoursContent.info.status, 
      time: fs.statSync(parcoursFolder + file).mtime,
      coords: parcoursContent.info.coords,
      cutoff: parcoursContent.info.cutoff !== undefined ? parcoursContent.info.cutoff : -1
    });
  });
  res.json(parcours);  
});

// new parcours
app.post('/newParcours', requireAuth, express.json(), (req, res) => {
  let name = req.body.name;

  // Guest: enforce GUEST_ prefix
  if (req.userRole === 'guest' && !name.startsWith('GUEST_')) {
    name = 'GUEST_' + name;
  }

  const fileName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  if (fileName.length < 3) {
    res.status(400).json({error: 'Name too short'});
    return;
  }

  const filePath = './parcours/' + fileName + '.json';

  const content = {info: {name: name, status: 'draft', coords: '', cutoff: -1}, spots: {zones: [], steps: [], offlimits: []}};

  // write beautiful json file
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  res.status(200).send();
});

// delete parcours
app.post('/deleteParcours', requireAuth, express.json(), (req, res) => {
  const fileName = req.body.file;
  const filePath = './parcours/' + fileName + '.json';

  // Guest: can only delete GUEST_ parcours
  if (req.userRole === 'guest') {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!content.info.name.startsWith('GUEST_')) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch { return res.status(404).json({ error: 'Parcours not found' }); }
  }

  fs.unlinkSync(filePath);

  // remove media folder
  const mediaFolder = './media/' + fileName;
  if (fs.existsSync(mediaFolder)) fs.rmSync(mediaFolder, { recursive: true });

  res.status(200).send();
});

// clone Parcours
app.post('/cloneParcours', requireAuth, express.json(), (req, res) => {
  const fileName = req.body.file;
  const filePath = './parcours/' + fileName + '.json';
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Guest: can only clone GUEST_ parcours, new name must keep prefix
  if (req.userRole === 'guest') {
    if (!content.info.name.startsWith('GUEST_')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!req.body.name.startsWith('GUEST_')) {
      req.body.name = 'GUEST_' + req.body.name;
    }
  }

  content.info.name = req.body.name;
  const newFileName = req.body.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const newFilePath = './parcours/' + newFileName + '.json';
  fs.writeFileSync(newFilePath, JSON.stringify(content, null, 2));

  // copy media folder
  const mediaFolder = './media/' + fileName;
  const newMediaFolder = './media/' + newFileName;
  if (fs.existsSync(mediaFolder)) {
    if (!fs.existsSync(newMediaFolder)) fs.mkdirSync(newMediaFolder);
    fs.readdirSync(mediaFolder).forEach(folder => {
      const newFolder = newMediaFolder + '/' + folder;
      if (!fs.existsSync(newFolder)) fs.mkdirSync(newFolder);
      fs.readdirSync(mediaFolder + '/' + folder).forEach(file => {
        fs.copyFileSync(mediaFolder + '/' + folder + '/' + file, newFolder + '/' + file);
      });
    });
  }

  res.status(200).send();
});

// edit parcours (protected)
app.get('/edit/:file', requireAuth, (req, res) => {
  // Guest: can only edit GUEST_ parcours
  if (req.userRole === 'guest') {
    try {
      const content = JSON.parse(fs.readFileSync('./parcours/' + req.params.file + '.json', 'utf8'));
      if (!content.info.name.startsWith('GUEST_')) return res.redirect('/control');
    } catch { return res.redirect('/control'); }
  }
  res.sendFile(path.join(__dirname, 'www', 'control', 'edit.html'));
});

// get parcours json
app.get('/edit/:file/json', (req, res) => {
  const role = getUserRole(req);
  const fileName = req.params.file;
  const filePath = './parcours/' + fileName + '.json';
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Guest: can only view GUEST_ parcours
  if (role === 'guest' && !content.info.name.startsWith('GUEST_')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(content);
});

// save parcours json
app.post('/edit/:file/json', requireAuth, express.json(), (req, res) => {
  try {
    const fileName = req.params.file;
    const filePath = './parcours/' + fileName + '.json';
    var content = req.body;

    // Guest restrictions
    if (req.userRole === 'guest') {
      const original = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!original.info.name.startsWith('GUEST_')) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Cannot change status
      content.info.status = original.info.status;
      // Must keep GUEST_ prefix
      if (!content.info.name.startsWith('GUEST_')) {
        content.info.name = 'GUEST_' + content.info.name;
      }
    }

    // Objets Media folders exists
    if (!fs.existsSync('./media/' + fileName + '/Objets'))
      fs.mkdirSync('./media/' + fileName + '/Objets');

    // Maps folder exists
    if (!fs.existsSync('./media/' + fileName + '/Maps'))
      fs.mkdirSync('./media/' + fileName + '/Maps');

    // Objets name update
    if (content.spots.zones)
      content.spots.zones.forEach((objet, i) => {
        if (!objet.name || objet.name.startsWith('Objet')) content.spots.zones[i].name = 'Objet ' + i;
      });

    // Offlimits Media folders exists
    if (!fs.existsSync('./media/' + fileName + '/Offlimits'))
      fs.mkdirSync('./media/' + fileName + '/Offlimits');

    // Offlimits name update
    if (content.spots.offlimits)
      content.spots.offlimits.forEach((objet, i) => {
        if (!objet.name || objet.name.startsWith('Objet')) content.spots.offlimits[i].name = 'Offlimit ' + i;
      });

    // Steps Media folders renaming
    if (content.spots.steps)
      content.spots.steps.forEach((step, i) => 
      {
        // Clean up step name
        content.spots.steps[i].name = step.name.trim().replace(/[^a-zA-Z0-9_]/g, '_');

        if (!step.folder) content.spots.steps[i].folder = 'Etape';
        if (!step.name || step.name.startsWith('Etape')) content.spots.steps[i].name = 'Etape_' + i;

        var oldFolder = './media/' + fileName + '/' + step.folder;
        var newFolder = './media/' + fileName + '/' + step.name;
        
        if (oldFolder === newFolder && fs.existsSync(newFolder)) return;

        // add _ to folder name if already exists
        while(fs.existsSync(newFolder)) {
          newFolder += '_';
          content.spots.steps[i].name += '_';
        }

        if (fs.existsSync(oldFolder)) {
          console.log('oldFolder exists, rename to newFolder', oldFolder, newFolder);
          fs.renameSync(oldFolder, newFolder);
          content.spots.steps[i].folder = content.spots.steps[i].name;
        }
        else {
          console.log('no folder, create newFolder', newFolder);
          fs.mkdirSync(newFolder); 
          content.spots.steps[i].folder = content.spots.steps[i].name;
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
        if (content.spots.steps) content.spots.steps.forEach((objet, i) => {
          if (objet.folder === folder) {
            content.spots.steps[i].folder = newFolder;
            content.spots.steps[i].name = newFolder;
          }
        });
      }
    });

    // Remove unused Objets media
    fs.readdirSync('./media/' + fileName + '/Objets').forEach(file => {
      if (!content.spots.zones || !content.spots.zones.find(objet => objet.media.src === file)) {
        fs.unlinkSync('./media/' + fileName + '/Objets/' + file);
        console.log('remove unused media', file);
      }
    });

    // Remove unused Offlimits media
    fs.readdirSync('./media/' + fileName + '/Offlimits').forEach(file => {
      if (!content.spots.offlimits || !content.spots.offlimits.find(objet => objet.media.src === file)) {
        fs.unlinkSync('./media/' + fileName + '/Offlimits/' + file);
        console.log('remove unused media', file);
      }
    });

    // Remove unused Steps folder
    fs.readdirSync('./media/' + fileName).forEach(folder => {
      // ignore Objets folder
      if (folder === 'Objets') return;
      if (folder === 'Offlimits') return;
      if (!content.spots.steps || !content.spots.steps.find(step => step.folder === folder)) {
        fs.rmSync('./media/' + fileName + '/' + folder, { recursive: true });
      }
    });
    

    // write beautiful json file
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    res.json(content);
  } 
  catch (error) {
    res.status(500).json({error: error.message});
  }
});

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
          .filter(file => validExt.includes(file.split('.').pop()));
    else 
      if (validExt.includes(folder.split('.').pop()))
        media['.'].push(folder);
  });
  res.json(media);
});  

// Upload media file with folder argument from file argument
app.post('/mediaUpload/:parcours/:folder/:name?', requireAuth, upload.single('file'), (req, res) => 
{
  // Guest: can only upload to GUEST_ parcours
  if (req.userRole === 'guest') {
    try {
      const pc = JSON.parse(fs.readFileSync('./parcours/' + req.params.parcours + '.json', 'utf8'));
      if (!pc.info.name.startsWith('GUEST_')) return res.status(403).json({ error: 'Access denied' });
    } catch { return res.status(403).json({ error: 'Access denied' }); }
  }

  console.log('mediaUpload', req.file, req.params.parcours, req.params.folder, req.params.name);
  
  const filename = req.params.name ? req.params.name + '.' + req.file.originalname.split('.').pop() : req.file.originalname;

  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder + '/';
  const filePath = mediaFolder + filename;

  fs.renameSync(req.file.path, filePath);
  res.status(200).send();
});

// Remove media file
app.get('/mediaRemove/:parcours/:folder/:file', requireAuth, (req, res) => {
  // Guest: can only remove from GUEST_ parcours
  if (req.userRole === 'guest') {
    try {
      const pc = JSON.parse(fs.readFileSync('./parcours/' + req.params.parcours + '.json', 'utf8'));
      if (!pc.info.name.startsWith('GUEST_')) return res.status(403).json({ error: 'Access denied' });
    } catch { return res.status(403).json({ error: 'Access denied' }); }
  }

  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder + '/';
  const filePath = mediaFolder + req.params.file;
  fs.unlinkSync(filePath, (err) => {
    if (err) console.error(err);
  });
  res.status(200).send();
});

// Remove folder and all files inside
app.get('/mediaRemoveFolder/:parcours/:folder', requireAuth, (req, res) => {
  // Guest: can only remove from GUEST_ parcours
  if (req.userRole === 'guest') {
    try {
      const pc = JSON.parse(fs.readFileSync('./parcours/' + req.params.parcours + '.json', 'utf8'));
      if (!pc.info.name.startsWith('GUEST_')) return res.status(403).json({ error: 'Access denied' });
    } catch { return res.status(403).json({ error: 'Access denied' }); }
  }

  const mediaFolder = './media/' + req.params.parcours + '/' + req.params.folder;
  if (req.params.folder)
    fs.rm(mediaFolder, { recursive: true }, (err) => {
      if (err) console.error(err);
    });
  console.log('mediaRemoveFolder', mediaFolder);
  res.status(200).send();
});

// Show parcours
app.get('/show/:file', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'control', 'show.html'));
});

// Restart server (admin only)
app.get('/restartServer', requireAdmin, (req, res) => {
  console.log('Restarting server...');
  res.status(200).send();
  setTimeout(() => {
    process.exit(0);
  }, 200);
});

///////////// APP
app.get('/app', function (req, res) {
  let html = fs.readFileSync(path.join(__dirname, 'www/app/app.html'), 'utf8');
  html = html.replace(/\$BASEPATH\$/g, '/app');
  res.send(html);
});

// Start the server
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

