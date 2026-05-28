# Mobile Audit & Remediation Plan

**Original:** 2026-04-27
**Last updated:** 2026-05-28 (Round 21: cordova-plugin-exoplayer-simple v0.1.1 + audiofocus v1.7.1 cross-plugin focus listener)
**Scope:** Cordova launcher (FlanerieCordova) + downloaded local webapp (FlanerieAudioMap) + four forked native plugins
**Field tests so far:** ELYSEE (multiple), FRAPPAZ, GUILLOTIÈRE (2024-12), GIVORS (2026-05-20). Next: VILLEURBANNE.

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
| `cordova-plugin-audiofocus` | 1.8.0 | ✅ pinned (Round 22: iOS native step-state cache + MPNowPlayingInfo/MPRemoteCommandCenter all-disabled) |
| `cordova-plugin-power-optimization` | 0.3.1 | ✅ pinned @ `3e89474` |
| `cordova-background-geolocation-plugin` | 2.10.0 | ✅ pinned (Round 23: BG-11 iOS rail of CLCircularRegion wake-ups) |
| `cordova-plugin-audio-simple` | 0.2.0 | ✅ pinned (Round 24: renamed from `cordova-plugin-exoplayer-simple`; iOS impl lands in R25) |

**Workstream coverage (post-GIVORS):**
| Workstream | Status |
|---|---|
| A — Walk-session lifecycle hygiene (A1–A8b) | All shipped. A1 keeps state in localStorage by design (only the title-page 5-tap-bottom clears it — used to rearm loan phones). A2 awaits engine reset before first play. A3 (rearm) awaits `releaseSession` before `resetAudioSession` to prevent the iOS deactivate/activate race |
| B — Android resilience (B1, B2, B3, B4) | B1 shipped. B2 closed by BG-5 native AlarmManager. B3 closed by **Architecture D in bg-geo v2.9.0** — Raw-primary parallel with Fused fallback, dedupe in native plugin (no OEM allowlist, fail-soft on no-GMS, JS sees a single source-tagged stream). B4 diagnostic + iOS `forceReacquire` shipped; UI freeze-band still blocks on field threshold calibration. P0.5 Fix 1e (Android JS-suspended-despite-alarm diagnostic) shipped in v2.8.0 — telemetry-only via `alarm_wake_stats` |
| C — Audio reliability (C1–C5) | C1, C2, C4, R7.2 shipped. C3 covered by C2. C4 runs on both platforms intentionally (Android playerrors can also be caused by audiofocus loss). C5 — `IsAutoRevokeWhitelisted` shipped in power-opt v0.3.1. C6 deferred |
| D — iOS GPS native (D1–D6) | D1 warning shipped. D3 (`forceReacquire`), D4 (flag re-assertion), D5 (SLC auto-reacquire) all closed by plugin work. D6 covered by B4. D7 = dedicated iOS field test still TBD |
| E — Step lifecycle correctness (E1/E2/E3) | Not shipped — blocks on `accuracy_near_border` field data |
| F — Telemetry & diagnostics (F-K1..F-N3) | All Phase 1A JS items shipped. F-A4 silence detection dropped (covered by `voice_snapshot` heuristics) |
| G — Plugin extensions (G1–G4) | G1 (audiofocus v1.7.1 — incl. Round 21 `ExtraFocusListener`), G2 (power-opt v0.3.1), G3 (bg-geo v2.9.0), **G4 (cordova-plugin-exoplayer-simple v0.1.1 — NEW Android Media3 backend, Round 21)** all shipped |
| H — Android audio backend (H1) | H1 (ExoPlayer plugin + `AUDIO_BACKEND_ANDROID` flag + `_backend` telemetry field) shipped — **default still `'howler'`; flip to `'exoplayer'` after one clean field test** |
| iOS native plan (H/I/J/K/L) | Plan in [ios-native-plan.md](ios-native-plan.md). **K (native step-state cache) + J (MPNowPlayingInfo + locked remote commands)** shipped in Round 22 (audiofocus v1.8.0). **H (rail of wake-up regions)** shipped in Round 23 (bg-geo v2.10.0 — BG-11, transition-midpoint CLCircularRegions, throttle 3→10, 30 s stall gate). **I (native audio engine + plugin rename)** — phase 1 shipped in Round 24 (plugin rename `cordova-plugin-exoplayer-simple` → `cordova-plugin-audio-simple` @ 0.2.0; Android behaviour unchanged); phase 2 (iOS native engine + JS cutover + audiofocus iOS shrink) in Round 25. **L (CLMonitor iOS 17+)** still to ship before VILLEURBANNE per agreed sequencing. |

