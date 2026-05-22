# Field Test Report — 2026-05-20 · FLANERIE GIVORS

**Parcours:** FLANERIE_GIVORS (flanerie_givors_v7_cbr, 17 steps 0–16)  
**Files:** 110 total | 7 pre-opening (before 08:54) | 103 visitor-wave sessions  
**Expected visitors:** ~45–50 (15–20 on loaned phones)  
**Builds:** apk 12 or 13 / webapp `fdf504c8` (old, ~30 sessions) + `2f77776e` (new, ~70 sessions)  
**Generated:** 2026-05-22

---

## 1. Noise separation

### 1a. Pre-opening tests (7 sessions, excluded from stats)

| Time  | Id   | Device   | Dur     | Notes                          |
|-------|------|----------|---------|--------------------------------|
| 08:25 | juow | SM-A515F | 2m39s   | No step triggered              |
| 08:30 | x0w3 | HTC U11  | 10s     | Blip                           |
| 08:30 | 6wvb | HTC U11  | 5m32s   | Step 0 only                    |
| 08:36 | xcak | SM-A515F | 46s     | Blip                           |
| 08:37 | 95am | SM-A515F | 3m      | Blip                           |
| 08:40 | faoy | SM-A515F | 14m05s  | Test walk, step 1 max          |
| 08:48 | df6e | FP3      | 1m36s   | Blip                           |

### 1b. Loan phone cycling — SM-A515F (37 sessions in visitor wave)

The SM-A515F generated the most noise in the visitor wave.

**Identified actual visitor walks on this device:**

| Session | Time  | Status     | Notes                                         |
|---------|-------|------------|-----------------------------------------------|
| `7m25`  | 09:12 | Complete   | GPS blackout — see §4                         |
| `4o57`  | 09:45 | Complete   | 5min, step 16 reached = resumed already-done  |
| `1r8h`  | 10:16 | Operator   | 3 resumes, 0 steps — test between loans       |
| `xhde`  | 10:46 | Complete   | 4min, resumed already-done                    |
| `mwbo`  | 12:46 | Idle       | Resumed already-done, left idle 1h50m         |
| `hpk9`  | 16:34 | Complete   | GPS blackout — see §4                         |

All remaining ~30 sessions are sub-5min re-arm blips (yevh, qetf, mert, lv8k, quo5, 29p4, 524v, hnto, xsct, jv47, and the 17:10–17:28 end-of-day cluster).

> **⚠ Operational issue — `oupu` (08:58):** A visitor walked steps 0–10 smoothly over 25 minutes (GPS clean, no errors). At 24m54s a `session_restart reason=rearm_button` cut the session. Staff re-armed the phone while the visitor was still mid-walk. Visitor missed steps 11–16.

### 1c. App left running after walk end

| Id     | Device        | Duration | Note                                                        |
|--------|---------------|----------|-------------------------------------------------------------|
| `7p2j` | iPhone14,2    | 1h20m    | Resumed at step 16 done=true; no steps fired; left running  |
| `xuyx` | iPhone14,2    | 1h49m    | Same — 6 GPS gaps = phone stationary                        |
| `9hjo` | iPhone15,2    | 1h17m    | Completed at 46m, GPS froze 29min post-walk (app left open) |
| `mwbo` | SM-A515F      | 1h50m    | Resumed complete, GPS frozen 110min                         |
| `tg6o` | 25062RN2DE    | 33s      | 33-second re-open of already-complete session at 12:37      |

---

## 2. Full parcours completions

### 2a. Clean completions (all 17 steps, no GPS gaps, no crashes)

`2d5g` FP3 · `pw5b` iPhone15,2 · `k8ps` iPhone15,2 · `kctv` 25062RN2DE · `6epi` iPhone14,2 · `ogro` M2101K7AG · `5kd4` SM-S901U1 · `232o` CPH2065 · `mqlj` Pixel 6a · `168c` 24117RN76E · `4zq0` iPhone14,2 · `892p` SM-A566B · `4fu5` SM-G525F · `c7qo` iPhone14,7 · `h6os` SM-A156B · `dyo5` SM-G973F · `9qf4` SM-A125F · `knj6` 23117RA68G · `bi6k` SM-G970U1 · `189t` SM-S721B · `bm1g` iPhone14,4 · `akbc` iPhone12,8 · `5kkz` SM-S938B · `yapj` SM-G990B2 · `781m` Pixel 6a · `9iyw` iPhone15,2 · `p04e` SM-A336B · `n6id` SM-A145R · `sqvb` iPhone16,1 · `0d5l` SM-S901U1 · `2tqf` moto g24 power · `0vvc` SM-A047F

