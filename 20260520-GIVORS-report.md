# Field Test Report — 2026-05-20 · FLANERIE GIVORS

**Parcours:** FLANERIE_GIVORS (flanerie_givors_v7_cbr, 17 steps 0–16)  
**Files:** 110 total | 7 pre-opening (before 08:54) | 103 visitor-wave sessions  
**Expected visitors:** ~45–50 (15–20 on loaned phones)  
**Builds:** apk 12 or 13 / webapp `fdf504c8` (old, ~30 sessions) + `2f77776e` (new, ~70 sessions)  
**Generated:** 2026-05-22

---

## 0. Executive summary

### Visitor outcomes

| Outcome | Count | Sessions |
|---|---|---|
| Fully clean walk | **23** | see §8 VALID clean |
| Completed with friction (recovered) | **19** | see §8 VALID with issues |
| Did not complete | **6** | 19dh, vigi, 51nv, ibk6, mq3z, rumx |
| Abandoned | **1** | 4rma |
| Possible noise — needs investigation | **4** | hpk9, ffqz, avm3, nayi |
| Excluded (noise / test / post-walk) | **~45** | see §8 EXCLUDE |

### Issue hierarchy

| Class | Ref | Description | Sessions | Fix path |
|---|---|---|---|---|
| **SIGNIFICANT** | S1 | iOS 26.3.1 GPS multi-gap regression (8–14 min blackouts) — incomplete walks | 51nv, ibk6, mq3z | Version block/warn at onboarding → see R3 |
| **SIGNIFICANT** | S2 | BLOC_10/15/16 audio pre-load failure — narration missing or stalled | wjfo, vigi, rumx | Checksum + walk-start cache verify → see R2 |
| **MODERATE** | M1 | iOS 26.4.2 GPS brief gaps — walk stopped at step 15, last step never fired | 19dh, vigi, rumx | GPS-lost recovery UX → see R4 |
| **MODERATE** | M2 | step_resume_current stutter — 2 s audio jump-back on brief GPS dip | yapj, 9iyw, 0d5l, bi6k, 6epi, 168c, 5kkz, 2tqf | Gate on GPSSIGNAL_OK in spot.js → see R5 |
| **MINOR** | m1 | Android OEM kill — app crashed and refired step, walk recovered | f743, mqgf, wjfo, 2j5u | Foreground service (same as R1) |
| **MINOR** | m2 | iOS 26 audiofocus failures — 4929 events fleet-wide, never walk-breaking | c7qo, 4zq0, 4rma, 19dh | Monitor; known iOS 26 beta issue |
| **MINOR** | m3 | No walk-end shutdown — GPS/audio kept running 1–2 h post-completion, telemetry not flushed | 7p2j, xuyx, 9hjo, mwbo | Proper walk-end sequence (flush telemetry, stop engines, lock UI) → see R10 |
| **TOOLING** | t1 | No walk-start cache verification — P2 root cause cannot be confirmed from telemetry | — | Add `walk_start_cache_verify` event → see R9 |
| **TOOLING** | t2 | Audio error events do not distinguish missing-file / decode / timeout | — | Split error subtypes → see R9 |
| **TOOLING** | t3 | Download check is name+size only — corrupt download is undetectable | — | Add checksum → see R9 |
| **TOOLING** | t4 | No loan-device flag in telemetry — loan phones indistinguishable from visitor devices without manual cross-reference | SM-A515F fleet + all loaned sessions | Loan toggle + persistent UUID in devmode → see R11 |

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

> **Note — `oupu` (08:58):** Session cut at step 11 by `session_restart reason=rearm_button`. Treated as operator/test session — excluded from visitor stats.

### 1c. App left running after walk end

| Id     | Device        | Duration | Note                                                        |
|--------|---------------|----------|-------------------------------------------------------------|
| `7p2j` | iPhone14,2    | 1h20m    | Resumed at step 16 done=true; no steps fired; left running  |
| `xuyx` | iPhone14,2    | 1h49m    | Same — 6 GPS gaps = phone stationary                        |
| `9hjo` | iPhone15,2    | 1h17m    | Completed at 46m, GPS froze 29min post-walk (app left open) |
| `mwbo` | SM-A515F      | 1h50m    | Resumed complete, GPS frozen 110min                         |
| `tg6o` | 25062RN2DE    | 33s      | 33-second re-open of already-complete session at 12:37      |

