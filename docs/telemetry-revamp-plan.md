# Telemetry Page Revamp — Plan

*2026-06-12 — covers `www/control/telemetry.html` (1870 lines, single file) + `server.js` telemetry routes.*

> **Status: IMPLEMENTED 2026-06-12** (all phases P1–P5 incl. extras). Client now lives in
> `www/control/telemetry.{html,css}` + `www/control/telemetry/{utils,state,api,maps,detail,list,app}.js`.
> ⚠️ server.js changed (new summary fields, cache, `?since`/`?afterT`, notes endpoints, auto-archive):
> the deploy webhook does NOT restart node — **restart the server** after pulling.

## 1. Current state & pain points

| Pain point | Root cause in code |
|---|---|
| Filters lost on reload | Filter state lives only in DOM inputs (`getFilteredSessions()` reads inputs directly); nothing persisted to URL or localStorage |
| Coarse date-only filters | `dateOnly()` truncates to YYYY-MM-DD; no hour granularity |
| Onboarding noise | `onb:<parcoursId>` sessions (phase `onboarding`, set in `telemetry.js` `startOnboarding`) render as full rows identical to walk rows |
| No uuid grouping | `/telemetry/sessions` summary omits `client.deviceUuid` and `isLoanDevice` entirely |
| No finished / in-progress distinction | Summary has no `endedAt`/status; `session_end` events exist in the data but are never surfaced |
| No live follow | Manual Refresh button only; full re-list + `detailCache.clear()` every time |
| Server cost per refresh | `GET /telemetry/sessions` re-reads + `JSON.parse`s **every** session file (multi-MB each) on every call; client "hydration" additionally fetches up to **12 full session JSONs per render** (`hydrateFilteredSessions`) — this is the actual hammering |
| No GPS accuracy on map | `renderMap()` draws a flat cyan polyline; `acc` per fix is in the data but unused |
| Monolithic file | All CSS/JS inline in one 1870-line HTML file |

Useful existing assets to keep: server-side `buildSessionSummary`/`summarizeTelemetrySessionData`, parcours overlay endpoint (`/telemetry/parcours/:id`), error-badge popovers, archive/prune tooling, map view-state preservation, atomic-write ingest.

---

## 2. Target information architecture

```
┌─ Header bar (sticky) ─────────────────────────────────────────┐
│ Telemetry   [Live ●/○]   [Sessions | Beacons | Archive] tabs  │
│ Filters: parcours ▾ · kind (walk/onb/all) · hour range ◫━━◫   │
│          progress range ◫━━◫ · device ▾ · search · [reset]    │
└───────────────────────────────────────────────────────────────┘
▼ IN PROGRESS (auto-refreshing)                       2 sessions
   ● SM-G525F · FRAPPAZ · step 4/12 · started 09:15 · last evt 12s ago
▼ TODAY — Thu 12 June                    4 devices · 6 sessions
   ▾ 📱 SM-G525F (uuid 9bad…, loan)            2 walks + 1 onb
       09:15 FRAPPAZ      32m  step 12/12 ✓ ended    [badges]
       11:02 FRAPPAZ      08m  step 3/12  ✗ interrupted (restart)
       ⋯ 1 onboarding session (2m)                   [expand]
   ▾ 📱 iPhone14,6 (uuid c1df…)                1 walk
▼ Wed 11 June                            …collapsed by default…
```

- **Day sections** replace the date-from/date-to inputs. Each day is a collapsible section with a day-summary line (devices, walks, completion count, error count). Date filter becomes "jump to day / load more days"; the fine filter inside a day is an **hour-range slider**.
- Within a day, rows **group by `deviceUuid`**. Each group shows the device label + uuid suffix + loan badge; sessions inside stay separate rows (so loan-phone restarts remain visible), ordered by start time, with `resume`/`restart` chips.
- **Onboarding sessions** (`parcoursId.startsWith('onb:')`) fold into a one-line count inside their device group, expandable. A kind filter (walk / onboarding / all) also exists for when onboarding itself is under investigation.
- **Status groups**: an "IN PROGRESS" section pinned on top (any day), then days. Status taxonomy below.

### Status model (computed server-side)

| Status | Rule |
|---|---|
| `live` | no `session_end` after last start/resume AND `lastEvent` < 3 min ago |
| `ended-complete` | has `session_end` AND `finalStep >= totalSteps - 1` |
| `ended-partial` | has `session_end`, finalStep below last step |
| `interrupted` | no `session_end`, `lastEvent` > 3 min ago (process killed / battery / crash) |