**Open items requiring next field test data:**
- **B4 UI freeze-band** — need `real_callback_freshness` distribution to fix threshold above the ~20 s NSTimer/Handler floor.
- **E1/E2/E3 zone-overshoot gates** — need `accuracy_near_border` distribution to set accuracy and sustain thresholds.
- **H1 ExoPlayer backend validation** — flag `AUDIO_BACKEND_ANDROID='exoplayer'` on at least one loan SM-A515F at VILLEURBANNE. Compare `audio_play_started.load_duration_ms`, `audio_play_stuck`, `audio_loaderror` rates vs the Howler fleet (`backend` field on `audio_uri_resolved` / `audio_*error` is the bucket key).
- **R21 / R22 iOS validation** — on at least one iOS device at VILLEURBANNE: confirm `nowplaying_setup` fires at parcours entry, lock-screen tile shows title with disabled controls, `resume_snapshot_check` (or `resume_native_override`) emits at every `parcours_restore`. Cross-check `lastUpdatedMs` parity between localStorage and NSUserDefaults timestamps.
- **R23 iOS rail validation** — on at least one iOS device at VILLEURBANNE: confirm `gps_rail_configured` fires once per parcours entry with `region_count` = (step_count − 1), `gps_rail_wake` events fire as the walker crosses transition midpoints, and `did_force_reacquire=true` correlates with actual standard-callback stalls (cross-check against `real_callback_freshness`). On an iOS 26.3.x device the rail should produce non-zero `gps_rail_wake.did_force_reacquire=true` events during the 8–14 min blackouts (S1 failure mode).

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

---

## Telemetry events (current code)

### GPS / lifecycle
`session_start`, `session_resume`, `session_restart_click`, `session_end`, `session_diag`, `parcours_restore`, `parcours_freshness_check`, `parcours_update_chosen`, `bg_geo_authorization`, `app_visibility`, `gps_lost`, `gps_recovered`, `gps_callback_gap`, `real_callback_freshness` (30 s, includes `cl_state` on iOS + `alarm_wake_stats` + `location_dispatch_stats` on Android), `ios_power_state` (60 s iOS), `bg_restrictions_recheck` (5 min Android, includes `memory_info` + `standby_bucket`), `power_state_at_parcours` (now includes `auto_revoke_whitelisted` on Android), `gps_frozen` / `gps_unfrozen` (UI band deferred), `alarm_wake_stats` (30 s Android, bg-geo v2.8.0 P0.5 Fix 1e diagnostic), `location_dispatch_stats` (30 s Android, bg-geo v2.9.0 Architecture D: `{fusedAvailable, rawDelivered, rawKeepalive, fusedDelivered, fusedSuppressed, fusedStaleIgnored, lastDeliveredSource}`). Each `bg-geo` location event now carries `dispatch_source` ∈ `{raw, raw-keepalive, fused}` and `is_keepalive` on Android (`is_keepalive` already on iOS via F-G4).

### Step / parcours
`step_fire`, `step_done`, `step_skip_done`, `step_implicit_done`, `step_audio_trigger` (carries `accuracy`, `consecutive_inside_samples`, `time_since_first_inside_ms`, `neighbor_distances`, `step_fire_latency_ms`), `step_resume_current`, `step_past_unload`, `step_voice_failed`, `step_afterplay_fallback`, `step_prewarm_next`, `parcours_store`, `accuracy_near_border` (when within 20 m), `voice_snapshot`, `voice_snapshot_skipped`, `user_lost`, `user_recovered`.

