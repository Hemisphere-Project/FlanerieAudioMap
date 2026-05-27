# Field Test Report — 2026-05-20 · FLANERIE GIVORS

**Parcours:** FLANERIE_GIVORS (id `flanerie_givors_v7_cbr`, 17 steps 0–16).
**Files:** 110 total | 7 pre-opening | 103 visitor-wave sessions.
**Field reports cross-referenced:** Mélanie (FP3 08:57), John (~16h loan phone), Justine (operator tent), unnamed teacher (iPhone 09h–09h30).
**Expected visitors:** ~45–50 (15–20 on loaned phones).
**Builds in fleet:** webapp hashes `fdf504c8` (~29 sessions) and `2f77776e` (~35 sessions), per-device PWA cache, interleaved through the day (see §11). Which hash is newer is unconfirmed.
**Generated:** 2026-05-22, consolidated 2026-05-27.

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

| Class | Ref | Description | Sessions | Fix path (status) |
|---|---|---|---|---|
| **SIGNIFICANT** | S1 | iOS 26.3.1 GPS multi-gap regression (8–14 min blackouts) — incomplete walks | 51nv, ibk6, mq3z | D1 warning shipped; D3/D4/D5 native reacquire shipped in bg-geo v2.6.0/2.7.0 |
| **SIGNIFICANT** | S2 | Audio narration failures across many BLOC files — load failures + playback failures concentrated on large/late files and stressed devices | wjfo, vigi, rumx (+ mq3z, 0vvc) | C1 error classification + C2 integrity check + C4 retry shipped |
| **MODERATE** | M1 | iOS 26.4.2 brief GPS gaps (2–5 min); walk stopped at step 15, step 16 never fired | 19dh, rumx | B4 forceReacquire watchdog shipped (iOS) |
| **MODERATE** | M2 | step_resume_current stutter — 2 s audio jump-back; severe cases place phone just inside adjacent zone, premature `step_done`, wrong step audio | yapj, 19dh, 189t, 5kd4, c7qo, h6os, 5kkz, 2tqf | E1/E2/E3 zone gates pending field calibration |
| **MODERATE** | M3 | Silent audio on loan-phone re-arm — walk page loads normally but audio does not start; navigating to root and back resolves | SM-A515F loan phones | A1 walk-end shutdown + A2 session-start engine reset + A3 rearm flow shipped |
| **MODERATE** | M4 | Android Howler cold-load race — first-install phone enters walk page, GPS fires step 0 while BLOC_01 still loading; play() silently queued; ~70 s silence; visitor restarts | 5eb0→9qf4, 4ha8→aibf, 85iu→2tqf, ygi1→0vvc (4 restart-pairs, all Android, none SM-A515F) | A8 deferred-play + A8b SAS step 0 pre-warm shipped |
| **MINOR** | m1 | Android OEM kill — app crashed and refired step, walk recovered. ~20 sessions had ≥1 `session_resume` | f743 (7), mqgf (4), wjfo (4), 2j5u/rumx (3), h6os/0vvc/5eb0 (2), 2d5g + ~14 more | B1 media unload + BG-5 AlarmManager Doze + B3 Fused (conditional) |
| **MINOR** | m2 | iOS audiofocus fail flood — 4929 events fleet-wide, never walk-breaking. Not iOS-26-only: iOS 18 devices also hit it | c7qo, 4zq0, 4rma, 19dh, 7p2j, xuyx | C5 parsimony review (current path already conservative); G1 audiofocus_session_reset fix to "fail once stay poisoned" path shipped |
| **MINOR** | m3 | No walk-end shutdown — GPS/audio kept running 1–2 h post-completion, telemetry not flushed | 7p2j, xuyx, 9hjo, mwbo | A1 walk_end_shutdown + telemetry flush + A7 generic copy shipped |
| **TOOLING** | t1–t4 | No walk-start cache verify; audio error subtypes undiscriminated; no checksum; no loan-device flag | — | All shipped: C3=C2 walk-start verify, C1 error subtypes, A5 loan flag + UUID + `/devices` registry |