`totalSteps` comes from `findParcoursByTelemetryId()` (already in server.js) → enables **progress % = finalStep/totalSteps** for the progress-range filter and a per-row progress bar.

---

## 3. Workstreams

### W0 — Server foundations (enabler, do first)

1. **Summary cache**: in-memory `Map<file, {mtimeMs, size, summary}>`. On `GET /telemetry/sessions`, `fs.statSync` each file and re-parse only changed ones. Turns every poll after the first into stat-only (~ms). Invalidate on delete/archive/prune.
2. **Enrich `buildSessionSummary`** with: `deviceUuid`, `isLoanDevice`, `kind` (`walk`|`onboarding` from `onb:` prefix), `endedAt` (t of last `session_end`), `status` (rules above), `resumeCount`, `totalSteps`, `progressPct`, `appVersion`, `webappCommit`.
3. **Cheap polling**: support `GET /telemetry/sessions?since=<ms>` → only summaries with `lastEvent > since` + `{serverTime}`. Also send `ETag` (hash of `[count, max lastEvent]`) so unchanged polls return 304.
4. **Incremental detail**: `GET /telemetry/session/:id?afterT=<ms>` → `{events: [...only newer...], complete: bool}` so following a live walk doesn't re-download the full multi-MB file each poll.
5. **Delete the client hydration path** (`needsSessionHydration`, `hydrateSession`, `mergeSessionSummaryFromDetail`, `coalesceMetric` …): with (2) the summary is always complete. Removes the 12-full-file-fetch-per-render behaviour — biggest single perf win on both ends.

### W1 — Filter system

1. **All filter + view state in the URL hash** (e.g. `#parcours=FRAPPAZ&kind=walk&h=9-18&prog=0-50&day=2026-06-12&s=20260612_091529&live=1`). Survives reload, gives shareable deep links to a filtered view *and* to an expanded session. `history.replaceState` on change; parse on load.
2. New filters: **hour range** (double slider, applied within day sections), **progress range** (0–100 % using `progressPct`; "never reached step N" prospect use), **status** (chips: live / ended / interrupted), **kind** (walk / onb / all), **device** (dropdown built from uuids seen, labelled `model · uuid-suffix · loan?`).
3. Filters apply on input (no Apply button); Reset clears hash. Filter bar is sticky.

### W2 — List redesign (day segmentation + uuid grouping)

1. Render day sections from `startTime` (local TZ), newest first, collapsed except today + yesterday; "load older days" reveals more.
2. Day header: `N devices · N walks (N complete) · N onboarding · worst-accuracy / sleep-alert flags`.
3. Device groups inside each day (keyed `deviceUuid`, fallback to device label when uuid missing in old sessions). Loan badge from `isLoanDevice` / `devices.json`. Restarted sessions = consecutive sessions on same uuid+parcours; chip `restart #2` rather than merged.
4. Session row slimmed: time, parcours, duration, **progress bar (step x/y)**, status pill, error badges (keep existing popover system), expand.
5. Onboarding folding (count line per device group, expandable).
6. Optional (cheap, high value for field-test days): **day timeline strip** — one horizontal bar per session (start→end), colour by status, to see overlap of a multi-phone test at a glance.

### W3 — Live mode

1. **Live toggle** in header (default ON when any session is `live`, persisted in URL). When on: poll `?since=` every **30 s**, only while `document.visibilityState === 'visible'` (pause on hidden tab); ETag/304 keeps idle polls free. Backoff to 2 min after 10 unchanged polls.
2. In-progress section rows show "last event Xs ago" relative ticker (client-side, no extra fetch).
3. If the expanded session is live: poll its detail with `?afterT=`, **append** to the cached events, extend the map polyline in place (no map teardown — keep current view-state machinery), append to events table.
4. No websockets — polling with 304s is plenty at this fleet size and keeps the server dumb.

### W4 — Map & detail upgrades (incl. prospecting)

