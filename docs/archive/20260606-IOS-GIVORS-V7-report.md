# Field Test Report — 2026-06-06 · First iOS validation + GIVORS_V7 ExoPlayer regression

**Why this report exists:** the 2026-06-05 round ([`20260606-FRAPPAZ-STBONNET-report.md`](20260605-FRAPPAZ-STBONNET-report.md))
only covered the `20260605` telemetry. The `20260606` day — **29 sessions, never
analysed** — holds the two most consequential findings in the whole post-GIVORS
period: the **first iOS field sessions in the project's history**, and a **real
ExoPlayer decode regression** that blocks the Howler-retirement decision.

**Generated:** 2026-06-06 · **Sessions:** 29 (15 onboarding, 14 visitor)

**Field reports cross-referenced:**
- Magalie 04/06 (launcher fails on WiFi-tethering) → **no `20260604` telemetry at all** — corroborates a launcher-connectivity dead-end (phones never reached the server, so not even a beacon got out).
- Baptiste 06/06 ("le mode simulation utilise la position réelle du GPS") → `fire`/`n8i1`/`xp3u` (HTC U11 dev, simulate).

---

## 1. Executive summary

| Finding | Severity | Sessions |
|---|---|---|
| **ExoPlayer `MediaCodecAudioRenderer` decode failures (38×)** on Samsung A52s | 🔴 HIGH — blocks Howler retirement, visitor-affecting | `y9ns` |
| **First iOS field sessions — iOS native stack validated at configure level** | 🟢 major positive | `5h9a`, `imug` |
| GIVORS_V7 full 17-step walk completed across crash-resumes | 🟢 positive | `y9ns`→…→`8bfn` |
| Simulation runs real GPS concurrently (warmup fixes) | 🟡 confirmed-ish | `fire`/`n8i1`/`xp3u` |

**Build fleet split:** iOS on **apk 27 / bg-geo 2.14.12** (the shipping build with
every Motion + iOS-native fix); all Android on **apk 23 / bg-geo 2.14.5 / webapp
`b72b2e0d`**. So the ExoPlayer regression is on the *older* Android build, and the
iOS validation is on the *current* build.

---

## 2. 🔴 ExoPlayer decode regression (the prior round's "H1 clean" is now disproven)

`y9ns` (SM-A528B / Galaxy A52s 5G, Android 14, FLANERIE_GIVORS_V7_CBR walk, devmode)
threw **38 `step_voice` playerrors**, every one identical in shape:

```
backend: exoplayer   error_type: src_unsupported   error_code: 4
"MediaCodecAudioRenderer error, index=1,
 format=Format(... audio/mpeg, 256000, [2, 44100]), format_supported=YES"
```

Interpretation:
- **`format_supported=YES`** — the files are fine. This is a **runtime MediaCodec
  failure**, not a bad/unsupported container. (`src_unsupported` here is the JS
  classifier's label for the Media3 errorCode that fell through `mapToHowlerCode`'s
  ranges; the *native message* is the truth, and it names the renderer.)
- **Transient:** 10 of 17 errored files **played fine on a later attempt**;
  `audio_playerror_retry` fired 7× (C4 retry). Unsupported content would never play.
- **Churn-correlated:** **250 `audio_uri_resolved` for an 8-step segment** (~31
  loads/step). Each `ExoPlayerInstance.buildPlayer()` creates its own `ExoPlayer`
  (default factory → hardware decoders). Many concurrently-prepared instances
  (per-step voice + afterplay loop + zone ambiance + offlimit + the persistent
  silent player + next-step prewarm) exhaust the device's limited **hardware MP3
  decoder pool** → `MediaCodecAudioRenderer error` / resources reclaimed.
- **Not the device alone, not the content alone:** the *same device, same parcours*
  `8bfn` (steps 8-16) was clean. y9ns (steps 1-8) was the cold-start / high-churn
  segment. → exhaustion is driven by **concurrent-instance churn**, transiently.

