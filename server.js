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
import { createStandaloneFlanerieChat } from 'flanerie-chat';
import { parseFile } from 'music-metadata';

// Simple Auth
import { useSimpleAuth, requireAuth, requireAdmin, handleLogin, getUserRole, getGuestPassword, setGuestPassword } from './modules/simpleAuth.js';

// Create express app
const app = express();
const server = http.createServer(app);
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

createStandaloneFlanerieChat({
  expressApp: app,
  httpServer: server,
  mountPath: '/chat',
  socketPath: '/chat/socket.io'
});

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

const VALID_MEDIA_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v']);

function isValidMediaFile(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return VALID_MEDIA_EXTENSIONS.has(extension);
}

function getParcoursMediaStats(parcoursId) {
  const mediaFolder = path.join(__dirname, 'media', parcoursId);
  const stats = {
    totalBytes: 0,
    fileCount: 0,
    folders: { '.': { bytes: 0, fileCount: 0 } }
  };

  if (!fs.existsSync(mediaFolder)) return stats;

  fs.readdirSync(mediaFolder).forEach(entry => {
    const entryPath = path.join(mediaFolder, entry);
    const entryStat = fs.statSync(entryPath);

    if (entryStat.isDirectory()) {
      stats.folders[entry] = { bytes: 0, fileCount: 0 };
      fs.readdirSync(entryPath).forEach(file => {
        const filePath = path.join(entryPath, file);
        const fileStat = fs.statSync(filePath);
        if (fileStat.isDirectory() || !isValidMediaFile(file)) return;
        stats.folders[entry].bytes += fileStat.size;
        stats.folders[entry].fileCount += 1;
        stats.totalBytes += fileStat.size;
        stats.fileCount += 1;
      });
      return;
    }

    if (!isValidMediaFile(entry)) return;
    stats.folders['.'].bytes += entryStat.size;
    stats.folders['.'].fileCount += 1;
    stats.totalBytes += entryStat.size;
    stats.fileCount += 1;
  });

  return stats;
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

const LAUNCHER_BEACON_DIR = path.join(__dirname, 'telemetry', 'launcher');

function parseLauncherBeaconBody(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

function listLauncherBeacons(limit = 100) {
  if (!fs.existsSync(LAUNCHER_BEACON_DIR)) return [];

  const files = fs.readdirSync(LAUNCHER_BEACON_DIR)
    .filter(name => name.endsWith('.ndjson'))
    .sort()
    .reverse();

  const records = [];
  for (const file of files) {
    const fullPath = path.join(LAUNCHER_BEACON_DIR, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed && typeof parsed === 'object') records.push(parsed);
      } catch (e) {
        // Skip malformed NDJSON lines.
      }
      if (records.length >= limit) return records;
    }
  }

  return records;
}

app.options('/launcher-beacon', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.post('/launcher-beacon', express.text({ type: '*/*', limit: '32kb' }), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const payload = parseLauncherBeaconBody(req.body);
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'invalid beacon payload' });
  }

  const now = new Date();
  const outFile = path.join(LAUNCHER_BEACON_DIR, `${now.toISOString().split('T')[0]}.ndjson`);
  const record = Object.assign({ received_at: now.toISOString() }, payload);

  try {
    if (!fs.existsSync(LAUNCHER_BEACON_DIR)) fs.mkdirSync(LAUNCHER_BEACON_DIR, { recursive: true });
    fs.appendFileSync(outFile, JSON.stringify(record) + '\n');
    res.json({ ok: true });
  } catch (e) {
    console.error('[launcher-beacon] write failed:', e.message);
    res.status(500).json({ error: 'write failed' });
  }
});

app.get('/launcher-beacons', requireAdmin, (req, res) => {
  const rawLimit = Number(req.query && req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.round(rawLimit))) : 100;
  res.json({ beacons: listLauncherBeacons(limit), count: limit });
});


