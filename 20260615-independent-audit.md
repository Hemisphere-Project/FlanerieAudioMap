# Independent Codebase Audit & Consolidated Roadmap

**Date:** 2026-06-15
**Author:** independent review pass (fresh read, cross-checked against `mobile-audit.md`)
**Scope:** the whole project —
`FlanerieAudioMap` (downloaded webapp + Node server + telemetry/deploy),
`FlanerieCordova` (launcher container),
and the four forked native plugins
(`cordova-background-geolocation-plugin` 2.15.1, `cordova-plugin-power-optimization` 0.3.3,
`cordova-plugin-audio-simple` 0.3.5, `cordova-plugin-audiofocus` 1.9.1).

**Relationship to `mobile-audit.md`:** that document is the operational source of truth and
stays canonical for the field-test/resilience workstreams (A–L, P0–P3, GIVORS rounds). This
document is a **second opinion**: it (1) re-derives the current state independently, (2) filters
the findings against source so nothing here is an unverified guess, and (3) adds three areas
`mobile-audit.md` deliberately does **not** track — server **security**, build/deploy
**provenance**, and code-health **tech-debt** — then folds everything into one de-duplicated
forward roadmap. Field-test discipline is preserved: the new items are either low-risk
ship-alongside or explicitly deferred to *after* the next field test.

---

## §0 — Method

Three independent fan-out reads (webapp / native+plugins / server+telemetry+deploy) were run,
then the load-bearing and contested findings were checked line-by-line against current source.
The audit agents produced a mix of **real-new**, **already-shipped**, and **wrong** findings;
§1 records what survived verification so the reader can trust the rest. Every source claim below
cites the file:line it was checked at, against the working tree as of 2026-06-15 (webapp
`a2121c9`, apk 33, plugin forks at the versions listed above).

---

## §1 — Verification summary (confirmed / corrected / dismissed)

### Confirmed against source
- **Flat 20 m startup bar is live; the adaptive-relax machinery is gone.**
  `STARTUP_FIX_MAX_ACCURACY_M = 20` (geoloc.js:26); the relax constants / `_effectiveAccuracyBar()` /
  `gps_startup_relaxed` no longer exist. Matches the 2026-06-10 addendum.
- **Accuracy-degradation guard is wired as documented.** `DEGRADED_ACCURACY_M = 35`,
  `DEGRADED_SUSTAIN_MS = 60000` (geoloc.js:32-33), read in `_trackAccuracyDegradation` (geoloc.js:714-746).
- **Plugin fork versions are internally consistent.** Fork `package.json`, FlanerieCordova
  `plugins/*`, and the lockfile all agree: bg-geo **2.15.1**, power-opt **0.3.3**, audio-simple
  **0.3.5**, audiofocus **1.9.1**; `config.xml` at version/versionCode **34**. (The `mobile-audit.md`
  Status-Overview table still lists the older pre-apk-30 numbers — *stale, not wrong*; it is
  superseded by its own later addenda.)

### Corrected / dismissed agent claims (do **not** schedule these)
- ❌ **"The D2 wake-rail uses an FGS location service and breaks the 2026-10-28 Play
  FGS-geofencing policy."** False. The rail is `GeofenceRailReceiver`
  (`cordova-background-geolocation-plugin/android/common/.../provider/GeofenceRailReceiver.java`),
  built on `GeofencingClient.addGeofences` + a `PendingIntent` `BroadcastReceiver` — **FGS-free**.
  The only foreground service in the plugin is the *continuous-tracking* `LocationService`.
  This **confirms** the memory note `play-console-fgs-geofencing-2026`: the pending action is a
  Play Console *declaration* check (must read "continuous tracking", not "geofencing") — **not a
  code change**.
- ❌ **"audio-simple's 5001/AudioTrack diagnostic is incomplete (no instance population)."**
  Largely false. The B1 diag (0.3.5) already attaches `players_total` / `players_prepared` /
  `players_playing` to every loaderror/playerror (per the 2026-06-11 B1 description). Nothing to do.
