---
name: telemetry-analysis
description: >-
  Analyse Flanerie field-test telemetry — a day of GPS-audio-walk session JSON
  files. Use when asked to run a telemetry analysis, review a field test / test
  day, investigate device-specific GPS or audio failures, or look into a specific
  telemetry session. Produces a findings write-up and can feed mobile-audit.md.
---

# Flanerie telemetry analysis

Field telemetry from the FlanerieAudioMap GPS-triggered audio walk. Each visitor
walk emits one JSON session file. This skill turns a day of those files into a
findings report.

## Tools

Two scripts in `telemetry/scripts/` (plain Node ESM, no deps) — see their README:

- `analyze.mjs` — day/fleet report: completion, device re-use, GPS-blackout scan,
  anomaly flags, build versions. `npm run telemetry:analyze -- <opts>`
- `session.mjs` — one-session drill-down: step timeline, GPS gaps, route
  progression, audio-error breakdown. `npm run telemetry:session -- <id>`

The repo's `scripts/telemetry-report.js` (`npm run telemetry:report`) is the older
flat per-session table — still fine for a quick look.

## Data location

Sessions live on the production server, SFTP-mounted in the workspace:
`/run/user/1000/gvfs/sftp:host=flanerie2/srv/customer/sites/flanerie.bloffique-theatre.com/telemetry/`
(the scripts default to this). Filenames are `YYYYMMDD_HHMMSS_xxxx.json`; the time
is **local (UTC+2)**. Files are large — use the scripts, don't cat raw JSON.

## Workflow

1. **Establish scope before counting.** These operational facts are not in the
   files — ask the user if unknown:
   - **Pre-opening cutoff** — sessions before the visitor wave are staff tests.
     Pass `--cutoff=HHMM`. The cutoff varies day to day.
   - **Operator/spare phone** — `SM-A515F` is the house spare; it emits many
     2–30 s re-arm blips. Pass `--operator=SM-A515F` to bucket it out. A *long*
     session on it = the loaner given to a visitor.
   - **Expected visitor count**, if a completion rate is wanted — phones are
     reused/reinited between visitors, so sessions ≠ devices ≠ visitors.

2. **Run the day report:**
   `npm run telemetry:analyze -- --date=YYYYMMDD --cutoff=HHMM --operator=SM-A515F`

3. **Drill into every flagged session** with `session.mjs <id>`. The `analyze`
   anomaly list and GPS-blackout scan tell you which ones.

4. **Write up findings** grouped by platform and severity. Cross-check the audit
   doc (`mobile-audit.md`) for whether a symptom is already a known item.

5. Offer to add a dated findings round to `mobile-audit.md` and a project memory
   (`project_test_findings_YYYYMMDD.md`).

## What to look for

- **GPS background blackout** — multi-minute gaps between `gps` fixes with the
  screen locked. The route freezes then catches up in a `step_skip_done` burst;
  the walker hears silence across several blocks. On iOS the 15 s keepalive
  re-delivers a *stale* fix, so GPS-lost never fires — no warning to the walker.
  Look for `steps-non-contiguous` + gaps in the scan. Discount gaps on a parked
  operator phone (idle, not a walk).
- **Audio errors** are split `jingle` vs `step_voice`. `jingle` (`resume/afterplay/
  youlost/gpslost.mp3`) = placeholder assets not yet produced — harmless. Only
  `step_voice` (`BLOC_*` narration) errors and `step_voice_failed` are real defects.
- **Crashes** — `session_resume` count = mid-walk relaunches. The resume machinery
  usually recovers the walk; a high count still flags an unstable device.
- **OEM battery kill** — `bg_stop_repeated`, `battery_kill_overlay`.
- **Build skew** — `analyze` lists `session_diag` apk/webapp hashes; more than one
  webapp hash means not all walks ran the same code.
- Always separate **iOS vs Android** — failure modes differ sharply.

## Interpreting completion

`analyze.mjs` infers the last step index per parcours from the data. "completed" =
reached it (live or resumed-already-done). A session that resumed at the last step
done and fired nothing = a finished walk left running afterward, not a failure.