// Telemetry: receive events from app (CORS for Cordova app on file://)
app.options('/telemetry-push', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
app.post('/telemetry-push', (req, res, next) => {
  // Parse JSON manually to handle errors with CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  express.json({limit: '1mb'})(req, res, (err) => {
    if (err) {
      console.error('[Telemetry] JSON parse error:', err.message);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next();
  });
}, (req, res) => {
  console.log('[Telemetry] POST /telemetry body keys:', Object.keys(req.body || {}));

  const { sessionId, parcoursId, parcoursName, schemaVersion, client, events } = req.body || {};
  if (!sessionId || !events || !Array.isArray(events)) {
    console.warn('[Telemetry] Invalid data: sessionId=' + sessionId + ' events=' + typeof events);
    return res.status(400).send('Invalid data');
  }

  // Cap events per request to prevent abuse
  if (events.length > 1000) {
    console.warn('[Telemetry] Too many events:', events.length);
    return res.status(400).send('Too many events');
  }

  // Validate and sanitize individual events
  const validEvents = events.filter(e =>
    e && typeof e.t === 'number' && typeof e.type === 'string' && e.type.length <= 50
  ).map(e => ({
    t: e.t,
    type: e.type.replace(/[<>]/g, ''),
    data: (typeof e.data === 'object' && e.data !== null) ? e.data : {}
  }));

  if (validEvents.length === 0) {
    return res.status(400).send('No valid events');
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

  // Fresh session skeleton — used for new sessions and as the recovery target
  // when an existing file is unreadable/corrupt.
  function freshSession() {
    return {
      sessionId: safeId,
      parcoursId: parcoursId || '',
      parcoursName: parcoursName || '',
      schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : 1,
      client: (typeof client === 'object' && client !== null) ? client : {},
      // Use first event's client timestamp for accurate startTime
      startTime: new Date(validEvents[0].t).toISOString(),
      events: []
    };
  }

  let session;
  if (fs.existsSync(filePath)) {
    // Guard the read+parse. A non-atomic writer crash (OOM kill / deploy /
    // power blip) can leave a truncated JSON file; without this guard every
    // later POST for that session would throw 500, and the client would retry
    // it forever from its durable buffer — permanently blackholing the walk.
    // On corruption, quarantine the bad file and start fresh so ingest survives.
    try {
      session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      const quarantine = filePath + '.corrupt-' + Date.now();
      try { fs.renameSync(filePath, quarantine); } catch (re) {}
      console.warn('[Telemetry] Corrupt session file for', safeId, '— quarantined to', path.basename(quarantine), '(', e.message, ')');
      session = freshSession();
    }
  } else {
    session = freshSession();
  }

  if (!session.parcoursId && parcoursId) session.parcoursId = parcoursId;
  if (!session.parcoursName && parcoursName) session.parcoursName = parcoursName;
  if (!session.schemaVersion) session.schemaVersion = Number.isInteger(schemaVersion) ? schemaVersion : 1;
  if ((!session.client || typeof session.client !== 'object') && typeof client === 'object' && client !== null) {
    session.client = client;
  }

  session.events = session.events.concat(validEvents);
  // Atomic write: a direct writeFileSync truncates the target in place, so a
  // crash mid-write corrupts the session. Write to a temp file on the same
  // filesystem, then rename (atomic on POSIX) so readers only ever observe a
  // complete file.
  const tmpPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(session));
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (ce) {}
    console.error('[Telemetry] Write failed for', safeId, ':', e.message);
    return res.status(500).send('Write failed');
  }
  console.log('[Telemetry] Saved', validEvents.length, 'events for session', safeId, '(total:', session.events.length + ')');
  res.status(200).send('OK');
});

function normalizeTelemetryKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function findParcoursByTelemetryId(parcoursId) {
  const normalizedTarget = normalizeTelemetryKey(parcoursId);
  if (!normalizedTarget) return null;

  const parcoursDir = path.join(__dirname, 'parcours');
  if (!fs.existsSync(parcoursDir)) return null;

  const files = fs.readdirSync(parcoursDir).filter(file => file.endsWith('.json'));
  for (const file of files) {
    const fileName = file.replace(/\.json$/i, '');
    const filePath = path.join(parcoursDir, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const candidates = [
      fileName,
      data && data.info ? data.info.name : '',
      data && data.pID ? data.pID : ''
    ].map(normalizeTelemetryKey);

    if (candidates.includes(normalizedTarget)) {
      return { fileName, data };
    }
  }

  return null;
}

function summarizeTelemetrySessionData(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const gpsEvents = events.filter(event => event.type === 'gps' && event.data && typeof event.data.acc === 'number');
  const gpsQualitySummaries = events.filter(event => event.type === 'gps_quality_summary');
  const stepFires = events.filter(event => event.type === 'step_fire');
  const uniqueSteps = new Set(stepFires
    .map(event => event.data && event.data.step)
    .filter(step => Number.isInteger(step)));

  let finalStep = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'route_probe' && event.data && Number.isInteger(event.data.currentStep)) {
      finalStep = event.data.currentStep;
      break;
    }
  }

  const gpsAccuracies = gpsEvents
    .map(event => Number(event.data.acc))
    .filter(value => !Number.isNaN(value));

  const gapMaxFromSummary = gpsQualitySummaries.reduce((maxGap, event) => {
    const value = Number(event.data && event.data.maxGapMs);
    return Number.isFinite(value) ? Math.max(maxGap, value) : maxGap;
  }, 0);

  const gapMaxFromEvents = events.reduce((maxGap, event) => {
    if (event.type !== 'gps_callback_gap') return maxGap;
    const value = Number(event.data && event.data.gapMs);
    return Number.isFinite(value) ? Math.max(maxGap, value) : maxGap;
  }, 0);

  const rejectedFromSummary = gpsQualitySummaries.reduce((sum, event) => {
    const value = Number(event.data && event.data.rejectedSamples);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  // LOST recovery deltas — pair each user_lost with the next user_recovered.
  const lostRecoveryDeltas = [];
  let pendingLost = null;
  for (const event of events) {
    if (event.type === 'user_lost') pendingLost = event;
    else if (event.type === 'user_recovered' && pendingLost) {
      const delta = Number(event.t) - Number(pendingLost.t);
      if (Number.isFinite(delta) && delta >= 0) lostRecoveryDeltas.push(delta);
      pendingLost = null;
    }
  }
  let lostRecoveryMedianMs = null;
  if (lostRecoveryDeltas.length > 0) {
    const sorted = [...lostRecoveryDeltas].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    lostRecoveryMedianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const afterplayFallbackEvents = events.filter(event => event.type === 'step_afterplay_fallback');

  // Session lifecycle: a session counts as ended only when the last
  // session_end is not followed by a session_start/resume (a walk can be
  // resumed after an end if the phone re-enters the parcours).
  let endedAt = null;
  let lastStartOrResumeT = null;
  let resumeCount = 0;
  for (const event of events) {
    const t = Number(event.t);
    if (event.type === 'session_end') { if (Number.isFinite(t)) endedAt = t; }
    else if (event.type === 'session_resume') { resumeCount += 1; if (Number.isFinite(t)) lastStartOrResumeT = t; }
    else if (event.type === 'session_start') { if (Number.isFinite(t)) lastStartOrResumeT = t; }
  }
  const ended = endedAt != null && (lastStartOrResumeT == null || endedAt >= lastStartOrResumeT);

  return {
    finalStep,
    endedAt,
    ended,
    resumeCount,
    firedSteps: Array.from(uniqueSteps).sort((a, b) => a - b),
    uniqueStepCount: uniqueSteps.size,
    gpsCount: gpsEvents.length,
    avgAccuracy: gpsAccuracies.length > 0
      ? gpsAccuracies.reduce((sum, value) => sum + value, 0) / gpsAccuracies.length
      : null,
    maxGapMs: Math.max(gapMaxFromSummary, gapMaxFromEvents) || null,
    sleepSuspects: events.filter(event => event.type === 'gps_sleep_suspect').length,
    staleCallbacks: events.filter(event => event.type === 'gps_stale_callback').length,
    rejectedFixes: rejectedFromSummary || events.filter(event => event.type === 'gps_trigger_rejected').length,
    heartbeatRecoveries: events.filter(event => event.type === 'gps_heartbeat_ok').length,
    gpsLostCount: events.filter(event => event.type === 'gps_state' && event.data && event.data.state === 'lost').length,
    audioErrors: events.filter(event => event.type === 'audio_loaderror' || event.type === 'audio_playerror').length,
    userLostCount: events.filter(event => event.type === 'user_lost').length,
    userRecoveredCount: events.filter(event => event.type === 'user_recovered').length,
    lostRecoveryMedianMs,
    voiceFailCount: events.filter(event => event.type === 'step_voice_failed').length,
    afterplayFallbackCount: afterplayFallbackEvents.length,
    afterplayFallbackNoSrc: afterplayFallbackEvents.filter(event => event.data && event.data.reason === 'no_src').length,
    afterplayFallbackLoadError: afterplayFallbackEvents.filter(event => event.data && event.data.reason === 'loaderror').length,
    audiofocusRetryCount: events.filter(event => event.type === 'audiofocus_auto_retry').length
  };
}

function getTelemetryDeviceLabel(client) {
  if (!client || typeof client !== 'object') return '';

  const manufacturer = client.deviceManufacturer || client.manufacturer || '';
  const model = client.deviceModel || client.model || '';
  const platform = client.devicePlatform || client.platform || '';
  const parts = [];

  if (manufacturer && model && !String(model).toLowerCase().includes(String(manufacturer).toLowerCase())) {
    parts.push(manufacturer);
  }
  if (model) parts.push(model);
  if (!parts.length && platform) parts.push(platform);

  return parts.join(' ');
}

// Total step count per parcours, for session progress %. findParcoursByTelemetryId
// scans every parcours file, so cache lookups briefly (parcours edits are rare).
const parcoursStepsCache = new Map(); // normalizedKey -> { totalSteps, at }
const PARCOURS_STEPS_TTL_MS = 60 * 1000;

function getParcoursTotalSteps(parcoursId) {
  const bareId = String(parcoursId || '').replace(/^onb:/, '');
  const key = normalizeTelemetryKey(bareId);
  if (!key) return null;

  const cached = parcoursStepsCache.get(key);
  if (cached && (Date.now() - cached.at) < PARCOURS_STEPS_TTL_MS) return cached.totalSteps;

  let totalSteps = null;
  try {
    const match = findParcoursByTelemetryId(bareId);
    if (match && match.data && match.data.spots && Array.isArray(match.data.spots.steps)) {
      totalSteps = match.data.spots.steps.length;
    }
  } catch (e) { /* unreadable parcours dir/file — leave unknown */ }

  parcoursStepsCache.set(key, { totalSteps, at: Date.now() });
  return totalSteps;
}

const TELEMETRY_DIR = path.join(__dirname, 'telemetry');
const TELEMETRY_ARCHIVE_DIR = path.join(TELEMETRY_DIR, 'archive');

function telemetryDirFor(archived) {
  return archived ? TELEMETRY_ARCHIVE_DIR : TELEMETRY_DIR;
}

function isArchivedQuery(req) {
  const value = req.query && req.query.archived;
  return value === '1' || value === 'true';
}

function buildSessionSummary(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const summary = summarizeTelemetrySessionData(data);
  const lastEvent = events.length > 0 ? events[events.length - 1].t : null;
  const startMs = data.startTime ? new Date(data.startTime).getTime() : null;
  const durationMs = (lastEvent != null && Number.isFinite(startMs)) ? Math.max(0, lastEvent - startMs) : 0;
  const client = (data.client && typeof data.client === 'object') ? data.client : {};
  const kind = String(data.parcoursId || '').startsWith('onb:') ? 'onboarding' : 'walk';
  const totalSteps = kind === 'walk' ? getParcoursTotalSteps(data.parcoursId || data.parcoursName) : null;
  const progressPct = (totalSteps > 0 && Number.isInteger(summary.finalStep))
    ? Math.max(0, Math.min(100, Math.round(((summary.finalStep + 1) / totalSteps) * 100)))
    : null;
  return {
    sessionId: data.sessionId,
    parcoursId: data.parcoursId,
    parcoursName: data.parcoursName,
    kind,
    deviceModel: getTelemetryDeviceLabel(data.client),
    devicePlatform: data.client && (data.client.devicePlatform || data.client.platform) ? (data.client.devicePlatform || data.client.platform) : '',
    deviceManufacturer: data.client && (data.client.deviceManufacturer || data.client.manufacturer) ? (data.client.deviceManufacturer || data.client.manufacturer) : '',
    deviceUuid: client.deviceUuid || null,
    isLoanDevice: !!client.isLoanDevice,
    appVersion: client.appVersion != null ? client.appVersion : null,
    webappCommit: client.webappCommit || null,
    startTime: data.startTime,
    eventCount: events.length,
    lastEvent,
    durationMs,
    endedAt: summary.endedAt,
    ended: summary.ended,
    resumeCount: summary.resumeCount,
    totalSteps,
    progressPct,
    firedSteps: summary.firedSteps,
    finalStep: summary.finalStep,
    uniqueStepCount: summary.uniqueStepCount,
    gpsCount: summary.gpsCount,
    avgAccuracy: summary.avgAccuracy,
    maxGapMs: summary.maxGapMs,
    sleepSuspects: summary.sleepSuspects,
    staleCallbacks: summary.staleCallbacks,
    rejectedFixes: summary.rejectedFixes,
    heartbeatRecoveries: summary.heartbeatRecoveries,
    gpsLostCount: summary.gpsLostCount,
    audioErrors: summary.audioErrors,
    userLostCount: summary.userLostCount,
    userRecoveredCount: summary.userRecoveredCount,
    lostRecoveryMedianMs: summary.lostRecoveryMedianMs,
    voiceFailCount: summary.voiceFailCount,
    afterplayFallbackCount: summary.afterplayFallbackCount,
    afterplayFallbackNoSrc: summary.afterplayFallbackNoSrc,
    afterplayFallbackLoadError: summary.afterplayFallbackLoadError,
    audiofocusRetryCount: summary.audiofocusRetryCount
  };
}

// Session files are timestamped ids (20260612_091529_o7xm.json); the telemetry
// dir also holds devices.json / notes.json which must never be listed as sessions.
const SESSION_FILE_RE = /^\d{8}_\d{6}_[A-Za-z0-9-]+\.json$/;

// Summary cache: parsing every multi-MB session file on each list call is the
// main cost of this endpoint. Key by path, validate by mtime+size so appends
// from /telemetry-push are picked up automatically; warm polls are stat-only.
const sessionSummaryCache = new Map(); // filePath -> { mtimeMs, size, summary }

const TELEMETRY_LIVE_WINDOW_MS = 3 * 60 * 1000;

// "Complete" means the walk actually ran, not just that the route probe ended
// on the last step: a session that resumed at step 20 (persisted walk gate)
// reaches the end with almost no steps fired and must not count as complete.
const COMPLETE_FIRED_RATIO = 0.8;

function computeSessionStatus(summary, nowMs) {
  if (summary.ended) {
    const firedCount = Array.isArray(summary.firedSteps) ? summary.firedSteps.length : 0;
    if (summary.totalSteps > 0
        && Number.isInteger(summary.finalStep)
        && summary.finalStep >= summary.totalSteps - 1
        && firedCount >= Math.ceil(summary.totalSteps * COMPLETE_FIRED_RATIO)) {
      return 'ended-complete';
    }
    return 'ended-partial';
  }
  const last = Number(summary.lastEvent) || 0;
  return (nowMs - last) < TELEMETRY_LIVE_WINDOW_MS ? 'live' : 'interrupted';
}

function listSessionSummaries(archived) {
  const dir = telemetryDirFor(archived);
  if (!fs.existsSync(dir)) return [];

  const sessions = [];
  fs.readdirSync(dir).forEach(file => {
    if (!SESSION_FILE_RE.test(file)) return;
    const filePath = path.join(dir, file);
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { return; }

    const cached = sessionSummaryCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      sessions.push(cached.summary);
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const summary = buildSessionSummary(data);
      summary.archived = archived;
      sessionSummaryCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, summary });
      sessions.push(summary);
    } catch(e) { /* skip corrupt files */ }
  });
  return sessions;
}