---

## 2. Session analysis and classification

### EXCLUDE — noise / test / post-walk (~51 sessions)

| Sub-category | Sessions | Count |
|---|---|---|
| Pre-opening tests | `juow` `x0w3` `6wvb` `xcak` `95am` `faoy` `df6e` | 7 |
| SM-A515F re-arm blips (≤5 min, 0 steps) | `yevh` `qetf` `mert` `lv8k` `quo5` `29p4` `524v` `hnto` `xsct` `jv47` + end-of-day cluster 17:10–17:28 | ~30 |
| Operator test between loans | `1r8h` `oupu` | 2 |
| Post-walk idle (app left open after completion) | `7p2j` `xuyx` `9hjo` `mwbo` `tg6o` | 5 |
| Resumed already-finished session | `4o57` `xhde` | 2 |
| Staff / team transfer phones | `hpk9` `ffqz` `avm3` `7m25` `nayi` | 5 |

> `ffqz`/`avm3` are the same physical Xiaomi 2201117TY used twice; `ignoring_batt_opt=true` does not prevent Android 13 from killing the GPS provider, so if ever loaned to a visitor the blackout will recur. `nayi` (moto g04s) ran steps 0–2 then idle 1h44m — confirmed staff transfer.

### VALID — clean full completions (16 sessions)

| Session | Device | OS |
|---|---|---|
| `pw5b` | iPhone 14 Pro | iOS |
| `k8ps` | iPhone 14 Pro | iOS |
| `232o` | OPPO A92 | Android |
| `mqlj` | Pixel 6a | Android |
| `4fu5` | Galaxy XCover5 | Android |
| `dyo5` | Galaxy S10 | Android |
| `9qf4` | Galaxy A12 | Android |
| `knj6` | Xiaomi 13T | Android |
| `bm1g` | iPhone 13 mini | iOS |
| `akbc` | iPhone SE 2nd gen | iOS |
| `781m` | Pixel 6a | Android |
| `p04e` | Galaxy A33 | Android |
| `n6id` | Galaxy A14 | Android |
| `sqvb` | iPhone 15 | iOS |
| `4zq0` | iPhone 13 Pro | iOS |
| `892p` | Galaxy A56 | Android |

All steps fired in strict sequential order; no GPS gaps ≥ 90 s; no audio errors.

> **Note — `892p` ran a stale 18-step config** (`FLANERIE_GIVORS_V7_CBR`); completed cleanly, but not directly comparable to the 17-step live parcours. See §11.

### VALID — completed with issues (21 sessions)

`SRC` = `step_resume_current` count from the `analyze` flag. `Audio` = `step_voice` errors split play/load.

