import archiver from "archiver";
import fs from "fs";
import crypto from "crypto";
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const __basepath = path.resolve(path.dirname(fileURLToPath(import.meta.url))+ "/..")

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

function log(msg) {
    console.log(`[\x1b[32mUpdater\x1b[0m]\t${msg}`);
}

function error(msg) {
    console.error(`[Updater]\t${msg}`);
}

const APPDATA_DIR   = process.env.APPDATA_DIR   || "www/app";
const MEDIA_DIR     = process.env.MEDIA_DIR     || "media";
const TEMP_DIR      = process.env.TEMP_DIR      || "_tmp";
const ZIP_FILENAME  = process.env.ZIP_FILENAME  || "app.zip";

var SETMEDIAHASH = false

var APPINFO = {
    'appzip': {
        'url': null,
        'hash': null
    },
    // Git provenance of the bundled webapp. Refreshed on every (re)bundle so it
    // tracks the commit the GitHub webhook pulled. Surfaced via /update/info and
    // /version, and embedded INTO the zip as build.js so the cached bundle on the
    // phone reports its OWN running commit (not the server's current HEAD).
    'commit': null,
    'builtAt': null
};

// Short commit hash of the server's checkout, read fresh at bundle time.
function getGitCommit() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: __basepath }).toString().trim();
    } catch (e) {
        error('git commit lookup failed: ' + (e && e.message ? e.message : e));
        return 'unknown';
    }
}

var APPMEDIA = {};

// compress appdata/ into download/appdata.zip
// return promise
function compressFolder(dir) {
    return new Promise((resolve, reject) => {

        const APPDATA_PATH = __basepath + "/" + dir;
        const ZIP_FILE_PATH = __basepath + "/" + TEMP_DIR + "/" + ZIP_FILENAME;

        // remove existing ZIP file
        if (fs.existsSync(ZIP_FILE_PATH))
            fs.unlinkSync(ZIP_FILE_PATH);

        // create ZIP file
        const output = fs.createWriteStream(ZIP_FILE_PATH);
        const archive = archiver("zip", {
            zlib: { level: 9 } // Sets the compression level.
        });

        output.on('close', () => {
            log(`APPDATA zip file created at ${ZIP_FILE_PATH}`);
            resolve(ZIP_FILE_PATH);
        });

        archive.on('error', (err) => {
            error("APPDATA Error creating ZIP file:", err);
            reject(err);
        });

        archive.pipe(output);
        archive.directory(APPDATA_PATH, false); // append files from a sub-directory, putting its contents at the root of archive
        // Embed build provenance directly in the bundle. The phone runs the cached
        // unzipped copy, so reading this (window.BUILD_COMMIT, via app.html) reports
        // the commit actually running on the device — which is what reveals a stale
        // cache. No build.js exists on disk, so there's no duplicate archive entry.
        const buildJs = `window.BUILD_COMMIT=${JSON.stringify(APPINFO.commit)};window.BUILD_TIME=${JSON.stringify(APPINFO.builtAt)};`;
        archive.append(buildJs, { name: 'build.js' });
        archive.finalize();
    });
}

// Bundle APPDATA (Promise)
function bundleAppData()
{
    // Stamp the commit + build time BEFORE compressing so build.js (embedded in the
    // zip) and APPINFO carry the commit this bundle was built from.
    APPINFO.commit = getGitCommit();
    APPINFO.builtAt = new Date().toISOString();
    log(`bundling webapp @ commit ${APPINFO.commit}`);

    // Prepare APPDATA zip file
    return compressFolder(APPDATA_DIR)

        // Store hash of APPDATA zip file  
        .then((zip_file) => {
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash('sha256');
                const input = fs.createReadStream(zip_file);

                input.on('data', (chunk) => {
                    hash.update(chunk);
                });

                input.on('end', () => {
                    APPINFO.appzip.hash = hash.digest('hex');
                    resolve();
                });

                input.on('error', (err) => {
                    console.error("Error reading APPDATA zip file:", err);
                    reject(err);
                });
            });
        })
}