**32 clean full completions.**

### 2b. Completed with crashes/resumes (walk recovered)

| Id     | Device      | OS          | Resumes | Audio errors | Notes                                                          |
|--------|-------------|-------------|---------|--------------|----------------------------------------------------------------|
| `f743` | SM-A155F    | Android 16  | **7**   | 0            | All 16 steps done; OEM-killed repeatedly, each resume refired current step correctly |
| `mqgf` | 22111317G   | Android 14  | **4**   | 0            | 4 resumes in steps 12–16, completed cleanly                    |
| `wjfo` | SM-A045F    | Android 14  | **4**   | 15 real      | Completed; serious audio failures — see §5                     |
| `2j5u` | RMX3286     | Android 13  | 3       | 0            | Completed cleanly                                              |
| `rumx` | iPhone14,5  | iOS 26.4.2  | 3       | 27 real      | Reached step 15 only — see §6                                  |
| `h6os` | SM-A156B    | Android 16  | 2       | 0            | Completed cleanly                                              |
| `kctv` | 25062RN2DE  | Android 16  | 1       | 0            | Completed cleanly                                              |
| `ogro` | M2101K7AG   | Android 11  | 1       | 0            | Completed cleanly                                              |
| `5kd4` | SM-S901U1   | Android 16  | 1       | 0            | Completed cleanly                                              |

### 2c. Technically completed but GPS blackout = walker heard almost nothing

Reached step 16 (counted "done") but GPS froze within 2 minutes of step 0 and recovered only near the end:

| Id     | Device      | OS         | GPS gap | Steps fired          | Steps missed | Effect on visitor                    |
|--------|-------------|------------|---------|----------------------|--------------|--------------------------------------|
| `hpk9` | SM-A515F    | Android 13 | 36min   | 0 → 15 → 16          | **14 steps** | Heard only last 2 steps of narration |
| `ffqz` | 2201117TY   | Android 13 | 34min   | 0 → 16               | **15 steps** | Heard only the very last step        |
| `avm3` | 2201117TY   | Android 13 | 32min   | 0 → 15 → 16          | **14 steps** | Heard only last 3 steps              |
| `7m25` | SM-A515F    | Android 13 | 2×17min | 0, 9, 10, 16         | 8 + 6 steps  | Heard steps 9–10 and 15–16 only      |
| `ykr5` | 2312DRA50G  | Android 15 | 10min   | all                  | few skips    | Moderate GPS drift, completed        |

> These sessions appear as "completed" in statistics but the visitor missed 80–90% of the audio content.

---

## 3. Crashes and resumes

### Resume recovery pattern (Android)
On Android 14 and 16, the app is OEM-killed roughly every 5–8 minutes in the second half of the walk. The resume machinery works correctly: it refires the current step and continues. No walk was lost to a crash on Android.

### Resume recovery pattern (iOS)
`rumx` iPhone14,5 iOS 26.4.2 had 3 resumes compounding with 27 audio failures across the session. The retries appear to loop on already-failed files. Walk reached step 15 only.

### Post-walk resumes (irrelevant to content delivery)
`9hjo` had 1 resume 29 minutes after step 16 was fired — the walk was fully done; this is the phone being picked up/moved after the visitor finished.

---

## 4. GPS background blackout / partial step miss

### Android — screen-lock GPS kill (Android 13)

Three devices suffered catastrophic GPS blackouts starting within 2 minutes of step 0:

| Session | Device      | OS         | Gap duration | Recovery step | Verdict          |
|---------|-------------|------------|-------------|---------------|------------------|
| `hpk9`  | SM-A515F    | Android 13 | 36min       | Step 14       | Severe miss      |
| `ffqz`  | 2201117TY   | Android 13 | 34min       | Step 15       | Catastrophic miss |
| `avm3`  | 2201117TY   | Android 13 | 32min       | Step 14       | Severe miss      |
| `7m25`  | SM-A515F    | Android 13 | 2×17min     | Steps 8, 15   | Heavy miss       |

Pattern: GPS freezes within 2 minutes of walk start (screen likely locked), resumes when walker nears the end. No `gps_lost` event fires — Android kills the GPS provider silently. `step_skip_done` burst at recovery confirms GPS catchup. Battery optimization is reported as disabled (`ignoring_batt_opt=true`) yet GPS is still killed — likely a manufacturer-level location throttle on these models under Android 13.

