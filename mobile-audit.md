# Mobile Audit & Remediation Plan

**Original:** 2026-04-27
**Last updated:** 2026-06-09 (backpack multi-device test, apk 28 — see 2026-06-09 addendum. **iOS native plan validated end-to-end** on real locked-pocket walks: rail wake 38×, audio-simple under load 0 errors, motion grant. **Android background WebView JS-suspension is a new P0** (likely launch blocker): locked-pocket walks freeze the JS event loop 40+ min while native GPS stays alive — ExoPlayer-migration regression, fix plan attached.)
**Scope:** Cordova launcher (FlanerieCordova) + downloaded local webapp (FlanerieAudioMap) + four forked native plugins
**Field tests so far:** ELYSEE (multiple), FRAPPAZ, GUILLOTIÈRE (2024-12), GIVORS (2026-05-20, archived), FRAPPAZ+ST-BONNET (2026-06-05), iOS-GIVORS-V7 (2026-06-06), backpack multi-device (2026-06-09). Next: VILLEURBANNE.

## Field Safety Legend

- **[SAFE-TODAY]** — Low regression risk; can ship before a show with minimal testing.
- **[TEST-FIRST]** — Behavioural change requiring real-device validation before production use.
- **[RESEARCH-FIRST]** — Needs prototyping or dedicated field session.

## Operational Context

The app is a guided solo audio walk, not a generic tourist guide:
- Visitor is welcomed by staff at a starting point on a fixed schedule.
- Visitors are sent alone, every ~5 minutes.
- Walk is mostly sequential and contextual.
- Media is fully preloaded before the walk starts.
- Once started, the experience must work without mobile data.
- Phone is expected to stay locked in the pocket for long periods.

This context elevates **background GPS continuity** and **audio continuity** above most UI concerns. Startup checks should be light and robust, not clever.

## Architecture Summary

Key files:
- `www/app/pages.js` — page state machine + entry points (~3000+ lines, 25+ pages)
- `www/app/assets/geoloc.js` — GPS via BackgroundGeolocation plugin + browser fallback
- `www/app/assets/player.js` — Audio engine: `PlayerSimple` wraps Howler (Android/browser) or `NativeMediaPlayer` (iOS); `PlayerStep` composes voice + afterplay channels
- `www/app/assets/spot.js` — Geofence classes: `Zone`, `Offlimit`, `Step`
- `www/app/assets/parcours.js` — Parcours model, media download, localStorage persistence, step progression
- `www/app/assets/diagnostic.js` — DEV-mode T0–T11 test suite
- `www/app/assets/map.js` — Leaflet map with offline tile support (currently disabled)
- `www/app/assets/telemetry.js` — Event logging, session tracking, beacon flush
- `www/app/assets/common.js` — EventEmitter, geo_distance(), HTTP helpers

Libraries: Howler.js 2.2.4, cordova-plugin-media (via `NativeMediaPlayer` on iOS), Leaflet 1.9.4, NoSleep.js, jQuery 3.7.1.

**Keepalive stack** (all active during a parcours):
1. `SILENT_PLAYER` — looped silent mp3 (NativeMediaPlayer iOS, Howler Android).
2. NoSleep.js — Wake Lock API / silent video hack.
3. BackgroundGeolocation native keepalive — Android FG service + 15 s Handler; iOS `UIBackgroundModes: location` + 15 s NSTimer.
4. `cordova-plugin-audiofocus` FG service — `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` (Android API 29+).
5. Local notification chain — disabled (`NOTIF_CHAIN_ENABLED = false`).

**Audio model:**
- **Step → PlayerStep** = voice (non-loop, rewind 3 s on pause) + afterplay (loop, native iOS infinite). Voice `loaderror`/`playerror` short-circuits to `startAfterplay()` (P1.19).
- **Zone → PlayerSimple** (looped) — ambient/object; `Ambiance` mode crossfade 4000 ms.
- **Offlimit → PlayerSimple** (looped, 1000 ms fade) — kept loaded once.
- **Global persistent players:** `SILENT_PLAYER`, `GPSLOST_PLAYER`, `DEFAULT_AFTERPLAY_PLAYER`, `RESUME_PLAYER`, `LOST_PLAYER`, `testplayer`. All load from `www/app/images/{afterplay,resume,youlost,gpslost}.mp3`. Bundled placeholders ship as `_afterplay.mp3` etc. — operator renames to enable.

**Page flow:**
```
title → intro → checkdata → select → preload → confirmload → load
→ checkgeo → confirmgeo → startgeo
→ [checkmotion (iOS) | checkbgloc (Android)]
→ checknotifications (Android) → checkbatteryopt (Android)
→ rdv → checkaudio → checkbattery → sas
→ parcours → end
```

Each onboarding gate hard-blocks until its check passes.

---

## Status Overview (2026-05-27 verification audit)

**Plugin versions in current build:**
| Plugin | Version | Lockfile (FlanerieCordova) |
|---|---|---|
| `cordova-plugin-audiofocus` | 1.9.0 | ✅ pinned (Round 25 shrink: R21+R22 iOS surface migrated to audio-simple; MediaPlayer.framework dep dropped) |
| `cordova-plugin-power-optimization` | 0.3.1 | ✅ pinned @ `3e89474` |
| `cordova-background-geolocation-plugin` | 2.14.1 | ✅ pinned @ `454a57b` (main-thread `CLLocationManager` singleton fix + deadlock-hardened construction, iOS stream-health snapshot, motion-prompt deferral, Android notification-prompt removal, `start`/`stop` return the real outcome) |
| `cordova-plugin-audio-simple` | 0.3.3 | ✅ pinned (0.3.3: versionFiles mechanism ensures ping() strings auto-sync on every release) |