// Recursively read files and directories
function fileCrowler(path) {
    const files = fs.readdirSync(path);
    const result = {};
    files.forEach((file) => {
        const subpath = path + "/" + file;
        const stats = fs.statSync(subpath);
        if (stats.isDirectory()) {
            result[file] = fileCrowler(subpath);
        } 
        else if (!file.startsWith('.')) 
        {
            result[file] = {}
            const data = fs.readFileSync(subpath);
            result[file].size = stats.size;
            if (SETMEDIAHASH) {
                const hash = crypto.createHash("sha256");
                hash.update(data);
                result[file].hash = hash.digest("hex")
            }
        }
    });
    return result;
}


// build Media tree
function buildMediaTree() 
{
    return new Promise((resolve, reject) => {
        const MEDIA_PATH = __basepath + "/" + MEDIA_DIR;

        function flatten(media) {
            const result = {};
            for (const folder in media) {
                    const files = media[folder];
                    for (const file in files) {
                        const filedata = files[file];
                        result[folder + "/" + file] = filedata;
                    }
            }
            return result;
        }

        APPMEDIA = fileCrowler(MEDIA_PATH);
        for (const folder in APPMEDIA) 
            APPMEDIA[folder] = flatten(APPMEDIA[folder]);

        resolve();
    })
}


// Create TEMP_DIR if not exists
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Bundle APPDATA
await bundleAppData();

// Build Media tree
await buildMediaTree();

// Watch APPDATA_DIR for changes
var appdataWatcherDebounce = null;
fs.watch(APPDATA_DIR, { recursive: true }, (eventType, filename) => {
    clearTimeout(appdataWatcherDebounce);
    appdataWatcherDebounce = setTimeout(() => {
        log(`APPDATA_DIR changed, rebuilding APPDATA zip...`);
        bundleAppData();
    }, 1000);
    // log(`APPDATA_DIR changed: ${eventType} ${filename}`);
});

// Watch MEDIA_DIR for changes
var mediaWatcherDebounce = null;
fs.watch(MEDIA_DIR, { recursive: true }, (eventType, filename) => {
    clearTimeout(mediaWatcherDebounce);
    mediaWatcherDebounce = setTimeout(() => {
        log(`MEDIA_DIR changed, rebuilding media tree...`);
        buildMediaTree();
    }, 1000);
    // console.log(`MEDIA_DIR changed: ${eventType} ${filename}`);
});

// Routes
function initUpdater(app) 
{
    // Get APPINFO
    app.get('/update/info', (req, res) => {
        res.json(APPINFO);
    });

    // Build provenance of the currently-bundled webapp (what the latest zip — and
    // therefore a freshly-updated phone — is built from). Compare this commit to the
    // band shown in-app to confirm a phone isn't running a stale cached bundle.
    app.get('/version', (req, res) => {
        res.json({
            commit: APPINFO.commit,
            builtAt: APPINFO.builtAt,
            appzipHash: APPINFO.appzip.hash
        });
    });

    // Get MEDIA tree
    app.get('/update/media/:folder', (req, res) => {
        const folder = req.params.folder;
        if (folder in APPMEDIA)
            res.json(APPMEDIA[folder]);
        else
            res.status(404).send("Folder not found");
    })

    // Download appdata.zip
    APPINFO.appzip.url = '/update/appdata';
    app.get(APPINFO.appzip.url, (req, res) => {
        log("Someone is downloading APPDATA ZIP file...");
        res.download(__basepath + "/" + TEMP_DIR + "/" + ZIP_FILENAME);
    });

    // Display APPINFO
    log("APPINFO:\n"+JSON.stringify(APPINFO, null, 4));
    // log("APPMEDIA:\n"+JSON.stringify(APPMEDIA, null, 4));
    log('ready.\n----------------------'); 
}

export default initUpdater;