### Audio
`audio_play_requested`, `audio_play_started` (carries `load_duration_ms`), `audio_play_gate`, `audio_play_timeout`, `audio_play_stuck`, `audio_play_stuck_retry`, `audio_play_timeout_self_healed`, `audio_loaderror`, `audio_playerror` (both carry `error_type` ∈ {not_found, network, decode_failed, src_unsupported, timeout, stuck}), `audio_uri_resolved`, `audio_playerror_retry`, `audio_engine_reset`, `audio_engine_reset_error`, `audiofocus_request_fail`, `audiofocus_keepalive_started`, `audiofocus_session_released`, `audio_route_changed`, `audio_session_state` (60 s). **Round 21:** `audio_uri_resolved` and `audio_loaderror`/`audio_playerror` now carry `backend` ∈ {`exoplayer`, `howler`, `howler-fallback`, `native`} so analyze.mjs can bucket post-rollout comparisons cleanly. On the ExoPlayer path the `error_code` 1–4 is derived natively from `PlaybackException.errorCode` (see `ExoPlayerInstance.mapToHowlerCode` — IO range → 2/4, parsing/decoder → 3, unknown → 4) so `classifyAudioErrorType()` in player.js produces the same `error_type` enum without changes.

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
- iOS 26.3.x → D1 onboarding warning visible.

### Loan phones
- Devmode "Mark as loan" → `session_diag.isLoanDevice === true`.
- Rearm button → confirm modal → A1-style teardown → routes to `PAGE('rdv')` (A3).
- `rearm_pre_state` captured before teardown.
- `inter_session_idle_ms` on next session_start.

### Plugin / platform-specific
- Android 14+: FG service starts, type `mediaPlayback` declared.
- iOS: diagnostic suite T4/T8/T9 pass with NativeMediaPlayer.
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
- **H1 (Round 21)** `AUDIO_BACKEND_ANDROID` flag in [player.js](www/app/assets/player.js) selects backend per-load: **default `'howler'` during initial rollout, flip to `'exoplayer'` once one clean field test validates G4**. `_backend` field threaded through `audio_uri_resolved` + `audio_loaderror` + `audio_playerror`. JS-level `SILENT_PLAYER` kept alongside the plugin's native silent player during rollout for parity safety; redundancy reconsidered after first clean field test.
- **R21-supporting** `FlanerieCordova/www/apputils.js` now populates `LOCALAPP_PATH_NATIVE` + `LOCALMEDIA_PATH_NATIVE` on Android too (was iOS-only) so ExoPlayer can read parcours media via `FileDataSource` directly instead of through the embedded WebView HTTP server.
- **R21-supporting** `releaseExoPlayerAll(source)` helper in [pages.js](www/app/pages.js) awaited (rearm A3) or fire-and-forget (walk-end A1) BEFORE `releaseAudiofocusSession` so the ExoPlayer FG service tears down ahead of AudioFocusService's. Telemetry: `exoplayer_release_all` / `exoplayer_release_all_error`.