- ❌ **"`GPSSIGNAL_OK` is a hidden contract with no writer; `undefined` skips LOST logic."**
  False. Declared `var GPSSIGNAL_OK = true` (pages.js:3458), toggled false→true at pages.js:3889 /
  3985; every reader is `typeof GPSSIGNAL_OK !== 'undefined'`-guarded (parcours.js:967, pages.js:3680).
  The undefined case is handled. (Was plan item **W2 — dropped.**)
- ❌ **"The iOS motion native path is unmaintained churn / dead code to clean up."** Already done.
  `startMotionActivityUpdates` (MAURRawLocationProvider.m:694-720) is the canonical minimal form —
  the source comment is explicit: *"a SINGLE `startActivityUpdatesToQueue` on the main thread —
  NOTHING else"*; the v2.14.5 recreate/stop-restart churn is gone. (Reframes plan item **T1**, below.)
- ⚠️ **"Path traversal in parcours/media ops is anonymous-HIGH."** Over-rated. `POST /edit/:file/json`,
  `/newParcours`, `/deleteParcours`, `/cloneParcours`, `/mediaUpload`, `/mediaRemove*`, `/restartServer`
  are all behind `requireAuth`/`requireAdmin` (server.js:1146-1541). The traversal is real but
  **authenticated-only** — see S1b below, lower priority than the one truly-public hole (S1).

### Confirmed as a genuine NEW issue
- ✅ **Anonymous `.json` path-traversal read** — see **S1** below. Verified exploitable in source.

---

## §2 — New findings (not tracked in `mobile-audit.md`)

Each: id · severity · field-safety tag · location · note. Cross-references avoid double-counting
items already tracked under keepalive levers / A4 / the motion saga.

### A. Server / security — *beyond the 2026-06-10 hardening (which only did open-redirect, timing-safe compare, cookie-secure)*

- **S1 · HIGH · [SAFE-TODAY] — anonymous path-traversal `.json` read.**
  `GET /edit/:file/json` (server.js:1245) is **unauthenticated** and does
  `JSON.parse(fs.readFileSync('./parcours/' + req.params.file + '.json'))` with no sanitization.
  Express URL-decodes the route param, so `GET /edit/..%2f..%2fguest_password/json` reads
  `./parcours/../../guest_password.json` — and `guest_password.json` **exists at repo root**. Net:
  any anonymous client can read any `.json` on disk (guest password, telemetry sessions,
  `package.json`, …). **Fix:** add `requireAuth` to the GET, *and* reduce `:file` to a basename
  (`path.basename`, reject `..`/`/`). It is the sibling `POST /edit/:file/json` (line 1260) that is
  auth-gated — the GET was simply left open.
- **S1b · MED · [SAFE-TODAY] — same unsanitized `:file`/`:folder` in the auth-gated handlers.**
  `'./parcours/' + fileName` / media-folder joins recur in the authenticated parcours & media
  routes (server.js:1146-1541). Auth limits blast radius to logged-in admin/guest, but the basename
  guard from S1 should be applied uniformly (defense-in-depth; a guest could otherwise traverse
  outside `GUEST_` scope).
- **S2 · MED · [TEST-FIRST] — unbounded public ingest (disk-fill DoS).**
  `/telemetry-push` (server.js:364), `/launcher-beacon` (329) and `POST /devices` (1043) are
  unauthenticated **by design** (phones post anonymously; the `POST /devices` comment at 1040 says
  so). Session/device IDs are regex-sanitized, so there's no traversal — but there is **no
  rate-limit, per-IP quota, or free-space check** before writing. A hostile client can fill the
  telemetry disk. *Mitigation, low urgency (mostly-internal server):* per-(IP, day) session cap +
  max-events accounting + a `statvfs` free-space guard before write + a retention/prune job (a
  manual `prune-short` already exists at server.js:905).
- **S3 · LOW · [cross-ref only]** — auth cookie's `secure` flag trusts `x-forwarded-proto`.
  Already recorded in `mobile-audit.md` 2026-06-10. No new action; listed for completeness.

### B. Build / deploy provenance — *new*

