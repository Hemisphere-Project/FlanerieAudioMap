# Flânerie public weekend — full telemetry audit (2026-06-19 & 2026-06-20)

**Parcours:** FLANERIE_INVITES (`flanerie_invites_v3`), 21 steps (0–20)
**Scope filters:** `--cutoff=1400` (public wave opened ~14:00 both days) · `--operator=SM-A515F` (house spare)
**Data:** server `telemetry/archive/` — **325 session files** (204 on the 19th, 121 on the 20th), pulled 2026-07-07.
**Supersedes** the partial live report [`2026-06-19-field-day.md`](2026-06-19-field-day.md), which was captured from a 14:33→15:30 pull (34 walks) and therefore missed two full-day facts: a **mid-event webapp deploy** (build skew, §D) and the **first real Bluetooth-route narration failure** (`bezg`, §F1 — that one is on the 20th).

---

## Verdict — two strong public days; one new, real, low-frequency audio bug

Across the weekend, **~100 walks reached the final step (66 Fri + 34 Sat)** out of ~124 visitor walk sessions, with **exactly one genuine technical DNF** (`qhkz`, Fri) and **one walker-facing narration failure** (`bezg`, Sat — missed one step's voice, heard the ambient fallback, finished the walk). No battery-kills, no audiofocus request failures, no build-breaking GPS blackout that silenced a walker. The keepalive/OEM-kill stack and the apk-36 audio path held at public scale.

The remaining "incomplete" rows are **not** failures: the roaming **staff device** (Baptiste's HTC U11, devmode), the **telemetry-logging dropout** on the data-less loaner fleet (real walks that merely don't log a track), and **visitors who chose to stop** partway (normal for a free public event).

---

## Fleet accounting

| | **Fri 19** | **Sat 20** |
|---|---|---|
| Session files | 204 | 121 |
| Pre-opening staff tests (before 14:00) | 32 | ~5 (morning opens) |
| Onboarding-only (permission gauntlet, no walk) | 92 | 69 |
| Operator/spare SM-A515F blips | 9 | 13 |
| **Visitor walk sessions** | **76** | **48** |
| — reached step 20 ("completed") | 66 | 34 |
| — incomplete | 10 | 10 |
| — aborted (≤step 0, <5 min) | 0 | 2 |
| Build(s) | `82ae260`/`68a9db0b` ×65 **then** `c228b1a`/`c04f075b` ×16 | `c228b1a`/`c04f075b` ×46 (uniform) |
| step_voice (narration) failures | 0 walker-facing¹ | **1** (`bezg`) |
| audiofocus request failures | 0 | 0 |
| battery-kill / bg_stop_repeated | 0 | 0 |

¹ Fri had two *transient* step-20 finale play-errors (`lpen`, `p716`) that self-recovered — see §F2. `wgpg` is the spare phone, not a visitor.

*Sessions ≠ unique visitors: phones are re-inited and handed off between walkers. ~124 visitor sessions ≈ the "~120 users" figure.*

---

## Findings by severity

### 🟠 F1 — [NEW] iOS Bluetooth A2DP→HFP route flip drops a step's narration — `bezg` (iPhone 12 mini / iPhone12,8, iOS 26.5, Sat)
The first real Bluetooth-triggered narration failure in the dataset. The walker's BT audio device switched profile mid-narration and the app dropped BLOC_07's voice. Exact sequence from the raw events:

```
audiofocus_change  AUDIO_ROUTE_CHANGED  BluetoothA2DPOutput → BluetoothHFP   (CategoryChange)
audiofocus_change  AUDIOFOCUS_LOSS
audio_playerror_retry {attempt:1, step:7, step_name:"BLOC_07_ICI_POEME_B"}
audio_playerror_retry {attempt:1, gave_up:true, reason:"reset_failed", step:7}
step_voice_failed    {reason:"playerror", step:7}
```

**Mechanism (code-confirmed):** when a BT device drops from the A2DP (music) profile to HFP (hands-free/headset), iOS tears the playback route out from under the `AVAudioPlayer`, which surfaces as a `playerror`. `PlayerStep`'s one-shot recovery (`player.js:1318-1354`) calls `cordova.plugins.audiofocus.resetAudioSession()` **once**; here the reset's error callback fired (`reason:"reset_failed"` — the BT route was still mid-transition), so it gave up and fell through to `startAfterplay()`. The walker heard the ambient afterplay instead of BLOC_07's poem, then the walk continued normally (all 21 steps fired, completed).

There is **no handling for a route change into `BluetoothHFP`** anywhere — `AUDIO_ROUTE_CHANGED` is logged and dropped (`player.js:102-108`); no branch re-asserts the `.playback` category to force the device back to A2DP, and the reset is single-shot with afterplay-drop as its only fallback. This is rare today (only 3 HFP flips all weekend; only `bezg` was mid-narration on a walk — `guxr`/`8fo8` flipped during onboarding/abort with no voice to break) but it **will grow** with Bluetooth-headphone use, and it's a *hard* miss of one step's content, not a transient glitch.
**Impact:** one confirmed walker missed one step's narration (heard ambient instead). Degraded, not fatal; walk completed.
**Fix:** see remediation R1.

### 🔴 F-Fri1 — One genuine technical DNF: `qhkz` (Samsung Galaxy A54 / SM-A546V, Android 16, Fri)
Already characterised in the partial report and it holds against full data: stuck at **step 1** after 27 min, **4 relaunches** re-firing step 0/1, GPS clean (141 fixes), `step_voice` 0. Aggressive-OEM crash-loop — the process dies faster than the walk advances and the resume machinery can't make headway. **The only walker who effectively did not get the experience across the whole weekend.** SM-A546V stays on the device watch-list. (No battery-kill overlay fired — this is process death, not the documented two-stop kill.)

### 🟠 F-Rec — [RECURRING, telemetry-only] GPS telemetry-logging dropout on the data-less loaner / Android-11 fleet
Same class as R0/R3 in the June-19 partial report, and it **recurred on the 20th** (`69t7`). The GPS-blackout scan flags these but they are **not** freezes:

| Session | Device | Day | Scan says | Reality |
|---|---|---|---|---|
| `69t7` | M2101K7AG (Redmi Note 10) | Sat | 88 min frozen, step 19 | Steps fired in real time 0→19; `standby_bucket:EXEMPTED`, batt-opt handled. Near-complete walk, **track not logged.** |
| `as7n`,`q7a5`,`e4ts` | M2101K7AG | Fri | 36–37 min frozen | Completed / walked; log gap only. |
| `mkuc`,`ot5r`,`ofa5`,`5kf8` | HTC U11 | both | 35–70 min frozen | **Staff device** (see §Staff). |

**Root cause (code-confirmed, refined):** `gps` telemetry has one emit site (`geoloc.js:1058`), reached from both foreground and background position paths. Events are buffered and flushed on a 30 s `setInterval`; `gps` is an **EVICTABLE_TYPE** dropped *first* when the buffer hits `BUFFER_CAP=500` (`telemetry.js:557,563-577`). On a **data-less walk** (loaner/Wi-Fi-only phone — and "must work without mobile data" is the design), the flush POST can't send, the buffer fills, and `gps` events are evicted before the walk ends — even the persist-and-resend (#6) can't recover them because they were already dropped. When the phone is also backgrounded (screen locked in pocket), the JS timer suspension compounds it (the Android JS-suspension P0). **Positioning and audio are unaffected — this is a data-completeness bug, not a walker-facing one.**
**Impact:** real walks render **trackless / grey** in the control-panel viewer and read as "frozen" in the blackout scan; any "did they walk?" check keyed on logged-fix span gives **false negatives** on exactly this fleet (it fooled the first pass of the June-19 report). No walker effect.
**Fix:** see remediation R2. **Do not** gate completion/traversal on logged-fix span — use step proximity (`spot_audio_prepare.distance_to_center`) instead.

### 🟠 F-Fri2 — [KNOWN, re-confirmed] iOS Motion & Fitness **Denied** → no tailored recovery: `fgl3` (iPhone 11 / iPhone12,1, iOS 16.1.2, Fri)
`auth_status:2` (**Denied**) on all 63 `motion_prompt` attempts over 1h22m, `activity_available:true`, no `step_fire` — the walk never opened. Recovered by handing the visitor a loaner. **Two code facts confirmed this pass:**
- The code has **no branch on `auth_status`** at all (`pages.js` checkmotion) — a **Denied** phone is treated identically to a NotDetermined one: keep polling `GEO.motionAuthorized`, offer the Settings deep-link + manual "J'ai autorisé" button. Once Motion is Denied, iOS will not re-present the prompt, so this is a dead-end with only generic "waiting" copy.
- The 63 attempts are **not** an infinite timer loop (that was fixed in audit addendum 8) — `triggerMotionPrompt` re-fires only on resume/visibilitychange, i.e. the visitor bouncing in and out of Settings 63 times. The **`motion_prompt_early` reorder no longer exists in the shipped webapp** (removed per addenda 11/12) — so the old report's open question "did the early-prompt reorder fire on iOS 16?" is moot: there is nothing to fire.
**Fix:** see remediation R3.

### 🟡 F-Deploy — [PROCESS, informational] Friday ran two builds (intentional mid-event deploy)
Friday ran webapp **`82ae260`/`68a9db0b` from 10:08 to 17:35 (65 sessions)** and **`c228b1a`/`c04f075b` from 17:17 to 20:37 (16 sessions)** — a deploy landed at **~17:17, mid-event**. In-flight walks kept the cached old bundle (hence the 17:17–17:35 overlap); new walks after the deploy got the new one. Saturday ran entirely on the new build. **Per the team this deploy was deliberate and necessary — all prod deployments are on purpose, and they'll try to avoid mid-event ones in future.** No action item. The only standing note is analytical: this is why the partial live report (a 14:33–15:30 window) reported "no build/parcours skew" — it only ever saw the old build — so **attribute any regression by build hash**, not by day (`session_diag.webapp_commit` carries it; `analyze.mjs` prints the split). The `bezg` audio failure is on the new build, but its root cause (no HFP handling) is latent in both.

### ⚪ F-Cosmetic — Zone-overshoot & step-skip anomalies (all completed, no audio cost)
Unchanged from prior days and none cost a walk:
- **Zone overshoot** (`stepResumeCurrent≥2`, GPS nudging into the next zone and re-resuming current): Fri `dy1q`, `uwad`, `1sl9`, `ysiw`, `4j1c`, `vufb`, `vvu9`, `ad18`; Sat `xlqn`, `bezg`, `l08i`, `bzuf`, `721a`, `5wol`, `piyc`, `hpuq`. Known E1/E2/E3 (awaiting `accuracy_near_border` calibration).
- **Step-skips** (`steps-non-contiguous`): mostly the "skip 1–4 right after the intro" burst plus the Xiaomi log-gap cases. No `step_voice_failed` attached to any.
- **Afterplay fallback:** Fri 235 / Sat 129, **all `no_src`** (the not-yet-produced placeholder jingles) — expected/harmless. `map_opened{lost}`: Fri 18, Sat 8 — worth a glance (walkers hitting "Je suis perdu") but none tied to a DNF.

---

## Staff / roaming device (not visitor data)

**HTC U11, UUID `934ceed9`, `devmode=true`, Android 8.0.0** — the roaming monitoring phone (Baptiste checking the route live). Its sessions are staff walk-alongs, **not** visitor DNFs, and must be excluded from completion:
- **Fri:** `8naa`, `ot5r`, `cb29`, `m5jt` (partial) + `mkuc` (full traversal check).
- **Sat:** `5kf8`, `ofa5`, `qj8l` (partial).

A *second, different* HTC U11 (`284842eb`, non-devmode) completed one real visitor walk (`7saq`, Sat). The many 7–11 s HTC U11 onboarding blips (`7yml`, `m8qm`, `2e7x`, `i5om`, `tbxq`…) are the staff device re-arming.

**True visitor incompletes, once staff + telemetry-dropout + near-complete are removed:** Fri — `qhkz` (DNF), `z8qf` (walked to step 11 cleanly then left running 3h43m — abandoned), `xahv`/`jord`/`q6jr` (stopped early). Sat — `s8ih`/`jtp3`/`h7nx`/`tw4c`/`zw0s` (stopped early), `bzuf`/`69t7` (effectively complete, step 18/19). No hard technical failure on Saturday.

---

## What this weekend validates

- **Audio path is solid at public scale** — 1 real narration miss in ~100 walks, and that one has a specific, now-understood BT root cause. 0 audiofocus request failures both days.
- **OEM-kill / keepalive stack held** — 0 battery-kill overlays, 0 `bg_stop_repeated`; the only crash-loop DNF (`qhkz`) is device-side process death, not a keepalive gap.
- **Onboarding telemetry works** — `fgl3`'s 63-prompt Motion-Denied saga was fully captured even though the walk never opened.
- **The apk-36 stack carried both a public Friday (~76 walks) and Saturday (~48 walks)** with no build-breaking GPS or audio regression on the BYOD fleet.

## Cross-check vs `mobile-audit.md`

- **F1 (BT A2DP→HFP narration drop)** — **NEW.** No HFP route-change handling in code; the one-shot `resetAudioSession` recovery has afterplay-drop as its only fallback. Related to the C6/route-change telemetry work but not covered by any existing item. → new remediation R1.
- **F-Rec (GPS log dropout on data-less fleet)** — extends the known "Wi-Fi-loaner in-memory buffer, no post-end retry" note and the R0 loaner-fleet finding; the *eviction-first* mechanism is the sharper root cause. → remediation R2.
- **F-Fri2 (Motion Denied)** — refines P3.3c: the hard gate exists but has **no Denied-specific branch**. → remediation R3.
- **`qhkz` / SM-A546V** — new watch-list device under the known Android-resilience track.

See the [2026-06-19_20 addendum](../../mobile-audit.md) in `mobile-audit.md` for the prioritised fix plan (R1–R5).
