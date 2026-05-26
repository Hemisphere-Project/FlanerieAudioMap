#!/usr/bin/env node
// analyze.mjs — day / fleet-wide telemetry analysis for a field test.
//
// Usage:
//   node telemetry/scripts/analyze.mjs --date=20260520 [options]
//
// Options:
//   --dir=PATH         Telemetry directory (default: SFTP mount, see common.mjs)
//   --date=YYYYMMDD    Only sessions from this date (recommended)
//   --cutoff=HHMM      Sessions started before this LOCAL time are pre-opening team
//                      tests — listed separately and excluded from the main report.
//   --operator=MODEL   deviceModel of the operator/spare phone (e.g. SM-A515F) — its
//                      sessions are bucketed separately, out of the completion tally.
//   --parcours=NAME    Case-insensitive substring filter on parcours name/id
//   --gap=SECONDS      GPS gap threshold for the blackout scan (default 120)
//   --include-loan-only  Keep only sessions where is_loan=true (A5)
//   --exclude-loan       Drop sessions where is_loan=true (A5)
//   --device-uuid=UUID   Only sessions from a specific persistent device id (A5)
//   --json             Emit the raw per-session summaries as JSON instead of a report
//
// Conventions (see telemetry/scripts/README.md):
//   - Filename HHMMSS is local time (UTC+2).
//   - SM-A515F is the operator/spare phone; its many short sessions are re-arm blips.
//   - Phones are reused/reinited between visitors — count sessions, not devices.

import { DEFAULT_DIR, loadSessions, summarize, parseArgs, parseCutoff,
         inferParcoursStepMax, isCompleted, fmtDuration, renderTable } from './common.mjs';

const opts = parseArgs(process.argv.slice(2), { dir: DEFAULT_DIR, gap: '120' });
if (opts.help || opts.h) {
  console.log(readUsage());
  process.exit(0);
}

const gapMs = Number(opts.gap) * 1000;
const cutoff = parseCutoff(opts.cutoff);

let loaded = loadSessions(opts.dir, { date: opts.date });
if (opts.parcours) {
  const needle = String(opts.parcours).toLowerCase();
  loaded = loaded.filter(s =>
    `${s.json.parcoursName || ''} ${s.json.parcoursId || ''}`.toLowerCase().includes(needle));
}
if (!loaded.length) {
  console.log('No telemetry sessions matched the selected filters.');
  process.exit(0);
}

let all = loaded.map(summarize);

// A5 — device identity filters. Apply after summarize() so deviceUuid /
// isLoanDevice are populated. --device-uuid takes a single UUID; pre-A5
// sessions have deviceUuid=null and are silently dropped by the filter.
if (opts['include-loan-only']) all = all.filter(s => s.isLoanDevice === true);
if (opts['exclude-loan'])      all = all.filter(s => s.isLoanDevice !== true);
if (opts['device-uuid'])       all = all.filter(s => s.deviceUuid === opts['device-uuid']);
const stepMax = inferParcoursStepMax(all);

// Split out pre-opening tests and operator/spare-phone sessions from the visitor wave.
const pre = cutoff ? all.filter(s => s.localNum < cutoff) : [];
const afterCutoff = all.filter(s => !pre.includes(s));
const operator = opts.operator ? afterCutoff.filter(s => s.deviceModel === opts.operator) : [];
const main = afterCutoff.filter(s => !operator.includes(s));