**Workstream coverage (post-GIVORS):**
| Workstream | Status |
|---|---|
| A — Walk-session lifecycle hygiene (A1–A8b) | All shipped. A1 keeps state in localStorage by design (only the title-page 5-tap-bottom clears it — used to rearm loan phones). A2 awaits engine reset before first play. A3 (rearm) awaits `releaseSession` before `resetAudioSession` to prevent the iOS deactivate/activate race |
| B — Android resilience (B1, B2, B3, B4) | B1 shipped. B2 closed by BG-5 native AlarmManager. B3 closed by **Architecture D in bg-geo v2.9.0** — Raw-primary parallel with Fused fallback, dedupe in native plugin (no OEM allowlist, fail-soft on no-GMS, JS sees a single source-tagged stream). B4 now includes shipped stalled-signal handling in the webapp: onboarding blocks until two fresh fixes pass the startup gate, and runtime signal state surfaces `acquiring` / `frozen` / `lost` instead of treating keepalive freshness as healthy. P0.5 Fix 1e (Android JS-suspended-despite-alarm diagnostic) shipped in v2.8.0 — telemetry-only via `alarm_wake_stats`; final thresholds still need field tuning. |
| C — Audio reliability (C1–C5) | C1, C2, C4, R7.2 shipped. C3 covered by C2. C4 runs on both platforms intentionally (Android playerrors can also be caused by audiofocus loss). C5 — `IsAutoRevokeWhitelisted` shipped in power-opt v0.3.1. C6 deferred |
| D — iOS GPS native (D1–D6) | D1 warning shipped. D3 (`forceReacquire`), D4 (flag re-assertion), D5 (SLC auto-reacquire) all closed by plugin work. D6 is now backed by the June 1 round: main-thread `CLLocationManager` singleton creation (`v2.12.2`), native `ios_stream_health` counters (`v2.13.0`, released in `v2.14.0`), and webapp freshness/state handling that no longer lets keepalive callbacks mask a dead real stream. D7 = focused iOS field validation still TBD |
| E — Step lifecycle correctness (E1/E2/E3) | Not shipped — blocks on `accuracy_near_border` field data |
| F — Telemetry & diagnostics (F-K1..F-N3) | All Phase 1A JS items shipped. The June 1 round added `gps_state`, `gps_startup_fix` / `gps_startup_ready` / `gps_startup_rejected`, `ios_stream_health`, freshness buckets in `gps_quality_summary`, and offline analyzer support for keepalive-only sessions, masked freshness, and signal-state reasons. F-A4 silence detection dropped (covered by `voice_snapshot` heuristics) |
| G — Plugin extensions (G1–G4) | G1 (audiofocus v1.7.1 — incl. Round 21 `ExtraFocusListener`), G2 (power-opt v0.3.1), G3 (bg-geo v2.14.0 — Architecture D + rail/visit telemetry + main-thread singleton fix + iOS stream-health bridge), **G4 (cordova-plugin-exoplayer-simple v0.1.1 — NEW Android Media3 backend, Round 21)** all shipped |
| H — Android audio backend (H1) | H1 (audio-simple plugin + `AUDIO_BACKEND_ANDROID` flag + `_backend` telemetry field) shipped — **default is now `'exoplayer'`** (canary bucket retired in Round 24 plugin rename; set `window.AUDIO_BACKEND_ANDROID = 'howler'` pre-load to opt back). **Howler retirement POSTPONED** — the second-device field test (2026-06-06 `y9ns`, SM-A528B) FAILED with 38 ExoPlayer `MediaCodecAudioRenderer` decode errors; Howler stays the default fallback until the codec-exhaustion fix re-validates clean across devices. Still the eventual goal. |
| iOS native plan (H/I/J/K/L) | See §[iOS native plan (R22–R26) — settled design decisions](#ios-native-plan-r22r26--settled-design-decisions) below. All five workstreams shipped between R22 and R26. **L (CLMonitor iOS 17+)** scope reduced to visit events only via legacy `startMonitoringVisits` (CLMonitor proper deferred indefinitely). |

**Open items requiring next field test data:**
- **🔴 P0 — Android background WebView JS-suspension (NEW, 2026-06-09).** Locked-pocket Android walks freeze the WebView JS event loop for 40+ min (zone-triggering + audio selection stall) while the native bg-geo stream stays fully alive — confirmed across Samsung/Sony/Xiaomi/Fairphone, Android 8→15, battery-opt exempt. Root cause: the ExoPlayer/audio-simple migration moved the silent keepalive native, so no in-renderer AudioContext keeps the Chromium renderer scheduled. **Likely Android launch blocker.** See 2026-06-09 addendum for the confirmed mechanism + 4-step fix plan (promote P0.5 Fix 1e to a real fix).
- **B4 / R27 startup + stalled-signal calibration** — Android startup gate confirmed comfortable on a GOOD-GPS device (8giw: `fixes=2 ready=1 rejected=3`, no stuck startup). **But `nlrc` (Fairphone 4, avgAcc ~21 m) never cleared the gate in 74 min** — `gps_startup_rejected reason=accuracy`/`stale` ×dozens; the `STARTUP_FIX_MAX_ACCURACY_M=15` + 2-distinct-fix gate strands poor-GPS / stationary onboarding at `rdv` (see 2026-06-06 addendum, correction 2). Calibration must soften the accuracy gate and/or add a time-boxed best-effort fallback. iOS still needs data.
- **E1/E2/E3 zone-overshoot gates** — 300 `accuracy_near_border` events collected from 8giw (SM-A515F, avgAcc=7m): p75=−3m inside, p95=+3.2m outside. Single high-accuracy device only; need a session with avgAcc 20–30m before setting production thresholds.
- **H1 ExoPlayer backend validation** — ⚠️ **SECOND DEVICE FAILED** (2026-06-06, `y9ns` SM-A528B / Galaxy A52s 5G / GIVORS_V7_CBR): **38 `step_voice` playerrors** = `MediaCodecAudioRenderer` hardware-decoder exhaustion under instance churn (`format_supported=YES`, transient). The 8giw "0 errors" result was one device + one parcours only. **Howler retirement POSTPONED** until the exhaustion class is fixed and re-validated on this device. See 2026-06-06 addendum.
- **R21 / R22 iOS validation** — ✅ **WALK-LEVEL VALIDATED (2026-06-09, `0x7o`/`4a7m`, apk 28):** audio-simple 0 errors across 42+54 min of BLOC narration under load. (Was configure-level only on `imug` apk 27.)
- **R27 iOS foreground/background-stream validation** — ✅ **VALIDATED (2026-06-09):** `ios_stream_health`+`cl_state` 82–105×; real-fix freshness up to 311 s correctly flagged `frozen→recovered` (12×/5×), keepalive masking no longer reads as healthy. Background-blackout behaviour now exercised on a real locked-pocket walk.
- **R23 iOS rail validation** — ✅ **RAIL WAKE VALIDATED (2026-06-09):** `gps_rail_wake=38` on both iPhones during real blackouts (was `=0, no blackout to trigger it`). The region-wake rail fires and recovers the live stream in the field.
- **R26 iOS visit validation** — ✅ **validated** (`imug` 2026-06-06; reconfirmed 2026-06-09: `gps_visit_event` 3–6× per walk).
- **Architecture D (Fused fallback) availability** — ✅ **`fusedAvailable=true` on 4 real Android devices (2026-06-09)** with native dedupe suppressing fused as designed. (Was `false` only on the dev SM-A515F GMS-broken ROM.) End-to-end *fallback during a gap* is moot for now — the 2026-06-09 Android failure is upstream in the JS layer, not in native location delivery.

**Recommended next moves (post-2026-06-07 audit):**
- **Next build is apk 28 (A):** `audio-simple` 0.3.4 with SW-preferred decoders is in the fork and installed in FlanerieCordova but has not been built. One `cordova build android` + TestFlight bump. The launcher HTML/JS changes (C, below) ride in the same container build. ExoPlayer Howler-retirement path opens once SM-A528B re-tests clean.
- **Do not open new native scope before VILLEURBANNE.** The June 1 iOS GPS scope is now implemented; remaining blockers are build validation and threshold calibration, not missing code.
- **Run one focused VILLEURBANNE validation pass with the minimum device set:** 1 iOS device (ideally 26.3.x or 26.4.x) and 1 loan-phone Android SM-A515F. Success criteria: startup-gate behaviour, B4/R27 `gps_state` histograms, E1/E2/E3 border-accuracy histograms, H1 ExoPlayer metrics, and `ios_stream_health` + `cl_state` present in one session set.
- **Immediately after that data lands, ship one small threshold round:** calibrate B4/R27 `gps_state` cutovers (`acquiring` / `frozen` / `lost`) and E1/E2/E3 accuracy + sustain gates. Avoid unrelated refactors in the same round.
- **Howler retirement is POSTPONED, not cancelled** (was: "if H1 is clean, retire Howler"). The second-device test (`y9ns`) failed: ExoPlayer must first stop exhausting the MediaCodec pool (prefer SW MP3 decode / `setEnableDecoderFallback` / release idle codecs + cut load churn — see P0.1) and then pass a clean multi-device field test. Keep `AUDIO_BACKEND_ANDROID='howler'` reachable and Howler as the **default fallback** until then. The eventual goal remains removing the Howler branch / `Howler.autoUnlock` / `Howler.autoSuspend`.
- **Only reopen Phase 3 items if telemetry still shows a real gap.** P3.5 Plan B/C and any visit-driven step-confirm work stay conditional on VILLEURBANNE evidence, not pre-emptive scope growth.

---

## Verification audit (2026-05-27, post-fix pass)

Cross-check of every "✅ shipped" claim against actual source. Items below are accurate to current code.

| Item | Status | Notes |
|---|---|---|
| **A1** (`PAGES['end']` shutdown) | ✅ — by design | Stops audio, releases audiofocus, emits `walk_end_shutdown`, drains `PAUSED_PLAYERS` + `DUCKED_PLAYERS`, reloads `SILENT_PLAYER`. **Does not** clear in-memory `PARCOURS.state` — that's reserved for the title-page 5-tap-bottom (the loan-phone rearm path). |
| **A2** session-start engine reset | ✅ | Event name now `audio_engine_reset` (was `audiofocus_session_reset`). Awaits native reset, mirrors `AUDIOFOCUS = 1` to prevent the iOS "fail once stay poisoned" path. |
| **A3** rearm = end + start | ✅ | `releaseSession()` is now promisified (`releaseAudiofocusSession()`) and **awaited** before `resetAudioSessionForFreshParcoursStart()`, eliminating the iOS deactivate-after-activate race. |
| **A7** end-of-walk text + reload | ✅ — by design | Generic typewriter copy. Standard 5-tap reload on end page returns to title; from title the 5-tap-bottom does full rearm. By design — used for loan phones. |
| **C4** playerror retry | ✅ | Intentionally cross-platform. Android playerrors can also be caused by audiofocus loss (some OEMs revoke aggressively); single retry-with-reset is low cost. Falls through to `startAfterplay()` on second error. |
| **BG-3** `getCLState` schema | ✅ — v2.8.0 | Returns `hasLocation` + `locationTimestampAgeMs` alongside the raw `locationTimestampAge` (seconds). Analyzers can use the ms field directly. |
| **F-A1** event name | doc-only | `load_duration_ms` field on `audio_play_started`. Analyzer extracts it from there. |
| **F-Z2** carrier event | doc-only | Fields ride on `step_audio_trigger`, not `step_fire`. |
| **F-A4** silence detection | ❌ dropped | `voice_snapshot audio_playing=false, pos=0` heuristic at parcours.js:152-157 covers the case. |
| **bg-geo internal `package-lock.json`** | ✅ — v2.8.0 | Regenerated to 2.8.0 (was stale at 2.3.3, cosmetic only). |

**Genuinely shipped and correct** (verified line-by-line, through Round 21):
A4, A5, A6, A8, A8b, B1, B4 (diagnostic + iOS `forceReacquire`), C1, C2, D1, R7.2, F-G1, F-G1b, F-G2, F-G3, F-G4, F-K3, F-N3, F-R1, F-R2, F-Z1, F-Z3, all plugin rounds (audiofocus v1.7.1 AF-1..AF-8, power-opt v0.3.1 PO-1..PO-9, bg-geo v2.5.0..v2.9.0 BG-2..BG-10 + P0.5 Fix 1e diagnostic + Architecture D), and **Round 21 G4/H1: ExoPlayer plugin v0.1.1 + AUDIO_BACKEND_ANDROID flag + apputils.js native paths + releaseExoPlayerAll teardown wiring** (verified in source; Gradle build + on-device smoke test still pending).

## 2026-06-01 addendum — iOS GPS hardening

- The webapp now blocks RDV/startup on `GEO.startupReady()`: two distinct fresh fixes, max 10 m accuracy, max 12 s age. Warmup copy explains whether the app is waiting on precision, freshness, or the second confirming fix.
- Signal liveness now follows actual usable-fix freshness instead of any callback freshness. The app emits `gps_state` and distinguishes `off`, `acquiring`, `ok`, `frozen`, and `lost`, so keepalive-only traffic no longer looks healthy.
- iOS foreground observability now includes `ios_stream_health` beside `cl_state`. The native snapshot exposes counts and ages for real fixes, keepalive replays, SLC, rail wakes, visits, force-reacquires, and shared `CLLocationManager` creation metadata.
- Offline analyzers now surface keepalive-only sessions, masked freshness, signal-state reasons, startup-gate counters, and iOS native snapshot counts, making the June 1 regression class directly visible in post-hoc telemetry.

---

## 2026-06-01 addendum (2) — onboarding-flow hardening, bg-geo v2.14.1, iOS rail dead-code fix

This round is mostly **webapp (FlanerieAudioMap, dynamically loaded — live without a container rebuild)** plus a native bg-geo point release. Driven by hands-on iOS onboarding testing, not a field day.

- **bg-geo v2.14.1** (`454a57b`, branch `stable`). Hardened the v2.13.0 main-thread singleton fix: `MAURLocationManager` construction is done **in-place** under `dispatch_once` and **warmed from `pluginInitialize`** (main thread), removing the `dispatch_once` + `dispatch_sync(main)` deadlock shape (a main-thread caller could block on the once-token while a worker held it inside the sync-to-main). `start:`/`stop:` now return the **actual start/stop outcome** instead of a redundant follow-up `configure:` result — a real start failure was being masked behind a config success. BG-13 `shared_manager_created_on_main_thread` telemetry flags any regression.

- **iOS "Toujours" enforcement (webapp).** The in-app `requestAlwaysAuthorization` dialog can only grant *provisional* Always (reported as `AUTHORIZED`, silently downgraded later by iOS's deferred prompt); durable Always requires a Settings round-trip, which is the **only reliable provisional-vs-real discriminator** (no iOS API distinguishes them). Enforcement now sits at the real choke point — **`startgeo`'s `.then`** plus the confirmgeo poll-gate — and blocks the walk until a Settings round-trip is observed (`confirmgeoSettingsReturned`), bouncing to confirmgeo's "réglez sur Toujours" guidance otherwise. The earlier gate lived only in `confirmgeo.then`, which the accept→startgeo path bypassed (provisional-Always resolved `startGeoloc` straight through to checkmotion). Cross-launch persistence was removed (it masked the gate); per-onboarding flags reset in `checkgeo`; a `visibilitychange` hide/show guard stops the round-trip flag from being set when the app *leaves* for Settings. After the round-trip, `GEO.forceReacquire()` restarts `CLLocationManager` so the live fix stream resumes — iOS does not auto-resume `startUpdatingLocation` after an auth change while backgrounded, which had been stranding RDV at "En attente du GPS". New telemetry: `ios_always_gate` (fires pre-`TELEMETRY.start`, see observability note below).

- **iOS Motion & Fitness prompt deferral (native + webapp).** `MAURRawLocationProvider.onStart` no longer starts `CMMotionActivityManager` (which fired the Motion prompt on top of the Location prompt at first install — the user could miss one). New `startMotionUpdates` bridge is called from the `checkmotion` page, so the Motion prompt appears alone, after Location is granted.

- **Android notification double-prompt removed (native).** `BackgroundGeolocationFacade.start()` no longer requests `POST_NOTIFICATIONS` itself — that brief prompt collided with the app's own `checknotifications` step, now the single authority. The `checknotifications` and `checkbatteryopt` pages also re-check on `resume`/`visibilitychange` (and `checknotifications` dropped its `APP_VISIBILITY=='foreground'` gate) so they auto-advance after a Settings round-trip instead of stranding on the manual "J'ai autorisé / J'ai désactivé" button.

- **iOS region wake-up rail was dead code — fixed (webapp).** The BG-11 rail configure (`PAGES['parcours']`) and clear (`PAGES_CLEANUP['parcours']`) hooks gated on `typeof bgGeo !== 'undefined'`, but `bgGeo` was never defined in those scopes (the only `let bgGeo` declarations are function-local elsewhere). `typeof` on an undeclared identifier is `'undefined'`, so the guard was **always false** and the rail never configured — confirmed by **zero `gps_rail_*` events across all 15 sessions on 2026-06-01** and `rail_region_count: 0` in `ios_stream_health`. Fixed by resolving the handle via `getBackgroundGeolocationPlugin()` in both scopes. The native `configureRail`/`clearRail` (v2.10.0) were correct all along; the JS simply never called them. **Still unverified end-to-end** — needs a field walk emitting `gps_rail_configured` (4-step Test Dumas → 3 regions; 17-step real parcours → 16) then `gps_rail_wake` during a real blackout.

- **FlanerieCordova container.** iOS splash images regenerated — icon centered + square at 62 % on `#6F3CFF`, all 8 canvas sizes (they had been stretched to fill non-square canvases); global `SplashScreenBackgroundColor` and the storyboard named color set to the purple. App build → 18. (Container changes need a rebuild + TestFlight upload; the bg-geo v2.14.1 native changes ride along.)

- **Onboarding UX (webapp).** confirmgeo first screen simplified (why + which permissions per platform — Localisation + Mouvement on iOS, Localisation + Notifications + Batterie on Android — with the durable-Always detail moved to its dedicated page). SAS code input is `inputmode="numeric"` / `pattern="[0-9]*"` for a numeric keypad on iOS. The "Je suis perdu·e" button is hidden during the pre-start phase (heading to the départ, where the map is already shown) and appears once the first step fires and the map collapses.

- **Build-18 field validation (session `jtcv`, iPhone SE 3 / iOS 26.4.2).** Thread fix confirmed live: `shared_manager_created_on_main_thread: true` (`creation_thread: "main"`). GPS healthy — `real_location_count: 184`, `keepalive_count: 0`, `force_reacquire_count: 0`, 0 gaps ≥ 90 s, avg 8.4 m, freshness 1 s; auth = `AuthorizedAlways`; steps 0–3 contiguous; 0 audio errors; resumes 0. A short on-screen staff test, **not** a long pocketed background walk — does not yet stress background GPS or the (now-fixed) rail.

- **Observability gap — CLOSED (see addendum (3)).** `TELEMETRY.start()` opens on the **parcours page**, so the entire onboarding flow (Toujours enforcement, motion/permission prompts, prewarm, `ios_always_gate`, `gps_rail_configured`) used to emit *before* the session file existed and was **not captured**. Now covered by a dedicated onboarding session opened at `checkgeo` and flushed live.

---

## 2026-06-01 addendum (3) — onboarding telemetry (closes the observability gap)

Pure **webapp** + **analysis-tooling** change (no native, no container rebuild). Motivated by two failed blind attempts at the iOS Motion-auth hang (bug 2): onboarding events fired before any session existed and were dropped, so the prompt saga was never on the wire.

- **Universal pre-session buffer (`telemetry.js`).** `_log()` with no live session now stashes into a capped (`PRE_BUFFER_CAP = 120`) `preSessionBuffer` instead of dropping; `start()` drains it (timestamps preserved, ahead of `session_start`) into the live buffer. Catches the earliest events (e.g. `media_startup_check` at `checkdata`) regardless of which session opens next.
- **First-class onboarding session (`telemetry.js`).** `TELEMETRY.startOnboarding(pID, name)` opens a session namespaced **`onb:<pID>`** at the top of `checkgeo` (the permission gauntlet entry); `endOnboarding()` closes it (final flush) right before the walk `TELEMETRY.start()`. Because it flushes **live** (30 s timer + `visibilitychange`-hidden), the geo/motion/notification/battery flow is captured **even when the walk never opens** — which is exactly the Motion hang (blocked before the walk page). Kept separate from the walk session so the walk stays a clean `session_start` with the `resume_step_index` extras `analyze.mjs` keys on (`common.mjs:139`). Guard: `startOnboarding` refuses to clobber a **resumable walk session** for the same pID (mid-walk crash resume within `RESUME_MAX_AGE`), so crash-resume telemetry is untouched. `endOnboarding` passes `skipIdleStamp` so the onboarding→walk gap doesn't pollute `inter_session_idle_ms`.
- **New onboarding events (`pages.js`).** `onboarding_page` (checkgeo/confirmgeo/checkmotion — carries platform, apk_version, webapp_hash, os_version, retry_auth); `confirmgeo_settings_tapped` / `confirmgeo_settings_returned` (the iOS "Toujours" Settings round-trip); `motion_prompt` (per re-issue — attempt #, elapsed, `visible`). Existing `motion_check`, `ios_always_gate`, `bg_location`, `notif_permission`, `battery_opt`, `media_startup_check` now land in the onboarding session instead of the void.
- **Analysis tooling.** `session.mjs` prints an **`## Onboarding flow`** timeline; `analyze.mjs` buckets `onb:` sessions into **`## Onboarding sessions`** (Motion grant + prompt-attempt count per session) and **excludes them from completion stats** so they don't read as aborted walks. Verified against a synthetic iOS-26.3.1 fixture (motion never granted, 3 prompt attempts all `visible=true`) and smoke-tested against the live 210-session corpus (no regression; 0 `onb:` sessions pre-deploy).
- **Status: unverified on device** — needs the deployed webapp + one iOS onboarding pass to produce the first `onb:` session. The motion saga (`confirmgeo_settings_returned` → N× `motion_prompt` → `motion_check granted=?`) is the signal that will finally show whether the v2.14.3 native re-prompt fix lands.

---

## 2026-06-01 addendum (4) — Motion hang diagnosed from telemetry; bg-geo v2.14.5

The onboarding telemetry paid off immediately. **Session `l5bi`** (iPhone 14-class, **iOS 26.4.2, apk 21 / bg-geo v2.14.4**) captured the Motion-auth hang in full for the first time:

- `confirmgeo_settings_returned` (Always round-trip OK) → `checkmotion` → **41 `motion_prompt` attempts** over ~76 s, spaced ~2 s, **every one `visible=true`**, and `motion_check granted=false` throughout. **Zero native activity callbacks.** Only a full app relaunch (the `session_resume` mid-file) let the user retry. → **The JS retry layer is provably correct; the bug is entirely native/iOS.** apk 21 already carried the v2.14.3 re-prompt fix *and* the v2.14.4 app-active gate, and still hung.

- **Root cause (best-supported):** the prompt-capable call was re-issued 41× **on the same reused `CMMotionActivityManager` instance**. A reused instance whose first prompt request lands during the post-Settings settling window stops re-presenting the M&F prompt; only a fresh instance (i.e. a relaunch) recovers — which matches "a couple restarts fixes it" exactly. Could not be distinguished from an implicit `Denied` because **nothing surfaced the native `authorizationStatus`**.

- **bg-geo v2.14.5** (`0886512`, branch `stable`) — two native changes in [`MAURRawLocationProvider.m`](../cordova-background-geolocation-plugin/ios/common/BackgroundGeolocation/MAURRawLocationProvider.m) + [`CDVBackgroundGeolocation.m`](../cordova-background-geolocation-plugin/ios/CDVBackgroundGeolocation/CDVBackgroundGeolocation.m):
  1. **Fix** — while authorization is `NotDetermined`, **recreate the `CMMotionActivityManager` on every retry** (throttled to once / ~4 s so a freshly presented prompt isn't torn down before the user taps), the in-process equivalent of the relaunch that works; and issue **`queryActivityStartingFromDate` unconditionally** (not only when already Authorized) — the historically more reliable M&F prompt trigger, whose handler error also surfaces a real denial.
  2. **Diagnostic** — the `startMotionUpdates` bridge now returns `{authStatus (0 NotDet / 1 Restr / 2 Denied / 3 Auth), appState (0 active / 1 inactive / 2 bg), activityAvailable, pendingUntilActive}`; `GEO.startMotionUpdates()` resolves it and `checkmotion` logs it on every `motion_prompt`. `session.mjs` renders `auth=…` / `app=…` inline. Next failure (if any) will say *exactly* whether status is stuck NotDetermined or flipped to Denied.

- **Ships in the next TestFlight build** (bump `config.xml` from 21). Pair with a webapp redeploy (the enriched `motion_prompt` logging + `geoloc.js` change are webapp). **Unverified on device.**

- **First v2.14.5 run — `ojl2` (apk 22, iOS 26.4.1, SIMULATOR).** Same hang, but the diagnostic explained it: `motion_prompt` carried **`activity_available=false`, `auth=NotDet`, `app=active`** on all 36 attempts, and client `isVirtualDevice=true`. **The iOS Simulator has no motion coprocessor — `CMMotionActivityManager isActivityAvailable` returns NO, so the M&F prompt can never be presented and the native code returns at its first line.** This is expected simulator behaviour and **not a valid test of the v2.14.5 fix** (which targets reused-instance poisoning on a *real* device, where `isActivityAvailable` is true). **v2.14.5 must be validated on a physical iPhone.**
  - **Robustness fix shipped (webapp).** `checkmotion` now short-circuits to `rdv` when the native call reports `activity_available === false` (logs `motion_check {granted:false, reason:'unavailable'}`), so the simulator — and any real device lacking a motion coprocessor — no longer hangs forever on a sensor that doesn't exist. `session.mjs` flags `activity_available=false` inline as "MOTION HW UNAVAILABLE".

- **`j1jm` (apk 23 / v2.14.5, REAL iPhone SE 3, iOS 26.4.2) — v2.14.5 native fix DISPROVEN.** `isVirtual=false`, `activity_available=true`, `NSMotionUsageDescription` present, `app_state` active, recreate-every-4s + unconditional `queryActivity` running — and `auth_status` stayed **NotDetermined across all 34 retries**, prompt never appeared. Rules out hardware, entitlement, app-state, and the instance-poisoning theory. **Conclusion: iOS structurally refuses to present the Motion & Fitness prompt in the window right after the Location "Toujours" Settings round-trip.** Every time the prompt *has* fired, it was a clean foreground context (original onStart stack; "fires after a couple restarts" = restart skips the round-trip because Always is already set).

## 2026-06-02 addendum (5) — Motion prompt reordered before the Settings round-trip (webapp-only)

Decision after three failed native attempts (v2.14.3/4/5): stop fighting Core Motion's post-round-trip suppression and **request the Motion prompt in the one context that works** — the clean foreground window right after Location "Pendant l'utilisation" is granted, BEFORE the user is sent to Settings for "Toujours". User chose to **keep the hard gate** (motion still required; `checkmotion` unchanged as the gate, now reached already-granted on the happy path).

- **Where (`pages.js`, `startgeo.then`).** At the iOS Always-gate bounce (`PLATFORM=='ios' && !confirmgeoSettingsReturned`) — the exact moment Location was just granted and we're about to route to the confirmgeo "Toujours" guidance — fire `GEO.startMotionUpdates()` once if `!GEO.motionAuthorized` (logs `motion_prompt_early {trigger:'startgeo_preroundtrip'}`). The Motion system modal sits over the Always-guidance page, so the user grants Motion first (clean context → prompt appears), then does the Settings round-trip. By the time `checkmotion` runs post-round-trip, `GEO.motionAuthorized` is already true → it skips immediately.
- **No native change, no TestFlight.** Pure orchestration over the existing `startMotionUpdates` bridge — deploy the webapp and test. v2.14.5's native diagnostics stay in place to confirm the result.
- **Telemetry.** `motion_prompt_early` + `motion_authorized` now render in the `session.mjs` onboarding timeline. Success signature: `motion_prompt_early` → `motion_authorized` BEFORE `confirmgeo_settings_returned`, then `checkmotion` → `motion_check granted=true waited≈0`.
- **Unverified on device.**

## 2026-06-02 addendum (6) — build provenance (running webapp commit), to kill "am I on the right bundle?" doubt

The webapp is **zipped server-side and cached on the phone** (launcher: `/update/info` → download `/update/appdata` → unzip to `appdata/`, `APPHASH` = the zip's sha256). So a phone can silently run a **stale cached bundle** even after push + pull + restart — exactly the doubt raised when the reordered motion fix "didn't take". Provenance is now visible end-to-end:

- **Embedded in the bundle (`modules/updater.js`).** `bundleAppData()` stamps `git rev-parse --short HEAD` into `APPINFO.commit` and appends a generated **`build.js`** (`window.BUILD_COMMIT`, `window.BUILD_TIME`) **into the zip** — so the cached copy reports the commit *actually running on the device*, not the server's current HEAD (a live fetch would hide staleness). No on-disk `build.js`, so no duplicate archive entry.
- **Server endpoint `/version`** → `{commit, builtAt, appzipHash}` = the commit the latest zip was built from (what a freshly-updated phone should get). `commit` is also added to `/update/info`.
- **In-app band (`app.html`).** A discreet fixed bottom strip shows `build <commit> · apk <n>` (`window.BUILD_COMMIT` + `document.APPVERSION`), `pointer-events:none`. Falls back to `build dev` when served live (no zip).
- **Telemetry.** `webapp_commit` added to `session_diag` and the `checkgeo` `onboarding_page` event; `analyze.mjs` build grouping and `session.mjs` header/onboarding lines now print `commit=…`. Every session is now matchable to a push.
- **Diagnosing the stale-bundle doubt:** compare the **in-app band** (phone's running commit) to **`curl …/version`** (server's bundled commit) to your **`git push`**. Band ≠ /version → phone kept a stale cache (launcher didn't re-download); /version behind your push → server didn't rebuild the zip (restart/pull issue).
- **Requires a SERVER RESTART, not just the webhook pull** — the GitHub hook runs `git pull && npm i` but does not restart node, so the new `updater.js` only takes effect on restart. (The webapp changes ride in the same FlanerieAudioMap push.)

**Extended (same day) — version provenance everywhere + live staleness alarm:**

- **Commit + apk on every session's client meta (`telemetry.js`).** `_buildSessionMeta()` now sets `webappCommit` (`window.BUILD_COMMIT`), `webappBuiltAt`, and `appVersion` (`document.APPVERSION` — the old code read `window.APP_VERSION`, which was never set). So even onboarding-only sessions (no `session_diag`) are matchable to an exact apk + webapp push.
- **Native plugin versions in telemetry (container build hook).** `hooks/after_prepare_plugin_versions.js` reads each `plugins/<name>/package.json` and writes `document.PLUGIN_VERSIONS = {…}` into the platform www (loaded by the launcher `index.html`, persists into the webapp document). Logged once per session in `session_diag` + the `checkgeo` `onboarding_page` event as `plugin_versions`. Confirms e.g. **bg-geo 2.14.5** is the build this apk actually carries — the exact ambiguity that made "apk 21 has v2.14.2" hard to trust. `session.mjs` prints a `plugins  bg-geo=… (N total: …)` line; `analyze.mjs` build grouping keys on `bg-geo=…`. **Needs a container rebuild** to populate (until then `plugin_versions` is null, graceful).
- **Band turns RED on version mismatch (`app.html`).** At start the band calls `get('/version')` and, if the server's bundled commit differs from `window.BUILD_COMMIT`, turns red and appends `⚠ serveur <commit>` — a live "you're on a stale cached bundle / update pending or failed" alarm. Offline → left neutral (no false alarm).

## 2026-06-02 addendum (7) — Motion hang ROOT CAUSE: it's a regression (timing), fixed by reordering the page

The onboarding telemetry + git archaeology finally pinned it as a **regression**, not an iOS quirk. The motion prompt *used to appear reliably*; it broke when motion was **deferred** from `bgGeo.start()` (`onStart`) to a `checkmotion` page that runs **after** the "Toujours" Settings round-trip.

- **Original (working, ≤ v2.4.x):** `MAURRawLocationProvider.onStart` called `startActivityUpdatesToQueue` **synchronously during `bgGeo.start()`** — i.e. during the *initial permission phase*, before any Settings round-trip. It appeared reliably (it even stacked under the Location prompt — the user's original complaint). Clean foreground context = prompt shows.
- **Regression:** motion was deferred to the JS `checkmotion` page, which the onboarding flow reaches **after** the iOS "Toujours" Settings round-trip. That round-trip backgrounds the app, and **iOS drops a Motion prompt requested in the post-round-trip window** — `j1jm`/`sk3u`: `auth` stuck `NotDetermined` across 34–463 retries, real hardware, `NSMotionUsageDescription` present, app active. No native trick (v2.14.3 re-prompt, v2.14.4 app-active gate, v2.14.5 instance-recreate + unconditional `queryActivity`) could make iOS present a prompt in that context.
- **Why addendum (5) didn't fix it:** `motion_prompt_early` fired in the right (pre-round-trip) context but **fire-and-forget**, then immediately routed to the confirmgeo "Toujours" guidance; `sk3u` shows the user tapped Réglages seconds later → app backgrounded → prompt dropped before it could land. The *page* still ran after Always.
- **Fix (webapp-only, `pages.js`) — restore the early timing as a blocking step.** `checkmotion` now runs **before** the Always round-trip: `startgeo.then` routes to `checkmotion` first (iOS, `!motionAuthorized && !iosMotionDone`); on completion `proceedAfterMotion()` sets `iosMotionDone` and re-enters `startgeo`, which skips motion and runs the Toujours gate. So motion gets a **clean, uninterrupted window with no competing Settings navigation** — the condition under which the prompt has always worked — and only then does the Toujours round-trip happen. New module flag `iosMotionDone`, reset in `checkgeo`. The addendum-5 `motion_prompt_early` fire-and-forget is removed.
- **No native change, no TestFlight** — pure page-order fix over the existing bridge. Ships in the webapp push. **Unverified on device**; success signature in telemetry: `checkmotion` → `motion_check granted=true` appears BEFORE `confirmgeo_settings_returned` (motion before the round-trip), and the walk session opens normally after.

## 2026-06-02 addendum (8) — ACTUAL root cause: the retry loop was cancelling its own prompt

Addendum (7)'s reorder was sound UX but did NOT fix it — build fe8b96d (apk 24) still failed on a fresh install with `checkmotion` running BEFORE any round-trip (clean context). So the round-trip context was never the cause. The real regression, proved by two fe8b96d sessions:

- **`f21e` (success):** motion granted after just **1** `motion_prompt`.
- **`uqwm` (fail):** **166** `motion_prompt`, never granted — every one `app=active`, `avail=true`, `auth=NotDetermined`.

**Few prompts → works; hammering → never works.** Each `GEO.startMotionUpdates()` does `stopActivityUpdates` + `startActivityUpdatesToQueue` natively, and the `checkmotion` poll loop re-issued it every `MOTION_PROMPT_RETRY_MS` (~1.5–2 s). **The repeated `stopActivityUpdates` tore down the in-flight Motion prompt before iOS could present it / before the user could tap it.** The original `onStart` code called `startActivityUpdatesToQueue` **once and left it alone** — exactly why it worked reliably. The retry loop (added blind, mid-saga, to "force" the prompt) was self-defeating: it was the regression's amplifier.

- **Fix (webapp-only, `pages.js` `checkmotion`):** removed the poll-timer re-fire entirely. Now fires `triggerMotionPrompt()` **once** on entry; re-arms only on a real resume-from-background (`bindMotionResume`) or the manual retry button — never on a timer. The single prompt stays stable for the user to grant. Combined with the addendum-(7) reorder, motion is requested once, in the clean pre-round-trip window, and left alone.
- **Native churn is now harmless** (one JS call ⇒ one native stop[noop]+start), so no rebuild needed; the v2.14.5 recreate/stop-restart logic can be simplified in a later native pass but isn't on the critical path.
- **Ships in the webapp push. Unverified on device** — success signature: `checkmotion` fires **~1** `motion_prompt`, then `motion_authorized` → `motion_check granted=true`.

## 2026-06-02 addendum (9) — gesture-triggered prompt (button-first checkmotion)

The single-call fix (addendum 8) worked mechanically — build 7e9be90 fired exactly **1** `motion_prompt` (`dvkf`, no more churn) — but motion **still didn't grant**: one clean call, app foreground-active, `activity_available=true`, `auth=NotDetermined`, no dialog. So a single automated call doesn't present the prompt on a fresh install.

What still works (original): `onStart` requested motion **inside `bgGeo.start()`, in the same accept-tap permission burst as the Location prompt** (it stacked under it). What broke: the deferred auto-fire on `checkmotion` page-load has none of that — no user gesture, and a possible `isStarted` / app-active race at page entry.

- **Fix (webapp-only, user's idea):** `checkmotion` is now **button-first** — it shows an explanation + an **"Autoriser"** button, and the Motion & Fitness prompt is fired from the **button's tap handler** (mirroring confirmgeo's "J'accepte" → Location prompt). A tap guarantees: a fresh user gesture, the app is foreground-active, and the location provider has finished starting — removing every race the auto-fire was exposed to. Mid-walk **resume** still auto-fires (no tap) + grace-proceeds; the manual "J'ai autorisé" retry and Settings deep-link fallbacks are unchanged. New `#checkmotion-accept` button in `app.html`.
- **Honest caveat:** the original `onStart` call wasn't a *direct* gesture handler either (it ran async in `bgGeo.start`), so a gesture may not be strictly required — but the button also fixes the timing/race, so it addresses several plausible causes at once. **If it still fails**, the next step is a native diagnostic (report `isStarted` + active-provider-is-Raw + whether `startActivityUpdatesToQueue` actually executed + `queryActivity` error code) — the current telemetry reads bridge-level state only and can't see whether the provider reached the prompt call.
- **Ships in the webapp push. Unverified on device** — success: tap **Autoriser** → dialog appears → `motion_authorized` → `motion_check granted=true`.

## 2026-06-02 addendum (10) — back to the native plugin: the `isStarted` gate + accumulated churn (bg-geo v2.14.6)

Button-first (50ebf0d, `5dvj`) ALSO failed: tap → 1 prompt, `app=active`, `avail=true`, `auth=NotDetermined`, no dialog. So gesture/timing/round-trip were all dead ends — the failure is the **native call path itself**.

**How iOS Motion & Fitness auth actually works:** there is no explicit `requestAuthorization` for `CMMotionActivityManager`; the prompt is presented on the **first access to activity data** (`startActivityUpdatesToQueue` or `queryActivityStartingFromDate`) while the app is foreground-active, and `NSMotionUsageDescription` must be present (it is). The original `onStart` did exactly this — **one `startActivityUpdatesToQueue` on the main thread** — and it worked.

**What the saga had turned that single call into** (in `MAURRawLocationProvider.startMotionActivityUpdates`): a `dispatch_async(global)→dispatch_async(main)` hop, **an `if (!isStarted) return` gate**, an `authorizationStatus` branch, **manager recreation throttled to 4 s**, a **`stopActivityUpdates` before every start**, AND a **parallel `queryActivityStartingFromDate`** — all added blind while chasing the hang. Two of these directly explain the failure:
  1. **The `isStarted` gate is wrong** — Motion auth is INDEPENDENT of `CLLocationManager`. On a fresh first run the location provider can still be starting when checkmotion fires, so the method **returned before any Core Motion call** → no prompt. (The original never hit this; it called motion inline right after `isStarted` was set. Fits "works sometimes after restart", where location is primed earlier.) The bridge-level diagnostic still read `avail=true/auth=NotDetermined` because that's measured in the bridge, not the provider — masking the early return.
  2. **The stop/recreate/parallel-query churn** double-accessed / tore down the manager around the prompt.

- **Fix (bg-geo v2.14.6, `167337f`):** `startMotionActivityUpdates` reverted to the canonical minimal form — `isActivityAvailable` check, bail on Denied/Restricted, create the manager once, **one `startActivityUpdatesToQueue` on the main queue**, nothing else. Removed the `isStarted` gate, the recreate logic (+ its ivar), the `stopActivityUpdates` churn, the parallel query, and the global-queue hop. `startActivityUpdatesToQueue` also delivers an initial activity shortly after starting (even stationary), which flips `motionAuthorized`.
- **Diagnostic:** the `startMotionUpdates` bridge now also returns `locationStarted` (`facade.isStarted`); `checkmotion` logs it as `motion_prompt.location_started` and `session.mjs` prints `locStarted=NO` when false — so the next session confirms whether the fresh-install `isStarted` race was the cause.
- **Needs a TestFlight rebuild** (native). Webapp side already correct (button-first, single call). config.xml → 25. **Unverified on device** — success: ~1 `motion_prompt` then `motion_authorized` → `motion_check granted=true`.

## 2026-06-02 addendum (11) — THE root cause: concurrent vs sequential prompts (iOS suppresses Motion-after-Location)

apk 25 ran **bg-geo 2.14.6** (confirmed by the new `plugin_versions` telemetry — that feature paid off), so the canonical-call fix was live and STILL failed first-run. `mogr` (d0d5918) gave the decisive comparison — **first run vs restart, every diagnostic identical** (`auth=NotDet, app=active, avail=true`), yet first-run never grants and the restart does. The only state difference between the two launches: **the first run showed a Location prompt ~3 s before the Motion request; the restart (Location already granted) showed none.**

→ **iOS silently suppresses the Motion & Fitness prompt when it is requested in the same app launch shortly after the Location prompt has been answered.** The original `onStart` worked because it requested Location and Motion **concurrently** (both pending before either was answered → iOS queues and shows both — exactly the "stacking under the Location prompt" the user first reported). Every deferral of Motion to *after* the Location grant — checkmotion page, reorder, single-call, button-first — requested it in the suppressed window. That's why nothing worked, and why a kill+restart (no Location prompt that launch) always did.

- **Fix (webapp-only, `pages.js`):** at the top of `startgeo`, fire `GEO.startMotionUpdates()` **concurrently with** `GEO.startGeoloc()` (iOS only — concurrent permission requests freeze the Android dialog) so both prompts are pending before the user answers either. `checkmotion` is now a pure **verifier** — it polls for the grant and never re-requests (a request there is post-Location = suppressed); Settings deep-link + "J'ai autorisé" retry remain manual fallbacks. Simulator/no-coprocessor handled via `GEO.motionUnavailable` (set from the startgeo call's `activity_available=false`). Button-first (`beginMotionPrompt`, `#checkmotion-accept`) removed.
- **No rebuild** — runs on the v2.14.6 native already in apk 25. Just deploy the webapp.
- **Unverified on device** — success: Location prompt → Motion prompt appears right after (same launch, fresh install) → `motion_check granted=true`, no kill+restart needed. If it still fails, the fallback is to request both in native `onStart` (literally the original concurrent call site), which is the proven mechanism.

## 2026-06-02 addendum (12) — back to the proven concurrent request in native onStart (bg-geo v2.14.7)

The JS-concurrent attempt (addendum 11, build 3c78e37) ALSO failed (`9eza`: first run no grant, restart grants) — because the bridge's `requestMotionUpdatesWhenAppActive` gate defeats it: when the Location prompt appears the app goes **inactive**, so the Motion request gets **queued until after the Location prompt closes** → straight back into the suppressed window. And "Motion before Location" as a pure webapp change is blocked by config timing: `bgGeo.configure` (which sets the Raw provider) runs *inside* `startGeoloc`, so before `startgeo` the facade has no Raw provider and ignores `startMotionUpdates`. Plus a webapp Motion-first risks suppressing **Location** (the critical permission) if iOS's "second-prompt" rule isn't Motion-specific.

The one pattern proven to show both prompts is the **original `onStart`**: request Location and Motion in the same native `start()`, both pending before either is answered, so iOS queues and shows both (the "stacking"). That is the only reliable timing, and it sidesteps the config-timing and Location-suppression risks.

- **Fix (bg-geo v2.14.7):** re-added `[self startMotionActivityUpdates]` to `MAURRawLocationProvider.onStart`, **before** `[locationManager start]` (so Motion is requested first, then Location — honouring the "Motion before Location" idea but keeping both concurrent/pending, which is what makes iOS show both). Inside the `!isStarted` guard, so it fires once per start; being in the provider guarantees it's configured. Uses the clean v2.14.6 `startMotionActivityUpdates` (single `startActivityUpdatesToQueue`, no gate/churn).
- **Webapp (reverted to match):** `confirmgeo` accept → `startgeo` (which triggers `onStart` → both prompts) → Toujours gate → **`checkmotion` = pure verifier** (polls for the grant, never re-requests — a request there is post-Location = suppressed) → rdv. Removed the addendum-7/9/11 reorder, button-first, and JS-concurrent code; `iosMotionDone` gone.
- **Needs a TestFlight rebuild** (native). config.xml already 25 → bump to 26. **Unverified on device** — success: on a fresh install, tap J'accepte → **Motion prompt then Location prompt, same launch** → walk proceeds, no kill+restart.

## 2026-06-03 addendum (13) — STOP the TestFlight loop; debug locally in Xcode (bg-geo v2.14.8 = diagnostic logging)

apk 26 (build 94765ac, bg-geo 2.14.7 = concurrent onStart, the historically-proven mechanism) STILL did not prompt. After ~26 builds and a multi-hour telemetry round-trip per attempt, telemetry-only diagnosis has hit its limit — bridge-level telemetry cannot see whether the provider's Core Motion calls execute, what `queryActivity` returns, or why iOS withholds the prompt. **Pivot: run the app from Xcode on a tethered device and read the native + TCC system logs.**

- **bg-geo v2.14.8** adds verbose `NSLog` diagnostics on the whole motion path (grep `MOTIONDBG`): `onStart` motion call + `isStarted`; facade routing (`provider=… isRaw=…`); `isActivityAvailable`; `authorizationStatus`; `startActivityUpdatesToQueue` call + each activity update; and a **diagnostic `queryActivity` whose error code is the definitive "why no prompt"** (105=NotAuthorized/TCC-denied, 107=NotEntitled/missing usage desc, NotAvailable=no hw; success=N samples=authorized). No behaviour change beyond the added query.
- **In Xcode/Console answer:** (1) does `facade … isRaw=1`? (2) `authorizationStatus=` 0 or 2? (3) does `startActivityUpdatesToQueue` get called? (4) `queryActivity` error code or OK? (5) **macOS Console.app, device, process `tccd` / filter `Motion` / `kTCCServiceMotion`** — the system's actual prompt decision. (6) On-device check: Settings → Confidentialité → Mouvement et fitness → is **"Suivi de la condition physique" (Fitness Tracking) master toggle** ON, and is Flanerie listed?
- **Leading suspects to confirm/kill with the logs:** TCC has a persisted denial for the bundle id (survives reinstall) → would show `authorizationStatus=2` or query `code=105`; Fitness Tracking master toggle off → prompt impossible; entitlement/usage-desc not in the actual binary → `code=107`; provider not Raw at call time → `isRaw=0`.
- Build from Xcode (FlanerieCordova/platforms/ios) — no TestFlight needed for this. **Diagnostic build, not a fix.**

## 2026-06-03 addendum (14) — SOLVED: the wrong location provider starts on fresh install (webapp-only fix)

The Xcode/Console run from addendum (13) cracked it — and it was leading-suspect (4)/(6) ("provider not Raw at call time → `isRaw=0`") all along. **On a fresh install the app starts `MAURDistanceFilterLocationProvider`, not `MAURRawLocationProvider`.** All ~26 builds of motion-timing surgery edited `MAURRawLocationProvider.onStart` — a method that **never runs on first launch**. There is no Motion prompt because there is no Raw provider to request it.

**Console evidence (fresh onboarding, apk 26 / bg-geo 2.14.8):**
- **Zero `MOTIONDBG` lines** anywhere — `MAURRawLocationProvider.onStart` was never called.
- Config dump shows `locationProvider=2` (RAW) **but** the running provider logs are all `DistanceFilterLocationProvider` ("iOS9 detected", "will start", "switchMode 1", "didUpdateLocations").
- Thread/timestamp ordering is the proof: `BgGeo #start: 0` at `:928` on the **main** thread fires **before** `BgGeo #configure: …locationProvider=2` at `:942` on a **background** thread, then `DistanceFilterLocationProvider iOS9 detected` at `:952`.

**Root cause — an unsynchronised `_config` race in `MAURBackgroundGeolocationFacade`:**
- JS `bgGeo.configure({locationProvider: RAW})` → CDV `configure:` runs via `runInBackground` (**background** thread): sets `_config` = RAW and persists to SQLite.
- JS `bgGeo.start()` → CDV `start:` does `dispatch_sync(main)` → `facade start:` reads config via `getConfig` on the **main** thread (`start:` line 188), then `getProvider:config.locationProvider.intValue` (line 195).
- The two share `_config` with no lock. On a fresh install **nothing is persisted**, so if `start:`'s `getConfig` wins the race it returns `[[MAURConfig alloc] initWithDefaults]`, whose default is `locationProvider = DISTANCE_FILTER_PROVIDER (0)` (`MAURConfig.m:35`) → `MAURDistanceFilterLocationProvider` starts → no motion code → no prompt.
- **Why kill+restart "fixes" it:** by then the RAW config is persisted, so `getConfig` returns RAW even under the race → `MAURRawLocationProvider.onStart` runs → motion prompt fires. This — **not** "Location already granted so Motion is the first prompt" (the theory baked into the onStart comment and addenda 7/11/12) — is the real reason restart worked. Every "fix" that relied on restart-context reasoning was chasing a false model.

**Regression origin:** bg-geo **v2.14.1** (addendum 2) removed the "redundant" `configure:` that the CDV `start:` action used to re-run; that call had been setting `_config` = RAW on the main thread as part of every start, masking the race. Dropping it exposed it.

**Fix (webapp-only, `geoloc.js` — no TestFlight):** `prepareBackgroundGeoloc()` now passes a success callback to `bgGeo.configure(...)` and stores a module promise `backgroundGeolocConfigured`; `backgroundGeoloc()` gates `checkStatus`/`start` behind it (`(backgroundGeolocConfigured || Promise.resolve()).then(...)`). The configure success callback fires only after the native `configure:` action has merged + persisted RAW, so `start:` always reads RAW. Already-setup path resolves immediately (config persisted). Deploy the webapp and test — **no native change needed**; v2.14.8's `MOTIONDBG` logging stays in place to confirm.
- **Success signature:** fresh install → `RawLocationProvider will start` + `MOTIONDBG onStart: requesting Motion` in the Xcode log (NOT `DistanceFilterLocationProvider`), Location prompt then Motion prompt, **no kill+restart**; telemetry `checkmotion` → `motion_check granted=true`.
- **Native belt-and-braces — bg-geo v2.14.9 (shipped, needs TestFlight rebuild):** CDV `start:` now re-applies the last JS config (`self->config`) via `facade configure:` on the **main** thread, inside the same `dispatch_sync(main)` block, *before* `facade start:` — guarded by `config != nil && !facade.isStarted`, with the configure result discarded so v2.14.1's real-start-outcome return is preserved. This restores the pre-v2.14.1 configure-before-start ordering on a single thread, so the correct (RAW) provider starts **regardless of JS call ordering** — defending the fix even if the webapp regresses. The webapp `await configure` fix and this native fix are independent and additive; either alone closes the race, both together is belt-and-braces. Still TODO (separate, low-risk): collapse the motion churn in `MAURRawLocationProvider` (v2.14.3–v2.14.8) back to the canonical single `startActivityUpdatesToQueue` now that the prompt isn't fighting context.

- **Onboarding UX + saga cleanup (webapp, same round).** The durable-"Toujours" Settings round-trip is **kept** (modern iOS won't grant durable Always from the in-app dialog, and the audit's field experience is that provisional Always gets silently downgraded mid-walk). What changed is only the framing: `confirmgeo`'s first screen now sets the two-step expectation up front ("iOS demande la localisation : choisissez *Pendant l'utilisation* … nous vous guiderons ensuite pour la régler sur *Toujours*"), so the round-trip is an expected continuation rather than a contradictory mid-flow bounce. Separately, the now-disproven motion-saga comments were corrected to the real model (motion is requested in native `onStart` alongside Location; the bug was the wrong provider on fresh install, **not** iOS suppressing motion-after-Location) across `pages.js` (`checkmotion` header + `triggerMotionPrompt`/`poll`, `startgeo` note) and `geoloc.js` (`startMotionUpdates`); dead residue removed (`lastPromptAt` write-only var, the never-shown `#checkmotion-accept` button + its hide). No behaviour change — `checkmotion` stays a verifier with the retry/Settings/resume fallbacks intact. **Considered but NOT done** (needs field data): dropping the round-trip in favour of provisional Always + the keepalive stack.

## 2026-06-03 addendum (15) — CONFIRMED ON DEVICE + Motion-prompt double-presentation fixed (bg-geo v2.14.10)

**The §14 fix works on a real device — first end-to-end success in the whole saga.** With bg-geo v2.14.9 (webapp await-configure + native belt-and-braces) the RAW provider starts on fresh install and the Motion prompt finally appears without a kill+restart.

One cosmetic wart remained: on tapping "J'accepte" the user saw a **quick Motion prompt → immediately replaced by the Location prompt (pick While Using) → Motion prompt again (grant)**. Cause: v2.14.7's `onStart` requested **Motion BEFORE Location**, so iOS briefly presented Motion, preempted it with Location, then re-presented Motion.

- **Fix part 1 (bg-geo v2.14.10, native `MAURRawLocationProvider.onStart`):** swapped to **Location-first, then Motion**, both still inside the same `onStart` (concurrent/pending — the mechanism that makes both reliably appear). This **restores the original working ordering** — addendum 7 records the original onStart had Motion "stack under" the Location prompt, i.e. Location shown first, Motion right after. Not a deferral (Motion is still requested in `onStart`, pending before the user answers Location), so it does not reintroduce the §14 failure mode.
- **Fix part 2 (bg-geo v2.14.11, native `startMotionActivityUpdates`) — the actual cause.** v2.14.10's ordering swap, tested on a rebuilt device, did NOT remove the double Motion prompt. Root cause: `startMotionActivityUpdates` made **two** Core Motion first-accesses — `startActivityUpdatesToQueue` (presents the prompt) **and** the v2.14.8 diagnostic `queryActivityStartingFromDate` (a SECOND first-access) — so iOS presented the Motion prompt twice. The diagnostic query was explicitly a debugging aid (addendum 13, "not a fix"); removed here, leaving the canonical **single `startActivityUpdatesToQueue`, nothing else** (exactly what the method's own comment always claimed). Verbose `MOTIONDBG` logging in this method trimmed too. Net result with both parts: **single Location prompt → single Motion prompt**.
- **Fix part 3 (bg-geo v2.14.12) — the one that should actually do it.** On-device test of v2.14.11 (session `…ip87`) proved the code-level double-*request* was gone: exactly one `requesting Motion` log, no `queryActivity`, no JS `facade startMotionUpdates`, and `motion_authorized` fired — yet the user still *saw* two Motion dialogs. Cause: `onStart` requested Motion (via `dispatch_async`) right after the Location request, so iOS began presenting Motion *while the Location prompt was also coming up*, preempted it with Location, then re-presented Motion — **one request, two visual presentations**. Fix: don't request Motion in `onStart` at all; request it from the `_slcManager` location **auth-change callback** (`-locationManager:didChangeAuthorizationStatus:`), one-shot (`_motionRequestedThisStart`), once the Location prompt has been **answered** (any definitive status) and the app is active again. Motion is then presented alone, nothing competing → single clean prompt. Still same-launch / in-app / immediately after the Location answer (the original "Motion stacks under Location" timing), so NOT the §14 deferral failure mode. Safety nets intact: the JS `checkmotion` retry/resume fallback still exists if the callback is ever missed.
- **Released + applied** via the `plugin-upgrade` skill (latest `bg-geo=2.14.12` on `origin/stable`, FlanerieCordova platforms regenerated). **Each native change needs a TestFlight/Xcode rebuild** to reach devices (the §14 webapp fix already works on the current build). On-device sequence: v2.14.10 still double-prompted (queryActivity) → v2.14.11 single *request* but iOS still double-*presented* (onStart timing) → **v2.14.12 defers Motion to the post-Location auth callback** — the build to verify shows a single Location prompt then a single Motion prompt.

## 2026-06-05 addendum — FRAPPAZ + ST-BONNET field sessions (Baptiste + Magalie)

**Sessions:** 24 total, 13 onboarding, 11 visitor. All Android, apk=23 / commit=`ad6dd58` / bg-geo=2.14.5. Full report: [`docs/archive/20260605-FRAPPAZ-STBONNET-report.md`](docs/archive/20260605-FRAPPAZ-STBONNET-report.md).

**Field report scope note:** The four ST_BONNET walk completions (`7sn4`, `j37j`, `cm3j`, `occn` — sessions starting 17h58–18h23) are pre-departure setup/test runs, not Magalie's actual 18h25 five-phone group. The only session with telemetry from Magalie's walk is `8aym`. Magalie's other four phones produced no telemetry.

### New bug — `checkbatteryopt` silent deadlock on `battery_opt: {blocked:true}`

On Android 13+ (confirmed: Xiaomi HyperOS 2201117TY, Fairphone FP4 Android 15), `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is silently blocked by the OS. `battery_opt:{blocked:true}` fires but the `checkbatteryopt` page has no handler — the user gets a frozen screen with no feedback and no exit path.

- **`8aym`** (Magalie's Redmi Note 11 HyperOS): blocked at 2.3min, 29-minute gap, eventually `ignoring:true` — but walk never opened. This is why the phone "quit."
- **`nlrc`** (Fairphone 4 Android 15, noon setup): 5 blocked events, 3 onboarding restarts, 74 minutes total.

**Fix (webapp `checkbatteryopt`):** detect `blocked=true`, surface manual instructions ("Paramètres → Applications → Flânerie → Batterie → Sans restriction"), offer "J'ai fait ça" re-poll + "Continuer quand même" escape. Wire `visibilitychange`/`resume` auto-advance as in `checknotifications`.

### New bug — simulation state persists in localStorage across sessions (silently)

`ykvf` (Baptiste, 16h39): intended real GPS test, but ran silently in simulation mode. Evidence: within 55ms of `session_start`, simulate GPS fixes were already injecting — simulate mode had been persisted since the morning dev sessions (`cz3v` at 08:30, all subsequent sessions). `gps_startup_rejected reason:"simulate"` shows the startup gate correctly excluded simulated fixes for readiness, but `route_probe acceptedForTrigger:true` still processed them and fired zone triggers. Baptiste pocketed the phone, the simulation replay timer stopped (JS timer, screen-off), and the walk paused for 26 minutes. On unlock a single out-of-sequence waypoint teleported the simulated position ≈3km away (the "GPS went haywire / m'a envoyé n'importe où"), then the session crashed and resumed.

**Fix:** reset simulate mode flag to OFF on every fresh session start (not inherited from localStorage). Add a persistent visible "SIMULATION ACTIVE" banner in devmode. Unify route_probe and startup gate: if startup gate rejects simulate fixes, route_probe should also not advance zones from them unless simulation is explicitly active for this session.

**Note on simulation design:** simulation is foreground-only (user drags map marker → position injected). Screen-lock stopping positions is expected behavior, not a bug. The issue is the stale state, not the timer.

### New bug — real GPS runs concurrently with simulation and can override it

Baptiste, 06/06/2026: in simulation mode, real GPS position fires alongside and overrides simulated positions. When simulate is active, `source:"raw"` fixes still arrive and are processed by route_probe — whichever fix is most recent wins zone triggering. **Fix:** route_probe (or the fix dispatcher) should discard `source:"raw"` fixes while simulate mode is active.

### New issue — launcher blocks at first launch via WiFi tethering (no cached zip)

Magalie, 04/06/2026: fresh-install phones (no cached zip) blocked at splash with "Veuillez connecter à internet" when connected via WiFi hotspot from another 4G phone. Same devices work on normal WiFi and direct 4G. No telemetry (phones never reached the server).

Most likely causes: (1) double-NAT stack (Android hotspot → operator CG-NAT) causes silent connection timeout; (2) IPv6/IPv4 mismatch — French 4G hotspots often provide IPv4 only to clients while the server may have AAAA record; (3) timing — hotspot is up before the tethering phone's 4G connection is re-established (~15s window).

**Fix (launcher):** retry server connectivity check with backoff (5s → 15s → 30s) before showing the error; add "Réessayer" button; surface a more specific message. Long-term: launch from cached zip when available, even without network.

### H1 ExoPlayer — partially confirmed

`8giw` (SM-A515F / Android 13, 21-min 12-step walk): 40 `audio_uri_resolved` = `backend:'exoplayer'`, 0 errors. Loan-phone second confirmation still needed before retiring Howler.

### GPS healthy on Android — no OEM kill, no Doze activation

`8giw`: 211 real fixes, avgAcc=7m, max freshness gap=80s (two auto-recovered stream pauses), 0 blackouts. AlarmManager Doze backup (`alarm_wake_stats count=0`) never activated. Architecture D (`fusedAvailable=false` on this dev ROM) was not exercised.

### `accuracy_near_border` calibration data collected

300 events from `8giw` (all 12 steps). p50=−9m, p75=−3m, p95=+3.2m. Useful baseline but avgAcc=7m only — need a session with avgAcc 20–30m before setting E1/E2/E3 thresholds.

### SM-A415F LOW_MEMORY exits

`cm3j` (Samsung A41, Android 12): two LOW_MEMORY exits in `last_exit_reasons`. No impact on 1-min walk; monitor on longer sessions.

---

## 2026-06-06 addendum — first iOS field validation + ExoPlayer decode regression

**29 sessions (the day the 2026-06-05 round did not analyse).** iOS on **apk 27 / bg-geo 2.14.12**; all Android on **apk 23 / bg-geo 2.14.5**. Full report: [`docs/archive/20260606-IOS-GIVORS-V7-report.md`](docs/archive/20260606-IOS-GIVORS-V7-report.md).

### 🔴 ExoPlayer decode regression — "H1 clean" disproven on a second device

`y9ns` (SM-A528B / Galaxy A52s 5G, Android 14, GIVORS_V7_CBR) threw **38 `step_voice` playerrors**, all `backend=exoplayer` with native message `MediaCodecAudioRenderer error, index=1, format=Format(… audio/mpeg, 256000, [2, 44100]), format_supported=YES`. The format **is** supported → these are **runtime MediaCodec (hardware decoder) failures**, not bad files. **Transient** (10/17 files later played; 7× `audio_playerror_retry`) and **churn-correlated** (250 `audio_uri_resolved` for an 8-step segment → many concurrently-prepared `ExoPlayerInstance`s each holding a HW MP3 codec → pool exhaustion / reclaim). Same device + parcours `8bfn` (steps 8-16) was clean → driven by cold-start/high-churn, not the device or the files. **Visitor impact:** 3 blocs fell to afterplay (`step_voice_failed reason=playerror`) = silence-instead-of-narration. **8giw (the one "clean" test) was a single device + single parcours; the second-device confirmation the audit was waiting for is `y9ns`, and it failed. Howler retirement is POSTPONED; Howler stays the default fallback.** (See H1 row + open-items correction below.)

### 🟢 First iOS field sessions — iOS native plan validated at configure level

`5h9a` (onboarding) + `imug` (Test Dumas, 0 steps fired) on iPhone17,5 / iOS 26.5 / apk 27 / bg-geo 2.14.12:
- **Motion saga field-resolved on the shipping build** — both iOS onboarding sessions **granted Motion on fresh install** (`imug`: `motion_check granted=true waited=501ms`). Confirms §14/§15 beyond the build-18 staff test `jtcv`.
- **audio-simple iOS backend** (R25/I.B): 7 `audio_uri_resolved` all `backend=audio-simple`, 0 errors. **nowplaying** (J/R22): `nowplaying_setup`×2. **GPS rail configure** (H/R23, was dead code): `gps_rail_configured`×2. **ios_stream_health + cl_state** (R27/D6): 25 each. **CLVisit** (R26/L): `gps_visit_event`×1. iOS GPS healthy: 134 fixes, 0 gaps ≥90 s, avgAcc 4.8 m.
- **Still NOT validated** (imug fired 0 steps — staff onboarding/GPS test, not a walk): full locked-pocket iOS walk with BLOC narration, **rail wake** during a real blackout (`gps_rail_wake`=0), iOS audio resume after kill, audio-simple under narration load.

### Correction to the 2026-06-05 `checkbatteryopt` finding

The deployed `checkbatteryopt` is **not** "a frozen screen with no exit." It renders tailored OEM/restricted/power-save copy and shows `Paramètres batterie` / `Paramètres fabricant` / `J'ai désactivé` after a ~15 s poll (`BATTOPT_MAX_ATTEMPTS=10 × 1500 ms`) and re-polls on resume/visibilitychange. The real defect: the gate is **un-skippable**, and `8aym` actually **passed it** (`battery_opt {ignoring:true}` at event 477/495, 42 s before session end) — it was stuck ~31 min *failing to grant* the exemption on HyperOS, then ran out of departure window. Fix per the operator's principle: keep it blocking, but after repeated failure surface an **explicit risk + informed "continuer quand même" + loan-phone guidance** for unfixable OEMs (do not silently skip, do not trap).

### Correction (2) — `nlrc`'s 74-min stall was the GPS startup gate, not battery-opt

The 2026-06-05 report attributes `nlrc` (Fairphone 4, Android 15, noon setup) to the battery block. The timeline disproves that: battery reached `ignoring:true` after each of its 3 onboarding restarts. The real blocker was the **GPS startup gate at `rdv`** — `nlrc` logged `gps_startup_rejected reason=accuracy` (and `stale`) **dozens of times across 74 min**, only momentarily reaching `READY`. The FP4 GPS is poor (avgAcc ~21 m, p95 114 m) and the gate (`geoloc.js`) requires `STARTUP_FIX_MAX_ACCURACY_M = 15` + 2 distinct fresh fixes (`STARTUP_SECOND_FIX_MIN_MOVEMENT_M = 8`, `STARTUP_FIX_MAX_AGE_MS = 12000`). A stationary, weak-GPS phone cannot clear a 15 m bar → it never leaves `rdv`. This is a **separate trap from battery-opt and arguably worse**: it hits *any* weak-GPS device, not just specific OEMs, and presents as the generic "En attente du GPS". It is the B4/R27 calibration item with field proof the gate is too strict. Fix direction: soften the accuracy gate and/or add a time-boxed best-effort fallback (after N s of trying, allow "départ" on the best fix obtained) so a weak-GPS walker isn't stranded.

### Diagnostic gap — `route_probe` has no `source` field

`fire`/`n8i1`/`xp3u` (HTC U11 sim) show real `rdv-warmup` GPS fixes coexisting with `simulate` fixes (Baptiste's "simulation uses real GPS"), but `route_probe` events don't tag the fix source, so sim-vs-real triggering can't be audited post-hoc. Add `source` to `route_probe` before/with the simulate-isolation fix.

---

### P0.3 — launcher tethering connectivity: ROOT CAUSE FOUND (2026-06-07) = server AAAA / IPv6

**SOLVED — it was hypothesis #2 (IPv6/IPv4 mismatch), field-confirmed on an iPhone.** Repro: iPhone joined a **4G phone's WiFi hotspot** → launcher blocks at "Liaison internet nécessaire", **retries did NOT help**, then **switching to domestic WiFi worked immediately**. On the same tethered connection, **Brave browser reached `flanerie.bloffique-theatre.com` fine**.

**Root cause:** the server publishes **both** an A record (`185.125.27.88`) **and an AAAA record (`2001:1600:4:11::63b`)**. Both are reachable from a real dual-stack network (verified: HTTPS 200 over each). French 4G carriers run NAT64/DNS64; a 4G-tethered client gets an environment where the resolver returns the AAAA and iOS (RFC 6724) **prefers IPv6**, but the IPv6 route doesn't exist for the tethered client → connection fails. **The Cordova WebView XHR does not perform the aggressive Happy-Eyeballs A/AAAA fallback that Brave's Chromium stack does**, so it fails hard and **identically on every retry** (which is why backoff didn't help). Domestic WiFi has a working/clean path → success. This is NOT a timing race (#3) — that's why the retry round we shipped first didn't fix it (kept, still useful for transient cases).

**The fix is two-part:**

1. **Server (DNS) — the real fix, no rebuild, reaches all deployed phones:** **remove the AAAA record** for `flanerie.bloffique-theatre.com`. All clients then resolve only the A record and use IPv4, which routes everywhere (including 4G tethering). Downside is negligible — dual-stack clients fall back to IPv4 anyway, and the app gains nothing from IPv6. **This is the action that actually unblocks tethered fresh installs.** ⏳ *Owner: operator DNS change.*
2. **Client (launcher diagnostics) — ✅ shipped 2026-06-07, needs container rebuild:** so a future network failure is self-diagnosing instead of a black box. `gatherNetDiag()` adds `{online, conn_type, conn_effective, downlink, clock}` to **every** beacon. On terminal failure `reportConnectivityFailure()` runs a cache-busted `/version` re-probe via `probeUrl()` (resolves `{ok, status, kind∈ok/http_error/neterror/timeout/exception, elapsed_ms}`) and queues a **`connectivity_failed`** beacon. The IPv6 fingerprint to look for: `net.online=true` + `probe_host.kind=neterror` (host unreachable while the device thinks it's online), correlated with "works on domestic WiFi." Combined with the beacon queue (above), the failure now reaches the server on the next successful launch. **Note:** an IP-literal probe to bypass DNS is NOT useful in a WebView XHR (hostname TLS cert won't validate against an IP, and the CSP `connect-src` wildcard wouldn't cover it) — host probe + error-kind is the signal.

**Still open (P0.3 remainder, low priority once AAAA is dropped):** the staged HTTP-vs-HTTPS-vs-external-host probe to fully localise DNS-vs-TLS-vs-routing (CSP-constrained); a cross-origin reachability check to separate "no internet" from "can't reach our host" (needs CSP additions). Not needed if the AAAA removal holds.

**Original ranked hypotheses (for the record — #2 won):**
1. DNS via the hotspot relay not up → instant `onerror`.
2. **IPv6/IPv4 mismatch ✅ CONFIRMED** — host has an AAAA, tethered client can't route v6, WebView won't fall back.
3. Thundering herd during hotspot NAT setup → a 30 s retry succeeds. (Disproven here: retries didn't help.)
4. TLS failure from a wrong clock → `onerror`. (`clock` now in the diag if it recurs.)
5. Double-NAT / MTU drop of the TLS handshake → `ontimeout`.

**Fast field narrowing (still valid):** on a blocked phone open a browser to `https://flanerie.bloffique-theatre.com` → it loads (as observed) ⇒ DNS+TLS+server fine, the fault is IPv6 routing + WebView fallback ⇒ AAAA removal is the fix.

### P0 fixes implemented (2026-06-06, post-analysis) — needs builds / field validation

Webapp changes are live on the next deploy; the audio-simple change needs a plugin bump + container rebuild.

- **P0.1 codec exhaustion** — `cordova-plugin-audio-simple`: new `ExoPlayerInstance.softwarePreferredRenderersFactory()` builds every player (and the `ExoPlayerService` silent keepalive) with a `MediaCodecSelector` that prefers **software** audio decoders + `setEnableDecoderFallback(true)`. SW MP3/WAV decode is not subject to the hardware codec-instance limit, so the `MediaCodecAudioRenderer` exhaustion is structurally removed. **Needs plugin version bump + container rebuild + on-device re-test (SM-A528B / GIVORS_V7)** before Howler retirement is reconsidered.
- **P0.1 #4 churn** — `spot.js`: unload now requires being beyond `_unloadRadius` continuously for `UNLOAD_DEBOUNCE_MS=30000` (kills the zone load/unload thrash, e.g. Objet 1 ×74), and a load is skipped while one is already in flight (`loadState()` contains `'loading'`) — stops the offlimit reload-storm (a stuck load re-issued every GPS fix). Webapp-only.
- **P0.1 telemetry** — `player.js` logs `native_error_code` (raw Media3 errorCode) on audio load/play errors. Webapp-only.
- **P0.2 battery** — `checkbatteryopt` stays fully blocking; on `blocked:true` (OS suppresses the exemption dialog, e.g. HyperOS) it shows `#checkbatteryopt-blocked-help` = staff-help / loan-phone guidance (no skip — the exemption protects the locked-screen walk). Webapp-only.
- **P0.2b GPS gate** — rdv: after `RDV_STARTUP_FALLBACK_MS=90000` failing the gate, `#rdv-startup-fallback` + `#rdv-force-start` ("Démarrer quand même", shows best accuracy) appear with loan-phone guidance; logs `gps_startup_fallback_offered`/`_used`; auto-hidden if GPS recovers. Webapp-only.
- **P0.3 launcher** — ✅ **partial (2026-06-07, container):** `fetchInfoWithRetry([5000, 15000, 30000])` retries the `/update/info` check up to 3× before proceeding; fixes the hotspot thundering-herd failure (hypothesis #3: 4G uplink not re-established before the single 12 s shot). On terminal failure `showLauncherError` surfaces stage + error kind (network/timeout) + `navigator.onLine` state + **"Réessayer"** button in `#launcher-detail`. **Beacon queue:** `sendLauncherBeacon` now also calls `queueBeacon(payload)` — every launcher event is persisted to `localStorage` (`launcher_beacon_queue`, capped at 20 entries). `flushBeaconQueue()` drains the queue as soon as the info fetch succeeds (network confirmed reachable), retaining any items `sendBeacon` rejects. Failed-launch events therefore survive to the next successful start. The staged-reachability probe (DNS vs TLS vs routing) remains as follow-up. **Needs container rebuild** (HTML + JS changes).
- **P1.4 simulation hygiene** (webapp): (a) `geoloc.js` `_callbackPosition` no longer emits `'position'` for real fixes while `runMode==='simulate'` (logs `gps_trigger_rejected reason=real_fix_during_simulate`) → real GPS can't override the simulated position (Baptiste 06/06); (b) DEVMODE `checkgeo` auto-restores a persisted `geoMode` **only to resume a walk in progress** (`valid() && currentStep>=0`), so a stale `'simulate'` never silently simulates a fresh real-GPS walk (ykvf 2026-06-05); (c) a persistent **`#simulation-banner`** shows whenever `runMode==='simulate'`; (d) `route_probe` now carries `source` (sim vs real) — the diagnostic gap that made (a) un-auditable. Production GPS path unchanged (the gate is inert unless simulating; checkgeo change is DEVMODE-only).

Known follow-ups: ~~`PlayerSimple` has no `hasError()`~~ **fixed 2026-06-07** (one-liner added — Zone/Offlimit hard-loaderror protection now active); the load-churn root (≈250 resolves / 8 steps on GIVORS_V7) is reduced, not eliminated — why those zones overlap so heavily is a P1.5 follow-up.

---

## 2026-06-07 addendum — codebase audit + two webapp/container fixes

Full-codebase audit against mobile-audit.md (webapp + FlanerieCordova + four forks). Awaiting next telemetry batch post-2026-06-06 deployment.

### Audit findings

- **All P0 webapp fixes confirmed live in source:** P0.1 churn (`UNLOAD_DEBOUNCE_MS`, in-flight guard), P0.2 battery blocked-help, P0.2b GPS fallback (`RDV_STARTUP_FALLBACK_MS=90000` + `#rdv-force-start`), P1.4 simulation hygiene.
- **P0.1 SW-decoder fix confirmed in plugin source but not yet on any device:** `audio-simple` 0.3.4's `softwarePreferredRenderersFactory()` + `setEnableDecoderFallback(true)` are in `ExoPlayerInstance.java` (and applied to the `ExoPlayerService` silent player), installed in FlanerieCordova's plugins dir. No apk 28 yet — the fix reaches devices only after a container rebuild.
- **Plugin versions in FlanerieCordova (confirmed):** bg-geo 2.14.12, audio-simple 0.3.4, audiofocus 1.9.1, power-opt 0.3.1.
- **`PlayerSimple.hasError()` gap found and fixed** (see B below). Zone/Offlimit hard-loaderror reload protection was silently inert; the spot.js guard correctly used `typeof this.player.hasError === 'function'` but `PlayerSimple` never exposed the method — only `PlayerStep` did.
- **P0.3 launcher backoff implemented** (see C below). Still open: staged-reachability probe, beacon queue.
- **B4/R27 GPS startup gate still uncalibrated:** `STARTUP_FIX_MAX_ACCURACY_M=15` unchanged. The P0.2b 90 s force-start is a UI escape, not a gate fix. Calibration gates on VILLEURBANNE multi-device data.
- **Architecture D Fused fallback** and **iOS locked-pocket walk** remain unvalidated (no field data yet).
- **Dual AVAudioSession** (audiofocus + audio-simple both call `setActive` on iOS): acknowledged redundancy, intentional until audio-simple iOS is fully validated as sole owner.
- **bg-geo `MOTIONDBG` verbose NSLogs** (added v2.14.8 for the motion saga): still in native code. Cosmetic; strip in a future pass once the saga is fully confirmed closed.

### B — `PlayerSimple.hasError()` [SAFE-TODAY, webapp]

Added `hasError() { return !!this._loadError }` to `PlayerSimple` (player.js). The existing guard in `spot.js:305` (`typeof this.player.hasError === 'function' && this.player.hasError()`) was always `false` for Zone and Offlimit players (they use `PlayerSimple`, not `PlayerStep`). With this fix, a hard loaderror on a Zone or Offlimit player correctly suppresses reload attempts via the `hasError` branch, in addition to the in-flight guard from P0.1. One-liner, no native dependency.

### C — Launcher backoff retry + error detail [SAFE-TODAY, container]

**`FlanerieCordova/www/launcher.js`** — new `fetchInfoWithRetry([5000, 15000, 30000])` wraps the `/update/info` XHR: on failure it waits 5 s, retries; on second failure waits 15 s, retries; on third failure waits 30 s, retries; only then rejects. Total: 4 attempts, up to 50 s. Addresses hypothesis #3 (thundering-herd on hotspot — all phones hit the single 12 s shot before the upstream 4G link is ready; a 30 s wait clears it). New `showLauncherError(stage, err)` replaces the bare `element.style.display='block'` calls: populates `#launcher-error-msg` with stage + error kind (network / délai dépassé) + `navigator.onLine` state, then surfaces `#launcher-detail` with a **"Réessayer"** button (`window.location.reload()`).

**`FlanerieCordova/www/index.html`** — added a `#launcher-error-msg` paragraph (shown during retries with a "Reconnexion en cours (n/3)…" counter, and on terminal failure with the error detail) + a `#launcher-detail` section with the "Réessayer" button (purple `#6F3CFF`, `window.location.reload()`), both hidden until first failure.

**Beacon queue + connectivity diagnostics (added same round):** `sendLauncherBeacon` now also `queueBeacon()`s every payload to `localStorage` (`launcher_beacon_queue`, cap 20); `flushBeaconQueue()` drains it the moment the info fetch succeeds. `gatherNetDiag()` adds `{online, conn_type, conn_effective, downlink, clock}` to every beacon. On terminal failure `reportConnectivityFailure()` re-probes `/version` (cache-busted) via `probeUrl()` and queues a **`connectivity_failed`** beacon — so the failure that previously vanished (beacon posted to the same unreachable server) now reaches the server on the next successful launch.

**ROOT CAUSE FOUND same day (see the P0.3 section above):** the tethering failure is the **server's AAAA / IPv6 record** being unroutable from 4G-tethered clients while the WebView XHR won't fall back to IPv4 (Brave does). Field-confirmed on an iPhone. **The actual fix is server-side: drop the AAAA record (operator DNS change, no rebuild, fixes all deployed phones).** The launcher retry/queue/diagnostics here are belt-and-braces + future-proofing, NOT the cure for this specific bug.

**Needs container rebuild** (apk 28) to reach devices — rides alongside the audio-simple 0.3.4 SW-decoder build. The AAAA removal is independent and immediate.

---

## 2026-06-09 addendum — backpack multi-device test: iOS native plan validated end-to-end; Android background JS-suspension is a P0

**48 sessions, single uniform build** — apk **28** / webapp `6cda72bf` / bg-geo **2.14.12** / audio-simple **0.3.4** / audiofocus **1.9.1** / power-opt **0.3.1**; zero skew; single parcours `FLANERIE_INVITES_V3` (21 steps). **First field run of apk 28.** Full report: [`docs/archive/20260609-BACKPACK-MULTIDEVICE-report.md`](docs/archive/20260609-BACKPACK-MULTIDEVICE-report.md).

**Method (operator):** staff testing *as real users*; **most phones carried together, locked, in one tester's backpack** on the same walk (the ~11:17–11:24 start cluster) → a controlled same-conditions platform comparison — identical route/bag/timing, only the device differs.

### 🟢 iOS — first real locked-pocket walks; closes a stack of pending validations

Two iPhones onboarded + walked the full route locked away: `0x7o` (iPhone SE 3, iOS 26.4.2, 42 min, **all 21 steps contiguous → completed**) and `4a7m` (iPhone 8, iOS 16.7.10, 54 min, steps 0–19 bar 17). Both:
- **`gps_rail_wake=38`** during real blackouts — the long-pending rail-wake validation (was `=0, no blackout to trigger it`). The iOS region-wake rail fires and recovers the live stream in the field. `gps_state` flipped `frozen→recovered` (12×/5×); R27 freshness correctly flagged stale-keepalive masking (`4a7m` real-fix freshness 311 s) as `frozen`, not healthy.
- **audio-simple 0 errors** across 54+42 min of BLOC narration (first under-load validation). **CLVisit** 3–6×, **ios_stream_health+cl_state** 82–105×, **Motion granted on fresh install** on both (saga §14/§15 holds, iOS 16 *and* 26).

→ Flips to ✅: R21/R22 iOS audio walk-level, R27 background-stream, R23 rail **wake**, R26 visit, full locked-pocket iOS walk. **No iOS defects today.**

### 🔴 Android — WebView JS event loop suspended in background; native GPS stays alive (P0, likely launch blocker)

Every Android in the bag logged a **40+ min GPS gap**, route frozen at step 0, catching up only when the bag was opened at the end — `s906`/`h52i` (48 min), `detx` (Sony F5121, Android 8, 42 min), `pzsl`/`8acr` (41–42 min, SM-A515F), shorter on `v6f5` (Xiaomi, 10 min) and `1u05`/`8dvc` (FP4). Across Samsung/Sony/Xiaomi/Fairphone, Android 8→15. (`8acr` reports "completed" *misleadingly* — it teleported to step 20 at min 42; the walker heard nothing for 41 min.)

**Root cause — confirmed, and it is NOT GPS or battery-opt:** during the gaps the 30 s JS timers (`real_callback_freshness`, `alarm_wake_stats`, `voice_snapshot`) fired ~3–9× instead of ~100× → **the WebView JS event loop was suspended.** Meanwhile the native bg-geo service stayed fully alive: AlarmManager fired 110–154× (BG-5), `rawDelivered` 2553–4169 fixes, **`fusedAvailable=true`** with native dedupe suppressing fused as designed (Architecture D validated *available* on real devices). Battery-opt exempt on all (`standby_bucket=EXEMPTED`, `ignoring_batt_opt=true`). The healthy native location stream has nowhere to land because the JS that runs zone-triggering + audio selection is frozen. This is the audit's P0.5 Fix 1e "JS-suspended-despite-alarm" scenario — now **confirmed at scale**, made unambiguous by the iPhones in the same bag working.

**Mechanism (confirmed in source):** the keepalive that *used* to hold the Chromium renderer awake was the JS `SILENT_PLAYER` playing through Howler/WebAudio (an active in-renderer AudioContext keeps a background renderer scheduled). Post-ExoPlayer migration (R21/H1), `SILENT_PLAYER` (`pages.js:2475`) loads through the ExoPlayer branch (`player.js:718`) → it plays via the **native** `cordova.plugins.audio.Player` service, so **no audio context runs inside the WebView renderer**. `Howler.autoSuspend=false` (`player.js:44`) is moot; NoSleep only holds the screen wake-lock (released when locked). Net: on the ExoPlayer Android path nothing keeps the JS loop alive in a locked pocket. **This is an ExoPlayer-migration regression in disguise** — the old Howler path kept the renderer alive for free; `8giw` (2026-06-05) didn't suspend only because it was a single phone walked/handled, not deep in a locked bag.

### Android background JS-suspension — fix plan (layered; keep the JS loop alive, do NOT port the walk to native)

The fix is to **keep the WebView renderer's JS event loop scheduled when locked**, not to rewrite the walk logic. Layered, cheapest-first:

1. **✅ SHIPPED [webapp] — in-renderer Web Audio keepalive.** `RENDERER_KEEPALIVE` (`pages.js`) plays the silent `flanerie.mp3` through **Howler with `html5:false` (Web Audio API, not an `<audio>` element)** for the duration of a parcours — the exact mechanism the Howler era had for free. Android-gated (iOS keeps JS alive via the location bg-mode). Started at parcours start, stopped at walk-end, `poke()`d on `visibilitychange` to recover a suspended AudioContext. Telemetry: `renderer_keepalive` (+`_error`). Volume 1.0 is safe (asset content is silence).
2. **✅ SHIPPED [container] — `KeepRunning=true`.** Added to `FlanerieCordova/config.xml` (was unset → relying on the default) so Cordova never pauses the WebView on background. Belt-and-braces; insufficient alone (renderer freeze is Chromium-internal, below the KeepRunning layer). Needs container rebuild.
3. **NEXT [container, small native] — `WebView.setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, waivedWhenNotVisible=false)`.** The most *direct* lever: by default WebView drops the renderer to WAIVED priority when not visible → eligible for freeze/kill; setting `waivedWhenNotVisible=false` keeps the renderer IMPORTANT (un-frozen) while the screen is off. Reaches the WebView in the Activity via a small `after_prepare` hook or a tiny plugin. Pairs with the FG service (process not cached) → renderer stays scheduled. Implement if the desk test (below) still shows any throttling after 1+2.
4. **Validation — desk test, NO walk needed.** The freeze is screen-off + backgrounded, not motion-dependent: start a parcours (or reach the parcours page in devmode), lock the screen on a desk 15 min, unlock, confirm `real_callback_freshness` fired every ~30 s with **no multi-minute gap** + `renderer_keepalive action=start` present. Watch that narration is **not** ducked/interrupted by the keepalive stream (the one coexistence risk: Web-Audio keepalive + native ExoPlayer narration playing simultaneously).
5. **Only if 1–3 fail — native geofence wake-rail [RESEARCH-FIRST].** Android `GeofencingClient` registers coarse circular geofences at zone boundaries; a crossing wakes the app via PendingIntent → plugin nudges the renderer / delivers a fix → **JS still does the precise polygon trigger** (wakeup-only, mirrors the iOS rail; audit Decision 2.B). This is the Android analog of the iOS rail — NOT a logic port.
6. **REJECTED — porting spot.js polygon math + audio orchestration to native.** That doubles the most complex, highest-churn code in the app across *two* native platforms to solve what is a *scheduling* problem, not a compute problem. The JS isn't too slow; it just isn't being run. Layers 1–3 (and 5 if needed) make it run. Revisit only if Android proves it will not keep a WebView renderer scheduled under any of these levers.

→ Promotes B4 / P0.5 Fix 1e from telemetry-diagnostic to a real P0 fix; reproducing set = `8acr`/`detx`/`s906`/`h52i`.

### Audio — clean fleet-wide
Zero real narration failures (no `step_voice_failed`, no `BLOC_*` errors) across all 48 sessions. 124 ExoPlayer + 79 audio-simple resolves, **0 errors on either**; apk 28's SW-decoder fix held across 5 Android models. **Caveat:** the SM-A528B that failed 2026-06-06 was **not present** — the targeted Howler-retirement re-test is still owed; today is supporting evidence, not the confirmation.

### Follow-up fixes (2026-06-09, webapp + analyzer — ride the next deploy, no native rebuild)

Five issues raised post-test. All webapp/tooling:

1. **iOS brief "GPS LOST" on a static scene [webapp, geoloc.js/pages.js].** Root cause: `0x7o` had NO `gps_lost`/`user_lost` — it was the R27 `gps_state: frozen` indicator. A stationary walker (static scene) makes iOS stop emitting fresh fixes → real-fix age crosses the 10 s `stateUpdateTimeout` → `frozen` fires ~10–30 s **before** CMMotionActivity's `motionIsStationary` catches up; the existing stationary guard misses that lag, and `frozen` was **pausing narration + playing the GPS-lost jingle** mid-scene. Fix: `frozen` no longer disrupts on the first tick — escalation (pause/jingle/overlay) is deferred behind `GPS_FROZEN_SUSTAIN_MS=20000` and re-checks `motionIsStationary` when it fires (by then the motion flag has caught up → suppressed). `frozen`≠`lost`; keepalive is alive so a 20 s grace is safe. New `gps_frozen_escalated` telemetry. Feeds B4/R27 calibration.
2. **Devmode "Erreur de lecture audio… appareil ne semble pas compatible" [webapp, pages.js checkaudio].** Devmode-only, passes in normal mode, kill+restart clears it — not in telemetry (only `checkaudio_fail{reason}` was logged, no native code/backend). Two-part: (a) `checkaudio` now does a **single C4-style retry** on a transient loaderror/playerror/timeout before hard-failing (likely resolves the symptom); (b) `checkaudio_fail`/`checkaudio_retry` now carry `backend` + `native_error_code` so the next repro is finally pinned. **Root cause still unconfirmed** — capture one devmode-fail session to settle it (FILE_NOT_FOUND 2005 = file-layer-not-ready vs 4001/4002 = codec exhaustion).
3. **Devmode "restart" didn't cut playing media [webapp, pages.js].** `#parcours-restart` did `location.reload()` but never released the native ExoPlayer (FG 7375) / audiofocus (7374) services, which survive a WebView reload → the track kept playing and native players leaked (a likely contributor to #2). Fix: mirror the walk-end (A1) teardown — `stopAudio` + `releaseAudioPluginAll('restart')` + `releaseAudiofocusSession('restart')` (awaited) before reload.
4. **Loan-device identity [webapp, pages.js/telemetry.js].** Removed the manual `is_loan` devmode toggle; `is_loan` is now **auto-set + persisted the first time a phone enters devmode** (`loan_auto_marked`) — visitors' BYOD phones never see devmode, so this cleanly tags the staff/loan fleet. (Decision: aggregate by the existing auto-UUID; no custom human label.)
5. **Telemetry aggregation by physical phone [analyzer, analyze.mjs].** "Device re-use" now groups by **`deviceUuid`** (was by model), with a per-device rollup (loan / completed / frozen-min / step_voice errors / resumes). Confirmed on 2026-06-09 data: the "SM-A515F ×6" line was **6 distinct physical phones**, now shown individually.

### "Telemetry didn't track all 18 backpack phones" — diagnosis + robustness fixes

**Diagnosis: it is the Android JS-suspension (above), not the network.** The tester walked 18 phones (all SIM-less, internet via a GL.iNet 4G travel router). Telemetry census: ~17–19 distinct phones *did* reach the server (consistent with 18) — phones weren't missing, their sessions were **truncated**. 8 backpack Android walks stop at ~60 s (last event = the 60 s flush; `app_visibility:background` ~10 s in; the 30 s JS heartbeat fires only twice then stops) — the WebView JS froze in the bag, and since the flush timer is JS, **delivery stopped**. The full 49–56 min sessions are the same freeze but their JS resumed (bag opened) and flushed. Ruled out network: every phone delivered `session_diag` + its first minute (connectivity worked at start), **zero `connectivity_failed` beacons**, and the server now publishes **only the A record — the AAAA/IPv6 record is already dropped** (the `launcher-ipv6-tethering` fix is live), so NAT64/4G-tethering is not in play. → The keepalive fix (levers 1–3) fixes telemetry tracking too: keep JS scheduled → the 30 s flush keeps running → all phones deliver continuously.

**Robustness fixes shipped anyway (webapp, telemetry.js) so telemetry survives a freeze/offline phone:**
6. **Durable pending buffer** — undelivered events are persisted to `localStorage` (`telemetry_pending`) on flush-failure and on `visibilitychange`-hidden, and **re-sent on the next launch** (`_drainPending`, posted under the original `sessionId`) instead of dying with the app. A clean `end()` clears it (no re-send of completed sessions); a `savedAt` guard avoids wiping the live session's pending. Recovers an offline/killed phone's data (the launcher already had this via its beacon queue; the walk telemetry didn't).
7. **Flush POST timeout** — `_postTelemetry` now wraps native `fetch` in an `AbortController` (`POST_TIMEOUT_MS=12000`, < the 30 s interval) so a stalled shared-uplink connection fails fast and the buffer is retained for the next interval instead of hanging indefinitely (no default `fetch` timeout).

---

## Telemetry events (current code)

### GPS / lifecycle
`session_start`, `session_resume`, `session_restart_click`, `session_end`, `session_diag`, `parcours_restore`, `parcours_freshness_check`, `parcours_update_chosen`, `bg_geo_authorization`, `app_visibility`, `gps_lost`, `gps_recovered`, `gps_callback_gap`, `gps_state`, `gps_startup_fix`, `gps_startup_ready`, `gps_startup_rejected`, `gps_startup_fallback_offered` / `gps_startup_fallback_used` (P0.2b — rdv time-boxed best-effort start after the startup gate can't be met; carry `waited_ms`, `last_accuracy`, `last_reason`), `real_callback_freshness` (30 s, includes `cl_state` + `ios_stream_health` on iOS and `alarm_wake_stats` + `location_dispatch_stats` on Android), `ios_power_state` (60 s iOS), `bg_restrictions_recheck` (5 min Android, includes `memory_info` + `standby_bucket`), `power_state_at_parcours` (now includes `auto_revoke_whitelisted` on Android), `alarm_wake_stats` (30 s Android, bg-geo v2.8.0 P0.5 Fix 1e diagnostic), `location_dispatch_stats` (30 s Android, bg-geo v2.9.0 Architecture D: `{fusedAvailable, rawDelivered, rawKeepalive, fusedDelivered, fusedSuppressed, fusedStaleIgnored, lastDeliveredSource}`), `gps_quality_summary` (flush summary including `freshSamples`, `staleSamples`, `startupGradeSamples`). Each `bg-geo` location event now carries `dispatch_source` ∈ `{raw, raw-keepalive, fused}` and `is_keepalive` on Android (`is_keepalive` already on iOS via F-G4).

### Step / parcours
`step_fire`, `step_done`, `step_skip_done`, `step_implicit_done`, `step_audio_trigger` (carries `accuracy`, `consecutive_inside_samples`, `time_since_first_inside_ms`, `neighbor_distances`, `step_fire_latency_ms`), `step_resume_current`, `step_past_unload`, `step_voice_failed`, `step_afterplay_fallback`, `step_prewarm_next`, `parcours_store`, `accuracy_near_border` (when within 20 m), `voice_snapshot`, `voice_snapshot_skipped`, `user_lost`, `user_recovered`.

### Audio
`audio_play_requested`, `audio_play_started` (carries `load_duration_ms`), `audio_play_gate`, `audio_play_timeout`, `audio_play_stuck`, `audio_play_stuck_retry`, `audio_play_timeout_self_healed`, `audio_loaderror`, `audio_playerror` (both carry `error_type` ∈ {not_found, network, decode_failed, src_unsupported, timeout, stuck} **and `native_error_code`** = the raw Media3 `PlaybackException.errorCode` on ExoPlayer, so DECODER_INIT_FAILED vs DECODING_RESOURCES_RECLAIMED is distinguishable — the mapped 1–4 `error_code` collapses both to 4/`src_unsupported`, which masked the 2026-06-06 codec-exhaustion failure), `audio_uri_resolved`, `audio_playerror_retry`, `audio_engine_reset`, `audio_engine_reset_error`, `audiofocus_request_fail`, `audiofocus_keepalive_started`, `audiofocus_session_released`, `audio_route_changed`, `audio_session_state` (60 s). **Round 21:** `audio_uri_resolved` and `audio_loaderror`/`audio_playerror` now carry `backend` ∈ {`exoplayer`, `howler`, `howler-fallback`, `native`} so analyze.mjs can bucket post-rollout comparisons cleanly. On the ExoPlayer path the `error_code` 1–4 is derived natively from `PlaybackException.errorCode` (see `ExoPlayerInstance.mapToHowlerCode` — IO range → 2/4, parsing/decoder → 3, unknown → 4) so `classifyAudioErrorType()` in player.js produces the same `error_type` enum without changes.

### Operator / rearm
`rearm_button`, `rearm_pre_state`, `walk_end_shutdown`, `inter_session_idle_ms` (on `session_start`), `exoplayer_release_all` / `exoplayer_release_all_error` (Round 21; emitted before `audiofocus_session_released` in both walk-end A1 and rearm A3 paths so the ExoPlayer FG service ID 7375 tears down ahead of AudioFocusService ID 7374).

### Devices
Persistent fields in `session_diag`: `deviceUuid`, `isLoanDevice`, plugin-presence flags (`plugin_bgloc_getCLState`, `plugin_bgloc_getPowerState`, `plugin_bgloc_forceReacquire`, power-opt v0.2.0 methods).

---

## Validation Matrix (essential cases only)

### GPS and lifecycle
- Android 11+ fresh install: pick "While using app" first → `checkbgloc` must hard-block with Settings link; grant Always → auto-advance.
- Android with battery saver enabled → `IsPowerSaveMode` hard-block (R6.2).
- Samsung with "Apps en veille profonde" auto-add → tailored copy + Settings link.
- Mid-walk: revoke location auth → "Autorisation révoquée" overlay; re-grant → clears.
- Two `'stop'` bg-geo events within 5 min → battery-kill overlay with manufacturer-tailored copy.
- iPhone fresh install: deny motion → `checkmotion` hard-block + Settings link.
- iOS 26.3.x device → D1 red warning at `confirmgeo`.
- Lock phone in pocket for ≥10 min during parcours; resume after foreground/background transitions.

### Audio
- Audio continues after screen lock; resumes after phone call (AudioFocus).
- iOS: trigger Siri then dismiss → audio resumes (post-R5.3).
- Step transition: voice plays (not afterplay) on first entry; afterplay starts when voice ends.
- Lock for 2 min during voice → still playing on unlock.
- Background 5 min → AudioContext running, not suspended.
- Zone boundary walk for 30 s → no audio glitching / excessive load/unload.
- Vibration cues: GPS loss `[500,200,500]`; audiofocus loss `[300,150,300,150,300]`; audiofocus gain `[100,80,100]`.
- iOS: `httpToNativePath()` returns null → `checkaudio` hard-fails.
- Both: `AUDIOFOCUS === -1` (plugin disabled) → `checkaudio` hard-fails.
- Step with broken voice file → `step_voice_failed`, falls through to afterplay (P1.19).
- Step with broken/missing afterplay → `DEFAULT_AFTERPLAY_PLAYER` loop + `step_afterplay_fallback`.
- Kill mid-step, relaunch → `RESUME_PLAYER` plays once; voice resumes from saved position (P1.20 + P3.5 + A4).
- iOS double-kill in same step ~1 min apart → `parcours_restore.resumeStepVoicePos` matches most recent `parcours_store`.
- Force playerror on iOS → `audio_playerror_retry` fires once, recovers (C4).

### LOST state
- Walk >50 m off-route for >15 s → `#lost-band` + LOST_PLAYER loop + active step paused. Return to range → band clears, step resumes.
- Force-kill while LOST, relaunch → band reappears via `applyLostUI()`.
- Devmode tools "Forcer LOST" / "Sortir de LOST" exercise the handlers without walking.

### Data and startup
- Start route with no data link after preload.
- Reload mid-parcours → resume from correct step.
- Touch server parcours JSON mtime → app shows A6 update gate at `checkdata`.
- Rename one media file on the device → `media_integrity_check` reports `failed: 1`.
- RDV stays blocked until startup gate sees two distinct fresh fixes (`<=10 m`, `<=12 s`); warmup text should explain whether it is waiting on precision, freshness, or the second fix.
- iOS 26.3.x → D1 onboarding warning visible.

### Loan phones
- Devmode "Mark as loan" → `session_diag.isLoanDevice === true`.
- Rearm button → confirm modal → A1-style teardown → routes to `PAGE('rdv')` (A3).
- `rearm_pre_state` captured before teardown.
- `inter_session_idle_ms` on next session_start.

### Plugin / platform-specific
- Android 14+: FG service starts, type `mediaPlayback` declared.
- iOS: diagnostic suite T4/T8/T9 pass with NativeMediaPlayer.
- iOS foreground validation: `ios_stream_health` emitted beside `cl_state`, `shared_manager_created_on_main_thread=true`, and `real_location_count` increases while walking in foreground.
- iOS full locked-screen walk: voice triggers reliably from pocket, voice→afterplay seamless.

---

## Phase plan

### Phase 1A (shipped 2026-05-26) — JS-only
**Behaviour:** A4, A5, A6 (Round 8.5), A7 generic copy, C1 error classification, D1 iOS-version warning. **Diagnostic telemetry:** F-G2, F-A1, F-Z1, F-Z2, F-Z3, F-R1, F-R2, F-N3, F-K3, B4 freshness (no UI yet).

### Phase 1B partial (shipped 2026-05-26) — field-data-independent
R7.2 default-afterplay map gating, B1 past-step media unload, A6 parcours freshness gate, C2 passive media integrity.

### Phase 2 — plugin rebuild (shipped 2026-05-27, awaiting field validation)
- **G1** audiofocus v1.6.0 → v1.7.1 (Round 21): AF-1 channel description, AF-2 iOS deactivation order, AF-3 START_STICKY recovery, AF-4 power-save receiver, AF-5 iOS route-change events, AF-6 `getAudioSessionState`, AF-7 app icon. Plus `resetAudioSession()` + `releaseSession()` actions used by A1/A2/A3. **Round 21 added AF-8: `ExtraFocusListener` static API + fan-out in the OnAudioFocusChangeListener, allowing the new ExoPlayer plugin to register a reflective native handler that pauses ExoPlayer instances on AUDIOFOCUS_LOSS without a JS roundtrip (skips ducking — JS still owns DUCKED_PLAYERS — and skips auto-resume on GAIN — JS still owns PAUSED_PLAYERS).**
- **G2** power-opt v0.3.1: PO-1 LeTV intent fix, PO-2 `GetLastExitReasons`, PO-3 `GetMemoryInfo`, PO-4 `GetStandbyBucket`, PO-5 JSON booleans, PO-6 iOS stub, PO-7 Xiaomi MIUI autostart, PO-8 `skipProtectedAppCheck` guard, **PO-9 `IsAutoRevokeWhitelisted` + `RequestAutoRevokeWhitelist` (v0.3.1)**.
- **G3** bg-geo: v2.5.0 (BG-3 `getCLState`, BG-4 `getPowerState`, BG-7 keepalive flag re-assertion); v2.6.0 (BG-2 `forceReacquire`, BG-5 Android AlarmManager Doze keepalive, BG-10 iOS SLC auto-reacquire); v2.7.0 (F-G1 native auth callback, F-G3 keepalive `bg_task_id`, F-G4 `is_keepalive` flag so B4 watchdog fires correctly); v2.8.0 (BG-3 schema clarification — `hasLocation` + `locationTimestampAgeMs`; P0.5 Fix 1e diagnostic — `sAlarmFireCount` counter + `getAlarmWakeStats` CDV action); **v2.9.0 (Architecture D — `FusedLocationProviderHelper` parallel stream, native-side dedupe in `RawLocationProvider` with `STALE_RAW_MS=20s` / `MAX_FUSED_AGE=60s`, `dispatch_source` + `is_keepalive` fields propagated to JS, `getLocationDispatchStats` CDV action exposing counters)**.
- **G4 (Round 21, shipped 2026-05-28)** `cordova-plugin-exoplayer-simple` v0.1.1 — **NEW**: AndroidX Media3 (ExoPlayer 1.4.1) wrapper with a Howler-compatible JS surface. Architecture:
  - `MediaSessionService` (FG notification ID 7375, distinct from `AudioFocusService` ID 7374) hosts ONE persistent silent ExoPlayer (`REPEAT_MODE_ALL`, volume 0, BT-resistant `playWhenReady` auto-rearm) — maximum OEM trust without lock-screen UX.
  - Per-JS-Player ExoPlayer instances built with `handleAudioFocus=false` (audiofocus single-owner) + `WAKE_MODE_LOCAL` for Doze-safe playback.
  - `ExtraFocusListener` reflectively attached to audiofocus v1.7.1 → native pause on AUDIOFOCUS_LOSS / LOSS_TRANSIENT with no Cordova bridge roundtrip.
  - `setPlayWhenReady(true)` before STATE_READY is documented-safe → **structurally eliminates the Howler M4/P9 cold-load race** (A8 / A8b workarounds become dead code on the ExoPlayer path).
  - `PlaybackException.errorCode` mapped to the C1 1..4 enum so existing `classifyAudioErrorType()` produces clean `error_type` values.
  - JS shim provides 250 ms position polling via `getPosition(handle)` matching `NativeMediaPlayer._startPositionPoll` so `snapshotVoicePosition()` (`voice_snapshot` telemetry) keeps working unchanged.
- **H1 (Round 21; default flipped post-R24)** `AUDIO_BACKEND_ANDROID` flag in [player.js](www/app/assets/player.js) selects backend per-load: **default is `'exoplayer'`** (canary-only `'howler'` available by setting `window.AUDIO_BACKEND_ANDROID = 'howler'` before the first PlayerSimple load). `_backend` field threaded through `audio_uri_resolved` + `audio_loaderror` + `audio_playerror`. JS-level `SILENT_PLAYER` kept alongside the plugin's native silent player for parity safety; redundancy reconsidered after second clean field test.
- **R21-supporting** `FlanerieCordova/www/apputils.js` now populates `LOCALAPP_PATH_NATIVE` + `LOCALMEDIA_PATH_NATIVE` on Android too (was iOS-only) so ExoPlayer can read parcours media via `FileDataSource` directly instead of through the embedded WebView HTTP server.
- **R21-supporting** `releaseExoPlayerAll(source)` helper in [pages.js](www/app/pages.js) awaited (rearm A3) or fire-and-forget (walk-end A1) BEFORE `releaseAudiofocusSession` so the ExoPlayer FG service tears down ahead of AudioFocusService's. Telemetry: `exoplayer_release_all` / `exoplayer_release_all_error`.

### Phase 1B remainder (threshold tuning blocked on VILLEURBANNE data)
- **B4 / R27 startup + stalled-signal tuning** — startup gate and signal-state UI are shipped (`acquiring` / `frozen` / `lost`). Need `real_callback_freshness` distribution to tune the thresholds above the NSTimer floor (~20 s) and validate the <=10 m onboarding gate in the field.
- **E1/E2/E3 zone-overshoot gates** — accuracy-gated step entry. Need `accuracy_near_border` distribution.

### Phase 3 — deferred, conditional
- **B3 / BG-6** ✅ **Closed by v2.9.0 Architecture D** (Raw-primary parallel with Fused fallback). No OEM allowlist; fail-soft on no-GMS.
- **C6b** Android `NativeMediaPlayer` migration — **superseded by Round 21 G4 ExoPlayer plugin**; no longer needed.
- **P3.5 Plan B/C** native `getCurrentPosition()` during GPS tasks / native plugin save on lifecycle — only if `voice_snapshot` shows iOS position-staleness after Phase 1B.
- **R21-followup Howler retirement** — remove the Howler branch from `PlayerSimple.load()` and drop `Howler.autoUnlock` / `Howler.autoSuspend` after the second clean field test on the ExoPlayer backend. Until then, both backends ship; default toggle via `AUDIO_BACKEND_ANDROID`.

### Conditional / accepted / low-priority
- **P0.2** background validation UX (kept bypassed).
- **P1.7** resume/version-safe state.
- **P1.15** GIVORS_V3 last-step investigation (requires server-side JSON).
- **C3** launcher cache-buster regex.
- **C4** full container build checklist write-up.

---

## iOS native plan (R22–R26) — settled design decisions

Five workstreams shipped between Round 22 and Round 26 to bring iOS to Android-level resilience for a 45-min pocket-locked GPS-triggered walk. The plan mirrored the two big Android moves done since GIVORS — ExoPlayer for audio (Round 21) and Architecture D Raw+Fused GPS (Round 20) — with iOS equivalents.

| Workstream | Description | Shipped in |
|---|---|---|
| **H** | GPS rail of CLCircularRegion wake-ups | bg-geo v2.10.0 (R23) |
| **I.A** | Plugin rename `exoplayer-simple` → `audio-simple` | audio-simple v0.2.0 (R24) |
| **I.B** | iOS native audio engine (AVAudioPlayer pool + AVAudioSession singleton) + audiofocus iOS shrink | audio-simple v0.3.0 + audiofocus v1.9.0 (R25) |
| **J** | MPNowPlayingInfo + MPRemoteCommandCenter all-disabled | audiofocus v1.8.0 (R22), migrated to audio-simple v0.3.0 (R25) |
| **K** | NSUserDefaults step-state cache | audiofocus v1.8.0 (R21), migrated to audio-simple v0.3.0 (R25) |
| **L** | iOS CLVisit monitoring for telemetry | bg-geo v2.11.0 (R26) — scope reduced to visit events only |

### Settled decisions

| # | Decision | Settled outcome | Why |
|---|---|---|---|
| 1.A | Rail layout source | Transition midpoints (between consecutive step centroids), 16 circles @ 100 m radius | Centroid-on-step would fire too late (inside the zone); midpoints sit at the far edge of the preceding step so the rail wakes the OS ~100 m before the next boundary check. 17 contiguous steps → 16 transitions, under the iOS 20-region app-wide limit. |
| 1.B | Static vs dynamic rail | Static — register all 16 at parcours start | DEV-mode assertion fires if `region_count > 20`. Dynamic sliding window adds complexity without enabling any current parcours length. |
| 1.C | `_doForceReacquire` throttle | 10 / session, gated by real-callback stall > 30 s | Previous 3 / session was sized for the JS-side B4 watchdog; rail can legitimately fire 16 times in a walk, so 3 would be exhausted in the first quarter. The 30 s gate prevents thrashing during transient signal loss. |
| 1.D | Rail entries nudge the audio layer? | No | Audio is owned by audio-simple; coupling adds surface area. The rail's job is GPS only. |
| 2.A | Plugin home for native iOS audio | Option A — rename `cordova-plugin-exoplayer-simple` → `cordova-plugin-audio-simple`; AVAudioSession ownership migrates there | One JS API across both platforms (`cordova.plugins.audio`), native-per-platform. Renamed and shipped phase-by-phase in R24 + R25. |
| 2.B | bg-geo → audio cross-plugin call | Option B — JS-mediated; region-wake is wakeup-only, not a trigger | Region-wake events fire ~100 m before a zone boundary so they cannot serve as actual step triggers anyway. Audio never starts directly from a region wake — only from a fresh real CLLocationManager callback through the existing JS zone-check. Keeps bg-geo and audio-simple decoupled at the ObjC level. |
| 2.C | Audio migration strategy | Single cutover — `AUDIO_BACKEND_IOS='audio-simple'` default; `'native-media'` for emergency rollback | `PlayerSimple` gains a new branch ahead of legacy NativeMediaPlayer; emergency rollback via window flag override. `_backend` field on `audio_uri_resolved` / `audio_*error` events buckets post-rollout comparisons. |
| 5 | Workstream L scope | Visit events only — CLMonitor proper deferred indefinitely | Scope reduced at implementation time. `startMonitoringVisits` has been in CoreLocation since iOS 8, so the telemetry value Decision 5 Option B was after is available via the legacy `CLLocationManagerDelegate` path — no Swift bridge, no iOS-17 version branch, ~50 LOC. CLMonitor proper offers cleaner async lifecycle but no observable benefit over the existing legacy region API. |

### What the iOS plan does *not* fix

Explicitly listed so we don't oversell — these remain open even after R22–R26:

- **E1/E2/E3 zone-overshoot gates** still need VILLEURBANNE `accuracy_near_border` data. Rail regions are too coarse to address border-overshoot; visit events may eventually feed a step-confirm signal but need correlation data first.
- **iOS 26.3.x intrinsic OS bug** — if Apple genuinely broke `startUpdatingLocation` in 26.3.1, the rail gives us a forcing function via `_doForceReacquire`, but it does not *guarantee* the next fix arrives quickly. Recovery is still OS-bounded.
- **Audio file integrity issues** (S2 root cause partly open) — the native engine eliminates per-Media reallocation churn but won't fix corrupt downloads. C2 integrity check + C4 retry still own that.

### Workstream coexistence

The R25 cutover left some intentional redundancy worth flagging:

- **Both `cordova-plugin-audiofocus` AND `cordova-plugin-audio-simple` call `setActive` on AVAudioSession.** audiofocus iOS kept its session-lifecycle methods (`startKeepalive`, `releaseSession`, `resetAudioSession`, `requestFocus`, `cancelFocus`, `stopKeepalive`) as a redundant defensive activation alongside audio-simple's lazy activation. Both reach the AVAudioSession singleton; idempotent and harmless. Single ownership migration was intentionally avoided to keep R25 surgical.
- **NSUserDefaults key names preserved across the R21→R25 migration** (`flanerie_resume_stepId/SeekPos/PID/SavedAt`) so a build upgrading from audiofocus@1.8.0 to audio-simple@0.3.0 keeps any visitor resume snapshot intact.
- **`AUDIO_BACKEND_ANDROID` flag values retained** (`'howler'`, `'exoplayer'`) — `'exoplayer'` still accurately names the Android backend tech under the renamed plugin.

### Validation telemetry to look for at VILLEURBANNE

1. `nowplaying_setup` fires at parcours entry; lock-screen tile shows title with disabled controls
2. `audio_uri_resolved.backend='audio-simple'` on every iOS step audio load
3. `resume_native_override` or `resume_snapshot_check` fires after every `parcours_restore`
4. `gps_rail_configured` fires once per parcours entry with `region_count = step_count − 1`
5. `gps_rail_wake.did_force_reacquire=true` correlates with `real_callback_freshness` stalls on iOS 26.3.x devices (S1 failure mode)
6. `gps_visit_event` fires during natural step lingering — cross-check `arrival_date` / `departure_date` against `voice_snapshot` step timing
7. A 45-min walk completes pocket-locked end-to-end without manual intervention

---

## What the next field test should produce

**Job 1 — passive diagnostic harvest** (any device, any walk):
- `real_callback_freshness` cadence → unblocks B4 threshold.
- `accuracy_near_border` distribution → unblocks E1/E2/E3 calibration.
- `audio_play_started.load_duration_ms` → R4.1 outlier device identification.
- `step_resume_current.consecutive_inside_samples` → false re-arm rate.
- `media_integrity_check` → baseline fleet integrity.
- `getLastExitReasons` on Android resumes → root-cause kill mechanism.

**Job 2 — validate behaviour fixes shipped in Round 8 / 8.5 / G1 / Round 16–18:**
- A4: `step_audio_trigger` carries no stale `resume_seek_pos`.
- A8 + A8b: no `audio_play_stuck` / `audio_play_timeout` at first BLOC_01 fire on first-install Android.
- A3 rearm: `rearm_pre_state` + `walk_end_shutdown` + `audiofocus_session_released` + clean `PAGE('rdv')` chain.
- C1: every `audio_playerror` / `audio_loaderror` carries `error_type` (no `"[object Object]"`).
- C4: `audio_playerror_retry` fires on forced playerror; recovers.
- D1: iOS 26.3.x → red warning at `confirmgeo`.
- C2: healthy device → `media_integrity_check.failed: 0`; rename one file → `failed: 1`.
- A6: server-side mtime change → app shows update gate.
- B1: `step_past_unload` at each transition; no audio glitches on LOST → recover.
- B4 watchdog (iOS): `ios_gps_reacquire_attempt` fires after a 60 s real-callback stall; `ios_gps_reacquire_recovered` follows.
- G3 v2.7.0: `is_keepalive: true` on NSTimer ticks; `real_callback_freshness.real_callback_age_ms` no longer reset by keepalive.

**Minimum device set:** 1 iOS device (ideally 26.3.x) for ~20 min + 1 Android device for ~15 min. That unblocks B4 and E1/E2/E3 calibration. The remaining shipped items validate from the same sessions.

---

## Priority items (still tracked under their numbered IDs)

Numbered items are kept here for traceability between this doc and the GIVORS report. All entries below this line are either **shipped** (most cases) or open with a clear status.

### P0 — Production blockers
- **P0.1** Geolocation stationary handler churn — ✅ DONE.
- **P0.1b** AudioContext resume on foreground — ✅ DONE (2026-04-27).
- **P0.2** Background validation UX — bypassed by design; not a blocker.
- **P0.3** Notification strategy — ✅ PARTIAL (chain disabled, foreground service handles keepalive).
- **P0.4** Plugin guards — ✅ ROLLING (superseded by per-fork fixes).
- **P0.5** Background-geolocation fork — ✅ now v2.12.0 (BG-2..BG-13 + P0.5 Fix 1e diagnostic + Architecture D + iOS rail/visit telemetry shipped).

### P1 — Correctness and stability (all shipped)
P1.5, P1.5b, P1.5c, P1.6, P1.8 (folded into P1.25), P1.10, P1.11, P1.11b, P1.12, P1.13, P1.14, P1.16, P1.17, P1.18, P1.19, P1.20, P1.21, P1.22, P1.23, P1.24, P1.25, P1.26, P1.27, P1.28, P1.29, P1.30, P1.32 (DEFERRED, low), P1.33 (Android GPS cold-start NETWORK_PROVIDER — ✅), P1.34 (closed by D3+B4+G3 v2.7.0).

**Open under P1:** P1.7 resume/version-safe state (low), P1.15 last-step cutoff (requires parcours JSON review), P1.31 / R4.3 Android Doze (closed by BG-5 native AlarmManager — pending field validation).

### P2 — Supportability and observability (all shipped or low-priority)
P2.9, P2.10, P2.11, P2.12, P2.13, P2.14, P2.15 / P3.5b voice-snapshot lifecycle — all ✅.

### P3 — Platform-specific
- **P3.1** iOS background audio entitlement — ✅ VERIFIED.
- **P3.2** iOS location permission progression — ✅ DONE + hardened.
- **P3.3** Android 14+ FG service type — ✅ VERIFIED.
- **P3.3b** Android `ACCESS_BACKGROUND_LOCATION` hard-block — ✅.
- **P3.3c** iOS motion permission hard-block — ✅.
- **P3.3d** Mid-walk authorization + services monitoring — ✅.
- **P3.4** iOS NativeMediaPlayer (locked-screen GPS-triggered start) — ✅.
- **P3.5** Voice-position resume across app restart — ✅ PARTIAL; full validation pending. P3.5 Plan B/C in Phase 3 if needed.
- **P3.6** Structural refactors — ✅ PARTIAL.

### C — Cordova container
- **C1 / C1b** Audiofocus plugin + `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` — ✅.
- **C2** Platform/plugin upgrades — ✅ DONE.
- **C3** Launcher cache-buster regex — low priority, accepted.
- **C4** Container build checklist — ✅ DONE (full write-up still open as a deliverable).
- **C5** Power optimization fork — ✅ v0.3.1 shipped. `IsAutoRevokeWhitelisted` / `RequestAutoRevokeWhitelist` landed in PO-9.
- **C6** Audiofocus iOS interruption without ShouldResume — ✅ DONE (Round 5.3).
- **C7** Server resilience — ✅ PARTIAL.

---

## GIVORS follow-up rounds (chronological, condensed)

For the analytical context behind these rounds see `20260520-GIVORS-report.md`. The remediation plan that drove them is consolidated in this document above (Workstream A–G).

| Round | Date | Layer | Items shipped |
|---|---|---|---|
| 7 | 2026-05-20 | analysis | P1.34, R7.1, R7.2, R7.3 identified + telemetry analysis tooling R7.0 |
| 8 / Phase 1A | 2026-05-26 | JS | A4, A5, A6 (R8.5), A7, C1, D1, B4-diag + F-G2/A1/Z1/Z2/Z3/R1/R2/N3/K3 |
| 8.5 / Phase 1B partial | 2026-05-26 | JS | R7.2, B1, A6 freshness gate, C2 |
| 9 | 2026-05-27 | plugin | power-opt v0.2.0 (PO-1..PO-8) |
| 10 | 2026-05-27 | plugin | audiofocus v1.6.0 (AF-1..AF-7) |
| 11 | 2026-05-27 | JS | wiring for AF v1.6.0 + PO v0.2.0 + F-A2/A3/K3 enrichment |
| 12 | 2026-05-27 | plugin | bg-geo v2.5.0 (BG-3 `getCLState`, BG-4 `getPowerState`, BG-7 keepalive flag) |
| 13 | 2026-05-27 | plugin | bg-geo v2.6.0 (BG-2 `forceReacquire`, BG-5 AlarmManager Doze, BG-10 SLC auto-reacquire) |
| 14 | 2026-05-27 | JS | wiring for bg-geo v2.5.0/2.6.0 + B4 forceReacquire watchdog |
| 15 | 2026-05-27 | JS | A8 Howler cold-load deferred play (closes R4.1) |
| 16 | 2026-05-27 | JS | C4 playerror retry + A1/A3 lifecycle cleanup |
| 17 | 2026-05-27 | JS | A8b SAS step 0 pre-warm |
| 18 | 2026-05-27 | plugin | bg-geo v2.7.0 (F-G1 auth callback, F-G3 `bg_task_id`, F-G4 `is_keepalive`) |
| 19 | 2026-05-27 | post-verification | A2 event renamed `audio_engine_reset`; A3 `releaseSession` promisified + awaited before reset; bg-geo v2.8.0 (BG-3 schema fix + P0.5 Fix 1e diagnostic counter + `getAlarmWakeStats`); power-opt v0.3.1 (PO-9 `IsAutoRevokeWhitelisted` / `RequestAutoRevokeWhitelist`); webapp `alarm_wake_stats` + `auto_revoke_whitelisted` wiring |
| 20 | 2026-05-27 | plugin | bg-geo v2.9.0 — Architecture D: Raw-primary with Fused fallback. New `FusedLocationProviderHelper` (FLP, fail-soft on no-GMS); dedupe state machine in `RawLocationProvider` (`_lastRawFreshMs`, suppress Fused when Raw < 20 s, ignore Fused fixes > 60 s old); `BackgroundLocation` propagates `dispatch_source` (`raw` / `raw-keepalive` / `fused`) + `is_keepalive` to JS; `getLocationDispatchStats` CDV action; geoloc.js recognises `dispatch_source='fused'` as a distinct source. Closes B3 / BG-6 without conditional OEM allowlist. |
| 21 | 2026-05-28 | plugin + JS | **NEW plugin `cordova-plugin-exoplayer-simple` v0.1.1** (AndroidX Media3 1.4.1, MediaSessionService FG ID 7375, persistent silent ExoPlayer for OEM trust, per-instance ExoPlayer with `handleAudioFocus=false` + `WAKE_MODE_LOCAL`, Howler-compatible JS shim with 250 ms position polling). **audiofocus v1.6.0 → v1.7.1** adds `ExtraFocusListener` static API + fan-out so the new plugin pauses ExoPlayer natively on AUDIOFOCUS_LOSS without a JS roundtrip. **webapp:** `AUDIO_BACKEND_ANDROID` flag (default `'howler'`, flip to `'exoplayer'` after first clean field test) + `_backend` field on `audio_uri_resolved` / `audio_*error`. **FlanerieCordova:** `apputils.js` populates `LOCALAPP_PATH_NATIVE` / `LOCALMEDIA_PATH_NATIVE` on Android (so Media3 reads via `FileDataSource`, bypassing the embedded WebView HTTP server). **Teardown:** `releaseExoPlayerAll(source)` awaited / fire-and-forget BEFORE `releaseAudiofocusSession` at rearm (A3) and walk-end (A1). **Workflow:** new sibling fork wired into `scripts/sync-workspace-plugins.mjs` + `scripts/validate-container.mjs`; new `plugin-upgrade` skill documents the four-fork sync flow. Structurally closes Howler M4/P9 cold-load race on the new backend. Awaiting `cordova build android` Gradle/Media3 resolution check + VILLEURBANNE side-by-side field validation. |
| 22 | 2026-05-28 | plugin + JS | **iOS native plan §3-§4 (K + J): audiofocus v1.7.1 → v1.8.0.** **K — native step-state cache (iOS):** new `setResumeSnapshot` / `getResumeSnapshot` / `clearResumeSnapshot` CDV actions backed by `NSUserDefaults` (keys `flanerie_resume_stepId/seekPosSec/pID/savedAtMs`). `parcours.store()` dual-writes `resumeStepVoicePos` after `localStorage.setItem`; new `state.lastUpdatedMs` stamp enables freshness comparison. `parcours.restore()` calls `_checkNativeResumeSnapshot()` asynchronously after `build()`; on `pID+stepId` match with `nativeSavedAtMs > lsUpdatedMs + 1000`, overrides `resumeStepVoicePos` and emits `resume_native_override` telemetry. New events: `resume_native_override`, `resume_snapshot_check`, `resume_snapshot_mismatch`. `clearStore()` also clears the native snapshot — A1 walk-end keeps state (design), A3 rearm + A6 update-gate + invalid-restore paths clear both stores. **J — MPNowPlayingInfo + MPRemoteCommandCenter (iOS):** new `setupNowPlaying` / `clearNowPlaying` CDV actions. `MediaPlayer.framework` added to `plugin.xml`. All 17 remote-command center commands explicitly `enabled = NO` AND given a no-op handler returning `MPRemoteCommandHandlerStatusCommandFailed` (belt-and-braces against iOS routing presses through). Lock-screen tile shows `PARCOURS.info.name` (fallback "Flânerie") + "Marche guidée"; hardware volume buttons remain functional (system-level, not overridable). Wired in webapp from the parcours-entry `startKeepalive` site and the parcours-cleanup `stopKeepalive` site. New events: `nowplaying_setup`, `nowplaying_cleared`, `nowplaying_error`. iOS-only — Android no-ops because exoplayer-simple's FG service handles the media session. Awaiting iOS device build/test. |
| 23 | 2026-05-28 | plugin + JS | **iOS native plan §1 (H, settled): bg-geo v2.9.1 → v2.10.0 — BG-11 GPS rail of wake-up CLCircularRegions.** Pure wakeup mechanism: when CLLocationManager standard updates stall in deep background (iOS-26-class blackouts at GIVORS S1/M1), the OS itself fires region-boundary callbacks even from suspended state. Native handler calls `_doForceReacquire` (D3 path) if real callbacks have been silent >30 s and the per-session cap (raised 3→10) is not exhausted, opens a `beginBackgroundTask` to extend the wake window, then emits a `region_wake` event for telemetry. JS-side polygon zone-check stays in charge of fine-grained step audio — region wakes never trigger audio (Decisions 1.D + 2.B in §iOS native plan settled-design-decisions). **Plugin layout:** `MAURProviderDelegate` gains `@optional - (void)onRegionWake:(NSDictionary*)payload`. `MAURRawLocationProvider` adds `_railManager` (separate CLLocationManager), `_railRegions` (NSMutableArray of CLCircularRegion), public `configureRail:`/`clearRail`, and `didEnterRegion:`/`didExitRegion:`/`monitoringDidFailForRegion:` delegate methods. Throttle: `FORCE_REACQUIRE_CAP=10`, `FORCE_REACQUIRE_GATE_S=30.0` enforced both for region-driven and SLC-driven (BG-10) reacquires. `MAURBackgroundGeolocationFacade` exposes `configureRail:` / `clearRail` (forwarded to Raw provider when active) and an `onRegionWake:` passthrough. `CDVBackgroundGeolocation` adds matching CDV actions and surfaces `region_wake` via existing event-listener channel. **JS bridge:** `BackgroundGeolocation.configureRail(regions)` / `clearRail()` + `region_wake` added to events whitelist. **Webapp:** `computeGpsRail(parcours)` returns the transition-midpoint rail (one circle per consecutive step-centroid pair, 100 m radius, ids `rail_<i>_<i+1>`). Wired from `PAGES['parcours']` entry (after `setupNowPlaying`) and `PAGES_CLEANUP['parcours']` (after `clearNowPlaying`). Subscribes to `region_wake` for telemetry. New events: `gps_rail_configured` (region_count, rail_radius_m, step_count), `gps_rail_wake` (region_id, event, last_real_callback_age_ms, did_force_reacquire, force_reacquire_count, app_state, bg_task_id), `gps_rail_cleared`, `gps_rail_configure_skipped`, `gps_rail_configure_warn`, `gps_rail_configure_error`, `gps_rail_clear_error`. iOS-only — Android errbacks the actions silently; webapp gates calls on `PLATFORM === 'ios'`. Awaiting iOS device build/test (regions auth dialog must accept). |
| 24 | 2026-05-28 | plugin + JS + tooling | **iOS native plan §2 phase 1 (I.A, settled): rename `cordova-plugin-exoplayer-simple` → `cordova-plugin-audio-simple` @ 0.2.0.** Pure mechanical rename — Android behaviour bytes-identical. Plugin id, display name (`AudioSimple`), JS clobber (`cordova.plugins.audio`), JS file (`www/AudioSimple.js`), JS `SERVICE` constant (`'AudioSimple'`), Cordova feature name (`AudioSimple`), Java entry-point class (`AudioSimplePlugin`) and file (`src/android/AudioSimplePlugin.java`) all renamed. Intentionally retained: Java package `com.maigre.cordova.plugins.exoplayer.*`, internal classes `ExoPlayerInstance` / `ExoPlayerService` / `UriResolver`, Android FG service component name (would invalidate installs), resource files `exoplayer_silent.mp3` / `exoplayer_strings.xml` — ExoPlayer is literally the underlying Android tech. **FlanerieCordova:** devDeps + `cordova.plugins` spec updated; `scripts/sync-workspace-plugins.mjs` registry pluginConfigs entry renamed; `scripts/validate-container.mjs` expected map updated; `www/apputils.js` comment refreshed. **Workspace:** plugin-upgrade skill `tracked-forks` table updated. **Webapp:** every `cordova.plugins.exoplayer.*` reference replaced with `cordova.plugins.audio.*` (3 files: player.js, diagnostic.js, pages.js); helper `releaseExoPlayerAll` renamed to `releaseAudioPluginAll`; telemetry events `exoplayer_release_all` / `exoplayer_release_all_error` renamed to `audio_plugin_release_all` / `audio_plugin_release_all_error` (analyzer-visible rename — historical events stay under the old name). `AUDIO_BACKEND_ANDROID` flag values retained (`'howler'`, `'exoplayer'`) since `'exoplayer'` still accurately names the Android backend tech. iOS native engine + JS cutover + audiofocus iOS shrink land in Round 25. |
| 25 | 2026-05-28 | plugin + JS | **iOS native plan §2 phase 2 (I.B, settled): audio-simple v0.2.0 → v0.3.0 + audiofocus v1.8.0 → v1.9.0.** Native iOS audio engine lands; audiofocus iOS surface shrunk. **audio-simple iOS:** new `src/ios/AudioSimpleSession.h/.m` (AVAudioSession singleton owner: setCategory:Playback / setActive; reset path with 100 ms settle delay for the A2 audio-engine-reset code; MPNowPlayingInfoCenter + MPRemoteCommandCenter with all 18 commands `enabled=NO` + no-op CommandFailed handlers — migrated from audiofocus R22; NSUserDefaults step-state cache with `kResumeKeyStepId/SeekPos/PID/SavedAt` — key names preserved across migration). New `src/ios/AudioSimplePlayer.h/.m` (per-handle AVAudioPlayer wrapper: prepareToPlay prefetch, native NSTimer fade at ~50 fps, position polling via `currentTime` getter, `numberOfLoops=-1` infinite loop matching cordova-plugin-media P3.4 behaviour, AVAudioPlayerDelegate emits load/play/pause/stop/end/playerror to plugin → JS). New `src/ios/AudioSimplePlugin.m` (CDV dispatcher mirroring Android shape: per-player NSMutableDictionary keyed by NSNumber handle; long-lived events callback via `subscribeEvents`; iOS-specific actions: `setupNowPlaying`, `clearNowPlaying`, `setResumeSnapshot`, `getResumeSnapshot`, `clearResumeSnapshot`, `activateSession`, `deactivateSession`, `releaseSession`, `resetSession`, `getSessionState`). `plugin.xml` gains iOS platform block: AVFoundation + MediaPlayer frameworks, feature `AudioSimple` → `AudioSimplePlugin`. **www/AudioSimple.js:** iOS-only surface exposed via `cordova.plugins.audio.{activateSession,deactivateSession,releaseSession,resetSession,getSessionState,setupNowPlaying,clearNowPlaying,setResumeSnapshot,getResumeSnapshot,clearResumeSnapshot}`. **audiofocus iOS shrink:** removed setupNowPlaying / clearNowPlaying / setResumeSnapshot / getResumeSnapshot / clearResumeSnapshot from `AudioFocus.m` + `www/AudioFocus.js`; dropped `<framework src="MediaPlayer.framework"/>` from `plugin.xml`. Session lifecycle methods (requestFocus / cancelFocus / startKeepalive / stopKeepalive / resetAudioSession / releaseSession) intentionally kept as a redundant defensive activation — both plugins call setActive on the AVAudioSession singleton; idempotent and harmless. Interruption observer + route observer retained for AUDIOFOCUS_LOSS/GAIN/ROUTE_CHANGED telemetry. **Webapp:** new `AUDIO_BACKEND_IOS` flag (default `'audio-simple'`; `'native-media'` for emergency rollback to cordova-plugin-media via NativeMediaPlayer). `PlayerSimple` (player.js) gains an iOS `audio-simple` branch upstream of the legacy NativeMediaPlayer branch; `Diagnostic._makeTestPlayer` mirrored. All five migrated method call sites flipped from `cordova.plugins.audiofocus.*` to `cordova.plugins.audio.*` (pages.js setupNowPlaying/clearNowPlaying; parcours.js setResumeSnapshot in `store()`, getResumeSnapshot in `_checkNativeResumeSnapshot()`, clearResumeSnapshot in `clearStore()`). `_backend='audio-simple'` field on `audio_uri_resolved` / `audio_*error` events buckets post-rollout comparisons. iOS native engine + JS cutover live behind the flag — awaiting iOS device build/test. |
| 26 | 2026-05-28 | plugin + JS | **iOS native plan §5 (L, scope reduced): bg-geo v2.10.0 → v2.11.0 — BG-12 CLVisit monitoring for telemetry.** Per Decision 5 Option B, scoped down at implementation time to visit events only — CLMonitor proper deferred indefinitely (Swift bridge complexity not justified given legacy API works and `startMonitoringVisits` has been in CoreLocation since iOS 8). **Plugin layout:** `MAURRawLocationProvider` adds `_visitManager` (separate `CLLocationManager` so visit delegate callbacks land here with a known sender identity) + `startMonitoringVisits` lifecycle in `onStart:` / `onStop:`. New `locationManager:didVisit:` delegate emits CLVisit data with Apple's `distantFuture` departure sentinel translated to `departure_known=false`. `MAURProviderDelegate` gains `@optional - (void)onVisit:(NSDictionary*)payload`. `MAURBackgroundGeolocationFacade` adds an `onVisit:` passthrough; `CDVBackgroundGeolocation` surfaces it as a `visit` event via the existing addEventListener channel. **JS bridge:** `visit` added to events whitelist. **Webapp:** `geoloc.js` subscribes to visit events and logs `gps_visit_event` (latitude, longitude, horizontal_accuracy_m, arrival_date ISO 8601, departure_date ISO 8601 or null, arrival_age_ms, departure_known). iOS-only — Android Lifecycle delegate is not implemented. Telemetry observation-only — never triggers step audio. VILLEURBANNE data will measure whether visit detection correlates with step dwell time (e.g. step 4 "choice step" lingering case from FLANERIE_ELYSEE audit) before considering it as a future step-confirm signal. |

---

## Earlier rounds (chronological, condensed)

| Round | Date | Items shipped (✅) |
|---|---|---|
| 1 | through 2026-05-13 | P1.18 LOST state machine, P1.19 voice/afterplay fallback, P1.20 RESUME cue, P1.21 AUDIOFOCUS auto-retry, P1.22 devmode tools page, P1.11b audio stack hardening, P3.3b/c/d, P3.4 iOS NativeMediaPlayer |
| 2 | 2026-05-14 | P1.23 resume `update()` gate, P1.24 init listener cleanup, P1.25 LOST↔afterplay unification + P1.8 fold-in, P1.26 GPS stop on walk end, P1.27 duplicate `step_done` guard, P1.28 page-exit cleanup, P1.29 recovery map on default-afterplay, P2.12 defensive cluster, P2.13 telemetry session key, P2.14 resume gate fast-path, P3.6 refactors, C7 server resilience |
| 3 | 2026-05-18 (FRAPPAZ field test) | P1.30 off-route popup title, P2.15 / P3.5b voice-snapshot lifecycle telemetry, P1.31 Android Doze repro confirmed, P1.32 launcher network sensitivity (DEFERRED low) |
| 4 | 2026-05-18 | R4.2 parcours_restore + session_resume payload, R4.4 audio_play_timeout truth check + retry, R4.5 voice_snapshot truth fields, R4.6 GPS gap threshold tuning, R4.7 step_voice_failed step-name, R4.8 user_recovered distance clamp, R4.9 voice_snapshot_skipped throttling. R4.1 + R4.3 deferred (closed in Rounds 13 + 15) |
| 5 | 2026-05-19 | R5.1 audiofocus mediaPlayback FG service keepalive, R5.2 power-opt `IsBackgroundRestricted`, R5.3 iOS interruption-without-ShouldResume, R5.4 store-submission polish |
| 6 | 2026-05-19 | R6.1 `checkbatteryopt` OS-version-vs-API-level fix, R6.2 `IsPowerSaveMode` hard block, R6.3 diagnostic telemetry at parcours entry |

---

## FLANERIE_ELYSEE-specific audit (one-off checklist)

- Verify every referenced step folder under `media/flanerie_elysee_v5/` exists.
- Verify every referenced media file exists.
- Walk through published step order manually.
- All steps `optional: false` — the inverted optional/mandatory logic bug at `spot.js:628` is dormant on this parcours; track before sequencing changes.
- `cutoff: 7` — verify it's long enough for the last block.
- Polygon overlaps BLOC_07→08, BLOC_08→09 are tight — verify no double-trigger.
- "Je suis perdu.e !" map without tile cache (currently disabled).
- `www/app/images/` MP3 fallbacks (`afterplay`, `resume`, `youlost`) ship as `_`-prefixed placeholders; operator renames to enable.

---

## Field test archive — GIVORS (2026-05-20)

**Sessions:** 110 files · ~43 meaningful visitor sessions (16 clean completions, 21 completed with friction, 5 GPS-incomplete, 1 abandoned, ~51 excluded/operator).

**Significant issues found and fixed (all shipped by Round 21):**
- **S1** iOS 26.3.1 GPS multi-gap regression (8–14 min blackouts) — `51nv, ibk6, mq3z`. Fixed: D1 warning + D3/D4/D5 native reacquire + B4 watchdog + H GPS rail (bg-geo v2.6.0–v2.10.0).
- **S2** Audio narration failures (load + playback errors, ≥14 distinct files) — `wjfo, vigi, rumx, mq3z, 0vvc`. Fixed: C1 error classification + C2 integrity check + C4 retry.
- **M2** `step_resume_current` double-resume / zone-border overshoot — `yapj` ×4, `189t` ×3, `19dh` ×3, others. **E1/E2/E3 pending VILLEURBANNE `accuracy_near_border` data.**
- **M3** Silent audio on loan-phone re-arm (SM-A515F). Fixed: A1/A2/A3.
- **M4/P9** Howler cold-load race on first-install Android (4 restart-pairs). Fixed: A8/A8b; structurally closed by ExoPlayer backend (Round 21 G4).
- **m1** Android OEM kill / resume (~20 sessions, heaviest `f743` ×7). Fixed: B1 + BG-5 AlarmManager + Architecture D (bg-geo v2.9.0) + ExoPlayer FG service (Round 21).
- **m2** iOS audiofocus fail flood (4929 events fleet-wide, never walk-breaking). Fixed: G1 audiofocus_session_reset path.
- **P8** Stale seek-position on iOS crash resume (`rumx`). Fixed: A4.
- **§11** Build / parcours-config skew (two webapp hashes, 18-step vs 17-step stale cache). Fixed: A6 freshness gate.

**Open items from this test (all require VILLEURBANNE data — no code pending):**
- B4 UI freeze-band threshold (`real_callback_freshness` distribution)
- E1/E2/E3 zone-overshoot gate thresholds (`accuracy_near_border` distribution)
- Architecture D validation (`location_dispatch_stats` — confirm Fused saves the day on restrictive OEMs)
- P0.5 Fix 1e JS-suspended-despite-alarm pattern (`alarm_wake_stats`)
- ExoPlayer vs Howler side-by-side (`audio_play_stuck` / `audio_loaderror` rates; `backend` field is the bucket key)

Full session tables, device breakdown, and issue analysis: [archive/20260520-GIVORS-report.md](archive/20260520-GIVORS-report.md).

---

## Fixed bugs archive (non-numbered)

- **iOS html5 seek/fade limitations** — resolved by NativeMediaPlayer migration (P3.4); `Media.seekTo()` reliable.
- **Dual silent players** — `testplayer` removed from parcours page, now scoped to `checkaudio` only.
- **Console.log HTML injection** — `$('<span>').text()` helper.
- **`PlayerSimple._playRequested` stuck** — reset in `loaderror`/`playerror` handlers; 15 s safety timeout.
- **Zone audio boundary thrashing** — `UNLOAD_EXTRA_HYSTERESIS = 10 m` dead-band.
- **Audio loaderror infinite re-fire** — `PlayerStep.hasError()` + near-reload guard in `Spot.updatePosition()`.
- **GPS drift re-fire during loading** — `_active` flag in `Step`; `step_refire_blocked` telemetry.
- **`step_skip_done` spam** — `_skipDoneLogged` flag.
- **`allSteps` global leak** — `allSteps = []` in `Parcours.clear()`.
- **`paused is not a function` on step stop** — `_isUnderlyingPaused()` helper.
- **Trivial code fixes (2026-03-14):** P1.9a `setCoords()` ignored param, P1.9b `checkBGPosition()` wrong `this`.