---


## 2. Session analysis and classification

### EXCLUDE — Noise / test / post-walk (~45 sessions)

| Sub-category | Sessions | Count |
|---|---|---|
| Pre-opening tests | `juow` `x0w3` `6wvb` `xcak` `95am` `faoy` `df6e` | 7 |
| SM-A515F re-arm blips (≤5min, 0 steps) | `yevh` `qetf` `mert` `lv8k` `quo5` `29p4` `524v` `hnto` `xsct` `jv47` + end-of-day cluster 17:10–17:28 | ~30 |
| Operator test between loans | `1r8h` `oupu` | 2 |
| Post-walk idle (app left open after completion) | `7p2j` `xuyx` `9hjo` `mwbo` `tg6o` | 5 |
| Resumed already-finished session | `4o57` `xhde` | 2 |

**Total excluded: ~45**

---

### VALID — Clean full completions (23 sessions)

| Session | Device model | Platform | OS |
|---------|-------------|----------|----|
| `2d5g` | FP3 (Fairphone 3) | Android | — |
| `pw5b` | iPhone15,2 (iPhone 14 Pro) | iOS | — |
| `k8ps` | iPhone15,2 (iPhone 14 Pro) | iOS | — |
| `232o` | CPH2065 (OPPO A92) | Android | — |
| `mqlj` | Pixel 6a | Android | — |
| `4fu5` | SM-G525F (Galaxy XCover5) | Android | — |
| `dyo5` | SM-G973F (Galaxy S10) | Android | — |
| `9qf4` | SM-A125F (Galaxy A12) | Android | — |
| `knj6` | 23117RA68G (Xiaomi 13T) | Android | — |
| `189t` | SM-S721B (Galaxy S24 FE) | Android | — |
| `bm1g` | iPhone14,4 (iPhone 13 mini) | iOS | — |
| `akbc` | iPhone12,8 (iPhone SE 2nd gen) | iOS | — |
| `781m` | Pixel 6a | Android | — |
| `p04e` | SM-A336B (Galaxy A33) | Android | — |
| `n6id` | SM-A145R (Galaxy A14) | Android | — |
| `sqvb` | iPhone16,1 (iPhone 15) | iOS | — |
| `kctv` | 25062RN2DE (Realme GT 6T) | Android | Android 16 |
| `5kd4` | SM-S901U1 (Galaxy S22) | Android | Android 16 |
| `4zq0` | iPhone14,2 (iPhone 13 Pro) | iOS | — |
| `892p` | SM-A566B (Galaxy A56) | Android | — |
| `ogro` | M2101K7AG (Xiaomi Redmi Note 10 Pro) | Android | Android 11 |
| `c7qo` | iPhone14,7 (iPhone 14) | iOS | iOS 26.4.2 |
| `h6os` | SM-A156B (Galaxy A15) | Android | Android 16 |

**Total: 23 · Platform split: 14 Android · 9 iOS**

All 17 steps (0–16) fired in strict sequential order with no gaps, no audio errors, no GPS gaps ≥90s.

> **Step 4 — walk design:** `ogro`, `c7qo`, `h6os` show step 4 fired then GPS moves to step 5 zone ~1.5min later without step 4 confirming done. Intentional: step 4 is a choice step where visitors can linger or move on.

#### Recurring structural patterns (not errors)
- **`step_skip_done` on steps 8, 13, 15** — consistent fleet-wide. These steps have overlapping GPS zones; both outgoing and incoming zones confirm done before the next step fires. Expected behaviour.
- **Silent passage between steps 9 and 10** — 3–4 minute gap between step 9 done and step 10 fire across nearly all sessions. Walker is moving between two non-overlapping zones. Likely intentional, worth noting as a listener experience gap.

