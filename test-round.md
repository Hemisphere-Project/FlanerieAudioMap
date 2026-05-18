# Test Round — 2026-05-19

**Context:** Pre-show validation. Production with real visitors in 2 days.  
**Build:** Round 4 telemetry batch (R4.2–R4.9) + R4.3 GPS Doze watchdog deployed.  
**Parcours under test:** FLANERIE_GIVORS_V7_CBR (test) → FLANERIE_ELYSEE (show)  
**Constraint:** No Cordova rebuild, no plugin changes. JS webapp only.

---

## Telemetry setup

Before running any test, confirm Round 4 is live. Open the control panel
(`/telemetry`) after the first session of the day and verify:

- `session_start` or `session_resume` payload carries `resume_seek_pos` field
- At least one `voice_snapshot` carries `audio_playing` and `load_state` fields
- `voice_snapshot_skipped` count is low (< 5 per session vs hundreds before)

If these fields are absent, the deployment didn't take — stop, redeploy, recheck.

---

## Test A — Android cold-load validation (R4.4)

**Goal:** confirm R4.4 closed the BLOC_01 silent-start hang on Android, or get the
exact failure mode so R4.1 option 2 can be scoped before the show.

**Devices:** Samsung SM-A515F or Xiaomi M2101K7AG (both reproduced the hang on
2026-05-18). Run on whichever is a show device.

**Estimated time:** 20 min

### Procedure

1. Clear any stored parcours state (or uninstall and reinstall the app).
2. Go through full onboarding. At `checkaudio`, confirm the tone plays.
3. On the parcours page, enter the BLOC_01_Parc zone.
4. Set the phone face-down, do not touch it for **90 seconds**.
5. Listen carefully — note the exact moment audio starts.
6. After 90 seconds, open the telemetry page for this session and look for:

| Telemetry event | Meaning | Action |
|---|---|---|
| `audio_play_timeout_self_healed` | Audio was playing all along; watchdog had a false alarm | ✅ R4.4 closed it |
| `audio_play_stuck_retry` → `audio_play_started` | Voice was stuck, retry worked | ✅ R4.4 closed it |
| `audio_play_stuck` | Retry failed; voice never played | ❌ Escalate R4.1 before show |
| No `audio_play_timeout` at all | Audio started cleanly within 15s | ✅ Never had the bug on this device |

### Pass criteria

Audio starts within 30 seconds of zone entry on the first attempt.  
No `audio_play_stuck` event in the session.

### If the test fails

`audio_play_stuck` appears → add to pre-show protocol: "if no sound after 30 s in
the first zone, ask the walker to take 5 steps back outside the zone boundary,
then re-enter." Zone re-entry triggers a fresh `audio_play_requested` which has
historically recovered the hang. Flag this phone for priority attention at the
show.

---

## Test B — iOS voice-position resume (P3.5b + R4.2)

**Goal:** verify the kill+relaunch voice-position round-trip works end-to-end on iOS
now that `parcours_restore` events are properly emitted (R4.2 fix).

**Device:** iPhone (any iOS — iPhone 13 mini preferred as the test fleet device).

**Estimated time:** 30 min

### Procedure

**Kill 1**

1. Start parcours, walk into any step (step 0 / BLOC_01 is fine).
2. Wait for voice to begin playing. Confirm audio is playing.
3. Wait **at least 45 seconds** in the zone while voice plays (you need
   `voice_snapshot.pos > 30` in telemetry to confirm a meaningful position
   was captured).
4. Note the last `parcours_store.resumeStepVoicePos` value visible in telemetry
   (call it **V1**).
5. **Force-kill the app** via the app switcher (swipe up).
6. Immediately relaunch. Complete onboarding if required, reach the parcours page.
7. Check telemetry for the new session — look for `parcours_restore`.

**Kill 2**

8. Wait for voice to resume. Confirm it resumes mid-sentence (not from t=0).
9. Let it play for another **30 seconds**.
10. Note the last `parcours_store.resumeStepVoicePos` before the next kill (**V2**).
11. **Force-kill again**.
12. Relaunch once more, reach parcours page.
13. Open telemetry, look for the second `parcours_restore`.

