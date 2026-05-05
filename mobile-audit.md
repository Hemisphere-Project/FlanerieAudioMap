# Mobile Audit Remediation Plan

Date: 2026-04-27 (merged with full code review of www/app/)
Cordova cross-reference: 2026-05-05 (FlanerieCordova workspace added)
Telemetry analysis: 2026-04-27 (78 sessions across 5 parcours, Apr 2026)
Previous: 2026-03-14 (initial code audit merge)
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

Items added from the 2026-04-27 code review are marked with 🆕.
Items enriched with additional code-level detail are marked with 📎.

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

## Architecture Summary

Key files:
- `www/app/pages.js` — 25+ page state machine (entry point, ~1000 lines)
- `www/app/assets/geoloc.js` — GPS tracking via BackgroundGeolocation plugin + browser fallback
- `www/app/assets/player.js` — Audio engine: PlayerSimple (single track) + PlayerStep (5-channel step player)
- `www/app/assets/spot.js` — Geofence detection: Zone (ambient/object audio), Offlimit, Step (sequential waypoints)
- `www/app/assets/parcours.js` — Parcours data model, media download, state persistence (localStorage)
- `www/app/assets/map.js` — Leaflet map with offline tile support (currently disabled)
- `www/app/assets/telemetry.js` — Event logging, session tracking, beacon-based flush
- `www/app/assets/common.js` — EventEmitter base class, geo_distance(), HTTP helpers

Libraries: Howler.js 2.2.4, Leaflet 1.9.4, NoSleep.js, jQuery 3.7.1

Keepalive stack (all active during parcours):
1. `SILENT_PLAYER` — looped silent mp3 via PlayerSimple/Howler
2. Dummy `testplayer` — second looped silent Howl (redundant, see Known Dormant Bugs)
3. NoSleep.js — Wake Lock API / silent video hack
4. Local notifications — every 59s, wake JS context on locked screen
5. BackgroundGeolocation — native foreground service (Android) / significant location changes (iOS)

Audio channel model per step (PlayerStep class):
- `voice` — narration, rewind 3s on pause
- `music` — background music, rewind 3s on pause
- `ambiant` — loop, continues during afterplay
- `offlimit` — plays when user crosses step boundary
- `afterplay` — loop after voice/music end

Page flow:
```
title → intro → checkdata → select → preload → confirmload → load
→ checkgeo → confirmgeo → startgeo → [confirmios|checknotifications]
→ rdv → checkaudio → checkbattery → [checkbackground (bypassed)] → sas
→ parcours → end
```

## Priority Order

### P0: Production blockers

#### P0.1 Geolocation lifecycle and anti-sleep strategy [RESEARCH-FIRST] 📎

Current understanding:
- This logic was introduced to prevent devices from sleeping, killing audio, or downgrading GPS when the walker stops.
- The current `stationary -> stop()` and `stop -> start()` pattern is probably too aggressive and may be the wrong mechanism.

Why this remains P0:
- In this product, people stop often by design.
- If stopping causes the OS/plugin to downgrade or restart tracking, triggers can be delayed, skipped, or repeated.
- Any fix here must preserve the original intent: keep the app alive while locked, not just simplify the code.

Telemetry evidence (Apr 2026, 78 sessions):
- `gps_state: lost` occurs 216 times vs 239 `ok` across all sessions — GPS signal is broken ~47% of the time.
- This is consistent with the restart gap in the stationary handler advancing `Date.now()` past the 10s Android timeout, triggering false GPS-lost alerts mid-walk.
- Multiple GIVORS_V3 sessions show GPS lost oscillation (ok → lost → ok in rapid succession) with simultaneous step re-fires, confirming the two issues are coupled.

Code-level detail (from 2026-04-27 code review):
- The cycle is at `geoloc.js` lines ~490-515: `on('stationary')` calls `BackgroundGeolocation.stop()`, then `on('stop')` calls `BackgroundGeolocation.start()`.
- During the restart gap, `lastTimeUpdate` stops advancing. The `stateUpdateTimer` (1s interval in GeoLoc constructor, line ~112) checks `lastTimeUpdate + timeout < Date.now()` — any restart gap counts against the timeout.
- On Android (10s timeout), a restart gap of 10+ seconds triggers a false GPS-lost alert with `GPSLOST_PLAYER` audio — actively disrupting the experience.
- The plugin is configured with `RAW_PROVIDER`, `distanceFilter: 0`, and `stopDetection: false` — this combination should already prevent the plugin from going stationary. The explicit stationary handler may be fighting the plugin's own behavior.
- The `on('background')` and `on('foreground')` handlers correctly track `APP_VISIBILITY` and dispatch `pause`/`resume` events. These are clean and should be preserved.

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

#### P0.1b AudioContext resume on foreground 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-04-27.

What was done:
- Added a shared `resumeAudioContext()` helper in `geoloc.js` that exits early when the context is already running and safely resumes otherwise.
- Added direct `resumeAudioContext('foreground')` handling in the `BackgroundGeolocation.on('foreground')` lifecycle callback, before dispatching the generic `resume` event.
- Kept `resumeAudioContext('resume')` in the document `resume` handler so both plugin-driven and document-driven foreground paths recover audio.
- Added `resumeAudioContext('position')` in `_callbackPosition()` as defense-in-depth, so the next GPS tick also repairs a suspended AudioContext.
- Added `audio_context_state` telemetry logging and bound `Howler.ctx.onstatechange` so AudioContext suspensions and recoveries are observable instead of inferred.

