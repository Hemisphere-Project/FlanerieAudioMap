# Mobile Audit Remediation Plan

Original: 2026-04-27  
Last updated: 2026-05-13 (LOST state machine P1.18, voice/afterplay fallback P1.19, RESUME cue P1.20, AUDIOFOCUS auto-retry P1.21, devmode tools page P1.22, paused() crash fix; Architecture Summary + telemetry list aligned with current code)  
Scope: Cordova launcher + downloaded local webapp, GPS-triggered audio walk, locked-screen pocket usage, published parcours FLANERIE_ELYSEE  
Plugin: [`cordova-background-geolocation-plugin`](https://github.com/Maigre/cordova-background-geolocation-plugin) v2.4.0 (Flanerie fork of HaylLtd v2.3.3)

## Field Safety Legend

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
- some weak client-side mechanisms are acceptable if they match the operational use case

## Main Goal

Stabilize the real field experience on a wide range of devices, with focus on:

- keeping precise enough GPS alive while the phone is locked in pocket
- keeping audio playback alive and synchronized with route progression
- avoiding dead ends during startup or during the walk
- improving telemetry so real-world failures can be observed instead of guessed

## Architecture Summary

Key files (line counts as of 2026-05-13):
- `www/app/pages.js` — 25 pages, ~2000 lines (entry point + state machine + mid-walk monitoring)
- `www/app/assets/geoloc.js` — GPS tracking via BackgroundGeolocation plugin + browser fallback (~1100 lines)
- `www/app/assets/player.js` — Audio engine: `PlayerSimple` wraps Howler or `NativeMediaPlayer` (iOS); `PlayerStep` composes 2 PlayerSimple channels (voice + afterplay) (~1000 lines)
- `www/app/assets/spot.js` — Geofence classes: `Zone` (ambient/object audio, looped PlayerSimple), `Offlimit` (boundary message, looped PlayerSimple), `Step` (sequential waypoints, PlayerStep) (~700 lines)
- `www/app/assets/parcours.js` — Parcours data model, media download, state persistence (localStorage), step progression
- `www/app/assets/diagnostic.js` — DEV-mode diagnostic test suite T0–T11
- `www/app/assets/map.js` — Leaflet map with offline tile support (currently disabled)
- `www/app/assets/telemetry.js` — Event logging, session tracking, beacon-based flush
- `www/app/assets/common.js` — EventEmitter base class, geo_distance(), HTTP helpers

Libraries: Howler.js 2.2.4 (Android/browser fallback), cordova-plugin-media via `NativeMediaPlayer` (iOS primary), Leaflet 1.9.4, NoSleep.js, jQuery 3.7.1

Keepalive stack (all active during parcours):
1. `SILENT_PLAYER` — looped silent mp3 via PlayerSimple (NativeMediaPlayer on iOS, Howler on Android/browser)
2. NoSleep.js — Wake Lock API / silent video hack
3. BackgroundGeolocation native keepalive — foreground service + Handler 15s tick (Android) / `UIBackgroundModes: location` + NSTimer 15s tick (iOS, v2.4.0)
4. `cordova-plugin-audiofocus` foreground service — `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` (Android API 29+, see C1b) signals audio activity to OEM battery savers independently of the GPS service
5. Local notification chain — disabled (`NOTIF_CHAIN_ENABLED = false`); was delivering zero keepalive contribution on both platforms

Audio model (current code; see player.js + spot.js):
- **Step → PlayerStep**: 2 internal channels.
  - `voice` — non-looped narration, rewind 3s on pause, fires `end` → starts afterplay. `loaderror`/`playerror` short-circuit to `startAfterplay()` so the step lifecycle still advances (P1.19).
  - `afterplay` — looped continuation, native infinite-loop on iOS (`numberOfLoops: -1`), starts when voice ends, no `end` event while looping. If the step's own afterplay is missing or errored, `PlayerStep` routes to the shared `DEFAULT_AFTERPLAY_PLAYER` instead (P1.19).
- **Zone → PlayerSimple (looped)** — ambient or object audio (mode `Ambiance` uses 4000ms fade, otherwise instant).
- **Offlimit → PlayerSimple (looped, 1000ms fade)** — boundary message; once loaded, kept loaded for upcoming triggers.
- **Global persistent players**: `SILENT_PLAYER` (parcours-page keepalive), `GPSLOST_PLAYER` (GPS-lost cue), `DEFAULT_AFTERPLAY_PLAYER` (shared afterplay fallback, P1.19), `RESUME_PLAYER` (one-shot relaunch cue, P1.20), `LOST_PLAYER` (looped while walker is out-of-zone, P1.18), `testplayer` (checkaudio gate). All load from `www/app/images/{afterplay,resume,youlost,gpslost}.mp3` — bundled placeholders ship as `_afterplay.mp3` / `_resume.mp3` / `_youlost.mp3` (underscore-prefixed) so the loader silently no-ops until the operator renames them.

Page flow:
```
title → intro → checkdata → select → preload → confirmload → load
→ checkgeo → confirmgeo → startgeo
→ [checkmotion (iOS) | checkbgloc (Android)]
→ checknotifications (Android) → checkbatteryopt (Android)
→ rdv → checkaudio → checkbattery → [checkbackground (bypassed)] → sas
→ parcours → end
```

Onboarding gates (post-2026-05-13): every page above hard-blocks until its check passes. The previous `confirmios` reminder page was removed — its purpose was redundant once `startGeoloc()` only resolves on `AUTHORIZED` (Always).

---

## Priority Order

### P0: Production blockers

#### P0.1 Geolocation lifecycle — stationary handler ✅ DONE

The `stationary → stop()` + `stop → start()` churn is removed. The `on('stationary')` handler now just feeds the stationary position through `_callbackPosition` (keeping `lastTimeUpdate` alive and GPS-lost detection satisfied) without restarting the service. The `on('stop')` handler only restarts on unexpected OS-killed stops (`backgroundGeolocIntentionalStop` guard).

Files: `www/app/assets/geoloc.js`  
Regression risk: field test pending — validate with a real locked-screen walk on both platforms.

#### P0.1b AudioContext resume on foreground ✅ DONE (2026-04-27)

Added `resumeAudioContext()` helper in `geoloc.js`, called on `BackgroundGeolocation.on('foreground')`, on `document.resume`, and on each GPS position as defense-in-depth. Prevents Howler from silently playing against a suspended AudioContext after the app is foregrounded. Bound `Howler.ctx.onstatechange` for telemetry.

Files: `www/app/assets/geoloc.js`  
Regression risk: **LOW** — calling `resume()` on an already-running context is a no-op.

#### P0.2 Background validation UX [bypassed]

Currently bypassed (`return PAGE('sas')` at the top of the handler). Keep it bypassed unless a reliable lightweight alternative is found. If re-enabled, it should be a short operational checklist (location set, battery saver disabled, notifications allowed) — not a fake background test.

Regression risk: **LOW** (currently bypassed).

#### P0.3 Notification strategy ✅ PARTIAL (2026-05-06)

**What was done:**
- Scheduling leak fixed: `NOTIF_TIMER` prevents duplicate recursive chains; `clearWakeupNotification()` called on parcours exit.
- Notification chain disabled (`NOTIF_CHAIN_ENABLED = false` on Android, guard on iOS) — source analysis confirmed it delivers zero keepalive contribution on both platforms: `silent: true` prevents the Android `trigger` event from ever firing; iOS only calls `willPresentNotification` in foreground.
- Android 13+ permission gate kept: `POST_NOTIFICATIONS` is required for the BackgroundGeolocation foreground service notification, independent of the local notification chain.

**What actually keeps things alive:**

| Mechanism | Android | iOS |
|---|---|---|
| BackgroundGeolocation foreground service | **primary** ✅ | n/a |
| `UIBackgroundModes: location` + NSTimer (Fix 1b) | n/a | **primary** ✅ |
| GPS → native callback → Cordova bridge → JS | secondary ✅ | secondary ✅ |
| 59s local notification chain | ❌ disabled | ❌ disabled |

**Deferred:** Android direct AlarmManager JS wakeup (Fix 1e in P0.5) — would replace the broken notification chain without any notification UI. The Handler keepalive (Fix 1b) already covers the normal case; AlarmManager covers the edge case where the WebView is suspended despite the foreground service running.

**Future:** FCM (Android) / APNs silent push (iOS) every 30–60s as a supplementary layer when the walk runs with a data connection. Not primary — walk runs offline after preload.

Files: `www/app/pages.js`  
Regression risk: **MEDIUM** — notification permission step blocks Android 13+ startup. Must be tested on Android 13+ and at least one older device.

Acceptance:
- Android 13+ users cannot get stuck in the permission flow.
- iOS users are not blocked by a notification permission gate.
- Notification accumulation in the iOS tray is eliminated.

#### P0.4 Plugin guards ✅ ROLLING (superseded by concrete fixes)

Originally an opportunistic task to add `typeof` guards around plugin calls. Effectively closed: concrete fixes since 2026-04 have hardened the major plugin touchpoints — `geoloc.js` (P0.1, P0.5, P3.3b-d), `player.js` (P1.11, P1.11b, P3.4), `pages.js` (P1.12, P1.13, P3.2, P3.3b-d). Future plugin additions should bake guards in at write-time rather than as a separate audit pass.

Files: `www/app/pages.js`, `www/app/assets/player.js`, `www/app/assets/geoloc.js`

#### P0.5 Background geolocation plugin fork ✅ PARTIAL — v2.4.0 (2026-05-06)

**Applied (v2.4.0, committed and deployed to FlanerieCordova):**

| Fix | Platform | What it does |
|---|---|---|
| Fix 1: `showsBackgroundLocationIndicator = YES` | iOS | Blue location bar; CoreLocation navigation-session privilege |
| Fix 1b: NSTimer keepalive (15s) | iOS | Re-delivers last known position when no real callback in window |
| Fix 1b: Handler keepalive (15s) | Android | Same, via `getLastKnownLocation()` |
| Fix 1c: CMMotionActivity / ActivityRecognition | iOS + Android | `GEO.motionIsStationary` flag; GPS-lost guard skips alert when stationary |
| Fix 1d: `WKWebView.allowsBackgroundTimeExtension` | iOS 17.4+ | Prevents WKWebView JS suspension natively |
| Fix 2: significant location changes as parallel keepalive | iOS | `stopMonitoringSignificantLocationChanges` removed from `onStart:` |

Files modified: `MAURRawLocationProvider.m`, `CDVBackgroundGeolocation.m`, `RawLocationProvider.java`, `plugin.xml`, `geoloc.js`, `pages.js`

**Deferred:**

- **Fix 1e — Android AlarmManager JS wakeup** [MEDIUM]: direct `AlarmManager.setExactAndAllowWhileIdle` + `evaluateJavascript` wakeup, no notification involved. Covers the edge case where the WebView is suspended despite the foreground service running. Requires new `LocationWakeReceiver.java` in the fork.
- **Fix 3 — Android DistanceFilterLocationProvider** [MEDIUM]: adaptive update rate when stationary. May improve consistency during static listening spots.
- **Fix 4 — Android FusedLocationProvider** [HIGH]: handles Doze mode and falls back to WiFi/network when raw GPS drops. Significant native addition. If Android GPS reliability remains a field problem after v2.4.0 testing, this or transistorsoft is the next decision point.

**Transistorsoft verdict:** Evaluated and decided against. iOS gap vs the fork (Fix 1, 1b, 1c, 1d) is now negligible. The one real advantage is FusedLocationProvider on Android (equivalent to Fix 4). Licensing cost (commercial, price not published) only makes sense if Fix 4 proves necessary and the engineering cost is prohibitive.

Acceptance:
- iOS: standing still for 5 minutes mid-walk does not trigger GPS-lost audio or overlay.
- Android: GPS updates continue at consistent rate during static listening spots with screen locked.

---

### P1: Correctness and stability

#### P1.5 Listener accumulation and timing cleanup ✅ PARTIAL (2026-03-14)

Fixed: `GEO.removeAllListeners('position')` before re-attaching in `parcours.js`; `clearInterval(CHECKGEO)` before re-setting in `pages.js`.

Deferred: full timer/listener audit across all pages — coupled with P0.1 lifecycle work.

Files: `www/app/assets/parcours.js`, `www/app/pages.js`

#### P1.5b GPS accuracy filtering ✅ DONE (2026-03-14)

30m accuracy gate in `_callbackPosition()`. Positions with `accuracy > 30` skip `emit('position')` but still update `lastTimeUpdate` and `lastPosition`, so GPS-lost detection is unaffected.

Files: `www/app/assets/geoloc.js`

#### P1.5c GPS "lost" timeout tuning ✅ DONE (2026-05-07)

Both platforms unified at 30s (`GEO.stateUpdateTimeout = 30 * 1000`). The v2.4.0 native keepalive (NSTimer on iOS, Handler on Android) re-delivers the last known position every 15s — the timeout must exceed this interval or a stationary device would oscillate GPS-lost/ok every 15s. At 30s, the keepalive refreshes `lastTimeUpdate` at t=15s, the proactive heartbeat threshold is t=18s (60%), and GPS-lost only fires if neither real callbacks nor the keepalive deliver for a full 30s.

Previous values were Android 10s (too short for 15s keepalive) and iOS 30s (already correct).

Files: `www/app/pages.js`

#### P1.6 Media failure reporting and recovery ✅ DONE (2026-03-14)

Added `.catch()` to `PAGES['preload']`; split error paths into `nodata` (server/network failure, auto-retry) vs `nomedia` (media download failure, manual retry button).

| Failure | Page | Recovery |
|---|---|---|
| Server/network unreachable | `nodata` | Auto-retry every 2s |
| Parcours JSON load failed | `nodata` | Auto-retry every 2s |
| No parcours available | `noparcours` | Manual (link to website) |
| Media download failed | `nomedia` | Manual retry button |

Files: `www/app/pages.js`, `www/app/app.html`

#### P1.7 Resume/version-safe local state [TEST-FIRST]

Deferred. Any serialization change breaks existing stored parcours and needs a migration path. Revisit after P0 lifecycle work is stable.

#### P1.8 Step progression logic audit [RESEARCH-FIRST]

Known: `!(s._spot.optional === false)` in `spot.js` is inverted logic — names the result `mandatory` but filters for optional steps. Dormant because FLANERIE_ELYSEE has `optional: false` on all steps. Do not change without a full walk-through validation.

Files: `www/app/assets/spot.js`

#### P1.10 GPS lost recovery UX ✅ DONE (2026-05-05)

Vibration on GPS loss/recovery, `#gpslost-overlay` shown on loss with "Continuer sans GPS" force-resume option. Cleanup registered in `PAGES_CLEANUP['parcours']` so overlay never bleeds into post-walk pages.

Files: `www/app/app.html`, `www/app/pages.js`

#### P1.11 Audio focus auto-resume ✅ DONE (2026-05-05, updated 2026-05-06 + 2026-05-13)

- Vibration on `AUDIOFOCUS_LOSS` / `AUDIOFOCUS_GAIN` — patterns updated in **P1.11b** (triple-pulse loss, double-pulse gain).
- `shouldRequestAudioFocusForPlay()` fixed: re-requests focus only when `AUDIOFOCUS === 0` (explicitly lost), not on every background play.
- iOS: generic app backgrounding no longer treated as audio interruption. Only native `AVAudioSessionInterruptionNotification` events (via audiofocus plugin, see C1) trigger pause/resume.
- Android: re-requests audio focus on app resume.
- `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`: active players reduced to 25% volume, restored on `AUDIOFOCUS_GAIN`.

Files: `www/app/assets/player.js`, `www/app/assets/geoloc.js`

#### P1.11b Audio stack hardening ✅ DONE (2026-05-13)

Field-review-driven JS-only hardening of the audio path for the 45-min locked-pocket scenario. Five fixes shipped together — none require native code changes (one is a Cordova install variable).

**1. iOS Howler-fallback fail-fast (was a silent failure trapdoor):**

If `httpToNativePath()` returns null on iOS (e.g., `LOCALMEDIA_PATH_NATIVE`/`LOCALAPP_PATH_NATIVE` not captured), `PlayerSimple.load()` previously fell back to `Howl({html5: true})` with only a `console.warn`. Howler cannot start playback from a background GPS callback on a locked iPhone — the walk would silently die in the pocket while `checkaudio` (foreground) still passed.

Now: the fallback branch flips a per-instance `_isNativeFallback` flag and a sticky module-level `IOS_NATIVE_FALLBACK_DETECTED`. `console.warn` upgraded to `console.error`. Telemetry `ios_native_fallback` records which path bases were missing. `checkaudio` hard-fails on either flag with French copy "Erreur de compatibilité audio (iOS) — Demandez à un membre de l'équipe."

**2. `AUDIOFOCUS === -1` (plugin failed to init) fail-fast:**

`shouldRequestAudioFocusForPlay()` previously returned false when `AUDIOFOCUS === -1`, silently letting playback proceed without focus on Android (system can interrupt at any time) and without explicit AVAudioSession activation on iOS. `checkaudio` now gates on `AUDIOFOCUS === -1` and hard-fails with "Le module audio n'est pas disponible."

**3. `KEEP_AVAUDIOSESSION_ALWAYS_ACTIVE` config alignment:**

`FlanerieCordova/package.json` install variable was `"NO"` while `FlanerieCordova/config.xml` set the runtime preference to `"YES"` — Cordova's config merge order made the effective value non-deterministic. If the install-time value won, `CDVSound.m` would call `setActive:NO` between voice and afterplay (during the JS-roundtrip on track end), risking audio death between steps on a locked iPhone. Aligned both to `"YES"`.

**Requires plugin reinstall on next build** — install variables only re-read when the plugin is installed:
```bash
cordova plugin remove cordova-plugin-media
cordova plugin add cordova-plugin-media@7.0.0
```
Or `cordova platform remove ios && cordova platform add ios`. Add to C4 build checklist.

**4. Play-timeout watchdog 5s → 15s:**

`PlayerSimple._playRequestedTimeout` previously reset `_playRequested` after 5s if no `play` event arrived. For large MP3s on slow filesystems (Samsung A-series microSD, etc.), 5s wasn't enough — step audio silently aborted. Bumped to 15s. `loaderror`/`playerror` still fire on real failures and resolve the geo task earlier; this is just the last-resort safety net.

**5. Distinctive vibration patterns:**

`AUDIOFOCUS_LOSS` vibration changed from `[300]` (single pulse, easily missed against walking motion) to `[300, 150, 300, 150, 300]` (triple pulse, unmistakable in pocket). `AUDIOFOCUS_GAIN` changed from `[100]` to `[100, 80, 100]` (double pulse, distinct from loss). Helps the walker realise audio paused even without seeing the resume overlay.

**Telemetry added:**

- `ios_native_fallback` — fires once per failing PlayerSimple load on iOS, with `has_localmedia` / `has_localapp` flags.
- `checkaudio_fail` — fires with `reason` ∈ {`loaderror`, `playerror`, `audiofocus_unavailable`, `ios_native_fallback`} when the page hard-blocks.
- `audio_play_timeout` now includes `ms` value (15000) for traceability.

Files: `www/app/assets/player.js`, `www/app/pages.js`, `FlanerieCordova/package.json`

Regression risk: **LOW** — gates only fire on already-broken phones (failed plugin init or missing native path bases); existing fleet expected to pass. Vibration pattern change is cosmetic. KEEP_AVAUDIOSESSION change requires plugin reinstall to take effect, so existing builds are unaffected.

Acceptance:
- iOS phone with `LOCALMEDIA_PATH_NATIVE` artificially unset (force fallback): `checkaudio` displays red error, accept button hidden.
- Real walker on Android: triple vibration during phone call is felt clearly in pocket.
- Build pipeline: `cordova plugin add cordova-plugin-media` (with `KEEP_AVAUDIOSESSION_ALWAYS_ACTIVE=YES`) propagates to `platforms/ios/App/config.xml`.

#### P1.12 Android battery optimization guidance ✅ DONE (2026-05-05), hardened (2026-05-13)

Blocking page `checkbatteryopt` inserted between `checknotifications` and `rdv` on Android. Calls `RequestOptimizations()` directly on first failure (native system dialog). Auto-polls 10× / 15s, then shows manual fallback buttons. DEVMODE bypasses.

**Bugs fixed (2026-05-13):**

- The "Paramètres batterie" button used `plugin.RequestOptimizationsMenu()`, whose Java implementation has an inverted conditional (`if (pm.isIgnoringBatteryOptimizations(...))`) so the settings page opens only when the app is already whitelisted — i.e., never when the user needs it. Replaced with `GEO.showAppSettings()` which opens app details on both Android and iOS via the bg-geo plugin. The plugin bug remains and is now in the fork backlog (see "Deferred plugin fork — power optimization").
- `HaveProtectedAppsCheck()` returns a JSON object `{skip_message, found_intent}` but the JS treated it as a boolean — the OEM banner showed on every device regardless of whether an OEM intent was actually callable. Fixed to check `result.found_intent`.
- The `skipProtectedAppCheck` SharedPreferences flag (sticky after first call) is now irrelevant because banner gating no longer reads it.

**Manufacturer-tailored guidance added (2026-05-13):**

`batteryKillFamily()` reads `device.manufacturer` and maps to: Samsung, Xiaomi/Redmi/POCO, Huawei/Honor, OnePlus, Oppo/Realme, Vivo, Asus. `batteryKillCopy(family)` returns French Settings steps per family (Samsung "Apps en veille profonde", Xiaomi "Démarrage automatique" + "Pas de restrictions" + lock in recents, Huawei "Lancement d'apps manuel", etc.). Doze whitelist alone is rarely sufficient on OEM-modified Android — the tailored block is now rendered up front rather than after first failure.

**OEM-kill mid-walk heuristic (2026-05-13):**

`geoloc.js` re-emits the bg-geo `'stop'` event as `GEO.emit('bgServiceStop', {intentional})`. `pages.js` keeps a 5-minute rolling window: 2 unexpected stops trigger `showBatteryKillOverlay()`, which reuses the GPS-lost overlay DOM with "Restriction batterie détectée" + manufacturer-tailored Settings steps + Settings deep link. Telemetry: `bg_stop_repeated`, `battery_kill_overlay`.

Files: `www/app/app.html`, `www/app/pages.js`, `www/app/assets/geoloc.js`

Regression risk: **LOW** — the JS-only changes are additive; the broken plugin call was already failing silently.

#### P1.13 Page exit cleanup system ✅ DONE (2026-05-05)

`PAGES_CLEANUP` map + `PAGE()` calls registered handler before any transition. Migrated: parcours notification cleanup, notification permission poll, battery opt poll.

Files: `www/app/pages.js`

#### P1.14 Completed-step refire guard ✅ DONE (2026-04-27)

`_done` flag in `Step` prevents re-fire after `step_done`. Reset only when walk progression moves back before that step. Telemetry event `step_skip_done` added.

Files: `www/app/assets/spot.js`

#### P1.15 GIVORS_V3 last-step completion [RESEARCH-FIRST]

Final steps never emit `step_done` in any GIVORS_V3 session. Likely cause: no exit polygon or infinite afterplay loop with no `done` path. Investigation requires server-side parcours JSON access.

#### P1.16 PlayerStep double `done` emission ✅ DONE (2026-05-05)

`_doneFired` guard in `startAfterplay()` ensures `done` emits exactly once per play-through, regardless of whether voice and music both end.

Files: `www/app/assets/player.js`

#### P1.17 Offlimit reentry resumes current step ✅ DONE (2026-04-27)

`Step.updatePosition()` detects "step already current and paused" and resumes without emitting a new `fire` event. Step-local offlimit handling moved ahead of the generic fire path. `PlayerStep.isNarrating()` added.

Files: `www/app/assets/spot.js`, `www/app/assets/player.js`, `www/app/assets/parcours.js`

#### P1.18 LOST state machine — walker out of zone ✅ DONE (2026-05-13)

**Problem:** before this, a walker who drifted away from the active or next step had no in-app signal. The map would still show the repère but audio just stopped, and `step_skip_done` / re-fire telemetry only surfaced after the fact. Offlimit re-crossings while wandering could also fire spurious zone audio.

**Resolution:** new `Parcours.evaluateLostState(position)` runs first in `update()`. Hysteresis: enter LOST when `distanceToBorder(target) > LOST_ENTER_M` (50m) sustained for `LOST_SUSTAIN_MS` (15s), exit when `distance < LOST_EXIT_M` (0m, i.e. inside). `motionIsStationary` defeats the entry timer (pocketed walker isn't wandering), and `GPSSIGNAL_OK === false` defers the decision so GPS-lost takes priority. Target is the active step if still narrating/afterplaying, otherwise the next step. Last step done → no LOST.

While LOST:
- `Parcours.update()` early-returns after `evaluateLostState`, so offlimits are masked and zones/steps can't (re)trigger.
- `pages.js` `on('lost')` pauses the active step player, runs `PARCOURS.stopAudio('zones')` and `stopAudio('offlimits')`, vibrates `[200,100,200,100,600]`, and renders `#lost-band` (red pinned top band, `pointer-events:none` so the map stays interactive) + plays looped `LOST_PLAYER` (silent fallback if `images/youlost.mp3` missing).
- State persists across kill (`state.lost` / `state.lostSince` in localStorage). On relaunch, `PAGES['parcours']` resume branch calls `applyLostUI()` so the walker isn't dropped into silence; `evaluateLostState` fires `recover` on the next position tick if they already came back into range.

Telemetry: `user_lost` (step, target_index, target_name, distance), `user_recovered` (step, distance). `server.js` + `scripts/telemetry-report.js` now compute `lostRecoveryMedianMs` per session and expose `userLostCount` / `userRecoveredCount` columns in the report.

Files: `www/app/assets/parcours.js` (LOST_ENTER_M / LOST_EXIT_M / LOST_SUSTAIN_MS constants, `evaluateLostState()`, persisted state), `www/app/pages.js` (`applyLostUI`/`clearLostUI`, `on('lost')`/`on('recover')` handlers, `GPSSIGNAL_OK` mirror), `www/app/app.html` (`#lost-band`), `www/app/app.css` (`.lost-band` style), `server.js`, `scripts/telemetry-report.js`

Regression risk: **MEDIUM** — first JS state on top of every position update. Validate that a normal walk does not enter LOST during stops at zone boundaries (motionIsStationary gate covers pocket cases but not slow walking near 50m). Tune `LOST_ENTER_M` / `LOST_SUSTAIN_MS` if false positives surface in telemetry.

#### P1.19 Voice failure + afterplay fallback ✅ DONE (2026-05-13)

Two failure modes that previously left the walker in silence are now self-healing.

**1. Voice load/play failure:** `PlayerStep` constructor registers `voice.on('loaderror')` and `voice.on('playerror')`. On either, if `state === 'play'`, the step skips directly to `startAfterplay()`. The walker hears the looped afterplay instead of a dead zone, and step progression (`done` emit, next-step arming) still happens. Telemetry: `step_voice_failed` (reason, src).

**2. Missing/broken step afterplay:** new `PlayerStep._needsDefaultAfterplay()` returns true if `afterplay._media` is null, `src === '-'`, or `_loadError` is set. `startAfterplay()` checks the flag and routes through the shared `DEFAULT_AFTERPLAY_PLAYER` instead of the per-step instance (`_defaultAfterplayActive` mirrors the routing so `play()`/`stop()`/`pause()`/`clear()` all hit the right player). The shared player is stopped before play because another step may still be fading it out. Silently silent if `images/afterplay.mp3` itself isn't bundled (`isLoaded()` gate). Telemetry: `step_afterplay_fallback` (reason: `loaderror` | `no_src`).

Per-session counts surface in the telemetry report as `voiceFailCount`, `afterplayFallbackCount`, `afterplayFallbackNoSrc`, `afterplayFallbackLoadError`.

Files: `www/app/assets/player.js` (PlayerStep constructor `onVoiceFail`, `_needsDefaultAfterplay`, routing in `startAfterplay`/`play`/`stop`/`pause`/`clear`), `www/app/pages.js` (`DEFAULT_AFTERPLAY_PLAYER` global), `server.js`, `scripts/telemetry-report.js`

Regression risk: **LOW** — fallback paths only fire on broken assets; healthy parcours unchanged.

#### P1.20 Resume cue on parcours rehydration ✅ DONE (2026-05-13)

`RESUME_PLAYER` (one-shot, non-looped) plays once when `PAGES['parcours']` enters the resume branch (kill-and-relaunch). Gives the walker an immediate audio confirmation while GPS warms up and before they re-cross into the active step zone. Silently silent if `images/resume.mp3` isn't bundled. Cleaned up in `PAGES_CLEANUP['parcours']` and `PAGES['end']`.

Files: `www/app/pages.js`

#### P1.21 AUDIOFOCUS periodic auto-retry ✅ DONE (2026-05-13)

Some Android OEMs (and occasionally iOS) drop the `AUDIOFOCUS_GAIN` callback after a transient loss, leaving the walker silent in their pocket with no way to recover unless they look at the screen and tap the resume overlay. A `setInterval(60s)` while on the parcours page (`currentPage === 'parcours'`, plus `tools` in DEVMODE for testing) re-calls `requestAudioFocus()` when `AUDIOFOCUS === 0` and `#resume-overlay` is visible. The first 3 attempts vibrate `[300,100,300,100,300]` to nudge the walker; counter resets when focus returns or the overlay hides. `GPSREVOKED` takes priority and skips the retry.

Telemetry: `audiofocus_auto_retry` (attempt). Report exposes `audiofocusRetryCount` and `audiofocusRetryMaxAttempt`.

Files: `www/app/pages.js`, `server.js`, `scripts/telemetry-report.js`

Regression risk: **LOW** — gated tight on focus state + overlay visibility; idle when audio is healthy.

#### P1.22 Devmode tools page ✅ DONE (2026-05-13)

New `PAGES['tools']` (DEVMODE-only, button on `select` page) lets a tester force the failure paths that are hard to reproduce in the field without breaking the live parcours:

- **Forcer LOST** / **Sortir de LOST** — synthesize `lost` / `recover` events on the live `PARCOURS`, exercising band + audio + telemetry without needing to walk 50m away.
- **Voix HS sur étape courante** — emits `playerror` on the active step's voice player, exercising the P1.19 voice-fail-to-afterplay path.
- **Afterplay générique sur étape courante** — flips `_defaultAfterplayActive` on the active step and plays `DEFAULT_AFTERPLAY_PLAYER`, exercising the P1.19 missing-afterplay fallback without altering the parcours data.
- **Overlay reprise audio** — sets `AUDIOFOCUS = 0` and shows `#resume-overlay`; sit on the tools page ~60s to see the P1.21 auto-retry fire (the retry's `currentPage` gate includes `tools` in DEVMODE for exactly this).
- **Snapshot état** — dumps `currentPage`, `AUDIOFOCUS`, `GPSSIGNAL_OK`, `GPSREVOKED`, `PARCOURS.state`, active step (index/name/active/done/playerState/playstate/defaultAfterplay), next step, all playing players (src list), all PAUSED_PLAYERS (src list) into the on-page console.

Telemetry tags emitted by the buttons: `tools_force_lost`, `tools_clear_lost`, `tools_force_voice_fail`, `tools_force_afterplay_fallback`, `tools_show_resume_overlay`.

Files: `www/app/pages.js` (`PAGES['tools']`), `www/app/app.html` (`#tools` page DOM, `#select-tools` button)

---

### P2: Supportability and observability

#### P2.9 Public endpoint exposure [SAFE-TODAY]

Low priority. No risk if deferred.

#### P2.10 Telemetry and operational diagnostics ✅ PARTIAL

Implemented: telemetry client, local buffering/flush/retry, session resume, server ingestion, session storage, admin listing.

Events:
- Session: `session_start`, `session_resume`, `session_end`
- GPS: stream samples, `gps_state`, `gps_heartbeat_ok`, `gps_trigger_rejected`, `gps_revoked`, `gps_settings_open`, `gps_force_resume`
- Step lifecycle: `step_fire`, `step_done`, `step_skip_done`, `step_refire_blocked`, `step_prewarm`
- Step failure paths (P1.19): `step_voice_failed` (reason, src), `step_afterplay_fallback` (reason: `loaderror` | `no_src`)
- LOST state (P1.18): `user_lost` (step, target_index, target_name, distance), `user_recovered` (step, distance)
- Audio: `audio_play_gate`, `audio_play_requested`, `audio_play_started`, `audio_play_timeout` (with `ms`), `audio_loaderror`, `audio_playerror`
- AudioFocus: `audiofocus_loss`, `audiofocus_gain`, `audiofocus_auto_retry` (attempt) (P1.21)
- iOS: `ios_native_fallback`, iOS background task begin/end
- Battery/OEM: `bg_stop_repeated`, `battery_kill_overlay`
- Permissions: `motion_authorized`, `motion_check`
- Misc: `restart`, warm/cold trigger context, `checkaudio_fail`
- Devmode tools (P1.22): `tools_force_lost`, `tools_clear_lost`, `tools_force_voice_fail`, `tools_force_afterplay_fallback`, `tools_show_resume_overlay`

Per-session derived fields in `server.js` + `scripts/telemetry-report.js`: `lostRecoveryMedianMs`, `userLostCount`, `userRecoveredCount`, `voiceFailCount`, `afterplayFallbackCount` / `afterplayFallbackNoSrc` / `afterplayFallbackLoadError`, `audiofocusRetryCount`, `audiofocusRetryMaxAttempt`. CLI report adds `Lost`, `Rec~`, `VFail`, `ApFb` columns.

Still missing:
- Permission-state snapshots at startup
- Native AVAudioSession category/route-change/media-services-reset snapshots
- Media preload success/failure telemetry at the parcours-pack level
- Notification scheduling/permission diagnostics

Files: `www/app/assets/telemetry.js`, `www/app/pages.js`, `www/app/assets/geoloc.js`, `www/app/assets/player.js`, `www/app/assets/parcours.js`, `server.js`, `scripts/telemetry-report.js`

#### P2.11 SAS waiting buffer [SAFE-TODAY]

Intentionally low-security client-side gate — acceptable because the team is present at walk start. Only revisit if the operational process changes.

---

### P3: Platform-specific hardening

#### P3.1 iOS background audio entitlement ✅ VERIFIED DONE (2026-05-05)

`UIBackgroundModes: location + audio + processing` present in `FlanerieCordova/config.xml`. `KeepAVAudioSessionAlwaysActive: YES` prevents `CDVSound.m` from resetting the session category between NativeMediaPlayer tracks.

#### P3.2 iOS location permission progression ✅ DONE (2026-05-06), hardened (2026-05-13)

iOS 13+ no longer shows "Always" in the initial dialog. `confirmgeo` now detects `AUTHORIZED_FOREGROUND` immediately and shows the "need Always" guidance + Settings button without requiring the user to tap "J'accepte" first.

**Front-loaded copy (2026-05-13):** `confirmgeo` first-pass description now spells out "Toujours autoriser" before the user clicks J'accepte and triggers the system dialog. Previously the "Toujours" guidance only appeared after the first failed attempt.

**iOS Settings deep link fixed (2026-05-13):** `GEO.showLocationSettings()` on iOS previously called `alert()` with a text path; now calls `BackgroundGeolocation.showAppSettings()` which opens the app's own Settings page via `UIApplicationOpenSettingsURLString`. The legacy `prefs:` URL deep-link to system pages remains deprecated and is not used.

**`confirmios` page removed (2026-05-13):** the post-`startgeo` reminder page is unreachable in any state where it would be useful — `startGeoloc()` already rejects unless `AUTHORIZED` (Always), so by the time the user reached `confirmios` they had already configured Always. Replaced with direct route to `checkmotion`.

Files: `www/app/pages.js`, `www/app/app.html`, `www/app/assets/geoloc.js`

#### P3.3 Android 14+ foreground service type ✅ VERIFIED DONE (2026-05-05)

`FOREGROUND_SERVICE_LOCATION` permission and `android:foregroundServiceType="location"` service declaration already present via the background geolocation plugin's `plugin.xml`.

#### P3.3b Android ACCESS_BACKGROUND_LOCATION hard-block ✅ DONE (2026-05-13)

**Problem:** the bg-geo Android facade's `hasPermissions()` only checks `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION`, so a user who picks "While using app" on the system dialog passes `startGeoloc()` with `AUTHORIZED`. On Android 11+ the first dialog no longer offers "Allow all the time"; the user must flip it in Settings. Result before fix: walk silently dies the moment the screen locks.

**Resolution:** new blocking page `checkbgloc` inserted between `startgeo` and `checknotifications` on Android. `GEO.checkBackgroundLocationAndroid()` uses `cordova-plugin-android-permissions` to verify `ACCESS_BACKGROUND_LOCATION`. On Android < 10 the check resolves immediately (permission doesn't exist). First failure triggers `requestPermission()` (may show the system dialog on Android 10, silently denies on 11+); persistent denial polls every 1.5s with a Settings deep link + "J'ai autorisé" retry. No skip button.

Files: `www/app/app.html`, `www/app/pages.js`, `www/app/assets/geoloc.js`

Regression risk: **LOW** — Android < 10 skipped automatically; existing AUTHORIZED-only users (already granted via reinstall) pass instantly.

#### P3.3c iOS motion permission hard-block ✅ DONE (2026-05-13)

**Problem:** the bg-geo plugin starts `CMMotionActivityManager` opportunistically during `start`, which surfaces the iOS Motion auth dialog. The result was not checked. If the user denies, `GEO.motionIsStationary` stays false, the stationary-detection guard in the GPS-lost handler is defeated, and pocketed pauses during the walk trigger spurious "GPS perdu" overlays + audio cues.

**Resolution:** new blocking page `checkmotion` inserted after `startgeo` on iOS. `geoloc.js` now sets `GEO.motionAuthorized = true` on the first `activity` event from the bg-geo plugin. `pages.js` polls for that flag with an 8s soft window — if no event by then, the page renders insistent copy ("Réglages > Flanerie > Mouvement et forme") + Settings deep link + "J'ai autorisé" retry button. Polling continues forever; granting Motion in Settings and returning to the app auto-advances within ~1s. No skip button.

Telemetry: `motion_authorized` (first activity event), `motion_check` (granted/denied + waited_ms).

Files: `www/app/app.html`, `www/app/pages.js`, `www/app/assets/geoloc.js`

Regression risk: **LOW** — granted users skip immediately (event arrives in < 1s typically). 8s wait is conservative.

#### P3.3d Mid-walk authorization + services monitoring ✅ DONE (2026-05-13)

**Problem:** if the user toggled location off in Settings, revoked the app's auth, or downgraded to "While using" *during* the 45-min walk, the app had no signal until the 30s GPS-lost timeout fired, and even then the recovery copy was generic ("Move to an open area") — useless when the actual fix is to re-grant auth in Settings.

**Resolution:**

- `GEO.checkHealth()` helper returns `{servicesEnabled, authorization, bgLocationOk}` in one call.
- `BackgroundGeolocation.on('authorization', ...)` re-emits as `GEO.emit('authorizationChanged', status)`; the pages.js listener shows a dedicated "Autorisation révoquée" overlay during the walk.
- `probeGpsHealth()` fires on every `stateUpdate('lost')` and escalates the transient GPS-lost overlay to "GPS désactivé" / "Autorisation révoquée" copy with a Settings button when the cause is system-level.
- 30s periodic poll while on the parcours page catches Settings-toggle reversals (user disables then re-enables auth without leaving GPS-lost). When health re-passes, the `GPSREVOKED` flag clears and the next `stateUpdate('ok')` hides the overlay.
- Shared `setGpsLostOverlay()` / `showGpsRevokedOverlay()` / `showBatteryKillOverlay()` all reuse the existing `#gpslost-overlay` DOM with a new `#gpslost-settings` Settings button that opens app details via `GEO.showAppSettings()`.

Telemetry: `gps_revoked` (reason: services|auth), `gps_settings_open`.

Files: `www/app/app.html` (added `#gpslost-settings`), `www/app/pages.js`, `www/app/assets/geoloc.js`

#### P3.4 iOS locked-screen GPS-triggered audio start ✅ DONE (2026-05-07)

**Root cause:** iOS WebKit blocks `<audio>.play()` initiated from a background GPS callback when the phone is locked — no user gesture is available and no JS-layer workaround can bypass the restriction. Field tests confirmed warm+preprimed could pass (T8) but cold-start (T9) was unreliable in the HTML5 Howler path.

**Resolution:** `cordova-plugin-media` (`window.Media`, backed by `AVAudioPlayer`) adopted as the iOS playback backend. `AVAudioPlayer` is not subject to WebKit's user-gesture restriction and activates `AVAudioSessionCategoryPlayback` directly.

**What was done:**

1. **`NativeMediaPlayer` class** (`player.js`) — wraps `window.Media` with Howler-compatible event API. Native `numberOfLoops: -1` for infinite loops (eliminates JS loop-restart gap and associated session deactivation window). `pause()` guard prevents spurious events on first-play stabilization.

2. **`httpToNativePath()` helper** (`player.js`) — converts WKWebView `http://localhost/...` URLs to `file://` paths via `LOCALAPP_PATH_NATIVE` / `LOCALMEDIA_PATH_NATIVE`, required because `cordova-plugin-media` bypasses the WKWebView HTTP server.

3. **`LOCALAPP_PATH_NATIVE` / `LOCALMEDIA_PATH_NATIVE`** (`apputils.js`, `launcher.js`) — captured from `dir.nativeURL` before `WkWebView.convertFilePath()` runs. Covers both media files and app-bundle sounds.

4. **`PlayerSimple.load()` iOS branch** — creates `NativeMediaPlayer` on iOS, Howl on Android/browser. Falls back to Howl if path cannot be resolved.

5. **`KeepAVAudioSessionAlwaysActive: YES`** (`config.xml`, `platforms/ios/App/config.xml`) — prevents `CDVSound.m` from calling `setCategory:SoloAmbient` + `setActive:NO` when any one player stops during concurrent multi-channel playback.

6. **`checkaudio` page** (`pages.js`) — converted to `PlayerSimple` so the startup test exercises the same native path used during the walk.

7. **Diagnostic suite** (`diagnostic.js`) — `_makeTestPlayer()` added; T4, T6, T8, T9, T10 use `NativeMediaPlayer` on iOS. T8 prewarm step skipped on iOS (not needed). T3 intentionally keeps Howl for AudioContext diagnostics.

8. **`shouldRequestAudioFocusForPlay()` simplified** — both platforms now request focus only when `AUDIOFOCUS === 0`; iOS no longer needs a background-visibility special case.

Files: `player.js`, `diagnostic.js`, `pages.js`, `apputils.js`, `launcher.js`, `config.xml` (both)  
Regression risk: **MEDIUM** — entire iOS audio path now goes through `cordova-plugin-media`. Full locked-screen parcours walk on iOS required before deployment.

Acceptance:
- GPS-triggered audio starts correctly on iOS while locked (cold-start and warm-start).
- T9 passes in the diagnostic suite.
- Concurrent multi-channel playback is uninterrupted across loop restarts.
- Android and browser walks are unaffected.

#### P3.5 Voice position resume across app restart ✅ PARTIAL (2026-05-13)

Step voice playback position is now saved to localStorage and restored (minus 3s rewind) when the user re-enters the step zone after a crash, force-quit, or deep sleep restart.

**What was done:**
- `state.resumeStepVoicePos` added to Parcours state (survives localStorage round-trip).
- `snapshotVoicePosition()` reads the live voice seek position from the active step player (only when `playstate === 'play'`; afterplay restarts from 0 by design).
- `store()` calls `snapshotVoicePosition()` before every localStorage write.
- `startTracking()` adds two save triggers: 10s periodic store (foreground crash coverage) + `document.pause` listener (exact save at backgrounding moment).
- GPS background callback (`_callbackPosition`): `PARCOURS.store()` called while JS is awake inside each background task window — ~1s cadence while backgrounded, closing the gap between `document.pause` and a system kill.
- `PlayerStep.play(seekPos)` forwards seek to `PlayerSimple`; `Step.updatePosition()` consumes `resumeStepVoicePos` (one-time, zeroed on use) when `wasCurrentStep && action === 'play'`.

**Scope:** Step voice only. Afterplay and all other player types (Zone, Offlimit) are unaffected.

**Resume path when user is outside the zone at restart:** step silently waits; fire block only executes when `near() && inside` — the saved position is applied on re-entry.

**Remaining gap — Plan B [RESEARCH-FIRST]:**

`PARCOURS.store()` during a GPS callback reads `_positionSec`, which is updated by the 250ms poll setInterval. That interval is frozen when JS is suspended; it may or may not catch up when JS wakes for a GPS task (platform-dependent). To guarantee freshness: explicitly call `media.getCurrentPosition()` from within the GPS background task and update `resumeStepVoicePos` from the async native response before calling `store()`. Requires coupling geoloc.js → NativeMediaPlayer internal, cleanest via a new `PARCOURS.refreshVoicePositionFromNative(cb)` method.

**Remaining gap — Plan C [RESEARCH-FIRST, native plugin work]:**

If the system kills the app between GPS callbacks (no JS execution), the last GPS-triggered save is used — worst case 1–2s drift. To close this entirely: extend `cordova-plugin-media` with native hooks that write `AVAudioPlayer.currentTime` (iOS) or `MediaPlayer.getCurrentPosition()` (Android) directly to `NSUserDefaults` / `SharedPreferences` on `applicationDidEnterBackground` / `onPause`. On JS startup, read native storage and inject the value into `state.resumeStepVoicePos`. Fully JS-independent, survives any kill scenario.

Files: `www/app/assets/parcours.js`, `www/app/assets/player.js`, `www/app/assets/spot.js`, `www/app/assets/geoloc.js`

---

### C: Cordova container findings

#### C1 Audiofocus plugin ✅ DONE (2026-05-05, follow-up 2026-05-06)

Upgraded to v1.2.0 in the fork (commit `69915be`), deployed to FlanerieCordova.

1. **Android:** `AUDIOFOCUS_GAIN_TRANSIENT` → `AUDIOFOCUS_GAIN` (correct for a 45-minute walk); modern `AudioFocusRequest` API on Android 8+ with deprecated fallback for API 23-25.
2. **iOS:** New `AudioFocus.m` — sets `AVAudioSessionCategoryPlayback`, registers for `AVAudioSessionInterruptionNotification`. Emits `AUDIOFOCUS_LOSS` on interruption begin; emits `AUDIOFOCUS_GAIN` only when `ShouldResume` is present and `setActive:YES` succeeds. Prevents unwanted auto-resume after interruptions iOS expects to stay paused.
3. **App config:** duplicate plugin identity removed, `package-lock.json` resolved to fork commit.

Files: `cordova-plugin-audiofocus/src/android/AudioFocus.java`, `cordova-plugin-audiofocus/src/ios/AudioFocus.m` (new), `plugin.xml`, `FlanerieCordova/package.json`, `package-lock.json`

#### C1b Android: `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` in audiofocus plugin ✅ DONE (2026-05-06)

v1.3.0: new `AudioFocusService.java` starts a `mediaPlayback` foreground service on API 29+ (graceful fallback on 24-28), started on `AUDIOFOCUS_REQUEST_GRANTED`, stopped in `cancelFocus()`. Signals to OEM battery savers (Samsung, Xiaomi) that audio is active and should be protected independently of the GPS location service.

Requires plugin reinstall: `cordova plugin remove com.maigre.cordova.plugins.audiofocus && cordova plugin add /path/to/fork`

#### C2 Upgrade candidates ✅ DONE (2026-05-07) — built and deployed

| Dependency | Was | Now | Relevant impact |
|---|---|---|---|
| `cordova-background-geolocation-plugin` | 2.3.2 | 2.4.0 | All v2.4.0 fixes (see P0.5) |
| `cordova-plugin-local-notification` | 1.2.0 | 1.2.3 | `ClickActivity` rename fix, AndroidX Core 1.13.0 |
| `cordova-android` | 14.0.1 | 15.0.0 | SDK 36, AGP 8.10.1, Kotlin 2.1.21, minSdk 23→24 |
| `cordova-ios` | 7.1.1 | 8.0.1 | Requires Xcode 15+ |

**Rebuild sequence (run in `FlanerieCordova/`):**
```bash
npm install
cordova platform remove android ios
cordova platform add android ios
cordova plugin remove cordova-plugin-local-notification
cordova plugin add cordova-plugin-local-notification@1.2.3
cordova build android
cordova build ios
```
Android SDK 36 + Build Tools 36.0.0 must be installed via SDK Manager first.

#### C3 Launcher cache-buster regex [accepted, low priority]

`app_run()` in `apputils.js` replaces `.js` globally in `app.html`, which would corrupt `.json` references if any appear. Currently safe — no JSON script tags. Fix if `app.html` structure changes.

#### C4 Container build checklist [open]

No reproducible build checklist or smoke-test script. Add a minimal one (Android debug build + iOS prepare in Xcode) before the next platform upgrade.

**Known reinstall requirements** to bake into the checklist when written:
- `cordova-plugin-media` — install variable `KEEP_AVAUDIOSESSION_ALWAYS_ACTIVE` changed `NO` → `YES` (2026-05-13, P1.11b). Variable is read at plugin install time only; existing builds keep the old value. Required step on next build: `cordova plugin remove cordova-plugin-media && cordova plugin add cordova-plugin-media@7.0.0` OR `cordova platform remove ios && cordova platform add ios`.
- After build: verify `platforms/ios/App/config.xml` contains `<preference name="KeepAVAudioSessionAlwaysActive" value="YES" />` (lowercased key `keepavaudiosessionalwaysactive` is what `CDVSound.m:38` actually reads).

#### C5 Deferred plugin fork — power optimization [open, scheduled next session]

**Status:** scoped 2026-05-13, deferred (cannot republish the app this session). The JS-only fixes for known bugs and manufacturer-tailored copy are already shipped under P1.12 — this entry covers what requires forking `cordova-plugin-power-optimization` (currently `github:snt1017/cordova-plugin-power-optimization`) and adding native code.

**Why fork:**

The current plugin handles only Doze (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) and a stale OEM intent list. Everything else that actually kills a foreground service on modern Android is invisible to it. For a 45-min locked-pocket walk, the biggest unhandled signals are stock-Android background restriction and OEM-specific sleep features (Samsung "Apps en veille profonde", Xiaomi autostart, etc.).

**Java methods to add:**

| Method | API | Purpose |
|---|---|---|
| `IsBackgroundRestricted()` | 28+ | `ActivityManager.isBackgroundRestricted()` — single biggest missing signal; user toggled "Restrict background activity" → FG service killed at lock within seconds |
| `IsPowerSaveMode()` | universal | `PowerManager.isPowerSaveMode()` — phone-wide battery saver; soft warning, user may need it |
| `GetStandbyBucket()` | 28+ | `UsageStatsManager.getAppStandbyBucket()` — `RESTRICTED`/`RARE` buckets throttle aggressively |
| `IsAutoRevokeWhitelisted()` | 30+ | `PackageManager.isAutoRevokeWhitelisted()` — hibernation watch (long-tail) |
| `RequestAutoRevokeWhitelist()` | 30+ | `Intent.ACTION_AUTO_REVOKE_PERMISSIONS` |
| `GetManufacturer()` | universal | `Build.MANUFACTURER` + `Build.MODEL` — already available via `cordova-plugin-device` but useful for plugin self-tests |
| `OpenAppDetailsSettings()` | universal | `ACTION_APPLICATION_DETAILS_SETTINGS` — universal fallback when OEM intents fail |
| `RequestOptimizationsMenu()` **FIX** | 23+ | Existing method's `if (pm.isIgnoringBatteryOptimizations(...))` conditional is inverted — opens settings page only when already whitelisted. Either remove the guard or invert it. JS fix already in P1.12 (button now bypasses to `showAppSettings()`), so this is cleanup. |

**OEM intent table expansion (`Constants.java`):**

Current coverage: Xiaomi (1 partial), Samsung (4 intents all pre-Android 10), Huawei, LeTV, Meizu. Missing: OnePlus, Oppo, Realme, Vivo, Honor, modern Samsung. Add intents from `dontkillmyapp.com` as starting list:

- Samsung One UI 4+: `com.samsung.android.lool/.battery.app.power.AppSleepingActivity` and `com.samsung.android.sm/.SmartManagerDashBoardActivity`
- OnePlus: `com.oneplus.security/.com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity`
- Oppo/Realme: `com.coloros.safecenter/.startupapp.StartupAppListActivity`
- Vivo: `com.vivo.permissionmanager/.activity.BgStartUpManagerActivity`
- Honor: `com.hihonor.systemmanager/.startupmgr.ui.StartupNormalAppListActivity` (and the legacy `com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity` for pre-split Honor)

**JS wrappers (`www/PowerOptimization.js`):** add corresponding promise-returning exports for each new method.

**UX integration in `pages.js` (`checkbatteryopt`) once fork is live:**

1. **Hard-block on `isBackgroundRestricted() === true`** — render specific copy ("Activité en arrière-plan restreinte: ouvrez Réglages > Apps > Flanerie > Batterie > Non restreint") + Settings button. Re-poll until cleared.
2. **Soft-warn on `isPowerSaveMode() === true`** — show advisory banner ("Économiseur de batterie actif — peut interrompre la marche"). Continue, do not block. Telemetry only on user choice.
3. **Telemetry on `getAppStandbyBucket()`** — log bucket once during onboarding. No UX impact for a single walk.
4. **Optional: pre-check during onboarding even before `checkbatteryopt`** to fail fast.

**Mid-walk integration:**

- Add `isBackgroundRestricted()` to the existing 30s `checkHealth()` poll (currently checks services + auth + bg-location). If it flips true mid-walk, escalate to `showBatteryKillOverlay()` immediately rather than waiting for two unexpected bg-geo `'stop'` events.

**Hard-block gate map (target state after fork):**

| Layer | Today | After fork |
|---|---|---|
| Doze whitelist | hard-block ✅ | hard-block ✅ |
| Background restricted | not detected ❌ | **hard-block** |
| Battery saver | not detected ❌ | soft warn |
| Standby bucket | not detected ❌ | telemetry only |
| Auto-revoke / hibernation | not detected ❌ | skip (long-tail, irrelevant for a single walk) |
| Samsung Sleeping apps | OEM-banner advisory | hard-block + manufacturer-tailored copy (text already shipped in P1.12) |
| Other OEM autostart | OEM-banner advisory (stale intents) | hard-block + updated intent table + tailored copy |

**Files to be modified:**

- Fork → `~/Bakery/cordova-plugin-power-optimization/` (match the existing pattern with `cordova-plugin-audiofocus` and `cordova-background-geolocation-plugin`)
- `src/android/PowerOptimization.java` — add 7 methods, fix `RequestOptimizationsMenu` conditional
- `src/android/Constants.java` — extend OEM intent table
- `www/PowerOptimization.js` — add JS wrappers
- `plugin.xml` — bump version, add new permissions if any (none needed for the queries themselves; `PACKAGE_USAGE_STATS` would be required for `getAppStandbyBucket()` accurate bucket — but the API works without it, just returns `STANDBY_BUCKET_ACTIVE` by default; leave permission optional)
- `FlanerieCordova/package.json` — point dependency at the fork
- `FlanerieAudioMap/www/app/pages.js` — wire new gates in `checkbatteryopt`, extend mid-walk health probe
- `FlanerieAudioMap/www/app/app.html` — add restricted-state copy slots if needed

**Estimated effort:** half a day. Most of it is Java boilerplate + OEM-intent research; UX wiring is incremental on top of P1.12.

**Regression risk after fork:** **MEDIUM** — hard-blocking on `isBackgroundRestricted` will catch real users whose phones are misconfigured; need a clear escape path (Settings deep link + retry) and field validation on a Samsung device known to background-restrict by default.

#### C6 Deferred audiofocus plugin fork extension — iOS interruption without ShouldResume [open, scheduled next session]

**Status:** scoped 2026-05-13, deferred (requires native iOS code change in the audiofocus fork; cannot republish this session). Surfaced by the audio-stack review on the same date.

**Problem:**

[AudioFocus.m:74–82](../cordova-plugin-audiofocus/src/ios/AudioFocus.m#L74-L82) only reactivates AVAudioSession and emits `AUDIOFOCUS_GAIN` when `AVAudioSessionInterruptionOptionShouldResume` is present on the interruption-end notification. Apple's docs say "the option may or may not be present" — it is typically **absent** after Siri, sometimes absent after a call, and routinely absent after alarms/timers.

When the option is absent today:
- `pauseAllPlayers()` already ran on `AUDIOFOCUS_LOSS`.
- `#resume-overlay` is shown — but the walker is in their pocket, screen locked.
- No subsequent event ever fires. Audio stays paused for the rest of the walk.
- `document.resume` (foregrounding) calls `resumeAudioContext()` for Howler but does **not** reactivate AVAudioSession or unpause `PAUSED_PLAYERS`.

**Resolution plan (next session):**

In `cordova-plugin-audiofocus/src/ios/AudioFocus.m`, in the `AVAudioSessionInterruptionTypeEnded` branch:

```objc
// Current behaviour: only resume if iOS hints we should.
// New behaviour: always attempt to reactivate the session; emit a soft GAIN
// event so the JS layer can re-request focus on the next user gesture
// (foregrounding, screen unlock, gpslost-overlay button) without the user
// having to find the resume-overlay button.
if (options & AVAudioSessionInterruptionOptionShouldResume) {
    // existing path — emit hard AUDIOFOCUS_GAIN
}
else {
    NSError *err = nil;
    [session setActive:YES error:&err];
    // New event type — soft signal, JS may auto-resume or wait for user gesture.
    [self sendFocusChange:@"AUDIOFOCUS_GAIN_AVAILABLE"];
}
```

**JS-side wiring (`www/app/assets/player.js`):**

Add `AUDIOFOCUS_GAIN_AVAILABLE` branch to the `onFocusChange` switch:

```js
else if (focusState === "AUDIOFOCUS_GAIN_AVAILABLE") {
    // iOS interruption ended without ShouldResume. Don't auto-resume blindly
    // (the system explicitly told us not to), but allow the next user gesture
    // to re-request focus cleanly. Tag the resume-overlay so the button click
    // path does the right thing.
    AUDIOFOCUS = 0;
    TELEMETRY.log('audiofocus_gain_available', {paused: PAUSED_PLAYERS.length});
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
```

Plus a `document.resume` handler retry: when the user unlocks the screen and `AUDIOFOCUS === 0 && PAUSED_PLAYERS.length > 0`, automatically call `requestAudioFocus()`. That'll re-activate the session and `resumeAllPlayers()` runs through the existing `AUDIOFOCUS_GAIN` callback.

**Alternative (more aggressive):** in iOS plugin, on interruption end without ShouldResume, attempt `setActive:YES` AND emit hard `AUDIOFOCUS_GAIN` unconditionally if the activation succeeds. This auto-resumes audio in all cases. Risk: a user who explicitly invoked Siri and *wanted* audio to stay paused gets it resumed anyway. Lower risk for the Flanerie use case (sole-app walking experience) than for a general media player, but worth verifying field reaction.

**Files to be modified:**

- Fork → `~/Bakery/cordova-plugin-audiofocus/src/ios/AudioFocus.m`
- `cordova-plugin-audiofocus/plugin.xml` (bump version)
- `cordova-plugin-audiofocus/www/AudioFocus.js` (no change unless we expose the new event name)
- `FlanerieAudioMap/www/app/assets/player.js` — handle the new event, add `document.resume` retry

**Estimated effort:** ~30 min plugin + 15 min JS + iOS device test loop.

**Regression risk after fork:** **LOW** — the new path only fires when the *old* path would silently fail. The conservative (`AUDIOFOCUS_GAIN_AVAILABLE` + manual retry) variant doesn't change behaviour for users whose iOS already includes ShouldResume.

---

## Recommended Execution Sequence

### Awaiting field validation (shipped, build pending or untested)

- **C2** platform/plugin upgrades — configured, rebuild pending (Android SDK 36 + cordova-ios 8 + plugins)
- **P1.11b** audio stack hardening (2026-05-13) — iOS Howler-fallback gate, AUDIOFOCUS=-1 gate, KEEP_AVAUDIOSESSION alignment, 15s watchdog, distinctive vibration. **Requires cordova-plugin-media reinstall** for the install variable to take effect (see C4).
- **P1.12** battery-opt: broken settings button fix, OEM-banner detection fix, manufacturer-tailored copy, mid-walk OEM-kill heuristic
- **P1.18** LOST state machine — needs a walk that deliberately drifts >50m from the next step to verify the 15s sustain timer, band rendering, audio cue, and the kill-and-relaunch resume path (state survives in localStorage)
- **P1.19** voice / afterplay fallback — needs validation on a parcours with intentionally missing/broken voice or afterplay files (use the P1.22 tools page to force-trigger on a healthy parcours)
- **P1.20** RESUME cue — verify it plays once on relaunch and not on normal entry
- **P1.21** AUDIOFOCUS auto-retry — verify the 60s retry actually recovers audio on a Samsung where AUDIOFOCUS_GAIN is known to drop after a phone call
- **P3.2** confirmgeo Toujours copy front-loaded + iOS Settings deep link + `confirmios` page removed
- **P3.3b** Android `ACCESS_BACKGROUND_LOCATION` hard-block — needs validation on a fresh Android 11+ install where the first dialog silently denies "Allow all the time"
- **P3.3c** iOS motion permission hard-block
- **P3.3d** mid-walk authorization + services + bg-location monitoring
- **P3.4** iOS NativeMediaPlayer migration — diagnostic suite passes; locked-screen full-parcours walk still pending
- **P0.1** stationary handler churn removed
- **P0.5** v2.4.0 GPS fork (deployed)
- **P1.5c** GPS-lost timeout unified at 30s

### Next implementation session (cannot republish this session)

- **C5 Power optimization plugin fork** — `isBackgroundRestricted` hard-block, `isPowerSaveMode` soft warn, standby bucket telemetry, modern OEM intent table, fix `RequestOptimizationsMenu` inverted conditional. Unlocks the hard-block path for manufacturer-tailored copy already shipped in P1.12. Est. half a day.
- **C6 Audiofocus plugin fork extension** — iOS interruption-end without `ShouldResume`: emit `AUDIOFOCUS_GAIN_AVAILABLE`, add `document.resume` retry in JS. Closes the silent-pause-forever failure after Siri / alarm. Est. ~45 min.
- **P0.5 Fix 1e** Android AlarmManager JS wakeup (only if WebView-suspended-despite-FG-service shows up in telemetry)
- **P3.5 Plan B** native `getCurrentPosition()` during GPS tasks (only if `_positionSec` staleness shows up)
- **P3.5 Plan C** native plugin save on `applicationDidEnterBackground` / `onPause` (only if Plan B insufficient)

### Conditional / not yet decided

- **P0.5 Fix 3 (DistanceFilterLocationProvider)** or **Fix 4 (FusedLocationProvider)** — only if Android GPS reliability remains a field problem after v2.4.0
- **P1.5** full timer/listener audit — only if leak symptoms surface

### Low priority / accepted

- **P0.2** background validation UX (currently bypassed — keep bypassed)
- **P1.7** resume/version-safe state
- **P1.8** step progression audit
- **P1.15** GIVORS_V3 last-step investigation (requires server-side JSON)
- **P2.10** telemetry gaps (AVAudioSession snapshots, preload events)
- **C3** launcher cache-buster regex
- **C4** build checklist — partially scoped under C4 already; full write-up still open

---

## Validation Matrix

### GPS and lifecycle
- Android 13+ fresh install: grant/deny location and notifications in different orders
- Android 11+ fresh install: pick "While using app" on the first dialog → `checkbgloc` must hard-block with Settings deep link; granting "Allow all the time" in Settings and returning must auto-advance
- Android device with battery saver enabled
- Android device left stationary for several minutes mid-walk
- Android device with "Restrict background activity" toggled in Settings → walk should fail at lockscreen today; after C5 fork: `checkbatteryopt` hard-blocks
- Samsung device with default "Apps en veille profonde" auto-add behaviour: verify the tailored copy is shown and Settings link works
- Mid-walk: toggle location services off in shade → "GPS désactivé" overlay must appear within 30s; re-enable → overlay must auto-clear at next fix
- Mid-walk: revoke location auth via app Settings → "Autorisation révoquée" overlay must appear; re-grant → overlay must auto-clear
- Two unexpected bg-geo `'stop'` events within 5 min (force-stop the service via adb on Android) → battery-kill overlay must appear with manufacturer-tailored copy
- iPhone with location set to `While Using` then changed to `Always`
- iPhone fresh install: deny motion auth → `checkmotion` must hard-block with Settings deep link; granting in Settings and returning must auto-advance within ~1s
- iPhone left stationary: verify no false "GPS lost" audio cue (depends on motion auth granted)
- Lock phone during parcours and keep it in pocket for extended time
- Resume after accidental app foreground/background transitions

### Audio
- Audio continues playing after screen lock on both platforms
- Audio resumes correctly after phone call interruption (AudioFocus loss/gain)
- Audio does not auto-resume on iOS when the interruption ends without `ShouldResume` (today: stays paused indefinitely — closes with C6 fork)
- iOS: trigger Siri mid-walk and dismiss it → audio likely stays paused (verifies the C6 failure mode is reproducible)
- Transient notification/navigation prompts duck active audio and restore volume on gain
- Step transition triggers correct audio (voice plays, not afterplay, on first entry)
- Audio from previous step stops cleanly when entering next step zone
- Lock phone during active audio playback, wait 2 minutes, unlock: verify audio still playing
- Background the app for 5 minutes, foreground: verify AudioContext is running (not suspended)
- Walk along a zone boundary for 30 seconds: verify no audio glitching or excessive load/unload
- Verify vibration feedback: GPS loss is `[500, 200, 500]`; audio focus loss is `[300, 150, 300, 150, 300]` (triple pulse — distinct from GPS); audio focus gain is `[100, 80, 100]` (double pulse)
- iOS: simulate `httpToNativePath()` returning null (e.g., unset `document.LOCALMEDIA_PATH_NATIVE` in console) → `checkaudio` must hard-fail with red error, accept button hidden
- Both platforms: simulate `AUDIOFOCUS === -1` (audiofocus plugin disabled) → `checkaudio` must hard-fail with "module audio non disponible" copy
- Voice → afterplay transition on iOS with locked screen: verify no audio gap (validates `KEEP_AVAUDIOSESSION_ALWAYS_ACTIVE=YES` propagated to runtime after plugin reinstall)
- Large MP3 (>5MB) load + play: verify the 15s play-timeout watchdog doesn't trip; if it does, `audio_play_timeout` telemetry surfaces in the dashboard
- Step with deliberately broken voice file: voice fires `playerror` → step skips to afterplay automatically; `step_voice_failed` telemetry recorded (P1.19). Devmode shortcut: tools page "Voix HS sur étape courante"
- Step with no `afterplay.src` (or broken file): voice ends → `DEFAULT_AFTERPLAY_PLAYER` loop plays from `images/afterplay.mp3`; `step_afterplay_fallback` telemetry recorded with `reason` (P1.19). Devmode shortcut: tools page "Afterplay générique sur étape courante"
- Kill the app mid-step (active step playing voice), relaunch on parcours page: `RESUME_PLAYER` plays once; voice resumes from saved position (P1.20 + P3.5)
- Android device known to drop `AUDIOFOCUS_GAIN` after a phone call: trigger a call, hang up, leave phone locked. After 60s the auto-retry should re-acquire focus and resume audio; `audiofocus_auto_retry` telemetry recorded (P1.21)

### LOST state
- Walk deliberately >50m away from the next/active step for >15s (and keep moving — `motionIsStationary` defeats the entry timer): `#lost-band` appears, `LOST_PLAYER` loop plays if bundled, active step pauses, zones/offlimits go silent. Walking back into the zone clears the band and resumes the active step on the next position tick
- Force-kill the app while LOST, relaunch on parcours page: band reappears immediately via `applyLostUI()`; `recover` fires automatically if the walker came back into range while the app was dead
- Verify `user_lost` / `user_recovered` telemetry pairs surface in the report with median recovery delta
- Devmode shortcut: tools page "Forcer LOST" / "Sortir de LOST" exercise the same handlers without needing to walk away

### Data and startup
- Start route with no data link after media preload
- Repeat pre-start testing on the same device before sending a visitor
- Reload app mid-parcours and verify resume from correct step
- Verify "Je suis perdu.e !" button shows a useful map (or graceful fallback if offline)

### Plugin resilience
- Simulate missing plugin build for audio focus or notifications where possible

### Platform-specific
- Android 14+ device: verify BackgroundGeolocation foreground service starts correctly
- Android with aggressive battery saver (Samsung/Xiaomi): verify GPS survives 10+ minutes of locked-screen walking
- iOS fresh install: verify "While Using" → "Always" location permission progression is not a dead end
- iOS: run full diagnostic suite — T4, T8, T9 must all pass with NativeMediaPlayer path
- iOS: full parcours locked-screen walk — GPS-triggered audio starts reliably from pocket (cold and warm), concurrent channels uninterrupted, rewind-on-pause works correctly

---

## FLANERIE_ELYSEE-Specific Audit

- Verify every referenced step folder exists under `media/flanerie_elysee_v5/`
- Verify every referenced media file exists in its corresponding folder
- Walk through published step order manually
- Review optional-step behavior before changing sequencing logic (all steps are `optional: false` — the inverted logic bug is dormant)
- Review end-of-route cutoff behavior: `cutoff: 7` means GPS tracking stops 7 seconds after last step fires — verify this is long enough for the last audio block
- Check for polygon overlaps between adjacent steps (BLOC_07→08, BLOC_08→09 are very close) — verify no double-trigger in practice
- Verify the "Je suis perdu.e !" map works when offline (tile cache is currently disabled)
- Check `www/app/images/` MP3 fallbacks: `afterplay.mp3` (DEFAULT_AFTERPLAY_PLAYER, P1.19), `resume.mp3` (RESUME_PLAYER, P1.20), `youlost.mp3` (LOST_PLAYER, P1.18). Ship with `_`-prefixed placeholders so the loader silently no-ops; the operator must rename them to enable the cues for a given show.

---

## Known Dormant Bugs

Issues that exist in code but do not manifest on FLANERIE_ELYSEE. Track before conditions change.

### Inverted optional/mandatory step logic
- `!(s._spot.optional === false)` in `spot.js:628` filters for optional steps but the variable is named `mandatory`. Used only to log a warning about previous unrealised steps. Dormant because FLANERIE_ELYSEE has `optional: false` everywhere.
- Files: `www/app/assets/spot.js`

---

## Fixed Bugs (archive)

Short bugs not tracked under a numbered P-section. Each P1.X / P3.X entry above is the authoritative record for items with a number.

- **iOS html5 seek/fade limitations** — resolved by NativeMediaPlayer migration (P3.4); `Media.seekTo()` is reliable. (`player.js`)
- **Dual silent players in parcours page** — redundant `testplayer` silent keepalive removed; `testplayer` is now scoped to the `checkaudio` test only. (`pages.js`)
- **Console.log HTML injection in dev panel** — `_logsAppend()` helper with `$('<span>').text()`. (`common.js`)
- **`PlayerSimple._playRequested` stuck flag** — reset in `loaderror` / `playerror` handlers; safety timeout added (was 5s, bumped to 15s in P1.11b). (`player.js`)
- **Zone audio boundary thrashing** — `UNLOAD_EXTRA_HYSTERESIS = 10m` dead-band prevents oscillation at zone edge. (`spot.js`)
- **Audio loaderror infinite re-fire loop** — `PlayerStep.hasError()` + near-reload guard in `Spot.updatePosition()` blocks reload after loaderror, preventing state reset that triggered 1Hz re-fire. (`player.js`, `spot.js`)
- **GPS drift re-fire during loading** — `_active` flag in `Step`: set on fire, cleared on done/clear; `!_active` added to fire condition. `step_refire_blocked` telemetry added. (`spot.js`)
- **`step_skip_done` spam** — `_skipDoneLogged` flag limits emission to once per step completion. (`spot.js`)
- **`allSteps` global leak on parcours rebuild** — `allSteps = []` added to `Parcours.clear()` after per-step `clear()` calls. Confirmed in `parcours.js:30`. (`parcours.js`)
- **`this._player.paused is not a function` on step stop** — P1.18/P1.19 work introduced `this._player.paused()` calls in `PlayerSimple.stop()`, `isPaused()`, `stopOut()`. `NativeMediaPlayer` exposes `paused()` (iOS path) but Howler's `Howl` does not, so any Howl-backed step crashed on stop. Added `PlayerSimple._isUnderlyingPaused()` helper: delegates to `paused()` when present, otherwise peeks at `Howl._sounds[0]._paused`. (`player.js`)

---

## Trivial Code Fixes ✅ DONE (2026-03-14)

Applied without behavioral risk.

- **P1.9a** `setCoords()` ignores its parameter — fixed in `parcours.js`.
- **P1.9b** `checkBGPosition()` wrong `this` context — `this.lastPosition` → `GEO.lastPosition` in `geoloc.js`.
- **P1.9c** `delete testplayer` no-op — replaced with `testplayer = null` (two occurrences in `pages.js`).
- **P1.9d** Dead GPS error handler removed from `startgeo`; `noLockMode` flag removed from pages.js (never read).
