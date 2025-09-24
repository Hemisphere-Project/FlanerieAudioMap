# Copilot Instructions for FlanerieAudioMap

## Project Overview
- **FlanerieAudioMap** is a Node.js/Express server for managing, syncing, and serving audio/visual parcours (routes) and associated media files.
- The main entry point is `server.js`, which wires up all routes, static serving, and module integrations.
- Media files are stored in the `media/` directory, organized by parcours and type (e.g., `Objets`, `Offlimits`, `Steps`).
- Parcours definitions are JSON files in the `parcours/` directory, each with an `info` object and spot/step structure.
- The frontend is served from `www/app/` and `www/control/` (for admin/editor UI).

## Key Patterns & Workflows
- **Media Sync:** `/syncmedia/:subdomain` fetches a remote medialist, compares checksums, and downloads missing/different files using streaming (see `server.js`).
- **Media List:** `/medialist` returns a checksum map of all media files for sync/validation.
- **Parcours CRUD:**
  - Create: POST `/newParcours` (JSON body `{name}`)
  - Delete: POST `/deleteParcours` (JSON body `{file}`)
  - Clone: POST `/cloneParcours` (JSON body `{file, name}`)
  - Edit: GET/POST `/edit/:file/json`
- **Media Upload/Remove:**
  - Upload: POST `/mediaUpload/:parcours/:folder/:name?` (multipart/form-data)
  - Remove file: GET `/mediaRemove/:parcours/:folder/:file`
  - Remove folder: GET `/mediaRemoveFolder/:parcours/:folder`
- **Error Logging:**
  - POST `/errorhandler` appends JSON error reports to daily log files in `logs/`.
- **Restart:** GET `/restartServer` triggers a process exit (for external restart).

## Conventions & Integration
- **ESM Syntax:** Uses ES modules (`import ... from ...`).
- **Dynamic Paths:** Uses `fileURLToPath(import.meta.url)` for `__dirname` in ESM.
- **Checksums:** Media file integrity is tracked via MD5 hashes (see `walkDir`).
- **Module Structure:** Custom logic is modularized in `modules/` (e.g., `github-hook.js`, `updater.js`, `mapdownload.js`).
- **Static Serving:**
  - `/media` → `media/` (audio/video)
  - `/app` → `www/app/` (user app)
  - `/control` → `www/control/` (admin/editor)
- **Environment:**
  - Uses `dotenv` for config (see `.env` for `PORT`, `DOMAIN`, `GITHOOK_SECRET`).

## Examples
- To add a new parcours, POST to `/newParcours` with `{ "name": "My Route" }`.
- To sync media from another instance: GET `/syncmedia/othersubdomain`.
- To upload a media file: POST to `/mediaUpload/myparcours/Objets` with a file field named `file`.

## Important Files/Dirs
- `server.js` — main server logic and all routes
- `modules/` — custom server logic (hooks, updater, map download)
- `media/` — all audio/video assets, organized by parcours
- `parcours/` — all parcours definitions (JSON)
- `www/app/`, `www/control/` — frontend and admin UIs

## Project-Specific Notes
- Media sync uses streaming with `stream.pipeline` for compatibility with Node fetch.
- All file/folder operations are performed synchronously for simplicity.
- Error logs are stored per day in `logs/` as JSON lines.
- No test suite or build step is present; run with `node server.js` (ensure Node 18+ for fetch/stream support).