Why this matters:
- On iOS, Howler can report players as still "playing" while the underlying AudioContext is suspended by the OS. This fix adds explicit recovery on both foreground and next-position paths.

Regression risk: **LOW**. Calling `resume()` on an already-running context remains a no-op.

Files changed:
- `www/app/assets/geoloc.js`

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

#### P0.3 Notification strategy for locked-screen survival [TEST-FIRST] 📎 — Partial ✅

Partially implemented 2026-04-27.

What was done:
- `scheduleWakeupNotification()` now uses a single module-level timer (`NOTIF_TIMER`) and clears it before scheduling the next wakeup, preventing duplicate recursive chains.
- Leaving the `parcours` page now clears both the JS timer and the pending wakeup notification ID, so keepalive scheduling no longer survives page exit.
- The Android 13+ notification permission page now uses a bounded retry loop (`NOTIF_PERMISSION_MAX_ATTEMPTS`) instead of unbounded recursion.
- The permission step is now intentionally non-bypassable: after the retry budget is exhausted, the user must go to settings and explicitly re-check permission with the "J'ai autorisé" action. This preserves the operational assumption that background mode depends on notification permission.

Code-level detail (from 2026-04-27 code review):
- **Scheduling leak:** fixed by `NOTIF_TIMER`, `clearWakeupNotification()`, and a `currentPage !== 'parcours'` guard before re-scheduling.
- **Mitigating factor:** `NOTIF_COUNTER` (37) is a fixed ID, so only one notification is pending at a time in the OS queue. The leak wastes CPU scheduling but doesn't flood the notification tray.
- **Permission polling loop:** fixed by a bounded timer plus explicit re-check action after settings return. Users are no longer trapped in an invisible infinite loop, but they also cannot proceed without granting permission.

What remains:
- Clarify the exact role of local notifications on Android vs iOS keepalive behavior.
- Add telemetry around permission state checks and wakeup trigger timing, not only console logging.
- Validate the cadence on real Android devices to confirm the app stays alive quietly enough while locked.

Telemetry evidence (Apr 2026):
- Multiple GIVORS_V3 sessions show 8–15 `session_resume` events. The notification chain firing every ~59s is the most plausible driver: each chain instance pulls the JS context from the background, generating a resume event.
- The scheduling leak (multiple chains after page transitions) compounds with each restart, explaining why resume counts grow over time in long sessions.

Regression risk: **MEDIUM-HIGH**. The notification step now blocks startup by design until permission is granted. This matches the operational requirement, but it must be tested on Android 13+ and at least one older Android to confirm there is no false negative or plugin-specific permission mismatch.

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

#### P1.5c GPS "lost" timeout tuning [RESEARCH-FIRST] 📎

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

Code-level detail (from 2026-04-27 code review):
- The `stateUpdateTimer` is a 1-second `setInterval` in the `GeoLoc` constructor (`geoloc.js` line ~112). It compares `lastTimeUpdate + stateUpdateTimeout` against `Date.now()`.
- On iOS with `html5: true` Howler mode, the BackgroundGeolocation plugin reports locations less frequently when stationary (iOS significant-change behavior), which is what originally triggered the false "lost" detection.
- A tiered approach could use `position.coords.accuracy` degradation as a distinct signal: if accuracy degrades but timestamps are recent, it's "stationary downgrade" not "GPS loss". This would allow a shorter timeout for true loss while ignoring accuracy drops.
- The `_callbackPosition()` accuracy gate (P1.5b, >30m) already rejects bad fixes for step triggering but still updates `lastTimeUpdate` — so GPS-lost detection is not affected by the accuracy gate. This is correct and should be preserved.

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

#### P1.10 GPS lost recovery UX 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-05-05.

What was done:
- `navigator.vibrate([500, 200, 500])` on GPS loss, `navigator.vibrate([200])` on recovery. Silently skipped if vibration plugin absent (browser, test builds).
- `#gpslost-overlay` div shown on GPS loss, hidden on recovery. Message advises moving to an open area and confirms the walk resumes automatically when signal returns.
- "Continuer l'écoute sans GPS" force-resumes current step audio and stops the GPS-lost cue. Logs `gps_force_resume` telemetry. Step progression still requires GPS — this only unblocks audio while the visitor moves to recover signal. When GPS comes back, step detection resumes normally.
- `PAGES_CLEANUP['parcours']` extended to stop `GPSLOST_PLAYER` and hide `#gpslost-overlay` on any page transition away from `parcours`, so overlay never bleeds into pre/post walk pages.

Regression risk: **LOW**. Additive. Existing audio cue and auto-resume behavior unchanged.

Files changed:
- `www/app/app.html` — added `#gpslost-overlay` div
- `www/app/pages.js` — vibration + overlay in stateUpdate handler, `#gpslost-resume` wiring, extended parcours cleanup