function invalidateSessionSummary(filePath) {
  sessionSummaryCache.delete(filePath);
}

// Telemetry: list sessions (active by default, ?archived=1 for archive).
// ?since=<ms> returns only sessions with lastEvent > since (for live polling);
// the ETag changes when any file changes OR a session crosses the live window,
// so pollers sending If-None-Match get cheap 304s while nothing moves.
app.get('/telemetry/sessions', requireAdmin, (req, res) => {
  const archived = isArchivedQuery(req);
  const now = Date.now();

  let sessions = listSessionSummaries(archived).map(summary =>
    Object.assign({}, summary, { status: computeSessionStatus(summary, now) }));
  sessions.sort((a, b) => (b.lastEvent || 0) - (a.lastEvent || 0));

  const maxLast = sessions.reduce((max, s) => Math.max(max, Number(s.lastEvent) || 0), 0);
  const liveCount = sessions.filter(s => s.status === 'live').length;
  const etag = 'W/"tsess-' + (archived ? 'a' : 'c') + '-' + sessions.length + '-' + maxLast + '-' + liveCount + '"';
  res.set('ETag', etag);
  res.set('X-Server-Time', String(now));
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const since = Number(req.query.since);
  if (Number.isFinite(since) && since > 0) {
    sessions = sessions.filter(s => (Number(s.lastEvent) || 0) > since);
  }
  res.json(sessions);
});

