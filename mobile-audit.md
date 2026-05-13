# Mobile Audit Remediation Plan

Date: 2026-04-27  
Last updated: 2026-05-13 (GPS auth workflow hardening + power-optimization bug fixes + deferred fork plan)  
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

Key files:
- `www/app/pages.js` — 25+ page state machine (entry point, ~1000 lines)
- `www/app/assets/geoloc.js` — GPS tracking via BackgroundGeolocation plugin + browser fallback
- `www/app/assets/player.js` — Audio engine: PlayerSimple (single track) + PlayerStep (5-channel step player)
- `www/app/assets/spot.js` — Geofence detection: Zone (ambient/object audio), Offlimit, Step (sequential waypoints)
- `www/app/assets/parcours.js` — Parcours data model, media download, state persistence (localStorage)
- `www/app/assets/map.js` — Leaflet map with offline tile support (currently disabled)
- `www/app/assets/telemetry.js` — Event logging, session tracking, beacon-based flush
- `www/app/assets/common.js` — EventEmitter base class, geo_distance(), HTTP helpers

Libraries: Howler.js 2.2.4 (Android/browser), cordova-plugin-media via NativeMediaPlayer (iOS audio), Leaflet 1.9.4, NoSleep.js, jQuery 3.7.1

Keepalive stack (all active during parcours):
1. `SILENT_PLAYER` — looped silent mp3 via PlayerSimple (NativeMediaPlayer on iOS, Howler on Android/browser)
2. NoSleep.js — Wake Lock API / silent video hack
3. BackgroundGeolocation native keepalive — foreground service + Handler 15s tick (Android) / `UIBackgroundModes: location` + NSTimer 15s tick (iOS, v2.4.0)
4. Local notification chain — disabled (`NOTIF_CHAIN_ENABLED = false`); was delivering zero keepalive contribution on both platforms

Audio channel model per step (PlayerStep class):
- `voice` — narration, rewind 3s on pause
- `music` — background music, rewind 3s on pause
- `ambiant` — loop, continues during afterplay
- `offlimit` — plays when user crosses step boundary
- `afterplay` — loop after voice/music end

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

#### P0.4 Plugin guards [SAFE-TODAY]

Opportunistically add `typeof` guards around plugin calls when touching files for other reasons. No dedicated pass until P0.1 and P0.3 are field-validated.

Files: `www/app/pages.js`, `www/app/assets/player.js`, `www/app/assets/geoloc.js`  
Regression risk: **LOW**.

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

#### P1.11 Audio focus auto-resume ✅ DONE (2026-05-05, updated 2026-05-06)

- Vibration on `AUDIOFOCUS_LOSS` (300ms) and `AUDIOFOCUS_GAIN` (100ms).
- `shouldRequestAudioFocusForPlay()` fixed: re-requests focus only when `AUDIOFOCUS === 0` (explicitly lost), not on every background play.
- iOS: generic app backgrounding no longer treated as audio interruption. Only native `AVAudioSessionInterruptionNotification` events (via audiofocus plugin, see C1) trigger pause/resume.
- Android: re-requests audio focus on app resume.
- `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`: active players reduced to 25% volume, restored on `AUDIOFOCUS_GAIN`.

Files: `www/app/assets/player.js`, `www/app/assets/geoloc.js`

#### P1.12 Android battery optimization guidance ✅ DONE (2026-05-05)

Blocking page `checkbatteryopt` inserted between `checknotifications` and `rdv` on Android. Calls `RequestOptimizations()` directly on first failure (native system dialog). Auto-polls 10× / 15s, then shows manual fallback buttons. OEM-specific restrictions detected and surfaced (non-blocking advisory). DEVMODE bypasses.

Files: `www/app/app.html`, `www/app/pages.js`

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

---

### P2: Supportability and observability

#### P2.9 Public endpoint exposure [SAFE-TODAY]

Low priority. No risk if deferred.

#### P2.10 Telemetry and operational diagnostics ✅ PARTIAL

