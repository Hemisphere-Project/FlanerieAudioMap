# iOS Native Robustness Plan — pre-implementation draft

**Date:** 2026-05-28
**Goal:** Reach Android-level resilience on iOS for a 45-min pocket-locked GPS-triggered audio walk. Mirror the two big Android moves done since GIVORS — ExoPlayer for audio, Architecture D (Raw + Fused) for GPS — with iOS-appropriate native equivalents.

**Scope:** Five workstreams. Two are large rewrites and need a design call (marked **DISCUSS** below). Three are smaller add-ons.

> All decisions deferred to the user are marked `DECISION` inline. Nothing in this doc is implemented yet.

---

## 0. Where we are today on iOS

| Layer | Current native iOS code | Failure modes seen in field |
|---|---|---|
| GPS | `CLLocationManager.startUpdatingLocation` + parallel SLC monitor (BG-10) + 15 s `NSTimer` keepalive + `forceReacquire` restart + `allowsBackgroundLocationUpdates` re-assertion. JS owns step-fire from delivered fixes. | GIVORS S1 (iOS 26.3.1, 8–14 min blackouts), M1 (iOS 26.4.2, 2–5 min gaps). Once standard updates stall, JS gets nothing; NSTimer keepalive falls back to a stale `clm.location` and the walker silently misses steps. |
| Audio | `cordova-plugin-media` (AVAudioPlayer for prepared files) wrapped by `NativeMediaPlayer` in `player.js`. AVAudioSession Playback category owned by `cordova-plugin-audiofocus`. Interruption + route observers shipped (AF-1..AF-7). | GIVORS S2 iOS playerror clusters (`rumx` 27, `vigi` 21). Files loaded but decode/start failed; suspected stale AVAudioPlayer instances + AVAudioSession churn (4929 `audiofocus_request_fail` fleet-wide). |
| Step state | Persisted via JS to `localStorage` (`parcours_store`). Restored by JS on relaunch. | Cold relaunch from terminated state has a JS-bootstrap window where audio cannot start because nothing native is alive. |
| Now Playing | None — `cordova-plugin-media` may set a minimal MPNowPlayingInfo for the foreground audible track, but we don't configure it explicitly. | Suspected contributor to iOS scheduler deciding the app "isn't really playing" → background time pruned. |

Versions in the build today: `cordova-background-geolocation-plugin@2.9.0`, `cordova-plugin-audiofocus@1.6.0`, `cordova-plugin-power-optimization@0.3.1`. Round 20 just landed Architecture D on Android — iOS got no equivalent in that round.

---

## 1. **Workstream H — GPS rail of wake-up regions** *(✅ shipped Round 23 / bg-geo v2.10.0; awaiting iOS device validation)*

### Idea (refined per your feedback)

Register a series of **coarse `CLCircularRegion`s along the route** with the **sole purpose of waking the app**. They never trigger step audio. When iOS delivers a `didEnterRegion` / `didExitRegion` event, the native plugin:

1. Confirms `startUpdatingLocation` is still active; restarts it via the existing `_doForceReacquire` if `lastRealLocationTime` is > 60 s old.
2. Opens a `beginBackgroundTask` to extend the wake window (~10 s default, can be ~30 s on entry events with a task).
3. Optionally pings JS with a `gps_rail_wake` event (telemetry-only, no behaviour).
4. Lets the **existing fine-grained JS zone-trigger logic** fire normally as soon as standard updates resume.

Step-trigger accuracy is **unchanged**. The regions are pure plumbing: they hand iOS a reason to wake us so the normal stack can do its job.

### Why this should work

- Region monitoring is scheduled by iOS at OS level, **independent** of `startUpdatingLocation`. It survives the exact failure mode behind S1 / M1 (CLLocationManager standard callbacks stall while the OS still knows roughly where the device is).
- iOS launches a suspended or terminated app on region crossings with `UIApplicationLaunchOptionsLocationKey` (we already handle this code path at `CDVBackgroundGeolocation.m:589`).
- A coarse region's accuracy is irrelevant here — we never act on its bounds. We only use the event as a wake-up tick.

### Hard constraints

