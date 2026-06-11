#!/usr/bin/env node
// session.mjs — deep drill-down on a single telemetry session.
//
// Usage:
//   node telemetry/scripts/session.mjs <session-id-fragment> [options]
//
// Examples:
//   node telemetry/scripts/session.mjs 51nv
//   node telemetry/scripts/session.mjs 20260520_091844_51nv --gap=60
//
// Options:
//   --dir=PATH      Telemetry directory (default: SFTP mount, see common.mjs)
//   --gap=SECONDS   GPS gap threshold to report (default 90)
//   --types         Also print the full event-type histogram
//
// Prints: completion, step timeline, GPS gaps, route progression, audio-error
// breakdown (jingle placeholders vs real step narration), and resume history —
// the signals needed to tell a GPS blackout from an audio failure from a crash.

import fs from 'fs';
import path from 'path';
import { DEFAULT_DIR, parseFileName, parseArgs, classifyAudioSrc,
         gpsGaps, summarize, fmtDuration } from './common.mjs';

const opts = parseArgs(process.argv.slice(2), { dir: DEFAULT_DIR, gap: '90' });
const fragment = opts._[0];
if (!fragment || opts.help || opts.h) {
  console.log('Usage: node telemetry/scripts/session.mjs <session-id-fragment> [--dir=] [--gap=SECONDS] [--types]');
  process.exit(fragment ? 0 : 1);
}

const matches = fs.readdirSync(opts.dir)
  .filter(f => parseFileName(f) && f.includes(fragment));
if (!matches.length) {
  console.error(`No session file matches "${fragment}" in ${opts.dir}`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`"${fragment}" matches ${matches.length} files — be more specific:`);
  for (const f of matches) console.error('  ' + f);
  process.exit(1);
}

const file = matches[0];
const json = JSON.parse(fs.readFileSync(path.join(opts.dir, file), 'utf8'));
const s = summarize({ file, meta: parseFileName(file), json });
const ev = json.events || [];
const t0 = ev.length ? ev[0].t : 0;
const min = t => `${((t - t0) / 60000).toFixed(1)}min`;

// --- header ----------------------------------------------------------------
console.log(`# ${file}`);
console.log(`  session    ${json.sessionId}`);
console.log(`  parcours   ${json.parcoursName || '?'}  (${json.parcoursId || '?'})`);
console.log(`  device     ${s.deviceModel}  ${s.manufacturer}  ${s.platform} ${s.osVersion}`);
console.log(`  started    ${json.startTime}   (file local ${s.localClock})`);
console.log(`  duration   ${fmtDuration(s.durationMs)}   events: ${s.eventCount}`);
if (s.diag) {
  const pv = s.diag.plugin_versions || {};
  const bggeo = pv['cordova-background-geolocation-plugin'];
  console.log(`  build      apk=${s.diag.apk_version}  commit=${s.diag.webapp_commit || '?'}  webapp=${String(s.diag.webapp_hash || '').slice(0, 12)}  devmode=${s.diag.devmode}`);
  if (bggeo || Object.keys(pv).length) {
    console.log(`  plugins    bg-geo=${bggeo || '?'}` + (Object.keys(pv).length ? `   (${Object.keys(pv).length} total: ${Object.entries(pv).map(([k, v]) => k.replace(/^cordova-(plugin-)?/, '') + '@' + v).join(', ')})` : ''));
  }
}
if (s.powerState) console.log(`  power      ${JSON.stringify(s.powerState)}`);

