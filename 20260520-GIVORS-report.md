# Field Test Report — 2026-05-20 · FLANERIE GIVORS

**Parcours:** FLANERIE_GIVORS (id `flanerie_givors_v7_cbr`, 17 steps 0–16 — confirmed from the live parcours JSON `spots.steps`). 2 sessions ran a stale 18-step cached config — see §11.  
**Files:** 110 total | 7 pre-opening (before 08:54) | 103 visitor-wave sessions  
**Field reports cross-referenced:** Mélanie (FP3 08:57), John (~16h loan phone), Justine (operator tent), unnamed teacher (iPhone 09h–09h30)  
**Expected visitors:** ~45–50 (15–20 on loaned phones)  
**Builds:** apk 12 (iOS) / apk 13 (Android) — apk just tracks platform, not a within-platform skew. webapp `fdf504c8` + `2f77776e` are split **roughly evenly per device** (~29 / ~35 visitor sessions), not 30/70; the version is per-device PWA cache, not a timed rollout. Which build is newer is **not confirmed** — see §11.  
**Generated:** 2026-05-22 · **Revised:** 2026-05-22 (telemetry cross-check)

---

## 1. Executive summary

### Visitor outcomes

| Outcome | Count | Sessions |
|---|---|---|
| Fully clean walk | **16** | see §2 VALID clean |
| Completed with friction (recovered) | **21** | see §2 VALID with issues |
| Did not complete — GPS | **5** | 51nv, ibk6, mq3z, rumx, 19dh |
| Did not complete — audio | **1** | vigi |
| Abandoned | **1** | 4rma |
| Excluded (pre-opening / operator / post-walk / staff-handled) | **~51** | see §2 EXCLUDE |

### Issue hierarchy

| Class | Ref | Description | Sessions | Fix path |
|---|---|---|---|---|
| **SIGNIFICANT** | S1 | iOS 26.3.1 GPS multi-gap regression (8–14 min blackouts) — incomplete walks | 51nv, ibk6, mq3z | Version block/warn at onboarding |
| **SIGNIFICANT** | S2 | Audio narration failures spanning many BLOC files — load failures (`audio_loaderror`) and playback failures (`audio_playerror`), not 3 specific files; concentrated on large files and stressed devices | wjfo, vigi, rumx (+ mq3z, 0vvc) | Walk-start cache verify + checksum |
| **MODERATE** | M1 | iOS 26.4.2 GPS brief gaps (2–5 min) — walk stopped at step 15, last step never fired | 19dh, rumx | GPS-lost recovery UX |
| **MODERATE** | M2 | step_resume_current stutter — 2 s audio jump-back; in severe cases GPS places phone just inside the adjacent zone, current step marked done prematurely, wrong step starts. List rebuilt from `stepResumeCurrent` telemetry — see §P6 | yapj, 19dh, 189t, 5kd4, c7qo, h6os, 5kkz, 2tqf (≥2×) | Gate on GPSSIGNAL_OK in spot.js |
| **MODERATE** | M3 | Silent audio on loan-phone re-arm — walk page loads normally after 4321 GO but audio does not start; navigating to app root and back resolves it; recurs 4–5 times/day | SM-A515F loan phone (Justine, operator) | Proper walk-end shutdown + audio engine reset on new session → see P7 |
| **MINOR** | m1 | Android OEM kill — app crashed and refired step, walk recovered. ~20 sessions had ≥1 `session_resume` (now all visible since `analyze` flags `resumes≥1`) — heaviest: f743 (7), mqgf (4), wjfo (4), 2j5u/rumx (3) | f743, mqgf, wjfo, 2j5u, rumx, **2d5g** + ~14 more | Foreground service |
| **MINOR** | m2 | iOS audiofocus failures — 4929 events fleet-wide, never walk-breaking. Not iOS-26-only: iOS 18 devices also hit it (4rma 747 on 18.5, 7p2j 272 on 18.0) | c7qo, 4zq0, 4rma, 19dh, 7p2j, xuyx | Monitor; iOS-wide audiofocus contention |
| **MINOR** | m3 | No walk-end shutdown — GPS/audio kept running 1–2 h post-completion, telemetry not flushed | 7p2j, xuyx, 9hjo, mwbo | Proper walk-end sequence (flush telemetry, stop engines, lock UI) |
| **TOOLING** | t1 | No walk-start cache verification — P2 root cause cannot be confirmed from telemetry | — | Add `walk_start_cache_verify` event |
| **TOOLING** | t2 | Audio error events do not distinguish missing-file / decode / timeout | — | Split error subtypes |
| **TOOLING** | t3 | Download check is name+size only — corrupt download is undetectable | — | Add checksum |
| **TOOLING** | t4 | No loan-device flag in telemetry — loan phones indistinguishable from visitor devices without manual cross-reference | SM-A515F fleet + all loaned sessions | Loan toggle + persistent UUID in devmode |

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
| Staff / team transfer phones (not visitor walks) | `hpk9` `ffqz` `avm3` `7m25` `nayi` | 5 |

**Total excluded: ~51**

> `hpk9` and `7m25` are SM-A515F; `ffqz`/`avm3` are the same physical Xiaomi 2201117TY used twice — `ignoring_batt_opt=true` does not prevent Android 13 from killing the GPS provider, so if `ffqz`/`avm3` is ever loaned to a visitor the blackout will recur. `nayi` (moto g04s): steps 0–2 then idle 1h44m — confirmed team transfer phone.

---

### VALID — Clean full completions (16 sessions)

| Session | Device model | Platform | OS |
|---------|-------------|----------|----|
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

All steps fired in strict sequential order with no GPS gaps ≥90s and no audio errors.

> **Clean count corrected to 16 (2026-05-22 telemetry cross-check).** The original 22-row table was inflated two ways: (1) **five sessions were double-listed** — they also appear in VALID with issues and belong only there: `kctv`, `ogro`, `5kd4`, `c7qo`, `h6os`; (2) **`189t`** has the P6 step_resume_current stutter ×3 and moves to with issues. The genuinely clean set (no issue in any table) is **16**: `pw5b, k8ps, 232o, mqlj, 4fu5, dyo5, 9qf4, knj6, bm1g, akbc, 781m, p04e, n6id, sqvb, 4zq0, 892p`. See §P6 for the step_resume_current detail.

> **Note — `892p` and `c7qo` ran a stale 18-step parcours config** (`FLANERIE_GIVORS_V7_CBR`, steps 0–17) rather than the live 17-step `FLANERIE_GIVORS`. Both completed their config cleanly; this is a PWA-cache skew, not a content issue — see §11.

> **Note — `2d5g` reclassified (2026-05-22 field report):** Session initially classified as clean; raw events show 1 `session_resume` at step 12 (BLOC_13_Alex_Secours, 25 min in) not captured in session_diag summary. Mélanie (Fairphone, reported "app crashed after taking a photo") matches this session exactly (device FP3, start 08:57:59). She opened the camera app → Android killed Flanerie → auto-resumed at 42.3 s into BLOC_13 audio. Walk completed to step 16. Moved to VALID with issues (m1).

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

### VALID — Completed with issues (21 sessions)

`SRC` = `step_resume_current` count (from the new `analyze` flag). `Audio` = real `step_voice` errors, split play/load.

| Id | Device | OS | Res | SRC | Audio | Notes |
|---|---|---|---|---|---|---|
| `2d5g` | FP3 (Fairphone 3) | Android 13 | 1 | 0 | 0 | OEM kill at step 12 (BLOC_13) when visitor opened camera — Mélanie field report |
| `f743` | SM-A155F | Android 16 | 7 | 0 | 0 | OEM-killed ×7, all steps done |
| `mqgf` | 22111317G | Android 14 | 4 | 0 | 0 | 4 OEM kills steps 12–16, recovered |
| `wjfo` | SM-A045F | Android 14 | 4 | 0 | 15 load | `audio_loaderror` ×15 across 8 BLOC files (01,02,03,10,11,13,15,16) + 9 timeout / 9 stuck — see §P2 |
| `2j5u` | RMX3286 | Android 13 | 3 | 0 | 0 | 3 OEM kills, recovered |
| `h6os` | SM-A156B | Android 16 | 2 | 2 | 0 | 2 OEM kills + 2× step_resume_current (see §P6) |
| `ogro` | M2101K7AG | Android 11 | 1 | 0 | 0 | audioTimeout=1, audioStuck=1, lost=1/rec=1 |
| `c7qo` | iPhone14,7 | iOS 26.4.2 | 0 | 2 | 0 | 2× step_resume_current (see §P6); audiofocusFail=1446; ran 18-step config (§11) |
| `0vvc` | SM-A047F | Android 14 | 2 | 0 | 3 load | `audio_loaderror` ×3 on BLOC_13/15/16 + timeout/stuck (new webapp `2f77776e`) |
| `kctv` | 25062RN2DE | Android 16 | 1 | 0 | 0 | 1 OEM kill, recovered |
| `5kd4` | SM-S901U1 | Android 16 | 1 | 2 | 0 | 1 OEM kill + 2× step_resume_current (see §P6) — was mis-listed clean |
| `189t` | SM-S721B | Android 16 | 0 | 3 | 0 | 3× step_resume_current (see §P6) — was mis-listed clean |
| `yapj` | SM-G990B2 | Android 13 | 1 | 4 | 0 | 4× step_resume_current at steps 9/12/13/13, `border` −0.25 to −0.64 m — GPS zone overshoot — John field report (see §P6a) |
| `0d5l` | SM-S901U1 | Android 14 | 1 | 1 | 0 | 1× step_resume_current (step 4, 15.2min) |
| `9iyw` | iPhone15,2 | iOS 26.2.1 | 0 | 1 | 0 | 1× step_resume_current (step 1, 6.9min) |
| `5kkz` | SM-S938B | Android 14 | 0 | 2 | 0 | 2× step_resume_current — **confirmed** (report previously guessed "likely") |
| `2tqf` | moto g24 power | Android 14 | 0 | 2 | 0 | 2× step_resume_current — **confirmed** (report previously guessed "likely") |
| `bi6k` | SM-G970U1 | Android 12 | 0 | 0 | 0 | lost=2/rec=2 brief GPS dips, recovered cleanly — **0× step_resume_current** (report previously guessed "likely") |
| `6epi` | iPhone14,2 | iOS 18.0 | 0 | 0 | 0 | lost=1/rec=1 brief GPS dip, recovered cleanly — **0× step_resume_current** (report previously guessed "likely") |
| `168c` | 24117RN76E | Android 14 | 0 | 0 | 0 | lost=1/rec=1 brief GPS dip, recovered cleanly — **0× step_resume_current** (report previously guessed "likely") |
| `ykr5` | 2312DRA50G (Xiaomi 13T) | Android 15 | 0 | 0 | 0 | stale=161, triggerRejected=176; **45-min stall** between step 15 fire (35.9min) and step 16 (81.5min) — session ran 82min, ~2× normal — see note below |

**Total: 21** — `189t` moved in from "clean" (the original 20 rows + `189t`); `c7qo`/`5kd4`/`h6os` gained step_resume_current notes; `bi6k`/`6epi`/`168c` kept but their P6 guess corrected to 0×.