- **V1 · MED · [SAFE-TODAY] — pre-build plugin-version assertion.**
  apk 32 **and** apk 33 compiled against audio-simple **0.3.4** while the fork + lockfile already
  said 0.3.5 — the skew documented in `mobile-audit.md` 2026-06-15 *correction #2* (a
  `cordova prepare`-only state that compiles new code while `plugins/` metadata still reports the
  old version, leaving "is the diag present?" unverifiable from telemetry). **Fix:** a build gate
  (`npm run check:plugin-versions`, or extend the existing `hooks/after_prepare_plugin_versions.js`)
  that **fails the build** when `plugins/*/plugin.xml` ≠ fork `package.json` ≠ lockfile; and surface
  `session_diag.plugin_versions` on the in-app build band so a mismatch is visible pre-walk. This
  closes the exact gap that cost two builds. (The `plugin-upgrade` skill already *syncs* versions;
  V1 *asserts the sync stuck*.)
- **V2 · LOW · [noted/backlog]** — the GitHub webhook does `git pull && npm i` but **does not
  restart node**, so `server.js` / `modules/updater.js` changes need a manual restart (memory
  `deploy-pipeline`; `mobile-audit.md` 2026-06-02 addendum 6). Reaffirmed, not new. Cheap future
  fix: webhook restarts node, or a `/version`-vs-`BUILD_COMMIT` self-check alarm server-side.

### C. Webapp correctness — *new, small*

- **W1 · LOW** — startup-vs-runtime accuracy thresholds are unreconciled and undocumented:
  startup gate accepts ≤ 20 m (`STARTUP_FIX_MAX_ACCURACY_M`, geoloc.js:26) but the runtime trigger
  path rejects fixes with `accuracy > 30` (geoloc.js:979). This is *probably intentional* (a strict
  origin at rdv, a looser bar to keep triggering mid-walk), but a 21-30 m device behaves
  inconsistently between the two phases and nothing says why. Fold into the **T4** magic-number pass
  with a one-line provenance comment, or unify if the split is unintended.

### D. Tech-debt / maintainability — *new workstream "T", DEFERRED to after the next field test*

- **T1 · LOW** — the iOS motion *native* path is already minimal (verified, §1). The only residual
  is the **webapp `checkmotion` scaffolding** accreted during the motion saga (button-first fire,
  resume re-arm, manual-retry/Settings deep-link). With the real cause resolved at the configure
  level (memory `motion-auth-saga`), this scaffolding can be trimmed — *low value, do opportunistically.*
- **T2 · MED (supportability)** — keepalive stack has **no single source of truth**. Five overlapping
  layers (silent 20 Hz loop, NoSleep, audiofocus FG service, D1 watchdog ack, renderer-priority) work
  together but "which layer is active in which phase" lives only in scattered comments and addenda.
  Add a short `KEEPALIVE.md` (or a header block in player.js/pages.js) + a `keepalive_status`
  telemetry snapshot so a field failure points at the failed layer. Low code risk, high diagnosis value.
- **T3 · LOW** — `server.js` is a ~1560-line monolith (static serving, auth, control pages, beacons,
  telemetry ingest/query, devices, parcours CRUD, media upload, restart). Extract into modules in the
  style of `modules/updater.js` / `modules/github-hook.js`. Mechanical; do post-field-test.
- **T4 · LOW (but enabling)** — thresholds/magic-numbers are scattered (geoloc startup/degraded; spot
  load radii + unload debounce; parcours LOST enter/sustain; pages poll intervals/attempt caps;
  telemetry flush/buffer/timeout). Collect each into a per-module labelled config block with the
  field-test provenance of each value. **Directly aids the upcoming threshold-calibration round**
  (the weak-GPS P0), so this one is worth doing *early in* the T workstream.
- **T5 · LOW** — audio backend selection runs twice (module-init **and** per-load in
  `PlayerSimple.load()`), so a `window.AUDIO_BACKEND_*` set after module load is ignored and the
  fallback chain (audio-simple→native-media→Howler / exoplayer→Howler) is duplicated. Consolidate +
  document the chain. (Note: this becomes mostly moot once Howler retirement lands — keep it cheap.)

---

## §3 — Consolidated forward roadmap (the updated roadmap)

A single de-duplicated view, so the live work no longer has to be traced across 40 addenda.
P0 items are **already in `mobile-audit.md`** (consolidated here, not new). P1/P2 are this audit's
additions.

### P0 — blocks the next field test / launch