### What to check in telemetry

For each kill cycle:

| Check | Where | Pass condition |
|---|---|---|
| parcours_restore event exists | Session events, type=`parcours_restore` | Event present in every relaunched session |
| Restore pos matches last save | `parcours_restore.resumeStepVoicePos` vs last pre-kill `parcours_store.resumeStepVoicePos` | Values match (±3 s tolerance for the 3-second rewind) |
| Session resume carries pos | `session_resume.resume_seek_pos` | Non-zero, matches V1 / V2 |
| Pause trigger fires | `parcours_store` events with `trigger:"pause"` in iOS session | At least one per kill cycle |
| Voice actually playing during capture | `voice_snapshot.audio_playing:true` in background visibility | True when pos is advancing |

### Decision tree

| Observation | Conclusion | Next step |
|---|---|---|
| `parcours_restore` present, pos matches, voice resumes mid-sentence | P3.5 works on iOS ✅ | No further action |
| `parcours_restore` present but pos = 0 (despite `parcours_store` showing pos > 0 just before kill) | localStorage not surviving iOS kill | P3.5 Plan C: native plugin save on `applicationDidEnterBackground` |
| `parcours_restore` present, pos non-zero, but voice resumes from 0 | Restore value not applied at play time | Debug `step.player.voice.play(seekPos)` path |
| `parcours_restore` absent | R4.2 drain still not firing | Check `PARCOURS.flushPendingTelemetry()` call in PAGES['parcours'] |
| `voice_snapshot.audio_playing:false` throughout foreground + background | NativeMediaPlayer position not readable from JS | P3.5 Plan B: call `getCurrentPosition()` from GPS callback |

---

## Test C — Android resume round-trip (R4.2)

**Goal:** verify `parcours_restore` now surfaces on Android relaunch.

**Device:** Samsung SM-A415F or SM-A515F.

**Estimated time:** 15 min

### Procedure

1. Start parcours, walk into step 0, let voice play 30 seconds.
2. Force-kill the app.
3. Relaunch, reach parcours page.
4. Check telemetry:
   - `parcours_restore` event present, `resumeStepVoicePos` non-zero
   - `session_resume` payload: `resume_seek_pos` non-zero, `resume_step_index = 0`
5. Listen: voice should resume from the saved position, not from 0.
6. Repeat with a mid-walk kill (e.g. after step 3).

### Pass criteria

`parcours_restore` appears in every relaunched session.  
`session_resume.resume_seek_pos` is non-zero when killed mid-voice.  
Audio resumes from the saved position (audibly).

---

## Test D — GPS Doze watchdog (R4.3)

**Goal:** confirm the "Téléphone en veille" escalation overlay fires correctly on
Doze-affected devices, and does NOT false-positive on normal devices.

**Devices:** Motorola moto g(7) power and/or TCL T433D for the positive case.
Any Samsung for the negative (no false-positive) case.

**Estimated time:** 25 min

### Part D1 — No false positive (stationary wallet test, 8 min)

1. Start parcours, walk into a step, let voice start.
2. Lock the phone. Place it on a table (stationary). Do not move it.
3. Wait 10 minutes.
4. **Expected:** GPS-lost overlay may appear after 30s (standard behaviour),
   but the Doze escalation overlay (`GPSLOST_TEXT_DOZE`) must NOT appear
   because `GEO.motionIsStationary = true`.
5. Check telemetry: `gps_doze_suspect` event must be absent.

### Part D2 — Doze escalation fires on affected device (15 min)

1. On Motorola or TCL: start parcours, walk into a step, let voice start.
2. Lock the phone and **walk continuously** (or simulate movement by shaking gently).
3. Wait up to 10 minutes with screen locked.
4. **Expected timeline:**
   - ~t+30s: standard GPS-lost overlay ("Signal GPS perdu...")
   - ~t+60s: **overlay text changes** to "Téléphone en veille — Déverrouillez l'écran..."
   - Walker unlocks the screen → GPS resumes within a few seconds → overlay hides, audio resumes
5. Check telemetry for `gps_doze_suspect` event. Confirm:
   - `gap_ms` is ≥ 60 000
   - `motion_stationary: false`
   - `manufacturer` matches the device