> **Note — `ykr5` 45-minute stall (corrected 2026-05-22):** an earlier draft described this as a "10 min GPS gap." The GPS fix gap was ~10 min, but the step timeline shows step 15 *fired* at 35.9 min and only *completed* (→ step 16) at **81.5 min** — a 45-minute stall. Total session 1h22m, roughly double a normal walk. Either the visitor took a very long break at the BLOC_15 area or the phone was left and finished later; "audio uninterrupted, all 17 steps heard" is not safe to assert.

#### OEM kills and crashes (Android)
On Android 14 and 16, the app is OEM-killed repeatedly in the second half of the walk. The resume machinery works correctly: it refires the current step and continues — no walk was lost to a crash. With `analyze` now flagging every `resumes≥1`, **~20 sessions** show at least one mid-walk relaunch (heaviest: `f743` 7, `mqgf` 4, `wjfo` 4, `2j5u`/`rumx` 3, `h6os`/`0vvc`/`5eb0` 2). A single relaunch is one OEM kill — common across the Android fleet.

#### Audio narration failures — spans many files, not 3 (corrected 2026-05-22)
The earlier draft said "the same three files (BLOC_10/15/16) failed." Per-session drill-down shows the failures span the **whole parcours** — not 3 specific files:

| Session | Error type | Distinct files hit |
|---|---|---|
| `rumx` (iOS, webapp `fdf504c8`) | 27 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_04, BLOC_06, BLOC_10 (A+B), BLOC_15 (VOIX+MUSIC), BLOC_16 |
| `vigi` (iOS, webapp `fdf504c8`) | 21 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_10 (A+B), BLOC_14, BLOC_15, BLOC_16 |
| `wjfo` (Android, webapp `fdf504c8`) | 15 `audio_loaderror` + 9 timeout + 9 stuck | BLOC_01, 02, 03, 10, 11, 13, 15, 16 |
| `mq3z` (iOS) | 5 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_02, BLOC_03, BLOC_14 |
| `0vvc` (Android, webapp `2f77776e`) | 3 `audio_loaderror` | BLOC_13, BLOC_15, BLOC_16 |

Three corrections to the earlier framing:
1. **Not "3 corrupt files."** Errors hit ≥14 distinct files, BLOC_01 through BLOC_16 plus the liaison tracks. BLOC_10/15/16 appear most only because they are large and late in the walk.
2. **`wjfo` is a load failure, not a decode stall.** Its 15 errors are `audio_loaderror` (the file failed to *load* — missing / unreadable / bad container), separate from its 9 timeout / 9 stuck. The earlier draft framed wjfo purely as "sub-class B decode stall."
3. **Failures skew toward large files.** Media check: the failing files are mostly 6–11 MB (largest of all, `BLOC_01` at 11.2 MB, failed on wjfo); but `BLOC_03` (2.5 MB) and the liaisons (2.6–3.2 MB) failed too — so size is a *lean*, not a strict gate. There are ~12 files in the 6–11 MB band, each step loading a VOIX + MUSIC pair (~15 MB at once).

**Observation — webapp correlation:** the three worst sessions (`rumx`, `vigi`, `wjfo`) all ran webapp `fdf504c8`. `0vvc` on `2f77776e` still had 3 loaderrors, so the newer code is not immune. Which webapp is newer is unconfirmed (§11), so this is recorded as a correlation, not a fix direction. → see §P2.

#### iOS audiofocus failures (non-fatal)
4929 `audiofocus_request_fail` fleet-wide on iOS vs. 52 on Android. High per-session: `4zq0` 1545, `c7qo` 1446, `4rma` 747, `19dh` 332, `xuyx` 376, `7p2j` 272. **Not an iOS-26-only issue** — `4rma` (iOS 18.5) and `7p2j` (iOS 18.0) contributed ~1000 fails between them. All walks completed regardless — iOS-wide audiofocus contention, not walk-breaking — see m2.


---

### PROBLEMATIC — GPS incomplete, walk stopped short (5 sessions)

| Id | Device | OS | GPS gaps | Reached | Key issue |
|---|---|---|---|---|---|
| `51nv` | iPhone17,5 | iOS 26.3.1 | 4 (worst 14min) | Step 15 | Missed steps 2–4, 9–12 |
| `ibk6` | iPhone14,5 | iOS 26.3.1 | 4 (worst 9min) | Step 12 fired (route reached 15) | Missed steps 2–6, 8–9, 12–14 |
| `mq3z` | iPhone14,5 | iOS 26.3.1 | 3 (worst 8min) | Step 13 | Missed steps 3–7; 5 `step_voice` playerror (Liaison 1-2/2-3, BLOC_02, BLOC_03, BLOC_14) |
| `rumx` | iPhone14,5 | iOS 26.4.2 | 5×~2min | Step 15 | 27 audio playerror + 3 resumes + `stale-seek-pos` |
| `19dh` | iPhone14,5 | iOS 26.4.2 | 3×~2min | Step 15 | Missed steps 9, 10, 13 (step 12 *did* fire); step 16 never fired; 3× step_resume_current |

**Total: 5**

> **`vigi` moved out of this table (corrected 2026-05-22).** `vigi` had **0 GPS gaps ≥90 s** (422 fixes, avgAcc 8.4, stale=1) — its incompleteness is **audio-driven**, not GPS: 21 `audio_playerror` + 3 `step_voice_failed` on BLOC_14/15/16. It belongs with S2, not the GPS-incomplete set. It did have 3 `gps_lost`/2 `recovered` events, but no multi-minute fix gap. (`vigi` is iPhone14,7 / iOS 26.4.2, reached step 15.)

> **`ibk6` "reached" nuance:** the route (`route_probe`) reached step 15, but the last step to actually *fire* was step 12 — steps 13–15 only `step_skip_done` during GPS catch-up. The `analyze` table shows it as MaxStep 12.

**iOS 26.3.1** (`51nv`, `ibk6`, `mq3z`): 4–5 GPS gaps of 8–14 minutes each, far worse than 26.4.2. Likely a beta-specific regression. `step_skip_done` bursts confirm route catchup after each gap. → see §P3

**iOS 26.4.2** (`rumx`, `19dh`): shorter gaps (2–5 min); both stopped at step 15 without triggering step 16. `rumx` was further degraded by audio failures (see §P2) and the `stale-seek-pos` bug (see §P8). → see §0 M1

---

### PROBLEMATIC — Abandoned (1 session)

| Id | Device | OS | Max step | Reason |
|---|---|---|---|---|
| `4rma` | iPhone14,5 | iOS 18.5 | Step 11 | Walked cleanly to step 11 (no GPS gaps, no audio errors) then stopped. 747 audiofocus fails. **0 crashes** — not the teacher's phone (see §P8). Likely gave up / handed back. |

**Total: 1**

---

### Grand total

| Category | Count |
|---|---|
| Exclude (pre-opening + SM-A515F operator blips + post-walk idle + resumed-done + staff-handled) | ~51 |
| Valid — clean | **16** |
| Valid — with issues | **21** |
| Problematic — GPS incomplete | 5 |
| Problematic — abandoned (`4rma`) | 1 |
| **Meaningful visitor sessions (valid + problematic)** | **43** |

> **Counts revised 2026-05-22 (telemetry cross-check).** The earlier "48 / 22 clean / 20 with-issues" was inflated by sessions double-listed in both VALID tables and by `189t` being mis-listed clean. Corrected: 16 clean + 21 with-issues = 37 valid; + 5 GPS-incomplete + 1 abandoned = **43 meaningful**.

> **`analyze.mjs` cross-check (authoritative session tally).** With `--cutoff=0854 --operator=SM-A515F`: **66 visitor sessions** (110 files − 7 pre-opening − 37 SM-A515F operator). Of the 66: **completed 45 · incomplete 8** (`19dh, mq3z, rumx, 51nv, 4rma, vigi, ibk6, nayi`) **· aborted 13** (≤step 0, <5 min). The report's qualitative buckets above and `analyze`'s completed/incomplete/aborted split count *different things* (the buckets fold in operator and post-walk sessions, and treat audio-incomplete `vigi` and abandoned `4rma` as "problematic" rather than "incomplete") — use `analyze` for the raw tally, the buckets for interpretation.
---

## 9. Priority issues

### P2 — Audio narration failures (pre-loaded media — root cause unclear)

Media is downloaded during onboarding (name + size verified). Runtime server delivery is not the cause. The earlier draft framed this as "3 corrupt files (BLOC_10/15/16)" — telemetry drill-down does **not** support that. See §2 "Audio narration failures" for the per-session file list. Corrected picture:

**The failures span ≥14 distinct files** — BLOC_01 through BLOC_16 plus the liaison tracks — across `rumx`, `vigi`, `wjfo`, `mq3z`, `0vvc`. BLOC_10/15/16 recur most often, but they are not uniquely affected. A "3 specific corrupt files" theory is ruled out.

**Three error mechanisms, now distinguishable by event type:**
- `audio_loaderror` — the audio element could not *load* the file (missing / unreadable / damaged container). `wjfo` (15) and `0vvc` (3) are loaderror cases.
- `audio_playerror` — the file loaded but playback/decoding failed. `rumx` (27), `vigi` (21), `mq3z` (5) are playerror cases.
- `audio_play_timeout` / `audio_play_stuck` — playback did not start within the timeout window. `wjfo` had 9 + 9 of these *in addition to* its 15 loaderrors.

So `wjfo` is **not** a pure "decode stall" — its dominant signal is *load failure*. The earlier sub-class A/B split (A = iOS file-missing, B = Android decode-stall) does not hold: wjfo (Android) is mostly loaderror, and the iOS playerrors cluster on devices that also had GPS gaps / crashes (`rumx`, `mq3z`), so some are the audio element erroring during app-recovery state, not file integrity.

**File sizes — verified (media dir):** the failing files **skew large** — most are 6–11 MB; the single largest file in the parcours, `BLOC_01_parc_V8` (11.2 MB), failed on `wjfo`. But `BLOC_03` (2.5 MB) and the liaison tracks (2.6–3.2 MB) failed too, so size is a *lean*, not a gate. ~12 files sit in the 6–11 MB band, and each step loads a VOIX + MUSIC pair (~15 MB) at once — heavy for weak/stressed devices.

**Observation — webapp build:** the three worst sessions (`rumx`, `vigi`, `wjfo`) all ran webapp `fdf504c8`; `0vvc` on `2f77776e` still produced loaderrors. The build version is per-device PWA cache (§11). Which build is newer is unconfirmed, so this is a correlation to confirm, not a proven cause.

**Likely causes still open** (in rough probability order): corrupt download passing the name+size check (a checksum would catch it); cache/path issue after an OEM kill/resume; audio pipeline overload on large VOIX+MUSIC pairs. The fix path is diagnostic-first — see the telemetry additions in §P2a.

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

**Affected sessions (rebuilt 2026-05-22 from the `stepResumeCurrent` telemetry flag — exact counts, no longer guessed):**

| step_resume_current | Sessions |
|---|---|
| 4× | `yapj` |
| 3× | `19dh`, `189t` |
| 2× | `5kd4`, `c7qo`, `h6os`, `5kkz`, `2tqf` |
| 1× | `9iyw`, `0d5l`, `mq3z`, `ibk6`, `rumx` |