// Telemetry: get session detail. ?afterT=<ms> returns only events newer than
// afterT (incremental tail for following a live walk without re-downloading
// the whole multi-MB file each poll).
app.get('/telemetry/session/:id', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  const archived = isArchivedQuery(req);
  const filePath = path.join(telemetryDirFor(archived), safeId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const afterT = Number(req.query.afterT);
  if (Number.isFinite(afterT) && afterT > 0) {
    const events = (Array.isArray(data.events) ? data.events : []).filter(e => Number(e.t) > afterT);
    return res.json({ sessionId: data.sessionId, afterT, events, incremental: true });
  }
  res.json(data);
});

app.get('/telemetry/parcours/:id', requireAdmin, (req, res) => {
  const match = findParcoursByTelemetryId(req.params.id);
  if (!match) return res.status(404).json({ error: 'Parcours not found' });
  res.json({ fileName: match.fileName, data: match.data });
});

// Telemetry: delete session
app.delete('/telemetry/session/:id', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  const archived = isArchivedQuery(req);
  const filePath = path.join(telemetryDirFor(archived), safeId + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  fs.unlinkSync(filePath);
  invalidateSessionSummary(filePath);
  res.status(200).send('Deleted');
});

// Telemetry: archive a session (active -> archive/)
app.post('/telemetry/session/:id/archive', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeId) return res.status(400).send('Invalid session ID');

  const src = path.join(TELEMETRY_DIR, safeId + '.json');
  if (!fs.existsSync(src)) return res.status(404).send('Not found');
  if (!fs.existsSync(TELEMETRY_ARCHIVE_DIR)) fs.mkdirSync(TELEMETRY_ARCHIVE_DIR, { recursive: true });

  const dest = path.join(TELEMETRY_ARCHIVE_DIR, safeId + '.json');
  fs.renameSync(src, dest);
  invalidateSessionSummary(src);
  invalidateSessionSummary(dest);
  res.status(200).json({ sessionId: safeId, archived: true });
});