1. **Accuracy-coloured track**: draw the GPS track as per-segment polylines coloured by `acc` (green ≤5 m, cyan ≤10, amber ≤20, red >20 — same buckets as `precisionBadge`). Legend chip row under map.
2. **Accuracy ribbon toggle**: translucent `L.circle(latlng, radius=acc)` per fix, decimated (every Nth fix or min-distance), off by default — shows the uncertainty envelope around the track for prospecting.
3. **Problem markers**: pin `gps_callback_gap` (≥8 s), `gps_sleep_suspect`, `gps_trigger_rejected` at their nearest fix location (currently these exist only as table rows/badges — putting them *on the map* is the prospecting payoff: "this street corner loses GPS").
4. **Step-zone fire status**: colour step zones by outcome — fired (green outline), never fired (red outline), fired-late/refire (amber). Directly answers "which part of the walk should move".
5. **Time scrubber**: range slider under the map driving a marker along the track; readout shows clock time, elapsed, acc, src, gap, current step. Cheap to build, transforms session replay.
6. **Mini-charts**: accuracy-over-time + gap-over-time sparkline canvases (no lib needed, ~60 lines) above the events table; clicking a spike scrubs the map to that time.
7. **Prospect mode preset**: one toggle that enables 1+2+3+4 and hides audio metrics — the "check a prospected parcours" workflow becomes one click. With W1 deep links, a prospect walk is shareable as a single URL.
8. Events table: keep, but virtualise rendering for >5k events (render visible window only) — large walks currently build the entire DOM table.

### W5 — Structure & visual overhaul

1. **Split the file**: `www/control/telemetry.html` (shell) + `telemetry.css` + `telemetry/` JS modules (`state.js` url/filter state, `api.js` fetch+cache+polling, `list.js`, `detail.js`, `maps.js`). No build step, plain `<script>` tags or ES modules — consistent with the rest of `/control`.
2. **Beacons → tab**, not a panel pushing the session list below the fold (it's the launcher-debug tool, occasionally needed). Archive browsing also becomes a tab instead of a checkbox that silently swaps the data source.
3. Maintenance actions (archive filtered / prune) move into a kebab menu — they're rare destructive ops, currently occupying prime toolbar space.
4. Responsive pass: the prospecting workflow happens **in the field on a phone** — day sections and detail view must work single-column; map gets full width; filters collapse into a drawer. (Current `@media` only restacks the detail grid.)
5. Keep dark Bootstrap theme; consistency with `/control/list.html`.

---

## 4. Extra proposals (not in the original list)

- **Device registry join**: enrich rows from `devices.json` (`apk_version`, `first_seen`) — flag sessions running a **stale APK or stale webapp commit** (compare `webappCommit` to current `/version`); directly serves the stale-bundle deploy risk.
- **Day report export**: per-day "field report" JSON/CSV export matching what the `telemetry-analysis` skill consumes (one click = analysis input).
- **Named devices**: optional `label` field in `devices.json` editable from the page ("Thomas A52", "Loan #3") — uuids become human.
- **Session notes**: tiny server-side `notes.json` keyed by sessionId; a one-line annotation field per session ("wind, raining", "prospect rue X variant B"). Field-test memory is currently external.
- **Health score** per session (composite of acc/gaps/sleep/audio errors) to sort the worst sessions first on a busy test day.
- **Auto-archive policy**: server cron archiving sessions older than N days (keeps the active dir small → keeps the summary scan fast forever).
- **Anomaly cue on day header**: if any session that day has sleep suspects or `interrupted` status, the day header carries a red dot — triage without expanding.

## 5. Phasing & estimates

| Phase | Content | Size |
|---|---|---|
| **P1** | W0 server foundations + remove hydration; W5.1 file split (mechanical) | ~1 day |
| **P2** | W1 filters/URL state + W2 day/uuid/status list | ~1.5 days |
| **P3** | W3 live mode | ~0.5 day |
| **P4** | W4 map/prospect mode | ~1–1.5 days |
| **P5** | W5 design polish + extras picked from §4 | open |

P1+P2 alone fix every UX pain in the original list except live-follow and the map. Each phase ships independently (webhook deploy = page is server-hosted, no APK rebuild — control page is **not** in the cached app bundle, so no stale-bundle risk).

## 6. Open questions

1. Hour filter: global hour-range across all days (e.g. "only 9h–12h any day") vs per-day — plan assumes **global slider applied within each day section**.
2. Poll cadence 30 s OK? (with 304s the cost is a stat() sweep).
3. Restart detection for loan phones: chip on same-uuid+same-parcours consecutive sessions enough, or hard link ("session 2/3 of this walk") with combined progress?
4. Device naming (§4 named devices): worth a small write-API on devices.json?
5. Should the comparison panel survive as-is, move into prospect mode (compare 2 walks of same prospect parcours), or be dropped?