#### Borderline moments

| Session | Device | What happened |
|---------|--------|---------------|
| `bm1g` | iPhone14,4 | `stale=27` GPS fixes throughout. Walk completed cleanly but GPS fix quality was low. |
| `4zq0` | iPhone14,2 | `triggerRejected=114` — GPS polled actively but position was unstable. Walk unaffected. |

---

### VALID — Completed with issues (19 sessions)

| Id | Device | OS | Resumes | Audio errors | Notes |
|---|---|---|---|---|---|
| `f743` | SM-A155F | Android 16 | 7 | 0 | OEM-killed repeatedly, all steps done |
| `mqgf` | 22111317G | Android 14 | 4 | 0 | 4 crashes steps 12–16, clean |
| `wjfo` | SM-A045F | Android 14 | 4 | 15 | BLOC_10/15/16 audio failures — see below |
| `2j5u` | RMX3286 | Android 13 | 3 | 0 | Clean |
| `h6os` | SM-A156B | Android 16 | 2 | 0 | 2 resumes (OEM kill) |
| `ogro` | M2101K7AG | Android 11 | 1 | 0 | audioTimeout=1, audioStuck=1, lost=1/rec=1 |
| `c7qo` | iPhone14,7 | iOS 26.4.2 | 0 | 0 | audiofocusFail=1446 (iOS 26, non-fatal) |
| `0vvc` | SM-A047F | Android 14 | 2 | 3 | 3 audio errors + timeout/stuck |
| `kctv` | 25062RN2DE | Android 16 | 1 | 0 | 1 resume, clean |
| `5kd4` | SM-S901U1 | Android 16 | 1 | 0 | 1 resume, clean |
| `yapj` | SM-G990B2 | Android 13 | 1 | 0 | 4× step_resume_current (steps 9, 12, 13) — audio restart on GPS quality recovery (see P6) |
| `0d5l` | SM-S901U1 | Android 14 | 1 | 0 | 1× step_resume_current (step 4, 15.2min) — audio restart on GPS quality recovery (see P6) |
| `9iyw` | iPhone15,2 | iOS 26.4.2 | 0 | 0 | 1× step_resume_current (step 1, 6.9min) — audio restart on GPS quality recovery (see P6) |
| `bi6k` | SM-G970U1 | Android 12 | 0 | 0 | lost=2/rec=2 quiet recovery — step_resume_current likely each time (see P6) |
| `6epi` | iPhone14,2 | iOS 26.4.2 | 0 | 0 | lost=1/rec=1 — step_resume_current likely triggered (see P6) |
| `168c` | 24117RN76E | Android 14 | 0 | 0 | lost=1/rec=1 — step_resume_current likely triggered (see P6) |
| `5kkz` | SM-S938B | Android 14 | 0 | 0 | lost=1/rec=1 — step_resume_current likely triggered (see P6) |
| `2tqf` | moto g24 power | Android 14 | 0 | 0 | lost=1/rec=1 — step_resume_current likely triggered (see P6) |
| `ykr5` | 2312DRA50G (Xiaomi 13T) | Android 15 | 0 | 0 | stale=161, triggerRejected=176 — 10min gap in fresh fixes during step 15 masked by stale positions; no gps_lost fired, audio uninterrupted; all 17 steps heard |

**Total: 19**

#### OEM kills and crashes (Android)
On Android 14 and 16, the app is OEM-killed roughly every 5–8 minutes in the second half of the walk. The resume machinery works correctly: it refires the current step and continues. No walk was lost to a crash (`f743` 7 kills, `mqgf` 4, `wjfo` 4, `2j5u` 3, `h6os` 2, `kctv`/`5kd4`/`ogro` 1 each). → see R6

#### Audio pre-load failures (BLOC_10 / BLOC_15 / BLOC_16)
The same three files failed across `wjfo` (Android), `vigi` (iOS), and `rumx` (iOS):