- **20 regions per app, app-wide.** The webapp normally registers nothing else, so we get 20 for the rail.
- A 45-min walk at ~1.2 m/s ≈ 3.2 km route. 20 regions across that = ~160 m apart. Comfortable with 200 m radius — overlap guarantees the walker is always inside at least one, so entries fire even when an exit is missed.
- Region delivery latency is typically 5–30 s in normal conditions. **Not** a substitute for fine-grained GPS; it's a watchdog.

### Layout

**SETTLED — 1.A: transition-midpoint circles.**

**Context:** FLANERIE walks have ~17 contiguous steps whose polygons touch or are very close. Centering a region on a step centroid would place it well inside the zone — the region would fire too late (or never, if the user already crossed during a GPS stall). And we emphatically do not want to make the zone trigger coarser.

**Is the existing SLC + NSTimer keepalive (the "B/C" stack) already sufficient?**

Not reliably. The 15 s NSTimer keepalive fires regardless of CLLocationManager state, but it can only re-deliver the last cached `clm.location` — it cannot restart stalled standard updates on its own. SLC fires on cell-tower significant changes (~300–500 m thresholds), giving us 2–4 events across a typical 1–2 km walk — coverage for 2–4 of the 16 step transitions, not all 16. Crucially, when the WKWebView is suspended in deep background, JS does not run at all: the B4 watchdog timer, telemetry, and the JS-side forceReacquire call all stop. Only NSRunLoop-scheduled native timers and OS-level callbacks (region events) still fire. Region events therefore fill a gap the keepalive + SLC stack genuinely cannot cover.

**Settled layout:** one `CLCircularRegion` at the geographic midpoint between consecutive step centroids — i.e., one circle per step *transition*, not per step. 17 steps → 16 transition circles, comfortably under the 20-region OS limit.

- **Radius: 100 m.** The circle fires when the user is ~100 m from the boundary, on approach. GPS has ~100 m of walking time (~80 s at 1.2 m/s) to recover before the fine-grained polygon entry is checked. Tight steps where adjacent centroids are <200 m apart will produce overlapping circles — that is fine; they're purely wakeup, not semantic boundaries.
- **Not "before" the preceding step:** a circle at the midpoint between step N and step N+1 sits at the far edge of step N. The walker is already through most of step N's audio before the circle fires. No premature trigger.
- **Practical note:** for steps whose shared polygon boundary can be computed (convex hull intersection point), that point is slightly more accurate than the centroid midpoint. Start with centroid midpoint; refine if needed after VILLEURBANNE data.

**SETTLED — 1.B: static registration.** Register all 16 circles at parcours start. Add a DEV-mode assertion if `region_count` > 20.

### Files to touch

- `ios/common/BackgroundGeolocation/MAURRawLocationProvider.m`
  - New ivar: array of `CLCircularRegion` for the rail.
  - On `onStart:` register rail regions (separate `CLLocationManager` instance — the `_slcManager` is already there, we can either reuse it or add `_railManager` to keep delegate methods cleanly separated; recommended **separate `_railManager`** to avoid mixing concerns).
  - On `onStop:` stop monitoring all registered regions.
  - New delegate methods `locationManager:didEnterRegion:` / `:didExitRegion:` that call into `_doForceReacquire` (with throttle: skip if last forceReacquire <30 s ago) and emit a JS event.
- `ios/CDVBackgroundGeolocation/CDVBackgroundGeolocation.m`
  - New CDV action `configureRail(regions[])` — JS passes the precomputed rail.
  - New event name `region_wake` sent through the existing `addEventListener` callback channel.
- `www/app/assets/geoloc.js`
  - On parcours start: compute 16 transition-midpoint circles (midpoint between each consecutive pair of step centroids, 100 m radius) and call `configureRail`.
  - On `region_wake` event: just log telemetry; no behaviour. The whole point is that fine logic stays unchanged.
- `www/app/assets/telemetry.js`
  - New event: `gps_rail_wake` (region id, last_real_callback_age_ms, did_force_reacquire, app_state).

### Cold relaunch path

If iOS relaunches us from terminated on a region cross:

