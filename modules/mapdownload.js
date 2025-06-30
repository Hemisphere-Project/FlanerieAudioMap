import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

const MEDIA_DIR     = process.env.MEDIA_DIR     || "media";
const __basepath = path.resolve(path.dirname(fileURLToPath(import.meta.url))+ "/..")
const MEDIA_PATH = __basepath + "/" + MEDIA_DIR;

function log(msg) {
  console.log(`[\x1b[33mMapDL\x1b[0m]\t${msg}`);
}

// Download task tracking
const tasks = {}; // Key: `${name},${lat},${lon}` -> { running, progress, promise }

function downloadTile(url, outputPath, maxRetries = 3, retryDelay = 2500) {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount) => {
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(outputPath);
      client.get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => file.close(resolve));
        } else if (response.statusCode === 429 && retryCount > 0) {
          setTimeout(() => attempt(retryCount - 1), retryDelay);
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      }).on('error', (err) => {
        if (retryCount > 0) {
          setTimeout(() => attempt(retryCount - 1), retryDelay);
        } else {
          reject(err);
        }
      });
    };
    attempt(maxRetries);
  });
}

function latLonToTile(lat, lon, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function getTileRange(lat, lon, zoom, radiusKm) {
  const earthCircumferenceKm = 40075;
  const latDegreeKm = earthCircumferenceKm / 360;
  const lonDegreeKm = earthCircumferenceKm * Math.cos((lat * Math.PI) / 180) / 360;

  const latDelta = radiusKm / latDegreeKm;
  const lonDelta = radiusKm / lonDegreeKm;

  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLon = lon - lonDelta;
  const maxLon = lon + lonDelta;

  const minTile = latLonToTile(maxLat, minLon, zoom);
  const maxTile = latLonToTile(minLat, maxLon, zoom);

  return {
    minX: Math.min(minTile.x, maxTile.x),
    maxX: Math.max(minTile.x, maxTile.x),
    minY: Math.min(minTile.y, maxTile.y),
    maxY: Math.max(minTile.y, maxTile.y)
  };
}

// Async download task
async function downloadTilesTask(lat, lon, radiusKm, startZoom, endZoom, outputDir, progressObj, delayMs = 1000) {
  let totalTiles = 0;
  let completedTiles = 0;
  const tileRanges = [];

  // Pre-calculate total tiles
  for (let zoom = startZoom; zoom <= endZoom; zoom++) {
    const range = getTileRange(lat, lon, zoom, radiusKm);
    const count = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    tileRanges.push({ zoom, range, count });
    totalTiles += count;
  }
  progressObj.total = totalTiles;
  progressObj.completed = 0;
  progressObj.running = true;
    log(`Starting download task for ${totalTiles} tiles from zoom ${startZoom} to ${endZoom} around (${lat}, ${lon})`);
  

  for (const { zoom, range } of tileRanges) {
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const url = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
        const tilePath = path.join(outputDir, `${zoom}`, `${x}`, `${y}.png`);
        fs.mkdirSync(path.dirname(tilePath), { recursive: true });

        // Skip if already downloaded
        if (fs.existsSync(tilePath)) {
          progressObj.completed++;
          continue;
        }
        try {
          await downloadTile(url, tilePath);
        } catch (error) {
          // Optionally log error
          log('Error downloading tile:', error);
        }
        progressObj.completed++;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  progressObj.running = false;
}

// Helper: get progress percent
function getProgress(progressObj) {
  if (!progressObj) return { percent: 0, running: false };
  const percent = progressObj.total === 0 ? 0 : ((progressObj.completed / progressObj.total) * 100);
  return {
    percent: percent.toFixed(2),
    running: progressObj.running,
    completed: progressObj.completed,
    total: progressObj.total
  };
}

function Mapdownloader(app) {

    // POST /map/dl
    app.post('/map/dl', (req, res) => {
        const { name, lat, lon } = req.body;
        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return res.status(400).json({ error: 'lat and lon required as numbers' });
        }
        const key = `${name}`;
        const dir = path.join(MEDIA_PATH, name, 'Maps');
        if (!tasks[key] || !tasks[key].running) {
            // Create progress object first
            const progressObj = { running: true, completed: 0, total: 0 };
            // Start new task
            tasks[key] = progressObj;
            // Start new task
            progressObj.promise = downloadTilesTask(lat, lon, 1, 20, 20, dir, progressObj, 1000)
                .catch(() => { progressObj.running = false; });
            return res.json({ message: 'Download started', key: key, progress: getProgress(progressObj) });
        } else {
            // Already running
            return res.json({ message: 'Download already running', key: key, progress: getProgress(tasks[key]) });
        }
    });

    // GET /map/progress?name=...&lat=...&lon=...
    app.get('/map/progress', (req, res) => {
        const name = req.query.name;
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: 'lat and lon query params required' });
        }
        const key = `${name}`;
        if (!tasks[key]) {
            return res.json({ message: 'No task for this center', progress: { percent: 0, running: false } });
        }
        return res.json({ progress: getProgress(tasks[key]) });
    });

}

export default Mapdownloader;