Both Xiaomi `2201117TY` units show identical behavior.

### iOS — screen-lock multi-gap blackout (iOS 26.3.1 notably worse)

| Session | Device      | iOS     | Gaps | Worst gap | Impact                           |
|---------|-------------|---------|------|-----------|----------------------------------|
| `51nv`  | iPhone17,5  | 26.3.1  | 4    | 835s 14min | Missed steps 2–4, 9–12; stopped at step 15 |
| `ibk6`  | iPhone14,5  | 26.3.1  | 4    | 540s 9min  | Skipped steps 2–6, 8–9, 12–14   |
| `mq3z`  | iPhone14,5  | 26.3.1  | 3    | 459s 8min  | Skipped steps 3–7; stopped at step 13; also audio errors |
| `rumx`  | iPhone14,5  | 26.4.2  | 5    | 137s ~2min | Minor skips; reached step 15     |
| `19dh`  | iPhone14,5  | 26.4.2  | 3    | 151s ~2min | Missed steps 9, 12; reached step 15 |

iOS 26.3.1 shows notably worse GPS continuity than 26.4.2. The 8–14min gaps on 26.3.1 are unusual and may be a beta-specific regression.

---

## 5. Audio failures

### Real narration failures (step_voice / step_voice_failed)

| Session | Device      | Platform   | Errors | voice_failed          | Affected steps / files                              |
|---------|-------------|------------|--------|----------------------|-----------------------------------------------------|
| `rumx`  | iPhone14,5  | iOS 26.4.2 | **27** | 2 (steps 14, 15)     | BLOC_04, 06, BLOC_10×9, BLOC_15×3, BLOC_16         |
| `vigi`  | iPhone14,7  | iOS 26.4.2 | **21** | 3 (steps 13, 14, 15) | BLOC_10×15, BLOC_14, BLOC_15, BLOC_16               |
| `wjfo`  | SM-A045F    | Android 14 | **15** | 0                    | BLOC_01–03, BLOC_10×3, BLOC_11, BLOC_13, BLOC_15×3, BLOC_16×2 |
| `mq3z`  | iPhone14,5  | iOS 26.3.1 | 5      | 2 (steps 1, 2)       | BLOC_02, BLOC_03 + liaison files                    |
| `0vvc`  | SM-A047F    | Android 14 | 3      | 0                    | —                                                   |

**Recurring problem files** (failing across multiple sessions and platforms):

| File | Failing sessions |
|------|-----------------|
| `GIVORS26_P1_BLOC_10_ICI_POEME_A_AMBIANCE_V3_CBR.mp3` | wjfo, vigi, rumx |
| `GIVORS26_P1_BLOC_10_ICI_POEME_B_MUSIC_V2_CBR.mp3` | wjfo, vigi, rumx |
| `GIVORS26_P1_BLOC_16_Voix_Puzzle_V7_CBR.mp3` | vigi, rumx, wjfo |
| `GIVORS26_P1_BLOC_15_Peau_Mobile_VOIX_V4_CBR.mp3` | vigi, rumx, wjfo |
| `GIVORS26_P1_BLOC_15_Peau_Mobile_MUSIC_V4_CBR.mp3` | rumx, wjfo |

`wjfo` also had 9 `audioTimeout` / `audioStuck` events on these same files — the player stalled loading them, triggering app-level timeouts. Combined with iOS playerror on the same assets, this points to a CDN or server-side delivery problem for BLOC_10, BLOC_15, BLOC_16 under peak load.

### iOS audio focus failures (non-fatal)

4929 `audiofocus_request_fail` on iOS vs. 52 on Android. High per-session counts: `4zq0` 1545, `c7qo` 1446, `4rma` 747, `19dh` 332. All completed walks regardless — ongoing iOS 26 beta issue, not walk-breaking.

---

## 6. Devices that did not complete the parcours

### Abandoned early

| Id     | Device      | Platform       | Max step | Done | Duration | Reason                                              |
|--------|-------------|----------------|----------|------|----------|-----------------------------------------------------|
| `nayi` | moto g04s   | Android 14     | 2        | 3    | 1h56m    | Walked first 3 steps by 12min, stopped. App ran ~2h. User abandoned. stale=60. |
| `4rma` | iPhone14,5  | iOS **18.5**   | 11       | 11   | 30m      | Walked cleanly to step 11, then nothing. Old iOS. audiofocusFail=747. Likely gave up. |
| `oupu` | SM-A515F    | Android 13     | 11       | 11   | 25m      | Walked cleanly to step 11 — **cut by staff rearm_button**. Operational error. |