// --- onboarding ------------------------------------------------------------
// Permission-gauntlet flow (geo / motion / notifications / battery). Captured in
// its own 'onb:<pID>' session so the iOS Motion-auth hang — which blocks before
// the walk session would ever open — is observable. parcoursId 'onb:' prefix marks
// an onboarding-only session.
const onbTypes = new Set([
  'onboarding_page', 'media_startup_check', 'parcours_freshness_check',
  'gps_hardware_prewarm_ok', 'gps_hardware_prewarm_failed', 'ios_version_warning',
  'ios_always_gate', 'confirmgeo_settings_tapped', 'confirmgeo_settings_returned',
  'bg_location', 'motion_prompt_early', 'motion_prompt', 'motion_authorized',
  'motion_check', 'notif_permission',
  'background_restricted', 'power_save_mode', 'battery_opt',
]);
const onbEvents = ev.filter(e => onbTypes.has(e.type));
const isOnboardingSession = String(json.parcoursId || '').indexOf('onb:') === 0;
if (onbEvents.length) {
  console.log(`\n## Onboarding flow${isOnboardingSession ? '   <- ONBOARDING SESSION (permission gauntlet; the walk is a separate session)' : ''}`);
  for (const e of onbEvents) {
    const d = e.data || {};
    let extra = '';
    if (e.type === 'onboarding_page')             extra = `page=${d.page}${d.retry_auth ? ' retryAuth=' + d.retry_auth : ''}${d.os_version ? ' iOS=' + d.os_version : ''}${d.apk_version ? ' apk=' + d.apk_version : ''}${d.webapp_commit ? ' commit=' + d.webapp_commit : ''}`;
    else if (e.type === 'motion_prompt_early')    extra = `trigger=${d.trigger}  <- EARLY motion prompt (clean pre-round-trip context)`;
    else if (e.type === 'motion_authorized')      extra = `type=${d.type}  <- MOTION GRANTED`;
    else if (e.type === 'motion_prompt')          extra = `attempt=${d.attempt} elapsed=${d.elapsed_ms}ms visible=${d.visible}`
                                                          + (d.auth_status != null ? ` auth=${['NotDet','Restr','DENIED','Authorized'][d.auth_status] ?? d.auth_status}` : '')
                                                          + (d.app_state != null ? ` app=${['active','inactive','bg'][d.app_state] ?? d.app_state}` : '')
                                                          + (d.location_started === false ? ' locStarted=NO' : '')
                                                          + (d.activity_available === false ? '  <- MOTION HW UNAVAILABLE (simulator / no coprocessor)' : '');
    else if (e.type === 'motion_check')           extra = `granted=${d.granted}${d.resumed ? ' (resumed)' : ''}${d.reason ? ' reason=' + d.reason : ''} waited=${d.waited_ms}ms`;
    else if (e.type === 'media_startup_check')    extra = `ok=${d.ok} missing=${d.missing} online=${d.online}${d.missing_files && d.missing_files.length ? ' [' + d.missing_files.join(',') + ']' : ''}`;
    else if (e.type === 'ios_always_gate')        extra = `reason=${d.reason}`;
    else if (e.type === 'bg_location')            extra = `granted=${d.granted}${d.attempts != null ? ' attempts=' + d.attempts : ''}`;
    else if (e.type === 'notif_permission')       extra = `granted=${d.granted}${d.reason ? ' reason=' + d.reason : ''}`;
    else if (e.type === 'battery_opt')            extra = JSON.stringify(d);
    else                                          extra = JSON.stringify(d);
    console.log(`  ${min(e.t).padStart(8)}  ${e.type.padEnd(28)} ${extra}`);
  }
}

// --- completion ------------------------------------------------------------
console.log('\n## Completion');
console.log(`  steps fired:  [${s.stepsFired.join(', ')}]${s.stepsContiguous ? '' : '   <- NON-CONTIGUOUS (steps skipped)'}`);
console.log(`  steps done:   [${s.stepsDone.join(', ')}]`);
console.log(`  max step:     ${s.maxStep ?? '-'}`);
if (s.resumeStepIndex != null) {
  console.log(`  resumed at:   step ${s.resumeStepIndex} (done=${s.resumeStepDone})  <- this session began as a resume`);
}

// --- step timeline ---------------------------------------------------------
const stepTypes = new Set(['step_fire', 'step_done', 'step_skip_done',
  'step_refire_current', 'step_resume_current', 'session_resume', 'session_restart']);
console.log('\n## Step / resume timeline');
const num = (v, p) => typeof v === 'number' ? v.toFixed(p) : '?';
for (const e of ev) {
  if (!stepTypes.has(e.type)) continue;
  const d = e.data || {};
  const step = d.step;
  let extra = '';
  if (e.type === 'step_resume_current') {
    // distanceToBorder near 0 (negative = inside the next zone) is the GPS
    // zone-overshoot signature — premature step advance (report P6a).
    extra = `  border=${num(d.distanceToBorder, 2)}m  vis=${d.visibility || '?'}  load=${d.player_load_state || '?'}`;
  } else if (e.type === 'session_resume') {
    extra = `  resume_step=${d.resume_step_index ?? '?'}  seek=${num(d.resume_seek_pos, 1)}s  done=${d.resume_step_done}`;
  } else if (d.reason) {
    extra = `  reason=${d.reason}`;
  }
  console.log(`  ${min(e.t).padStart(8)}  ${e.type.padEnd(20)} ${(step != null ? 'step ' + step : '').padEnd(8)}${extra}`);
}

// --- GPS gaps + route progression ------------------------------------------
const { fixCount, gaps } = gpsGaps(ev, Number(opts.gap) * 1000);
console.log(`\n## GPS  (${fixCount} fixes, ${gaps.length} gap(s) >= ${opts.gap}s)`);
for (const g of gaps) {
  console.log(`  GAP ${String(Math.round(g.ms / 1000)).padStart(5)}s   ${min(g.fromT)} -> ${min(g.toT)}`);
}
console.log(`  state transitions: acquiring=${s.gpsAcquiringTransitions} frozen=${s.gpsFrozenTransitions} lost=${s.gpsLost} recovered=${s.gpsRecovered}`);
console.log(`  delivery mix: real=${s.gpsRealSamples} keepalive=${s.gpsKeepaliveSamples} heartbeat=${s.gpsHeartbeatSamples}`
  + (s.keepaliveOnlySession ? '   <- KEEPALIVE-ONLY SESSION' : '')
  + (s.activeFixOnlySession ? '   <- ACTIVE-FIX-ONLY SESSION' : ''));
