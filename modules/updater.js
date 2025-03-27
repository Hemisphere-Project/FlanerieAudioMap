import archiver from "archiver";
import fs from "fs";
import crypto from "crypto";
import path from 'path';
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
    }
};

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
        archive.finalize();
    });
}

// Bundle APPDATA (Promise)
function bundleAppData() 
{
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


// Routes
function initUpdater(app) 
{
    // Get APPINFO
    app.get('/update/info', (req, res) => {
        res.json(APPINFO);
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
        console.log("Downloading APPDATA ZIP file...");
        res.download(__basepath + "/" + TEMP_DIR + "/" + ZIP_FILENAME);
    });

    // Display APPINFO
    log("APPINFO:\n"+JSON.stringify(APPINFO, null, 4));
    log("APPMEDIA:\n"+JSON.stringify(APPMEDIA, null, 4));
    log('ready.\n----------------------'); 
}

export default initUpdater;