# Mobile Audit & Remediation Plan

**Original:** 2026-04-27
**Last updated:** 2026-05-27 (consolidated; verification audit of all shipped items completed)
**Scope:** Cordova launcher (FlanerieCordova) + downloaded local webapp (FlanerieAudioMap) + three forked native plugins
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
| `cordova-plugin-audiofocus` | 1.6.0 | ✅ pinned |
| `cordova-plugin-power-optimization` | 0.3.1 | ✅ pinned @ `3e89474` |
| `cordova-background-geolocation-plugin` | 2.8.0 | ✅ pinned @ `284a5c2` |

**Workstream coverage (post-GIVORS):**
| Workstream | Status |
|---|---|
| A — Walk-session lifecycle hygiene (A1–A8b) | All shipped. A1 keeps state in localStorage by design (only the title-page 5-tap-bottom clears it — used to rearm loan phones). A2 awaits engine reset before first play. A3 (rearm) awaits `releaseSession` before `resetAudioSession` to prevent the iOS deactivate/activate race |
| B — Android resilience (B1, B2, B4) | B1 shipped. B2 closed by BG-5 native AlarmManager. B4 diagnostic + iOS `forceReacquire` shipped; UI freeze-band still blocks on field threshold calibration. P0.5 Fix 1e (Android JS-suspended-despite-alarm diagnostic) shipped in bg-geo v2.8.0 — telemetry-only via `alarm_wake_stats` |
| C — Audio reliability (C1–C5) | C1, C2, C4, R7.2 shipped. C3 covered by C2. C4 runs on both platforms intentionally (Android playerrors can also be caused by audiofocus loss). C5 — `IsAutoRevokeWhitelisted` shipped in power-opt v0.3.1. C6 deferred |
| D — iOS GPS native (D1–D6) | D1 warning shipped. D3 (`forceReacquire`), D4 (flag re-assertion), D5 (SLC auto-reacquire) all closed by plugin work. D6 covered by B4. D7 = dedicated iOS field test still TBD |
| E — Step lifecycle correctness (E1/E2/E3) | Not shipped — blocks on `accuracy_near_border` field data |
| F — Telemetry & diagnostics (F-K1..F-N3) | All Phase 1A JS items shipped. F-A4 silence detection dropped (covered by `voice_snapshot` heuristics) |
| G — Plugin extensions (G1–G3) | G1 (audiofocus v1.6.0), G2 (power-opt v0.3.1), G3 (bg-geo v2.8.0) all shipped |

**Open items requiring next field test data:**
- **B4 UI freeze-band** — need `real_callback_freshness` distribution to fix threshold above the ~20 s NSTimer/Handler floor.
- **E1/E2/E3 zone-overshoot gates** — need `accuracy_near_border` distribution to set accuracy and sustain thresholds.
- **B3/BG-6 FusedLocationProvider** — escalate only if v2.7.0 still shows ≥2 Android Doze blackouts ≥5 min on restrictive OEMs.

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

**Genuinely shipped and correct** (verified line-by-line):
A4, A5, A6, A8, A8b, B1, B4 (diagnostic + iOS forceReacquire), C1, C2, D1, R7.2, F-G1, F-G1b, F-G2, F-G3, F-G4, F-K3, F-N3, F-R1, F-R2, F-Z1, F-Z3, all plugin rounds (audiofocus v1.6.0 AF-1..AF-7, power-opt v0.3.1 PO-1..PO-9, bg-geo v2.5.0..v2.8.0 BG-2..BG-10 + P0.5 Fix 1e diagnostic).

**Genuinely shipped and correct** (verified line-by-line):
A4, A5, A6, A8, A8b, B1, B4 (diagnostic + iOS `forceReacquire`), C1, C2, D1, R7.2, F-G1, F-G1b, F-G2, F-G3, F-G4, F-K3, F-N3, F-R1, F-R2, F-Z1, F-Z3, all plugin rounds (audiofocus v1.6.0 AF-1..AF-7, power-opt v0.2.0 PO-1..PO-8, bg-geo v2.5.0..v2.7.0 BG-2..BG-10).

---

## Telemetry events (current code)