| File | Failing sessions |
|------|-----------------|
| `GIVORS26_P1_BLOC_10_ICI_POEME_A_AMBIANCE_V3_CBR.mp3` | wjfo, vigi, rumx |
| `GIVORS26_P1_BLOC_10_ICI_POEME_B_MUSIC_V2_CBR.mp3` | wjfo, vigi, rumx |
| `GIVORS26_P1_BLOC_16_Voix_Puzzle_V7_CBR.mp3` | vigi, rumx, wjfo |
| `GIVORS26_P1_BLOC_15_Peau_Mobile_VOIX_V4_CBR.mp3` | vigi, rumx, wjfo |
| `GIVORS26_P1_BLOC_15_Peau_Mobile_MUSIC_V4_CBR.mp3` | rumx, wjfo |

`wjfo` had 9 `audioTimeout`/`audioStuck` events on these files — consistent with a large-file decode stall on a low-end device already under OEM-kill pressure (sub-class B). The iOS `playerror` on `vigi` and `rumx` point to file missing or corrupt at play time (sub-class A). Media is pre-loaded to persistent storage; root cause under investigation — see P2, R2.

#### iOS audiofocus failures (non-fatal)
4929 `audiofocus_request_fail` fleet-wide on iOS vs. 52 on Android. High per-session: `4zq0` 1545, `c7qo` 1446, `4rma` 747, `19dh` 332. All walks completed regardless — known iOS 26 beta issue, not walk-breaking — see m2.

---

### PROBLEMATIC — GPS blackout (technically complete, heard <20% of content) (0 sessions)

All sessions previously in this category have been moved to POSSIBLE NOISE — needs investigation. No confirmed visitor walk with catastrophic GPS blackout this day.

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

**Total: 6**

**iOS 26.3.1** (`51nv`, `ibk6`, `mq3z`): 4–5 GPS gaps of 8–14 minutes each, far worse than 26.4.2. Likely a beta-specific regression. `step_skip_done` bursts confirm route catchup after each gap. → see P3, R3

**iOS 26.4.2** (`rumx`, `19dh`, `vigi`): shorter gaps (2–5 min) but all three stopped at step 15 without triggering step 16. `rumx` and `vigi` were further degraded by audio failures on the same BLOC_10/15/16 files. → see M1, R4

---

### PROBLEMATIC — Abandoned (1 session)

| Id | Device | OS | Max step | Reason |
|---|---|---|---|---|
| `4rma` | iPhone14,5 | iOS 18.5 | Step 11 | Walked cleanly to step 11 then stopped. Old iOS, 747 audiofocus fails. Likely gave up. |

**Total: 1**

---

### POSSIBLE NOISE — needs investigation (4 sessions)

Sessions that show the telemetry signature of a visitor walk (steps fired, GPS moving) but may be loan phones moved by staff rather than genuine visitor experiences. Keep observed data on record; reclassify once confirmed.

| Id | Device | OS | Observed | Why suspicious |
|---|---|---|---|---|
| `hpk9` | SM-A515F | Android 13 | 36min GPS gap, reached step 16 | SM-A515F is the house loan phone; 36min blackout from step 0 consistent with phone pocketed/carried by staff, not a deliberate walk |
| `ffqz` | 2201117TY | Android 13 | 34min GPS gap, stepped to 16 | Identical blackout pattern to `avm3` on same device model; both starting within minutes of each other suggests staff handling, not two independent visitors |
| `avm3` | 2201117TY | Android 13 | 32min GPS gap, stepped to 16 | Same device model as `ffqz`, near-simultaneous start, identical failure mode |
| `7m25` | SM-A515F | Android 13 | 2×17min GPS gap, reached step 16 | SM-A515F is the house loan phone; two large blackout gaps consistent with phone pocketed/carried by staff between re-arms, not a deliberate walk |
| `nayi` | moto g04s | Android 14 | Steps 0–2 in 12min, app idle 2h | Only 3 steps in 12min then nothing for 2h; stale=60 throughout; could be a staff device left running or placed on a table after a failed setup |

**Total: 5** — if all confirmed as noise: meaningful session count drops to 48; Android 13 GPS blackout (C1) becomes a non-issue for this day.

---

### Grand total

