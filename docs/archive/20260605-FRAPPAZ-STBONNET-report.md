# Field Test Report — 2026-06-05 · FRAPPAZ + ST-BONNET GPS

**Parcours tested:**
- FLANERIE_INVITES_V2 (`flanerie_invites_v2`, 12 steps 0–11) — Baptiste, FRAPPAZ route
- FLANERIE_ST_BONNET_TEST_GPS (`saint_bonnet_test_gps`, 1 step) — Magalie, 5 phones, GPS zone test circuit

**Files:** 24 total | 13 onboarding | 11 visitor sessions  
**Build fleet:** apk=23, commit=`ad6dd58`, webapp=`b72b2e0d`, bg-geo=2.14.5 — uniform across all sessions  
**Field reports cross-referenced:** Magalie (04/06 launcher failure on tethering), Baptiste (05/06 GPS haywire ~17h, SM-A515F), Magalie (05/06 ST-Bonnet 5 phones, 18h25), Baptiste (06/06 simulation mode uses real GPS)  
**Generated:** 2026-06-06

---

> **⚠ Two findings below were corrected by the 2026-06-06 analysis** ([`20260606-IOS-GIVORS-V7-report.md`](20260606-IOS-GIVORS-V7-report.md) §6):
> 1. `checkbatteryopt` is **not** "a frozen screen with no handler" — the deployed page shows OEM/Settings guidance + re-polls on resume; `8aym` actually *passed* the gate (`battery_opt {ignoring:true}`) but ~31 min too late. The defect is an **un-skippable** gate, not a missing handler.
> 2. `nlrc`'s 74-min stall was primarily the **GPS startup gate** rejecting the FP4's poor GPS (`reason=accuracy` ×dozens), **not** battery-opt.

## 1. Executive summary