### Phase 1B remainder (blocked on VILLEURBANNE data)
- **B4 watchdog UI** — `#frozen-band` overlay with "Téléphone en veille — déverrouillez pour continuer". Need `real_callback_freshness` distribution to set threshold above NSTimer floor (~20 s).
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
- **P0.5** Background-geolocation fork — ✅ now v2.7.0 (BG-2/3/4/5/7/10 + F-G1/G3/G4 shipped).

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
- **C5** Power optimization fork — ✅ v0.2.0 shipped. Open: `IsAutoRevokeWhitelisted` only.
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
| 23 | 2026-05-28 | plugin + JS | **iOS native plan §1 (H, settled): bg-geo v2.9.1 → v2.10.0 — BG-11 GPS rail of wake-up CLCircularRegions.** Pure wakeup mechanism: when CLLocationManager standard updates stall in deep background (iOS-26-class blackouts at GIVORS S1/M1), the OS itself fires region-boundary callbacks even from suspended state. Native handler calls `_doForceReacquire` (D3 path) if real callbacks have been silent >30 s and the per-session cap (raised 3→10) is not exhausted, opens a `beginBackgroundTask` to extend the wake window, then emits a `region_wake` event for telemetry. JS-side polygon zone-check stays in charge of fine-grained step audio — region wakes never trigger audio (Decision 1.D / 2.B in [ios-native-plan.md](ios-native-plan.md)). **Plugin layout:** `MAURProviderDelegate` gains `@optional - (void)onRegionWake:(NSDictionary*)payload`. `MAURRawLocationProvider` adds `_railManager` (separate CLLocationManager), `_railRegions` (NSMutableArray of CLCircularRegion), public `configureRail:`/`clearRail`, and `didEnterRegion:`/`didExitRegion:`/`monitoringDidFailForRegion:` delegate methods. Throttle: `FORCE_REACQUIRE_CAP=10`, `FORCE_REACQUIRE_GATE_S=30.0` enforced both for region-driven and SLC-driven (BG-10) reacquires. `MAURBackgroundGeolocationFacade` exposes `configureRail:` / `clearRail` (forwarded to Raw provider when active) and an `onRegionWake:` passthrough. `CDVBackgroundGeolocation` adds matching CDV actions and surfaces `region_wake` via existing event-listener channel. **JS bridge:** `BackgroundGeolocation.configureRail(regions)` / `clearRail()` + `region_wake` added to events whitelist. **Webapp:** `computeGpsRail(parcours)` returns the transition-midpoint rail (one circle per consecutive step-centroid pair, 100 m radius, ids `rail_<i>_<i+1>`). Wired from `PAGES['parcours']` entry (after `setupNowPlaying`) and `PAGES_CLEANUP['parcours']` (after `clearNowPlaying`). Subscribes to `region_wake` for telemetry. New events: `gps_rail_configured` (region_count, rail_radius_m, step_count), `gps_rail_wake` (region_id, event, last_real_callback_age_ms, did_force_reacquire, force_reacquire_count, app_state, bg_task_id), `gps_rail_cleared`, `gps_rail_configure_skipped`, `gps_rail_configure_warn`, `gps_rail_configure_error`, `gps_rail_clear_error`. iOS-only — Android errbacks the actions silently; webapp gates calls on `PLATFORM === 'ios'`. Awaiting iOS device build/test (regions auth dialog must accept). |
| 24 | 2026-05-28 | plugin + JS + tooling | **iOS native plan §2 phase 1 (I.A, settled): rename `cordova-plugin-exoplayer-simple` → `cordova-plugin-audio-simple` @ 0.2.0.** Pure mechanical rename — Android behaviour bytes-identical. Plugin id, display name (`AudioSimple`), JS clobber (`cordova.plugins.audio`), JS file (`www/AudioSimple.js`), JS `SERVICE` constant (`'AudioSimple'`), Cordova feature name (`AudioSimple`), Java entry-point class (`AudioSimplePlugin`) and file (`src/android/AudioSimplePlugin.java`) all renamed. Intentionally retained: Java package `com.maigre.cordova.plugins.exoplayer.*`, internal classes `ExoPlayerInstance` / `ExoPlayerService` / `UriResolver`, Android FG service component name (would invalidate installs), resource files `exoplayer_silent.mp3` / `exoplayer_strings.xml` — ExoPlayer is literally the underlying Android tech. **FlanerieCordova:** devDeps + `cordova.plugins` spec updated; `scripts/sync-workspace-plugins.mjs` registry pluginConfigs entry renamed; `scripts/validate-container.mjs` expected map updated; `www/apputils.js` comment refreshed. **Workspace:** plugin-upgrade skill `tracked-forks` table updated. **Webapp:** every `cordova.plugins.exoplayer.*` reference replaced with `cordova.plugins.audio.*` (3 files: player.js, diagnostic.js, pages.js); helper `releaseExoPlayerAll` renamed to `releaseAudioPluginAll`; telemetry events `exoplayer_release_all` / `exoplayer_release_all_error` renamed to `audio_plugin_release_all` / `audio_plugin_release_all_error` (analyzer-visible rename — historical events stay under the old name). `AUDIO_BACKEND_ANDROID` flag values retained (`'howler'`, `'exoplayer'`) since `'exoplayer'` still accurately names the Android backend tech. iOS native engine + JS cutover + audiofocus iOS shrink land in Round 25. |

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