### Part D3 — No false positive on Samsung (5 min)

1. On Samsung SM-A515F: same procedure as D2 (walk, locked screen, 3 min).
2. **Expected:** standard GPS-lost overlay may or may not appear depending on GPS
   quality in the test area, but `gps_doze_suspect` must NOT appear within 3 min
   unless the Samsung itself is Doze-throttling (in that case, document it — useful
   intelligence for the show).

### Pass criteria for R4.3

- `gps_doze_suspect` fires on Moto/TCL with `gap_ms ≥ 60000` and `motion_stationary:false`
- `gps_doze_suspect` does NOT fire during the stationary test (D1) or on clean Samsung (D3)
- Overlay copy switches to Doze-specific text at ~t+60s from last GPS callback
- Overlay disappears automatically when GPS recovers (no manual dismiss needed)

---

## Test E — Regression sweep (10 min, any device)

**Goal:** confirm Round 4 batch didn't regress any baseline behaviour.

**Device:** Samsung SM-A515F (show fleet representative).

### Procedure

1. Fresh onboarding → confirm `checkaudio` passes, `checkgeo` passes.
2. Walk into step 0, confirm voice starts within 20 s.
3. After 30 s of voice, **background the app** (home button). Wait 60 s.
4. **Foreground the app**. Confirm audio is still playing without a gap.
5. Lock the screen. Keep walking. After 2 min, unlock and check audio still plays.
6. Walk into step 1. Confirm voice transitions cleanly (no double-play, no gap).
7. Check telemetry for this session:
   - `audio_play_stuck` → must be absent
   - `gps_callback_gap` → should be ≤ 3 events per walk (R4.6 raised threshold)
   - `voice_snapshot_skipped` → should be ≤ 10 per walk (R4.9 dedup)
   - `parcours_store` → should appear every ~5 s with `trigger:"interval"`

### Pass criteria

No `audio_play_stuck` in session.  
Audio continues through background/foreground and screen-lock cycles.  
`voice_snapshot_skipped` count at or below 10 per session.

---

## Session checklist for show devices

Run this on **each phone** on show morning before visitors arrive.

| # | Check | Pass | Fail action |
|---|---|---|---|
| 1 | Battery saver: OFF | — | Disable manually, document device |
| 2 | Background location: Always (in Settings → Flanerie) | — | Go through `checkbgloc` page again |
| 3 | Samsung: Apps → Flanerie → Battery → Unrestricted | — | Set manually |
| 4 | `checkaudio` passes (tone plays, no red error) | — | Reinstall or flag device |
| 5 | `checkgeo` shows green GPS before advancing | — | Warm up GPS outside, retry |
| 6 | Walk into step 0 zone, voice starts within 20 s | — | See Test A fail protocol |
| 7 | Background the app for 30 s, foreground: audio still playing | — | Flag device, try battery settings again |

**Pre-show brief for team:** if a visitor reports no audio since entering a zone —
first action: ask them to lock+unlock the screen (wakes from Doze).
If still silent after 10 s: ask them to step 5 m outside the zone boundary and
re-enter (triggers a fresh audio_play_requested).
Do not restart the app unless both fail.

---

## After the test session — telemetry review

Open `/telemetry` on the server. For each session, check:

| Signal | Target | Failure |
|---|---|---|
| `audio_play_stuck` | 0 across all sessions | R4.4 didn't close R4.1 → brief team on zone re-entry workaround |
| `parcours_restore.resumeStepVoicePos` | Non-zero on every relaunch | R4.2 drain still broken |
| `session_resume.resume_seek_pos` | Matches last pre-kill `parcours_store` | localStorage not surviving kill |
| `gps_doze_suspect` | Fires on Moto/TCL, not Samsung | R4.3 false positive or non-firing → tune GPS_DOZE_ESCALATION_MS |
| `gps_callback_gap` | ≤ 3 per full walk | R4.6 threshold still too low |
| `voice_snapshot_skipped` | ≤ 10 per session | R4.9 dedup not working |
| `voice_snapshot.audio_playing` | `true` when pos advancing | NativeMediaPlayer playing() not readable |