| Category | Count |
|---|---|
| Exclude (noise / test / post-walk) | ~45 |
| Valid — clean | **23** |
| Valid — with issues | **19** |
| Problematic — GPS blackout (complete) | 0 |
| Problematic — GPS incomplete | 6 |
| Problematic — abandoned | 1 |
| Possible noise — needs investigation | 5 |
| **Meaningful sessions (valid + problematic, excl. possible noise)** | **48** |
---

## 9. Priority issues

### P1 — Android 13 GPS background kill (non-issue for this day — pending noise confirmation)
All four sessions showing the Android 13 GPS blackout pattern (`hpk9`, `ffqz`, `avm3`, `7m25`) have been moved to POSSIBLE NOISE — they are likely loan phones moved by staff rather than genuine visitor walks. C1 is not a confirmed visitor-impacting issue for 2026-05-20. The failure mode remains real (silent GPS kill on Android 13, `ignoring_batt_opt=true` ineffective) and the foreground service fix (R1) is still the correct long-term safeguard — but it has no confirmed victim this day.

### P2 — BLOC_10 / BLOC_15 / BLOC_16 audio failures (pre-loaded media — root cause unclear)

Media is downloaded during onboarding (name + size verified). Runtime server delivery is not the cause. Two distinct failure sub-classes are visible:

**Sub-class A — file missing or corrupt at play time (`playerror` / `step_voice_failed`):**
`vigi` (21 errors, 3 voice_failed on BLOC_10/15/16) and `rumx` (27 errors, 2 voice_failed) are the primary cases. Both sessions also had GPS gaps and app instability, which complicates attribution — some playerrors may be the audio element erroring during app recovery state rather than a file integrity problem. However the concentration on the same three files across both Android and iOS points toward those specific files being unavailable at play time on affected devices.

Downloads land in persistent storage (not cache-class), so OS eviction is ruled out. Likely causes in order of probability:
1. **Corrupt download passing the size check** — a range-resumed or interrupted transfer can produce a file at the expected byte count with damaged MP3 frame data. A byte-count check passes; a checksum check would catch it.
2. **Path/URI mismatch at play time** — file written to one path during onboarding, audio element constructed with a different URI at walk time (Cordova `cdvfile://` vs `file://`, case sensitivity, or path rebuilt incorrectly after an OEM kill/resume). File is present and intact but the player can't find it.

**Sub-class B — decode stall on low-end hardware (`audioTimeout` / `audioStuck`):**
`wjfo` (SM-A045F Android 14, already OEM-killed 4×) had 9 timeout/stuck events on the same three files with 0 voice_failed. The audio element found the files but could not begin playback within the timeout window. This is consistent with large files overwhelming the decode pipeline of a weak, already-stressed CPU — a performance issue independent of file integrity.

**Hypothesis:** BLOC_10, BLOC_15, BLOC_16 are likely the longest/largest files in the parcours. Verify file sizes. If they are outliers in size, both sub-classes are explained: large = first evicted by OS, large = decode stall on weak hardware.

**Recommended telemetry improvements — see §9a below.**

### P3 — iOS 26.3.1 GPS multi-gap regression
`51nv`, `ibk6`, `mq3z` (all iOS 26.3.1) had 4–5 GPS gaps of 8–14 minutes each, far worse than iOS 26.4.2 sessions. Likely a beta-specific regression. If visitors on 26.3.1 appear in future sessions this will repeat.

### P4 — Staff operational: rearm_button cut active walk
`oupu` was re-armed mid-walk at step 11. Procedure needed: verify visitor has returned device before re-arming.

### P5 — App not closed after walk
4 sessions ran 1–2 hours post-completion, adding noise to GPS metrics and keeping server connections open. A clearer end-of-walk screen nudging the user to hand back the phone would help.

### P2a — Telemetry improvements for audio pre-load diagnosis

Current onboarding check (name + size) cannot distinguish the failure modes in P2. Suggested additions:

| Event to add | Where | What to log | Catches |
|---|---|---|---|
| `onboarding_file_check` | End of onboarding, per file | `{ file, expected_size, actual_size, status: ok\|missing\|size_mismatch }` | Missing or truncated download at onboarding time |
| `walk_start_cache_verify` | Before step 0 fires | `{ files_ok, files_missing: [...], files_corrupt: [...] }` | Cache eviction between onboarding and walk |
| Checksum field in `onboarding_file_check` | Same | `sha1` or `crc32` of downloaded file vs manifest | Corrupt download that passes size check |
| Split audio error codes | `step_voice` error event | `error_type: not_found \| decode_failed \| timeout \| stuck` | Separate missing-file from decode-stall from timeout — currently all lumped under `step_voice` |
| `audio_uri_resolved` | When audio element `src` is set | `{ file, uri_used }` — log the exact URI the player constructs | Path/URI mismatch between onboarding write path and play-time path |

The single most impactful addition is **`walk_start_cache_verify`**: if it had fired on `vigi` and `wjfo`, we would know immediately whether the files were present at walk start or already gone, eliminating all ambiguity about cause.

---

### P6 — step_resume_current double-resume on GPS quality recovery (non-critical / annoying)

**Affected sessions:** `yapj` (4× confirmed), `9iyw`, `0d5l` (1× confirmed each), `bi6k`, `6epi`, `168c`, `5kkz`, `2tqf` (1× likely each).

**Mechanism:** When GPS signal drops for ≥10 s, `stateUpdateTimeout` fires in `geoloc.js:308` → `pauseAllPlayers()` is called → audio paused, `gps_lost` overlay shown. On recovery, the first incoming position enters the zone check in `spot.js:609` — `step_resume_current` fires and calls `player.resume()` directly, *before* `GPSSIGNAL_OK` has been set back to `true`. Up to 1 second later, `stateUpdate('ok')` fires in `pages.js` → `GPSSIGNAL_OK = true` → `resumeAllPlayers()` iterates `PAUSED_PLAYERS` and calls `player.resume()` a **second time** on the same already-playing player. Result: audio jumps back a couple of seconds. Visitor perception: brief narration restart.

**Fix Option A (recommended):** Gate `step_resume_current` on `GPSSIGNAL_OK` in `spot.js:609`:
```js
if (this._index == PARCOURS.currentStep() && this.player.isPaused() && this.near(position) && inside
    && (typeof GPSSIGNAL_OK === 'undefined' || GPSSIGNAL_OK))
```
The first recovered position is ignored by `step_resume_current`; `resumeAllPlayers()` handles the resume cleanly ~1 s later. Targeted fix — does not affect GPS-loss detection sensitivity.

**Fix Option B (alternative):** Raise `stateUpdateTimeout` from `10000` to `20000` in `geoloc.js:308`. Prevents brief <20 s GPS dips from triggering the full pause/overlay cycle at all. Downside: genuine GPS loss events are not announced to the walker for 20 s instead of 10 s.

---

## 10. Fix roadmap

Use this table to track implementation. Fill **Status** and **Done — what was implemented** as work progresses. The **Addresses** column is the changelog entry: what real-world visitor experience each fix tackles.