if (opts.json) {
  console.log(JSON.stringify({ stepMax, pre, operator, main }, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------

const out = [];
const P = (...s) => out.push(s.join(''));

P(`Telemetry analysis — ${opts.date || 'all dates'}   dir: ${opts.dir}`);
P(`Sessions: ${all.length} total`
  + (pre.length ? `  |  ${pre.length} pre-opening (before ${opts.cutoff})` : '')
  + (operator.length ? `  |  ${operator.length} operator phone (${opts.operator})` : '')
  + `  |  ${main.length} visitor sessions`);
// Parcours config skew: a different parcoursName among the visitor wave usually
// means a stale cached config — list the minority groups' session ids so they
// don't hide. Step counts are inferred from the data (see inferParcoursStepMax).
const parcoursGroups = {};
for (const s of main) (parcoursGroups[s.parcoursKey] ||= []).push(s.shortId);
const parcoursSorted = Object.entries(parcoursGroups).sort((a, b) => b[1].length - a[1].length);
P(`Parcours (visitor sessions): `
  + (parcoursSorted.length
      ? parcoursSorted.map(([k, ids], i) => {
          const steps = (stepMax[k] ?? -1) + 1;
          return (i === 0 || ids.length > 4)
            ? `${k}=${steps} steps (${ids.length})`
            : `${k}=${steps} steps (${ids.length}: ${ids.join(',')})`;
        }).join('  |  ')
      : 'none'));

if (pre.length) {
  P('\n## Pre-opening / test sessions (excluded)');
  P(renderTable(
    ['Start', 'Id', 'Device', 'Dur', 'MaxStep', 'Events'],
    pre.map(s => [s.localClock, s.shortId, s.deviceModel, fmtDuration(s.durationMs),
                  s.maxStep ?? '-', s.eventCount])));
}

if (operator.length) {
  P(`\n## Operator / spare phone sessions — ${opts.operator} (excluded from visitor stats)`);
  P('   Mostly short re-arm blips between handoffs; a long one = the loaner given to a visitor.');
  P(renderTable(
    ['Start', 'Id', 'Dur', 'MaxStep', 'Done?'],
    operator.map(s => [s.localClock, s.shortId, fmtDuration(s.durationMs),
                       s.maxStep ?? '-', isCompleted(s, stepMax) ? 'YES' : 'no'])));
}

// --- per-session table -----------------------------------------------------
P('\n## Sessions');
P(renderTable(
  ['Start', 'Id', 'Device', 'OS', 'Plat', 'Dur', 'Step', 'Done', 'Res', 'Done?', 'GPSgap'],
  main.map(s => [
    s.localClock, s.shortId, s.deviceModel, s.osVersion, s.platform,
    fmtDuration(s.durationMs),
    s.maxStep ?? '-', s.stepsDone.length, s.resumes,
    isCompleted(s, stepMax) ? 'YES' : 'no',
    s.gpsGaps.length ? `${s.gpsGaps.length}x/${Math.round(s.gpsGapMaxMs / 1000)}s` : '-',
  ])));

// --- completion ------------------------------------------------------------
const completed = main.filter(s => isCompleted(s, stepMax));
const aborted = main.filter(s => !isCompleted(s, stepMax) && (s.maxStep ?? -1) <= 0 && s.durationMs < 5 * 60000);
const incomplete = main.filter(s => !isCompleted(s, stepMax) && !aborted.includes(s));
P('\n## Completion');
P(`  completed:  ${completed.length}`);
P(`  incomplete: ${incomplete.length}  [${incomplete.map(s => s.shortId).join(', ')}]`);
P(`  aborted (<=step0, <5min): ${aborted.length}  [${aborted.map(s => s.shortId).join(', ')}]`);

// --- device re-use ---------------------------------------------------------
P('\n## Device re-use  (model -> sessions; * = completed)');
const byModel = {};
for (const s of main) (byModel[s.deviceModel] ||= []).push(s);
for (const [model, ss] of Object.entries(byModel).sort((a, b) => b[1].length - a[1].length)) {
  P(`  ${model.padEnd(14)} x${String(ss.length).padEnd(3)} `
    + `[${ss.map(s => s.localClock.slice(0, 5) + (isCompleted(s, stepMax) ? '*' : '')).join(', ')}]`);
}

// --- GPS gap scan ----------------------------------------------------------
const gapped = main.filter(s => s.gpsGaps.some(g => g.ms >= gapMs));
P(`\n## GPS background-blackout scan  (gaps >= ${opts.gap}s)`);
if (!gapped.length) P('  none — all sessions had continuous GPS.');
for (const s of gapped.sort((a, b) => b.gpsGapMaxMs - a.gpsGapMaxMs)) {
  const big = s.gpsGaps.filter(g => g.ms >= gapMs);
  P(`  ${s.shortId} ${s.deviceModel.padEnd(13)} ${(s.platform + s.osVersion).padEnd(14)} `
    + `${big.length} gap(s), max ${Math.round(s.gpsGapMaxMs / 1000)}s, `
    + `${Math.round(s.gpsGapTotalMs / 60000)}min total frozen  (${s.gpsFixCount} fixes)`);
}

// --- anomaly flags ---------------------------------------------------------
P('\n## Anomaly flags');
let anyFlag = false;
for (const s of main) {
  const f = [];
  if (s.audioErrByKind.step_voice) {
    const sp = [s.audioErrByType.playerror && `${s.audioErrByType.playerror} play`,
                s.audioErrByType.loaderror && `${s.audioErrByType.loaderror} load`]
               .filter(Boolean).join('/');
    f.push(`stepVoiceErr=${s.audioErrByKind.step_voice}${sp ? ` (${sp})` : ''}`);
  }
  if (s.voiceFail) f.push(`voiceFail=${s.voiceFail}`);
  if (s.audioTimeout) f.push(`audioTimeout=${s.audioTimeout}`);
  if (s.audioStuck) f.push(`audioStuck=${s.audioStuck}`);
  if (s.userLost) f.push(`lost=${s.userLost}/rec=${s.userRecovered}`);
  if (s.gpsRevoked) f.push(`gpsRevoked=${s.gpsRevoked}`);
  if (s.bgStopRepeated) f.push(`bgStopRepeated=${s.bgStopRepeated}`);
  if (s.batteryKill) f.push(`batteryKill=${s.batteryKill}`);
  if (s.iosNativeFallback) f.push(`iosNativeFallback=${s.iosNativeFallback}`);
  if (s.checkaudioFail) f.push(`checkaudioFail=${s.checkaudioFail}`);
  if (s.resumes >= 1) f.push(`resumes=${s.resumes}`);
  if (s.stepResumeCurrent >= 2) f.push(`stepResumeCurrent=${s.stepResumeCurrent}`);
  if (s.staleSeekPos) f.push('stale-seek-pos');
  if (s.audiofocusRequestFail >= 100) f.push(`audiofocusFail=${s.audiofocusRequestFail}`);
  if (s.maxStep != null && !s.stepsContiguous) f.push('steps-non-contiguous');
  if (f.length) { anyFlag = true; P(`  ${s.shortId} ${s.deviceModel.padEnd(13)} ${f.join('  ')}`); }
}
if (!anyFlag) P('  none.');

// --- afterplay / recovery map ----------------------------------------------
const apfbTotal = main.reduce((n, s) => n + s.afterplayFallback, 0);
const apfbNoSrc = main.reduce((n, s) => n + s.afterplayFallbackNoSrc, 0);
const mapSrc = {};
for (const s of main) for (const src of s.mapOpened) mapSrc[src] = (mapSrc[src] || 0) + 1;
P('\n## Afterplay fallback & map');
P(`  step_afterplay_fallback: ${apfbTotal}  (no_src=${apfbNoSrc}, loaderror=${apfbTotal - apfbNoSrc})`);
P(`  map_opened by source: ${JSON.stringify(mapSrc)}`);

// --- audiofocus ------------------------------------------------------------
const afFail = main.reduce((n, s) => n + s.audiofocusRequestFail, 0);
const afFailIos = main.filter(s => s.platform === 'iOS').reduce((n, s) => n + s.audiofocusRequestFail, 0);
P('\n## Audio focus');
P(`  audiofocus_request_fail total: ${afFail}  (iOS ${afFailIos} / Android ${afFail - afFailIos})`);

// --- build / version -------------------------------------------------------
P('\n## Build / webapp version  (from session_diag)');
const builds = {};
for (const s of main) {
  if (!s.diag) continue;
  const key = `apk=${s.diag.apk_version} webapp=${String(s.diag.webapp_hash || '').slice(0, 8)}`;
  (builds[key] ||= []).push(s.shortId);
}
for (const [key, ids] of Object.entries(builds)) P(`  ${key}  x${ids.length}`);

console.log(out.join('\n'));

function readUsage() {
  return [
    'analyze.mjs — day / fleet-wide Flanerie telemetry analysis',
    '',
    'Usage: node telemetry/scripts/analyze.mjs --date=YYYYMMDD [--cutoff=HHMM]',
    '       [--dir=PATH] [--parcours=NAME] [--gap=SECONDS] [--json]',
  ].join('\n');
}