| Id | Device | OS | Res | SRC | Audio | Notes |
|---|---|---|---|---|---|---|
| `2d5g` | FP3 | A13 | 1 | 0 | 0 | OEM kill at step 12 when visitor opened camera — Mélanie field report |
| `f743` | SM-A155F | A16 | 7 | 0 | 0 | OEM-killed ×7, all steps done |
| `mqgf` | 22111317G | A14 | 4 | 0 | 0 | 4 OEM kills steps 12–16, recovered |
| `wjfo` | SM-A045F | A14 | 4 | 0 | 15 load | `audio_loaderror` ×15 across 8 BLOC files + 9 timeout / 9 stuck — see §P2 |
| `2j5u` | RMX3286 | A13 | 3 | 0 | 0 | 3 OEM kills, recovered |
| `h6os` | SM-A156B | A16 | 2 | 2 | 0 | 2 OEM kills + 2× step_resume_current (§P6) |
| `ogro` | M2101K7AG | A11 | 1 | 0 | 0 | audioTimeout=1, audioStuck=1, lost=1/rec=1 |
| `c7qo` | iPhone 14 | iOS 26.4.2 | 0 | 2 | 0 | 2× step_resume_current; audiofocusFail=1446; ran 18-step config (§11) |
| `0vvc` | SM-A047F | A14 | 2 | 0 | 3 load | `audio_loaderror` ×3 on BLOC_13/15/16 (new webapp) |
| `kctv` | 25062RN2DE | A16 | 1 | 0 | 0 | 1 OEM kill, recovered |
| `5kd4` | SM-S901U1 | A16 | 1 | 2 | 0 | 1 OEM kill + 2× step_resume_current |
| `189t` | SM-S721B | A16 | 0 | 3 | 0 | 3× step_resume_current |
| `yapj` | SM-G990B2 | A13 | 1 | 4 | 0 | 4× step_resume_current, `border` −0.25 to −0.64 m — John field report (§P6a) |
| `0d5l` | SM-S901U1 | A14 | 1 | 1 | 0 | 1× step_resume_current (step 4) |
| `9iyw` | iPhone 15 Pro | iOS 26.2.1 | 0 | 1 | 0 | 1× step_resume_current |
| `5kkz` | SM-S938B | A14 | 0 | 2 | 0 | 2× step_resume_current |
| `2tqf` | moto g24 power | A14 | 0 | 2 | 0 | 2× step_resume_current |
| `bi6k` | SM-G970U1 | A12 | 0 | 0 | 0 | lost=2/rec=2 brief GPS dips |
| `6epi` | iPhone 13 Pro | iOS 18.0 | 0 | 0 | 0 | lost=1/rec=1 brief GPS dip |
| `168c` | 24117RN76E | A14 | 0 | 0 | 0 | lost=1/rec=1 brief GPS dip |
| `ykr5` | Xiaomi 13T | A15 | 0 | 0 | 0 | stale=161, triggerRejected=176; 45-min stall between step 15 fire and step 16 (session ran 82 min) |

#### OEM kills and crashes (Android)
~20 sessions had at least one mid-walk relaunch. Heaviest: `f743` 7, `mqgf` 4, `wjfo` 4, `2j5u`/`rumx` 3, `h6os`/`0vvc`/`5eb0` 2. The resume machinery worked — no walk was lost to a crash.

#### Audio narration failures — span many files, not 3
Failures hit ≥14 distinct files, BLOC_01 through BLOC_16 plus liaisons. BLOC_10/15/16 recur most often because they are large and late, not because they are uniquely affected. Three error mechanisms now distinguishable since C1 (split error subtypes):

| Session | Error type | Distinct files hit |
|---|---|---|
| `rumx` (iOS) | 27 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_04, 06, 10 (A+B), 15 (VOIX+MUSIC), 16 |
| `vigi` (iOS) | 21 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_10 (A+B), 14, 15, 16 |
| `wjfo` (Android) | 15 `audio_loaderror` + 9 timeout + 9 stuck | BLOC_01, 02, 03, 10, 11, 13, 15, 16 |
| `mq3z` (iOS) | 5 `audio_playerror` | Liaison_1_2, Liaison_2_3, BLOC_02, 03, 14 |
| `0vvc` (Android) | 3 `audio_loaderror` | BLOC_13, 15, 16 |

Files skew large (~6–11 MB), but BLOC_03 (2.5 MB) and liaisons (2.6–3.2 MB) also failed — size is a lean, not a gate. Each step loads voice + music pair (~15 MB at once).

`rumx`, `vigi`, `wjfo` all ran webapp `fdf504c8`; `0vvc` on `2f77776e` still had loaderrors. Build version is per-device cache; correlation, not cause.

#### iOS audiofocus failures (non-fatal)
4929 `audiofocus_request_fail` fleet-wide on iOS vs. 52 on Android. High per-session: `4zq0` 1545, `c7qo` 1446, `4rma` 747, `19dh` 332, `xuyx` 376, `7p2j` 272. **Not an iOS-26-only issue** — `4rma` (iOS 18.5) and `7p2j` (iOS 18.0) contributed ~1000 fails between them. All walks completed regardless. See m2.

### PROBLEMATIC — GPS incomplete, walk stopped short (5 sessions)