Implemented: telemetry client, local buffering/flush/retry, session resume, server ingestion, session storage, admin listing. Events: session start/resume/end, GPS stream, GPS state, step fire/done, offlimit, restart markers, audiofocus, audio lifecycle (play gate/request/started/timeout/loaderror/playerror), iOS background task begin/end, step prewarm, warm/cold trigger context.

Still missing:
- Permission-state snapshots at startup
- Native AVAudioSession category/route-change/media-services-reset snapshots
- Media preload success/failure telemetry at the parcours-pack level
- Notification scheduling/permission diagnostics

Files: `www/app/assets/telemetry.js`, `www/app/pages.js`, `www/app/assets/geoloc.js`, `www/app/assets/player.js`, `server.js`

#### P2.11 SAS waiting buffer [SAFE-TODAY]

Intentionally low-security client-side gate — acceptable because the team is present at walk start. Only revisit if the operational process changes.

---

### P3: Platform-specific hardening

#### P3.1 iOS background audio entitlement ✅ VERIFIED DONE (2026-05-05)

`UIBackgroundModes: location + audio + processing` present in `FlanerieCordova/config.xml`. `KeepAVAudioSessionAlwaysActive: YES` prevents `CDVSound.m` from resetting the session category between NativeMediaPlayer tracks.

#### P3.2 iOS location permission progression ✅ DONE (2026-05-06)

iOS 13+ no longer shows "Always" in the initial dialog. `confirmgeo` now detects `AUTHORIZED_FOREGROUND` immediately and shows the "need Always" guidance + Settings button without requiring the user to tap "J'accepte" first.

Files: `www/app/pages.js`

#### P3.3 Android 14+ foreground service type ✅ VERIFIED DONE (2026-05-05)

`FOREGROUND_SERVICE_LOCATION` permission and `android:foregroundServiceType="location"` service declaration already present via the background geolocation plugin's `plugin.xml`.

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

---

### C: Cordova container findings

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

---

## Recommended Execution Sequence

**Ready to field-test now:**
- P3.4 iOS NativeMediaPlayer — diagnostic suite passes ✅, locked-screen parcours walk pending
- P0.1 stationary handler churn removed — field test pending on both platforms
- P1.5c GPS-lost timeout unified at 30s — field test pending
- P0.5 v2.4.0 GPS fork — deployed, field test pending on both platforms
- C2 platform/plugin upgrades — configured, rebuild pending

**Next to implement:**
- P0.3 / P0.5 Fix 1e: Android AlarmManager JS wakeup (deferred)
- P1.5 full timer/listener audit (deferred from P1.5 partial)
- P3.5 Plan B: native `getCurrentPosition()` during GPS tasks (if telemetry shows `_positionSec` staleness)
- P3.5 Plan C: native plugin save on `applicationDidEnterBackground` / `onPause` (if Plan B insufficient)

**When Android GPS stability confirmed:**
- P0.5 Fix 3 (DistanceFilterLocationProvider) or Fix 4 (FusedLocationProvider)

**Background / lower priority:**
- P0.2 background validation UX (currently bypassed)
- P1.7 resume/version-safe state
- P1.8 step progression audit
- P1.15 GIVORS_V3 last-step investigation (requires server-side JSON)
- P2.10 telemetry gaps (AVAudioSession snapshots, preload events)
- C4 build checklist

---

## Validation Matrix

### GPS and lifecycle
- Android 13+ fresh install: grant/deny location and notifications in different orders
- Android device with battery saver enabled
- Android device left stationary for several minutes mid-walk
- iPhone with location set to `While Using` then changed to `Always`
- iPhone left stationary: verify no false "GPS lost" audio cue
- Lock phone during parcours and keep it in pocket for extended time
- Resume after accidental app foreground/background transitions