| # | Item | Gate / what unblocks it |
|---|---|---|
| P0-1 | **Weak-GPS calibration** | One walk that **actually sustains avgAcc ≥ 20 m** (device-or-environment — re-tag from "FP4", which delivered 10 m) **with the onboarding session uploaded**. Validates the flat-20 m startup gate (TEST-FIRST, still owed), calibrates A4 `gps_degraded` (`DEGRADED_ACCURACY_M`/`_SUSTAIN_MS` from a real histogram), sets the E1/E2/E3 overshoot gates at realistic accuracy. |
| P0-2 | **B1/B2 codec / AudioTrack 5001 path** | Build **apk 34** (audio-simple 0.3.5 + B1 diag — 0.3.5 is now cleanly reinstalled) → F5121 desk soak until a `5001` fires *with diag* → decide **B2b** (reactive AudioTrack relief, small surface) vs **B2a** (structural pooling) → clean soak + one clean fleet field day → *then* Howler retirement. |
| P0-3 | **Chunked media downloader field-validation** | The 2026-06-12 rewrite is still **un-exercised** (apk-33 pack was pre-loaded). Needs one real in-field pack download producing `media_pack_loaded.ms` + visible `.part` resume; confirm `media_download_partial` is gone for the big `Alex_secours` file. |
| P0-4 | **VILLEURBANNE (or equivalent) field pass** | Device set + success criteria already specified in `mobile-audit.md`. Also banks the **Round-A** validations shipped-but-unverified: A1 (vibrate only on walker-visible recovery), A2 (no `gps_startup_rejected` after `session_start`), A3 (telemetry spill survives offline + re-arm), A4 (`gps_degraded` counts). |

### P1 — new, low-risk, no field dependency (ship alongside)

| # | Item | Tag |
|---|---|---|
| P1-S1 | Anonymous `.json` traversal fix (`GET /edit/:file/json`: add auth + basename guard) | SAFE-TODAY |
| P1-S1b | Apply the basename guard uniformly to the auth-gated parcours/media handlers | SAFE-TODAY |
| P1-V1 | Plugin-version build gate — prevents another 0.3.4/0.3.5 skew | SAFE-TODAY |
| P1-S2 | Ingest quota / free-space guard / retention | TEST-FIRST, low urgency |
| P1-W1 | Document (or unify) the 20 m-startup vs 30 m-trigger split | low (fold into T4) |

### P2 — new, DEFERRED tech-debt workstream "T" (explicitly *after* the field test)

T4 (magic-number centralization) first — it directly supports the P0-1 calibration round — then
T2 (keepalive single-source-of-truth), T3 (server.js split), T5 (backend-selection), T1 (residual
motion scaffolding). None of these touch native behaviour or the field-test path.

---

## §4 — Explicitly NOT doing / unchanged

- **No new native scope before the next field test** — the doc's standing discipline holds. P1/P2
  here are webapp/server/build only; nothing reopens native behaviour.
- **FGS-geofencing** is a Play Console **declaration** check (verify it reads "continuous tracking"),
  not a code change — the D2 rail is already FGS-free (§1).
- **Howler retirement** stays gated on the B-round clean field day.
- The native audit's specific line-numbered Java snippets (a D1 "reborn-process" race, an ExoPlayer
  fade/release race) are **flagged for source review, not asserted as bugs** — the D1
  reborn-*headless* path is already handled (`mobile-audit.md` 2026-06-10 #1), and the rest need
  confirmation before any change. Not scheduled.

---

## §5 — Provenance of claims in this document

Verified at: geoloc.js:16-33 / 509 / 658 / 714-746 / 979; pages.js:3458 / 3680 / 3889 / 3985;
parcours.js:960-967; server.js:1040-1043 / 1146-1541 / 1233-1271 / 364 / 329 / 905;
`cordova-background-geolocation-plugin/.../GeofenceRailReceiver.java` + `RawLocationProvider.java`
(GeofencingClient/PendingIntent, no FGS); `.../MAURRawLocationProvider.m:694-720` (minimal motion
path); fork `package.json` × 4 + `config.xml` (version coherence). Cross-checked against
`mobile-audit.md` (Status Overview, 2026-06-10 / 06-11 / 06-12 / 06-15 addenda, Phase plan, Priority
items). See [mobile-audit.md](mobile-audit.md) for the full operational history.