1. `application:didFinishLaunchingWithOptions:` receives `UIApplicationLaunchOptionsLocationKey` — already detected at `CDVBackgroundGeolocation.m:589`.
2. We re-`start` the facade so CLLocationManager comes back. Existing code path; verified.
3. **New:** restore the native step-state cache (see workstream **K**) so the next JS load can pick up `LAST_STEP_DONE_ID` + `RESUME_SEEK_POS_S` without waiting for `localStorage`.
4. iOS gives us ~10 s background time. We open `beginBackgroundTask` for ~30 s, give the WebView a chance to come back, then the JS layer takes over.

### Telemetry additions

| Event | Fields | Purpose |
|---|---|---|
| `gps_rail_wake` | `region_id`, `event` ∈ {`enter`,`exit`}, `last_real_callback_age_ms`, `did_force_reacquire`, `app_state` ∈ {`foreground`,`background`,`relaunch`} | Quantify how often regions saved us. If `did_force_reacquire=true` is frequent on iOS 26.3.x devices, the rail is doing its job. |
| `gps_rail_configured` | `region_count`, `total_route_m`, `avg_spacing_m` | One per parcours start; sanity-check what we deployed. |

### Risks & open questions

- **iOS asks for "Always" + "While Using"** — already requested by existing code path. No new permission prompt.
- **Region monitoring counts against power budget?** Apple says no — it's the optimised path. SLC + regions are explicitly cited as low-power monitors.
- **What if iOS decides to ignore some regions** due to GPS/Wi-Fi unavailability indoors? Some museums might mute regions until a fix is acquired. For an outdoor walk this is unlikely to matter.
- **Throttling `_doForceReacquire`:** ~~current code allows max 3 per session~~ → **SETTLED 1.C: raise to 10 per session, gated by "real callbacks stalled > 30 s."** 3 was sized for the JS-side B4 watchdog; rail regions can fire 16 times in a walk, so 3 would be exhausted in the first quarter. The 30 s gate prevents thrashing during transient signal loss (normal brief drops don't warrant a full CLLocationManager restart).
- **SETTLED 1.D: rail entries do not nudge the audio layer.** Audio is owned by the audio plugin; coupling adds surface area. The rail's job is GPS only.

---

## 2. **Workstream I — Native iOS audio engine** *(major; decisions settled — ready to implement)*

### Why

iOS playerror clusters (`rumx` 27 errors, `vigi` 21) were files that loaded but failed mid-play. Root cause is uncertain but the suspect surface is:

1. `cordova-plugin-media` allocates a new `AVAudioPlayer` per `Media()`. Each parcours generates 30+ Media objects (voice + afterplay × 17 steps + globals). Old instances may not be released cleanly; AVAudioPlayer state machines on iOS 17+ are stricter.
2. AVAudioSession is activated/deactivated repeatedly. `audiofocus_request_fail` flood (4929 events) is partly an artefact of this churn.
3. No prebuffering. A step's voice file is `new Media()`'d only at fire time; load can race with the GPS trigger (the iOS equivalent of Android's M4 cold-load race, even though we haven't yet seen it cause an iOS abandon).

Android's ExoPlayer move solved the equivalent problems by:
- Single long-lived player instance + media item queue
- Prebuffer next item
- One foreground service / one audio focus owner

### What "native iOS audio engine" looks like

- One **`AVQueuePlayer`** owning voice + afterplay slots per step, swapped via `replaceCurrentItem` for seamless transitions.
- **`AVPlayerItem` pre-load** of next step's voice while current step plays.
- Single AVAudioSession lifecycle in the same plugin (deactivate only on parcours end + on `releaseSession()`).
- Native crossfade between zone players + voice/afterplay using `AVMutableAudioMix` (or a simple JS-driven volume ramp on `AVPlayer.volume` — sub-frame precision in iOS 17+).
- Position polling stays at 250 ms via `addPeriodicTimeObserverForInterval`.
- Errors reported with high-fidelity `AVPlayerItemFailedToPlayToEndTimeNotification` reason codes (vs cordova-plugin-media's generic MEDIA_ERR_*).

**SETTLED — 2.A: Option A — rename `cordova-plugin-exoplayer-simple` → `cordova-plugin-audio-simple`, add iOS implementation alongside Android.** One JS API for both platforms, native-per-platform. AVAudioSession ownership migrates here from `cordova-plugin-audiofocus`. `cordova-plugin-audiofocus` retains Android FG-service + audiofocus concerns and the iOS interruption-observer-as-telemetry path only. Rename is a one-time cost: `plugin-upgrade` skill entry update + `plugin.xml`/`package.json` rename + one `cordova plugin remove/add` cycle in FlanerieCordova.

### JS contract (regardless of plugin home)

```
window.audioSimple.preparePlayer(playerId, { voiceUri, afterplayUri, loop })
window.audioSimple.play(playerId)            // starts whichever item is queued
window.audioSimple.pause(playerId, { rewindOnPauseSec })
window.audioSimple.seek(playerId, seconds)
window.audioSimple.volume(playerId, v)
window.audioSimple.fade(playerId, from, to, durationMs)
window.audioSimple.swapToAfterplay(playerId) // voice→afterplay (no JS roundtrip in native)
window.audioSimple.prefetch(playerIds[])     // hint to begin AVPlayerItem load
window.audioSimple.unload(playerId)
window.audioSimple.releaseAll()
```

Events: `loaded`, `play`, `pause`, `end`, `playerror`, `loaderror`, `voice→afterplay_swapped`.

This maps 1:1 to what `PlayerStep` / `PlayerSimple` currently consume.

### Files to touch (under Option A)

- New: `src/ios/AudioSimplePlugin.m` (or `.swift`).
- New: `src/ios/AudioSimplePlayer.m` — one `AVQueuePlayer` + observer per playerId.
- New: `src/ios/AudioSimpleSession.m` — AVAudioSession lifecycle + MPNowPlayingInfo (see workstream J).
- `plugin.xml` — add iOS platform + Info.plist entries (already in audiofocus; will need to migrate).
- `www/audioSimple.js` — JS bridge (already exists for Android side; extend).
- `www/app/assets/player.js`:
  - `NativeMediaPlayer` → replace internals with `audioSimple.*` calls; keep external Howler-compatible API.
  - PLATFORM-conditional code paths simplify.

### Step-fire / wake-up integration

Important detail: a region-wake event (workstream H) may arrive while the WebView is suspended. If we want audio to start in that window without waiting for JS bootstrap, the native player needs to support a **"resume current step"** path callable directly from `MAURRawLocationProvider`:

**SETTLED — 2.B: JS-mediated only (Option B).** Region-wake events are not precise enough to serve as actual step triggers — they fire ~100 m before a zone boundary, not at it. Their only job is to restart the GPS stack. Audio never starts from a region wake directly; it starts only when the fine-grained JS zone-check fires on a fresh real CLLocationManager callback. The 200–500 ms JS roundtrip delay is irrelevant in that model. Keeps bg-geo and audio-simple decoupled at the ObjC level.

### Risks

- iOS 17+ AVAudioPlayer behaviour change around prepared-but-not-played files. AVQueuePlayer is the documented forward path.
- `replaceCurrentItem` has a known short interruption (~10–50 ms). Acceptable for voice→afterplay but if we want it imperceptible we'd need a parallel-tracks crossfade. Defer to round-2 if needed.
- AVAudioSession Playback category interacts with Siri / phone calls — same surface as today; the C6 interruption-without-ShouldResume fix in audiofocus carries over.
- MIGRATION: **SETTLED 2.C: single cutover.** `NativeMediaPlayer` internals replaced with `audioSimple.*` calls in one round; external Howler-compatible API preserved so `PlayerSimple` / `PlayerStep` call sites are unchanged. Add a JS constant `AUDIO_ENGINE = 'audio-simple'` (was `'native-media'`) for emergency telemetry triage but no runtime toggle.

---

## 3. **Workstream J — MPNowPlayingInfoCenter + MPRemoteCommandCenter** *(small; constraint = lock controls)*

### Goal

Make iOS treat the app as a first-class media app: surface "Now Playing" tile on lock screen + Control Center, **but reject all user controls** (no pause, no skip, no scrub). Bound to the silent-loop player (parcours-long), independent of which step audio is currently audible.

### Native side

- On parcours start (when `startKeepalive` is called): set `MPNowPlayingInfoCenter.default().nowPlayingInfo` with `MPMediaItemPropertyTitle = "Flânerie"` (and step name if we want to update per step), `MPNowPlayingInfoPropertyPlaybackRate = 1.0`.
- Register the full `MPRemoteCommandCenter`, **explicitly disabling** every command:
  - `playCommand.isEnabled = NO`
  - `pauseCommand.isEnabled = NO`
  - `togglePlayPauseCommand.isEnabled = NO`
  - `nextTrackCommand.isEnabled = NO`
  - `previousTrackCommand.isEnabled = NO`
  - `stopCommand.isEnabled = NO`
  - `changePlaybackPositionCommand.isEnabled = NO`
  - For each: also register a no-op handler that returns `.commandFailed` as belt-and-braces against iOS routing the press elsewhere.
- On parcours end: clear `nowPlayingInfo = nil` and disable the command center.

### iOS UX consequence

- Lock screen tile shows "Flânerie playing" with no working transport buttons.
- The user *can* still drop the volume to 0 via hardware volume buttons — that's a system-level thing we can't override. Acceptable.
- Tapping the lock-screen tile artwork takes the user back to the app — desirable.

### Plugin home

Lives wherever AVAudioSession lives. Under workstream I Option A → in the new `cordova-plugin-audio-simple`. Under Option C → stays in audiofocus. Don't ship MPNowPlayingInfo from the bg-geo plugin.

### Risk

`MPRemoteCommandCenter` is global per app. If a future component wanted to enable controls, it'd need to coordinate. Today nothing else does, so no conflict.

---

## 4. **Workstream K — Native step-state cache** *(small)*

### Goal

Persist `{ lastStepId, lastSeekPosSec, lastUpdatedMs }` to `NSUserDefaults` from the native audio plugin (or audiofocus, depending on Decision 2.A). On every `snapshotVoicePosition()` JS call, also push the latest snapshot to native via a CDV action. On cold relaunch:

1. Native reads from `NSUserDefaults` immediately.
2. Plugin exposes `getResumeSnapshot()` returning `{ stepId, seekPosSec, ageMs }` to the JS layer.
3. JS layer uses this **before** `localStorage` is hydrated — saves the WebView-bootstrap window.

### Why it's worth shipping

- The region-wake / launch-from-terminated path benefits directly: native code can decide whether to nudge audio start before JS is back.
- Even without the bigger workstreams, this is a 2-hour task: a CDV `setResumeSnapshot` + `getResumeSnapshot` action and a JS call in `Parcours.snapshotVoicePosition()`.
- Resilient to `localStorage` quota issues that could in theory wipe our state.

### Files to touch

- `cordova-plugin-audiofocus/src/ios/AudioFocus.m` (until Decision 2.A reshuffles): add `setResumeSnapshot:` and `getResumeSnapshot:` actions.
- `www/app/assets/parcours.js`: dual-write snapshots to localStorage and to native.
- `www/app/assets/parcours.js` on resume: read native snapshot if `ageMs < localStorageAgeMs` (defensive against rare clock skew).

### Telemetry

Add `resume_snapshot_source` ∈ {`localStorage`, `native`} on `parcours_restore`. Tells us how often the native path was the winner.

---

## 5. **Workstream L — CLMonitor (iOS 17+)** *(small; DISCUSS scope)*

### Background

`CLMonitor` (iOS 17+) is Apple's modern async-sequence API that unifies:

- Region monitoring (replaces `startMonitoringForRegion:`)
- Significant location changes
- Visit detection
- Beacon ranging (not relevant here)

Apple's claimed advantages: cleaner observer lifecycle, more reliable wake-from-suspended, no class-wide delegate juggling.

### Where it would help us

Two places, both inside workstream H:

- **Implement the rail in `CLMonitor`** on iOS 17+, fall back to legacy `startMonitoringForRegion:` on iOS 13–16. Same semantic, modern API.
- **Add visit monitoring (`CLMonitor.CircularGeographicCondition` + visit events)** — iOS infers when a user "stopped" somewhere. Could be useful for a step that requires lingering (FLANERIE_ELYSEE step 4 is described in the audit as a "choice step where visitors can linger"). Today we don't act on that, but visit events could power smarter zone-fire decisions in the future.

### Scope question

**SETTLED — 5: Option B (extended).** Use `CLMonitor` on iOS 17+ for the rail (cleaner async lifecycle, Apple's documented forward path for region monitoring). Also subscribe to `CLMonitor` visit events and forward them to JS as telemetry (`gps_visit_event`: `latitude`, `longitude`, `horizontalAccuracy`, `arrivalDate`, `departureDate` when available). No behaviour change — visit events are observation-only. Goal: measure at VILLEURBANNE whether iOS visit detection correlates with step dwell time; could eventually power a smarter "user lingered" confirmation gate. On iOS < 17: fall back to legacy `startMonitoringForRegion:`; no visit events (graceful degradation).

### Risk

- Swift requirement: `CLMonitor` is async/await. Easier to wrap in Swift than ObjC. Adds a `.swift` file to the plugin (bridge with `@objc` exported wrapper).
- iOS 17 is currently the floor for many devices in the fleet (per GIVORS the field shipped iOS 18–26). Branching cost: low.

---

## 6. Order of implementation if we proceed with everything

Suggested sequencing (all decisions settled):

1. **Workstream K (native step-state cache)** — ✅ Round 21/22 (audiofocus v1.8.0).
2. **Workstream J (MPNowPlayingInfo + locked controls)** — ✅ Round 22 (audiofocus v1.8.0).
3. **Workstream H (rail of wake-up regions)** — ✅ Round 23 (bg-geo v2.10.0).
4. **Workstream I (native audio engine)** — biggest rewrite; touches plugin layout per Decision 2.A. Bundle MPNowPlayingInfo migration if Option A is chosen. **Next.**
5. **Workstream L (CLMonitor)** — folded into workstream H's implementation choice. Currently shipped on legacy `startMonitoringForRegion:` (iOS 13+). CLMonitor upgrade (with visit events per Decision 5 Option B) deferred to a follow-up round on iOS 17+ devices.

After each: bump fork version, commit dirty repos, re-install in FlanerieCordova, regenerate package-lock, ship a build for VILLEURBANNE.

---

## 7. What this does *not* fix

Listing explicitly so we don't oversell:

- **E1/E2/E3 zone-overshoot gates** still need VILLEURBANNE `accuracy_near_border` data; rail regions are too coarse to address border-overshoot.
- **iOS 26.3.x intrinsic OS bug** — if Apple genuinely broke `startUpdatingLocation` in 26.3.1 we are still relying on the OS to recover. Region wakes give us a forcing function but they don't *guarantee* the next fix arrives quickly.
- **Audio file integrity issues** (S2 root cause partly open) — native engine won't fix corrupt downloads. C2 integrity check + C4 retry still own that.

---

## 8. Decisions — all settled

| # | Decision | Settled |
|---|---|---|
| 1.A | Rail layout source | Transition midpoints (centroid midpoint between consecutive steps), 16 circles @ 100 m radius |
| 1.B | Static vs dynamic rail | Static; DEV assert if region_count > 20 |
| 1.C | forceReacquire throttle | 10 / session, gated by real-callback stall > 30 s |
| 1.D | Rail entries nudge audio layer? | No |
| 2.A | Plugin home for native audio | Option A — rename exoplayer-simple → audio-simple; AVAudioSession ownership migrates there |
| 2.B | bg-geo → audio cross-plugin call | Option B — JS-mediated; region-wake is wakeup-only, not a trigger |
| 2.C | Audio migration strategy | Single cutover; `AUDIO_ENGINE` constant for telemetry, no runtime toggle |
| 5   | CLMonitor scope | Option B — rail on CLMonitor (iOS 17+) + visit events wired to telemetry; fallback to legacy regions on iOS < 17 |

All decisions settled. Next step: per-workstream implementation rounds in `mobile-audit.md` format.
