# Mobile Audit Remediation Plan

Date: 2026-03-14 (updated with code audit merge)
Last reviewed against code: 2026-04-03
Scope: Cordova launcher + downloaded local webapp, GPS-triggered audio walk, locked-screen pocket usage, published parcours FLANERIE_ELYSEE
Plugin: [`cordova-background-geolocation-plugin`](https://github.com/HaylLtd/cordova-background-geolocation-plugin) v2.3.2 (HaylLtd fork of mauron85)

## Status Snapshot (2026-04-03)

Verified in code:

- P0.1 ✅ IMPLEMENTED (pending field test): restart churn removed, explicit lifecycle policy applied, plugin config audited against HaylLtd docs.
- P0.2 remains intentionally bypassed (`return PAGE('sas')` in `PAGES['checkbackground']`).
- P0.3 ✅ IMPLEMENTED (pending field test): notification permission uses `requestPermission()` with 20s timeout + telemetry.
- P1.5 (listener/timer stacking) remains fixed.
- P1.5b (accuracy > 30m gate) remains fixed.
- P1.6 (media failure split: `nodata` vs `nomedia` + retry) remains fixed.
- P1.9a/b/c trivial fixes remain applied.
- P2.10 telemetry backend + client pipeline is implemented and active. Coverage expanded (lifecycle events, notification events) but still partial versus the full target list.

Immediate implication:

- P0.1 and P0.3 are implemented but **must be field-tested** with real locked-screen pocket walks before deployment. The highest remaining risk is untested behavior on real devices.

## Field Safety Legend

Each item is tagged with a field-safety level:

- **[SAFE-TODAY]** — Low risk of regression. Can be applied before a show with minimal testing.
- **[TEST-FIRST]** — Behavioral change that requires real-device validation before production use.
- **[RESEARCH-FIRST]** — Needs investigation/prototyping. Do not deploy without dedicated field test session.

## Operational Context

The app is not a generic tourist guide. It is a guided solo audio walk with these constraints:

- the visitor is welcomed by the team at a starting point and a specific hour
- visitors are sent alone, one by one, usually every 5 minutes
- the walk is mostly sequential and contextual
- media is expected to be fully preloaded before the walk starts
- once started, the experience should keep working without mobile data
- the phone is expected to stay locked and in the pocket for long periods

This context changes the audit priorities:

- background GPS continuity and audio continuity matter more than most UI concerns
- startup checks should be light and robust, not clever
- notification behavior should be judged primarily by whether it helps keep the app alive while locked
- some weak client-side mechanisms are acceptable if they match the operational use case

## Main Goal

Stabilize the real field experience on a wide range of devices, with focus on:

- keeping precise enough GPS alive while the phone is locked in pocket
- keeping audio playback alive and synchronized with route progression
- avoiding dead ends during startup or during the walk
- improving telemetry so real-world failures can be observed instead of guessed

## Priority Order

### P0: Production blockers

#### P0.1 Geolocation lifecycle and anti-sleep strategy [RESEARCH-FIRST]

Current understanding:
- This logic was introduced to prevent devices from sleeping, killing audio, or downgrading GPS when the walker stops.
- The current `stationary -> stop()` and `stop -> start()` pattern is probably too aggressive and may be the wrong mechanism.

Why this remains P0:
- In this product, people stop often by design.
- If stopping causes the OS/plugin to downgrade or restart tracking, triggers can be delayed, skipped, or repeated.
- Any fix here must preserve the original intent: keep the app alive while locked, not just simplify the code.

Plan:
- Audit the exact reason this code was introduced before removing it.
- Replace restart loops with a more explicit lifecycle strategy: foreground, background, stationary, recovery.
- Prefer a controlled “stay running” policy over reactive stop/start churn.
- Re-test with the locked-screen-in-pocket usage pattern, not only active walking.

Regression risk: **HIGH**. This is the core of locked-screen survival. A bad change here can silently break the entire walk experience. Must be validated with real locked-phone pocket walks on both platforms. Do not deploy to a show without at least one full parcours test per platform.

Files:
- `www/app/assets/geoloc.js`

Acceptance:
- Standing still for a while must not silently break later triggers.
- Locking the phone must not cause restart churn.
- The app should recover cleanly from transient GPS pauses without forcing a full route failure.

#### P0.2 Background validation UX [TEST-FIRST]

Current understanding:
- The current background test is legacy and messy.
- It should not be expanded into a heavy flow.
- Currently bypassed (`return PAGE('sas')` at the top of the handler).

Decision:
- Keep it bypassed unless a reliable lightweight alternative is found.
- Prefer a robust, UI-light alternative.

Recommended direction:
- Do not rely on a fake “test succeeded” flow.
- Either keep the step bypassed, or replace it with a very short operational checklist:
	- location set correctly
	- battery saver disabled if needed
	- notifications allowed when required by platform strategy
	- one short “lock now, continue if audio resumes” prompt only if it proves reliable

Files:
- `www/app/pages.js`

Regression risk: **LOW** (currently bypassed). Touching it only matters if re-enabling or replacing. No risk if left as-is.

Acceptance:
- Startup flow stays short.
- No false confidence from a flaky background test.
- Team instructions remain simple for visitors.

#### P0.3 Notification strategy for locked-screen survival [TEST-FIRST] ✅ IMPLEMENTED

Implemented 2026-04-03.

What was done:
- **`requestPermission()` now called:** `PAGES['checknotifications']` uses `cordova.plugins.permissions.requestPermission(POST_NOTIFICATIONS)` to trigger the actual Android 13+ system dialog. Previously only checked status in a loop (never showed the dialog).
- **Deterministic timeout:** 20-second total timeout on the permission flow. If denied or timed out, the app proceeds anyway (notifications are supplementary, not blocking).
- **Three outcome paths:** granted → proceed, denied → proceed with warning telemetry, timeout → proceed with timeout telemetry, error → proceed with error telemetry.
- **All outcomes emit `notif_permission` telemetry** with the result status.
- **`scheduleWakeupNotification()` telemetry:** logs `notif_schedule` event when the notification plugin is missing.

Permission flow (Android 13+):
1. Check `POST_NOTIFICATIONS` status
2. If not granted → call `requestPermission()` (system dialog)
3. If denied after request → poll every 1.5s (user may grant via settings)
4. Total timeout: 20s → proceed regardless
5. On older Android / iOS: check passes immediately (POST_NOTIFICATIONS not required)

Regression risk: **MEDIUM**. The permission flow now always terminates. Test on Android 13+ (fresh install, grant, deny) and at least one older Android.

Files:
- `www/app/pages.js`

Acceptance:
- Android 13+ users cannot get stuck in the permission flow.
- Notification-based keepalive behavior is observable in logs/telemetry.
- The app remains quiet enough for the experience while still improving survivability.

#### P0.4 Plugin guards [SAFE-TODAY]

Priority note:
- Lower priority than the three items above.
- Still worth doing opportunistically whenever those files are touched.

Plan:
- Harden plugin detection where code is already being modified.
- Avoid a dedicated cleanup pass until P0.1 and P0.3 are stabilized.

Regression risk: **LOW**. Adding defensive `typeof` checks around existing code paths cannot break working behavior. Only risk is accidentally wrapping the wrong code block.

Files:
- `www/app/pages.js`
- `www/app/assets/player.js`
- `www/app/assets/geoloc.js`

### P1: Correctness and stability

#### P1.5 Listener accumulation and timing cleanup [TEST-FIRST] — Partial ✅

Partially implemented 2026-03-14.

What was done:
- **GEO.on('position') stacking fixed:** `parcours.js` `build()` now calls `GEO.removeAllListeners('position')` before re-attaching the listener. Prevents duplicate position handlers on restore + reload.
- **CHECKGEO interval stacking fixed:** `pages.js` `checkgeo` now calls `clearInterval(CHECKGEO)` before setting a new interval. Prevents multiple GPS icon updaters running in parallel.
- **checkGeo() timeout:** confirmed harmless — it self-terminates on success (`clearTimeout` + `PAGE('confirmgeo')`). Added `recheck = null` after clear for hygiene.

What was NOT done (deferred):
- `allSteps` cleanup on parcours rebuild — minor issue since parcours don't change during the walk.
- Full timer/listener audit across all pages — deferred until P0 lifecycle work.

Files changed:
- `www/app/assets/parcours.js` — `removeAllListeners('position')` before `on('position')` in `build()`
- `www/app/pages.js` — `clearInterval(CHECKGEO)` before re-setting; `recheck = null` on success

Acceptance:
- One GPS event produces one logical route update.
- Repeated pre-start tests do not degrade behavior.

#### P1.5b GPS accuracy filtering [TEST-FIRST] ✅ DONE

Implemented 2026-03-14.

What was done:
- Added a 30m accuracy gate in `_callbackPosition()` in `geoloc.js`.
- Positions with `accuracy > 30` are rejected for step triggering (`emit('position')` is skipped).
- Rejected positions are logged with `console.warn` showing the accuracy value.
- Map following and polyline tracking still use bad-accuracy positions (placed before the gate).
- `lastPosition` and `lastTimeUpdate` are still updated on bad fixes, so GPS-lost detection is not affected.
- Simulated positions (`position.simulate`) bypass the filter.

Design notes:
- Conservative threshold: 30m. This is loose enough to work in most urban environments but tight enough to prevent 80-100m GPS drift from corrupting step transitions.
- Soft approach: map display uses all positions, only step triggering is gated.

Files changed:
- `www/app/assets/geoloc.js` — accuracy filter in `_callbackPosition()`

#### P1.5c GPS "lost" timeout tuning [RESEARCH-FIRST]

Current state:
```js
GEO.stateUpdateTimeout = (PLATFORM == 'android') ? 10 * 1000 : 5 * 60 * 1000;
```

Context:
- The 5-minute iOS timeout was introduced as a workaround for a specific iOS behavior: when the user is stationary, iOS aggressively downgrades GPS accuracy and may stop providing frequent updates. With a short timeout, this was interpreted as "GPS lost" and the lost-audio cue played on every stationary moment — which ruined the experience.
- On Android, 10 seconds is appropriate because BackgroundGeolocation provides more regular updates even when stationary.

Problem:
- 5 minutes is too long for a walking parcours. A visitor can walk past multiple steps for 5 minutes with no audio and no warning.
- The real fix is not to tune the timeout alone, but to distinguish "iOS reduced accuracy while stationary" from "actual GPS signal loss".

Plan:
- Investigate whether accuracy metadata from iOS position updates can distinguish stationary-downgrade from real loss.
- Consider a tiered approach: warn at 30-60s, escalate at 2-3 min.
- This is tightly coupled with P0.1 lifecycle work — the stationary handling affects what iOS reports.
- Do not change the timeout value without real-device iOS testing in stationary conditions.

Regression risk: **HIGH**. Shortening the iOS timeout without understanding the original bug will re-introduce the "GPS lost" audio playing every time the visitor pauses. This was already a known field problem.

Files:
- `www/app/pages.js`

Acceptance:
- iOS visitors who stop walking for 30-60 seconds do not hear a false "GPS lost" cue.
- iOS visitors who genuinely lose GPS for 2+ minutes get notified.
- Android behavior unchanged.

#### P1.6 Media failure reporting and recovery [SAFE-TODAY] ✅ DONE

Implemented 2026-03-14.

What was done:
- **Fixed bug:** `PAGES['preload']` had no `.catch()` handler — if parcours JSON load failed, the app hung on "Vérification..." forever. Now catches the error, logs it, and falls back to `nodata` page (auto-retry).
- **Separated error paths:** media download failures (`loadmedia()` rejection) now route to the existing but previously unused `nomedia` page instead of `nodata`. This distinguishes "server unreachable / no route data" from "media download failed".
- **Added retry:** `nomedia` page now has a "Réessayer" button that re-attempts the media download (`PAGE('load', true)`).
- **Added logging:** both failure paths now log the error with `console.error()` for diagnostics.

Error path summary after fix:
| Failure | Page shown | Recovery |
|---------|-----------|----------|
| Server/network unreachable | `nodata` | Auto-retry every 2s |
| Parcours JSON load failed | `nodata` | Auto-retry every 2s |
| No parcours available | `noparcours` | Manual (link to website) |
| Media list or file download failed | `nomedia` | Manual retry button |

Note on offline map tiles:
- Map tile caching remains disabled (`// cacheLayer(BASE, _options)` in `map.js`).
- If a visitor has no data during the walk, the "Je suis perdu.e !" map will show no basemap tiles.
- Kept as future enhancement — not in scope for this fix.

Files changed:
- `www/app/pages.js` — added `.catch()` to preload, changed load catch to `nomedia`, added `PAGES['nomedia']`
- `www/app/app.html` — updated `nomedia` div with retry button

#### P1.7 Resume/version-safe local state [TEST-FIRST]

Priority note:
- Low priority for now.
- Keep on the roadmap, but do not front-load it ahead of lifecycle reliability.

Plan:
- Defer until after P0 and P1.6 unless field evidence shows stale resume problems.

Regression risk: **MEDIUM**. Changing serialization format breaks existing stored parcours. Any change needs a migration path or explicit `clearStore()` on version bump.

#### P1.8 Step progression logic audit [RESEARCH-FIRST]

Priority note:
- Audit first, do not change logic yet.

Known issue — inverted optional logic:
- In `spot.js` line 495: `!(s._spot.optional === false)` filters for steps where optional is NOT false (i.e., optional or undefined) and names the result `mandatory`. The logic is inverted.
- In FLANERIE_ELYSEE, all steps have `"optional": false`, so the filter always returns an empty array and the bug has zero effect.
- This would break immediately if any parcours uses optional steps.

Plan:
- Review the current optional/mandatory sequencing logic with FLANERIE_ELYSEE as reference.
- Produce a route-specific risk note before touching the code.
- Only then decide whether a logic fix is needed.

Regression risk: **HIGH if changed**. The step sequencing is the core of the artistic experience. Changing the logic, even to fix a "bug", could alter when steps fire on existing parcours. Must be validated with a full walk-through before deployment. Currently dormant on all published parcours — safe to leave as-is for now.

Files:
- `www/app/assets/spot.js`
- `parcours/flanerie_elysee_v5.json`

### P2: Supportability and observability

#### P2.9 Public endpoint exposure [SAFE-TODAY]

Priority note:
- Low priority.
- Leave for later unless it conflicts with other work.

Regression risk: **NONE** if deferred.

#### P2.10 Telemetry and operational diagnostics [TEST-FIRST] 🟨 PARTIAL

Priority note:
- High value.
- This should become more than crash logging.

Goal:
- Capture real usage and minor issues, not only fatal errors.

Current implementation status:
- ✅ Implemented: telemetry client (`telemetry.js`), local buffering/flush/retry, session resume, server ingestion (`/telemetry-push`), session storage, admin listing endpoints.
- ✅ Implemented events: session start/resume/end, GPS stream, GPS state (`ok/lost/off`), step fire, step done.
- ⚠️ Missing/partial: permission-state snapshots, notification scheduling/permission diagnostics, background/foreground transition logs, explicit media preload success/failure telemetry, audio failure/focus lifecycle telemetry, offlimit enter/exit telemetry.

Recommended telemetry scope:
- app start
- route selected / route started / route ended
- current parcours ID and app version
- permission states at startup
- background/foreground transitions
- GPS lost / GPS recovered
- unusually long periods without location updates
- step entered / step fired / step done
- offlimit entered / exited
- audio play failures
- repeated resume overlays or audio focus losses
- notification scheduling failures or missing permission state
- media preload success/failure and size

Recommended design:
- separate crash/error logs from behavioral telemetry
- batch locally and upload later if network is unavailable
- include enough context for diagnosis, but keep payload light
- make the endpoint configurable by environment

Files:
- `www/app/app.html`
- `www/app/assets/common.js`
- `www/app/pages.js`
- `www/app/assets/geoloc.js`
- `www/app/assets/player.js`
- `server.js`

Acceptance:
- Support can answer: what happened, when, on which route, and whether the failure was GPS, audio, permissions, or route logic.

#### P2.11 SAS waiting buffer [SAFE-TODAY]

Decision:
- No security redesign needed.
- The current client-side mechanism is acceptable because it is only a lightweight waiting buffer to stop walkers from starting on their own.

Plan:
- Document it as intentionally low security.
- Only revisit if the operational process changes.

Regression risk: **NONE** if left as-is.

## Recommended Execution Sequence

Phase 0 — Core lifecycle first (needs dedicated field testing)
- P0.1 geolocation lifecycle and anti-sleep strategy
- P0.3 notification strategy and permission flow
- P1.5c GPS lost timeout tuning (research, coupled with P0.1)

Phase 1 — Safe hardening in touched files
- P0.4 plugin guards (opportunistic, low-risk)

Phase 2 — UX and logic (test with full walk-through)
- P0.2 replace or simplify legacy background validation
- P1.8 step progression audit on FLANERIE_ELYSEE

Phase 3 — Observability completion
- P2.10 telemetry and usage diagnostics

Later
- P1.7 resume/version safety
- P2.9 public endpoint exposure review

## Validation Matrix

Run after P0 work and again before release:

### GPS and lifecycle
- Android 13+ fresh install: grant/deny location and notifications in different orders
- Android device with battery saver enabled
- Android device left stationary for several minutes mid-walk
- iPhone with location set to `While Using` then changed to `Always`
- iPhone left stationary: verify no false "GPS lost" audio cue
- lock phone during parcours and keep it in pocket for extended time
- resume after accidental app foreground/background transitions

### Audio
- audio continues playing after screen lock on both platforms
- audio resumes correctly after phone call interruption (AudioFocus loss/gain)
- step transition triggers correct audio (voice plays, not afterplay, on first entry)
- audio from previous step stops cleanly when entering next step zone

### Data and startup
- start route with no data link after media preload
- repeat pre-start testing on the same device before sending a visitor
- reload app mid-parcours and verify resume from correct step
- verify "Je suis perdu.e !" button shows a useful map (or graceful fallback if offline)

### Plugin resilience
- simulate missing plugin build for audio focus or notifications where possible

## FLANERIE_ELYSEE-Specific Audit To Keep Separate

- Verify every referenced step folder exists under `media/flanerie_elysee_v5/`
- Verify every referenced media file exists in its corresponding folder
- Walk through published step order manually
- Review optional-step behavior before changing sequencing logic (all steps are `optional: false` — the inverted logic bug is dormant)
- Review end-of-route cutoff behavior: `cutoff: 7` means GPS tracking stops 7 seconds after last step fires — verify this is long enough for the last audio block
- Check for polygon overlaps between adjacent steps (BLOC_07→08, BLOC_08→09 are very close) — verify no double-trigger in practice
- Verify the "Je suis perdu.e !" map works when offline (tile cache is currently disabled)

## Known Dormant Bugs

These issues exist in the code but do not manifest on FLANERIE_ELYSEE or current usage. They should be tracked and fixed before conditions change.

### Double "done" emission in PlayerStep
- Both `voice.on('end')` and `music.on('end')` independently trigger `state = 'afterplay'` and `emit('done')`.
- If a step ever has both voice AND music sources, `done` fires twice — potentially double-advancing the step or double-starting afterplay.
- FLANERIE_ELYSEE uses voice-only (`music.src = "-"`), so this is dormant.
- **Fix before any parcours uses music tracks.**
- File: `www/app/assets/player.js` lines ~397-410

### iOS html5 audio mode seek/fade limitations
- All Howl players use `html5: true` on iOS. Howler.js html5 mode has known issues with `seek()` and `fade()` reliability.
- The `rewindOnPause(3000)` feature does `seek(seek() - 3)` — may silently fail on iOS, meaning no rewind happens on pause/resume.
- Visible as a jarring audio jump on resume instead of a smooth 3-second rewind.
- No easy fix without testing alternative approaches (WebAudio mode has its own background issues on iOS).
- File: `www/app/assets/player.js`

### Dual silent players in parcours page
- Both `SILENT_PLAYER` (PlayerSimple) and a `testplayer` (Howl) play `flanerie.mp3` simultaneously.
- Two concurrent audio streams to keep AudioContext alive. Wastes resources.
- iOS WebView has a limit of ~16 simultaneous audio sources. Not a problem today but compounds with stale players from incomplete cleanup.
- File: `www/app/pages.js` lines ~602-622

### `delete variable` no-op ✅ FIXED
- `delete testplayer` replaced with `testplayer = null` in `pages.js` (two occurrences). Fixed in P1.9c.
- File: `www/app/pages.js`

### Console.log HTML injection in dev panel
- `console.log` override appends to `$('#logs')` with `.append(message + '<br/>')` without HTML escaping.
- Log messages containing angle brackets will be interpreted as HTML.
- Dev-only panel, not user-facing. Low risk but worth noting.
- File: `www/app/assets/common.js`

## Trivial Code Fixes [SAFE-TODAY] ✅ DONE

All applied 2026-03-14. Zero behavioral risk — each fixes already-broken or never-called code.

### P1.9a `setCoords()` ignores its parameter ✅
- Fixed: `setCoords()` → `setCoords(coords)` in `parcours.js`.
- Was never called from app code, so no behavioral change.

### P1.9b `checkBGPosition()` wrong `this` context ✅
- Fixed: `this.lastPosition` → `GEO.lastPosition` in standalone function `checkBGPosition()` in `geoloc.js`.
- Previously always resolved `undefined` since `this` was not the GeoLoc instance.

### P1.9c `delete testplayer` cleanup ✅
- Replaced `delete testplayer` with `testplayer = null` in `pages.js` (two occurrences).
- `delete` on a variable is a no-op in JavaScript; `= null` actually releases the reference.

## Deliverables

1. P0 code fixes centered on locked-screen GPS/audio survival
2. A lean regression checklist for Cordova field devices
3. A telemetry plan for real usage, minor incidents, GPS loss, and odd audio behavior
4. A separate FLANERIE_ELYSEE sequencing audit before any route-logic change

## Suggested First Implementation Ticket — ✅ COMPLETED (code)

Title: Replace restart-churn geolocation lifecycle with deterministic locked-screen strategy

All code changes implemented 2026-04-03:
- ✅ removed `stationary -> stop()` and `stop -> start()` loop from BackgroundGeolocation flow
- ✅ defined explicit lifecycle policy for foreground/background/stationary/recovery
- ✅ made Android notification permission path deterministic (requestPermission + 20s timeout)
- ✅ added telemetry events for lifecycle transitions and notification permission/scheduling outcomes
- ✅ audited plugin config against HaylLtd v2.3.2 API docs / source code
- ✅ removed dead `stopDetection` config option
- ⬜ **REMAINING: execute one full locked-screen pocket walk per platform and attach logs**

## Suggested Next Implementation Ticket

Title: Field validation of locked-screen lifecycle changes

Includes:
- one full locked-screen pocket walk on Android 13+ (fresh install, grant all permissions)
- one full locked-screen pocket walk on Android with notification denied
- one full locked-screen pocket walk on iOS
- verify telemetry events arrive: `bg_geo_start`, `bg_geo_stop`, `app_visibility`, `notif_permission`
- verify no restart churn in logs (no repeated start/stop cycles)
- verify GPS continues after 5+ minute stationary listening sessions
- verify step triggers work correctly after stationary periods
- attach session telemetry logs to this ticket

Excludes:
- sequencing logic changes
- SAS redesign
- full security/passive exposure review
- full resume/version-safety redesign
- major UI flow redesign