The earlier draft listed `bi6k`, `6epi`, `168c` as "step_resume_current likely triggered" — telemetry shows **all three had 0×** (they had a brief `gps_lost`/`recovered` only, which is not the same event). They are removed from P6. Conversely the earlier draft **missed** `19dh` (3×), `189t` (3×), `5kd4` (2×), `c7qo` (2×), `h6os` (2×) — `189t`/`5kd4`/`c7qo` were even sitting in "VALID clean". The flag now surfaces all of them fleet-wide. Pattern severity: 2+ occurrences is a clear pattern; the 1× cases may be incidental.

**Mechanism:** When GPS signal drops for ≥10 s, `stateUpdateTimeout` fires in `geoloc.js:308` → `pauseAllPlayers()` is called → audio paused, `gps_lost` overlay shown. On recovery, the first incoming position enters the zone check in `spot.js:609` — `step_resume_current` fires and calls `player.resume()` directly, *before* `GPSSIGNAL_OK` has been set back to `true`. Up to 1 second later, `stateUpdate('ok')` fires in `pages.js` → `GPSSIGNAL_OK = true` → `resumeAllPlayers()` iterates `PAUSED_PLAYERS` and calls `player.resume()` a **second time** on the same already-playing player. Result: audio jumps back a couple of seconds. Visitor perception: brief narration restart.

**Fix Option A (recommended):** Gate `step_resume_current` on `GPSSIGNAL_OK` in `spot.js:609`:
```js
if (this._index == PARCOURS.currentStep() && this.player.isPaused() && this.near(position) && inside
    && (typeof GPSSIGNAL_OK === 'undefined' || GPSSIGNAL_OK))
```
The first recovered position is ignored by `step_resume_current`; `resumeAllPlayers()` handles the resume cleanly ~1 s later. Targeted fix — does not affect GPS-loss detection sensitivity.

**Fix Option B (alternative):** Raise `stateUpdateTimeout` from `10000` to `20000` in `geoloc.js:308`. Prevents brief <20 s GPS dips from triggering the full pause/overlay cycle at all. Downside: genuine GPS loss events are not announced to the walker for 20 s instead of 10 s.

### P6a — GPS zone boundary overshoot causing wrong-step playback (field report: John / `yapj`)

A more severe variant of P6: GPS places the phone fractionally past a zone boundary (within the GPS accuracy margin) while the visitor is physically elsewhere, and the audio re-resumes / the step advances from a non-current location.

**Observed in `yapj` (John, ~16:00):** `session.mjs` now prints the `border=` payload on every `step_resume_current`. `yapj`'s 4 events:

| Time | step_resume_current | `distanceToBorder` | visibility |
|---|---|---|---|
| 20.5min | step 9 (BLOC_10) | −0.48 m | background |
| 25.3min | step 12 (BLOC_13) | −0.64 m | background |
| 27.3min | step 13 (BLOC_14) | −0.55 m | background |
| 30.8min | step 13 (BLOC_14) | −0.25 m | foreground |

All four fire with the phone within ~0.5 m of a zone border — inside the GPS noise floor. John's SM-G990B2 was on the BLOC_13/BLOC_14 boundary; he reported hearing wrong-step audio and followed other visitors to recover, rejoining at BLOC_15. (The earlier draft's "0.55 m inside BLOC_14" figure is the 27.3 min step-13 event.) Note `step_resume_current` re-resumes the *current* step's player — the "premature `step_done` advances to the next step" mechanism is an interpretation consistent with John's account; the border values confirm the phone was sub-metre from borders but do not by themselves prove the step advanced early.

> John also reported audio going back "4 times between blocs 2 and 7". Telemetry shows all 4 `step_resume_current` events in `yapj` occur at steps 9–13 (BLOC_10–14), not steps 1–6. The location discrepancy is unexplained — either mis-recalled zone or visitor counting differs from internal step numbering.