### Audio
- Audio continues playing after screen lock on both platforms
- Audio resumes correctly after phone call interruption (AudioFocus loss/gain)
- Audio does not auto-resume on iOS when the interruption ends without `ShouldResume`
- Transient notification/navigation prompts duck active audio and restore volume on gain
- Step transition triggers correct audio (voice plays, not afterplay, on first entry)
- Audio from previous step stops cleanly when entering next step zone
- Lock phone during active audio playback, wait 2 minutes, unlock: verify audio still playing
- Background the app for 5 minutes, foreground: verify AudioContext is running (not suspended)
- Walk along a zone boundary for 30 seconds: verify no audio glitching or excessive load/unload
- Verify vibration feedback fires on GPS loss and on audio focus loss (locked screen)

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

---

## Known Dormant Bugs

Issues that exist in code but do not manifest on FLANERIE_ELYSEE. Track before conditions change.

### `allSteps` global array leak on parcours rebuild
- `allSteps` in `spot.js` is never cleared on `Parcours.build()`. Old Step references linger until full page reload.
- Dormant: parcours don't change mid-walk. Fix: clear `allSteps = []` in `Parcours.clear()`.
- Files: `www/app/assets/spot.js`, `www/app/assets/parcours.js`

### Inverted optional/mandatory step logic
- `!(s._spot.optional === false)` in `spot.js` line ~495 returns optional steps but labels them `mandatory`. Dormant because FLANERIE_ELYSEE has `optional: false` everywhere.
- Files: `www/app/assets/spot.js`

---

## Fixed Bugs (archive)

Brief record of closed bugs for reference.

- **Double `done` emission in PlayerStep** — `_doneFired` guard in `startAfterplay()`. (`player.js`)
- **iOS html5 seek/fade limitations** — resolved by NativeMediaPlayer migration; `Media.seekTo()` is reliable. (`player.js`)
- **Dual silent players in parcours page** — redundant `testplayer` silent keepalive removed. (`pages.js`)
- **`delete variable` no-op** — replaced with `testplayer = null`. (`pages.js`)
- **Console.log HTML injection in dev panel** — `_logsAppend()` helper with `$('<span>').text()`. (`common.js`)
- **`PlayerSimple._playRequested` stuck flag** — reset in `loaderror` / `playerror` handlers; 5s safety timeout added. (`player.js`)
- **Zone audio boundary thrashing** — `UNLOAD_EXTRA_HYSTERESIS = 10m` dead-band prevents oscillation at zone edge. (`spot.js`)
- **P1.9a `setCoords()` ignores parameter** — fixed. (`parcours.js`)
- **P1.9b `checkBGPosition()` wrong `this` context** — fixed. (`geoloc.js`)
- **P1.14 Completed-step refire** — `_done` guard in `Step`. (`spot.js`)
- **P1.16 PlayerStep double `done`** — `_doneFired` in `startAfterplay()`. (`player.js`)
- **P1.17 Offlimit reentry restarted step** — detect current+paused and resume instead of re-firing. (`spot.js`, `player.js`, `parcours.js`)
- **Audio loaderror infinite re-fire loop** — `PlayerStep.hasError()` + near-reload guard in `Spot.updatePosition()` blocks reload after loaderror, preventing state reset that triggered 1Hz re-fire. (`player.js`, `spot.js`)
- **GPS drift re-fire during loading** — `_active` flag in `Step`: set on fire, cleared on done/clear; `!_active` added to fire condition. `step_refire_blocked` telemetry added. (`spot.js`)
- **`step_skip_done` spam** — `_skipDoneLogged` flag limits emission to once per step completion. (`spot.js`)
- **`allSteps` global leak on parcours rebuild** — `allSteps = []` added to `Parcours.clear()` as definitive reset after per-step `clear()` calls. (`parcours.js`)

---

## Trivial Code Fixes ✅ DONE (2026-03-14)

Applied without behavioral risk.

- **P1.9a** `setCoords()` ignores its parameter — fixed in `parcours.js`.
- **P1.9b** `checkBGPosition()` wrong `this` context — `this.lastPosition` → `GEO.lastPosition` in `geoloc.js`.
- **P1.9c** `delete testplayer` no-op — replaced with `testplayer = null` (two occurrences in `pages.js`).
- **P1.9d** Dead GPS error handler removed from `startgeo`; `noLockMode` flag removed from pages.js (never read).
