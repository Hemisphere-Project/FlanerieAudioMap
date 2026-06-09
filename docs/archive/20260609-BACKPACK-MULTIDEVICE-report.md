# 2026-06-09 — Backpack multi-device field test (FLANERIE_INVITES_V3)

**Build under test:** apk **28** · webapp `6cda72bf` · bg-geo **2.14.12** · audio-simple **0.3.4** · audiofocus **1.9.1** · power-opt **0.3.1** — **uniform across all 48 sessions** (zero build/config skew, single parcours `FLANERIE_INVITES_V3` = 21 steps).
**This is the first field run of apk 28** — the build the 2026-06-07 audit flagged as TODO (audio-simple 0.3.4 SW-preferred decoders + launcher fixes).

**Test method (from operator):** staff team testing *as real users*. **Most phones were carried together, locked, in one tester's backpack** on the same physical walk (see the ~11:17–11:24 start cluster). This makes today a **controlled same-conditions platform comparison**: identical route, identical bag, simultaneous — the only variable is the device/OS.

**Scope:** 48 sessions = 24 onboarding + 24 walk sessions. Of the walks, ~8 are the long backpack group (40–55 min); the rest are short init/re-arm blips (1 min) as the bag was armed. Tester UX feedback not yet provided (operator to send later today).

---

## Headline

| | iOS (in/with the bag, locked) | Android (in the bag, locked) |
|---|---|---|
| **GPS background continuity** | ✅ **Worked** — full route tracked | 🔴 **Failed** — froze 40+ min mid-walk |
| **Audio** | ✅ 0 errors | ✅ 0 errors |
| **Outcome** | both iPhones completed/near-completed | route stuck at step 0, caught up only when handled |

The same backpack carried both iPhones and a half-dozen Androids on the same walk. **The iPhones tracked the whole route step-by-step; the Androids went dark for the entire walk.** Root cause is now pinned (below) and it is **not** GPS hardware — it is the Android WebView/JS layer being suspended while the native GPS plugin stays fully alive underneath.

---

## 🟢 iOS — first real locked-pocket walks, whole iOS native plan validated end-to-end

Two physical iPhones, each onboarded then walked the full route locked away:

| Phone | OS | Session | Walk | Steps fired | Rail wake | Visits | Audio | Motion |
|---|---|---|---|---|---|---|---|---|
| iPhone SE 3 (iPhone14,6) | **iOS 26.4.2** | `0x7o` | 42 min | **0–20 ALL, contiguous → completed** | **38** | 3 | 0 err | granted (onb `2z8u`) |
| iPhone 8 (iPhone10,1) | **iOS 16.7.10** | `4a7m` | 54 min | 0–16,18,19 (skipped 17) | **38** | 6 | 0 err | granted (onb `ucvi`) |

This closes a stack of "pending field validation" items the audit had been carrying for weeks:

- **Rail wake fired 38× on both phones during real blackouts** (`gps_rail_wake=38`). The audit repeatedly noted `gps_rail_wake=0 — no blackout to trigger it` (R23, §2026-06-06). The iOS region-wake rail (the dead-code-then-fixed-then-untested feature) is now **proven to fire and recover the stream in the field.** On both phones `gps_state` flipped `frozen→recovered` (12×/12× on `4a7m`, 5×/5× on `0x7o`) — the R27 real-fix-freshness logic correctly detected the stale-keepalive masking (`4a7m` real-fix freshness hit **311 s** while keepalive replayed, and it was flagged `frozen`, *not* healthy).
- **audio-simple under narration load:** 79 `audio_uri_resolved` `backend=audio-simple`, **0 load/play errors** across 54 + 42 min of BLOC narration. First validation of the iOS native audio engine under a real walk (was configure-level only on `imug`, 2026-06-06).
- **CLVisit** firing (`gps_visit_event` 3–6×), **`ios_stream_health`+`cl_state`** snapshots 82–105×, **Motion granted on fresh install** on both (the §14/§15 saga holds on the shipping build, now on iOS 16 *and* 26).
- `0x7o` (iOS 26.4.2) fired **all 21 steps contiguously and completed** — a clean modern-iOS pocket walk. `4a7m` (the 2017 iPhone 8 on iOS 16) skipped step 17 (single zone-overshoot) but otherwise tracked the whole route.