### GPS-driven incomplete (reached step 14–15, missed final step 16)

| Id     | Device      | Platform     | Max step | GPS gaps | Issue                                          |
|--------|-------------|--------------|----------|----------|------------------------------------------------|
| `19dh` | iPhone14,5  | iOS 26.4.2   | 15       | 3×~2min  | GPS froze after step 15; step 16 never triggered |
| `vigi` | iPhone14,7  | iOS 26.4.2   | 15       | 0        | 3 voice_failed + 3 GPS-lost; step 16 never triggered |
| `51nv` | iPhone17,5  | iOS 26.3.1   | 15       | 4×2–14m  | Non-contiguous; step 16 never reached         |
| `ibk6` | iPhone14,5  | iOS 26.3.1   | 15(done) | 4×2–9m   | 4 gaps; step 16 never reached                 |
| `mq3z` | iPhone14,5  | iOS 26.3.1   | 13       | 3×2–8m   | Stopped at step 13; also 2 voice_failed early |
| `rumx` | iPhone14,5  | iOS 26.4.2   | 15       | 5×~2min  | 3 resumes + 27 audio errors; reached step 15 not 16 |

---

## 7. Summary table

| Category | Count | Key sessions |
|----------|-------|--------------|
| Clean full completions | **32** | §2a |
| Completed with crashes (walk recovered) | **8** | f743, mqgf, wjfo, 2j5u, h6os, kctv, 5kd4, others |
| Completed but GPS blackout (missed most content) | **4** | hpk9, ffqz, avm3, 7m25 |
| Incomplete — GPS blackout, missed last step(s) | **6** | 19dh, vigi, 51nv, ibk6, mq3z, rumx |
| Incomplete — user abandoned / operational cut | **3** | nayi, 4rma, oupu |
| App left running after completion | **4** | 7p2j, xuyx, 9hjo, mwbo |
| Noise (re-arms, blips ≤5min) | **29** | SM-A515F cluster + scattered |
| Pre-opening tests | 7 | |

---

## 8. Session classification

### EXCLUDE — Noise / test / post-walk (45 sessions)

| Sub-category | Sessions | Count |
|---|---|---|
| Pre-opening tests | `juow` `x0w3` `6wvb` `xcak` `95am` `faoy` `df6e` | 7 |
| SM-A515F re-arm blips (≤5min, 0 steps) | `yevh` `qetf` `mert` `lv8k` `quo5` `29p4` `524v` `hnto` `xsct` `jv47` + end-of-day cluster 17:10–17:28 | ~30 |
| Operator test between loans | `1r8h` | 1 |
| Post-walk idle (app left open after completion) | `7p2j` `xuyx` `9hjo` `mwbo` `tg6o` | 5 |
| Resumed already-finished session | `4o57` `xhde` | 2 |

**Total excluded: ~45**

---

### VALID — Clean full completions (32 sessions)

`2d5g` `pw5b` `k8ps` `kctv` `6epi` `ogro` `5kd4` `232o` `mqlj` `168c` `4zq0` `892p` `4fu5` `c7qo` `h6os` `dyo5` `9qf4` `knj6` `bi6k` `189t` `bm1g` `akbc` `5kkz` `yapj` `781m` `9iyw` `p04e` `n6id` `sqvb` `0d5l` `2tqf` `0vvc`

**Total: 32**

---

### VALID (with issues) — Completed but walk recovered (8 sessions)

| Id | Device | OS | Resumes | Audio errors | Notes |
|---|---|---|---|---|---|
| `f743` | SM-A155F | Android 16 | 7 | 0 | OEM-killed repeatedly, all steps done |
| `mqgf` | 22111317G | Android 14 | 4 | 0 | 4 crashes steps 12–16, clean |
| `wjfo` | SM-A045F | Android 14 | 4 | 15 | BLOC_10/15/16 audio failures |
| `2j5u` | RMX3286 | Android 13 | 3 | 0 | Clean |
| `h6os` | SM-A156B | Android 16 | 2 | 0 | Clean |
| `kctv` | 25062RN2DE | Android 16 | 1 | 0 | Clean |
| `ogro` | M2101K7AG | Android 11 | 1 | 0 | Clean |
| `5kd4` | SM-S901U1 | Android 16 | 1 | 0 | Clean |