console.log(`  freshness max: real=${fmtAge(s.maxRealCallbackAgeMs)} any=${fmtAge(s.maxAnyCallbackAgeMs)} masked=${s.maskedFreshnessSamples}`);
console.log(`  startup gate: fixes=${s.gpsStartupFix} ready=${s.gpsStartupReady} rejected=${s.gpsStartupRejected}`);
console.log(`  rail/visit: configured=${s.gpsRailConfigured} wake=${s.gpsRailWake} monitorFail=${s.gpsRailMonitorFail} visit=${s.gpsVisitEvent}`);
console.log(`  native snapshots: clState=${s.clStateSamples} iosStreamHealth=${s.iosStreamHealthSamples}`);
if (Object.keys(s.gpsStateReasons).length) {
  console.log(`  gps_state reasons: ${JSON.stringify(s.gpsStateReasons)}`);
}
console.log('  route progression (route_probe currentStep changes):');
let last = null;
for (const e of ev) {
  if (e.type !== 'route_probe' || !e.data) continue;
  if (e.data.currentStep !== last) {
    console.log(`    step ${e.data.currentStep}  @${min(e.t)}`);
    last = e.data.currentStep;
  }
}

// --- audio errors ----------------------------------------------------------
const audioErr = ev.filter(e => e.type === 'audio_playerror' || e.type === 'audio_loaderror');
const playErrN = audioErr.filter(e => e.type === 'audio_playerror').length;
const loadErrN = audioErr.filter(e => e.type === 'audio_loaderror').length;
console.log(`\n## Audio errors  (${audioErr.length}: ${playErrN} playerror, ${loadErrN} loaderror)`);
console.log(`  by kind: jingle=${s.audioErrByKind.jingle} (placeholder assets, harmless)  `
  + `step_voice=${s.audioErrByKind.step_voice} (REAL narration failures)  other=${s.audioErrByKind.other}`);
const realErrSrcs = {};
for (const e of audioErr) {
  if (classifyAudioSrc(e.data && e.data.src) !== 'step_voice') continue;
  const name = String(e.data.src).split('/').pop();
  realErrSrcs[name] = (realErrSrcs[name] || 0) + 1;
}
for (const [name, n] of Object.entries(realErrSrcs)) console.log(`    x${n}  ${name}`);
const voiceFail = ev.filter(e => e.type === 'step_voice_failed');
if (voiceFail.length) {
  console.log('  step_voice_failed:');
  for (const e of voiceFail) {
    console.log(`    step ${e.data && e.data.step}  reason=${e.data && e.data.reason}  ${String((e.data && e.data.src) || '').split('/').pop()}`);
  }
}

// --- summary flags ---------------------------------------------------------
console.log('\n## Other signals');
console.log(`  resumes=${s.resumes}  restarts=${s.restarts}  stepResumeCurrent=${s.stepResumeCurrent}  `
  + `audioTimeout=${s.audioTimeout}  audioStuck=${s.audioStuck}`
  + (s.staleSeekPos ? '\n  <- STALE SEEK-POS: same resume seek-pos restored at >1 step (report P8)' : ''));
console.log(`  afterplayFallback=${s.afterplayFallback} (no_src=${s.afterplayFallbackNoSrc})  `
  + `userLost=${s.userLost}/rec=${s.userRecovered}`);
console.log(`  audiofocus: requestFail=${s.audiofocusRequestFail} requestOk=${s.audiofocusRequestOk} loss=${s.audiofocusLoss}`);
console.log(`  map_opened sources: ${JSON.stringify(countBy(s.mapOpened))}`);
console.log(`  gps: triggerRejected=${s.gpsTriggerRejected} stale=${s.gpsStale} `
  + `sleepSuspect=${s.gpsSleepSuspect} revoked=${s.gpsRevoked} frozen=${s.gpsFrozen} degraded=${s.gpsDegraded}/rec=${s.gpsDegradedRecovered}  avgAcc=${s.gpsAvgAcc ? s.gpsAvgAcc.toFixed(1) : '-'}`);

if (opts.types) {
  console.log('\n## Event-type histogram');
  for (const [t, n] of Object.entries(s.types).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(30)} ${n}`);
  }
}

function countBy(arr) {
  const o = {};
  for (const x of arr) o[x] = (o[x] || 0) + 1;
  return o;
}

function fmtAge(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  return `${Math.round(ms / 1000)}s`;
}