Acceptance:
- Visitor gets tactile + audible feedback on GPS loss even with locked screen.
- Overlay is visible when foregrounding during GPS-lost state.
- "Reprendre quand même" unblocks the walk as an emergency exit.
- Auto-recovery (GPS returns) hides overlay and resumes without user action.

#### P1.11 Audio focus auto-resume 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-05-05.

What was done:
- `navigator.vibrate([300])` on `AUDIOFOCUS_LOSS` / `AUDIOFOCUS_LOSS_TRANSIENT` (call or other app takes focus).
- `navigator.vibrate([100])` on `AUDIOFOCUS_GAIN` (focus returned, audio resuming).
- **iOS proxy:** `cordova-plugin-audiofocus` is Android-only. On iOS, added `document.pause` → `pauseAllPlayers()` and `document.resume` → `resumeAllPlayers()` listeners inside `deviceready`, guarded by `PLATFORM === 'ios'`. Covers the common case where a phone call backgrounds the app. Mid-session calls that don't background the app (edge case, mostly iPad) require native `AVAudioSession` interruption handling in the plugin fork — deferred.
- Chime before resume: intentionally skipped — visitor knows they had a call, audio return is expected.
- `#resume-button` kept as manual fallback for edge cases where auto-resume fails.

Regression risk: **LOW**. Additive. Existing Android auto-resume behavior unchanged.

Files changed:
- `www/app/assets/player.js`

Remaining: ✅ COMPLETE (2026-05-05 — C1 plugin upgrade)
- iOS `AVAudioSessionInterruptionNotification` is now implemented in `src/ios/AudioFocus.m`. The plugin now fires `AUDIOFOCUS_LOSS`/`GAIN` on iOS for mid-session calls that do not background the app. The `document.pause`/`resume` proxy in `player.js` stays in place as a harmless second layer.
- Requires plugin reinstall to take effect in the build: `cordova plugin remove com.maigre.cordova.plugins.audiofocus && cordova plugin add /path/to/fork`.

#### P1.12 Android battery optimization guidance 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-05-05.

Design decision — blocking, not advisory:
- Battery optimization is the #1 cause of background GPS/audio death on Android. Letting a visitor proceed with it enabled is worse than blocking them at startup where the support team can intervene.
- The support team is present at walk start and can help or issue a backup phone. Blocking here is the right tradeoff.
- No false positives: `PowerManager.isIgnoringBatteryOptimizations()` is binary and reliable. If it says not whitelisted, that is true.

What was done:
- Added `checkbatteryopt` page inserted in the flow between `checknotifications` and `rdv` on Android.
- `checknotifications` now routes to `checkbatteryopt` on all Android paths (including API < 13 early-exit) instead of directly to `rdv`. Non-Android paths (iOS, browser) are unaffected.
- `checkbatteryopt` skips to `rdv` if: not Android, plugin absent, or API < 23 (Android 6).
- On first failed check, `RequestOptimizations()` is called immediately — this opens a native system dialog ("Autoriser Flanerie à ignorer les optimisations de batterie ?"), matching the permission request UX pattern. No manual settings navigation required.
- Auto-polling detects whitelist state every 1.5s (up to 10 polls / 15s). After timeout, "J'ai désactivé" retry + "Paramètres batterie" fallback buttons appear.
- OEM-specific restrictions detected via `HaveProtectedAppsCheck()` (no hardcoded manufacturer list). If positive, an advisory note + "Paramètres fabricant" button (`ProtectedAppCheck(true)`) are shown. This is non-blocking but surfaces the OEM layer that would otherwise be invisible.
- Telemetry: `battery_opt` event logged with `ignoring`, `manufacturer`, `apiLevel` on each check result, and a separate `blocked: true` log when max attempts are exhausted.
- DEVMODE bypasses the check.

Plugin dependency:
- **`snt1017/cordova-plugin-power-optimization` is confirmed present** in the Cordova project (`plugins/cordova-plugin-power-optimization/`, version 0.0.3). The Promise API (`IsIgnoringBatteryOptimizations`, `RequestOptimizations`, `HaveProtectedAppsCheck`, `ProtectedAppCheck`) and the required permissions (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, Huawei `USE_COMPONENT`) are all declared in `plugin.xml`. The feature is live on Android builds.

Regression risk: **MEDIUM** (new blocking page in the startup flow). Must be validated on Android 13+ and at least one older Android. Plugin absence is safe (check is skipped).

Files changed:
- `www/app/app.html` — added `checkbatteryopt` page div
- `www/app/pages.js` — `checkbatteryopt` handler, routed `checknotifications` Android exits to `checkbatteryopt`

Acceptance:
- Android users with battery optimization enabled cannot reach `rdv` until they whitelist the app.
- Android users who have already whitelisted pass through without friction.
- iOS and browser flows are unaffected.
- OEM devices show the advisory note without being falsely blocked.
- Telemetry captures battery opt state at startup.

#### P1.13 Page exit cleanup system 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-05-05.