**Total: 8**

---

### PROBLEMATIC — GPS blackout, technically complete but missed content (5 sessions)

| Id | Device | OS | Gap | Content heard |
|---|---|---|---|---|
| `ffqz` | 2201117TY | Android 13 | 34min | Last 1 step only |
| `avm3` | 2201117TY | Android 13 | 32min | Last 3 steps only |
| `hpk9` | SM-A515F | Android 13 | 36min | Last 2 steps only |
| `7m25` | SM-A515F | Android 13 | 2×17min | Steps 9–10 + 15–16 only |
| `ykr5` | 2312DRA50G | Android 15 | 10min | Most steps, moderate drift |

**Total: 5** — root cause: Android 13 GPS background kill → see P1

---

### PROBLEMATIC — GPS incomplete, walk stopped short (6 sessions)

| Id | Device | OS | GPS gaps | Reached | Key issue |
|---|---|---|---|---|---|
| `51nv` | iPhone17,5 | iOS 26.3.1 | 4 (worst 14min) | Step 15 | Missed steps 2–4, 9–12 |
| `ibk6` | iPhone14,5 | iOS 26.3.1 | 4 (worst 9min) | Step 15 | Missed steps 2–6, 8–9, 12–14 |
| `mq3z` | iPhone14,5 | iOS 26.3.1 | 3 (worst 8min) | Step 13 | Missed steps 3–7 + 2 audio errors |
| `rumx` | iPhone14,5 | iOS 26.4.2 | 5×~2min | Step 15 | 27 audio errors + 3 resumes |
| `19dh` | iPhone14,5 | iOS 26.4.2 | 3×~2min | Step 15 | Missed steps 9, 12, 16 |
| `vigi` | iPhone14,7 | iOS 26.4.2 | GPS-lost events | Step 15 | 21 audio errors on BLOC_10/15/16 |

**Total: 6** — iOS 26.3.1 → see P3 ; audio errors → see P2

---

### PROBLEMATIC — Abandoned or cut (3 sessions)

| Id | Device | OS | Max step | Cause |
|---|---|---|---|---|
| `nayi` | moto g04s | Android 14 | Step 2 | User abandoned, app ran 2h idle |
| `4rma` | iPhone14,5 | iOS 18.5 | Step 11 | Old iOS, 747 audiofocus fails, gave up |
| `oupu` | SM-A515F | Android 13 | Step 11 | **Staff re-armed mid-walk** — operational error |

**Total: 3**

---

### Grand total

| Category | Count |
|---|---|
| Exclude (noise / test / post-walk) | ~45 |
| Valid — clean | 32 |
| Valid — recovered | 8 |
| Problematic — GPS blackout (complete) | 5 |
| Problematic — GPS incomplete | 6 |
| Problematic — abandoned / cut | 3 |
| **Meaningful sessions (valid + problematic)** | **54** |

---

## 9. Priority issues

### P1 — Android 13 GPS background kill (catastrophic)
`hpk9`, `ffqz`, `avm3` are counted as "completed" but visitors heard less than 15% of narration. `ignoring_batt_opt=true` is set but GPS is still killed by the OS/manufacturer within 2 minutes. Needs a foreground service with a persistent location notification, or at minimum a user-visible GPS-lost alert so the visitor knows to reopen the app.

### P2 — BLOC_10 / BLOC_15 / BLOC_16 server delivery failures
These three step audio files failed on at least 3 sessions each across both Android and iOS, both webapp versions. `wjfo` had 9 audio timeout/stuck events on the same assets. Investigate CDN delivery or file availability on the server for these specific files under peak concurrent load.

### P3 — iOS 26.3.1 GPS multi-gap regression
`51nv`, `ibk6`, `mq3z` (all iOS 26.3.1) had 4–5 GPS gaps of 8–14 minutes each, far worse than iOS 26.4.2 sessions. Likely a beta-specific regression. If visitors on 26.3.1 appear in future sessions this will repeat.

### P4 — Staff operational: rearm_button cut active walk
`oupu` was re-armed mid-walk at step 11. Procedure needed: verify visitor has returned device before re-arming.

### P5 — App not closed after walk
4 sessions ran 1–2 hours post-completion, adding noise to GPS metrics and keeping server connections open. A clearer end-of-walk screen nudging the user to hand back the phone would help.
