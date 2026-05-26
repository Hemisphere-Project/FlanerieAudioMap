# Telemetry analysis scripts

Reusable tools for analysing a Flanerie field-test day from the telemetry session
JSON files. Plain Node ESM, no dependencies.

| Script | Purpose |
|---|---|
| `analyze.mjs` | Day / fleet-wide report — completion, device re-use, GPS-blackout scan, anomaly flags, build versions. |
| `session.mjs` | Deep drill-down on one session — step timeline, GPS gaps, route progression, audio-error breakdown. |
| `common.mjs` | Shared helpers (session loading, summary metrics, GPS-gap detection). Not run directly. |

The repo's existing `scripts/telemetry-report.js` (`npm run telemetry:report`) prints a
flat per-session table; these scripts add the day-level synthesis and per-session
drill-down used for field-test write-ups in `mobile-audit.md`.

## Where the data is

Telemetry session files live on the production server, SFTP-mounted in the VSCode
workspace (see `FlanerieAudioMap.code-workspace`):

```
/run/user/1000/gvfs/sftp:host=flanerie2/srv/customer/sites/flanerie.bloffique-theatre.com/telemetry/
```

That is the default. Override with `--dir=PATH` or the `FLANERIE_TELEMETRY_DIR` env var.
Files in `telemetry/*.json` are git-ignored — only these scripts are tracked.

## Usage

```sh
# Whole field day, with pre-opening tests and the spare phone bucketed out:
node telemetry/scripts/analyze.mjs --date=20260520 --cutoff=0900 --operator=SM-A515F
npm run telemetry:analyze -- --date=20260520 --cutoff=0900 --operator=SM-A515F

# Drill into one session (id fragment is enough):
node telemetry/scripts/session.mjs 51nv
npm run telemetry:session -- 51nv --types
```

### `analyze.mjs` options

| Option | Meaning |
|---|---|
| `--date=YYYYMMDD` | Only this date (recommended — the directory holds every day). |
| `--cutoff=HHMM` | Sessions started before this **local** time are pre-opening team tests; listed separately, excluded from visitor stats. |
| `--operator=MODEL` | `deviceModel` of the operator/spare phone; its sessions are bucketed out of the visitor tally. |
| `--parcours=NAME` | Substring filter on parcours name/id. |
| `--gap=SECONDS` | GPS-gap threshold for the blackout scan (default 120). |
| `--json` | Emit raw per-session summaries instead of the text report. |

### `session.mjs` options

| Option | Meaning |
|---|---|
| `--gap=SECONDS` | GPS-gap threshold to list (default 90). |
| `--types` | Also print the full event-type histogram. |
| `--dir=PATH` | Telemetry directory. |

## Field-day conventions (important for correct counts)

These are operational facts, not derivable from the files alone:

- **Filename `HHMMSS` is local time (UTC+2)**, matching the file mtime; the JSON
  `startTime` is UTC. `--cutoff` compares against the local filename time.
- **Pre-opening sessions are team tests.** Before each field day's visitor wave the
  staff test devices — discard them. The cutoff varies; confirm with the team.
- **`SM-A515F` is the operator/spare phone.** It produces many 2–30 s re-arm blips
  between handoffs. Pass `--operator=SM-A515F` so they don't pollute completion stats.
  A *long* SM-A515F session = the loaner handed to a visitor without a working phone.
- **Phones are reused/reinited between visitors** — the same `deviceModel` across
  several sessions is usually different people. Count sessions, not devices.
- A session that opens with `parcours_restore {stepDone:true}` at the last step and
  fires no new step = a completed walk whose phone was left running afterward.

## Reading the output

- **GPS background-blackout scan** — multi-minute gaps between GPS fixes with the
  screen locked. On iOS the 15 s keepalive re-delivers a *stale* fix, so GPS-lost
  never fires: the route silently freezes and catches up in a `step_skip_done` burst.
  (A long gap on a parked operator phone is just an idle phone — ignore those.)
- **Audio errors** are split `jingle` vs `step_voice`. `jingle` = `resume/afterplay/
  youlost/gpslost.mp3` placeholder assets not yet produced — harmless. `step_voice` =
  real `BLOC_*` narration failing to play — a genuine defect. The `step_voice` count
  is further split `(N play/N load)`: `loaderror` (file missing/unreadable) and
  `playerror` (decode/playback failure) have different root causes.
- **`steps-non-contiguous`** flag — the walker's fired steps skip indices, the
  signature of a GPS blackout (route jumped) rather than a clean walk.
- **`resumes` / `stepResumeCurrent` / `stale-seek-pos` flags** — `resumes>=1` = the
  app was relaunched mid-walk (a crash); `stepResumeCurrent>=2` = repeated audio
  re-resume, often GPS zone overshoot; `stale-seek-pos` = a crash restored the same
  seek position at two different steps. Drill these with `session.mjs`.
- **Completion** is inferred: a session "completed" if it reached the last step index
  any session of that parcours fired (no parcours JSON needed).
