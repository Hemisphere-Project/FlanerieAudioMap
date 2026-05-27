# Mobile Audit Remediation Plan

Original: 2026-04-27  
Last updated: 2026-05-26 (Round 8.5 / Phase 1B partial — 4 field-data-independent items shipped early: R7.2 default-afterplay map gating, B1 past-step media unload, A6 parcours freshness check, C2 passive media integrity)
Previous: 2026-05-26 (Round 8 / Phase 1A — 5 behaviour fixes + 10 diagnostic additions, JS-only, no plugin rebuild: A4 cross-step voice-pos contamination, C1 audio error classification, D1 iOS 26.3.x onboarding warning, A7 end-of-walk session close, A5 persistent device UUID + server registry; B4-diag/F-G2/F-A1/F-Z1/F-Z2/F-Z3/F-N3/F-R1/F-R2/F-K3 diagnostic telemetry)
Previous: 2026-05-20 (Round 7 — field test 2026-05-20 telemetry batch, FLANERIE_GIVORS, ~39 visitor walks: iOS 26.3.x background-GPS blackout P1.34, iOS step-narration playerror R7.1, recovery-map auto-open regression R7.2, iOS audiofocus-request-fail flood R7.3. New reusable analysis tooling in `telemetry/scripts/` R7.0)  
Previous: 2026-05-20 (P1.33 — Android GPS cold-start: `RawLocationProvider` also requests `NETWORK_PROVIDER` + delivers last-known-network fix immediately on start)  
Previous: 2026-05-19 (Round 6 — `checkbatteryopt` silent-bypass root-cause fix R6.1: `device.version` is OS version string not API level, `apiLevel < 23` was always true, page has bypassed itself on every device since introduction; `IsPowerSaveMode` hard block R6.2: power save now Gate 0 in `check()`, walker cannot proceed while battery saver is on; diagnostic telemetry R6.3: `session_diag` + `power_state_at_parcours` logged at parcours entry)
Previous: 2026-05-19 (Round 5 — native plugin work targeting Samsung A41 BLOC_14→BLOC_15 OEM-kill repro from 2026-05-18 colleague report: audiofocus mediaPlayback foreground service keepalive R5.1, power-optimization `IsBackgroundRestricted()` detection R5.2 closing the urgent subset of C5, audiofocus iOS interruption-without-ShouldResume R5.3 closing the full C6 backlog. Requires plugin reinstall + APK rebuild + Play Store upgrade)  
Previous: 2026-05-18 (Round 4 telemetry batch — 22 sessions across 8 devices on FLANERIE_GIVORS_V7_CBR: parcours_restore lifecycle fix R4.2, audio_play_timeout truth check + retry R4.4, voice_snapshot truth-check fields R4.5, gps_callback_gap threshold tuning R4.6, step_afterplay_fallback / step_voice_failed step-name enrichment R4.7, user_recovered distance clamp R4.8, voice_snapshot_skipped throttling R4.9. Two field-test items deferred to dedicated outings: Android first-voice cold-load hang R4.1 and Android Doze GPS blackouts R4.3 / P1.31)  
Previous: 2026-05-18 (Round 3 — field test 2026-05-15 on FRAPPAZ_V10-modif_monnot, 13 sessions across 9 devices: off-route popup title fix P1.30, voice-snapshot lifecycle telemetry P3.5b, Android Doze GPS blackout flagged P1.31, fresh-parcours any-step entry confirmed accepted, iPhone 8 first-install network sensitivity P1.32 — demoted to LOW after the 4G-tether vs domestic-WiFi finding)  
Previous: 2026-05-14 (Round 2 codebase review: resume `update()` gate P1.23, `init()` no-op listener removal P1.24, LOST↔afterplay/step-progression unification P1.25, GPS stop on walk end P1.26, duplicate `step_done` guard P1.27, page-exit cleanup gaps P1.28, recovery map on default-afterplay P1.29, defensive hardening cluster P2.12, telemetry session key P2.13, resume gate fast-path P2.14, structural refactors P3.6, server resilience C7)  
Previous: 2026-05-13 (LOST state machine P1.18, voice/afterplay fallback P1.19, RESUME cue P1.20, AUDIOFOCUS auto-retry P1.21, devmode tools page P1.22, paused() crash fix; Architecture Summary + telemetry list aligned with current code)  
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

#### P1.8 Step progression logic audit ✅ DONE (2026-05-14, via P1.25) [RESEARCH-FIRST]

Known: `!(s._spot.optional === false)` in `spot.js` is inverted logic — names the result `mandatory` but filters for optional steps. Dormant because FLANERIE_ELYSEE has `optional: false` on all steps.

**Round 2 confirmation (2026-05-14):** the inversion is total — for an all-mandatory parcours the gate is *entirely dead* (a walker could skip a mandatory step), and with optional steps it blocks wrongly. The concrete fix is dropping the `!`: `s._spot.optional === false`. This is now scoped together with the LOST recovery model under **P1.25** (the two must stay consistent: "which steps can the walker resume into" drives both the fire-gate and LOST recovery). Still requires full walk-through validation.

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

**Round 2 follow-up (2026-05-14):** `lostTarget()` keys off `_done`, which flips true the instant voice ends and afterplay *starts* — so the entire afterplay phase already targets the *next* step. A walker correctly walking from step N to a step N+1 that is >50m away trips LOST mid-afterplay. Recovery is also single-target (`distanceToBorder(lostTarget()) < 0`), which doesn't match the operational model where steps are near-contiguous and a walker may legitimately catch back at the active, next, or any later step whose intervening steps are optional. Reworked under **P1.25**.

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

### P1 (Round 2 — codebase review 2026-05-14)

These came out of a full read of `www/app` + `server.js` against the operational model. None is a P0-class production blocker, but P1.23–P1.25 are correctness issues with real field impact.

#### P1.23 Resume — `Parcours.update()` runs before the parcours page ✅ DONE (2026-05-14) [TEST-FIRST]

**Problem:** `state.geoMode` is persisted by `store()` and restored by `restore()→build()`. On a kill-and-relaunch mid-walk it comes back as `'gps'`, so `Parcours.update()` stops being gated the moment GPS starts at `startgeo` — several onboarding pages before the walker reaches `parcours` (`checkmotion` alone polls up to 8s, then `checkbgloc` / `checknotifications` / `checkbatteryopt`). During that window `Step.updatePosition` can fire a step and start playing audio under an onboarding page, while the `fire` / `done` / `enter` / `leave` handlers (registered *inside* `PAGES['parcours']`) aren't attached yet — map markers, `step_fire` telemetry, and the RESUME cue desync.

**Resolution:** `Parcours.update()` now early-returns unless `currentPage === 'parcours'` (`typeof` guard for load-order safety). `geoMode` is left persisted — `checkgeo` still reads `geomode()` for the DEVMODE simulate-resume convenience, and with the page gate in place a restored `geoMode` is harmless (the normal flow already only sets `geoMode` via `startTracking()` on the parcours page).

Files: `www/app/assets/parcours.js`

Regression risk: **MEDIUM** — touches the single position-processing entry point. Validate a real kill+relaunch walk: audio must not start before the parcours page, and the resume branch must still pick up correctly. Also re-verify simulate mode (positions still only matter once on the parcours page).

#### P1.24 `GeoLoc.init()` no-op `removeAllListeners()` ✅ DONE (2026-05-14) [SAFE-TODAY]

**Problem:** `EventEmitter.removeAllListeners(event)` does `delete this._events[event]`. `init()` calls it with **no argument** → `delete this._events[undefined]` → does nothing, despite the comment "unbind all events". Today this is accidentally load-bearing: `stateUpdate` / `authorizationChanged` / `bgServiceStop` survive `init()`, which is what's needed. But the day anyone "fixes" `removeAllListeners()` to standard Node semantics (clear-all when no arg), `init()` silently wipes GPS-lost / revoked / battery-kill detection.

**Resolution:** remove the `this.removeAllListeners()` call from `init()` (it does nothing useful). If a real reset is ever wanted, clear only the events `init` owns by name.

Files: `www/app/assets/geoloc.js`

Regression risk: **LOW** — removing a no-op.

#### P1.25 LOST ↔ afterplay / step-progression unification ✅ DONE (2026-05-14, awaiting field validation) [RESEARCH-FIRST]

Supersedes the Round 2 follow-ups on **P1.18** and folds in **P1.8**. The operational model: step triggers are near-contiguous; when LOST fires everything else stops and waits for the walker to re-enter the active step, the next step, or any later step whose intervening steps are optional, to catch back up with the voice.

**Three coupled problems:**

1. **LOST competes with afterplay.** `lostTarget()` keyed off `_done`, true the moment afterplay starts — so the whole afterplay phase targeted the next step. A walker correctly walking toward a next step >50m away tripped LOST mid-afterplay; the afterplay was paused and `LOST_PLAYER` played (silent today — `youlost.mp3` is the `_youlost.mp3` placeholder), dropping a correctly-progressing walker into silence. Resolved operationally: steps are near-contiguous, so the normal afterplay walk stays well inside `LOST_ENTER_M` of the next step — LOST now only fires on genuine wandering, and the entry distance is measured against the *nearest reachable* step (not a single `_done`-derived target).
2. **Recovery was single-target.** `evaluateLostState` exited LOST only when `distanceToBorder(lostTarget()) < LOST_EXIT_M` for one resolved target. It now exits when the walker is `inside` *any reachable step*.
3. **The sequential gate was inverted (P1.8).** `!(s._spot.optional === false)` collected optional steps under the name `mandatory` — for an all-mandatory parcours the gate was dead; with optional steps it blocked wrongly.

**Resolution (implemented):**