What was done:
- Added `PAGES_CLEANUP` map alongside `PAGES`.
- `PAGE()` now calls `PAGES_CLEANUP[currentPage]()` (if registered) before any page transition, replacing the two hardcoded conditional calls that were previously inline.
- Migrated existing cleanup registrations:
  - `PAGES_CLEANUP['parcours']` → `clearWakeupNotification()`
  - `PAGES_CLEANUP['checknotifications']` → `clearNotificationPermissionCheck()`
  - `PAGES_CLEANUP['checkbatteryopt']` → `clearBatteryOptCheck()` (new, added for P1.12)
- The `CHECKGEO` interval (GPS icon status) was intentionally not added: it updates a persistent status bar element visible on all pages and stopping it mid-flow could leave the icon in a stale state during the walk. Left for a separate decision.

Regression risk: **LOW**. The behavior of the migrated cleanups is identical to the previous hardcoded calls. The pattern is additive — pages without a registered cleanup function are unaffected.

Files changed:
- `www/app/pages.js`

Acceptance:
- No wakeup notification chain survives leaving the parcours page.
- No notification permission poll survives leaving the checknotifications page.
- No battery opt poll survives leaving the checkbatteryopt page.
- Pattern is available for future pages with no boilerplate in `PAGE()`.

#### P1.14 Completed-step refire guard 🆕 [SAFE-TODAY] ✅ DONE

Implemented 2026-04-27.

What was done:
- `Step` in `spot.js` now keeps a `_done` guard and skips the generic fire path after `step_done` has already been emitted for that step.
- The guard is reset only when the walk progression moves back before that step index, preserving normal sequential behavior.
- Diagnostic telemetry `step_skip_done` was added to confirm when a completed step is being ignored rather than re-fired.

Telemetry evidence behind the fix:
- GIVORS_V3 sessions showed step 0 re-fired up to 18 times in a single session. Even discounting idle-in-zone sessions, real multi-step walks (for example `20260421_082915_w71j`) showed geographically spread re-fires consistent with GPS oscillation.

Regression risk: **LOW**. The guard only applies after `step_done`, so all normal walk-through behavior is unchanged.

Files changed:
- `www/app/assets/spot.js`

Acceptance:
- A completed step cannot re-fire regardless of GPS drift or idle device position.
- Telemetry no longer shows repeated `step_fire` events for steps that already emitted `step_done`.

#### P1.15 GIVORS_V3 last-step completion 🆕 [RESEARCH-FIRST]

Observation (telemetry, Apr 2026):
- In every GIVORS_V3 session where the walk progressed, the last fired step never emits `step_done` (100% non-completion rate for the terminal step across 25 sessions).
- Affected steps: `BLOC_12_Carla_amoureuse_NEEDS` (step 11), `BLOC_13_Alex_Secours` (step 12).
- FLANERIE_ELYSEE's final step (`BLOC_28_FIN_Porte_Elysee`) does complete correctly in 3 out of 4 full-walk sessions — this is V3-specific.

Likely cause:
- The final V3 steps may have no exit polygon (no zone to walk out of to trigger `done`), or their audio is an infinite afterplay loop with no `done` path.
- Could also be a `cutoff` value too short to allow `step_done` to emit before GPS tracking stops.

Status: **deferred** — parcours JSON files are not in the webapp repository. Investigation requires access to the Cordova app folder or the server-side parcours store. Will be revisited once the Cordova project is added to the workspace.

Regression risk: **NONE** (read-only investigation). Fix risk depends on what is found.

Files:
- `parcours/flanerie_givors_v3.json` (server-side, not in webapp repo)

Acceptance:
- The final step of GIVORS_V3 emits `step_done` during a real walk-through.

#### P1.16 PlayerStep double `done` emission 🆕 [TEST-FIRST] ✅ DONE

Implemented 2026-05-05. Fix was already present in code at time of audit review.

What was done:
- Both `voice.on('end')` and `music.on('end')` delegate to `startAfterplay()`.
- `startAfterplay()` checks `if (!this._doneFired)` before setting state and emitting `done`. Sets `_doneFired = true` on first call; subsequent calls are no-ops.
- `_doneFired` is reset to `false` in both `load()` and `clear()`, so each new step play-through starts clean.

Telemetry evidence behind the fix (Apr 2026):
- ELYSEE sessions: `step_done` fired twice on voice-only steps 0, 3, 10, 13, 24.
- GIVORS_V2 sessions: `step_done` fired up to 4× on individual steps.
- `music.src = "-"` does not prevent Howler from attaching and firing the `on('end')` handler.

Regression risk: **NONE** (guard already in place).

Files changed:
- `www/app/assets/player.js`

Acceptance:
- Each step emits `step_done` exactly once per play-through.
- Telemetry shows no `step_done` with count > 1 for the same step in the same fire cycle.

#### P1.17 Offlimit reentry resumes current step 🆕 [TEST-FIRST] ✅ DONE

Implemented and telemetry-validated 2026-04-27.

Problem that was observed:
- Leaving a dedicated/global offlimit paused the current step, but re-entering the step fell back into the generic step fire path.
- That produced `step_fire` again for the current step and restarted playback from the beginning instead of resuming from the paused position.

Telemetry evidence before the fix:
- In ELYSEE browser sessions, the sequence was:
	`global_offlimit_leave -> step_refire_current -> step_fire`
- This proved the step was not being unloaded; it was being rediscovered as a fresh trigger while still current.