| Id | Device | OS | GPS gaps | Reached | Key issue |
|---|---|---|---|---|---|
| `51nv` | iPhone17,5 | iOS 26.3.1 | 4 (worst 14 min) | Step 15 | Missed steps 2–4, 9–12 |
| `ibk6` | iPhone 14 | iOS 26.3.1 | 4 (worst 9 min) | Step 12 fired (route reached 15) | Missed steps 2–6, 8–9, 12–14 |
| `mq3z` | iPhone 14 | iOS 26.3.1 | 3 (worst 8 min) | Step 13 | Missed steps 3–7; 5 `step_voice` playerror |
| `rumx` | iPhone 14 | iOS 26.4.2 | 5×~2 min | Step 15 | 27 audio playerror + 3 resumes + stale-seek-pos |
| `19dh` | iPhone 14 | iOS 26.4.2 | 3×~2 min | Step 15 | Step 16 never fired; 3× step_resume_current |

> `vigi` is **not** in this set — it had **0 GPS gaps ≥ 90 s** (422 fixes, avgAcc 8.4). Its incompleteness is audio-driven: 21 `audio_playerror` on BLOC_14/15/16. Belongs with S2.

iOS 26.3.1 (`51nv, ibk6, mq3z`) — 4–5 GPS gaps of 8–14 min each. Beta-specific regression. → S1 / §P3.
iOS 26.4.2 (`rumx, 19dh`) — shorter gaps; both stopped at step 15 without triggering step 16. → M1.

### PROBLEMATIC — abandoned (1 session)

| Id | Device | OS | Max step | Reason |
|---|---|---|---|---|
| `4rma` | iPhone 14 | iOS 18.5 | Step 11 | Walked cleanly to step 11 (no GPS gaps, no audio errors) then stopped. 747 audiofocus fails. 0 crashes — not the teacher's phone (§P8). Likely gave up / handed back. |

### Grand total

| Category | Count |
|---|---|
| Exclude | ~51 |
| Valid — clean | **16** |
| Valid — with issues | **21** |
| Problematic — GPS incomplete | 5 |
| Problematic — abandoned | 1 |
| **Meaningful visitor sessions** | **43** |

> `analyze.mjs` raw tally with `--cutoff=0854 --operator=SM-A515F`: 66 visitor sessions (110 files − 7 pre-opening − 37 SM-A515F operator). Of the 66: completed 45 · incomplete 8 (`19dh, mq3z, rumx, 51nv, 4rma, vigi, ibk6, nayi`) · aborted 13 (≤ step 0, < 5 min). The qualitative buckets above and `analyze`'s split count different things — use `analyze` for raw tally, the buckets for interpretation.

#### Recurring structural patterns (not errors)
- `step_skip_done` on steps 8, 13, 15 — consistent fleet-wide; overlapping GPS zones, both outgoing and incoming confirm done.
- 3–4 min silence between step 9 done and step 10 fire on nearly all sessions — walker moves between non-overlapping zones.
- Step 4 is a choice step where visitors can linger; `ogro, c7qo, h6os` show step 4 fired then GPS moves to step 5 ~1.5 min later without step 4 confirming done. Intentional.

---

## 9. Priority issues (analysis)

### P2 — Audio narration failures (root cause partly open)

Media is downloaded during onboarding (name + size verified). Runtime server delivery is not the cause.

**Failures span ≥14 distinct files** across `rumx, vigi, wjfo, mq3z, 0vvc`. BLOC_10/15/16 recur most because they're large and late, not because they're uniquely affected.

**Three error mechanisms, now distinguishable** (C1 shipped):
- `audio_loaderror` — file could not load (`wjfo` 15, `0vvc` 3).
- `audio_playerror` — file loaded but playback/decode failed (`rumx` 27, `vigi` 21, `mq3z` 5).
- `audio_play_timeout` / `audio_play_stuck` — playback did not start in window (`wjfo` had 9 + 9).

Failures skew large but not exclusively. Each step loads voice + music pair (~15 MB at once) — heavy for weak/stressed devices.