// Telemetry: unarchive a session (archive/ -> active)
app.post('/telemetry/session/:id/unarchive', requireAdmin, (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeId) return res.status(400).send('Invalid session ID');

  const src = path.join(TELEMETRY_ARCHIVE_DIR, safeId + '.json');
  if (!fs.existsSync(src)) return res.status(404).send('Not found');
  if (!fs.existsSync(TELEMETRY_DIR)) fs.mkdirSync(TELEMETRY_DIR, { recursive: true });

  const dest = path.join(TELEMETRY_DIR, safeId + '.json');
  fs.renameSync(src, dest);
  invalidateSessionSummary(src);
  invalidateSessionSummary(dest);
  res.status(200).json({ sessionId: safeId, archived: false });
});

// Telemetry: bulk archive (body: { sessionIds: [...] })
app.post('/telemetry/archive-bulk', requireAdmin, express.json(), (req, res) => {
  const ids = Array.isArray(req.body && req.body.sessionIds) ? req.body.sessionIds : [];
  if (!fs.existsSync(TELEMETRY_ARCHIVE_DIR)) fs.mkdirSync(TELEMETRY_ARCHIVE_DIR, { recursive: true });

  const archived = [];
  const skipped = [];
  ids.forEach(rawId => {
    const safeId = String(rawId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeId) { skipped.push(rawId); return; }
    const src = path.join(TELEMETRY_DIR, safeId + '.json');
    if (!fs.existsSync(src)) { skipped.push(safeId); return; }
    const dest = path.join(TELEMETRY_ARCHIVE_DIR, safeId + '.json');
    fs.renameSync(src, dest);
    invalidateSessionSummary(src);
    invalidateSessionSummary(dest);
    archived.push(safeId);
  });
  res.json({ archived, skipped });
});

// Telemetry: prune short sessions. Hard delete files where lastEvent - startTime < thresholdMs (default 60000).
// Targets the active dir by default; pass { archived: true } to prune the archive instead.
app.post('/telemetry/prune-short', requireAdmin, express.json(), (req, res) => {
  const threshold = Number(req.body && req.body.thresholdMs);
  const thresholdMs = Number.isFinite(threshold) && threshold > 0 ? threshold : 60000;
  const archived = !!(req.body && req.body.archived);
  const dir = telemetryDirFor(archived);
  if (!fs.existsSync(dir)) return res.json({ deleted: [], thresholdMs, archived });

  const deleted = [];
  fs.readdirSync(dir).forEach(file => {
    if (!SESSION_FILE_RE.test(file)) return;
    const filePath = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const events = Array.isArray(data.events) ? data.events : [];
      const lastEvent = events.length > 0 ? events[events.length - 1].t : null;
      const startMs = data.startTime ? new Date(data.startTime).getTime() : null;
      if (lastEvent == null || !Number.isFinite(startMs)) return;
      const durationMs = lastEvent - startMs;
      if (durationMs < thresholdMs) {
        fs.unlinkSync(filePath);
        invalidateSessionSummary(filePath);
        deleted.push(data.sessionId || file.replace(/\.json$/, ''));
      }
    } catch(e) { /* skip corrupt */ }
  });
  res.json({ deleted, thresholdMs, archived });
});


// Telemetry session notes — operator annotations ("wind, raining", "prospect
// variant B") keyed by sessionId in a single JSON file next to the sessions.
const TELEMETRY_NOTES_FILE = path.join(TELEMETRY_DIR, 'notes.json');