| Outcome | Count | Sessions |
|---|---|---|
| Clean completed walk (visitor-equivalent) | **1** | 8giw (Baptiste, all 11 steps, real GPS) |
| Stuck in onboarding — battery_opt blocked | **1** | 8aym (Magalie's Redmi Note 11 — only meaningful Magalie telemetry) |
| Walk aborted — stale simulation state | **1** | ykvf (Baptiste, ran in simulation without knowing it) |
| Dev / setup / earlier test sessions | **21** | all remaining sessions |

**Session scope corrections:**
- The four ST_BONNET walk completions (`7sn4`, `j37j`, `cm3j`, `occn`) are **not** from Magalie's 18h25 departure — they start 17–45 min earlier and are prior setup/test runs. The only session with telemetry from Magalie's actual five-phone walk is `8aym`.
- Baptiste's `ykvf` GPS disaster was caused by **stale simulation state persisted from morning sessions**, not a GPS hardware failure. He was unknowingly in simulation mode during what he intended as a real GPS test.

**Critical bug — `checkbatteryopt` deadlock:** On Android 13+ (Xiaomi HyperOS, Fairphone Android 15), `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is silently blocked. The onboarding page has no handler for this — user gets a frozen screen with no feedback and no exit. This blocked Magalie's Redmi Note 11 for 29 minutes; the walk never started.

**Critical bug — simulation state persists across sessions:** Simulation mode is stored in localStorage and is never cleared between sessions. Baptiste's morning dev tests left simulate active; his afternoon "real GPS test" (ykvf) ran silently in simulation. There is no visible indicator when simulate mode is active.

**Good news:** Baptiste's second walk (8giw, real GPS) is the cleanest Android walk recorded — 211 real fixes, avgAcc=7m, 0 audio errors, ExoPlayer clean on all 40 loads.

---

## 2. Session inventory

### Morning block — dev testing (HTC U11, Android 8.0.0, devmode=true)

| Session | Start | Dur | Walk | Notes |
|---|---|---|---|---|
| b200 | 08:28 | 9s | onboarding | dev |
| llls | 08:28 | 1m07s | onboarding | dev |
| w2tg | 08:28 | 8s | **INVITES_V1** abort | old V1 parcours cached on this device |
| cz3v | 08:30 | 9m22s | INVITES_V2, steps [0,4], crash | **simulate active**; 546s gap when locked; dev_rearm |
| 070p | 08:39 | 9s | onboarding | dev |
| wkvr | 08:39 | 13m45s | INVITES_V2, steps 0–5, stopped | simulate active; clean dev test walk, 147 fixes |

All morning sessions have `gps_state reason: simulate`. Simulate mode was activated during this block and persisted into the afternoon.

### Noon — Fairphone 4 setup (nlrc)

| Session | Start | Dur | Walk | Notes |
|---|---|---|---|---|
| nlrc | 12:59 | 1h14m | onboarding for ST_BONNET, never started | battery_opt blocked ×5, 3 restarts; 550 GPS fixes useful for quality mapping |

### ST_BONNET pre-test sessions (earlier in the day — NOT Magalie's 18h25 walk)

These four walk sessions completed the ST_BONNET circuit before Magalie's group departed.

| Session | Start | Dur | Device | Notes |
|---|---|---|---|---|
| bqgf | 17:46 | 13m12s | Xiaomi M2101K7AG | onboarding |
| 7qgn | 17:57 | 13m13s | Xiaomi M2101K7AG | onboarding |
| **7sn4** | **17:58** | **1m00s** | **Xiaomi M2101K7AG** | **walk, step 0 triggered — pre-departure test** |
| **j37j** | **18:05** | **1m00s** | **Xiaomi M2101K7AG** | **walk, step 0 triggered — pre-departure test** |
| rej9 | 18:15 | 11m54s | SM-A415F Samsung A41 | onboarding |
| b7vl | 18:20 | 3m15s | Fairphone 4 | onboarding |
| **cm3j** | **18:22** | **1m00s** | **SM-A415F Samsung A41** | **walk, step 0 triggered — pre-departure test** |
| **occn** | **18:23** | **2m30s** | **Fairphone 4** | **walk, step 0 triggered — pre-departure test** |

These appear to be pre-departure zone verification runs by the team.

### Magalie's 18h25 five-phone walk — only 8aym has telemetry

| Session | Start | Dur | Device | Notes |
|---|---|---|---|---|
| **8aym** | **18:23** | **32m15s** | **Xiaomi Redmi Note 11 HyperOS** | **STUCK — battery_opt blocked 29min, walk never started** |
| *(others)* | — | — | FP4, SM-A415F, 2× M2101K7AG | **No telemetry received** — either deadlocked or didn't complete onboarding/flush |

Magalie's four other phones (Fairphone, Samsung A41, MIUI 12.0.1, MIUI 12.0.2 — the ones she marked as "completed") produced no telemetry. They either got stuck in onboarding without flushing, were never fully set up, or their sessions belong to the pre-departure test block above.

### Baptiste's FRAPPAZ walk — afternoon (SM-A515F, devmode=true)

| Session | Start | Dur | Walk | Notes |
|---|---|---|---|---|
| dla6 | 16:37 | 1m12s | onboarding | simulate active |
| qtk7 | 16:38 | 7s | abort | simulate active |
| **ykvf** | **16:39** | **26m13s** | **INVITES_V2, steps [0,1], crash** | **simulate active (stale); 1528s gap when locked** |
| jqqw | 16:39 | 10s | onboarding | post-crash |
| i0na | 17:06 | 12s | onboarding | |
| **8giw** | **17:06** | **21m28s** | **INVITES_V2, steps 0–11, COMPLETED** | **real GPS; clean walk; ExoPlayer; 0 errors** |

### Evening (SM-A528B, 21h)

| Session | Start | Dur | Parcours | Notes |
|---|---|---|---|---|
| uvic | 21:05 | 12s | onboarding | |
| 1y6c | 21:05 | 7s | FLANERIE_GIVORS, abort | old GIVORS parcours still cached |

---

## 3. ST_BONNET GPS zone quality — pre-departure test results

The four pre-departure runs show the zone is very well placed. All four triggered on the first GPS fix inside the zone, in 5–6ms:

| Session | Device | Accuracy at trigger | Trigger position | Latency |
|---|---|---|---|---|
| 7sn4 | Xiaomi MIUI 12.0.1 | **4m** | 45.42123, 4.06431 | 5ms |
| j37j | Xiaomi MIUI 12.0.2 | **4m** | 45.42125, 4.06431 | 6ms |
| cm3j | Samsung A41 | **3m** | 45.42123, 4.06425 | 5ms |
| occn | Fairphone 4 | **12m** | 45.42125, 4.06426 | 6ms |

All four agree on the trigger location to within 1m. The zone trigger is solid.

**GPS quality map across all 10 ST_BONNET sessions (1254 fixes total):**

| Device | Session | Role | Avg accuracy | p95 | >20m fixes |
|---|---|---|---|---|---|
| FP4 noon setup | nlrc | setup | 21.7m | **114m** | 87/550 |
| FP4 pre-walk onb | b7vl | onboarding | 19.5m | **58m** | 9/26 |
| FP4 walk | occn | walk | 10.3m | 11m | 0/28 |
| Redmi Note 11 | 8aym | stuck | 9.7m | 12m | 0/334 |
| Xiaomi M2101K7AG | bqgf | onboarding | 7.6m | 10m | 2/120 |
| Xiaomi M2101K7AG | 7sn4/j37j | walks | 4.0m | 4m | 0/22 |
| Xiaomi M2101K7AG | 7qgn | onboarding | 5.7m | 10m | 0/84 |
| Samsung A41 | rej9 | onboarding | 2.4m | 4m | 0/79 |
| Samsung A41 | cm3j | walk | 2.1m | 3m | 0/11 |

**For Magalie — poor GPS spot to avoid when placing zone starts:**

The Fairphone 4 produced very poor accuracy (200–300m) at a cluster around **lat=45.4225, lon=4.0663** — approximately 210m north-northeast of the trigger zone. This cluster comes from the nlrc noon session when the FP4 was standing around during onboarding. Possible causes: building canyon, tree cover. Avoid zone start boundaries within ~50m of that cluster. The trigger zone itself (lat≈45.4212, lon≈4.0643) was clean on all phones including the FP4.

The Fairphone GPS chip consistently underperforms compared to Xiaomi/Samsung at this location (10–22m avg vs 2–8m), but it still triggered the zone cleanly when walking.

---

## 4. Baptiste's FRAPPAZ walk — 8giw clean analysis

See §3 of the original report. Summary: 211 real fixes, avgAcc=7m, 0 gaps, 0 audio errors, ExoPlayer on all 40 loads, `fusedAvailable=false` (GMS issue on this dev ROM), alarm_wake_stats `count=0` (Doze backup never needed). 300 `accuracy_near_border` events for E1/E2/E3 calibration (p95=+3.2m outside border).

---

## 5. Bug findings

### 5.1 — CRITICAL: Simulation state persists in localStorage across sessions

**Sessions affected:** cz3v (08:30), wkvr (08:39), dla6 (16:37), qtk7 (16:38), **ykvf (16:39)**

**Root cause:** Simulation mode is stored in localStorage and is never reset between sessions. Once activated during morning dev testing, it remained active for every session that day — including Baptiste's intended real GPS test at 16:39.

**Evidence trail:**
- All morning HTC U11 sessions: `gps_state reason:"simulate"`, GPS `source:"simulate"`
- `dla6` (Baptiste's first afternoon onboarding, 16:37): `gps_state reason:"simulate"` — simulate already active before ykvf
- `ykvf` (16:39): `session_start` opens a fresh session (not a walk resume), but immediately fires simulate GPS fixes within 55ms. `gps_startup_rejected reason:"simulate"` confirms the startup gate knows these are simulated (and correctly rejects them for the startup ready check), but the zone trigger (`route_probe acceptedForTrigger:true`) still processed them, triggering steps 0 and 1 from simulated positions

**What Baptiste experienced:** he opened the app for a real GPS test. The app silently restored simulation mode from the previous session. Steps 0 and 1 fired from scripted waypoints in 3s and 42s. He pocketed the phone. The simulation replay timer stopped (screen lock stops JS timers). 26 minutes later he unlocked — the simulation misfired a single out-of-sequence waypoint at lat=45.76776/lon=4.91376 (≈3km from the route) before snapping back to the start position. This is the "GPS went haywire / m'a envoyé n'importe où." The session then resumed at step 1, audio played, he tapped restart.

**Fix needed:**
- Simulation mode flag must be reset to OFF on every fresh session start (not inherited via localStorage)
- In devmode, display a persistent "SIMULATION ACTIVE" banner while simulate is on, so the developer can see the mode at a glance
- The simulate/real boundary in route_probe needs to be consistent with the startup gate: if the startup gate rejects simulate fixes for readiness, the route_probe should also not advance steps based on simulated positions unless the user has explicitly activated simulation for this session

---

### 5.2 — CRITICAL: `checkbatteryopt` silent deadlock on `blocked=true`

**Sessions:** 8aym (Xiaomi Redmi Note 11 HyperOS, 29min, walk never started), nlrc (Fairphone 4 Android 15, 74min, 3 restarts)

When `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is blocked by the OS, `battery_opt:{blocked:true}` fires but the `checkbatteryopt` page has no handler. The user sees a static screen with no feedback or exit path.

**Fix needed:**
- Detect `battery_opt.blocked=true`
- Surface manual instructions: "Allez dans Paramètres → Applications → Flânerie → Batterie → Sans restriction"
- Offer "J'ai fait ça" (re-polls) + "Continuer quand même" escape (the exemption is not a hard requirement)
- Wire `visibilitychange`/`resume` auto-advance (as in `checknotifications`)

---

### 5.3 — MODERATE: Simulation mode — real GPS runs concurrently and can override simulated position

**Report:** Baptiste, 06/06/2026 — in simulation mode, real GPS position fires alongside simulated position and overrides it

**Root cause hypothesis:** when simulate mode is active, the native bg-geo plugin still delivers real GPS callbacks. Both `source:"simulate"` and `source:"raw"` events arrive. The route_probe/zone logic does not filter by source — whichever fix is most recent wins for zone triggering. In ykvf (pure simulate), the `rdv-warmup` real fix (acc=244m) appeared at t=6s but was rejected by the startup gate; once the walk ran, only simulate fixes dominated. On Baptiste's 06/06 test, real GPS may have been more active (possibly having had time to converge) and its fixes interleaved with or beat the simulate-map-drag fixes.

**Why simulation mode is specifically foreground-only:** simulation positions are injected by the user dragging a map marker. This requires the screen on. There is no background GPS issue with simulate mode in normal use.

**Fix needed:** when simulate mode is active, the route_probe (or the upstream fix dispatcher) should ignore real GPS fixes and process only `source:"simulate"` events. Real GPS hardware can remain on (for the warmup position display) but real fixes must not affect zone triggering while in simulate mode.

---

### 5.4 — MODERATE: Launcher cannot connect to server via WiFi tethering (fresh install)

**Report:** Magalie, 04/06/2026 — 3 of 4 Android phones (fresh install) blocked at splash screen with "Veuillez connecter à internet" when connected via WiFi hotspot from another phone. Same devices work on normal WiFi and direct 4G. No telemetry received (phones never reached the server).

**Context:** fresh install = no cached zip on device. The launcher must download the app zip from the server on first launch.

**Hypotheses for systematic failure specifically on tethering, not on direct WiFi/4G:**

1. **Double-NAT / CG-NAT stack breakdown (most likely):** Direct 4G goes through a single NAT layer (operator CG-NAT). WiFi tethering adds a second NAT (Android hotspot NAT → operator CG-NAT). Some operators (Free/SFR/Orange in France) detect or restrict double-NAT paths. The HTTP connection to the server may time out silently rather than returning an error, causing the launcher's connectivity check to see "no connection."

2. **IPv6/IPv4 dual-stack mismatch:** French 4G is often dual-stack. Direct 4G devices get both IPv4 (CG-NAT) and IPv6 (public). Android hotspots typically share IPv4 only (no IPv6 prefix delegation to clients). If `flanerie.bloffique-theatre.com` has a AAAA record, clients on direct 4G use IPv6 (works); clients on tethered WiFi use IPv4 through CG-NAT (may work or may be blocked). If the server has IPv6 only or prefers IPv6 and the launcher's HTTP client resolves AAAA first, tethered devices get nothing.

3. **Timing: hotspot up but 4G route not yet established:** When the tethering phone enables its hotspot, it briefly suspends its own data connection to set up NAT tables (2–15s window). If all phones open the launcher simultaneously (as would happen during a team setup), they all fire the connectivity check in this window and all fail. A 30-second retry would resolve this.

4. **Android `NET_CAPABILITY_VALIDATED` not set on the tethered network:** Android validates a new network by pinging a Google captive-portal check URL. On some tethering scenarios this validation takes longer or fails (operator proxy intercepts the validation response). The launcher may check `hasCapability(NET_CAPABILITY_VALIDATED)` and block before the network is actually usable.

5. **MTU mismatch on the tethering path:** Android hotspot NAT commonly reduces MTU to ~1400 bytes. HTTPS initial TLS handshake packets may exceed this, causing fragmentation that some carriers drop silently.

**Recommended investigation:** on the next tethering failure, ask one of the blocked phones to open a browser and try to reach `https://flanerie.bloffique-theatre.com` directly. If that also fails → DNS or routing issue. If it loads → the launcher's connectivity check is more restrictive than a browser request. Also check: does the tethering phone itself have working data at that moment (open a browser on the hotspot phone)?

**Fix in the launcher:**
- Retry the server connectivity check with exponential backoff (5s → 15s → 30s) before showing the error, to handle the hotspot NAT-setup timing window
- Show a more specific error: "Impossible d'atteindre le serveur Flânerie. Vérifiez que le téléphone a accès à internet (pas seulement au WiFi)." with a "Réessayer" button
- Long-term: once a zip is downloaded and cached, the launcher should be able to launch from cache even without network access

---

### 5.5 — INFO: Architecture D Fused fallback unavailable on SM-A515F dev phone

`location_dispatch_stats.fusedAvailable=false` throughout 8giw (all 43 snapshots). GMS provisioning issue or FusedLocationClient init failure on this dev ROM. Architecture D not exercised. Validation still needs a GMS-enabled device with a real GPS gap.

---

### 5.6 — INFO: SM-A415F (Samsung A41) shows LOW_MEMORY process exits

`cm3j` (1-min walk): two `LOW_MEMORY` exits in `last_exit_reasons`. No impact on a 1-min walk. Watch on longer sessions.

---

## 6. Pre-VILLEURBANNE test list — updated status

| Test | Status | Notes |
|---|---|---|
| T-1 Android startup audio | Not tested | No cold-start non-devmode session |
| T-2 iOS GPS forceReacquire | Not tested | No iOS sessions |
| T-3 Zone repeats / accuracy_near_border | Partial — 300 events from 8giw | Single device, avgAcc=7m — need noisier device for calibration |
| T-4 BLOC_15/16 audio | N/A | INVITES_V2 is a different parcours |
| T-5 OEM kill resistance | Partial — 8giw clean 21min | Short sessions only; needs a full-length loan-phone walk |
| T-6 iOS audio resume after kill | Not tested | No iOS sessions |
| T-7 Loan phone UUID/LOAN/rearm | Not tested | No `is_loan=true` sessions |

---

## 7. Bug priority order

| # | Severity | Item | Fix scope |
|---|---|---|---|
| 1 | **BLOCKING** | `checkbatteryopt` locked on `blocked=true` | webapp: detect blocked, show manual instructions + escape |
| 2 | **BLOCKING** | Simulate state persists across sessions silently | webapp: reset simulate flag on fresh session start; add visible banner |
| 3 | **MODERATE** | Real GPS runs in simulate mode and overrides simulated positions | webapp/geoloc: filter `source:simulate` in route_probe; ignore real fixes during simulate |
| 4 | **MODERATE** | Launcher blocks on fresh install via WiFi tethering — no retry | launcher: backoff retry + clearer error + "Réessayer" button |
| 5 | **DATA** | E1/E2/E3 calibration: need noisier device (avgAcc 20–30m) | plan session on FP4 or low-end device |
| 6 | **DATA** | Architecture D Fused: fusedAvailable=false on dev phone | test on GMS-enabled device with real GPS gap |