**Causes still open** (rough probability order): corrupt download passing the name+size check; cache/path issue after OEM kill; audio pipeline overload on large pairs.

**Diagnostic shipped:** C1 split error subtypes + C2 onboarding/walk-start integrity check + `audio_uri_resolved` field. Mitigation: C4 single-retry with engine reset on first playerror, then fall through to afterplay.

### P3 — iOS 26.3.1 GPS multi-gap regression
`51nv, ibk6, mq3z` — 4–5 GPS gaps of 8–14 min, far worse than 26.4.2. Beta-specific. **Fix shipped:** D1 onboarding warning; D3 native `forceReacquire` (bg-geo v2.6.0); D4 periodic flag re-assertion; D5 SLC auto-reacquire; B4 watchdog (iOS) calls forceReacquire after 60 s real-callback stall.

### P4 — Operator rearm cut active walk
`oupu` was re-armed mid-walk at step 11. **Fix shipped (A3):** confirmation modal + full A1 teardown + routing to `PAGE('rdv')`.

### P5 — App not closed after walk
4 sessions ran 1–2 h post-completion, adding GPS noise and keeping connections open. **Fix shipped (A1 + A7):** `walk_end_shutdown` + telemetry flush + generic end copy ("La balade est terminée. Tu peux ranger le téléphone. La suite t'attend."). A 5-tap on end page reloads back to title (by design — used for loan-phone rearm).

### P2a — Telemetry improvements for audio pre-load diagnosis
All shipped:

| Event | Status |
|---|---|
| `onboarding_file_check` per file | covered by C2 `media_integrity_check` |
| `walk_start_cache_verify` before step 0 | C2 at PAGES['parcours'] entry |
| Checksum on largest files | C2 dryrun read with hash |
| Split audio error codes | C1 `error_type` enum |
| `audio_uri_resolved` | C1 |

### P6 — step_resume_current double-resume on GPS quality recovery

**Mechanism:** When GPS drops ≥ 10 s, `stateUpdateTimeout` fires → `pauseAllPlayers()`. On recovery, first incoming position enters zone check in `spot.js:609` — `step_resume_current` calls `player.resume()` directly, *before* `GPSSIGNAL_OK` is reset. ~1 s later, `stateUpdate('ok')` → `resumeAllPlayers()` iterates `PAUSED_PLAYERS` and calls `player.resume()` a second time. Audio jumps back ~2 s.

**Affected:** `yapj` ×4, `19dh` ×3, `189t` ×3, `5kd4` ×2, `c7qo` ×2, `h6os` ×2, `5kkz` ×2, `2tqf` ×2, plus 5× single occurrences.

**Status:** E1/E2/E3 gates (GPSSIGNAL_OK gate + accuracy gate + sustained-sample gate) — **pending VILLEURBANNE calibration data** (`accuracy_near_border` distribution).

### P6a — GPS zone boundary overshoot causing wrong-step playback (John / `yapj`)

A severe variant of P6. `yapj` 4 events all fire within ~0.5 m of zone borders (inside GPS noise floor). John reported wrong-step audio and followed other visitors to recover, rejoining at BLOC_15.

| Time | Event | distanceToBorder | visibility |
|---|---|---|---|
| 20.5 min | step 9 (BLOC_10) | −0.48 m | background |
| 25.3 min | step 12 (BLOC_13) | −0.64 m | background |
| 27.3 min | step 13 (BLOC_14) | −0.55 m | background |
| 30.8 min | step 13 (BLOC_14) | −0.25 m | foreground |

**Status:** E2 sustained-sample gate (≥ 2 consecutive samples inside AND accuracy ≤ zone radius before `step_done` advance or `step_resume_current`) — pending field calibration.

### P7 — Silent audio on fresh visitor start after loan-phone idle (Justine)

4–5×/day on SM-A515F loan phones: after 4321 GO, walk page mounts and GPS starts, but audio doesn't play. Navigating to app root and back resolves.