**iOS verdict:** the iOS native plan (rail, audio-simple, visits, stream-health, motion) is validated end-to-end on a real locked-pocket walk, on both an old and a current device. No iOS defects today.

---

## 🔴 Android — JS/WebView suspended in background; native GPS stays alive but nothing triggers

This is the critical finding of the day, and the backpack method makes it unambiguous.

**Symptom (analyze GPS-blackout scan):** the backpack Androids logged one giant GPS gap each, route stuck at step 0, then a teleport to the final steps when the bag was opened at the end:

| Session | Device | OS | Gap | Steps fired | Reached end? |
|---|---|---|---|---|---|
| `s906` | SM-A515F | 13 | **48 min** (2882 s) | [0] | no (caught up to 20 at 56 min) |
| `h52i` | SM-A415F | 12 | **48 min** (2866 s) | [0] | no |
| `detx` | Sony F5121 | **8.0.0** | **42 min** (2548 s) | [0] | jumped 0→20 at 47 min |
| `pzsl` | SM-A515F | 13 | 42 min (2501 s) | 0,19 | reached 19 at end |
| `8acr` | SM-A515F | 13 | 41 min (2474 s) | 0,19,20 | "completed" — but only at 42 min |
| `v6f5` | Xiaomi 2201117TY | 13 | 10 min (614 s) | 0,5,6 | partial |
| `1u05` | FP4 | 15 | 8.5 min (507 s) + **2 crashes** | 0,4,5 | abandoned (16 min) |
| `8dvc` | FP4 | 15 | 3 gaps, 17 min total | 4,5,11,14,19,20 | reached 20 (devmode test) |

Note `8acr` shows "completed (YES)" in the day report — **this is misleading.** It reached step 20 only at minute 42 when the bag was opened; the walker heard nothing for the preceding 41 minutes. Completion-by-catch-up ≠ a walk experienced.

### Root cause — it is NOT GPS, and NOT battery-opt. It is the JS event loop freezing.

I checked which periodic timers fired *during* the gaps. The 30 s JS timers (`real_callback_freshness`, `alarm_wake_stats`, `location_dispatch_stats`, `voice_snapshot`) fired at t=0–1 min, then **nothing until the phone returned to foreground at the end** (t≈46–56 min). Over a ~50 min walk a 30 s timer should fire ~100×; it fired **3–9×** total. The JS event loop was **suspended**, not merely un-flushed (buffered events keep their original timestamps; there are none).

Meanwhile the **native bg-geo service stayed fully alive** the entire time (payloads captured when JS finally woke):

| Session | native `alarm` fires | `rawDelivered` | `rawKeepalive` | `fusedAvailable` |
|---|---|---|---|---|
| `8acr` | 119 | **2553** | 59 | **true** |
| `detx` | 110 | **3216** | 1 | **true** |
| `s906` | 154 | **4169** | 32 | **true** |
| `h52i` | 115 | **3338** | 5 | **true** |

So: **GPS hardware healthy, native location stream healthy (thousands of fixes), AlarmManager Doze keepalive firing (BG-5 working), Architecture-D Fused available and dedup-suppressing as designed** — and **none of it reaches the JS that runs the zone-trigger + audio logic, because Android froze the WebView renderer** when the screen was locked and the app backgrounded in the bag (the `org.chromium...SandboxedProcessService` appears being killed/frozen in `last_exit_reasons`). Battery-opt is exempt on all of them (`standby_bucket=EXEMPTED`, `ignoring_batt_opt=true`) — the exemption does **not** stop renderer suspension.

**This is the audit's P0.5 Fix 1e "Android JS-suspended-despite-alarm" scenario, now confirmed at scale in the field** (alarm fires natively, JS is dead). The single clean Android run the audit relied on (`8giw`, SM-A515F, 2026-06-05, "0 blackouts, AlarmManager never activated") was a phone walked normally — likely handled / screen waking — which is why it never suspended. **Deep in a locked backpack with zero interaction is the worst-case Doze condition, and it breaks every Android device tested**, across OEMs (Samsung, Sony, Xiaomi, Fairphone) and Android 8→15.

### Leading mechanism hypothesis (needs one confirmation)