**Visitor impact:** 3 blocs (6, 7, 8) gave up to afterplay fallback
(`step_voice_failed reason=playerror`) — i.e. **ambient/silence instead of
narration** on those blocks, plus glitchy starts on others.

**Why this matters for the audit:** `mobile-audit.md` stood at *"H1 ExoPlayer
PARTIALLY CONFIRMED (8giw, 0 errors)… if H1 is clean, retire Howler."* 8giw was
**one device (SM-A515F) + one parcours (INVITES_V2)**. The "second device" the audit
was waiting for is `y9ns` — **and it failed**. ExoPlayer is **not** clean across the
fleet. **Howler retirement is postponed; Howler stays the safe fallback.**

---

## 3. 🟢 First iOS field sessions — almost the entire iOS native plan validated

`5h9a` (onboarding) + `imug` (walk attempt) on **iPhone17,5 / iOS 26.5,
apk 27 / bg-geo 2.14.12** — the build carrying every iOS fix. The audit repeatedly
says *"no iOS sessions yet."* No longer.

### 3.1 The Motion & Fitness saga is field-resolved

Both iOS onboarding sessions **granted Motion on a fresh install**:
`imug` → `motion_authorized` → `motion_check granted=true waited=501ms`;
`5h9a` → `Motion: granted`. The ~26-build saga (provider-race root cause, §14/§15)
is now confirmed on the **shipping bg-geo 2.14.12 build in the field**, not just the
build-18 staff test (`jtcv`).

### 3.2 iOS native stack — configure/setup level validated

| Audit item (was "unverified / no iOS sessions") | `imug` evidence |
|---|---|
| iOS audio engine **audio-simple** (R25/I.B) | 7 `audio_uri_resolved`, all `backend=audio-simple`, 0 errors |
| **nowplaying** lock-screen tile (J/R22) | `nowplaying_setup` ×2 |
| **GPS rail** configure (H/R23) — was *dead code*, fix "unverified end-to-end" | `gps_rail_configured` ×2 |
| **ios_stream_health** + **cl_state** (R27/D6) | 25 snapshots each |
| **CLVisit** monitoring (R26/L/BG-12) | `gps_visit_event` ×1 |
| iOS GPS health | 134 fixes, **0 gaps ≥90 s**, avgAcc 4.8 m, real=132 / keepalive=2 |

### 3.3 What iOS still does NOT validate

`imug` fired **0 steps** — it was a staff onboarding/GPS test on the 4-step
"Test Dumas", not a real walk. Still open:
- A full **locked-pocket iOS walk** with BLOC narration.
- **Rail wake** during a real blackout (`gps_rail_wake` count = 0 — no blackout occurred).
- iOS **audio resume after kill**.
- iOS audio-simple **under narration load** (only 7 persistent-player loads exercised).

→ iOS moves from *"no sessions"* to *"configure/onboarding validated, walk-level
pending."*

---

## 4. GIVORS_V7 Android walk (the device that hit the ExoPlayer bug)

One long GIVORS_V7 dev walk on SM-A528B spanned several crash-resumed sessions
(`y9ns` steps 1-8 → short relaunches → `8bfn` steps 8-16, completed all 17). GPS was
excellent throughout (avgAcc ~4 m, real fixes only). `8bfn` shows one 403 s GPS gap
(28.8→35.5 min) that **coincides with a `session_resume` and `USER_REQUESTED` exit**
— on a devmode test phone this is a manual lock/relaunch, **not** a clean OEM-kill
data point. No audiofocus failures, no Doze activation.

---

## 5. Simulation + real GPS (Baptiste 06/06)