**Mechanism:** Audio engine in stale state from prior session — paused/ended ref or stale audio focus.

**Status: shipped.** A1 walk-end shutdown drains `PAUSED_PLAYERS`/`DUCKED_PLAYERS`, reloads `SILENT_PLAYER`, calls `releaseSession()`. A2 session-start engine reset on `PAGES['parcours']` (non-resume) awaits `resetAudioSession()` and re-arms `AUDIOFOCUS = 1`. A3 rearm flow forces a clean end + clean start.

### P8 — Stale seek-position on iOS app crash resume (`rumx`)

`rumx` had 3 app crashes; all 3 resumes restored `seek_pos = 279.0 s` regardless of step (steps 13 and 15, twice). Position written by a previous step's `parcours_store` was applied to the new step's audio.

**Status: shipped (A4).** `resumeStepVoicePos = 0` cleared on `step_fire`; `snapshotVoicePosition()` skips first 3 s of a freshly-fired step.

### P9 — Android Howler cold-load race on first-install (M4)

Four confirmed restart-pairs all share identical telemetry:
```
+0.0 s  session_start (is_resume_branch: false)
+0.1 s  audio_play_started (SILENT_PLAYER works)
+0.6 s  step_audio_trigger step 0, player_load_state_before_play: 'loading,empty'
+0.7 s  step_fire (visitor sees "Je suis perdu", no audio)
+15 s   stuck-retry
+30 s   audio_play_stuck + audio_play_timeout
+70 s   audio_play_started (visitor has already restarted)
```

| Failed | Device | Successful retry |
|---|---|---|
| `5eb0` | SM-A125F | `9qf4` (+2:23) |
| `4ha8` | SM-A528B | `aibf` (+2:29) |
| `85iu` | moto g24 power | `2tqf` (+1:34) |
| `ygi1` | SM-A047F | `0vvc` (+1:17) |

**Mechanism:** BLOC_01 (11.2 MB, largest file) is loading when GPS fires step 0. `PlayerSimple.play()` is called while Howler state is `'loading'`. Howler's internal play-queue silently fails on Android WebView. After ~70 s the load completes; by then visitor has restarted.

**Why loan phones unaffected:** SM-A515F ran 30+ rearm sessions throughout the day — BLOC_01 was already cached.

**Status: shipped.**
- **A8 (Round 15)** — `PlayerSimple.play()` registers `once('load', …)` when Howler state is `'loading'`. Audio fires the moment the file is ready.
- **A8b (Round 17)** — `PAGES['sas']` entry calls `PARCOURS.spots.steps[0].prewarmForLockedStart('sas-entry')`. While visitor types 4321 (5–30 s), Howler loads BLOC_01 in background.

---

## 11. Build & parcours-config skew (stale PWA cache)

The fleet did not all run the same code or the same parcours config.

### 11a. Webapp build skew
`session_diag.webapp_hash` shows two values on 2026-05-20 — `fdf504c8` (~29 sessions) and `2f77776e` (~35 sessions), interleaved throughout the day. Per-device PWA cache, not a timed rollout. `apk_version` (12 iOS, 13 Android) only tracks platform.

Which hash is newer is **unconfirmed**. The three worst audio-failure sessions all ran `fdf504c8` but `0vvc` on `2f77776e` still had loaderrors — correlation, not proven cause.

### 11b. Parcours-config skew — 18-step vs 17-step
Three sessions carry `FLANERIE_GIVORS_V7_CBR` (18 steps); all others carry `FLANERIE_GIVORS` (17 steps, live config since 2026-05-20 11:45).

| parcoursName | Steps | Sessions |
|---|---|---|
| `FLANERIE_GIVORS` | 17 (0–16) | 63 |
| `FLANERIE_GIVORS_V7_CBR` (stale) | 18 (0–17) | `892p`, `c7qo`, `vu26` |

`892p` and `c7qo` completed their 18-step config cleanly; `vu26` is a 43 s blip. Impact: low for this test, but per-step fleet comparisons must bucket the two configs separately, and a *badly* stale cache could run outdated content silently.