What was done:
- `Step.updatePosition()` now detects the case “this step is already current and paused” and resumes it without emitting a new `fire` event.
- Step-local offlimit handling was moved ahead of the generic fire path so offlimit return is resolved before any trigger logic runs.
- `PlayerStep.isNarrating()` was added so step-local offlimit entry only happens during active narration, not later during `afterplay` far away from the zone.
- Global offlimit transitions are now logged explicitly.

Telemetry validation after the fix:
- Session `20260427_212800_kvbz` shows the corrected sequence:
	`step_fire(step 1) -> global_offlimit_enter -> global_offlimit_leave -> step_resume_current -> step_done(step 1) -> step_fire(step 2)`
- No `step_refire_current` and no duplicate `step_fire` are present for step 1 after offlimit leave.

Regression risk: **LOW**. The new branch only applies when the step is already current and paused.

Files changed:
- `www/app/assets/spot.js`
- `www/app/assets/player.js`
- `www/app/assets/parcours.js`

Acceptance:
- Returning from offlimit resumes the current step instead of restarting it.
- Reentry does not emit a duplicate `step_fire` for the same current step.
- Step progression continues normally to the next step after resume.

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

Implemented/extended on 2026-04-27:
- Added behavioral telemetry for `global_offlimit_enter` / `global_offlimit_leave`.
- Added step-lifecycle diagnostics for `step_resume_current`, `step_refire_current`, `step_active_unload`, and `step_skip_done`.
- Added explicit restart markers: `session_restart_click`, `session_restart`, and `session_restart_target`.
- `REARM` now forces a fresh telemetry session instead of appending to the previous one.
- `RESTART` now logs and cleanly ends the current session before reload, making the latest relevant test easy to locate.

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
- Test runs can be separated cleanly when staff use `REARM` or `RESTART` during debugging.

#### P2.11 SAS waiting buffer [SAFE-TODAY]

Decision:
- No security redesign needed.
- The current client-side mechanism is acceptable because it is only a lightweight waiting buffer to stop walkers from starting on their own.

Plan:
- Document it as intentionally low security.
- Only revisit if the operational process changes.

Regression risk: **NONE** if left as-is.

### P3: Platform-specific hardening 🆕

#### P3.1 iOS background audio entitlement 🆕 [RESEARCH-FIRST] ✅ VERIFIED DONE

Verified 2026-05-05 (Cordova project cross-reference).

`FlanerieCordova/config.xml` already declares `UIBackgroundModes` with all three required strings:
```xml
<config-file target="*-Info.plist" parent="UIBackgroundModes">
    <array>
        <string>location</string>
        <string>audio</string>
        <string>processing</string>
    </array>
</config-file>
```

The entitlement is present. iOS background audio will not be killed by the OS at the container level.

Remaining open question:
- Howler.js `html5: true` on iOS should use `AVAudioSession` category `playback` automatically. Whether this is the actual runtime category has not been logged. Adding a telemetry event on app start to confirm the AudioContext state and mode would close this.

Regression risk: **NONE** — entitlement already present.

Files:
- `FlanerieCordova/config.xml` (verified)

#### P3.2 iOS location permission progression 🆕 [TEST-FIRST]

Current state:
- `confirmgeo` page (`pages.js` lines ~280-330) goes straight to requesting "Always" authorization.
- iOS presents "Allow Once" → "While Using" first. iOS only shows the native permission prompt once — after that, the user must go to Settings manually.
- The `AUTHORIZED_FOREGROUND` catch in `checkAuthorized()` increments `retryAuth` and loops back, showing increasingly urgent settings instructions.

Problem:
- This can feel like a broken loop to the visitor. The app seems stuck asking for something the user already granted.

Plan:
- Accept `AUTHORIZED_FOREGROUND` as a valid starting state. Start GPS with foreground-only authorization.
- Show a calm explanation of why "Always" is better, with a Settings link.
- Only block if authorization is fully denied.
- This may interact with P0.1 lifecycle — background location may not work without "Always" on iOS.

Regression risk: **MEDIUM**. Changing permission flow affects first-launch experience. Test on fresh iOS install.

Files:
- `www/app/pages.js`
- `www/app/assets/geoloc.js`

#### P3.3 Android 14+ foreground service type 🆕 [RESEARCH-FIRST] ✅ VERIFIED DONE

Verified 2026-05-05 (Cordova project cross-reference).

Two independent declarations already cover this:

1. `FlanerieCordova/config.xml` line 47 declares the permission:
   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
   ```

2. The background geolocation plugin's own `plugin.xml` already declares the service type:
   ```xml
   <service android:name="com.marianhello.bgloc.service.LocationServiceImpl"
            android:foregroundServiceType="location" />
   ```

Both the manifest permission and the service declaration are already in place at v2.3.2. Android 14+ requirements are met.

Regression risk: **NONE** — already handled.

### C: Cordova container findings (cross-reference, 2026-05-05)

These items emerged from comparing FlanerieCordova against FlanerieAudioMap after the Cordova project was added to the workspace.

#### C1 Audiofocus plugin — deprecated API + wrong focus type ✅ DONE (2026-05-05)

Plugin upgraded to v1.2.0 in the `cordova-plugin-audiofocus` fork workspace. All four issues fixed.

**What was done:**

1. **`AUDIOFOCUS_GAIN_TRANSIENT` → `AUDIOFOCUS_GAIN`** (Android): one-line fix. The plugin now requests permanent focus, which is correct for a 45-minute walk. Transient focus signalled to the OS that we expected to give focus back "shortly".

2. **Modern `AudioFocusRequest` API** (Android 8+ / API 26+): `requestAudioFocus` now uses the `AudioFocusRequest` builder on API 26+, with the deprecated 3-argument call kept as fallback for API 23-25. `cancelFocus` uses `abandonAudioFocusRequest` on API 26+ and `abandonAudioFocus` below. The `AudioFocusRequest` object is stored as an instance variable so request and release are paired correctly.

3. **iOS `AVAudioSessionInterruptionNotification`** (new `src/ios/AudioFocus.m`): Objective-C implementation added.
   - `requestFocus`: sets `AVAudioSessionCategoryPlayback`, activates the session, registers for `AVAudioSessionInterruptionNotification`.
   - `cancelFocus`: removes observer, deactivates session with `NotifyOthersOnDeactivation`.
   - `onFocusChange`: stores the persistent callback (same keepCallback pattern as Android).
   - `handleInterruption:`: emits `AUDIOFOCUS_LOSS` on interruption begin, reactivates the session and emits `AUDIOFOCUS_GAIN` on interruption end. Handles the `ShouldResume` option.
   - This covers mid-session phone calls that do NOT background the app, which the old `document.pause`/`resume` proxy could not catch.

4. **Duplicate plugin identity removed**: `com.maigre.cordova.plugins.audiofocus` entry removed from `FlanerieCordova/package.json` cordova.plugins section. The single `cordova-plugin-audiofocus` key matches the devDependency name.

**Interaction with existing iOS proxy in `player.js`:**
The `document.pause`/`resume` proxy added in P1.11 remains in place as a fallback layer. Both will now fire on iOS call interruptions — `pauseAllPlayers`/`resumeAllPlayers` are idempotent so double calls are harmless. The overlay and vibration from the `AUDIOFOCUS_LOSS`/`GAIN` handler will now also appear on iOS (matching Android behavior).

**To apply to the Cordova build** (reinstall required for iOS platform to pick up the new source file):
```sh
cordova plugin remove com.maigre.cordova.plugins.audiofocus
cordova plugin add /path/to/cordova-plugin-audiofocus
```

Files changed:
- `cordova-plugin-audiofocus/src/android/AudioFocus.java`
- `cordova-plugin-audiofocus/src/ios/AudioFocus.m` (new)
- `cordova-plugin-audiofocus/plugin.xml`
- `cordova-plugin-audiofocus/package.json`
- `FlanerieCordova/plugins/com.maigre.cordova.plugins.audiofocus/` (synced)
- `FlanerieCordova/package.json` (duplicate plugin entry removed)

#### C2 Upgrade candidates (confirmed from Cordova project) [TEST-FIRST]

Confirmed installed versions after workspace cross-reference:

| Dependency | Installed | Recommended | Priority | Relevant app impact |
|---|---|---|---|---|
| `cordova-background-geolocation-plugin` | `2.3.2` | `2.3.3` | **HIGH** | Android 14 startup/onCreate fixes, Android 13 notification flow, activity recognition improvements, iOS 18 settings |
| `cordova-plugin-local-notification` | `1.2.0` | `1.2.3` | medium | Notification permission and restore/reboot behavior; affects keepalive |
| `cordova-android` | `14.0.1` | `15.0.0` | medium | Longer store-policy runway; do after plugin compatibility check |
| `cordova-ios` | `7.1.1` | `8.0.1` | medium | Xcode/iOS SDK compatibility; do after Xcode check |

The geolocation plugin upgrade is the highest-value item: v2.3.3 changelog entries directly address this app's locked-screen pocket use case on Android 13/14+.

Upgrade sequence: geolocation plugin first (standalone, testable in isolation) → local-notification → cordova-android (after plugin compat check) → cordova-ios.

Regression risk: **LOW** for plugin upgrades (minor version), **MEDIUM** for platform upgrades (potential Gradle/Xcode churn). Always build and smoke-test after each step.

#### C3 Launcher cache-buster regex [accepted, low priority]

`FlanerieCordova/www/apputils.js` line 307:
```js
text = text.replace(/\.js/g, '.js?' + hash);
text = text.replace(/\.css/g, '.css?' + hash);
```

This replaces every `.js` occurrence in app.html, including `.json` references if any `<script src="*.json">` ever appears. Currently safe — app.html has no JSON script tags. Would silently break JSON loads if the app.html structure changes.

Decision: accepted for now per the existing Cordova audit (F6). Track: if app.html ever gains a JSON import, this regex must become more targeted (`src="*.js"` attribute match only).

#### C4 Container validation path [open]

The Cordova project has no reproducible build checklist or smoke-test script (F5 in Cordova audit). Adding a minimal one — Android debug build succeeds, iOS prepare opens cleanly in Xcode — would reduce the risk of discovering a broken build the day before a show. Low urgency, high value before any platform upgrade (C2).

## Recommended Execution Sequence

Phase 0 — Safe fixes (can deploy before a show)
- P0.4 plugin guards (opportunistic, low-risk)
- P1.9a/b/c trivial code fixes ✅ DONE
- P1.9d dead code removal ✅ DONE
- P1.6 media failure reporting improvements ✅ DONE
- P1.12 Android battery optimization guidance ✅ DONE (plugin confirmed present in Cordova project)
- P1.14 completed-step refire guard ✅ DONE
- P1.15 GIVORS_V3 last-step investigation 🆕 (read-only, requires server-side JSON access — still deferred)
- C1 audiofocus plugin upgrade ✅ DONE (v1.2.0: AUDIOFOCUS_GAIN, AudioFocusRequest API, iOS AVAudioSession, identity cleanup)

Phase 1 — Core lifecycle (needs dedicated field testing)
- P1.16 PlayerStep double `done` emission fix ✅ DONE
- P1.13 page exit cleanup system ✅ DONE
- P1.17 offlimit reentry resume ✅ DONE
- P0.1b AudioContext resume on foreground ✅ DONE
- P0.3 notification strategy: fix scheduling leak + permission flow — Partial ✅
- P0.1 geolocation lifecycle and anti-sleep strategy (research + full field test)
- P1.5c GPS lost timeout tuning (research, coupled with P0.1)

Phase 2 — Stability cleanup (test with repeated staff starts)
- P1.5 listener/timer cleanup (partial ✅ — P1.13 framework in place, CHECKGEO leak deferred)
- P1.5b GPS accuracy filtering ✅ DONE
- P1.10 GPS lost recovery UX ✅ DONE
- P1.11 Audio focus auto-resume ✅ DONE (iOS mid-session call handling deferred to plugin fork)
- opportunistic P0.4 plugin guards in touched files

Phase 2 — UX and logic (test with full walk-through)
- P0.2 replace or simplify legacy background validation
- P1.8 step progression audit on FLANERIE_ELYSEE
- P3.2 iOS location permission progression 🆕

Phase 4 — Observability + platform
- P2.10 telemetry and usage diagnostics ✅ DONE (extended with offlimit/restart markers)
- P3.1 iOS background audio entitlement ✅ VERIFIED DONE (UIBackgroundModes already present in config.xml)
- P3.3 Android 14+ foreground service type ✅ VERIFIED DONE (FOREGROUND_SERVICE_LOCATION + foregroundServiceType already declared)
- P3.2 iOS AUTHORIZED_FOREGROUND non-blocking start (still open — geoloc.js rejects it as error)
- C2 plugin/platform upgrades: geolocation 2.3.3 → local-notification 1.2.3 → cordova-android 15 → cordova-ios 8
- C1 audiofocus plugin upgrade ✅ DONE
- C4 add container build checklist before platform upgrades

Later
- P1.7 resume/version safety
- P2.9 public endpoint exposure review
- Zone audio boundary thrashing (Known Dormant Bug) 🆕
- PlayerSimple `_playRequested` stuck flag (Known Dormant Bug) 🆕
- `allSteps` global leak (Known Dormant Bug) 🆕

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
- 🆕 lock phone during active audio playback, wait 2 minutes, unlock: verify audio still playing
- 🆕 background the app for 5 minutes, foreground: verify AudioContext is running (not suspended)
- 🆕 walk along a zone boundary for 30 seconds: verify no audio glitching or excessive load/unload
- 🆕 verify vibration feedback fires on GPS loss and on audio focus loss (locked screen)

### Data and startup
- start route with no data link after media preload
- repeat pre-start testing on the same device before sending a visitor
- reload app mid-parcours and verify resume from correct step
- verify "Je suis perdu.e !" button shows a useful map (or graceful fallback if offline)

### Plugin resilience
- simulate missing plugin build for audio focus or notifications where possible

### Platform-specific 🆕
- Android 14+ device: verify BackgroundGeolocation foreground service starts correctly
- Android with aggressive battery saver (Samsung/Xiaomi): verify GPS survives 10+ minutes of locked-screen walking
- iOS fresh install: verify "While Using" → "Always" location permission progression is not a dead end
- iOS 17+: verify background audio entitlement is effective

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

### Double "done" emission in PlayerStep ✅ FIXED — P1.16
- Fixed via `_doneFired` guard in `startAfterplay()`. Both `voice.on('end')` and `music.on('end')` delegate to `startAfterplay()`, which emits `done` only once per step.
- File: `www/app/assets/player.js`

### iOS html5 audio mode seek/fade limitations
- All Howl players use `html5: true` on iOS. Howler.js html5 mode has known issues with `seek()` and `fade()` reliability.
- The `rewindOnPause(3000)` feature does `seek(seek() - 3)` — may silently fail on iOS, meaning no rewind happens on pause/resume.
- Visible as a jarring audio jump on resume instead of a smooth 3-second rewind.
- No easy fix without testing alternative approaches (WebAudio mode has its own background issues on iOS).
- File: `www/app/assets/player.js`

### Dual silent players in parcours page ✅ FIXED
- The redundant `testplayer` silent keepalive was removed from `pages.js`.
- The parcours page now keeps only the single `SILENT_PLAYER` path.
- This reduces unnecessary concurrent audio streams and removes one source of keepalive confusion during debugging.
- File: `www/app/pages.js`

### `delete variable` no-op ✅ FIXED
- `delete testplayer` replaced with `testplayer = null` in `pages.js` (two occurrences). Fixed in P1.9c.
- File: `www/app/pages.js`

### Console.log HTML injection in dev panel ✅ FIXED (2026-05-05)
- Replaced inline `.append(message + '<br/>')` pattern with a shared `_logsAppend(color, ...message)` helper that uses `$('<span>').text(text)` (jQuery text-safe insertion).
- All three overrides (`log`, `warn`, `error`) now share the helper. No raw HTML string interpolation of log content.
- File: `www/app/assets/common.js`

### PlayerSimple `_playRequested` stuck flag ✅ FIXED (2026-05-05)
- `_playRequested` now reset in `loaderror` and `playerror` handlers, which previously left it `true` on Howler load/play failures.
- 5-second safety timeout added in `play()`: if Howler never fires the `play` event (AudioContext suspended, iOS background), the flag resets automatically and logs `audio_play_timeout` telemetry.
- `clearTimeout` added in `clear()` so the timeout does not fire on players that are explicitly stopped.
- File: `www/app/assets/player.js`

### Zone audio boundary thrashing ✅ FIXED (2026-05-05)
- Added `UNLOAD_EXTRA_HYSTERESIS = 10` (metres) constant and `_unloadRadius = _loadRadius + UNLOAD_EXTRA_HYSTERESIS` computed in both constructor branches (circle and polygon).
- `Spot.updatePosition()` now uses `distanceToCenter(pos) > _unloadRadius` for the unload condition instead of `!near(pos)`. Load still triggers at `_loadRadius`.
- Effect: with default values, a zone with radius 30m loads at 40m approach and only unloads beyond 50m — 10m dead-band eliminates oscillation at the edge.
- File: `www/app/assets/spot.js`

### `allSteps` global array leak on parcours rebuild 🆕
- `allSteps` array in `spot.js` is filtered per-index on Step construction but never fully cleared on parcours rebuild. Old Step references from a previous `build()` call may linger.
- Dormant because parcours don't change mid-walk. Would matter if reload/re-select is ever supported without full page reload.
- **Fix:** Clear `allSteps = []` in `Parcours.clear()`.
- File: `www/app/assets/spot.js`, `www/app/assets/parcours.js`

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

### P1.9d Dead code removal 🆕 [SAFE-TODAY] ✅ DONE

Implemented 2026-04-27.

What was done:
- Deleted the unreachable `checkbackground` body and replaced the page with the existing direct jump to `sas`.
- Removed the commented-out `BackgroundGeolocation.startTask` block from the stationary handler.
- Removed the commented-out legacy `GPSLOST_PLAYER` code.
- Removed unused `DISTANCE_MATCH`.
- Fixed the `DISTANCE_RDV` comment to match the actual 20m value.
- Removed the redundant silent `testplayer` keepalive path from the parcours page.

Regression risk: **NONE**. All removed code was unreachable, commented out, or redundant.

Files changed:
- `www/app/pages.js`
- `www/app/assets/geoloc.js`

## Deliverables

1. P0 code fixes centered on locked-screen GPS/audio survival
2. A lean regression checklist for Cordova field devices
3. A telemetry plan for real usage, minor incidents, GPS loss, and odd audio behavior
4. A separate FLANERIE_ELYSEE sequencing audit before any route-logic change
5. 🆕 Platform-specific hardening (iOS entitlements, Android foreground service, permission flows)
6. 🆕 User recovery UX (GPS lost vibration, audio focus auto-resume)

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

Title: Phase 3 — Cordova container hardening + audiofocus plugin fix

All app-only P1/P2 items are code-complete. The remaining open work falls into two areas:

**Area 1 — Audiofocus plugin fork:** ✅ COMPLETE (v1.2.0)
- Plugin reinstall required before building: `cordova plugin remove com.maigre.cordova.plugins.audiofocus && cordova plugin add /path/to/fork`

**Area 2 — Plugin/platform upgrades (do in order, build-test between each):**
- C2a: `cordova-background-geolocation-plugin` 2.3.2 → 2.3.3 (highest value, test locked-screen GPS on Android 13/14)
- C2b: `cordova-plugin-local-notification` 1.2.0 → 1.2.3 (notification keepalive reliability)
- C2c: `cordova-android` 14.0.1 → 15.0.0 (after plugin compat check)
- C2d: `cordova-ios` 7.1.1 → 8.0.1 (after Xcode check)

**Area 3 — Still pending field validation:**
- P0.1 geolocation lifecycle: code implemented 2026-04-03, no full locked-screen pocket walk test yet
- P0.3 notification: real-device validation of keepalive cadence on Android

Excludes:
- P0.2 background validation (stays bypassed)
- P1.5c GPS timeout tuning (needs P0.1 field data first)
- P1.8 step progression audit (separate, pre-walk)
- P3.2 iOS AUTHORIZED_FOREGROUND (separate iOS-only ticket)
- P1.15 GIVORS_V3 (needs server-side JSON access)
- sequencing logic changes
- SAS redesign