| Ref | Issue (§0 class) | Priority | Effort | Fix proposal | Status | Done — what was implemented | Addresses (visitor impact) |
|---|---|---|---|---|---|---|---|
| R1 | ~~C1~~ — Android 13 GPS background kill | ~~Critical~~ **Monitor** | High | Foreground location service with persistent notification. Keeps GPS provider alive under screen-lock. Covers Android 13 OEM throttle that `ignoring_batt_opt` does not prevent. | **Deferred** — no confirmed visitor casualty this day (all 4 blackout sessions moved to possible noise). Revisit if confirmed on future days. | | If confirmed: visitors on Android 13 would hear <20% of narration because GPS is silently killed by the OS within 2 min of walk start. |
| R2 | S2 — BLOC_10/15/16 pre-load failure | **High** | Medium | (a) Add SHA/CRC checksum to download manifest and verify post-write at onboarding. (b) Implement `walk_start_cache_verify` (re-check all step files present + readable before step 0 fires). (c) Log exact URI used when audio `src` is set (`audio_uri_resolved`). Diagnose from next occurrence before patching further. | Open | | Visitors on affected devices heard silence or experienced repeated retries on specific narration steps (BLOC_10, BLOC_15, BLOC_16). |
| R3 | S1 — iOS 26.3.1 GPS regression | **High** | Low | Add iOS version check at onboarding. Warn or block if version is 26.3.1 (or any 26.x below a confirmed-good threshold). Display a message asking visitor to update iOS before walking. | Open | | Visitors on iOS 26.3.1 experienced GPS blackouts of 8–14 min, missing large portions of the route and stopping mid-walk. |
| R4 | M1 — iOS 26.4.2 GPS incomplete (step 16 unreached) | **Medium** | Medium | Investigate GPS-lost UX path: when GPS-lost overlay fires near end of route, add explicit instruction ("keep the screen on / move to open sky"). Consider reducing `stateUpdateTimeout` on iOS or adding a "resume walk" nudge after recovery. | Open | | Visitors on iOS 26.4.2 reached the final area but the last narration step (step 16) never triggered due to a GPS gap, leaving the walk unfinished without explanation. |
| R5 | M2 — step_resume_current double-resume stutter | **Medium** | Low | Gate `step_resume_current` condition on `GPSSIGNAL_OK` in `spot.js:609`: add `&& (typeof GPSSIGNAL_OK === 'undefined' \|\| GPSSIGNAL_OK)` — see P6 for full code. | Open | | Visitors with a brief GPS signal dip heard the current narration jump back ~2 seconds when GPS recovered, because the player was resumed twice in quick succession. |
| R6 | m1 — Android OEM kill / app crash | **Low–Med** | High | Foreground service (same work as R1) prevents most OEM kills. Until then, existing resume machinery handles recovery correctly — monitor for regression. | Monitor | | Visitors on some Android devices experienced the app being killed mid-walk by the OS. The walk recovered automatically (step refired) but may have caused a brief interruption. |
| R9 | t1/t2/t3 — Telemetry gaps | **Medium** | Low | (t1) `walk_start_cache_verify` before step 0. (t2) Split audio error events into `not_found / decode_failed / timeout / stuck` subtypes. (t3) Add checksum field to `onboarding_file_check`. (bonus) Log `audio_uri_resolved` when player `src` is set. See §9 P2a for full event spec. | Open | | Several issue root causes (audio failures, GPS blackouts) could not be fully diagnosed from current telemetry. These additions enable precise attribution in future sessions. |
| R11 | t4 — Loan device identification | **Medium** | Low | Add a **loan device toggle** in devmode settings. When enabled: (1) generate and persist a stable UUID for that device (stored in persistent app storage, survives app kills and re-arms, regenerated only on explicit reset); (2) emit `device_role: "loan"` + `loan_device_id: <uuid>` in every `session_diag` event. Benefits: telemetry analysis can automatically bucket loan sessions without manual cross-reference; same-model devices (e.g. two SM-A515F units) become distinguishable across days; re-arm blips from a known loan phone can be filtered programmatically. UUID should be shown in the devmode UI so staff can label it (e.g. "Phone A"). | Open | | Separating loan phone noise from genuine visitor sessions required manual cross-referencing of device models, session timing, and session counts. Two identical device models could not be distinguished. |
| R10 | m3 / new — Proper walk-end shutdown | **Medium** | Medium | When last step voice audio finishes playing: (1) emit `walk_complete` telemetry event and flush/push the session file to server immediately; (2) stop GPS engine (unregister location listener); (3) stop all audio engines and release audio focus; (4) if platform allows, close the app — otherwise show a prominent "walk complete, please return this phone" screen and lock the UI to prevent further GPS/audio activity. Prevents the 1–2 h idle sessions seen on loaned phones and ensures telemetry is delivered even if the app is subsequently killed. | Open | | After completing the walk, loaned phones kept GPS and audio engines running for up to 2 hours, producing telemetry noise and holding server connections open. Visitors had no clear signal that the experience was over. |