**Status: shipped (A6).** Parcours-config freshness check at `PAGES['checkdata']` — compares server `/list` mtime against localStorage `parcoursMTime_<pID>`; offers "Mettre à jour" / "Continuer sans mise à jour". `parcours_freshness_check` and `parcours_update_chosen` telemetry events.

---

## 12. Remediation status (consolidated to `mobile-audit.md`)

The full remediation plan (workstreams A–G, phase plan, file paths, telemetry list) is in [mobile-audit.md](mobile-audit.md). What follows is a compact issue → workstream coverage table — see mobile-audit for status of each workstream item.

| GIVORS issue | Workstream coverage | Status |
|---|---|---|
| S1 iOS 26.3.1 GPS | D1 + D3 + D4 + D5 + B4 | Shipped (bg-geo v2.6.0/2.7.0 + Round 14 JS); validate at VILLEURBANNE |
| S2 audio failures | C1 + C2 + C4 + B1 + A2 | Shipped |
| M1 iOS 26.4.2 short gaps | B4 + D3 | Shipped |
| M2 step_resume_current | E1/E2/E3 | **Pending VILLEURBANNE data** (`accuracy_near_border` distribution) |
| M3 silent audio loan-rearm | A1 + A2 + A3 | Shipped |
| M4 Howler cold-load | A8 + A8b | Shipped |
| m1 Android OEM kill | B1 + BG-5 + B3 (conditional) | B1/BG-5 shipped; B3 escalate only if ≥ 2 Doze blackouts ≥ 5 min recur |
| m2 iOS audiofocus flood | G1 audiofocus_session_reset path | Shipped |
| m3 no walk-end shutdown | A1 + A7 | Shipped |
| P4 operator rearm | A3 | Shipped |
| P8 stale seek-position | A4 | Shipped |
| t1 walk-start cache verify | C2 | Shipped |
| t2 audio error subtypes | C1 | Shipped |
| t3 checksum | C2 | Shipped |
| t4 loan-device flag | A5 | Shipped (UUID + `/devices` registry + analyze.mjs filters) |
| §11 build / parcours skew | A6 | Shipped |

**Verification audit + follow-up fixes (2026-05-27)** — see `mobile-audit.md` § *Verification audit*. Cross-check of every "✅ shipped" claim against actual source surfaced doc-vs-code mismatches; the small ones were fixed in Round 19:
- A2 event renamed `audio_engine_reset`.
- A3 `releaseSession` now promise-awaited before `resetAudioSession` (iOS race closed).
- BG-3 `getCLState` schema clarified — `hasLocation` + `locationTimestampAgeMs` (bg-geo v2.8.0).
- C4 cross-platform retry confirmed intentional (Android playerrors can also be audiofocus-driven).
- F-A4 silence detection dropped from spec (covered by existing `voice_snapshot` heuristics).
- A1 / A7 / end-page 5-tap reload all confirmed intentional (loan-phone rearm chain via title-page 5-tap-bottom).

Additional capability shipped in Round 19:
- **P0.5 Fix 1e diagnostic** (bg-geo v2.8.0) — `getAlarmWakeStats` exposes the BG-5 AlarmManager counter to the webapp every 30 s; lets us detect "alarm fires but JS got no fresh callback" (WebView Doze suspension) at VILLEURBANNE.
- **PO-9 hibernation watch** (power-opt v0.3.1) — `IsAutoRevokeWhitelisted` polled at parcours entry; flags long-idle Android 11+ devices that have had permissions auto-stripped.

**Open items requiring VILLEURBANNE data:**
1. B4 UI freeze-band — threshold from `real_callback_freshness` distribution.
2. E1/E2/E3 zone-overshoot gates — accuracy and sustain thresholds from `accuracy_near_border`.
3. B3 / BG-6 FusedLocationProvider — escalate only if Android Doze blackouts recur.
4. P0.5 Fix 1e behaviour layer — depends on whether `alarm_wake_stats` shows JS suspension despite alarm fires.