The HTC U11 dev sessions (`fire`/`n8i1`/`xp3u`) ran in simulation with **real
`rdv-warmup` GPS fixes coexisting** (`fire`: simulate=28, rdv-warmup=20). So the
real GPS hardware *is* delivering fixes during simulation — consistent with
Baptiste's "simulation uses the real position." **However**, `route_probe` events
carry **no `source` field**, so we cannot prove from telemetry that real fixes drive
zone triggering during a walk (no `raw`-source fix appears mid-walk in these
sessions — only pre-walk `rdv-warmup`). The observation is real; the exact code path
is unconfirmed. **First fix is diagnostic: tag `source` on `route_probe`** so this is
auditable at all.

---

## 6. Cross-day corrections to the 2026-06-05 report

- **`checkbatteryopt` is not "a frozen screen with no exit."** The deployed code
  (apk 23, the build `8aym` ran) renders tailored OEM/restricted/power-save copy and
  shows `Paramètres batterie` / `Paramètres fabricant` / `J'ai désactivé` buttons
  after a ~15 s poll (`BATTOPT_MAX_ATTEMPTS=10 × 1500 ms`), and re-polls on
  resume/visibilitychange. The real defect is that the gate is **un-skippable** and a
  field user on HyperOS couldn't satisfy it.
- **`8aym` actually passed the battery gate.** It logged `battery_opt {ignoring:true}`
  at event 477/495, **42 s before session end** — i.e. it was stuck ~31 min *failing
  to grant* the exemption, finally got it, and the departure window was gone. The trap
  is real; the mechanism is "can't satisfy an un-skippable OEM gate under time
  pressure," not "missing UI."
- **`ykvf` (Baptiste 05/06 GPS-haywire) confirmed pure simulation** — `simulate=14,
  rdv-warmup=8`, zero raw fixes, `gps_state reason: simulate` only. Stale sim state,
  as the prior round found.

---

- **`nlrc`'s 74-min stall was the GPS startup gate, not battery-opt.** The 2026-06-05
  report blamed battery; in fact `nlrc` (Fairphone 4) got `battery_opt {ignoring:true}`
  after its restarts, and the real wall was `gps_startup_rejected reason=accuracy`/`stale`
  logged **dozens of times over 74 min**. The FP4's poor GPS (~21 m avg) can't clear the
  `STARTUP_FIX_MAX_ACCURACY_M=15` + 2-distinct-fix gate while stationary, so it never left
  `rdv`. This is a distinct, broader trap than battery-opt (hits any weak-GPS device) and is
  the same B4/R27 startup-gate calibration item — now with field proof the gate is too strict.

## 7. Bug / improvement queue (see mobile-audit.md for live status)

| # | Sev | Item | Scope |
|---|---|---|---|
| 1 | 🔴 | ExoPlayer MediaCodec exhaustion (decode failures under instance churn) | audio-simple plugin (Android) + retry hardening; **Howler retirement postponed** |
| 2 | 🔴 | `checkbatteryopt` un-skippable gate traps field users who can't satisfy it | webapp: informed risk + "continuer quand même" + loan-phone guidance for unfixable OEMs |
| 2b | 🔴 | **GPS startup gate too strict** — poor-GPS/stationary devices (FP4) stranded at `rdv` (nlrc, 74 min) | webapp/geoloc: soften accuracy gate + time-boxed best-effort "départ" fallback |
| 3 | 🔴 | Launcher single-shot connectivity check dead-ends on tethering | launcher: retry/backoff + **diagnostic** on-screen error |
| 4 | 🟡 | Simulation hygiene: reset flag on fresh session; `source` on `route_probe`; banner | webapp/geoloc |
| 5 | 🟡 | Audio load churn (250 resolves / 8 steps) — the trigger for #1 | webapp player |
| 6 | 🟡 | iOS full locked-pocket walk + rail wake + audio-under-load | next iOS session |
| 7 | DATA | E1/E2/E3 still need a noisy-GPS device (avgAcc 20-30 m) | next session |
| 8 | DATA | Architecture D Fused never exercised (`fusedAvailable=false` on dev ROMs) | GMS device + real gap |