**Fix:** The GPSSIGNAL_OK gate (see P6 fix) prevents `step_resume_current` double-fire but does not prevent zone overshoot triggering a premature `step_done`. A separate guard is needed in `spot.js`: do not mark a step done unless GPS accuracy is ≤ X m (matching the zone's margin) and the reading is sustained for ≥ 2 consecutive samples.

---

### P7 — Silent audio on fresh visitor start after loan-phone idle (operator report: Justine)

**Reported:** Operator Justine (tent, SM-A515F loan phone) observed 4–5 times across the day: after completing the 4321 GO re-arm procedure, the walk page displays normally, GPS starts, but **no audio plays**. Navigating back to the app's root page (without re-arm/reinit) and returning to the walk immediately resolves the issue.

**Mechanism (hypothesis):** The loan phone was previously left running post-walk (m3). The audio engine is in a stale state — either paused/ended from the previous session or holding a stale audio element reference. When the 4321 GO initialises a new session, the walk page mounts but `step_fire` finds the audio player already in a terminal state and the `play()` call either fails silently or is rejected by the OS (audiofocus not re-acquired). Navigating away and back triggers a full audio-engine re-initialisation, which succeeds.

**Impact:** Operational friction for staff; repeated per day. Visitor does not see or hear the issue (staff resolves before handing over the phone), but adds setup delay and relies on an undocumented workaround. Root cause is the same as m3 (no walk-end shutdown): a proper shutdown at walk-end would release audio focus and reset the engine, preventing stale state for the next session.

**Fix:** Proper walk-end shutdown, including audio engine release, is the primary fix (same root cause as m3). Additionally, add explicit audio engine reset / new `Audio` element construction at session initialisation (`session_start` event) rather than reusing a possibly-stale instance.

---

### P8 — Stale seek-position on iOS app crash resume (`rumx`)

**Observed:** `rumx` (iPhone14,5, iOS 26.4.2, 09:05:59) had 3 app crashes (`session_resume` events). All 3 resumes restore `seek_pos = 279.0 s` regardless of which step is being resumed (steps 13 and 15, twice). A fixed seek position identical across different steps indicates the resume position is not being updated in persistent storage when the step changes — the position written by a previous step's `parcours_store` interval is being applied to the new step's audio.

**Visitor impact:** After each crash, narration resumes 4 min 39 s into the audio for an unrelated step. Visitor hears mid-content with no context.

> **Teacher's iPhone (09h–09h30):** An unnamed teacher's phone reportedly crashed while walking between 09:00 and 09:30. `rumx` (09:05:59, **3 app crashes**, iOS 26.4.2) is the clear telemetry match — the only iOS session in that window with mid-walk crashes. The earlier draft floated `4rma` (09:23, iOS 18.5) as a secondary candidate, but `4rma` has **0 `session_resume` / 0 `session_restart`** — it never crashed (it walked cleanly to step 11, then stopped). `4rma` is therefore *not* a candidate. Device identification is not possible from current telemetry — see t4 (loan device flag) for the fix.

**Fix:** On `step_fire`, clear / overwrite `parcours_store.resumeStepVoicePos` to `0` so that a crash immediately after a step transition never restores from the previous step's mid-audio position. Write the new step's audio position to storage only once it has been playing for ≥ a few seconds.

---

## 11. Build & parcours-config skew (stale PWA cache)

The fleet did not all run the same code or the same parcours config. Both skews trace to the same cause — each phone runs whatever its PWA (service-worker) cache holds, and that cache was not uniformly fresh.

### 11a. Webapp build skew

`session_diag` reports a `webapp_hash`. Two distinct hashes appear on 2026-05-20:

| webapp hash | Visitor sessions (approx.) |
|---|---|
| `fdf504c8…` | ~29 |
| `2f77776e…` | ~35 |

This is **roughly an even split**, not the "~30 old / ~70 new" the earlier draft stated, and it is **not time-ordered** — both hashes appear throughout the day, interleaved. The version is per-device cache, not a rollout. `apk_version` (12 on iOS, 13 on Android) only tracks platform — it is not a skew.

**Which hash is newer is not confirmed.** The earlier draft assumed `fdf504c8` = old and `2f77776e` = new; that ordering should be verified against the deploy history before it is relied on. It matters for §P2: the three worst audio-failure sessions all ran `fdf504c8`, but `0vvc` on `2f77776e` still had loaderrors — so the webapp is a correlate to confirm, not a proven cause.

### 11b. Parcours-config skew — 18-step vs 17-step

Three sessions carry the parcours name `FLANERIE_GIVORS_V7_CBR`; all others carry `FLANERIE_GIVORS`. Both share the same parcours **id** (`flanerie_givors_v7_cbr`) but differ in name and step count:

| parcoursName | Steps | Sessions |
|---|---|---|
| `FLANERIE_GIVORS` (live config) | 17 (0–16) | 63 visitor sessions |
| `FLANERIE_GIVORS_V7_CBR` (stale cache) | 18 (0–17) | `892p`, `c7qo`, `vu26` |

The **live** parcours JSON on the server (`flanerie_givors_v7_cbr.json`, modified 2026-05-20 11:45) is the 17-step `FLANERIE_GIVORS` — verified directly: `spots.steps` has keys 0–16. So `892p` and `c7qo` ran an *older 18-step cached config*; `vu26` is a 43 s blip. The parcours was renamed (and the step count changed) at some point before the field day; these two devices had cached it before that edit.

**Impact:** low for 2026-05-20 — `892p` and `c7qo` both completed their 18-step config cleanly, no content was lost. But it means:
- `892p` is listed in VALID-clean as "completed" — it completed an *18-step* walk, not the 17-step one everyone else did. Not directly comparable.
- The `analyze` script correctly infers step counts per parcours, so completion stats are not corrupted — but any per-step fleet comparison must bucket the two configs separately.
- A device with a *badly* stale cache could run outdated audio files or zone geometry without anyone noticing.

**Fix:** Version-check the cached webapp bundle and parcours config at walk start, and force-refresh (or block + prompt) if stale. Surface the webapp hash and parcours name/step-count in the operator/devmode UI so staff can spot a stale device. Pairs naturally with the loan-device id work (t4) — both are about making each phone's exact state visible to staff and to telemetry.

---

## 12. Remediation plan (drafted 2026-05-23)

Designed against the codebase rather than the issue table — many GIVORS bugs share root causes, so fixes are organised by **workstream**, not by issue ID. Per-issue coverage is tracked in §12.0.

Inputs that shaped this plan:

- **Round 5 (R5.1 audiofocus `mediaPlayback` keepalive, R5.2 `IsBackgroundRestricted`) was live on 2026-05-20.** Samsung A15 `f743` still relaunched ×7. The audiofocus FG-service keepalive is not by itself enough to keep heavy-OEM Android devices alive across a 45-min locked walk — so the Android plan adds genuine native survivability layers (AlarmManager wakeup, conditional FusedLocationProvider, aggressive media unload), not more JS-side gating.
- **iOS 26.3.x GPS regression treated as our problem, not Apple's.** Even if Apple ships a fix in 26.4+, visitors on stale OSes will keep arriving. Native investigation in the bg-geo fork is in scope.
- **Plugins stay separate; forks get extended.** No umbrella plugin. `cordova-plugin-audiofocus`, `cordova-plugin-power-optimization`, `cordova-background-geolocation-plugin` each grow new actions; the in-tree `cordova-plugin-power-optimization` (currently inside `FlanerieCordova/plugins/`) is promoted to a proper fork at `~/Bakery/cordova-plugin-power-optimization/` matching the other two.
- **S2 audio failures are diagnosed AND mitigated in one batch.** Telemetry to pinpoint the dominant mechanism, plus three plausible-cause mitigations shipping in parallel.
- **Style:** every change links to a file path; every numbered item names its layer (webapp / Cordova / plugin) and a [SAFE-TODAY] / [TEST-FIRST] / [RESEARCH-FIRST] tag matching the existing legend in [mobile-audit.md](mobile-audit.md).

### 12.0. Issue → workstream coverage

| Issue | Coverage |
|---|---|
| S1 — iOS 26.3.1 GPS blackouts | D1 (onboarding warn), B4/D2 (real-callback watchdog), D3–D6 (native iOS fork) |
| S2 — Audio narration failures | C1 (split error subtypes), C2 (file integrity at preload + walk start), C3 (`walk_start_cache_verify`), C4 (playerror retry+reset), B1 (memory pressure), A2 (engine reset at session start) |
| M1 — iOS 26.4.2 short GPS gaps + stalled step 16 | B4/D2, D3, plus a step-16 cutoff-tuning side note in E4 |
| M2 — `step_resume_current` stutter + zone overshoot (P6/P6a) | E1, E2, E3 |
| M3 — Silent audio on loan-phone re-arm (P7) | A1 (walk-end shutdown), A2 (session-start engine reset), A3 (re-arm = end+start) |
| m1 — Android OEM kill | B1 (memory), B2 (AlarmManager wakeup), B3 (conditional Fused), B4 (watchdog visibility) |
| m2 — iOS audiofocus contention | C5 (request parsimony for persistent players), G1 (interruption logging) |
| m3 — No walk-end shutdown | A1, A7 (post-walk lock screen) |
| P4 — Operator rearm cut active walk (`oupu`) | A3 (rearm confirmation modal) |
| P8 — Stale seek-position on iOS crash resume (`rumx`) | A4 (clear `resumeStepVoicePos` on `step_fire`) |
| t1 walk-start cache verify | C3 |
| t2 audio error subtypes | C1 |
| t3 checksum at download | C2 |
| t4 loan-device flag | A5 |
| §11 build / parcours-config skew | A6 (parcours freshness check), A5 (devmode visibility) |

### 12.1. Workstream A — Walk-session lifecycle hygiene

A clean **end → reset → start** boundary fixes M3, m3, P4, P7, P8, t4, and the §11 cache-skew at once. This is the highest-leverage workstream.

**A1. Walk-end shutdown sequence [TEST-FIRST]** — webapp + audiofocus plugin (G1).  
[pages.js:2019 `PAGES['end']`](www/app/pages.js#L2019) today stops tracking, the persistent players, and the GPS service, but the audio *engine* and the persisted parcours state survive — which is what lets `7p2j` / `xuyx` / `9hjo` / `mwbo` keep running for 1–2 h, and what creates the stale state Justine sees on the next re-arm (P7). Extend `PAGES['end']` to:

1. Force a final `TELEMETRY.flush()` and await ack (or 5 s timeout). Closes R7.5 telemetry-loss caveat.
2. Clear `state.resumeStepVoicePos = 0`, `state.lost = false`, and every `Step._done` flag. Persist once via `PARCOURS.store('walk_end')`.
3. Existing audio stops (already present).
4. **NEW:** rebuild SILENT_PLAYER from scratch (`new PlayerSimple(...)`); null out `PAUSED_PLAYERS`, `DUCKED_PLAYERS`.
5. **NEW:** `cordova.plugins.audiofocus.releaseSession()` — new plugin action (G1) that calls `setActive:NO` on iOS AVAudioSession and `stopKeepalive() + cancelFocus()` on Android (today only one of those runs in cleanup).
6. Existing `GEO.stopGeoloc()` (already present).
7. Emit `walk_end_shutdown` telemetry with what was torn down (F3).
8. Hand off to A7 lock screen.

Files: [www/app/pages.js](www/app/pages.js), [cordova-plugin-audiofocus](../cordova-plugin-audiofocus/) (see G1).

**A2. Session-start audio engine reset [TEST-FIRST]** — webapp + audiofocus plugin (G1).  
Closes the underlying mechanism of P7 (and Justine's "navigate away and back" workaround). On `TELEMETRY.start(... 'session_start')` (not on `'session_resume'` — resume must preserve audio state):

- Call new `cordova.plugins.audiofocus.resetAudioSession()` action (G1). iOS: `setActive:NO` → 100 ms delay → `setCategory:AVAudioSessionCategoryPlayback` + `setActive:YES`. Android: `cancelFocus()` → fresh `requestFocus()` → restart FG service via `startKeepalive()`.
- Rebuild SILENT_PLAYER fresh on the JS side regardless of platform (cheap insurance).
- Emit `audio_engine_reset` telemetry (F4).

Files: [www/app/pages.js](www/app/pages.js) (`PAGES['parcours']` entry), [www/app/assets/player.js](www/app/assets/player.js) (SILENT_PLAYER lifecycle), [cordova-plugin-audiofocus](../cordova-plugin-audiofocus/).

**A3. `rearm_button` = clean end + clean start [TEST-FIRST]** — webapp.  
[pages.js:2112](www/app/pages.js#L2112) currently only resets `currentStep`, clears LOST, and restarts tracking — explaining both P4 (`oupu` was re-armed mid-walk because there was no confirmation) and most of P7 (the audio engine never got reset between visitors). Update:

1. Modal: "Confirmer: la balade précédente est terminée?" with cancel default; require explicit confirm tap.
2. On confirm: run the A1 shutdown sequence (without the A7 lock-screen step).
3. Reset PARCOURS state (already there) and call A2.
4. Resume into `PAGES['rdv']`, not back into `parcours`.

Files: [www/app/pages.js](www/app/pages.js).

**A4. Clear `resumeStepVoicePos` on `step_fire` [SAFE-TODAY]** — webapp. Closes P8.  
[parcours.js:158](www/app/assets/parcours.js#L158) writes a non-zero seek pos every time `snapshotVoicePosition()` is called. The bug `rumx` exposed: after crash, the *previous step's* mid-audio position is restored against the *new step's* file because the snapshot interval wrote a pos for step N but the resume restored into step N+1. Fix is symmetric to the existing `resumeStepVoicePos` zeroing in `Step.updatePosition` consume — also zero on `step_fire`:

```js
// in Step.updatePosition fire branch (spot.js, after step_fire telemetry)
PARCOURS.state.resumeStepVoicePos = 0
PARCOURS.store('step_fire')
```

Additionally, gate `snapshotVoicePosition()` to skip the first 3 s of a freshly-fired step (the resume-from-mid-audio noise is what causes the cross-step contamination).

Files: [www/app/assets/spot.js](www/app/assets/spot.js) (fire branch), [www/app/assets/parcours.js:118 `snapshotVoicePosition`](www/app/assets/parcours.js#L118).

**A5. Loan device flag + persistent UUID [SAFE-TODAY]** — webapp + telemetry. Closes t4.  
Two independent additions:

- `DEVICE_UUID` — generate uuidv4 on first launch, persist in localStorage, never rotate. Echoed in every `session_diag` payload. Lets `analyze.mjs` distinguish "Xiaomi 2201117TY used twice" (`ffqz`/`avm3`) from "two different visitors' phones that happen to share a model number".
- `IS_LOAN_DEVICE` — sticky bool, settable via a new devmode-only "Mark as loan device" button on the `tools` page. Echoed in `session_diag`.

Server-side `analyze.mjs` gains `--include-loan-only`, `--exclude-loan`, `--device-uuid <id>` filters. Removes the per-day manual cross-referencing pain that drove most of §2's footnotes.

Files: [www/app/assets/telemetry.js](www/app/assets/telemetry.js) (`session_diag` payload), [www/app/pages.js](www/app/pages.js) (`tools` page button), [telemetry/scripts/analyze.mjs](telemetry/scripts/analyze.mjs), [telemetry/scripts/common.mjs](telemetry/scripts/common.mjs).

**A6. Parcours-config freshness check [TEST-FIRST]** — webapp + server. Closes §11.  
At [pages.js:1797 `PAGES['parcours']` entry](www/app/pages.js#L1797), after R6.3 diagnostic telemetry: issue a `HEAD` against the live parcours JSON URL (server already supports it via Express). If `Last-Modified` is newer than the cached value OR `etag` differs OR a HEAD-piggy-backed `X-Parcours-Steps` header (new — added in `server.js` to expose `info.steps.length`) differs from the cached `PARCOURS.steps.length`, hard-block with: "Mise à jour disponible — réinitialiser l'application via le bouton opérateur." Operator confirmation to override.

Avoids the `892p` / `c7qo` 18-step-vs-17-step skew silently.

Files: [www/app/pages.js](www/app/pages.js), [www/app/assets/parcours.js](www/app/assets/parcours.js), [server.js](server.js) (add `X-Parcours-Steps` to GET + HEAD responses).

**A7. End-of-walk lock screen [SAFE-TODAY]** — webapp. Closes m3.  
After PAGES['end'] runs its A1 sequence and the typewriter ends, render a full-screen overlay with no interactive elements — only the existing 5-tap-bottom devmode/restart pattern can dismiss it. Prevents the post-walk noise sessions and inadvertent restarts. Uses the existing tap pattern so no new gesture surface.

Copy is intentionally generic — the phone may be a loan or the visitor's own, and the show continues with a non-phone chapter after the walk. Draft (final copy to be confirmed):

> *La balade est terminée. Tu peux ranger le téléphone, la suite t'attend.*

No reference to "rendre" / "loaner" / "point de RDV" so the message works for both audiences and signals that the experience continues offline rather than that the visitor is being dismissed.

Files: [www/app/pages.js](www/app/pages.js) (`PAGES['end']` tail), [www/app/app.html](www/app/app.html) (new `#walk-handback` overlay — DOM id kept neutral despite the name; rename if it ships).

### 12.2. Workstream B — Android resilience

R5.1 keepalive was live and the kills happened anyway. Plan layers four independent mitigations; B1 + B4 ship JS-only in phase 1, B2 and B3 are plugin work in phase 3.

**B1. Aggressive past-step media unload [TEST-FIRST]** — webapp.  
PlayerStep currently constructs voice + afterplay refs for every step at parcours build time, and never releases them. ~17 steps × ~15 MB VOIX+MUSIC = ~250 MB peak resident — on Samsung A15-class devices (4 GB RAM, OneUI memory limits), this alone explains aggressive OEM kills mid-walk.

On `step_done` for step N: call `step[N-2].player.clear()` (and its afterplay) once `step[N+1].player.isPlaying()`. For BLOC_15-style late-walk steps, this halves the resident footprint by step 12.

Trade-off: brief jankiness if the walker drifts backwards across two steps post-`done`. Acceptable given the operational model — `reachableSteps()` already constrains backward drift, and a transient reload is far cheaper than an OEM kill.

Telemetry: `step_media_unloaded {step, freed_bytes_est}`.

Files: [www/app/assets/spot.js](www/app/assets/spot.js), [www/app/assets/player.js](www/app/assets/player.js).

**B2. AlarmManager JS wakeup (bg-geo fork) [RESEARCH-FIRST]** — plugin. Closes P0.5 Fix 1e.  
The Samsung A15 case is the canonical "WebView suspended despite FG service running" — Handler keepalive (Fix 1b) ticks but JS doesn't execute. Add the deferred Fix 1e: `LocationWakeReceiver.java` schedules `AlarmManager.setExactAndAllowWhileIdle` at 30 s cadence while parcours is active; on fire, `evaluateJavascript("window.GEO && GEO.onAlarmWake()")` resumes the JS layer.

Files: [cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/](../cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/) (new `LocationWakeReceiver.java` + `LocationManagerService` schedule hook), [cordova-background-geolocation-plugin/plugin.xml](../cordova-background-geolocation-plugin/plugin.xml) (BroadcastReceiver registration), [www/app/assets/geoloc.js](www/app/assets/geoloc.js) (`onAlarmWake` handler).

**B3. Conditional FusedLocationProvider (bg-geo fork) [RESEARCH-FIRST]** — plugin. Closes P0.5 Fix 4 with narrower trigger.  
Today's `RawLocationProvider` (modified in P1.33 for cold-start) keeps raw GPS for everyone. Add `FusedLocationProviderClient` as a parallel provider, registered only when `Build.MANUFACTURER` ∈ {samsung, xiaomi, motorola, tcl, oppo, realme, vivo, honor}. Pixel / non-restrictive devices keep raw-GPS performance; restrictive OEMs get Google's Doze-aware fused stream.

Files: [cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/provider/](../cordova-background-geolocation-plugin/android/common/src/main/java/com/marianhello/bgloc/provider/) (new `FusedLocationProvider.java`), `LocationProviderFactory.java` for the conditional registration.

**B4. Real-callback freshness watchdog [TEST-FIRST]** — webapp. Cross-platform; serves both Android (P1.31) and iOS (P1.34/S1) in one fix.  
Today `GEO.lastTimeUpdate` is refreshed by both real fixes and the 15 s NSTimer/Handler keepalive — so a multi-minute background callback blackout doesn't trip the 30 s `stateUpdateTimeout`. New field `GEO.lastRealCallbackTime` updated only when `_callbackPosition` is invoked with `source ∈ {'gps', 'bg-geo-native', 'navigator'}` (not `'heartbeat'`, not `'keepalive'`).

In `stateUpdateTimer` ([geoloc.js:315](www/app/assets/geoloc.js#L315)), add a third state alongside `ok` / `lost`: `frozen` — fires when `(Date.now() - lastRealCallbackTime) > 60_000` AND `motionIsStationary === false` AND visibility likely background. Reuses the existing `#lost-band` overlay DOM with new copy: "Téléphone en veille — déverrouillez pour continuer" + a triple vibration. Clears on the next real fix.

This is the single highest-leverage iOS-blackout fix that doesn't require a plugin rebuild — converts a silent 8-minute outage into a visible 60-second prompt.

Telemetry: `gps_frozen {gap_ms, visibility, motion}`, `gps_unfrozen {gap_ms}`. `real_callback_freshness` periodic event every 30 s for baseline.

Files: [www/app/assets/geoloc.js](www/app/assets/geoloc.js), [www/app/pages.js](www/app/pages.js) (band rendering, reuse `#lost-band`), [www/app/app.html](www/app/app.html) (no DOM change needed if we reuse #lost-band; otherwise a sibling #frozen-band).

### 12.3. Workstream C — Audio reliability

Diagnose AND mitigate S2 in one batch. Three telemetry items pinpoint mechanism (C1, C2, C3), three behaviour changes cover the plausible causes (C4, B1, A2).

**C1. Split audio error subtypes [SAFE-TODAY]** — webapp + telemetry. Closes t2 and R7.1 follow-up.  
[player.js:678/688](www/app/assets/player.js#L678) currently logs `audio_loaderror` / `audio_playerror` with the raw error object serialised as `[object Object]`. Replace with:

- For NativeMediaPlayer (iOS): inspect Media error `code` (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED) and Cordova `Media`'s passed `MediaError.message`; map to `error_type ∈ {not_found, network, decode_failed, src_unsupported}`.
- For Howler (Android): inspect `Howl._sounds[0]._errors` and `loadError`; map to `{not_found, decode_failed, timeout, stuck}`.
- Add `audio_uri_resolved` event at every `PlayerSimple.load()` with the resolved native URI — closes P2a's audio path/URI ambiguity.

Files: [www/app/assets/player.js](www/app/assets/player.js).

**C2. Onboarding + walk-start file integrity check [TEST-FIRST]** — webapp. Closes t1 + t3.  
Using `cordova-plugin-file`:

- **End of preload** ([pages.js around 340](www/app/pages.js#L340)): walk the parcours media manifest, verify each file's `File.size` matches the manifest's expected size. Emit `onboarding_file_check {file, expected_size, actual_size, status}`. Any miss → "Téléchargement incomplet, recommencer".
- **Cheap checksum** for the largest 4 files (BLOC_01, BLOC_10, BLOC_15, BLOC_16 — the recurring failure offenders in §2): SHA1 of first 1 MB + last 1 MB read via `File.slice + FileReader`. Cheap proxy for the full hash; catches truncation and the common Android-cache corruption modes. Emit `file_checksum_quickhash`.
- **Walk-start cache verify** (entry of `PAGES['parcours']`): re-run the same checks. Emit `walk_start_cache_verify {files_ok, files_missing: [...], files_corrupt: [...]}`. Files lost between preload and walk start → hard block + reinit prompt.

Closes the "is `wjfo`'s loaderror cache eviction vs. corrupt download vs. URI mismatch" ambiguity by making it observable.

Files: [www/app/assets/parcours.js](www/app/assets/parcours.js) (preload pipeline), [www/app/pages.js](www/app/pages.js) (PAGES['parcours'] gate).

**C3. `walk_start_cache_verify` event [SAFE-TODAY]** — already covered by C2.

**C4. Audio playerror retry with engine reset [TEST-FIRST]** — webapp.  
Today (P1.19) a single `audio_playerror` short-circuits to `startAfterplay()` — fatal for GIVORS where every afterplay is missing (R7.2). Instead:

1. First playerror: call `cordova.plugins.audiofocus.resetAudioSession()` (G1), `PlayerSimple.clear()` + `load()` + `play()`. Telemetry `audio_playerror_retry`.
2. Second playerror or playerror on retry path: short-circuit to afterplay as today.

Targets the `rumx` / `vigi` iOS playerror clusters where post-crash audio refs are stale but the file is fine.

Files: [www/app/assets/player.js](www/app/assets/player.js) (`PlayerStep` voice playerror handler).

**C5. iOS audiofocus request parsimony [SAFE-TODAY]** — webapp. Closes m2.  
4929 `audiofocus_request_fail` on iOS fleet-wide vs. 52 on Android isn't a known *audio failure* but it's pollution and on `4zq0`/`c7qo` it suggests SILENT_PLAYER + zone/offlimit looped players each requesting focus on every loop iteration. iOS with UIBackgroundModes:audio + R5.1 keepalive does NOT need per-player focus requests for persistent silent / ambient players.

In [`shouldRequestAudioFocusForPlay()`](www/app/assets/player.js#L183): on iOS, return `false` for persistent looped players (mark them with `_skipFocusRequest = true` at construction).

Files: [www/app/assets/player.js](www/app/assets/player.js).

**C6. (deferred) Android NativeMediaPlayer migration [RESEARCH-FIRST]** — webapp + plugin.  
Big change (matches P3.4 iOS pattern). Defer until C2 + C4 + B1 are validated in field. If `wjfo`-class loaderrors recur, escalate.

Files (when picked up): [www/app/assets/player.js](www/app/assets/player.js), `cordova-plugin-media` (Android backend wrapper).

### 12.4. Workstream D — iOS GPS blackouts (deep native investigation)

S1 (26.3.1, 8–14 min gaps) and M1 (26.4.2, shorter gaps) get the layered treatment. D1+D2 ship phase 1 (JS only). D3–D6 are the native investigation, phase 3.

**D1. iOS version warning at onboarding [SAFE-TODAY]** — webapp.  
On `confirmgeo` entry, detect iOS `device.version`. If `< 26.4` (or specifically `26.3.x`), render a soft-block: "Cette version d'iOS a un défaut connu de localisation en arrière-plan. Demandez à l'équipe un téléphone de prêt, ou mettez à jour iOS 26.4." Operator-tap override.

Files: [www/app/pages.js](www/app/pages.js) (`PAGES['confirmgeo']`).

**D2. Real-callback freshness watchdog** — already covered by B4 (cross-platform).

**D3. CLLocationManager forced reacquire (bg-geo iOS fork) [RESEARCH-FIRST]** — plugin.  
New native action `forceReacquire`. In `MAURRawLocationProvider.m`:

1. `[locationManager stopUpdatingLocation]`
2. `[locationManager stopMonitoringSignificantLocationChanges]`
3. dispatch_after 500 ms:
4. Re-assert `delegate`, `desiredAccuracy = kCLLocationAccuracyBest`, `distanceFilter`, `activityType = CLActivityTypeFitness`, `allowsBackgroundLocationUpdates = YES`, `pausesLocationUpdatesAutomatically = NO`, `showsBackgroundLocationIndicator = YES`
5. `[locationManager startUpdatingLocation]`
6. `[locationManager startMonitoringSignificantLocationChanges]`

JS-side: B4 watchdog calls `forceReacquire` after 60 s real-callback gap, throttled to 3 attempts per session.

Telemetry: `ios_gps_reacquire_attempt {attempt_n}`, `ios_gps_reacquire_recovered {attempt_n, recovery_ms}`.

Files: [cordova-background-geolocation-plugin/ios/MAURRawLocationProvider.m](../cordova-background-geolocation-plugin/ios/MAURRawLocationProvider.m), `CDVBackgroundGeolocation.m`, `plugin.xml`, [www/app/assets/geoloc.js](www/app/assets/geoloc.js).

**D4. Periodic flag re-assertion [RESEARCH-FIRST]** — plugin.  
Add an NSTimer (60 s, parallel to the existing 15 s keepalive in P0.5 Fix 1b) that re-sets `allowsBackgroundLocationUpdates = YES` + `pausesLocationUpdatesAutomatically = NO`. There's anecdotal evidence iOS 26.x silently flips one of these on memory pressure. Cheap defensive measure.

Files: same as D3.

**D5. Significant-location-changes as wake source [RESEARCH-FIRST]** — plugin.  
Today P0.5 Fix 2 keeps SLC monitoring on as a parallel keepalive. Extend: when D3's gap detector fires AND SLC has delivered something in the last 90 s but standard updates haven't, *that's the diagnostic signal* — iOS is suspending standard updates but SLC is still alive. Trigger D3 reacquire automatically on the SLC callback.

Files: same as D3.

**D6. CMMotionActivity-promoted band [SAFE-TODAY]** — webapp.  
Already covered by B4. If `motionIsStationary === false` (visitor actively walking) AND `lastRealCallbackTime > 60 s` ago, promote the watchdog band immediately instead of waiting another 30 s — this is the cleanest "iOS suspended us mid-walk" signal we have.

Files: [www/app/assets/geoloc.js](www/app/assets/geoloc.js).

**D7. Dedicated iOS field test [TEST-FIRST]** — operational.  
Side-by-side iOS 26.3.1 + iOS 26.4.x device walk before any show, to validate D1–D6. Required because the GIVORS evidence is observational, not causal.

### 12.5. Workstream E — Step lifecycle correctness (M2 / P6 / P6a)

The GIVORS-report Option-A fix ("gate on GPSSIGNAL_OK") is not enough: iOS keeps `GPSSIGNAL_OK === true` throughout because the keepalive ticks refresh `lastTimeUpdate`. Need a freshness *and* accuracy *and* sustain gate.

**E1. Gate `step_resume_current` on real-callback freshness + accuracy [TEST-FIRST]** — webapp.  
[spot.js:609](www/app/assets/spot.js#L609): add the new freshness check from B4 plus an accuracy gate:

```js
if (this._index == PARCOURS.currentStep() && this.player.isPaused() && this.near(position) && inside
    && typeof GPSSIGNAL_OK !== 'undefined' && GPSSIGNAL_OK
    && (Date.now() - GEO.lastRealCallbackTime) < 5000
    && position.coords && position.coords.accuracy <= 15)
```

Files: [www/app/assets/spot.js](www/app/assets/spot.js).

**E2. Zone boundary sustained-sample gate [TEST-FIRST]** — webapp. Closes P6a.  
John's `yapj` shows the phone was sub-metre from the BLOC_13/14 border on each premature event. Today `near() && inside` fires immediately on the first sample inside. Add: require either (a) ≥2 consecutive samples inside OR (b) ≥5 s elapsed since `_firstInsideSampleAt` AND `accuracy <= zone.radius` before firing `step_done` advance or `step_resume_current`.

Stores a per-Step `_firstInsideSampleAt` timestamp; cleared on `leave`.

Files: [www/app/assets/spot.js](www/app/assets/spot.js) (around lines 609 and 636 — both fire branches).

**E3. step_done premature-advance guard [TEST-FIRST]** — webapp.  
Independent of E2 — when GPS places the phone in the NEXT step's zone before the current step's voice has finished, today the current step's `step_done` fires the moment `near() && inside` of N+1. Add an explicit guard: do not promote the active step to done from a "phone is in next zone" signal unless E2's sustain conditions are met for the next zone AND the current step's voice has been playing for ≥30 s (i.e. real listening time).

Files: [www/app/assets/spot.js](www/app/assets/spot.js).

**E4. (side note) Last-step cutoff tuning** — observational.  
`19dh` / `rumx` both stopped at step 15 with step 16 never firing. Worth verifying `info.cutoff` against actual last-step play duration on the parcours JSON — not a code fix, but the live `flanerie_givors_v7_cbr.json` should be reviewed.

### 12.6. Workstream F — Telemetry & tooling

All other workstreams already enumerate their telemetry additions. Consolidated here for review.

| New event | Source | Purpose |
|---|---|---|
| `walk_end_shutdown` | A1 | confirm clean teardown sequence ran |
| `audio_engine_reset` | A2 | confirm engine reset fired at session_start |
| `step_media_unloaded` | B1 | observe memory-pressure mitigation |
| `gps_frozen` / `gps_unfrozen` | B4 | the missing real-callback-gap signal on both platforms |
| `real_callback_freshness` (periodic 30 s) | B4 | baseline freshness distribution |
| `onboarding_file_check` | C2 | per-file integrity at preload time |
| `file_checksum_quickhash` | C2 | partial-file corruption catch |
| `walk_start_cache_verify` | C2 | cache eviction between preload and walk |
| `audio_playerror_retry` | C4 | recovery attempt observation |
| `audio_uri_resolved` | C1 | path/URI debugging |
| `ios_gps_reacquire_attempt` / `..._recovered` | D3 | native reacquire effectiveness |
| Split `error_type` field on existing `audio_loaderror` / `audio_playerror` | C1 | distinguish not_found / decode / network / timeout |
| `session_diag.device_uuid`, `session_diag.is_loan` | A5 | loan device disambiguation |

`telemetry/scripts/analyze.mjs` additions:
- `--include-loan-only`, `--exclude-loan`, `--device-uuid <id>` filters (A5).
- New derived column "iOS GPS-frozen mins" — sum of `gps_frozen` durations per session.
- New summary: "audio failure mix" — counts split by `error_type`.

### 12.6b. Diagnostic-only telemetry — ship in phase 1 to narrow open questions

§12.6 lists telemetry created by behaviour-change workstreams (A1's `walk_end_shutdown`, B4's `gps_frozen`, etc.). This sub-section adds **telemetry-only** additions that ship without any behaviour change — pure observability to narrow GIVORS questions the post-hoc data can't currently answer. All [SAFE-TODAY], grouped by the question each one narrows.

#### Question: which Android kill mechanism is hitting Samsung A15 `f743` (×7 resumes), Xiaomi `mqgf` (×4), Samsung A045F `wjfo` (×4)?

R5.1 keepalive was live and the kills happened anyway. Today we know *that* the process died but not *why* — was it OOM, OEM background-restriction policy, a memory-pressure-induced abort, or something else?

**F-K1. `last_exit_reason` at `session_start` [SAFE-TODAY]** — power-optimization plugin (G2) + webapp.  
Android 11+ exposes `ActivityManager.getHistoricalProcessExitReasons(packageName, 0, 5)` — the OS's own record of why your process exited (`REASON_LOW_MEMORY`, `REASON_EXCESSIVE_RESOURCE_USAGE`, `REASON_USER_REQUESTED`, `REASON_PERMISSION_CHANGE`, `REASON_OTHER`, etc., plus a free-form `getDescription()` string). This is the single most useful data point we don't have today — it would tell us in one event whether `f743`'s 7 kills were OOM (→ B1 memory unload is the right fix) or OEM background-restriction (→ B3 Fused fallback is the right fix) or something else.  
Implementation: new `GetLastExitReasons()` action in power-opt plugin returning the last 5 reasons + timestamps + descriptions; called at `TELEMETRY.start` for the `session_resume` branch; payload merged into `session_resume.extra`.

**F-K2. `memory_state` periodic [SAFE-TODAY]** — power-optimization plugin (G2) + webapp.  
`ActivityManager.MemoryInfo` (`availMem`, `totalMem`, `lowMemory`, `threshold`) snapshotted every 60 s while parcours active. Cross-referenced with `step_media_unloaded` once B1 ships, tells us whether B1's unload pattern actually moved the needle.  
Also include `Debug.MemoryInfo` (heap + native) — Howler decodes hold native PCM in Java heap, this surfaces it.  
Files: power-opt plugin `GetMemoryInfo()` action, [www/app/pages.js](www/app/pages.js) periodic timer on parcours entry.

**F-K3. `bg_restrictions_recheck` periodic [SAFE-TODAY]** — webapp only, reuses existing power-opt API.  
Re-call `IsBackgroundRestricted()` + `IsPowerSaveMode()` + `IsIgnoringBatteryOptimizations()` every 5 min during the walk. Catches mid-walk policy flips (Samsung's "auto-policy on infrequently-used apps" can flip restrictions in the background). Today these only run once at `checkbatteryopt`.

#### Question: are iOS GPS blackouts CLLocationManager silent suspension, low-power mode, or something else?

S1 (26.3.1) and M1 (26.4.2) both look like iOS suspending background updates, but we can't see CLLocationManager's internal state from JS today.

**F-G1. `ios_cl_state` periodic [SAFE-TODAY]** — bg-geo plugin (G3 piggyback) + webapp.  
Every 30 s on iOS while parcours active, native side reads and emits:
- `[locationManager.location] != nil` and its `.timestamp` age in ms.
- `locationManager.allowsBackgroundLocationUpdates` (catches D4's hypothesis that iOS silently flips it).
- `locationManager.pausesLocationUpdatesAutomatically`.
- `locationManager.showsBackgroundLocationIndicator`.
- `[CLLocationManager authorizationStatus]` numeric.
- `[CLLocationManager locationServicesEnabled]`.

A blackout with all flags intact but `location.timestamp` stuck means iOS is suspending the delegate but not updating the cached location. A blackout with `allowsBackgroundLocationUpdates` flipped to `NO` means D4 is the right fix.

**F-G2. `app_visibility` bridge for iOS [SAFE-TODAY]** — webapp.  
Mobile-audit R3 (2026-05-18) noted iOS sessions emit zero `app_visibility` events because [geoloc.js:1019](www/app/assets/geoloc.js#L1019) only binds them to `bgGeo.on('background'/'foreground')` which iOS doesn't surface. Add a parallel binding via `document.addEventListener('visibilitychange')` + `document.addEventListener('pause'/'resume')` that updates `APP_VISIBILITY` and emits `app_visibility` symmetrically with the Android path.  
Closes a long-standing diagnostic blind spot — iOS background/foreground transitions are currently invisible in telemetry.

**F-G3. `power_state` periodic on iOS [SAFE-TODAY]** — bg-geo plugin (G3 piggyback) + webapp.  
Every 60 s: `[NSProcessInfo processInfo].lowPowerModeEnabled`, `[UIDevice currentDevice].batteryLevel`, `[UIDevice currentDevice].batteryState`. Tests the hypothesis "iOS suspends background work more aggressively under low-power mode" — if the GIVORS iOS blackouts all correlate with `lowPowerModeEnabled === true`, the operational mitigation is a single onboarding check (D1 sibling).

**F-G4. `bgtask_stats` periodic on iOS [SAFE-TODAY]** — bg-geo plugin (G3).  
Counts of `beginBackgroundTaskWithName:expirationHandler:` per minute, expiry events, time remaining at expiry. Tells us if the WebView's background time is being throttled before bg-geo's native callbacks would arrive.

#### Question: what is actually wrong with the failing audio files (S2)?

C1 + C2 + C3 already cover error subtypes, file integrity, and walk-start cache verify. Three further telemetry items pinpoint the *moment* of failure on the still-loading side.

**F-A1. `audio_load_duration` per file [SAFE-TODAY]** — webapp.  
Time from `PlayerSimple.load()` call to first `play` event for each step's voice + afterplay. A voice file that takes 8 s to load on weak Android (vs. ~200 ms on healthy) is a memory-pressure / disk-pressure signal even when load eventually succeeds. Outliers cluster around steps that go on to fail.  
Files: [www/app/assets/player.js](www/app/assets/player.js).

**F-A2. `audio_session_state` periodic on iOS [SAFE-TODAY]** — audiofocus plugin (G1 piggyback) + webapp.  
Every 60 s on iOS while parcours active: `AVAudioSession.outputVolume`, `currentRoute.outputs[0].portType` (Speaker / Headphones / BluetoothA2DP / ...), `currentCategory`, `categoryOptions`, `[session secondaryAudioShouldBeSilencedHint]`.  
Tests the hypothesis that `rumx`/`vigi` playerror clusters correlate with route changes (BT disconnects, headphones unplug) rather than file integrity. Today we have no visibility on this.

**F-A3. `audio_route_changed` events [SAFE-TODAY]** — audiofocus plugin (G1 piggyback) + webapp.  
iOS: `AVAudioSession.routeChangeNotification` → emit `audio_route_changed {reason, previous_port, current_port}`. Reasons include `OldDeviceUnavailable` (BT disconnect, headphone unplug — pauses audio on iOS), `NewDeviceAvailable`, `CategoryChange`, `Override`, `WakeFromSleep`.  
Android: `AudioManager.OnCommunicationDeviceChangedListener` (API 31+) + headphone broadcast receiver for older.  
Closes a known blind spot — Justine's "audio doesn't play" report (P7) could partly be unannounced BT disconnects when the spare phone was previously paired with a staff headset.

**F-A4. `audio_silence_detected` periodic on parcours [TEST-FIRST]** — webapp.  
Web Audio API `AnalyserNode` sampling `SILENT_PLAYER` output (which is the only signal we have that the audio engine is alive). If RMS samples come back genuinely zero — but `SILENT_PLAYER.isPlaying() === true` — the audio engine is in the m3/P7 silent-stale state. Emits `audio_silence_detected {duration_ms, expected_silent}`.  
The "expected_silent" flag distinguishes the SILENT_PLAYER's by-design silence from a stuck output: SILENT_PLAYER's source MP3 is genuinely silent, so we need to compare against the actual amplitude expectation per file. Conservative path: only emit when there's a *voice* player playing alongside and that's also reporting zero RMS.  
Tagged TEST-FIRST because Web Audio routing through NativeMediaPlayer on iOS may not feed back into the JS-side AudioContext at all — needs a 10-minute prototype before committing.

#### Question: where exactly do M2 / P6a zone overshoots land?

E2's sustain gate proposal needs calibration — should it require 2 consecutive samples or 5 s, accuracy ≤ zone radius or ≤ 15 m? Without an accuracy histogram, the constants are guesswork.

**F-Z1. `accuracy_near_border` periodic [SAFE-TODAY]** — webapp.  
Whenever `min(distanceToBorder)` across all reachable steps is < 20 m, log `{step_index, distance, accuracy, motion_stationary}`. The distribution informs E2's accuracy and sustain thresholds. ~50 events per walk per visitor near zone transitions.  
Files: [www/app/assets/parcours.js](www/app/assets/parcours.js) (`evaluateLostState` already has the distances computed).

**F-Z2. `step_fire_context` enrichment [SAFE-TODAY]** — webapp.  
At every `step_fire`: include `accuracy`, `consecutive_inside_samples` (new counter on Step), `time_since_first_inside_ms`, distance to each neighbour zone border. Lets us replay every `step_fire` post-hoc and answer "would E2's gate have blocked this?" without re-running the field.  
Files: [www/app/assets/spot.js](www/app/assets/spot.js).

**F-Z3. `step_fire_context` on premature-advance suspects [SAFE-TODAY]** — webapp.  
At every implicit `step_done` triggered by next-zone entry (vs. voice-ended): log the same context as F-Z2 plus `previous_step_audio_age_ms` (was the current voice still playing or already done?). Critical for E3 calibration.

#### Question: what's the audio engine actually doing at re-arm / session boundaries?

P7 needs A2 (engine reset at session_start) to land before we can validate. Diagnostic telemetry first:

**F-R1. `inter_session_idle_ms` at `session_start` [SAFE-TODAY]** — telemetry.  
At `session_start`, log time elapsed since the previous `session_end` / `walk_end_shutdown` from this device (read from a localStorage timestamp written on shutdown). Tells us how long the loan phone sat between visitors. If P7 correlates with idle > 30 min, the audio engine staleness is time-decay, not state-decay.

**F-R2. `rearm_pre_state` at `rearm_button` click [SAFE-TODAY]** — webapp.  
Snapshot before the existing rearm logic runs: `AUDIOFOCUS`, `SILENT_PLAYER` state (loaded/playing/paused/error), `PAUSED_PLAYERS.length`, `DUCKED_PLAYERS.size`, `iOS native fallback flag`, `AVAudioSession.currentCategory`, `[locationManager location].timestamp` age. Without this we have no idea what state the engine is in when Justine hits 4321 GO.  
Pairs naturally with A3's modal confirmation — same hook point.

#### Generic baseline (every parcours, every device)

**F-N1. `device_baseline` once at `session_diag` time [SAFE-TODAY]** — webapp.  
Single one-shot event listing: total memory, free memory, screen resolution, audio sample rate (`AudioContext.sampleRate`), output device (built-in / wired / BT), `navigator.hardwareConcurrency`, free disk on app sandbox (via `cordova-plugin-file` quota query). Pure baseline; lets us bucket sessions by hardware tier without crunching device-model lookups every analysis.

**F-N2. `screen_state` events [SAFE-TODAY]** — webapp.  
`document.addEventListener('visibilitychange')` already exists for F-G2 — also surface `screen.unlock` heuristically (visibility transitions to `visible` AFTER backgrounding for > 5 s = unlock). On Android, plugin-mediated via `cordova-plugin-screen-orientation` or a tiny native helper.  
Lets us tell "audio failed while phone was locked in pocket" apart from "audio failed while visitor was looking at the screen".

**F-N3. `step_fire_latency` [SAFE-TODAY]** — webapp.  
For each `step_fire`: time from the position-callback that triggered it to the `step_fire` telemetry emit. Surfaces JS-event-loop stalls (often correlated with audio decode on weak Android — confirms B1's premise).  
Files: [www/app/assets/spot.js](www/app/assets/spot.js).

#### Telemetry items consolidated — phase 1 deliverable

| ID | Question narrowed | Layer | Cost |
|---|---|---|---|
| F-K1 | Android kill reason root cause | power-opt plugin + JS | small native + JS |
| F-K2 | Memory pressure profile | power-opt plugin + JS | small native + JS |
| F-K3 | Mid-walk policy flips | JS only | trivial |
| F-G1 | iOS CL state during blackouts | bg-geo plugin + JS | medium native + JS |
| F-G2 | iOS app_visibility bridge | JS only | trivial |
| F-G3 | iOS low-power-mode correlation | bg-geo plugin + JS | small native + JS |
| F-G4 | iOS bgtask throttling | bg-geo plugin + JS | medium native + JS |
| F-A1 | Audio load duration outliers | JS only | trivial |
| F-A2 | iOS AVAudioSession state | audiofocus plugin + JS | small native + JS |
| F-A3 | Audio route changes (BT/headphones) | audiofocus plugin + JS | medium native + JS |
| F-A4 | Silent-stale audio engine detection | JS only (TEST-FIRST) | small JS |
| F-Z1 | Accuracy distribution near borders | JS only | trivial |
| F-Z2 | step_fire context enrichment | JS only | trivial |
| F-Z3 | premature-advance context | JS only | trivial |
| F-R1 | Loan-phone idle correlation | JS only | trivial |
| F-R2 | Audio engine state at rearm | JS only | trivial |
| F-N1 | Device baseline once per session | JS + tiny native quota | trivial |
| F-N2 | Screen state events | JS + tiny native helper | small |
| F-N3 | step_fire JS-loop latency | JS only | trivial |

**JS-only items** (F-K3, F-G2, F-A1, F-A4, F-Z1, F-Z2, F-Z3, F-R1, F-R2, F-N3): ship in phase 1, ~1 day's work, no plugin rebuild.

**Plugin-extension items** (F-K1, F-K2, F-G1, F-G3, F-G4, F-A2, F-A3): bundle with G1/G2/G3 plugin work in phase 2. Each is small and additive.

`telemetry/scripts/analyze.mjs` extensions to surface the new signals:
- `--show-kill-reasons` per-session breakdown of F-K1 outcomes.
- Per-session "iOS CL freezes" column derived from F-G1 stale-timestamp runs.
- Audio-error correlation matrix: F-A3 route-change events ± 30 s of every `audio_playerror`.
- F-Z1 histogram per visitor + fleet-wide, for E2 threshold calibration.

### 12.7. Workstream G — Plugin extensions (incremental fork work)

**G1. cordova-plugin-audiofocus extensions [TEST-FIRST]**.  
Two new actions, symmetric on both platforms:

- `resetAudioSession()` — iOS: `setActive:NO` → 100 ms delay → `setCategory:AVAudioSessionCategoryPlayback withOptions:0 error:&err` → `setActive:YES`. Android: `cancelFocus()` → `requestFocus()` → `startKeepalive()`.
- `releaseSession()` — iOS: stop the interruption observer (keep registration safe to re-add), `setActive:NO`. Android: `cancelFocus()` + `stopKeepalive()` + ensure FG service is fully torn down.

Also: in `handleInterruption` on iOS, log `[[AVAudioSession sharedInstance] currentRoute]` description and `outputVolume` — helps diagnose the m2 audiofocus fail flood by surfacing whether route changes are correlated.

Bump plugin version 1.4.1 → 1.5.0.

Files: [cordova-plugin-audiofocus/src/ios/AudioFocus.m](../cordova-plugin-audiofocus/src/ios/AudioFocus.m), [cordova-plugin-audiofocus/src/android/AudioFocus.java](../cordova-plugin-audiofocus/src/android/AudioFocus.java), [cordova-plugin-audiofocus/www/AudioFocus.js](../cordova-plugin-audiofocus/www/AudioFocus.js), [cordova-plugin-audiofocus/plugin.xml](../cordova-plugin-audiofocus/plugin.xml), [cordova-plugin-audiofocus/package.json](../cordova-plugin-audiofocus/package.json).

**G2. cordova-plugin-power-optimization — promote to fork + add remaining C5 methods [SAFE-TODAY]**.  
The in-place plugin at `FlanerieCordova/plugins/cordova-plugin-power-optimization/` (R5.2 was applied here without forking — see mobile-audit C5 note) is promoted to `~/Bakery/cordova-plugin-power-optimization/`, matching the audiofocus + bg-geo pattern. Same content; just relocate + update `FlanerieCordova/package.json` to point to the fork.

While the fork is being touched, add the remaining methods from the C5 backlog:

- `GetStandbyBucket()` (API 28+, `UsageStatsManager.getAppStandbyBucket()`) — telemetry-only at session_diag time. RESTRICTED / RARE buckets flag known-bad device states.
- `IsAutoRevokeWhitelisted()` (API 30+) — relevant long-term (auto-revoke disables apps that aren't opened for months); not blocking, telemetry-only.

Files: relocate `FlanerieCordova/plugins/cordova-plugin-power-optimization/` → `~/Bakery/cordova-plugin-power-optimization/`, [FlanerieCordova/package.json](../FlanerieCordova/package.json), `src/android/PowerOptimization.java`, `www/PowerOptimization.js`, `plugin.xml`, [www/app/pages.js](www/app/pages.js) (session_diag wiring).

**G3. cordova-background-geolocation-plugin extensions [RESEARCH-FIRST]**.  
Three independent additions, all to the same fork:

- B2 — Android AlarmManager wakeup (`LocationWakeReceiver.java`).
- B3 — Android conditional FusedLocationProvider.
- D3 / D4 / D5 — iOS forced reacquire + periodic flag re-assertion + SLC-triggered reacquire bridge.

Bump plugin version 2.4.0 → 2.5.0.

Files: [cordova-background-geolocation-plugin/android/...](../cordova-background-geolocation-plugin/android/), [cordova-background-geolocation-plugin/ios/...](../cordova-background-geolocation-plugin/ios/), `plugin.xml`, [www/app/assets/geoloc.js](www/app/assets/geoloc.js).

### 12.8. Sequencing & risk

**Phase 1 — JS-only, ship for next field test (1–2 days, NO plugin rebuild)**
A3, A4, A5, A6 (server piece), A7; B1, B4; C1, C2, C3, C4, C5; D1, D6; E1, E2, E3; F2–F5 (analyze.mjs).  
**Plus all JS-only diagnostic telemetry from §12.6b**: F-K3, F-G2, F-A1, F-A4, F-Z1, F-Z2, F-Z3, F-R1, F-R2, F-N3 (≈1 extra day). Ships before any behaviour change so the next field run produces the data needed to validate / calibrate phase-1 behaviour changes.  
Risk: most are low-blast-radius behaviour changes. B1 (aggressive unload) and E2/E3 (sustain gates) are the highest-risk items and should be exercised on the `tools` devmode page before shipping.

**Phase 2 — Plugin rebuild + Play Store push (3–5 days)**
A1, A2 (plugin-action half), G1 (audiofocus reset/release), G2 (power-opt fork promotion + GetStandbyBucket).  
**Plus plugin-extension diagnostic telemetry from §12.6b**: F-K1, F-K2 (power-opt), F-G1, F-G3, F-G4 (bg-geo), F-A2, F-A3 (audiofocus), F-N1 (file quota). All small native additions bundled with the same plugin rebuilds.  
Validation matrix: full 45-min Samsung A15 walk; full 45-min iPhone walk; loan-phone re-arm cycle ×5 (the Justine scenario).

**Phase 3 — Deep native + Android resilience (1 week, dedicated field test)**
B2, B3, G3 (Android AlarmManager + Fused); D3, D4, D5, G3 (iOS reacquire/flag/SLC); C6 conditional on whether wjfo recurs after C2/C4/B1.  
Validation requires dedicated outings: a Samsung A15-class device under deliberate memory pressure; a side-by-side iOS 26.3.1 + 26.4.x walk.

### 12.9. Open decisions / unknowns

1. **PWA cache bust for §11**: A6 covers the parcours-JSON skew but not the webapp-hash skew. Forcing a service-worker cache purge between visitors is invasive. Question: is the operator's existing 4321 GO re-arm flow an acceptable place to force a hard reload (`location.reload(true)` + SW unregister) on every new session? Would close §11 11a entirely at modest UX cost. **Status (2026-05-23): punted; phase 1A ships without it, revisit before phase 2.**
2. **Last-step cutoff (E4)**: needs a look at the live parcours JSON, not addressed in this plan. **Status: deferred to a separate parcours review.**
3. **C4 retry path** assumes a single playerror is recoverable by engine reset. If field telemetry from C1 shows playerrors are dominated by `decode_failed` (i.e. truly broken file), C4 is the wrong fix and we should pivot to a per-file fallback chain (download a backup variant or skip the file with a spoken "désolé, fichier indisponible" placeholder). Decide after one field test with C1 telemetry. **Status: blocked on phase 1A C1 telemetry → next-week field test.**
4. **Loan-phone identity (A5)**: do we want the device UUID echoed to the server during onboarding (so operators can see "this phone is FP-A12-04" on a dashboard), or kept telemetry-only? Affects whether server.js needs a `/devices` registration endpoint. **Status (2026-05-23): RESOLVED — add `/devices` endpoint. A5 scope grows: server.js gets a `POST /devices` that takes `{uuid, last_seen, manufacturer, model, friendly_name?}` and an operator-only `GET /devices` dashboard JSON.**

### 12.10. Phase 1A — recommended next batch (drafted 2026-05-23)

Calendar context (decided 2026-05-23):
- Next field test: **next week** (~2026-05-30, ±2 days).
- Next show: **~4 weeks out** (~2026-06-20).
- Target: most GIVORS issues fixed before the show.

Backwards-planned schedule:
- **This week**: Phase 1A — pure JS-only batch, ships before next field test. Diagnostic telemetry + trivial fixes that don't need field-data calibration.
- **Next week**: field test on the Phase 1A build. Telemetry from F-Z*, F-A1, F-K3, F-R*, F-G2 calibrates Phase 1B.
- **Week 3**: Phase 1B (calibrated behaviour changes) + Phase 2 (plugin rebuild + Play Store submission).
- **Week 4**: Phase 3 (native iOS reacquire + Android resilience) + final field validation before show.

iOS test-device note (2026-05-23): no 26.3.x device confirmed yet, user will source one. Workstream D native code (D3/D4/D5) is still planned to ship — implemented against Apple's docs; validated on whatever iOS device is available + on a 26.3.x device when one surfaces. The B4 watchdog is platform-independent and validates the JS-side hypothesis on any iOS device.

#### Phase 1A scope (this week, ~2 days)

**Trivial fixes (each 1–3 h):**

| ID | Files | Behaviour change |
|---|---|---|
| A4 | [www/app/assets/spot.js](www/app/assets/spot.js) (fire branch), [www/app/assets/parcours.js:118 snapshotVoicePosition](www/app/assets/parcours.js#L118) | Clear `resumeStepVoicePos = 0` on `step_fire`; gate `snapshotVoicePosition()` to skip the first 3 s after fire. Closes P8 (`rumx` cross-step seek). |
| A5 | [www/app/assets/telemetry.js](www/app/assets/telemetry.js), [www/app/pages.js](www/app/pages.js) (`tools` page), [server.js](server.js), [telemetry/scripts/analyze.mjs](telemetry/scripts/analyze.mjs) | DEVICE_UUID + IS_LOAN_DEVICE flag in `session_diag`; **plus** `POST /devices` registration endpoint and `GET /devices` operator JSON list (decision #4 resolved). |
| A7 | [www/app/pages.js](www/app/pages.js) (`PAGES['end']` tail), [www/app/app.html](www/app/app.html) (overlay), [www/app/app.css](www/app/app.css) | Full-screen "la balade est terminée, tu peux ranger le téléphone, la suite t'attend" lock screen at walk end (copy generic — works for both loan and personal phones; signals that the show continues with a non-phone chapter). Dismissable only via the existing 5-tap-bottom devmode pattern. Closes m3 post-walk noise. |
| C1 | [www/app/assets/player.js](www/app/assets/player.js) | Split `audio_loaderror`/`audio_playerror` payloads — proper error serialisation, `error_type ∈ {not_found, network, decode_failed, src_unsupported, timeout, stuck}` per backend. Adds `audio_uri_resolved` at every `PlayerSimple.load()`. Closes t2 + R7.1. |
| D1 | [www/app/pages.js](www/app/pages.js) (`PAGES['confirmgeo']`) | Soft-block + Settings deep-link on iOS `device.version < 26.4`. Operator-tap override. **Operational mitigation only — does not replace the underlying fix (B4 watchdog in 1B + D3/D4/D5 native reacquire in phase 3). D1 reduces exposure while those land, then stays in place as a long-tail safety net for future iOS regressions.** |

**Diagnostic-only telemetry (≈1 day total, all JS-only items from §12.6b):**

| ID | Files | What it observes |
|---|---|---|
| F-G2 | [www/app/assets/geoloc.js](www/app/assets/geoloc.js) (`document` event bindings) | iOS `app_visibility` bridge via `document.pause`/`resume`/`visibilitychange`. Closes mobile-audit R3 finding. |
| F-A1 | [www/app/assets/player.js](www/app/assets/player.js) | `audio_load_duration` per file (load→first-play latency). |
| F-A4 | [www/app/assets/player.js](www/app/assets/player.js) | `audio_silence_detected` periodic via Web Audio AnalyserNode on SILENT_PLAYER (TEST-FIRST gated to Android initially; iOS NativeMediaPlayer doesn't route through AudioContext). |
| F-Z1 | [www/app/assets/parcours.js](www/app/assets/parcours.js) (`evaluateLostState` already has the distances) | `accuracy_near_border` periodic when `min(distanceToBorder)` < 20 m. |
| F-Z2 | [www/app/assets/spot.js](www/app/assets/spot.js) (fire branch) | `step_fire_context` enrichment: accuracy, consecutive_inside_samples, time_since_first_inside_ms, neighbour-zone distances. Requires new `_firstInsideSampleAt` + `_consecutiveInsideCount` fields on `Step`. |
| F-Z3 | [www/app/assets/spot.js](www/app/assets/spot.js) | `step_implicit_done` enrichment when promotion is triggered by next-zone entry (vs voice-end). Same fields as F-Z2 + `previous_step_audio_age_ms`. |
| F-R1 | [www/app/assets/telemetry.js](www/app/assets/telemetry.js) | `inter_session_idle_ms` at `session_start` (localStorage timestamp written on shutdown). |
| F-R2 | [www/app/pages.js](www/app/pages.js) (`rearm_button` click handler) | `rearm_pre_state` snapshot. |
| F-N3 | [www/app/assets/spot.js](www/app/assets/spot.js) | `step_fire_latency` (position-callback → step_fire emit). |
| F-K3 | [www/app/pages.js](www/app/pages.js) | 5-min periodic re-check of `IsBackgroundRestricted` / `IsPowerSaveMode` / `IsIgnoringBatteryOptimizations` during parcours (Android only). |

**Plus diagnostic half of B4** (no UI band, no behaviour change):
- `GEO.lastRealCallbackTime` field updated only by real callbacks (not heartbeat / NSTimer keepalive).
- `real_callback_freshness` event every 30 s with `lastRealCallbackTime_ms_ago`, `motionIsStationary`, `visibility`.
- No `#frozen-band` overlay, no behaviour change, no `gps_frozen` event yet — those land in phase 1B once we've seen the JS-side data confirms the hypothesis.

Files: [www/app/assets/geoloc.js](www/app/assets/geoloc.js).

#### Explicitly NOT in Phase 1A (and why)

- **E1/E2/E3** zone-overshoot sustain gates — constants need F-Z1 distribution data. Ship in phase 1B.
- **B1** aggressive media unload — wants F-K2 memory data first. Phase 1B.
- **B4 UI band** — diagnostic half ships in 1A, behaviour-change half in 1B.
- **C2** preload/walk-start file integrity — moderate scope, ship in phase 1B with the operational batch.
- **C4** audio playerror retry — depends on C1 outcome; might pivot to per-file fallback if `decode_failed` dominates (open decision #3).
- **A1/A2/A3** lifecycle hygiene — needs G1 audiofocus plugin actions. Phase 2.
- **A6** parcours freshness check — needs `server.js` `X-Parcours-Steps` header; pairs naturally with A5's `/devices` work in phase 2 rebuild, but can slip into phase 1B if there's time.
- **All §12.7 G plugin work** — phase 2.
- **All §12.4 D3–D5 native iOS work** — phase 3.

#### Phase 1A acceptance criteria

- Healthy walk on any device produces all 10 new telemetry events.
- A4: kill the app between two steps, relaunch — `step_fire` event clears `resumeStepVoicePos`; subsequent `parcours_store` events show `resumeStepVoicePos: 0` until the new step's voice has played ≥3 s.
- A5: a fresh install assigns a UUID, persists across launches; devmode "mark as loan" toggle is reflected in subsequent `session_diag` payloads; `POST /devices` records the UUID server-side.
- A7: `PAGES['end']` runs → `#walk-handback` overlay covers the screen, tapping it does nothing, 5-tap-bottom devmode pattern still works.
- C1: a deliberately broken file (e.g., rename `BLOC_01.mp3` to `BLOC_01.mp3.bak` on the device) produces `audio_loaderror` with `error_type: 'not_found'`, not `[object Object]`.
- D1: an iOS device with `device.version === '26.3.1'` shows the soft-block on `confirmgeo`.