The audit notes the JS-level `SILENT_PLAYER` is "kept alongside the plugin's native silent player for parity safety." Playing audio inside the WebView's own audio context is what historically kept the Chromium renderer scheduled in background (the Howler era). With the ExoPlayer/audio-simple migration the silent keepalive moved to a **native service** — so if the JS `SILENT_PLAYER` is no longer actually producing in-context audio (e.g. AudioContext suspended, or it was dropped on the native-backend path), **nothing holds the JS renderer awake anymore**, and Android freezes it. That would make this a side-effect of the (otherwise good) native-audio migration. **Confirm by checking whether the JS `SILENT_PLAYER`/AudioContext is actually running in background on the ExoPlayer path** before designing the fix.

### Fix direction (for discussion — do not implement yet)

The zone-trigger + audio-selection logic lives entirely in JS, and Android will suspend that JS in a locked pocket regardless of FG service or battery exemption. Options, roughly in order of leverage:

1. **Keep the WebView renderer alive in background** — ensure an in-context JS/WebAudio silent loop actually plays on the ExoPlayer path (re-arm the JS `SILENT_PLAYER`, disable `Howler.autoSuspend`, resume the AudioContext on `visibilitychange`-hidden). Cheapest if the mechanism hypothesis holds.
2. **Move zone-triggering native** — let the bg-geo native stream (which *is* alive) evaluate geofence entry and signal the audio plugin to advance, so a frozen JS renderer no longer stalls the walk. This is the robust fix but the largest (mirrors the iOS rail/visit native path).
3. **WAKE_MODE / partial wakelock around the WebView** while a parcours is active (the audiofocus FG service already exists — does it hold a wakelock that covers the renderer? evidently not).

This is the **single most important item for VILLEURBANNE** and likely a launch blocker for Android locked-pocket use.

---

## 🟢 Audio — clean across the whole fleet

- **Zero real narration failures** anywhere: no `step_voice_failed`, no `BLOC_*` load/play errors, across all 48 sessions.
- Backend split: **124 ExoPlayer (Android) + 79 audio-simple (iOS), 0 errors on either.** No Howler fallback used.
- apk 28's **audio-simple 0.3.4 SW-preferred-decoder fix held** across the Android fleet — no `MediaCodecAudioRenderer` exhaustion. **Caveat:** the specific device that failed on 2026-06-06 (SM-A528B / Galaxy A52s 5G) was **not present today**, so the targeted re-test the audit is waiting on for Howler retirement still hasn't happened. Today is supporting evidence (clean across 5 other Android models), not the confirmation.
- Only afterplay-placeholder fallbacks (`step_afterplay_fallback` 6×, all `no_src`) — harmless, the unproduced jingle assets.
- `audiofocus_request_fail`: 0 on both platforms.

---

## Onboarding & permissions

- 24 onboarding sessions, no permission hangs. Both iOS onboarded **Motion = granted** on fresh install (`2z8u`, `ucvi`).
- A few long Android onboarding sessions in the 10:56 cluster (`a0p7` Xiaomi 28 min, `7mlv` 19 min, `791l`/`8mt7`/`i5j0` ~21 min). These are live-flushed sessions that stay open until the walk opens; worth a glance for the known Xiaomi/Samsung `checkbatteryopt` and GPS-startup-gate friction (audit 2026-06-05/06), but no motion or hard-block failures surfaced.
- No `battery_kill_overlay`, no `bg_stop_repeated` — no OEM battery kills today (the freezes are suspension, not kills).

---

## Cross-reference to mobile-audit.md