### GPS / lifecycle
`session_start`, `session_resume`, `session_restart_click`, `session_end`, `session_diag`, `parcours_restore`, `parcours_freshness_check`, `parcours_update_chosen`, `bg_geo_authorization`, `app_visibility`, `gps_lost`, `gps_recovered`, `gps_callback_gap`, `real_callback_freshness` (30 s, includes `cl_state` on iOS + `alarm_wake_stats` on Android), `ios_power_state` (60 s iOS), `bg_restrictions_recheck` (5 min Android, includes `memory_info` + `standby_bucket`), `power_state_at_parcours` (now includes `auto_revoke_whitelisted` on Android), `gps_frozen` / `gps_unfrozen` (UI band deferred), `alarm_wake_stats` (30 s Android, bg-geo v2.8.0 P0.5 Fix 1e diagnostic).

### Step / parcours
`step_fire`, `step_done`, `step_skip_done`, `step_implicit_done`, `step_audio_trigger` (carries `accuracy`, `consecutive_inside_samples`, `time_since_first_inside_ms`, `neighbor_distances`, `step_fire_latency_ms`), `step_resume_current`, `step_past_unload`, `step_voice_failed`, `step_afterplay_fallback`, `step_prewarm_next`, `parcours_store`, `accuracy_near_border` (when within 20 m), `voice_snapshot`, `voice_snapshot_skipped`, `user_lost`, `user_recovered`.

### Audio
`audio_play_requested`, `audio_play_started` (carries `load_duration_ms`), `audio_play_gate`, `audio_play_timeout`, `audio_play_stuck`, `audio_play_stuck_retry`, `audio_play_timeout_self_healed`, `audio_loaderror`, `audio_playerror` (both carry `error_type` ∈ {not_found, network, decode_failed, src_unsupported, timeout, stuck}), `audio_uri_resolved`, `audio_playerror_retry`, `audio_engine_reset`, `audio_engine_reset_error`, `audiofocus_request_fail`, `audiofocus_keepalive_started`, `audiofocus_session_released`, `audio_route_changed`, `audio_session_state` (60 s).

### Operator / rearm
`rearm_button`, `rearm_pre_state`, `walk_end_shutdown`, `inter_session_idle_ms` (on `session_start`).

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
- **G1** audiofocus v1.6.0: AF-1 channel description, AF-2 iOS deactivation order, AF-3 START_STICKY recovery, AF-4 power-save receiver, AF-5 iOS route-change events, AF-6 `getAudioSessionState`, AF-7 app icon. Plus `resetAudioSession()` + `releaseSession()` actions used by A1/A2/A3.
- **G2** power-opt v0.3.1: PO-1 LeTV intent fix, PO-2 `GetLastExitReasons`, PO-3 `GetMemoryInfo`, PO-4 `GetStandbyBucket`, PO-5 JSON booleans, PO-6 iOS stub, PO-7 Xiaomi MIUI autostart, PO-8 `skipProtectedAppCheck` guard, **PO-9 `IsAutoRevokeWhitelisted` + `RequestAutoRevokeWhitelist` (v0.3.1)**.
- **G3** bg-geo: v2.5.0 (BG-3 `getCLState`, BG-4 `getPowerState`, BG-7 keepalive flag re-assertion); v2.6.0 (BG-2 `forceReacquire`, BG-5 Android AlarmManager Doze keepalive, BG-10 iOS SLC auto-reacquire); v2.7.0 (F-G1 native auth callback, F-G3 keepalive `bg_task_id`, F-G4 `is_keepalive` flag so B4 watchdog fires correctly); **v2.8.0 (BG-3 schema clarification — `hasLocation` + `locationTimestampAgeMs`; P0.5 Fix 1e diagnostic — `sAlarmFireCount` counter + `getAlarmWakeStats` CDV action)**.

### Phase 1B remainder (blocked on VILLEURBANNE data)
- **B4 watchdog UI** — `#frozen-band` overlay with "Téléphone en veille — déverrouillez pour continuer". Need `real_callback_freshness` distribution to set threshold above NSTimer floor (~20 s).
- **E1/E2/E3 zone-overshoot gates** — accuracy-gated step entry. Need `accuracy_near_border` distribution.

### Phase 3 — deferred, conditional
- **B3 / BG-6** Android `FusedLocationProvider` — only if v2.7.0 field data shows ≥2 Android Doze blackouts ≥5 min on restrictive OEMs.
- **C6b** Android `NativeMediaPlayer` migration — only if R4.1-class cold-load hangs recur after A8/A8b.
- **P3.5 Plan B/C** native `getCurrentPosition()` during GPS tasks / native plugin save on lifecycle — only if `voice_snapshot` shows iOS position-staleness after Phase 1B.

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