function _readNotesFile() {
  try {
    if (!fs.existsSync(TELEMETRY_NOTES_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(TELEMETRY_NOTES_FILE, 'utf8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (e) {
    console.warn('[Telemetry] notes read failed, treating as empty:', e.message);
    return {};
  }
}

app.get('/telemetry/notes', requireAdmin, (req, res) => {
  res.json({ notes: _readNotesFile() });
});

app.post('/telemetry/note/:id', requireAdmin, express.json({ limit: '16kb' }), (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeId) return res.status(400).json({ error: 'Invalid session ID' });

  const note = typeof (req.body && req.body.note) === 'string' ? req.body.note.trim().slice(0, 2000) : '';
  const notes = _readNotesFile();
  if (note) notes[safeId] = note;
  else delete notes[safeId];

  try {
    if (!fs.existsSync(TELEMETRY_DIR)) fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    fs.writeFileSync(TELEMETRY_NOTES_FILE, JSON.stringify(notes, null, 2));
  } catch (e) {
    console.error('[Telemetry] notes write failed:', e.message);
    return res.status(500).json({ error: 'Write failed' });
  }
  res.json({ ok: true, sessionId: safeId, note: note || null });
});

// Auto-archive: move active sessions whose last event is older than N days into
// archive/ so the active-dir scan (and the page's default view) stays small.
// Disable with TELEMETRY_AUTOARCHIVE_DAYS=0.
const TELEMETRY_AUTOARCHIVE_DAYS = Number(process.env.TELEMETRY_AUTOARCHIVE_DAYS != null ? process.env.TELEMETRY_AUTOARCHIVE_DAYS : 14);

function autoArchiveOldSessions() {
  if (!Number.isFinite(TELEMETRY_AUTOARCHIVE_DAYS) || TELEMETRY_AUTOARCHIVE_DAYS <= 0) return;
  const cutoff = Date.now() - TELEMETRY_AUTOARCHIVE_DAYS * 24 * 3600 * 1000;
  let moved = 0;
  listSessionSummaries(false).forEach(summary => {
    const last = Number(summary.lastEvent) || 0;
    if (last === 0 || last >= cutoff) return;
    const src = path.join(TELEMETRY_DIR, summary.sessionId + '.json');
    const dest = path.join(TELEMETRY_ARCHIVE_DIR, summary.sessionId + '.json');
    try {
      if (!fs.existsSync(TELEMETRY_ARCHIVE_DIR)) fs.mkdirSync(TELEMETRY_ARCHIVE_DIR, { recursive: true });
      fs.renameSync(src, dest);
      invalidateSessionSummary(src);
      invalidateSessionSummary(dest);
      moved += 1;
    } catch (e) {
      console.warn('[Telemetry] auto-archive failed for', summary.sessionId, ':', e.message);
    }
  });
  if (moved > 0) console.log('[Telemetry] auto-archived', moved, 'session(s) older than', TELEMETRY_AUTOARCHIVE_DAYS, 'days');
}

setTimeout(autoArchiveOldSessions, 60 * 1000);
setInterval(autoArchiveOldSessions, 24 * 3600 * 1000);

// A5 — Device registry. Each phone registers itself once per parcours entry
// (POST /devices from PAGES['parcours']); admins can fetch the inventory to
// see which phones are part of the fleet, when each was last seen, and which
// are flagged as loan devices. Storage: a single JSON file with an object
// keyed by uuid — the fleet is small enough that this is simpler than a
// directory of per-device files.
const DEVICES_FILE = path.join(__dirname, 'telemetry', 'devices.json');

function _readDevicesFile() {
  try {
    if (!fs.existsSync(DEVICES_FILE)) return {};
    const txt = fs.readFileSync(DEVICES_FILE, 'utf8');
    const data = JSON.parse(txt);
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (e) {
    console.warn('[devices] read failed, treating as empty:', e.message);
    return {};
  }
}

function _writeDevicesFile(map) {
  try {
    const dir = path.dirname(DEVICES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(map, null, 2));
  } catch (e) {
    console.error('[devices] write failed:', e.message);
  }
}

// CORS preflight for Cordova app (same pattern as /telemetry-push).
app.options('/devices', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// POST /devices — public (the app posts unauthenticated, like telemetry-push).
// Idempotent upsert keyed by uuid. Preserves first_seen and any operator-set
// friendly_name across upserts.
app.post('/devices', express.json({ limit: '32kb' }), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!uuid || uuid.length > 128) {
    return res.status(400).json({ error: 'missing or invalid uuid' });
  }

  const map = _readDevicesFile();
  const existing = map[uuid] || {};
  const now = new Date().toISOString();

  const updated = Object.assign({}, existing, {
    uuid:         uuid,
    is_loan:      !!body.is_loan,
    platform:     body.platform     || existing.platform     || null,
    manufacturer: body.manufacturer || existing.manufacturer || null,
    model:        body.model        || existing.model        || null,
    os_version:   body.os_version   || existing.os_version   || null,
    apk_version:  body.apk_version  || existing.apk_version  || null,
    webapp_hash:  body.webapp_hash  || existing.webapp_hash  || null,
    first_seen:   existing.first_seen || now,
    last_seen:    now,
  });

  // Friendly name is operator-only (PATCH below), don't let the device overwrite it.
  if (existing.friendly_name) updated.friendly_name = existing.friendly_name;

  map[uuid] = updated;
  _writeDevicesFile(map);

  res.json({ ok: true, uuid: uuid, first_seen: updated.first_seen, last_seen: updated.last_seen });
});

// GET /devices — admin-only. Returns the full device inventory.
app.get('/devices', requireAdmin, (req, res) => {
  const map = _readDevicesFile();
  const list = Object.values(map).sort((a, b) => {
    const la = a.last_seen || '';
    const lb = b.last_seen || '';
    return lb.localeCompare(la);
  });
  res.json({ devices: list, count: list.length });
});

// PATCH /devices/:uuid — admin sets friendly_name (or overrides is_loan).
app.patch('/devices/:uuid', requireAdmin, express.json(), (req, res) => {
  const uuid = req.params.uuid;
  const map = _readDevicesFile();
  if (!map[uuid]) return res.status(404).json({ error: 'unknown uuid' });

  const body = req.body || {};
  if (typeof body.friendly_name === 'string') map[uuid].friendly_name = body.friendly_name.trim() || null;
  if (typeof body.is_loan === 'boolean')      map[uuid].is_loan       = body.is_loan;

  _writeDevicesFile(map);
  res.json({ ok: true, device: map[uuid] });
});


// List parcours
app.get('/list', (req, res) => {
  const role = getUserRole(req);
  const parcoursFolder = './parcours/';
  const parcours = [];
  fs.readdirSync(parcoursFolder).forEach(file => {
    if (!file.endsWith('.json')) return;
    const parcoursFileName = file.split('.json')[0];

    // Skip-with-log on a corrupt file: a single bad JSON must not 500 the
    // whole endpoint — that would put every app into the nodata retry loop.
    let parcoursContent;
    try {
      parcoursContent = JSON.parse(fs.readFileSync(parcoursFolder + file, 'utf8'));
    } catch (e) {
      console.warn('[/list] skipping corrupt parcours file:', file, e.message);
      return;
    }
    if (!parcoursContent || !parcoursContent.info) {
      console.warn('[/list] skipping parcours file without info:', file);
      return;
    }

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
      mediaBytes: getParcoursMediaStats(parcoursFileName).totalBytes,
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
  const mediaFolder = './media/'+req.params.parcours+'/';

  // Create folder if not exists
  if (!fs.existsSync(mediaFolder)) fs.mkdirSync(mediaFolder);

  const media = {'.':[]};
  const mediaStats = getParcoursMediaStats(req.params.parcours);
  fs.readdirSync(mediaFolder).forEach(folder => {
    if (fs.lstatSync(mediaFolder + folder).isDirectory())
      media[folder] = fs.readdirSync(mediaFolder + folder)
          .filter(file => !fs.lstatSync(mediaFolder + folder + '/' + file).isDirectory())
          .filter(file => isValidMediaFile(file));
    else 
      if (isValidMediaFile(folder))
        media['.'].push(folder);
  });
  media.__stats = mediaStats;
  res.json(media);
});  

// Standard MPEG Layer 3 bitrates in bps
const MPEG_BITRATES = new Set([32,40,48,56,64,80,96,112,128,144,160,192,224,256,320].map(b => b * 1000));

// Check all MP3 files in a parcours for mobile compatibility issues
app.get('/mediaCheck/:parcours', async (req, res) => {
  const mediaFolder = './media/' + req.params.parcours + '/';
  if (!fs.existsSync(mediaFolder)) return res.json({});

  // Collect all files as { key: "folder/file", path: "..." }
  const files = [];
  fs.readdirSync(mediaFolder).forEach(entry => {
    const entryPath = mediaFolder + entry;
    if (fs.lstatSync(entryPath).isDirectory()) {
      fs.readdirSync(entryPath).forEach(file => {
        if (!fs.lstatSync(entryPath + '/' + file).isDirectory())
          files.push({ key: entry + '/' + file, path: entryPath + '/' + file });
      });
    } else {
      files.push({ key: entry, path: entryPath });
    }
  });

  const results = {};
  await Promise.all(files.map(async ({ key, path: filePath }) => {
    const ext = filePath.split('.').pop().toLowerCase();
    if (ext !== 'mp3') {
      results[key] = { ok: false, tier: 'error', issues: ['not_mp3'] };
      return;
    }
    try {
      const meta = await parseFile(filePath, { duration: false });
      const issues = [];
      const bitrate = meta.format.bitrate;
      const profile = meta.format.codecProfile;

      if (!bitrate) {
        issues.push('bad_header');
      } else {
        if (profile === 'VBR') issues.push('vbr');
        else if (profile === 'ABR') issues.push('abr');
        const isVariableBitrate = issues.includes('vbr') || issues.includes('abr');
        if (!isVariableBitrate && !MPEG_BITRATES.has(bitrate)) issues.push('nonstandard_bitrate');
      }

      const errorIssues = ['vbr', 'abr', 'not_mp3', 'bad_header', 'nonstandard_bitrate'];
      const warnIssues = [];
      if (bitrate > 256000 && !issues.includes('nonstandard_bitrate')) warnIssues.push('high_bitrate');

      const allIssues = [...issues, ...warnIssues];
      if (allIssues.length === 0) {
        results[key] = { ok: true };
      } else {
        const tier = issues.some(i => errorIssues.includes(i)) ? 'error' : 'warn';
        results[key] = { ok: false, tier, issues: allIssues, bitrate };
      }
    } catch {
      results[key] = { ok: false, tier: 'error', issues: ['bad_header'] };
    }
  }));

  res.json(results);
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
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