- New `Parcours.reachableSteps()`: the ordered set the walker may legitimately resume into — the active step if `!_done`, the next step, and each subsequent step reachable only as long as every step before it is optional (a mandatory step is reachable but a hard stop). This single helper drives both LOST recovery and the `Step.updatePosition` fire-gate, keeping them consistent.
- New `isStepMandatory(step)` predicate (parcours.js, used by both files): a step is mandatory unless explicitly `optional: true`. The editor creates new steps with `optional: false`, so an **absent flag is treated as mandatory** — the safer default for a guided walk (this is a deliberate refinement of the original `s._spot.optional === false` fix). FLANERIE_ELYSEE is unaffected (all steps explicitly `optional: false`).
- `evaluateLostState` entry now measures distance to the *nearest reachable step*; recovery emits `recover` when the walker is `inside` any reachable step; `update()` then resumes and `Step.updatePosition` resumes the active step or fires the one they walked into.
- `LOST_EXIT_M` removed — recovery is "inside any reachable step", not a distance threshold.
- `lostTarget()` (cyan map marker + distance readout) now returns the *nearest* reachable step (falls back to the first reachable when there's no fix yet).
- `Step.updatePosition` sequential fire-gate rewritten to block on `isStepMandatory` (was the inverted P1.8 logic).
- LOST entry behaviour ("everything stops") was already correct in the `on('lost')` handler — kept (it pauses the active step incl. default-afterplay-routed players, stops zones, stops offlimits).

Files: `www/app/assets/parcours.js`, `www/app/assets/spot.js`

Regression risk: **MEDIUM-HIGH** — changes the core step-progression and LOST-recovery logic. Requires a full walk-through with at least one optional step and a deliberate >50m drift, plus the existing P1.18 validation matrix. Specifically verify: (a) a normal inter-step afterplay walk does not trip LOST; (b) recovery works by entering the active step, the next step, and a later step past an optional one; (c) the fire-gate now actually blocks skipping a mandatory step.

#### P1.26 GPS service + tracking not stopped on walk end ✅ DONE (2026-05-14) [TEST-FIRST]

**Problem:** `PAGES['end']` stops audio but never calls `PARCOURS.stopTracking()`, and nothing calls `BackgroundGeolocation.stop()`. Unless `info.cutoff` is configured, the native location foreground service *and* `Parcours.update()` processing run indefinitely after `end` — battery drain after the walk is over.

**Resolution:** new `GeoLoc.stopGeoloc()` clears the navigator watch, sets `backgroundGeolocIntentionalStop = true` (so `on('stop')` doesn't auto-restart), calls `BackgroundGeolocation.stop()`, and sets `runMode = 'off'`. `PAGES['end']` now calls `PARCOURS.stopTracking()` + `GEO.stopGeoloc()`; the `info.cutoff` timeout path also calls `GEO.stopGeoloc()` (it previously did only the `stopTracking()` half).

Files: `www/app/pages.js`, `www/app/assets/geoloc.js`

Regression risk: **LOW** — end-of-walk only. Verify the native foreground-service notification disappears at `end` and at the `cutoff` timeout.

#### P1.27 Duplicate `step_done` emission ✅ DONE (2026-05-14) [SAFE-TODAY]

**Problem:** `Step.updatePosition`'s "stop all other steps" loop calls `s.emit('done', s)` directly on any previously-playing step — but that step already emitted `done` when its voice ended. The `Parcours` `done` handler re-runs (`stepDone = true`, `store()`) and `pages.js` logs a second `step_done` telemetry event per step, bypassing `PlayerStep._doneFired`.

**Resolution:** guard on `Step._done` before re-emitting (only emit `done` for a step that hadn't already completed), or stop the player without re-emitting.

Files: `www/app/assets/spot.js`

Regression risk: **LOW** — telemetry/data-quality only.

#### P1.28 Page-exit cleanup gaps ✅ DONE (2026-05-14) [SAFE-TODAY]

**Problem:**
- The `CHECKGEO` interval set in `PAGES['checkgeo']` is never cleared — it runs for the whole app lifetime updating `#gps-status` / `#gps-precision` (DOM elements that live in the *parcours* page).
- `PARCOURS.on('fire' | 'done' | 'enter' | 'leave')` are registered *inside* `PAGES['parcours']` and never removed. Safe today (the page is entered once per app load) but a latent accumulation bug if re-entry is ever allowed — and inconsistent with `lost` / `recover`, which are already registered once at module scope.

**Done (Batch A):** `PAGES_CLEANUP['checkgeo']` added — clears + nulls `CHECKGEO` on page exit.

**Done (Batch D):** the parcours `fire`/`done`/`enter`/`leave` handlers are now registered through a tracked `onParcours(event, fn)` helper that pushes each into the module-level `PARCOURS_PAGE_HANDLERS` list. `PAGES_CLEANUP['parcours']` detaches them all on page exit, and `PAGES['parcours']` defensively clears any survivors before re-registering — so handlers can never stack on a re-entry. The permanent module-scope `lost` / `recover` handlers are intentionally left out of the tracked list.

Files: `www/app/pages.js`

Regression risk: **LOW**.

#### P1.29 Recovery map auto-opens on default-afterplay fallback ✅ DONE (2026-05-14) [TEST-FIRST]

**Problem:** when a step has no afterplay (or its afterplay failed to load) the `DEFAULT_AFTERPLAY_PLAYER` "you are late" loop plays (P1.19). That is itself a signal the walker may be lost/late, but the recovery map stays hidden — the walker has no visual cue to get back on route.

**Resolution:** `DEFAULT_AFTERPLAY_PLAYER.on('play', …)` in `pages.js` calls `openMapForRecovery({source: 'default_afterplay'})` when `currentPage === 'parcours'` (the guard keeps it off the devmode tools page). `PlayerSimple` emits `play` once per explicit `play()` call, so this fires when the fallback kicks in, not on loop iterations. Telemetry: reuses `map_opened` with `source: 'default_afterplay'`.

Files: `www/app/pages.js`

Regression risk: **LOW** — only fires on the already-degraded missing-afterplay path. Verify with the devmode tools "Afterplay générique sur étape courante" button (note: that button forces it from the `tools` page where the guard suppresses the map — trigger via a real missing-afterplay step on the parcours page to see the map open).

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
- Battery opt checks: `power_save_mode {on}`, `battery_opt {ignoring, manufacturer, family, os_version}`, `background_restricted {manufacturer, model, os_version}`
- Permissions: `motion_authorized`, `motion_check`
- Misc: `restart`, warm/cold trigger context, `checkaudio_fail`
- Diagnostic (R6.3): `session_diag {apk_version, webapp_hash, platform, manufacturer, model, os_version, plugin_power_opt, plugin_power_IsPowerSaveMode, plugin_power_IsBackgroundRestricted, plugin_power_IsIgnoringBattOpt, plugin_audiofocus, plugin_bgloc, plugin_permissions, devmode}`, `power_state_at_parcours {power_save, bg_restricted, ignoring_batt_opt}`
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

#### P2.12 Defensive hardening cluster ✅ DONE (2026-05-14) [SAFE-TODAY]

Small robustness fixes found in the Round 2 read — none currently reachable in a healthy FLANERIE_ELYSEE walk, but all are latent crashes / `NaN` traps:

- **`Spot.updatePosition` null-deref ordering** — `let hasError = typeof this.player.hasError === 'function' && …` reads `this.player.hasError` *before* the `if (this.player && …)` guard on the next line. Reorder so the guard actually guards.
- **`Parcours.find()` throws on a missing spot type** — `this.spots[type].find(...)` with no `|| []`, while `lostTarget()` / `prewarmUpcomingStep()` defensively guard. `PAGES['rdv']` and `updateStepsMarkers` call `find('steps', 0)` / `spots.steps.forEach` unguarded — a stepless parcours crashes the page. Make `find` defensive or guard callers.
- **`Zone` "Objet" crossfade `NaN` for polygon zones** — `vol = 1 - distanceToCenter / this._spot.radius`; for a polygon `_spot.radius` is an array → `volume(NaN)`. Guard for the numeric-radius case.
- **`PlayerSimple.master(undefined)` → `NaN` volume** — if a media object from parcours JSON lacks `master`, `volume()` computes `_volume * undefined`. Default `master` to 1 in `load()`.

Files: `www/app/assets/spot.js`, `www/app/assets/parcours.js`, `www/app/assets/player.js`

Regression risk: **LOW**.

#### P2.13 Telemetry session keyed by parcours name, not `pID` ✅ DONE (2026-05-14) [SAFE-TODAY]

`TELEMETRY.start` is called with `PARCOURS.info.file || PARCOURS.info.id || PARCOURS.info.name` — but `info` (from the parcours JSON) only carries `name`; `file`/`id` are undefined. So sessions resume-match and group server-side on the human-readable name instead of the stable `pID`. Use `PARCOURS.pID`.

Files: `www/app/pages.js`

Regression risk: **LOW** — but note existing sessions keyed by name won't resume-match after the change (acceptable: session resume is best-effort).

#### P2.14 Resume re-runs onboarding gates ✅ DONE (2026-05-14) [SAFE-TODAY]

On kill+relaunch mid-walk the flow still passes through `checkmotion` / `checkbgloc` / `checknotifications` / `checkbatteryopt`. `checkbgloc` / `checknotifications` / `checkbatteryopt` each already self-fast-path: they run a cheap native check and advance immediately when the permission is still held — no change needed. The one real friction was `checkmotion`, which hard-blocks waiting for the first `activity` event because `GEO.motionAuthorized` resets on every reload.

**Resolution:** `checkmotion` detects the resume branch (`PARCOURS.valid() && currentStep() >= 0`) and, instead of hard-blocking with the 8s warning escalation, gives a `MOTION_RESUME_GRACE_MS` (3s) grace then proceeds to `rdv`. Motion was already validated before the walk started, and a genuine mid-walk revocation is caught by the P3.3d health monitoring. Telemetry: `motion_check {granted:false, resumed:true}` when the grace path is taken.

Files: `www/app/pages.js`

Regression risk: **LOW** — only the resume branch is affected; first-run motion gating is unchanged.

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

#### P3.6 Structural refactors ✅ PARTIAL (2026-05-14) [SAFE-TODAY]

Code-health items with no behaviour change — done while the Round 2 batches are open:

- **`allSteps` declared twice as a global ✅ DONE.** The duplicate `var allSteps = []` in `spot.js` was removed; it is now declared once in `parcours.js` (which loads first) and shared. Both files still reassign it (filter on add/remove, `[]` on `Parcours.clear()`), documented at the declaration site.
- **`initMap` relies on sloppy-mode `this === window` ✅ DONE.** `this.markerPosition` / `this.zoomTimeout` / `this.zoomPaused` replaced with a proper per-call `mapState` local object; the position-marker and wheel-zoom closures now close over it.
- **Module-load `.load()` of the global keepalive players [DEFERRED]** (`SILENT_PLAYER`, `DEFAULT_AFTERPLAY_PLAYER`, `RESUME_PLAYER`, `LOST_PLAYER`, `GPSLOST_PLAYER`) runs at `pages.js` parse time. On iOS this depends on the launcher having set `LOCALAPP_PATH_NATIVE` *before* `pages.js` parses; if that ordering ever slips, `IOS_NATIVE_FALLBACK_DETECTED` goes sticky-true and `checkaudio` fails on every iOS device (see P1.11b / P3.4). Needs a verification of launcher ordering against the FlanerieCordova container (not in this repo) before deciding whether to defer the `.load()` calls to `deviceready` — left open pending that check.

Files: `www/app/assets/parcours.js`, `www/app/assets/spot.js`, `www/app/assets/map.js`

Regression risk: **LOW** — pure refactor; smoke-test the full page flow (map renders, position marker tracks, steps register).

---

### Round 3 (Field test 2026-05-15 — codebase work 2026-05-18)

Test setup: single tester walked FRAPPAZ_V10-modif_monnot with all 9 devices in a backpack simultaneously, headphones on one Xiaomi + one Samsung. 13 telemetry sessions captured. Identical GPS/motion conditions across devices, so divergence isolates device/OS-class behavior. See [memory: project-test-session-20260515](./.claude/projects/-home-mgr-Bakery-FlanerieAudioMap/memory/project_test_session_20260515.md) and [memory: project-test-findings-20260515](./.claude/projects/-home-mgr-Bakery-FlanerieAudioMap/memory/project_test_findings_20260515.md) for raw findings.

#### P1.30 Off-route popup shows pre-start title ✅ DONE (2026-05-18) [SAFE-TODAY]

Field test reproducer: a fresh parcours started directly at step 2 (because the sequential-fire gate at `spot.js:645` short-circuits when `currentStep == -2`, see P1.31b below). The walker then drifted off-route; the recovery map opened over a page where `#parcours-init` ("Rendez vous au point de départ pour commencer le parcours.") was never hidden. Confirmed on both `sgof` (Android) and `lwa3` (iOS) sessions.

Root cause: `pages.js:1699` only hid `#parcours-init` when step **0** fired. Any other step firing first left the pre-start title showing behind the map.

Fix: hide on visibility, not step index — `if ($('#parcours-init').is(':visible'))` swap to `#parcours-run` on the first step fire regardless of which step. One-line behavioural change.

Files: `www/app/pages.js`

Regression risk: **LOW** — degenerate case of the prior code; step 0 case still hits the same branch.

#### P1.31 Android Doze GPS blackout on locked devices [RESEARCH-FIRST] DEFERRED

Telemetry: Motorola moto g(7) power (Android 10, session `x47d`) had a **34-min GPS callback blackout** while locked in the backpack — GPS frozen at start coords from 17:18 to 17:52 despite continuous walking, then jumped straight to the end position on the next callback. TCL T433D (Android 14, session `f2n3`) showed the same 34-min gap but recovered at the very end, so the last 3 steps fired late. Battery optimization was disabled, autostart granted, motion sensor authorized — the existing checks all passed. Samsung A41/A50/A51 and Xiaomi Redmi Note 11 in the same backpack completed all 29 steps cleanly.

This is downstream of `cordova-background-geolocation-plugin` v2.4.0 not keeping its wake-lock / location callbacks alive in Doze on these specific OEMs. The fork's `bgServiceStop` heuristic (P1.12) won't fire because the service stays nominally alive — only the callback delivery is throttled. The audio_loaderror / audio_play_timeout flood at the end of both sessions is downstream of the same gap (the player can't catch up when several queued audios fire at once).

Not fixed in this round. Options to consider:
1. Document "keep screen on" as an operational requirement for known-problematic OEMs (cheapest)
2. Add an OEM-class detector and force `stationaryRadius=0` + tighter `distanceFilter` on those devices to keep the location service hot
3. Reevaluate the BG geolocation plugin config (or switch to a different provider class — see P0.5 Fix 3 / Fix 4 backlog)
4. Add a JS-side GPS-callback-gap watchdog that escalates to UI ("Téléphone en veille — déverrouillez pour continuer") after N seconds without a callback while motion is non-STILL

Probably needs a dedicated field-test session on the specific moto g(7) power + TCL T433D devices before committing to a fix path.

**2026-05-20 update:** the same blackout pattern is now confirmed on **iOS** — see **P1.34**. Today's fleet didn't include the moto g(7) power / TCL T433D so P1.31 itself didn't reproduce, but the iOS finding makes option 4 (JS-side callback-gap watchdog) the most promising path: a watchdog that distinguishes real GPS callbacks from keepalive ticks would cover both platforms at once.

Files (when picked up): `www/app/assets/geoloc.js`, possibly `cordova-background-geolocation-plugin/`

#### P1.31b Fresh-parcours any-step entry — ACCEPTED BEHAVIOR (2026-05-18)

Field observation #8: during off-route / crash tests, the walker could enter the parcours at any step from anywhere. Root cause traced to `spot.js:645` — the sequential-fire gate guards with `PARCOURS.currentStep() + 1 >= 0`, which is false on the initial `-2` state, so a fresh parcours fires any optional step the walker enters first. Mandatory-step blockers still apply, but FRAPPAZ has only 4 mandatory steps out of 29.

Per user decision (2026-05-18): keep as-is. The "pratique en test" property is wanted, and the live operational flow always starts visitors at the RDV point so the field-test scenario isn't reproducible on a real visit.

No code change. Documented here so a future contributor doesn't "fix" it accidentally.

#### P2.15 / P3.5b Voice-snapshot lifecycle telemetry ✅ DONE (2026-05-18) [SAFE-TODAY]

Diagnostic instrumentation, not a fix — see P3.5 for the underlying mechanism.

Field test 2026-05-15: iOS sessions (`soby`, `lwa3`, `n01i` — iPhone SE 3, iOS 26.4.2) **never captured `resume_seek_pos` on `session_resume`**, while every Android `session_resume` carried a clean position (jurr Xiaomi: 21.5s → 22.2s → 23.9s → 25.0s → 35.9s across 5 successive crashes in the same step). iOS sessions also emit **zero `app_visibility` events** while Android emits them on every background/foreground transition — the BackgroundGeolocation plugin doesn't surface those callbacks on iOS. Reading the JS code didn't surface a clear root cause (the `pause` / `visibilitychange` / `pagehide` paths all exist and converge on the same `store()` → `snapshotVoicePosition()` → `localStorage.setItem` chain), so the next test needs more signal.

New events added (all logged via `TELEMETRY.log`):
- `voice_snapshot` — every successful capture, with `step`, `pos`, `playstate`, `trigger`, `visibility`
- `voice_snapshot_skipped` — bail with reason (`no_step` / `no_player` / `playstate`)
- `parcours_store` — every `store()` invocation with a non-empty `trigger` (`interval` / `pause` / `visibilitychange` / `pagehide` / `startTracking`), the saved `resumeStepVoicePos`, and the visibility state
- `parcours_restore` — on every `build()` with restored state, logs `stepIndex` / `stepDone` / `resumeStepVoicePos` / `lost` / `reloading`

What the next field test will answer:
1. Does Cordova `pause` fire on iOS at all? → look for `parcours_store` with `trigger: "pause"` in iOS sessions
2. Does the 5s interval keep ticking? → recurring `trigger: "interval"` events
3. Is the seek actually captured during playback? → `voice_snapshot` should show `pos > 0`
4. Does localStorage survive the iOS kill? → `parcours_restore.resumeStepVoicePos` on `session_resume` should match the last pre-kill `parcours_store.resumeStepVoicePos`
5. Is something resetting to 0? → cross-check `parcours_restore.resumeStepVoicePos` vs the next `step_audio_trigger.resume_seek_pos`

The reproducer is the same iOS double-kill test the colleague ran (two crashes in the same step ~1 min apart). Re-running it after deployment will direct P3.5 Plan B (native `getCurrentPosition()` in GPS tasks) vs Plan C (native plugin save on `applicationDidEnterBackground`).

Files: `www/app/assets/parcours.js`

Regression risk: **LOW** — pure telemetry additions; one signature change (`store()` / `snapshotVoicePosition()` accept an optional `triggerReason`) with all call sites updated.

#### P1.32 Launcher first-install network sensitivity on iPhone 8 / iOS 16.7 [LOW] DEFERRED

Field observation (Bapt's iPhone 8, iOS 16.7.10, 2026-05-15): app installs OK, icon appears on home screen, but the first launch never reaches the webapp — launcher shows "Liaison internet nécessaire !" with apparently working WiFi. App not in iOS Settings either. Originally suspected to be a code regression.

**Update 2026-05-18 (user):** the iPhone 8 boots fine on a regular domestic WiFi. It only stalls when the WiFi is a 4G personal-hotspot tether. So this is most likely **network-layer**, not a code bug — and consistent with iPhone 8 / iOS 16's known weaker behavior on NAT64 / IPv6-only 464XLAT links (carrier hotspots typically present an IPv6-only LAN with NAT64), or MTU/MSS clamping issues on tethered links. Severity demoted from RESEARCH-FIRST regression to LOW operational edge case — workaround is "use real WiFi for the first install on legacy iOS devices."

The code analysis below is retained because it documents the launcher boot path and the diagnostic-improvement opportunities are still worth picking up even though the iPhone 8 lead is no longer the trigger.

**Symptom mechanism (verified from code):**

The text is in [FlanerieCordova/www/index.html:107](../FlanerieCordova/www/index.html), inside `#launcherOne`. Visible-flow:
1. Splash dismisses
2. WebView loads `launcher/index.html`; `#deviceready` shows "Démarrage en cours..." (initial CSS state)
3. `deviceready` fires → `app_prepare()` adds `.ready` class → CSS swaps to "Liaison internet nécessaire !"
4. Launcher calls `fetchRemote('/update/info')` against `https://flanerie.bloffique-theatre.com`
5. `.finally(() => app_run())` is reached regardless of whether the fetch resolved or rejected
6. `app_run()` tries to load the local app from `Library/files/appdata/` — on a fresh install this doesn't exist → throws → `.catch` sets `#launcherOne.style.display = 'block'`, revealing the already-set state

So the symptom is correct: "first install on this phone, cannot reach server, cannot proceed." The "app not in Settings" complaint is a **consequence** of the same root cause: JS never gets far enough to trigger a permission request (location/motion/notifs), so iOS never creates a Settings entry.

**Probable culprits, re-ordered after the WiFi-tether finding:**

1. **NAT64 / IPv6-only 464XLAT on 4G hotspot tether** (HIGH, new lead). When tethering from a 4G iPhone (or many other carriers), the LAN is typically IPv6-only with NAT64 translating to IPv4. Older iOS versions handle 464XLAT less reliably than iOS 26, especially against IPv4-only origins that don't have an AAAA record. If `flanerie.bloffique-theatre.com` is IPv4-only, the iPhone 8 has to rely on iOS 16's DNS64 + NAT64 path, which can stall the first TLS handshake. Easy to confirm: `dig AAAA flanerie.bloffique-theatre.com` from any box — if no AAAA, this is plausible. Fix would be operational (add an AAAA / put it on a CDN with v6) or workaround ("use real WiFi for first install on legacy devices").
2. **MTU/MSS clamping on the tether** (MEDIUM). Carrier tethers often advertise a smaller MTU than 1500. Large TLS records (cert chain) can fragment poorly. iOS 16's TCP stack is less forgiving than iOS 26.
3. **`cordova-plugin-cors` XHR clobber × `cordova-ios` 8 incompatibility** (was HIGH, now MEDIUM-LOW). The plugin clobbers `window.XMLHttpRequest` with a custom `NSURLSession` bridge ([plugins/cordova-plugin-cors/plugin.xml](../FlanerieCordova/plugins/cordova-plugin-cors/plugin.xml)). v1.3.0 is unmaintained for years. The arraybuffer response path (`new Uint8Array(JSON.parse(response.response)).buffer`) is fragile to any change in how cordova-ios 8 serializes binary responses to JS. The cordova-ios 7→8 bump in [ab4c482 (2026-05-05)](../FlanerieCordova) lined up with the test window. Demoted because if this were the cause the iPhone 8 would also fail on regular WiFi.
4. **Binary built with iOS 26 SDK, run on iOS 16** (was MEDIUM-HIGH, now LOW). [after_prepare_ios_patches.js](../FlanerieCordova/hooks/after_prepare_ios_patches.js) strips `#import <netinet6/in6.h>` from `Reachability.m` / `SM_AFHTTPSessionManager.m` / `SM_AFNetworkReachabilityManager.m` because it's private in the iOS 26 SDK. The fallback `<netinet/in.h>` may not provide every IPv6 type the runtime needs on iOS 16. Same demotion logic: if it were code, regular WiFi wouldn't recover.
5. **TLS / ATS cert-chain edge case** (LOW). No `NSAppTransportSecurity` overrides — relying on iOS defaults. If `flanerie.bloffique-theatre.com`'s certificate chain has been renewed to an intermediate iOS 16's trust store doesn't ship, the TLS handshake fails silently. Verify from a Mac with `nscurl --ats-diagnostics https://flanerie.bloffique-theatre.com`. Same demotion logic.

**Diagnostic + fix paths (independent — none are urgent since the tethering workaround exists):**

- **C — Launcher-level telemetry beacon** before `app_run()` (POST or `navigator.sendBeacon`) carrying `cordova.platformId`, `device.version`, `device.model`, the last error captured, and the `app_check_version` outcome. **Worth doing regardless of P1.32's status** — without it, any launcher-side failure is silent because the webapp's TELEMETRY hasn't started yet. SAFE-TODAY, half-day. Promote to its own ticket when scheduling.
- **A — Re-enable the launcher's commented `.catch`** ([launcher.js:67-70](../FlanerieCordova/www/launcher.js#L67-L70)) and write the error message + stack into the visible `#launcherOne` content. SAFE-TODAY, ~30 min. Useful in-field debugging aid that pairs well with C.
- **B — Bypass the plugin clobber on the launcher's `fetchRemote`** by capturing a reference to `window.XMLHttpRequest` before `deviceready` (i.e. before cors's JS clobber runs) and using that, OR switching to native `fetch()`. Only worth running if a future telemetry beacon (C) actually shows an XHR-shaped error on iPhone-8-class devices. Otherwise leave it.
- **D — Drop `cordova-plugin-cors` entirely** — now a candidate for the broader plugin-trim audit, not specifically for this issue. The webapp's `fetch()` would go through native WKWebView; `<access origin>` + `<allow-navigation>` already whitelist `flanerie.bloffique-theatre.com`. Worth checking whether anything in the webapp still depends on the XHR clobber before pulling. TEST-FIRST.
- **E — Roll back `cordova-ios` to 7.1.1** — no longer warranted. Skip.
- **Operational** — recommend "first install on legacy iOS = real WiFi, not 4G tether" in the loaner-phone setup doc. Costs nothing, eliminates the symptom for this device class.

Files (when picked up): `FlanerieCordova/www/launcher.js`, `FlanerieCordova/www/apputils.js`, `FlanerieCordova/www/index.html`, possibly `FlanerieCordova/package.json`

#### P1.33 Android GPS cold-start TTFF — 2–5 min warmup on `RAW_PROVIDER` [TEST-FIRST]

**Problem.** On devices where GPS has not been used recently, the first usable position can take 2–5 minutes to appear. Two compounding causes:

1. **`RawLocationProvider` uses `GPS_PROVIDER` exclusively on SDK > 30.** ([RawLocationProvider.java:95–110](../cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/provider/RawLocationProvider.java#L95-L110)). Raw GPS cold-start TTFF without network-assisted data (A-GPS from Google Play Services' `FusedLocationProvider`) is typically 2–5 min. Network / WiFi location — which is near-instant — is never requested.

2. **JS accuracy gate rejects all warmup fixes.** ([geoloc.js:492](www/app/assets/geoloc.js#L492)). During warmup GPS typically reports accuracy 100–500 m. Any fix with `accuracy > 30` is silently discarded for trigger purposes. Combined with cause 1, the walker sees no position for the full cold-start window.

The keepalive in `RawLocationProvider` ([line 119](../cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/provider/RawLocationProvider.java#L119)) calls `getLastKnownLocation(GPS_PROVIDER)` which returns `null` on a cold start, so it provides no relief.

**Fix — `RawLocationProvider.onStart()`: also request `NETWORK_PROVIDER` and deliver the last known network fix immediately.**

In `onStart()`, after the existing GPS request:

```java
// existing GPS request
locationManager.requestLocationUpdates(provider, mConfig.getInterval(), mConfig.getDistanceFilter(), this);

// NEW: also listen to network for fast initial fix while GPS warms up
if (locationManager.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)) {
    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,
        mConfig.getInterval(), mConfig.getDistanceFilter(), this);
    Location networkCached = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
    if (networkCached != null &&
            (System.currentTimeMillis() - networkCached.getTime()) < 60_000) {
        handleLocation(networkCached); // instant coarse fix while GPS warms up
    }
}
```

In `onStop()`, add a matching `removeUpdates` for `NETWORK_PROVIDER`.

The `onLocationChanged` callback already handles any provider — network fixes will arrive with accuracy ~50–200 m and pass through the plugin pipeline. The JS-side 30 m accuracy gate will still reject them for step triggering, but `lastPosition` and `lastTimeUpdate` are updated so the map shows the user's location and GPS-lost does not fire. Once GPS acquires a better fix, it naturally takes over since GPS accuracy will be ≤ 30 m.

**Files to modify:**
- `cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/provider/RawLocationProvider.java` — `onStart()` and `onStop()`

**Estimated effort:** ~1 hour including rebuild and APK test.

**Regression risk:** LOW. The change only adds a second provider during warmup; GPS behaviour is untouched. Network locations are already handled by `onLocationChanged` which routes through the same `handleLocation` path as GPS. The only new failure mode is a `SecurityException` if `NETWORK_PROVIDER` is unavailable — guarded by `getAllProviders().contains()` check. Requires APK rebuild and a field test on a cold-GPS Android device to confirm sub-30-second first fix.

#### Field-test items that turned out NOT to be bugs

- **Sony Xperia X (F5121, Android 8.0.0) "alerts"** — caa0 session emits `gps_callback_gap` / `gps_sleep_suspect` / `gps_stale_callback` / `gps_heartbeat[_ok]` events unique to Sony. Sony still completed all 29 steps. These are the GPS keep-alive system correctly detecting a 15-18 s callback pause on the older Android 8 device and recovering via heartbeat ping. Working as designed; no code change. Worth a one-line explainer in the telemetry viewer rather than treating them as anomalies.
- **iOS `audio_playerror` on `resume.mp3` / `youlost.mp3` / `afterplay.mp3`** — per user (2026-05-18) these three audio files have not been produced yet; the bundled placeholders are still the `_`-prefixed no-op shims (see Architecture Summary). The Cordova Media plugin errors immediately on play of a non-existent file. Expected and harmless until the files exist. The error serialization (`"[object Object]"`) is still worth tightening to surface the underlying Media error code if these ever become real failure modes.
- **iPhone 8 / iOS 16.7 "liaison internet nécessaire" screen** (Bapt's device) — no telemetry session was ever created so the failure must be diagnosed off-device. Per user (2026-05-18): deprioritized. Likely an iOS-16-era `NSAppTransportSecurity` quirk; not a fleet issue.

---

### Round 4 (Field test 2026-05-18 — codebase work 2026-05-18)

Test setup: 22 telemetry sessions across 8 unique devices on FLANERIE_GIVORS_V7_CBR (plus two FRAPPAZ_V10 setup tests). Three waves: setup tests (14:45–15:05), main multi-device walk (16:48–17:42, ~10 devices simultaneously), late batch (18:48–19:30, 4 Samsungs). Device fleet: Xiaomi M2101K7AG (Redmi 9T) Android 11, Xiaomi 2201117TY (Redmi Note 11) Android 13, Samsung SM-A415F (A41) Android 12, Samsung SM-A515F (A51) Android 13, Motorola moto g(7) power Android 10, TCL T433D Android 14, Sony F5121 (Xperia X) Android 8, Apple iPhone 13 mini iOS 26.4.2.

Two major field-test items deferred to dedicated outings (R4.1, R4.3 below). One quick-wins batch shipped immediately to unblock the next field test's diagnostics (R4.2 / R4.4 / R4.5 / R4.6 / R4.7 / R4.8 / R4.9).

#### R4.1 Android first-voice cold-load hangs silently [RESEARCH-FIRST] DEFERRED

Field test 2026-05-18: 5 Android sessions (Xiaomi `j4lx`, Samsung A515F `0m39`/`u6wy`/`vw44`, Samsung A415F `1y9f`/`427z`, Moto G7 `kzm4`) failed to start the first voice file of the walk (`GIVORS26_BLOC_01_parc_V8_CBR.mp3`). The 15s [`audio_play_timeout`](www/app/assets/player.js) watchdog fired but the previous version logged and walked away. Worst case (`j4lx`): step 0 fires at t=0.3s, watchdog fires at t=15.3s, then **325 seconds of pos=0.00 while playstate="play"** — PlayerStep state was lying; underlying Howl never actually started. Voice finally played at t=331.6 after a second `audio_play_requested` (most likely triggered by zone re-entry). Walker stood in step 0 for 5.5 minutes hearing silence.

iPhone session (`ywav`) does NOT have this — step 0 plays at t=0.8 and pos advances normally. That is P3.4 NativeMediaPlayer migration paying off on iOS. Android still goes through Howler and inherits exactly the cold-load failure mode P3.4 fixed for iOS.

**R4.4 (this round) makes the watchdog actually attempt recovery** (cross-check actual play state, retry stop+play once if genuinely stuck) — that may close the issue without further work, but needs field validation on the same Xiaomi/Samsung fleet. If R4.4 doesn't recover, options are:

1. **Diagnostic first**: confirm whether the issue is "Howler stuck" (recoverable by stop+play, which R4.4 attempts) or "WebView audio context stuck" (needs a different fix). The new `audio_play_stuck_retry` / `audio_play_stuck` / `audio_play_timeout_self_healed` telemetry will tell us.
2. **Likely fix**: route Android step voices through `cordova-plugin-media` too — extend `NativeMediaPlayer` to Android (the Media plugin supports MediaPlayer/ExoPlayer natively). Pattern identical to P3.4. Bigger change but matches the iOS resolution.
3. **Fallback**: pre-warm step 0 voice file at parcours-page entry (proactive `.load()` before step_fire). Doesn't fix the underlying race but moves the cold-load to a quiet moment.
4. **Operational mitigation today**: brief the team that BLOC_01 on Android may stay silent for ~30 s; if it does, asking the walker to step out and back into the zone usually triggers a successful retry.

Files (when picked up): `www/app/assets/player.js`, possibly `cordova-plugin-media` (Android backend wrapper)

#### R4.2 parcours_restore lifecycle + session_resume payload enrichment ✅ DONE (2026-05-18) [SAFE-TODAY]

**Problem.** Field test 2026-05-18: ZERO `parcours_restore` events across all 22 sessions despite 24 `session_resume` events. The Round 3 / P3.5b diagnostic was non-functional. Root cause: [`PARCOURS.restore()`](www/app/pages.js#L28) runs at pages.js module-parse time → calls `build()` → tries to log `parcours_restore` at [parcours.js:225](www/app/assets/parcours.js#L225), but `TELEMETRY.start()` isn't called until the parcours page is entered at [pages.js:1797](www/app/pages.js#L1797). `_log()` silently no-ops when `sessionId` is null. Companion issue: `session_resume` payload only carried `parcoursId/parcoursName` — no `resume_seek_pos`, so the P3.5 iOS double-kill round-trip remained un-validatable from a single event.

**Resolution.**
- New `TELEMETRY.hasSession()` predicate so callers can tell whether a session exists yet.
- New `Parcours._logOrStash()` + `flushPendingTelemetry()` — events emitted before TELEMETRY is live are stashed on the instance, then drained from [PAGES['parcours']](www/app/pages.js#L1797) right after `TELEMETRY.start()`.
- `TELEMETRY.start(pId, pName, {extra: {…}})` — a new `options.extra` object is merged into the `session_start` / `session_resume` payload. The parcours page passes `resume_seek_pos`, `resume_step_index`, `resume_step_done`, `resume_lost`, `is_resume_branch`.

After this lands, the iOS double-kill reproducer becomes meaningful: `parcours_restore` events will surface in every relaunched session, and `session_resume.resume_seek_pos` carries the restored position directly.

Files: `www/app/assets/parcours.js`, `www/app/assets/telemetry.js`, `www/app/pages.js`

Regression risk: **LOW** — additive telemetry plumbing; no behaviour change for the audio / GPS paths.

#### R4.3 Android Doze GPS blackouts on Motorola / TCL — confirmed repro (P1.31) [RESEARCH-FIRST] DEFERRED

Field test 2026-05-18 reproduced the May-15 pattern cleanly on the same two devices:
- `kzm4` Motorola moto g(7) power Android 10: **626-second silent gap** between `user_lost` @t=397s and `step_done step 1` @t=1023s. No `user_recovered` ever fired — events just stop, then resume with a step_done burst. Plus 242 `gps_trigger_rejected`.
- `xh1z` TCL T433D Android 14: **852-second event-stream gap** between `gps_quality_summary` @t=1704 and `session_resume` @t=2556 — 14 minutes of total silence. Session ends shortly after.

Same OEM/OS classes; same Doze-throttling behaviour despite all onboarding gates passing. Options still match the P1.31 backlog, with one new lightweight option preferred for the first attempt:

0. **JS-side gap watchdog with UI escalation** [NEW, cheapest] — when `gps_callback_gap` exceeds 60 s AND motion is non-STILL, paint a "Téléphone en veille — déverrouillez pour continuer" band (similar to the LOST band). Converts a silent 10-minute failure into a 60-second user-actionable signal. No native work. R4.6 (this round) already tunes the gap thresholds so this watchdog won't false-positive on normal keepalive cadences.
1. **OEM-class detector** — force `stationaryRadius=0` + tighter `distanceFilter` at startup on Motorola/TCL devices. Half-day, no native code.
2. **Plugin Fix 4 (FusedLocationProvider)** — the heavy option from the P0.5 backlog. Days of work. Only if (0)+(1) aren't enough.

Recommend committing (0) before the next test session because it's almost-free instrumentation that becomes UX, and the same Motorola+TCL devices can validate it in-field.

Files (when picked up): `www/app/assets/geoloc.js`, `www/app/pages.js`, possibly `cordova-background-geolocation-plugin/`

#### R4.4 audio_play_timeout truth check + single-attempt recovery ✅ DONE (2026-05-18) [TEST-FIRST]

**Problem.** Field test 2026-05-18: 19 `audio_play_timeout` events across the test, but ~half were false positives — audio loaded a few seconds *after* the watchdog fired (visible in subsequent `audio_load_ready` + `voice_snapshot` with `pos > 0`). The other half were genuine F1 stuck loads (see R4.1) and the watchdog did nothing about them, just logged and walked away.

**Resolution.** In the 15 s watchdog callback of `PlayerSimple.play()`:

1. **Cross-check** `this._player.playing()` + `this._player.seek()`. If either says audio is actually running, emit `audio_play_timeout_self_healed` instead, mark `_isActive = true`, emit a `play` event (so the parent step lifecycle catches up), and resolve the geo task. The play event was simply lost — no need to fight it.
2. **Single retry** if genuinely stuck (`!playing && seek === 0`): emit `audio_play_stuck_retry`, stop the underlying player, re-call `this.play(seek, ...)` on the next tick. `_playStuckRetries` capped at 1 so we don't loop on a hopeless file. Resolves the previous geo task explicitly before the retry's `_claimGeoTask()` so no slot leaks.
3. **Out of retries**: emit `audio_play_stuck` AND the legacy `audio_play_timeout` (with new `actually_playing`, `seek`, `retries` fields) so existing dashboards keep counting. Resolve the geo task as `play-timeout`.

The `play` event handler now resets `_playStuckRetries = 0` on success.

Telemetry: `audio_play_timeout_self_healed`, `audio_play_stuck_retry`, `audio_play_stuck`. Existing `audio_play_timeout` continues but only on the genuine-stuck-out-of-retries path, with truth fields attached.

Files: `www/app/assets/player.js`

Regression risk: **MEDIUM** — touches the play-watchdog path of every audio play call. Self-healed and retry are no-ops on healthy paths (watchdog never fires). Retry path may briefly cut audio if a slow load actually was about to complete; the cross-check before retry minimises this. Validate on the same Xiaomi/Samsung fleet that exhibited the F1 hang.

Acceptance:
- A successful play that just lost the `play` event surfaces as `audio_play_timeout_self_healed` with `actually_playing=true` and a non-zero seek.
- Forced stuck load (e.g., dev-mode break) produces `audio_play_stuck_retry` then either a recovery or `audio_play_stuck`.
- No `audio_play_timeout` events fire on healthy playback paths.

#### R4.5 voice_snapshot truth-check fields ✅ DONE (2026-05-18) [SAFE-TODAY]

**Problem.** Field test 2026-05-18: many sessions show stuck `voice_snapshot` runs with `pos = 0.00` and `playstate = play` for 100+ consecutive 5 s ticks. Could be either "voice never started" (R4.1 stuck cold-load) or "voice already played but PlayerStep state is misreported" — the existing payload couldn't distinguish.

**Resolution.** [snapshotVoicePosition](www/app/assets/parcours.js#L118) now reads the underlying `voice._player.playing()` and `voice.loadState()` directly and includes them as `audio_playing` and `load_state` in the `voice_snapshot` payload. Three observable cases now disambiguate cleanly:

| `pos` | `audio_playing` | `load_state` | Interpretation |
|---|---|---|---|
| `0` | `false` | `loading` | Genuinely stuck — R4.1 / Android cold-load failure |
| `0` | `true` | `loaded` | Voice just started (first tick after play) |
| `> 0` | `true` | `loaded` | Voice running normally |

Files: `www/app/assets/parcours.js`

Regression risk: **LOW** — pure telemetry enrichment.

#### R4.6 gps_callback_gap threshold tuning ✅ DONE (2026-05-18) [SAFE-TODAY]

**Problem.** iPhone session (`ywav`) emitted 55 `gps_callback_gap`, 20 `gps_sleep_suspect`, 45 `gps_stale_callback` at ~15 s intervals — the exact cadence of the P0.5 Fix 1b NSTimer keepalive. Walk completed cleanly; this is working-as-designed instrumentation noise. Same WAD pattern previously noted on Sony Xperia X (Android 8 Handler keepalive).

**Resolution.** `GPS_CALLBACK_GAP_THRESHOLD` 8000 → 20000, `GPS_SLEEP_SUSPECT_THRESHOLD` 15000 → 30000. Both keepalive sources (iOS NSTimer / Android Handler) fire at 15 s; 20 s catches a genuine missed callback, 30 s requires two consecutive misses for a sleep suspect.

Files: `www/app/assets/geoloc.js`

Regression risk: **LOW** — strictly relaxes thresholds; existing real-blackout signals (R4.3 / P1.31, where gaps are minutes long) remain comfortably above the new cutoffs. Unblocks R4.3 option 0 (JS-side gap watchdog with UI escalation) by making the lower-level event clean.

#### R4.7 step_afterplay_fallback / step_voice_failed step-name enrichment ✅ DONE (2026-05-18) [SAFE-TODAY]

**Problem.** Field test 2026-05-18: 45 `step_afterplay_fallback` events all showed `step: null, step_name: null`. The events fired correctly on FLANERIE_GIVORS_V7_CBR steps 0, 2, 3, 16, 17 (content gap — afterplay files not yet produced for those blocs) but the telemetry couldn't say which steps without cross-referencing the timeline.

**Resolution.** `PlayerStep` now accepts a back-ref to its owning `Step` (`new PlayerStep(this)`), stored as `this._step`. `step_afterplay_fallback` and `step_voice_failed` payloads now include `step` (`_step._index`) and `step_name` (`_step._spot.name`).

Files: `www/app/assets/player.js`, `www/app/assets/spot.js`

Regression risk: **LOW** — additive constructor arg with null default; existing callers unaffected.

#### R4.8 user_recovered distance clamp ✅ DONE (2026-05-18) [SAFE-TODAY]

`distanceToBorder` returns a signed distance (negative when inside the polygon). Field test 2026-05-18 showed `user_recovered` with `distance: -1` (iOS step 1) and `distance: -2` (Samsung A41 step 0) — cosmetic but unexpected. The `user_lost` side always reports positive (recovery target is outside the boundary). Clamped the recovered side to `Math.max(0, ...)` so the field always reads as "distance from boundary".

Files: `www/app/pages.js`

Regression risk: **LOW** — telemetry cosmetic.

#### R4.9 voice_snapshot_skipped throttling ✅ DONE (2026-05-18) [SAFE-TODAY]

**Problem.** Field test 2026-05-18: 4,264 `voice_snapshot_skipped` events across the test (863 on a single Sony session). The 5 s interval would fire one skip per tick during normal afterplay phases — same payload, no new signal after the first occurrence.

**Resolution.** New `_maybeLogSnapshotSkipped()` keys on `(step | reason | playstate)`; only logs when the key changes. A real `voice_snapshot` log clears the dedup so the next genuine skip after a play run gets recorded once. Expected event-volume reduction: 10×–100× on typical walks.

Files: `www/app/assets/parcours.js`

Regression risk: **LOW** — telemetry cleanup only.

---

### Round 5 (Native plugin work for Samsung A41 BLOC_15 crashes — 2026-05-19)

Triggered by post-2026-05-18 colleague report of two phones crashing during/near BLOC_15 on FLANERIE_GIVORS_V7_CBR. Telemetry analysis (see [memory: project-test-findings-20260518](./.claude/projects/-home-mgr-Bakery-FlanerieAudioMap/memory/project_test_findings_20260518.md)) traced the crashes to OEM battery kills on Samsung SM-A415F (A41, Android 12) — specifically during the BLOC_14 → BLOC_15 transition when BLOC_15's MUSIC file is finishing its background load while BLOC_14 audio is still playing. Pattern reproduced cleanly across 4 sessions on the same device class.

Constraint: a Play Store upgrade is acceptable for this issue (vs the earlier "no FlanerieCordova/plugin changes before show" constraint). Three coordinated changes — one is the targeted fix, the other two are the C5/C6 backlog items that pair naturally with the same plugin rebuild.

#### R5.1 Audiofocus plugin: mediaPlayback foreground service keepalive ✅ DONE (2026-05-19) [TEST-FIRST]

**Problem.** [`AudioFocusService.java`](cordova-plugin-audiofocus/src/android/AudioFocusService.java) starts a `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` foreground service on every `AUDIOFOCUS_REQUEST_GRANTED` and stops it on `cancelFocus()`. Between two audio-focus requests (e.g. while background-loading BLOC_15 audio while BLOC_14 is winding down), the service is briefly not running. Samsung's One UI 4+ battery optimizer uses exactly the `mediaPlayback` flag to decide whether to kill the process — those silent gaps are when the kill lands. Field test 2026-05-18: 4 of 4 Samsung A415F walks crashed around the BLOC_14→BLOC_15 boundary.

**Resolution.** Two new plugin actions `startKeepalive()` / `stopKeepalive()`:

- `startKeepalive()` → starts the foreground service, sets a `keepaliveActive` flag.
- `cancelFocus()` → only stops the foreground service when `keepaliveActive == false` (existing call sites that don't opt into keepalive still see the original behaviour).
- `stopKeepalive()` → clears the flag, stops the service.

JS wiring in [`PAGES['parcours']`](www/app/pages.js): call `startKeepalive()` on parcours-page entry; the existing [`PAGES_CLEANUP['parcours']`](www/app/pages.js) calls `stopKeepalive()` on cleanup (which covers walk end via `PAGES['end']`, page-switch on resume flows, devmode tools navigation, etc.).

iOS path is symmetric for API uniformity but largely defensive: `startKeepalive` sets `AVAudioSessionCategoryPlayback`, calls `setActive:YES`, and registers the interruption observer ahead of the first audio play. UIBackgroundModes:audio already handles the actual process-lifetime guarantee on iOS, so the iOS impact is minor — but it pairs cleanly with R5.3 (C6).

Telemetry: `audiofocus_keepalive_started`, `audiofocus_keepalive_stopped`, `audiofocus_keepalive_error`.

Files:
- `cordova-plugin-audiofocus/src/android/AudioFocus.java` (`keepaliveActive` flag, two new actions, `cancelFocus` guard)
- `cordova-plugin-audiofocus/src/ios/AudioFocus.m` (symmetric methods, observer registration extracted)
- `cordova-plugin-audiofocus/www/AudioFocus.js` (`startKeepalive` / `stopKeepalive` exports)
- `cordova-plugin-audiofocus/plugin.xml` / `package.json` (version bump 1.3.1 → 1.4.1 — 1.4.0 was R5.1+R5.3 only; 1.4.1 also includes R5.4.d notification tap intent)
- `www/app/pages.js` (call sites in `PAGES['parcours']` enter + `PAGES_CLEANUP['parcours']`)

Requires plugin reinstall: `cordova plugin remove cordova-plugin-audiofocus && cordova plugin add ~/Bakery/cordova-plugin-audiofocus`. Add to C4 build checklist.

Regression risk: **MEDIUM** — changes a process-lifetime signal Android uses for battery decisions. Verify on a Samsung A41 walk (full 45-min duration) before production. Verify on a non-restrictive device (e.g. Pixel) that the persistent foreground notification isn't visually distracting (it's `IMPORTANCE_MIN` so should stay hidden, but worth confirming).

Acceptance:
- Samsung A415F (Android 12) completes a 45-minute walk without `session_resume` events between BLOC_14 and BLOC_15.
- `audiofocus_keepalive_started` fires once on parcours entry, `audiofocus_keepalive_stopped` fires once on cleanup or end.
- No accumulation of foreground services across walks (logcat: only one AudioFocusService instance running).

#### R5.2 Power Optimization plugin: IsBackgroundRestricted() detection ✅ DONE (2026-05-19) [SAFE-TODAY]

Closes the **C5 IsBackgroundRestricted** sub-item ahead of the full C5 fork. The rest of C5 (standby bucket, OEM intent table expansion, hibernation whitelist) stays open.

**Problem.** Samsung One UI 4+ has a *separate* "Background usage limits" setting (Unrestricted / Optimized / Restricted) that lives above the Doze whitelist. A user (or Samsung's auto-policy on infrequently-used apps) can flip this to "Restricted" and the app will be killed mid-session even though `IsIgnoringBatteryOptimizations()` returns true. This was previously undetectable from JS.

**Resolution.** New `IsBackgroundRestricted()` plugin method that wraps `ActivityManager.isBackgroundRestricted()` (API 28+, returns `false` on older Android because the signal didn't exist). [`PAGES['checkbatteryopt']`](www/app/pages.js) now probes this first; if true, swaps the page copy to "L'activité en arrière-plan est restreinte" with explicit Settings path ("Paramètres → Applications → Flanerie → Batterie → Sans restriction") and the existing Settings deep-link button, then polls until cleared. If false (or pre-API 28), the existing Doze whitelist flow runs unchanged.

Telemetry: `background_restricted` event with manufacturer / model / apiLevel.

Files:
- `FlanerieCordova/plugins/cordova-plugin-power-optimization/src/android/PowerOptimization.java` (new `IsBackgroundRestricted` action + method, `ActivityManager` import)
- `FlanerieCordova/plugins/cordova-plugin-power-optimization/www/PowerOptimization.js` (new export)
- `FlanerieCordova/plugins/cordova-plugin-power-optimization/plugin.xml` / `package.json` (version bump 0.0.3 → 0.1.0)
- `www/app/pages.js` (split `checkbatteryopt` `check()` into a new `runDozeCheck()` helper, prepend `IsBackgroundRestricted` probe)
- `www/app/app.html` (`#checkbatteryopt-restricted` paragraph element with Samsung-targeted copy)

NOTE: this edit is in-place on `FlanerieCordova/plugins/cordova-plugin-power-optimization/` because no fork exists at `~/Bakery/cordova-plugin-power-optimization/` yet. The audiofocus pattern (`~/Bakery/cordova-plugin-audiofocus/` as the canonical source, mirrored into `FlanerieCordova/plugins/...` at install time) should be replicated for power-optimization in a follow-up cleanup — for now the deployed copy IS the source of truth.

Regression risk: **LOW** — additive plugin method; JS gate only activates when the underlying API exists AND returns true.

Acceptance:
- Samsung A41 with "Restricted" set in Settings → `checkbatteryopt` shows the restricted copy + Settings button, polls until user changes to Unrestricted, then auto-advances.
- Samsung A41 with "Optimized" or "Unrestricted" → existing Doze flow runs, no false restricted-state UI.
- Android < 9 device → plugin returns `false`, page passes through to Doze flow as before.

#### R5.3 Audiofocus plugin (iOS): interruption without ShouldResume ✅ DONE (2026-05-19) [SAFE-TODAY]

Closes the **C6** backlog item. Pairs naturally with R5.1 since the same plugin rebuild deploys both.

**Problem.** [`AudioFocus.m`](cordova-plugin-audiofocus/src/ios/AudioFocus.m) previously only reactivated AVAudioSession and emitted `AUDIOFOCUS_GAIN` when `AVAudioSessionInterruptionOptionShouldResume` was present on the interruption-end notification. Per Apple docs the option may be absent — typically after Siri, sometimes after a call, routinely after alarms/timers. When absent, the previous code did nothing: `pauseAllPlayers()` had already run on interruption-begin, the resume-overlay was hidden in the walker's pocket, and audio stayed paused forever.

**Resolution.** In the `AVAudioSessionInterruptionTypeEnded` branch, always attempt `setActive:YES`. Then:

- If `ShouldResume` is set AND activation succeeded → emit hard `AUDIOFOCUS_GAIN` (same as before).
- Else if activation succeeded → emit new `AUDIOFOCUS_GAIN_AVAILABLE` event.
- Else (`setActive` failed) → emit nothing; next user gesture (foreground) re-attempts via the document-resume safety retry.

JS-side handling in [`player.js`](www/app/assets/player.js): new branch on `AUDIOFOCUS_GAIN_AVAILABLE` — for Flanerie's sole-app pocketed-walker use case, auto-resume IS the walker-correct behaviour (no other audio context to preserve). Uses a softer double-pulse vibration `[200, 100, 200]` to differentiate from a hard `AUDIOFOCUS_GAIN`. Also adds a `document.addEventListener('resume', ...)` safety retry: if foregrounding finds `AUDIOFOCUS === 0` with paused players, re-call `requestAudioFocus()` to catch the case where the JS layer was suspended during the interruption-end notification.

Telemetry: `audiofocus_change` with state `AUDIOFOCUS_GAIN_AVAILABLE`; `audiofocus_resume_retry` when the document-resume retry path fires.

Files:
- `cordova-plugin-audiofocus/src/ios/AudioFocus.m` (`handleInterruption` rewritten; observer registration extracted to `registerInterruptionObserver`; iOS `startKeepalive`/`stopKeepalive` from R5.1 also live here)
- `www/app/assets/player.js` (`onFocusChange` adds `AUDIOFOCUS_GAIN_AVAILABLE` branch; `document.resume` retry handler)

Regression risk: **LOW** — fallback path only fires when the previous path would have silently failed. Conservative variant (vibrate + resume on iOS) chosen over the more aggressive variant (skip the new event, emit hard `GAIN` unconditionally) so the walker still gets a tactile signal that something happened.

Acceptance:
- iPhone: trigger Siri mid-walk, dismiss. Audio resumes within 1 s, soft double-pulse felt.
- iPhone: foreground app after a system alarm. `AUDIOFOCUS_GAIN_AVAILABLE` reaches JS or, if not, `audiofocus_resume_retry` fires on `document.resume` and audio recovers.
- Healthy walks with no interruptions: no new events surface.

#### R5.4 Store-submission polish bundle ✅ DONE (2026-05-19) [SAFE-TODAY]

Catch-up batch landed alongside R5.1–R5.3 because the plugin rebuild + Play Store submission opens the window cheaply. Five small items; each is independently shippable and individually low-risk.

**R5.4.a — `RequestOptimizationsMenu` inverted conditional fixed (closes C5 sub-item).** The Java method previously guarded the `startActivity(...)` call with `if (pm.isIgnoringBatteryOptimizations(packageName))` — so the settings menu only opened when the app was *already* whitelisted (i.e. when the user didn't need it). The action has no API restriction tied to whitelist state; guard removed. The FlanerieAudioMap JS layer (P1.12) had been routing around the bug via `GEO.showAppSettings()`; the workaround can be unwound at the JS level next time someone touches that code. Files: `cordova-plugin-power-optimization/src/android/PowerOptimization.java`.

**R5.4.b — `IsPowerSaveMode()` detection (closes C5 sub-item).** New plugin method wrapping `PowerManager.isPowerSaveMode()` (API 21+). Initially shipped as a non-blocking advisory banner. Upgraded to a hard block in R6.2 — battery saver prevents GPS and audio continuity in the pocket, so the walker must disable it before proceeding. Files: `cordova-plugin-power-optimization/src/android/PowerOptimization.java`, `cordova-plugin-power-optimization/www/PowerOptimization.js`, `www/app/pages.js`, `www/app/app.html` (`#checkbatteryopt-powersave` banner). See R6.2 for the hard-block implementation.

**R5.4.c — OEM intent table expansion (closes C5 sub-item).** Added 6 modern OEM activities to `Constants.java`: Samsung One UI 4+ (legacy `AppSleepListActivity` + newer `AppSleepingActivity`), OnePlus chain-launch, OPPO/Realme ColorOS startup, Vivo FunTouch BgStartUpManager, Honor MagicOS StartupNormalAppListActivity. `ProtectedApps.HaveProtectedAppIntent()` filters out intents that don't resolve on the current device, so it's safe to include all variants. Particularly relevant for the Samsung A41 fleet: the One UI 4+ Sleeping Apps page is now reachable via `ProtectedAppCheck(true)`. Files: `cordova-plugin-power-optimization/src/android/Constants.java`.

**R5.4.d — Audiofocus notification tap-to-open.** [`AudioFocusService.java`](cordova-plugin-audiofocus/src/android/AudioFocusService.java) now sets a `PendingIntent` on the persistent foreground-service notification, pointing at the app's main `LaunchIntent`. Without this, tapping the notification did nothing. The notification stays `IMPORTANCE_MIN` so should remain hidden on most devices, but Android 13+ surfaces some foreground-service notifications regardless — when it does, tapping now returns the walker to the app. `PendingIntent.FLAG_IMMUTABLE` added (required on Android 12+). Files: `cordova-plugin-audiofocus/src/android/AudioFocusService.java`.

**R5.4.e — iOS usage descriptions: French + specific.** [`FlanerieCordova/package.json`](../FlanerieCordova/package.json) `cordova-background-geolocation-plugin` plugin variables changed from the upstream defaults ("This app always requires location tracking" / "This app requires motion detection") to walker-specific French copy. Apple reviewers consistently reject vague English strings in non-English-targeted apps:

- `ALWAYS_USAGE_DESCRIPTION`: "Flanerie utilise votre position GPS pour déclencher les scènes audio sur le parcours, même lorsque l'écran est verrouillé et le téléphone dans la poche. La localisation continue est nécessaire pendant toute la balade."
- `MOTION_USAGE_DESCRIPTION`: "Flanerie utilise les capteurs de mouvement pour distinguer les pauses d'écoute des déplacements, et éviter de fausses alertes \"GPS perdu\" lorsque vous êtes immobile."

Both strings populate `NSLocationAlwaysUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, and `NSMotionUsageDescription` at install time. Files: `FlanerieCordova/package.json`.

**R5.4.f — App version visible to operator.** Reads `document.APPVERSION` (set by the launcher via `cordova.getAppVersion.getVersionCode`) and renders it discreetly at the bottom of the `select` page along with the platform tag. Format: `v12 · android`. Operators can read the version off the phone before handing it over; walkers can read it back during support calls. Falls back gracefully when `APPVERSION` isn't set (browser dev, electron). Files: `www/app/pages.js` (`PAGES['select']` tail), `www/app/app.html` (`#select-version` element).

#### R5.4 verification

- iOS usage strings appear in French in the iOS permission dialogs on first install.
- `RequestOptimizationsMenu` opens the system Doze whitelist page when called from a non-whitelisted state (test on a fresh install before granting).
- `IsPowerSaveMode` banner appears in `checkbatteryopt` when battery saver is on; disappears within ~1.5 s (one poll tick) of being turned off.
- Audiofocus notification (if visible) opens the app when tapped.
- `select` page shows version + platform string at the bottom in 75% opacity.

#### R5.4 regression risk

**LOW** across the board. R5.4.a removes a useless guard (the call path was already routed around). R5.4.b/c/d are additive. R5.4.e is a string change. R5.4.f is a single DOM element with a string. None of these alter the audio path, the GPS path, or the parcours lifecycle.

---

### Round 6

Field test 2026-05-19 on Unihertz Jelly Star (Android 13). Battery saver was enabled before launch; walker reached the parcours with no warning. Telemetry confirmed `power_save: true` at parcours entry — the `checkbatteryopt` page had bypassed itself completely.

#### R6.1 `checkbatteryopt` OS-version-vs-API-level bypass ✅ DONE (2026-05-19) [SAFE-TODAY]

Root cause: `device.version` in Cordova returns the **Android OS version string** (e.g. `"13"` for Android 13 = API 33). The bypass guard was:

```javascript
var apiLevel = parseInt(device.version.split('.')[0], 10);
if (apiLevel < 23) return PAGE('rdv');  // API 23 = Android 6.0
```

`"13" < 23` is always `true` — `checkbatteryopt` has silently skipped itself on every device since the page was introduced. None of the three battery-opt checks (power save, background restriction, Doze whitelist) have ever run in production.

Fix: compare OS version against the OS version milestone (6.0 = Android 6.0 = API 23), not against the API level:

```javascript
// device.version is the Android OS version string ("13" for Android 13).
// isIgnoringBatteryOptimizations() requires API 23 = Android 6.0.
var osVersion = parseInt(device.version.split('.')[0], 10);
if (osVersion < 6) return PAGE('rdv');
```

Variable renamed `apiLevel` → `osVersion` throughout `checkbatteryopt` to prevent recurrence. The same pattern in `geoloc.js` (`< 10` for `ACCESS_BACKGROUND_LOCATION`) and `checknotifications` (`< 13`) correctly compares OS version against OS version milestones — no change needed there.

Files: `www/app/pages.js` (`PAGES['checkbatteryopt']` entry block).

Regression risk: **NONE for the fix itself.** The page previously never ran; it now runs as intended. On Android < 6 (practically extinct) the bypass still fires.

#### R6.2 `IsPowerSaveMode` hard block ✅ DONE (2026-05-19) [SAFE-TODAY]

After R6.1 unblocked the page, `IsPowerSaveMode` was still only a soft advisory banner (R5.4.b). Battery saver cuts background CPU and network, which will kill GPS continuity and audio playback mid-walk. Changed to a hard block: walker cannot advance while battery saver is active.

`check()` completely rewritten as a three-gate sequential pipeline:

**Gate 0 — Power save mode (hard block).** Queried first, before everything else. If `IsPowerSaveMode()` returns true, the page shows the block copy and restarts the poll timer. No further checks are performed until battery saver is disabled. Page advances automatically within one poll tick (1.5 s) of the saver being turned off.

```
Gate 0: IsPowerSaveMode()
  → true : show #checkbatteryopt-powersave, restart poll, STOP
  → false: continue to Gate 1
Gate 1: IsBackgroundRestricted()   (API 28+)
  → true : show #checkbatteryopt-restricted, restart poll, STOP
  → false: continue to runDozeCheck()
runDozeCheck: IsIgnoringBatteryOptimizations()
  → true : PAGE('rdv') — all clear
  → false: show Doze dialog, poll
```

`refreshPowerSaveBanner()` helper removed; logic inlined in the sequential flow.

Banner copy changed from advisory ("peut être moins fluide") to a hard-block instruction:
> L'**économiseur de batterie** est activé sur votre téléphone. Flanerie sera interrompue en pleine balade.
> Désactivez-le avant de commencer : **Paramètres → Batterie → Économiseur de batterie → Désactiver**.
> La balade reprendra automatiquement.

No skip button — the previous "Continuer quand même" path was rejected: battery saver kills the walk, so enforcement is mandatory.

Telemetry: `power_save_mode {on: bool}` logged at each Gate 0 evaluation.

Files: `www/app/pages.js` (`check()`, `runDozeCheck()` rewrite), `www/app/app.html` (`#checkbatteryopt-powersave` copy).

Regression risk: **LOW.** `checkbatteryopt` was broken and inert before R6.1; any device that previously sailed through will now block if battery saver is on. That is the intended behaviour.

#### R6.3 Diagnostic telemetry at parcours entry ✅ DONE (2026-05-19) [SAFE-TODAY]

Two new events logged immediately after `PARCOURS.flushPendingTelemetry()` on `PAGES['parcours']` entry. Motivated by the diagnosis session where battery saver was on but no evidence appeared in telemetry because `checkbatteryopt` never emitted anything.

**`session_diag`** — synchronous device/plugin inventory:

| Field | Value |
|---|---|
| `apk_version` | `document.APPVERSION` (launcher version code) |
| `webapp_hash` | `localStorage.APPHASH` (SHA256 of downloaded app zip) |
| `platform` | `PLATFORM` (android/ios/browser) |
| `manufacturer`, `model`, `os_version` | from `device.*` |
| `plugin_power_opt` | bool — PowerOptimization plugin present |
| `plugin_power_IsPowerSaveMode` | bool — method available |
| `plugin_power_IsBackgroundRestricted` | bool — method available |
| `plugin_power_IsIgnoringBattOpt` | bool — method available |
| `plugin_audiofocus` | bool |
| `plugin_bgloc` | bool — BackgroundGeolocation present |
| `plugin_permissions` | bool |
| `devmode` | bool |

**`power_state_at_parcours`** — async power state snapshot (fires after `session_diag`, same tick):

| Field | Value |
|---|---|
| `power_save` | `IsPowerSaveMode()` result or `"n/a"` / `"error:…"` |
| `bg_restricted` | `IsBackgroundRestricted()` result |
| `ignoring_batt_opt` | `IsIgnoringBatteryOptimizations()` result |

Only logged on Android when the PowerOptimization plugin is present. `Promise.all` collects all three concurrently.

These events land even when `checkbatteryopt` is bypassed (e.g. first-install fast path, or a future skip), giving a baseline snapshot for every session.

Files: `www/app/pages.js` (`PAGES['parcours']` entry block, IIFE after `flushPendingTelemetry`).

Regression risk: **NONE** — read-only probes, no side effects.

#### R6 verification (2026-05-19)

Confirmed on Unihertz Jelly Star (Android 13) after deploying R6.1 + R6.2 + R6.3:

- `session_diag` event present in session, `plugin_power_IsPowerSaveMode: true`.
- `power_state_at_parcours: {power_save: true, bg_restricted: false, ignoring_batt_opt: false}` confirmed plugin reads correctly.
- With battery saver ON at launch: `#checkbatteryopt-powersave` block banner visible; walk cannot proceed.
- Disabling battery saver in Settings: page auto-advanced within ~1.5 s.
- Doze whitelist dialog appeared and walk proceeded normally after whitelisting.

---

### Round 7 (Field test 2026-05-20 — FLANERIE_GIVORS)

Field test 2026-05-20 on FLANERIE_GIVORS (`flanerie_givors_v7_cbr`, 17 steps). **~39 genuine visitor walks** in a single morning wave (08:57–10:50): ~30 completed, 8 finished incomplete, 3 aborted at startup. Pre-08:57 sessions were staff tests; the SM-A515F spare phone produced ~26 short re-arm sessions between handoffs; the afternoon was operator phone-checks only. Two webapp builds were live (`fdf504c8…` early, `2f77776e…` after ~09:19).

**Headline: every Android walk that started, completed, with continuous GPS. Every incomplete or degraded walk was an iPhone.** The day splits into two distinct iOS failure modes (P1.34 GPS, R7.1 audio) plus a parcours-specific UX regression (R7.2).

#### R7.0 Reusable telemetry analysis tooling ✅ DONE (2026-05-20) [SAFE-TODAY]

`telemetry/scripts/analyze.mjs` (day/fleet report) and `session.mjs` (single-session drill-down), sharing `common.mjs` — plain Node ESM, no deps. Wired as `npm run telemetry:analyze` / `telemetry:session`. `analyze` produces the completion table, device-reuse map, GPS-blackout scan, anomaly flags and build-version split; `--cutoff=HHMM` buckets pre-opening tests and `--operator=SM-A515F` buckets the spare phone out of visitor stats. `session` prints the step timeline, GPS gaps, route progression and an audio-error breakdown that separates harmless placeholder jingles from real step-voice failures. A companion Claude Code skill (`.claude/skills/telemetry-analysis/`) records the workflow and the field-day conventions (local-time filenames, the SM-A515F spare phone, phone reuse). Complements the older `scripts/telemetry-report.js` flat table.

Files: `telemetry/scripts/{analyze,session,common}.mjs`, `telemetry/scripts/README.md`, `package.json`, `.claude/skills/telemetry-analysis/SKILL.md`.

#### P1.34 iOS background-GPS blackout on locked devices [RESEARCH-FIRST] NEW

The iOS counterpart of the Android Doze blackout (P1.31). Three of three **iOS 26.3.1** devices froze GPS callbacks for multi-minute windows mid-walk while pocketed:

| Session | Device | iOS | GPS gaps (>90 s) | Effect |
|---|---|---|---|---|
| `51nv` | iPhone 16 (`iPhone17,5`) | 26.3.1 | 158 s, 343 s, **835 s**, 196 s | route jumped step 8→13; ~5 blocs silent |
| `ibk6` | iPhone SE3 (`iPhone14,5`) | 26.3.1 | 153 s, **540 s**, 219 s, 339 s | route jumped 2→7 and 12→15 |
| `mq3z` | `iPhone14,5` | 26.3.1 | **459 s**, 448 s | only 4 steps fired in 24 min |

During each gap the walker kept walking but no `gps` callback arrived, so no `step_fire` — the route engine froze, then on the next real fix jumped several steps and burst-fired `step_done` + `step_skip_done`. The walker hears **silence across 4–5 blocs** with no signal that anything is wrong.

The same `iPhone14,5` hardware was clean on iOS 18.5 (`4rma`) and blacked out on 26.3.1 (`ibk6`). iOS 26.4.2 devices had mostly clean in-walk GPS (`4zq0`, `c7qo` completed contiguous); iOS 18.x clean; **all 21 Android walks clean**. This isolates the regression to **iOS 26.3.x background location** — possibly already addressed by Apple in 26.4 (small sample; needs confirmation).

**Why the walker gets no warning.** The v2.4.0 NSTimer keepalive (P0.5 Fix 1b) re-delivers the *last known* position every 15 s. That refreshes `lastTimeUpdate`, so the 30 s GPS-lost timeout (P1.5c) never expires — no `#gpslost-overlay`, no vibration. The keepalive successfully hides the blackout from the lost-detector but does nothing to advance the route: a stale fix is not a new fix. The walk stalls silently.

Not fixed in this round. Options:
1. **Distinguish stale-keepalive ticks from real fixes in the GPS-lost logic** (the JS-side watchdog from P1.31 option 4, now cross-platform). Track real-callback freshness separately from keepalive ticks; a multi-minute real-callback gap during non-STILL motion would surface the existing `#gpslost-overlay` ("Téléphone en veille — déverrouillez pour continuer"). Cheapest, covers Android Doze (P1.31) and iOS 26.3.x in one fix.
2. Native investigation in the BG-geolocation fork — whether `allowsBackgroundTimeExtension`, significant-location-changes, or a `CLLocationManager` reconfigure can keep callbacks alive on iOS 26.3.x. Pairs with the P0.5 Fix 3/4 backlog.
3. Operationally, if iOS 26.3.x can't be fixed before a show: advise those visitors to keep the screen awake, or hand them an Android loaner.

Needs a dedicated iOS field test, ideally a 26.3.1 and a 26.4.x device side by side, to confirm the OS-version split before committing to a native fix.

Files (when picked up): `www/app/assets/geoloc.js`, `www/app/pages.js`, possibly `cordova-background-geolocation-plugin/`.

#### R7.1 iOS step-narration playback errors [TEST-FIRST]

Distinct from P1.34 — real audio failures, not GPS. Three iOS sessions threw repeated `audio_playerror` on actual `BLOC_*` narration files (not the known-harmless `resume/afterplay/youlost.mp3` placeholder jingles, Round 3 #2):

- `rumx` (`iPhone14,5`, iOS 26.4.2) — 27 step-voice `audio_playerror`, `step_voice_failed` on BLOC_15 + BLOC_16, 3 mid-walk relaunches.
- `vigi` (`iPhone14,7`, iOS 26.4.2) — 21 step-voice `audio_playerror`, `step_voice_failed` on BLOC_14/15/16.
- `mq3z` (`iPhone14,5`, iOS 26.3.1) — 5 step-voice `audio_playerror`, `step_voice_failed` on BLOC_02/03.

`step_voice_failed` short-circuits the step to `startAfterplay()` (P1.19) — but every GIVORS step ships `afterplay.src = "-"` (see R7.2), so the fallback is silent: the walker gets a **dead bloc**, no narration at all. The pattern spans iOS 26.3.1 and 26.4.2, so it is not the same OS-version signature as P1.34.

Next step: the `audio_playerror` payload serialises the Cordova Media error as `"[object Object]"` (already flagged Round 3 #2). Tightening it to surface the underlying error code is now worth doing — without it the root cause (decode failure? audio-session deactivation? file truncated in the media pack?) can't be distinguished. SAFE-TODAY telemetry tightening, then re-test before attempting a fix.

Files: `www/app/assets/player.js` (error serialisation).

#### R7.2 Recovery map auto-opens on every default-afterplay step ✅ FIX IDENTIFIED [TEST-FIRST]

`map_opened` fired with `source: default_afterplay` ~120 times across the day — the dominant cause of mid-walk map openings (vs `manual` ~80, `lost` 9). Root cause: every FLANERIE_GIVORS step has `afterplay.src = "-"` (no per-step afterplay, by content design), so `step_afterplay_fallback` (~150 events, **all** `reason: no_src`) is the *normal* path for this parcours, not an exception. P1.29 wired `DEFAULT_AFTERPLAY_PLAYER.on('play') → openMapForRecovery({source:'default_afterplay'})` on the assumption that reaching the default afterplay means the step's real afterplay failed. For a parcours that ships no per-step afterplay at all, that assumption is wrong: the recovery map pops open unprompted at every stationary listening spot, ~2–3× per walk.

Fix: gate the map-open on the *reason*. P1.29 should call `openMapForRecovery` only when the default afterplay is a genuine fallback from a **broken** step afterplay (`reason: loaderror`), not when the step simply never had one (`reason: no_src`). `PlayerStep._needsDefaultAfterplay()` already distinguishes the two cases — expose the reason to the `play` handler and skip the map-open for `no_src`. `step_afterplay_fallback` telemetry is unaffected.

Files: `www/app/pages.js` (`DEFAULT_AFTERPLAY_PLAYER.on('play')` handler), `www/app/assets/player.js` (`_needsDefaultAfterplay` reason exposure).

Regression risk: **LOW** — narrows an existing trigger; the `loaderror` case (real failure) still opens the recovery map.

#### R7.3 iOS audiofocus_request_fail flood [RESEARCH-FIRST]

`audiofocus_request_fail` fired **~4,900 times on iOS** vs 52 on Android. Concentrated on `4zq0` (1,545) and `c7qo` (1,446) — ~97 % of audio-focus requests failing on those two sessions. Both still completed the walk, so it is not a confirmed walk-breaker, but it shows the iOS keepalive / zone / offlimit players repeatedly failing to acquire audio focus in the background. Android requests succeed normally (`892p`: 275 ok / 14 fail). Per-session counts vary wildly on identical hardware (`iPhone14,2`: `6epi` 80 fails, `4zq0` 1,545), so it is session-state-dependent, not a clean device or OS split. Worth a `player.js` review of whether iOS should request audio focus per-play at all for the silent keepalive player — the request is plausibly redundant there. Diagnostic only this round.

Files (when picked up): `www/app/assets/player.js`, `cordova-plugin-audiofocus/`.

#### R7.4 Android observations — no action

- **Resume churn:** `f743` (Samsung A15) relaunched **7×** mid-walk; `wjfo` / `mqgf` 4× each. The Round 4 resume machinery (`step_refire_current`, `parcours_restore`) recovered every one — all completed with contiguous steps. No fix needed; the resume path works as designed, but A1x-class devices remain crash-prone.
- **Aborted starts:** `f6x2`, `vsrc`, `ufax` died at step 0 within 3 min; `vsrc` / `5eb0` showed `audio_play_stuck` + `audio_play_timeout` at launch (R4.1 / R4.4 territory). `5eb0` was reinited and the retry (`9qf4`) completed cleanly — reinit remains an effective operator recovery.
- No Android GPS gaps over 120 s on any of the 21 Android walks. P1.31 (Doze blackout) did not reproduce; the fleet didn't include the moto g(7) power / TCL T433D.

#### R7.5 Telemetry-loss caveat

`ffqz` (Xiaomi `2201117TY`) flushed only 716 events in 42 min — the telemetry beacon never drained (offline, no flush-on-reconnect). The route shows completion but the session is not assessable. A buffered-telemetry flush-on-reconnect would close this blind spot (relates to the C7 server-resilience backlog); deferred.

---

### Round 8 (GIVORS follow-up — Phase 1A JS-only batch, 2026-05-26)

Triggered by `20260520-GIVORS-report.md` §12 remediation plan. Five behaviour fixes and ten diagnostic additions, all JS-only (no plugin rebuild). Scoped to be safe before the next field test (~1 week); show in ~4 weeks. See report §12.10 for the full acceptance criteria table. Committed in 6 logical commits (`5ac13f8` GIVORS report update, `52131be` A4, `ba07d96` C1, `3a5fafc` D1+A7, `3f73b27` A5, `2d7f645` diagnostic telemetry).

#### A4 Cross-step voice-position contamination ✅ DONE (2026-05-26) [SAFE-TODAY]

**Problem (P8 / rumx session).** `resumeStepVoicePos` snapshotted during step N's voice was consumed unchanged by step N+1 on its first fire (`!wasCurrentStep`). On an iOS kill/relaunch mid-walk the snapshot from BLOC_15 was applied as a seek offset to BLOC_16, producing a stutter-skip at the wrong timestamp. The `rumx` session (R7.1) also showed a double-resume stutter (M2/P6 class): when GPSSIGNAL_OK stayed `true` via the keepalive, re-entering a step zone re-applied the saved pos even when `wasCurrentStep` was already `true` and audio was already playing.

**Resolution — two coupled changes:**
1. `spot.js` `Step.updatePosition`: on `!wasCurrentStep`, clear `PARCOURS.state.resumeStepVoicePos = 0` after `PARCOURS.currentStep(this._index)` and call `PARCOURS.store('step_fire')` to persist the clear. The snapshot set by the prior step cannot survive into the new step.
2. `parcours.js` `snapshotVoicePosition`: gate tightened from `pos > 0` to `pos > 3`. The first 2–3 s after a seek are unreliable; applying a near-zero snapshot as a resume offset immediately re-seeks to near-zero (P6 stutter). The 3 s threshold is well below the first periodic store tick (10 s) so no legitimate mid-voice position is missed.

Files: `www/app/assets/spot.js`, `www/app/assets/parcours.js`

Regression risk: **LOW** — the `!wasCurrentStep` clear fires only when a new step becomes current; the pos gate change only affects the first 3 s window after a resume.

Acceptance: on next field test, `step_audio_trigger` events must not carry non-zero `resume_seek_pos` on a step's first fire when the prior step was a different audio file. No `voice_snapshot` with `pos < 3` should trigger a seek.

#### C1 Audio error classification + resolved URI telemetry ✅ DONE (2026-05-26) [SAFE-TODAY]

**Problem (R7.1 root-cause blind spot).** `audio_playerror` / `audio_loaderror` was serialising the Cordova Media `MediaError` object as `"[object Object]"` (flagged Round 3 #2 and R7.1). Without the actual error code, the root cause of iOS step-narration failures (decode failure? audio-session deactivation? truncated file?) was undiagnosable.

**Resolution:**
- New `classifyAudioErrorType(kind, code, message)` module-level helper in `player.js` maps Cordova Media error codes 1–4 and Howler error codes to human-readable `error_type` strings: `decode_error`, `network_error`, `permission_denied`, `not_supported`, `unknown`.
- `_logAudioTelemetry` rewritten to explicitly extract `.code` / `.message` from `MediaError` instances (with string/number fallbacks), call the classifier, and add `error_type`, `error_code`, `backend` (native/howler) fields to every error event.
- New `audio_uri_resolved` event on every `load()` after player construction — logs `src`, `resolved_uri`, `backend` — so path-resolution failures can be diagnosed before a play attempt.
- New `load_duration_ms` field on `audio_play_started` (F-A1, see R8.0 below) — time from `play()` call to first `play` event.

Files: `www/app/assets/player.js`

Regression risk: **LOW** — pure telemetry enrichment; no audio path behaviour changed.

Acceptance: iOS sessions with `audio_playerror` must show `error_code` (integer) and `error_type` (string) instead of `"[object Object]"`. `audio_uri_resolved` appears once per step load. R7.1 root cause (decode vs session vs file) becomes deterministic from telemetry alone.

#### D1 iOS 26.3.x version warning at onboarding ✅ DONE (2026-05-26) [SAFE-TODAY]

**Operational mitigation only — does not replace the B4 real-callback watchdog (Phase 1B) or D3/D4/D5 native GPS reacquire (Phase 3).**

**Problem (P1.34).** iOS 26.3.x has a confirmed background-GPS blackout bug that silently drops 4–8 contiguous steps per affected walk. Visitors on that OS version need to be warned to keep their screen awake.

**Resolution.** `PAGES['confirmgeo']`: reads `device.version` on iOS, extracts major/minor, and when `major === 26 && minor <= 3` injects a red-styled warning block into `#confirmgeo-desc2`: "Maintenez l'écran allumé pendant toute la balade." Logs `ios_version_warning` telemetry with `ios_version`, `major`, `minor`, `patch` so the next session shows which OS versions remain in the field.

Files: `www/app/pages.js`

Regression risk: **NONE** — additive UI text on iOS only; Android path untouched.

Acceptance: iOS 26.3.x device sees the red warning block at `confirmgeo`. iOS 26.4.x, 18.x, and Android see no change. `ios_version_warning` appears in session telemetry.

#### A7 Generic end-of-walk message + session close ✅ DONE (2026-05-26) [SAFE-TODAY]

**Problem.** `PAGES['end']` had no explicit `TELEMETRY.end()` call — the session was left open, risking loss of final events. The show continues after the walk with a non-phone chapter; the end-screen text must work for both loan and personal phones without implying any return obligation.

**Resolution.**
- On `PAGES['end']` entry: log `walk_end_shutdown` (`step_count`, `is_loan`, `device_uuid`), then `TELEMETRY.flush().finally(() => TELEMETRY.end())`.
- Typewriter cycle: 4 generic phrases — "La balade est terminée.", "Merci de votre présence.", "Le spectacle continue…", "Vous pouvez rangez le téléphone." — suitable for both loan and personal phones; acknowledges the show continues without the device.

Files: `www/app/pages.js`

Regression risk: **LOW** — additive; the missing `TELEMETRY.end()` was harmless (server eventually times out the session) but now corrected.

#### A5 Persistent device identity + loan flag + server registry ✅ DONE (2026-05-26) [TEST-FIRST]

**Problem.** Phones are reused across visitors and re-inited between handoffs. Without a stable per-device identifier, fleet telemetry could not distinguish "same phone, different visitor" from "different device", and there was no way to flag loan phones vs personal phones.

**Resolution:**
- `telemetry.js`: `_getDeviceUuid()` creates/reads a UUID from localStorage (`crypto.randomUUID()` with fallback). `_isLoanDevice()` / `_setLoanDevice(bool)` persist a sticky `LOAN_DEVICE` boolean. Both added to `_buildSessionMeta()` — every session carries `deviceUuid` and `isLoanDevice`. Exposed on public `TELEMETRY` API.
- `pages.js`: `session_diag` enriched with `device_uuid` and `is_loan`. A `POST /devices` call registers the device after logging `session_diag`.
- `pages.js` (tools page): "Téléphone de prêt: ?" toggle button lets the operator mark/unmark a device as a loan phone.
- `server.js`: `POST /devices` (upsert by UUID), `GET /devices` (admin list), `PATCH /devices/:uuid` (friendly_name / is_loan) endpoints backed by `devices.json`.
- `telemetry/scripts/common.mjs`: `deviceUuid` and `isLoanDevice` added to session summary.
- `telemetry/scripts/analyze.mjs`: `--include-loan-only`, `--exclude-loan`, `--device-uuid` filter flags.
- `www/app/app.html`: loan-phone toggle button added to tools page DOM.

Files: `www/app/assets/telemetry.js`, `www/app/pages.js`, `www/app/app.html`, `server.js`, `telemetry/scripts/common.mjs`, `telemetry/scripts/analyze.mjs`

Regression risk: **LOW** — telemetry and server additions are read-only from the walk perspective. Tools page button only reachable in DEVMODE.

Acceptance: every `session_start` / `session_resume` carries `deviceUuid` (stable across relaunches on the same device) and `isLoanDevice`. `GET /devices` lists all registered devices with their last-seen session. `--exclude-loan` in `analyze.mjs` correctly filters SM-A515F spare-phone sessions.

#### R8.0 Phase 1A diagnostic telemetry additions ✅ DONE (2026-05-26) [SAFE-TODAY]

Ten observability additions targeting the open questions from the GIVORS field day. All are logging-only — no behaviour changes to GPS, audio, or step-progression paths.

| ID | Event(s) | What it answers |
|---|---|---|
| B4-diag | `real_callback_freshness` (30 s periodic) | Distinguishes real GPS callbacks from 15 s NSTimer/Handler keepalive ticks; exposes `real_callback_age_ms` to narrow the P1.34 iOS and P1.31 Android blackout windows |
| F-G2 | `app_visibility` (deduped) | Background/foreground transitions on iOS (`document.pause/resume/visibilitychange`) and Android (`bgGeo on('background'/'foreground')`); closes the iOS blind spot noted in P3.5b |
| F-A1 | `audio_play_started.load_duration_ms` | Time from `play()` call to first `play` event — confirms whether cold-load delay (R4.1) is load latency or a stuck player |
| F-Z1 | `accuracy_near_border` (throttled) | GPS accuracy when the walker is within 20 m of a step boundary — drives Phase 1B E1/E2/E3 accuracy gate calibration |
| F-Z2 | `step_resume_current` enriched | Adds `accuracy`, `consecutive_inside_samples`, `time_since_first_inside_ms`, `real_callback_age_ms` — quantifies false re-arm triggers |
| F-Z3 | `step_implicit_done` | Fires when an undone step is silently stopped by the "stop all other steps" loop — surfaces missed `step_done` emissions |
| F-N3 | `_jsReceivedAt` stamp + `step_audio_trigger.real_callback_age_ms` | JS-side timestamp on every position callback; `step_audio_trigger` gets `real_callback_age_ms` to track keepalive-vs-real at trigger time |
| F-R1 | `session_start.inter_session_idle_ms` | Time since prior session ended (from localStorage) — distinguishes cold-start from rapid-relaunch patterns |
| F-R2 | `rearm_pre_state` snapshot | Parcours state dump on rearm button tap — captures whether the prior session ended cleanly or was abandoned mid-walk |
| F-K3 | `bg_restrictions_recheck` (5 min periodic, Android) | Re-checks `IsBackgroundRestricted()` / `IsPowerSaveMode()` mid-walk — detects settings changes that happen after onboarding (e.g. OEM auto-sleep activating) |

Files: `www/app/assets/geoloc.js` (B4-diag, F-G2, F-N3), `www/app/assets/player.js` (F-A1, via C1 above), `www/app/assets/parcours.js` (F-Z1), `www/app/assets/spot.js` (F-Z2, F-Z3, F-N3 stamp), `www/app/assets/telemetry.js` (F-R1), `www/app/pages.js` (F-R2, F-K3)

Regression risk: **NONE** — all additions are `TELEMETRY.log` calls or `setInterval` probes. The `real_callback_freshness` and `bg_restrictions_recheck` intervals are cleared in `PAGES_CLEANUP['parcours']`.

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

#### C4 Container build checklist ✅ DONE (2026-05-27)

A minimal reproducible rebuild + smoke checklist now lives in [FlanerieCordova/README.md](../FlanerieCordova/README.md). It covers Android debug build, iOS prepare / Xcode handoff, required plugin reinstalls, and a short runtime smoke pass for launcher / offline cache / locked-screen walk behaviour.

**Reinstall requirements now captured in the checklist:**
- `cordova-plugin-media` — install variable `KEEP_AVAUDIOSESSION_ALWAYS_ACTIVE` changed `NO` → `YES` (2026-05-13, P1.11b). Variable is read at plugin install time only; existing builds keep the old value. Required step on next build: `cordova plugin remove cordova-plugin-media && cordova plugin add cordova-plugin-media@7.0.0` OR `cordova platform remove ios && cordova platform add ios`.
- After build: verify `platforms/ios/App/config.xml` contains `<preference name="KeepAVAudioSessionAlwaysActive" value="YES" />` (lowercased key `keepavaudiosessionalwaysactive` is what `CDVSound.m:38` actually reads).

#### C5 Deferred plugin fork — power optimization [PARTIAL — `IsBackgroundRestricted` shipped 2026-05-19 as R5.2; rest open]

**2026-05-27 code cross-check:** the local fork now exists at `~/Bakery/cordova-plugin-power-optimization/`, the container dependency points at `github:Maigre/cordova-plugin-power-optimization`, and the previously-listed `RequestOptimizationsMenu` fix plus OEM intent-table expansion are already in code. The remaining backlog here is the additive plugin work: `GetStandbyBucket()`, `IsAutoRevokeWhitelisted()`, `RequestAutoRevokeWhitelist()`, and any decision to repoint local development to the workspace fork instead of the GitHub URL.



**Status:** scoped 2026-05-13, deferred (cannot republish the app this session). The JS-only fixes for known bugs and manufacturer-tailored copy are already shipped under P1.12 — this entry covers what requires forking `cordova-plugin-power-optimization` (currently `github:snt1017/cordova-plugin-power-optimization`) and adding native code.

**Why fork:**

The current plugin handles only Doze (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) and a stale OEM intent list. Everything else that actually kills a foreground service on modern Android is invisible to it. For a 45-min locked-pocket walk, the biggest unhandled signals are stock-Android background restriction and OEM-specific sleep features (Samsung "Apps en veille profonde", Xiaomi autostart, etc.).

**Java methods still worth adding:**

| Method | API | Purpose |
|---|---|---|
| `GetStandbyBucket()` | 28+ | `UsageStatsManager.getAppStandbyBucket()` — `RESTRICTED`/`RARE` buckets throttle aggressively |
| `IsAutoRevokeWhitelisted()` | 30+ | `PackageManager.isAutoRevokeWhitelisted()` — hibernation watch (long-tail) |
| `RequestAutoRevokeWhitelist()` | 30+ | `Intent.ACTION_AUTO_REVOKE_PERMISSIONS` |
| `OpenAppDetailsSettings()` | universal | optional plugin-side fallback if we want the power-opt plugin to own the full Settings path instead of relying on bg-geo `showAppSettings()` |

Already shipped in code: `IsBackgroundRestricted()`, `IsPowerSaveMode()`, `RequestOptimizationsMenu()` fix, and the broader OEM intent table expansion.

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

#### C6 Audiofocus plugin (iOS): interruption without ShouldResume ✅ DONE (2026-05-19 as [R5.3](#r53-audiofocus-plugin-ios-interruption-without-shouldresume--done-2026-05-19-safe-today))

Closed. The conservative variant from the original C6 plan (`AUDIOFOCUS_GAIN_AVAILABLE` + JS-side auto-resume with soft vibration + `document.resume` safety retry) shipped under R5.3. The aggressive variant (emit hard `AUDIOFOCUS_GAIN` unconditionally) was not chosen — the soft signal gives the walker tactile feedback that the system did something, without lying about ShouldResume.

Original problem statement and plan retained below for context.



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

#### C7 Server resilience ✅ PARTIAL (2026-05-14) [SAFE-TODAY]

Server-side issues found in the Round 2 read of `server.js`. The operational context (trusted small team, P2.9 already accepts public-endpoint exposure) keeps these low priority, but C7.1 has a real availability impact.

- **C7.1 — one corrupt parcours JSON breaks `/list` for everyone. ✅ DONE (2026-05-14).** `/list` previously `JSON.parse`d every file in `./parcours/` with no per-file try/catch; a single malformed file 500s the endpoint → the app's `checkdata` → `nodata` → infinite 2s retry loop for *all* users. Now wrapped in try/catch with skip-with-log on a corrupt or `info`-less file (matching what the telemetry list endpoints already do).
- **C7.2 — `/telemetry-push` rewrites the whole session file every flush. [DEFERRED]** Read → parse → concat → write the entire session JSON every 30s per session → O(n²) write amplification over a 45-min walk. (Corrected from the initial Round 2 note: there is *no* lost-event race — Node's event loop is single-threaded and the handler's `readFileSync` → `concat` → `writeFileSync` is fully synchronous, so two same-session pushes can't interleave.) The real fix is append-only NDJSON per session, but that is a storage-format migration that needs every reader updated in lockstep (`scripts/telemetry-report.js`, the `/telemetry/*` endpoints in `server.js`, `www/control/telemetry.html`) plus on-disk migration of existing sessions — out of scope for a "no behaviour change" batch. Left as a standalone follow-up; current write amplification is tolerable at the operational scale (a handful of concurrent walkers).

Files: `server.js`

Regression risk: **LOW** — C7.1 is a pure try/catch wrap.

---

## Recommended Execution Sequence

### Round 8.5 / Phase 1B partial (2026-05-26) — field-data-independent items ✅ code complete

The four Phase 1B items that do not depend on Phase 1A field-calibrated data shipped early so they ride the same build as Phase 1A.

- **R7.2** Recovery map gated on `default_afterplay reason: 'loaderror'` only — suppresses ~150 spurious map-opens per FLANERIE_GIVORS walk where every step has `afterplay.src='-'`. Routing reason published via `window.DEFAULT_AFTERPLAY_LAST_REASON`.
- **B1** Aggressive past-step media unload — on each step fire, `clear()` every step with `_index < this._index && isLoaded()`. New `step_past_unload` telemetry per cleared step. Targets the Samsung A15-class memory pressure pattern.
- **A6** Parcours freshness check — `checkdata` compares server mtime (from `/list`) vs cached `parcoursMTime_<pID>`. If newer, surfaces new `parcoursupdate` page with "Mettre à jour" / "Continuer sans mise à jour". Offline failures fall through to cached. New telemetry: `parcours_freshness_check`, `parcours_update_chosen`.
- **C2** Passive media integrity check — new `Parcours.verifyMediaIntegrity()` method iterates server's `/update/media/<pID>` file list in dryrun mode, flagging missing / truncated / hash-mismatched files. Async, non-blocking, logs `media_integrity_check {total, ok, failed, failed_files}` at parcours entry. Skipped in WEB mode.

**Deferred to post-field-test:** B4 watchdog (needs `real_callback_freshness` threshold calibration), E1/E2/E3 zone-overshoot gates (needs `accuracy_near_border` distribution data). Both blocked on Phase 1A telemetry from the next field test.

---

### Round 8 / Phase 1A implementation (2026-05-26) — ✅ code complete, awaiting next field test

JS-only batch based on the GIVORS field-test analysis (§12.10 of `20260520-GIVORS-report.md`). No plugin rebuild required; safe to deploy before the next field test.

- **A4** `resumeStepVoicePos` cleared on step advance + `pos > 3` snapshot gate — closes P8 cross-step contamination and M2/P6 double-resume stutter.
- **C1** Audio error classification (`classifyAudioErrorType`) + `audio_uri_resolved` per-load — surfaces the R7.1 iOS narration failure root cause from telemetry.
- **D1** iOS 26.3.x onboarding warning at `confirmgeo` — operational mitigation for P1.34; does not replace the B4 watchdog or D3/D4/D5 native fix.
- **A7** Generic end-of-walk typewriter message + `TELEMETRY.flush()→end()` — works for both loan and personal phones; closes the missing session-end gap.
- **A5** Persistent device UUID (localStorage) + loan flag + `POST /devices` server registry + tools-page toggle + analyze filter flags — enables per-device fleet tracking.
- **R8.0** 10 diagnostic additions (B4-diag, F-G2, F-A1, F-Z1, F-Z2, F-Z3, F-N3, F-R1, F-R2, F-K3) — all logging-only; closes the major observability gaps from P1.34 and R7.

**No validation required before deployment** (all SAFE-TODAY except A5 which is TEST-FIRST for the server endpoints). Deploy before the next field test. Validation matrix in the "Awaiting field validation" section below.

---

### Round 5 implementation (2026-05-19) — ✅ code complete, awaiting Samsung A41 build test

Native plugin work targeting the 2026-05-18 Samsung SM-A415F (A41) BLOC_14→BLOC_15 OEM-kill repro. Requires a Cordova rebuild (Android + iOS) and plugin reinstall before deployment; a Play Store upgrade is the intended distribution path.

- **R5.1** Audiofocus plugin keepalive — `mediaPlayback` foreground service stays alive for the duration of a parcours, not just while audio focus is held. The targeted fix for the Samsung A41 mid-walk kills.
- **R5.2** Power Optimization plugin `IsBackgroundRestricted()` — closes the highest-impact subset of the C5 backlog. `checkbatteryopt` now hard-blocks when the user's app is explicitly background-restricted, with explicit Samsung Settings-path copy.
- **R5.3** Audiofocus plugin (iOS) interruption-without-`ShouldResume` — closes the full C6 backlog item. Adds `AUDIOFOCUS_GAIN_AVAILABLE` event + JS auto-resume with `document.resume` safety retry.
- **R5.4** Store-submission polish bundle (Tier-1 catch-up bundled with the same plugin rebuild): `RequestOptimizationsMenu` inverted-conditional fix (R5.4.a, closes C5 sub-item); `IsPowerSaveMode()` soft warning (R5.4.b, closes C5 sub-item); OEM intent table expansion — Samsung One UI 4+, OnePlus, OPPO/Realme, Vivo, Honor (R5.4.c, closes C5 sub-item); audiofocus notification tap-to-open `PendingIntent` (R5.4.d); iOS usage descriptions to French + walker-specific (R5.4.e); app version visible to operator on the `select` page (R5.4.f). All SAFE-TODAY, all additive.

**Build steps required:**
```bash
# In FlanerieCordova/
cordova plugin remove cordova-plugin-audiofocus
cordova plugin add ~/Bakery/cordova-plugin-audiofocus
cordova plugin remove cordova-plugin-power-optimization
cordova plugin add ./plugins/cordova-plugin-power-optimization
# (Or: cordova platform remove android ios && cordova platform add android ios)
cordova build android
cordova build ios
```

**Validation matrix (run before Play Store push):**
- Samsung A41 (SM-A415F, Android 12) full 45-minute walk on the new build → no `session_resume` between BLOC_14 and BLOC_15. `audiofocus_keepalive_started` fires once, `audiofocus_keepalive_stopped` fires once.
- Samsung A41 with "Background usage limits: Restricted" set in Settings → `checkbatteryopt` shows the new restricted-state UI and polls until cleared.
- iPhone: trigger Siri mid-walk and dismiss → audio resumes within ~1 s with soft double-pulse, telemetry shows `audiofocus_change {state: 'AUDIOFOCUS_GAIN_AVAILABLE'}`.
- Healthy walks on a non-restrictive device (Pixel, recent Samsung S/A5x) → no new events surface; baseline behaviour unchanged.

Deferred from this round:
- **R4.1** Android first-voice cold-load — still pending field validation of R4.4. Independent of Samsung A41 issue.
- **R4.3 / P1.31** Doze GPS blackouts on Motorola / TCL — independent of Samsung A41 issue; the JS-side gap watchdog option remains the cheapest fix.
- **Full C5 fork** (standby bucket, hibernation whitelist, OEM intent table expansion, `RequestOptimizationsMenu` conditional, proper `~/Bakery/cordova-plugin-power-optimization/` fork) — R5.2 took the urgent subset only.

### Round 4 implementation (2026-05-18) — ✅ code complete, awaiting next field test

Quick-wins batch triggered by the 2026-05-18 FLANERIE_GIVORS_V7_CBR field test (22 sessions, 8 devices). All JS-only, all SAFE-TODAY (with R4.4 marked TEST-FIRST because it adds retry-on-stuck behaviour to the play watchdog).

- **R4.2** parcours_restore lifecycle fix + session_resume payload enrichment — unblocks the Round 3 / P3.5b diagnostic that fired zero events across all 22 sessions because `build()` ran before `TELEMETRY.start()`.
- **R4.4** audio_play_timeout truth check + single-attempt recovery — watchdog now cross-checks actual play state, emits `audio_play_timeout_self_healed` if audio was in fact playing, attempts one stop+play retry if genuinely stuck before logging `audio_play_stuck`. Targets the F1 / R4.1 Android first-voice cold-load hang; may close it without further work pending field validation.
- **R4.5** voice_snapshot truth-check fields — `audio_playing` and `load_state` added so stuck-load runs can be distinguished from "just started" or "running normally" at a glance.
- **R4.6** GPS gap thresholds raised above the 15 s native keepalive interval (`GPS_CALLBACK_GAP_THRESHOLD` 8000 → 20000, `GPS_SLEEP_SUSPECT_THRESHOLD` 15000 → 30000) — eliminates the iPhone/Sony false-positive noise without weakening detection of the real R4.3 / P1.31 minutes-long blackouts.
- **R4.7** step_afterplay_fallback + step_voice_failed now carry `step` and `step_name` (PlayerStep gets a back-ref to its owning Step).
- **R4.8** user_recovered distance clamped to ≥0 (signed distance was leaking negative when recovery happened inside a polygon).
- **R4.9** voice_snapshot_skipped deduped on `(step, reason, playstate)` transitions — expected 10×–100× event-volume reduction.

Deferred from this round (Round 5 candidates, both require dedicated field-test outings):
- **R4.1** Android first-voice cold-load hang — primary focus of the next outing. R4.4 takes a first swing at it; validate on the same Xiaomi/Samsung/Moto fleet that reproduced the issue. The new `audio_play_stuck_retry` / `audio_play_stuck` / `audio_play_timeout_self_healed` telemetry will tell us whether R4.4 is enough or whether R4.1 option 2 (`NativeMediaPlayer` extension to Android) is required.
- **R4.3 / P1.31** Doze GPS blackout on Motorola moto g(7) power + TCL T433D — repro confirmed cleanly this round. Recommend committing R4.3 option 0 (JS-side 60-second gap watchdog with "déverrouillez pour continuer" UI band) before the next session because it's nearly free now that R4.6 has quieted the underlying gap events.

### Round 3 implementation (2026-05-18) — ✅ code complete, awaiting next field test

Triggered by the 2026-05-15 FRAPPAZ_V10-modif_monnot field test (13 sessions, 9 devices). Two atomic changes, both safe to ship before the next outing because next outing is the only way to validate the iOS instrumentation.

- **P1.30** off-route popup no longer shows "Rendez vous au point de départ" behind the recovery map when the parcours starts mid-route (one-line `pages.js` fix; SAFE-TODAY).
- **P3.5b / P2.15** voice-snapshot lifecycle telemetry added (`voice_snapshot`, `voice_snapshot_skipped`, `parcours_store`, `parcours_restore`) to isolate why iOS `session_resume` always reads `resume_seek_pos: null`. No behavioural change; the next field test will pinpoint whether Plan B or Plan C of P3.5 is needed.

Deferred from this round (Round 4 candidates):
- **P1.31** Android Doze GPS blackout (Motorola moto g(7) power, TCL T433D) — needs a dedicated test session on those specific devices to choose between OEM-class workarounds, BG plugin reconfig, and an OS-level "phone asleep" UI escalation.
- **P1.32** iPhone 8 / iOS 16.7 launcher first-install — demoted to LOW: the device boots fine on regular domestic WiFi, only stalls on a 4G personal-hotspot tether. Most likely NAT64 / IPv6-only path or MTU clamping on the tether, not a code regression. Operational workaround: "use real WiFi for the first install on legacy iOS." The launcher-telemetry-beacon idea (option C) is still independently valuable — see "Next implementation session".

### Round 2 implementation (2026-05-14) — ✅ code complete, awaiting field validation

All four batches implemented in one session. JS syntax-checked; no behavioural field test yet.

- **Batch A — Safe correctness** ✅ DONE: **P1.24** (`init()` no-op listener removed), **P1.27** (duplicate `step_done` guarded), **P1.28** (`CHECKGEO` cleanup), **P2.12** (defensive hardening cluster: `Spot.updatePosition` guard, `Parcours.find`, polygon Objet volume, `master` default), **P2.13** (telemetry session keyed on `pID`), **C7.1** (`/list` corrupt-file resilience).
- **Batch B — Resume / lifecycle** ✅ DONE (needs a real kill+relaunch walk): **P1.23** (`update()` gated to `currentPage === 'parcours'`), **P1.26** (`GEO.stopGeoloc()` on walk end + cutoff), **P2.14** (`checkmotion` resume grace).
- **Batch C — Step / LOST logic** ✅ DONE (needs full walk-through): **P1.25** (`reachableSteps()` + `isStepMandatory()`, LOST entry vs nearest reachable, recovery into any reachable step, `LOST_EXIT_M` removed) + **P1.8** (inverted-optional fire-gate fixed). **P1.29** (recovery map auto-opens on `DEFAULT_AFTERPLAY_PLAYER` play) shipped with this batch.
- **Batch D — Structural refactor** ✅ MOSTLY DONE: **P3.6** (single `allSteps` owner ✅, `initMap` `mapState` ✅, defer global player `.load()` — deferred pending FlanerieCordova launcher-ordering check), **P1.28** parcours-handler teardown ✅. **C7.2** (telemetry NDJSON write model) left deferred — a storage-format migration needing all readers updated in lockstep, out of scope for a no-behaviour-change batch.

### Awaiting field validation (shipped, build pending or untested)

**Phase 1B partial (2026-05-26) — next field test validation targets:**
- **R7.2** (2026-05-26) — `map_opened` events must no longer carry `source: 'default_afterplay'` with `reason: 'no_src'`. The `loaderror` case still opens the map (force-trigger via devmode tools "Afterplay générique sur étape courante" + a real broken file).
- **B1** (2026-05-26) — `step_past_unload` events fire at each step transition for steps with index < current. No audio glitches when walking back into a previously-completed step (LOST → recover scenario should still work — re-entering rehydrates via `loadAudio()`).
- **A6** (2026-05-26) — force a server-side parcours edit (touch `parcours/<file>.json` mtime) → app shows the update gate. "Mettre à jour" triggers fresh preload; "Continuer sans mise à jour" routes through to checkgeo. `parcours_freshness_check` events present in every `checkdata` pass.
- **C2** (2026-05-26) — `media_integrity_check` fires once at parcours entry. Healthy device: `failed: 0`, `skipped: false`. Force the issue by renaming one media file on the device → expect `failed: 1` with the file in `failed_files`.

**Phase 1A (2026-05-26) — next field test validation targets:**
- **A4** (2026-05-26) — `step_audio_trigger` events on first fire of a new step must not carry non-zero `resume_seek_pos` from the prior step. No `voice_snapshot` with `pos < 3` should trigger a seek. Cross-check `rumx`-class sessions for double-resume stutter absence.
- **C1** (2026-05-26) — iOS sessions with `audio_playerror` must show `error_code` and `error_type` (not `"[object Object]"`). `audio_uri_resolved` must appear once per step audio load.
- **D1** (2026-05-26) — Any iOS 26.3.x device must see the red warning block at `confirmgeo`; iOS 26.4.x / 18.x / Android must see no change. `ios_version_warning` telemetry present.
- **A7** (2026-05-26) — `walk_end_shutdown` event present at the end of every completed session. `session_end` (from `TELEMETRY.end()`) present. Typewriter cycle legible on a locked screen.
- **A5** (2026-05-26) — `session_start.deviceUuid` stable across relaunches on the same device. `isLoanDevice` matches the operator's toggle. `GET /devices` lists the fleet. `--exclude-loan` in `analyze.mjs` filters SM-A515F spare-phone sessions correctly.
- **B4-diag** (2026-05-26) — `real_callback_freshness` events appear every 30 s on parcours page. During a P1.34-class GPS gap the `real_callback_age_ms` field grows past 60 s while `last_keepalive_age_ms` stays ≤ 20 s. This is the key signal for Phase 1B B4 watchdog calibration.
- **F-G2** (2026-05-26) — iOS sessions must now show `app_visibility` events (from `document.pause/resume`); Android sessions via `bgGeo on('background'/'foreground')`.
- **F-A1** (2026-05-26) — `audio_play_started` events carry `load_duration_ms`; expect > 5 s on the R4.1 cold-load Android devices.
- **F-Z1** (2026-05-26) — `accuracy_near_border` events appear when walker is within 20 m of a step boundary; `accuracy` field provides calibration data for Phase 1B E1/E2/E3 gates.
- **F-Z2** (2026-05-26) — `step_resume_current` events carry `accuracy`, `consecutive_inside_samples`, `time_since_first_inside_ms`; look for false re-arm triggers (high `consecutive_inside_samples` with high `real_callback_age_ms`).
- **F-Z3** (2026-05-26) — `step_implicit_done` appears for steps stopped by the "stop all other steps" loop that hadn't emitted their own `step_done`.
- **F-R1** (2026-05-26) — `session_start.inter_session_idle_ms` present; short values (< 5 s) identify rapid-relaunch patterns (operator re-arm) vs long values (cold-start visitor walks).
- **F-R2** (2026-05-26) — `rearm_pre_state` appears on every rearm button tap; fields describe prior session completion state.
- **F-K3** (2026-05-26) — `bg_restrictions_recheck` appears every 5 min on Android; must not appear on iOS.

- **R4.2** parcours_restore lifecycle + session_resume payload (2026-05-18) — every relaunched session should now surface `parcours_restore`; `session_resume.resume_seek_pos` should carry the saved voice position directly
- **R4.4** audio_play_timeout truth check + retry (2026-05-18) — on the Android fleet (Xiaomi M2101K7AG, Samsung A41/A51, Moto G7) that reproduced the F1 / R4.1 cold-load hang, look for `audio_play_timeout_self_healed` (false positives now), `audio_play_stuck_retry` then either recovery or `audio_play_stuck` (genuine stucks). If R4.4 closes the issue, no `audio_play_stuck` appears and BLOC_01 voice starts within seconds on all devices
- **R4.5** voice_snapshot truth-check fields (2026-05-18) — every `voice_snapshot` should now carry `audio_playing` and `load_state`; cross-reference confirms whether long pos=0 runs are genuine stucks (R4.1) or normal afterplay phases
- **R4.6** GPS gap threshold tuning (2026-05-18) — iPhone walks should no longer produce 50+ `gps_callback_gap` per session from the NSTimer keepalive; Sony Android 8 should similarly quieten
- **R4.7** step_afterplay_fallback / step_voice_failed step-name fields (2026-05-18) — every event now carries `step` and `step_name`, not `null`
- **R4.8** user_recovered distance clamp (2026-05-18) — no more negative distances
- **R4.9** voice_snapshot_skipped throttling (2026-05-18) — event count per session should drop ~10×–100×
- **P1.30** off-route popup title (2026-05-18) — verify on a fresh-but-mid-route start that the recovery map no longer overlays the pre-start title
- **P3.5b / P2.15** voice-snapshot lifecycle telemetry (2026-05-18) — re-run the iOS double-kill reproducer (two crashes in the same step ~1 min apart). With R4.2 in place, expect `parcours_restore.resumeStepVoicePos` to match the most recent pre-kill `parcours_store.resumeStepVoicePos`; if it doesn't, P3.5 Plan B or C is the next move
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

### Phase 1B remainder (blocked on Phase 1A field data)

Four of six items shipped early in Round 8.5 (R7.2, B1, A6, C2 — see the Round 8.5 section above). The two remaining items need Phase 1A telemetry from the next field test to calibrate before they can ship safely.

- **B4 watchdog** — JS-side real-callback-gap detector: when `real_callback_age_ms > THRESHOLD` AND motion is non-STILL, surface a "Téléphone en veille — déverrouillez pour continuer" band. Directly addresses P1.34 (iOS 26.3.x blackout) and P1.31 (Android Doze). **Blocked on `real_callback_freshness` field data** — threshold must be set above the normal NSTimer/Handler keepalive cadence floor (expected ~20 s) to avoid false positives during healthy walks. SAFE-TODAY once calibrated.
- **E1/E2/E3 zone-overshoot gates** — accuracy-gated step entry: suppress `step_fire` when `accuracy > THRESHOLD` and the walker is only marginally inside the zone boundary. **Blocked on `accuracy_near_border` distribution data** — too aggressive a gate blocks real triggers, too lax misses overshoot. TEST-FIRST.

### What's needed from the next field test (reminder)

Given limited time and device range, the next test has two distinct jobs:

**Job 1 — read Phase 1A diagnostics (passive, any walk on any device).** Analyse: `real_callback_freshness` (unblocks B4), `accuracy_near_border` (unblocks E1/E2/E3), `audio_play_started.load_duration_ms` (R4.1 root cause), `step_resume_current.consecutive_inside_samples` (false re-arm rate), `media_integrity_check` (C2 baseline).

**Job 2 — validate the 9 behaviour fixes shipped in Round 8 + 8.5.** See the "Awaiting field validation" section below for the per-fix telemetry signals.

**Minimum device set:** 1 iOS device (ideally 26.3.x for D1) for ~20 min + 1 Android device for ~15 min. That's enough to calibrate B4 and E1/E2/E3 for the next drop. R7.2, B1, A6, C2 validate from telemetry on the same sessions — no additional cost.

### Phase 2 (plugin rebuild + Play Store — after Phase 1B)

Requires Cordova rebuild and Play Store upgrade. Coordinate with show schedule (show in ~4 weeks as of 2026-05-26).

- **A1/A2/A3** Walk-session lifecycle: `BGGeo.start()` / `stop()` scoped to the parcours session; proper audiofocus `startKeepalive()` → parcours → `stopKeepalive()` bookkeeping. Depends on G1.
- **G1** Audiofocus plugin: `resetAudioSession()` / `releaseSession()` actions for clean walk-start and walk-end teardown.
- **G2** Power-optimization plugin: promote `~/Bakery/cordova-plugin-power-optimization/` fork (currently only in-tree); add `GetStandbyBucket()` / `IsAutoRevokeWhitelisted()` / `RequestAutoRevokeWhitelist()` Java methods; extend OEM intent table (full C5 backlog).
- **G3** BG-geo plugin: F-G1 (native `locationManager:didChangeAuthorizationStatus:` callback), F-G3 (background-task ID in keepalive tick), F-G4 (NSTimer vs CLLocationManager callback source tag).
- **P1.33** `RawLocationProvider`: add `NETWORK_PROVIDER` request + last-known-network fix delivery on `onStart()` for Android GPS cold-start warmup.

### Phase 3 (deep native + dedicated field session)

- **D3/D4/D5** iOS CLLocationManager reacquire: force `requestLocation()` / `allowsBackgroundLocationUpdates` reassert when `real_callback_age_ms > 120 s`. Requires BG-geo plugin fork work.
- **B2** Android AlarmManager JS wakeup (`setExactAndAllowWhileIdle` + `evaluateJavascript`) — covers the edge case where the WebView is suspended despite the foreground service running (P0.5 Fix 1e).
- **B3** Android FusedLocationProvider conditional — for Doze-affected OEM classes (Motorola, TCL). Full P0.5 Fix 4 scope. Only if B4 watchdog + B2 AlarmManager don't close P1.31.
- **C6b** Android NativeMediaPlayer (conditional) — route Android step voices through `cordova-plugin-media` to close R4.1 cold-load hang, matching the iOS P3.4 fix.
- **P3.5 Plan B** native `getCurrentPosition()` during GPS tasks — only if `voice_snapshot` data shows `_positionSec` staleness on iOS after Phase 1B.

### Next implementation session (cannot republish this session)

- **Launcher-level telemetry beacon** ✅ DONE (2026-05-27) — `navigator.sendBeacon` now fires from the Cordova shell before `app_run()` and on launcher/update failures, posting a small payload to `/launcher-beacon` so pre-webapp launch failures are visible server-side.
- **P0.5 Fix 1e** Android AlarmManager JS wakeup (only if WebView-suspended-despite-FG-service shows up in telemetry)
- **P3.5 Plan C** native plugin save on `applicationDidEnterBackground` / `onPause` (only if Plan B insufficient or iOS shows full localStorage write-loss on kill)

### Conditional / not yet decided

- **P0.5 Fix 3 (DistanceFilterLocationProvider)** or **Fix 4 (FusedLocationProvider)** — only if Android GPS reliability remains a field problem after v2.4.0
- **P1.5** full timer/listener audit — only if leak symptoms surface

### Low priority / accepted

- **P0.2** background validation UX (currently bypassed — keep bypassed)
- **P1.7** resume/version-safe state
- **P1.8** step progression audit — folded into **P1.25** (Round 2, Batch C)
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
- **iOS double-kill reproducer (P3.5b)** — kill the app once during step N (≥30 s in), wait for relaunch and audio resume, then kill again in the same step ~1 min later. Inspect telemetry for `parcours_store` (trigger `pause` vs `interval`), `voice_snapshot` (`pos > 0` during playback), and the `parcours_restore.resumeStepVoicePos` matching the most recent `parcours_store.resumeStepVoicePos`. Compare with the Android equivalent (Xiaomi or Samsung) where the chain is known to work
- Android device known to drop `AUDIOFOCUS_GAIN` after a phone call: trigger a call, hang up, leave phone locked. After 60s the auto-retry should re-acquire focus and resume audio; `audiofocus_auto_retry` telemetry recorded (P1.21)

### LOST state
- Walk deliberately >50m away from the next/active step for >15s (and keep moving — `motionIsStationary` defeats the entry timer): `#lost-band` appears, `LOST_PLAYER` loop plays if bundled, active step pauses, zones/offlimits go silent. Walking back into the zone clears the band and resumes the active step on the next position tick
- Force-kill the app while LOST, relaunch on parcours page: band reappears immediately via `applyLostUI()`; `recover` fires automatically if the walker came back into range while the app was dead
- Verify `user_lost` / `user_recovered` telemetry pairs surface in the report with median recovery delta
- Devmode shortcut: tools page "Forcer LOST" / "Sortir de LOST" exercise the same handlers without needing to walk away
- **P1.30 fresh-but-mid-route start** — clear stored parcours state, walk directly into a non-zero step zone, then drift off-route. The recovery map title under it must read "Suivez la voix..." (or be empty), NOT "Rendez vous au point de départ pour commencer le parcours."

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