| Audit item | Today's evidence |
|---|---|
| iOS rail wake — *"still pending, `gps_rail_wake=0`"* (R23, §06-06) | ✅ **VALIDATED** — 38× on both iPhones during real blackouts |
| iOS audio-simple under narration load — *"still pending"* (§06-06) | ✅ **VALIDATED** — 0 errors over 54+42 min real walks |
| iOS full locked-pocket walk — *"still NOT validated"* (§06-06) | ✅ **VALIDATED** — `0x7o` all-21 contiguous, `4a7m` near-full |
| iOS R27 freshness/`frozen` state | ✅ working — stale-keepalive correctly flagged `frozen`, not healthy |
| Motion saga (§14/§15) | ✅ holds on apk 28 / bg-geo 2.14.12, iOS 16 + 26 |
| Architecture D Fused fallback — *"not yet validated on any device"* | ✅ `fusedAvailable=true` on 4 devices, native dedupe working — **but moot** (problem is upstream in JS) |
| B4 / P0.5 Fix 1e *"Android JS-suspended-despite-alarm diagnostic"* | 🔴 **CONFIRMED AT SCALE** — alarm fires natively, JS frozen 40+ min. Promote from diagnostic to **P0 fix.** |
| H1 ExoPlayer / Howler retirement | 🟡 clean on 5 Android models, but **SM-A528B absent** — targeted re-test still owed |
| Android background GPS continuity | 🔴 **broken in locked-pocket** — not GPS, the JS layer |

---

## Recommended next moves

1. **🔴 P0 — Android background JS suspension.** This is the launch blocker for Android locked-pocket walks. First confirm the mechanism (is the JS `SILENT_PLAYER`/AudioContext actually running in background on the ExoPlayer path?), then pick a fix from the three options above. Bring `8acr`/`detx`/`s906`/`h52i` as the reproducing set.
2. **🟢 Bank the iOS win.** The iOS native plan is field-validated end-to-end. Update the audit's iOS open-items to ✅ (rail wake, audio-simple under load, locked-pocket walk).
3. **🟡 Still owe the SM-A528B ExoPlayer re-test** before Howler retirement — today doesn't substitute for it.
4. **Re-run the backpack method at VILLEURBANNE** — it is an excellent controlled comparison. Add at least one SM-A528B to the bag to close H1, and keep the two iPhones in for regression cover.

---

*Generated from telemetry (`telemetry:analyze` + per-session drill-downs, 48 sessions). Tester UX feedback pending — will refine "experienced vs caught-up" notes when it arrives.*

---

## Fixes shipped (2026-06-09, post-report) — code in tree, awaiting apk 29 + re-test

Mechanism confirmed in source: the ExoPlayer/audio-simple migration moved the silent keepalive **native**, so no in-renderer Web Audio context keeps the Chromium renderer scheduled → Android freezes the JS loop locked-in-pocket (also why telemetry truncates at ~1 min — the flush timer is JS).

**Android JS-suspension P0 — keepalive, all three levers:**
- **Lever 1 [webapp, live]** — `RENDERER_KEEPALIVE` plays the silent `flanerie.mp3` through Howler `html5:false` (in-renderer Web Audio) for the walk; Android-gated; `poke()` on visibility. Restores the property the Howler era had for free.
- **Lever 2 [container]** — `KeepRunning=true` in `config.xml`.
- **Lever 3 [native, power-opt 0.3.2 PO-10]** — `setRendererPriorityPolicy(IMPORTANT, waivedWhenNotVisible=false)`, toggled on the parcours lifecycle.
- Levers 2–3 need **apk 29**. Validate with the desk test (lock screen 15 min, confirm `real_callback_freshness` every 30 s + `renderer_keepalive`) then the backpack re-test.

**18-phones telemetry-tracking gap — same root cause, NOT the GL.iNet/no-SIM network.** Census: ~17–19 phones reached the server (≈18); the gap was *truncation* (8 Android walks stop at ~60 s) from the JS freeze, not missing phones. AAAA/IPv6 already dropped (A-record only), zero `connectivity_failed`. Robustness shipped anyway: durable `telemetry_pending` buffer (re-sent next launch) + `fetch` abort timeout.

**Five follow-up fixes [webapp/analyzer]:** (#1) `is_loan` auto-set on first devmode entry, manual toggle removed; (#2) analyzer "Device re-use" now groups by `deviceUuid` (revealed the "SM-A515F ×6" = 6 distinct phones); (#3) iOS static-scene "GPS LOST" = the `frozen` indicator firing before CMMotionActivity catches up — escalation now debounced behind `GPS_FROZEN_SUSTAIN_MS` so narration isn't interrupted; (#4) `checkaudio` single retry + `backend`/`native_error_code` now logged; (#5) devmode restart now releases native audio before reload.

Full detail: `mobile-audit.md` → 2026-06-09 addendum (fix-plan + "Follow-up fixes").
