// common.mjs — shared helpers for Flanerie field-telemetry analysis.
//
// Telemetry session files are JSON, schemaVersion 2:
//   { sessionId, parcoursId, parcoursName, client{...}, startTime, events[{t,type,data}] }
// Filename pattern: YYYYMMDD_HHMMSS_<4char>.json — the HHMMSS is LOCAL time (UTC+2),
// matching the file mtime; the JSON `startTime` field is UTC.
//
// Used by analyze.mjs (day/fleet report) and session.mjs (single-session drill-down).

import fs from 'fs';
import path from 'path';

// Default telemetry location: production server, SFTP-mounted in the VSCode workspace.
// Override with --dir=PATH or the FLANERIE_TELEMETRY_DIR env var.
export const DEFAULT_DIR = process.env.FLANERIE_TELEMETRY_DIR
  || '/run/user/1000/gvfs/sftp:host=flanerie2/srv/customer/sites/flanerie.bloffique-theatre.com/telemetry';

// --- formatting ------------------------------------------------------------

export function fmtDuration(ms) {
  if (!ms || ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(ss).padStart(2, '0')}s`;
  return `${m}m${String(ss).padStart(2, '0')}s`;
}

export function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Render an array of equal-length rows as an aligned text table.
export function renderTable(headers, rows) {
  const body = rows.map(r => r.map(c => (c == null ? '-' : String(c))));
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = cells => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [
    line(headers),
    widths.map(w => '-'.repeat(w)).join('  '),
    ...body.map(line),
  ].join('\n');
}

// --- file parsing ----------------------------------------------------------

// Parse a telemetry filename. Returns null for anything that doesn't match.
export function parseFileName(file) {
  const m = file.match(/^(\d{8})_(\d{6})_([A-Za-z0-9]{4})\.json$/);
  if (!m) return null;
  return {
    date: m[1],                                              // YYYYMMDD
    hhmmss: m[2],                                            // local HHMMSS
    shortId: m[3],                                           // 4-char session suffix
    localNum: Number(m[2]),                                  // for cutoff comparison
    localClock: `${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}`,
  };
}

// Normalise a --cutoff value (HHMM or HHMMSS) to a 6-digit HHMMSS number.
export function parseCutoff(value) {
  if (!value) return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length === 4) return Number(digits) * 100;     // HHMM -> HHMMSS
  if (digits.length === 6) return Number(digits);
  return null;
}

// Load every YYYYMMDD_*.json in `dir`, optionally filtered to one date (YYYYMMDD or YYYY-MM-DD).
// Returns [{ file, meta, json }] sorted by filename (chronological).
export function loadSessions(dir, { date = null } = {}) {
  if (!fs.existsSync(dir)) throw new Error(`Telemetry directory not found: ${dir}`);
  const wantDate = date ? String(date).replace(/-/g, '') : null;
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const meta = parseFileName(file);
    if (!meta) continue;
    if (wantDate && meta.date !== wantDate) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      console.error(`! skipped (parse error): ${file} — ${e.message}`);
      continue;
    }
    out.push({ file, meta, json });
  }
  return out;
}

// --- event helpers ---------------------------------------------------------

// Classify an audio src so jingle non-bugs (resume/afterplay/youlost/gpslost placeholders,
// not yet produced) are not confused with real step-narration playback failures.
export function classifyAudioSrc(src = '') {
  const name = String(src).split('/').pop() || '';
  if (/(resume|afterplay|youlost|gpslost|flanerie|silence)\.mp3$/i.test(name)) return 'jingle';
  if (/BLOC_|GIVORS|VOIX|VOICE/i.test(name)) return 'step_voice';
  return 'other';
}

// Consecutive gps-fix gaps longer than thresholdMs. A long gap with the screen locked
// is the iOS/Android background-GPS blackout signature (route freezes, then catches up).
export function gpsGaps(events, thresholdMs = 120000) {
  const gps = events.filter(e => e.type === 'gps' && e.data && typeof e.data.lat === 'number');
  const gaps = [];
  let prev = null;
  for (const e of gps) {
    if (prev != null && e.t - prev > thresholdMs) gaps.push({ ms: e.t - prev, fromT: prev, toT: e.t });
    prev = e.t;
  }
  return { fixCount: gps.length, gaps };
}

// --- per-session summary ---------------------------------------------------

// Reduce one loaded session ({file, meta, json}) to a flat metrics object.
export function summarize(session) {
  const j = session.json;
  const ev = Array.isArray(j.events) ? j.events : [];
  const c = j.client || {};
  const types = {};
  for (const e of ev) types[e.type] = (types[e.type] || 0) + 1;

  const t0 = ev.length ? ev[0].t : (j.startTime ? Date.parse(j.startTime) : null);
  const tN = ev.length ? ev[ev.length - 1].t : t0;

  const stepsFired = [...new Set(ev.filter(e => e.type === 'step_fire')
    .map(e => e.data && e.data.step).filter(Number.isInteger))].sort((a, b) => a - b);
  const stepsDone = [...new Set(ev.filter(e => e.type === 'step_done')
    .map(e => e.data && e.data.step).filter(Number.isInteger))].sort((a, b) => a - b);

  const ss = ev.find(e => e.type === 'session_start');
  const resumeStepIndex = ss && ss.data && Number.isInteger(ss.data.resume_step_index)
    ? ss.data.resume_step_index : null;
  const resumeStepDone = !!(ss && ss.data && ss.data.resume_step_done);

  const apfb = ev.filter(e => e.type === 'step_afterplay_fallback');
  const audioErrEvents = ev.filter(e => e.type === 'audio_playerror' || e.type === 'audio_loaderror');
  const audioErrByKind = { jingle: 0, step_voice: 0, other: 0 };
  for (const e of audioErrEvents) audioErrByKind[classifyAudioSrc(e.data && e.data.src)]++;

  const { fixCount, gaps } = gpsGaps(ev);
  const gpsEvents = ev.filter(e => e.type === 'gps' && e.data && typeof e.data.lat === 'number');
  const gpsAcc = gpsEvents.filter(e => typeof e.data.acc === 'number').map(e => e.data.acc);
  const gpsSources = gpsEvents.map(e => (e.data && e.data.source) || 'unknown');
  const gpsKeepaliveSamples = gpsSources.filter(s => s === 'keepalive').length;
  const gpsHeartbeatSamples = gpsSources.filter(s => s === 'heartbeat').length;
  const gpsRealSamples = gpsSources.filter(s => s !== 'keepalive' && s !== 'heartbeat').length;
  const keepaliveOnlySession = gpsEvents.length > 0 && gpsKeepaliveSamples > 0 && gpsRealSamples === 0 && gpsHeartbeatSamples === 0;
  const activeFixOnlySession = gpsEvents.length > 0 && gpsHeartbeatSamples > 0 && gpsRealSamples === 0 && gpsKeepaliveSamples === 0;
  const gpsStateEvents = ev.filter(e => e.type === 'gps_state' && e.data);
  const gpsStateReasons = gpsStateEvents.reduce((acc, e) => {
    const reason = e.data && e.data.reason;
    if (reason) acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const freshnessEvents = ev.filter(e => e.type === 'real_callback_freshness' && e.data);
  const realCallbackAges = freshnessEvents.map(e => e.data.real_age_ms).filter(v => typeof v === 'number');
  const anyCallbackAges = freshnessEvents.map(e => e.data.any_age_ms).filter(v => typeof v === 'number');
  const maxRealCallbackAgeMs = realCallbackAges.length ? Math.max(...realCallbackAges) : null;
  const maxAnyCallbackAgeMs = anyCallbackAges.length ? Math.max(...anyCallbackAges) : null;
  const maskedFreshnessSamples = freshnessEvents.filter(e => {
    const d = e.data || {};
    return typeof d.real_age_ms === 'number' && typeof d.any_age_ms === 'number'
      && d.real_age_ms >= 30000 && d.any_age_ms < 30000;
  }).length;

  // Resume positions from session_resume events — the step and seek-pos a crash
  // recovery restored to. Used to detect the stale seek-pos bug (report P8).
  const resumePositions = ev.filter(e => e.type === 'session_resume' && e.data)
    .map(e => ({
      step: Number.isInteger(e.data.resume_step_index) ? e.data.resume_step_index : null,
      seekPos: typeof e.data.resume_seek_pos === 'number' ? e.data.resume_seek_pos : null,
      done: !!e.data.resume_step_done,
    }));
  // Stale seek-pos: the same resume_seek_pos restored at two *different* steps means
  // the resume position is not cleared on step change — a crash mid-walk then jumps
  // narration into an unrelated step's audio.
  const seekByStep = new Map();
  for (const p of resumePositions) {
    if (p.seekPos == null || p.step == null) continue;
    const key = Math.round(p.seekPos * 10) / 10;
    if (!seekByStep.has(key)) seekByStep.set(key, new Set());
    seekByStep.get(key).add(p.step);
  }
  const staleSeekPos = [...seekByStep.values()].some(steps => steps.size >= 2);

  // step_voice audio errors split by event type: loaderror = the file failed to
  // load (missing / unreadable / bad container); playerror = decode/playback failure.
  const audioErrByType = { playerror: 0, loaderror: 0 };
  for (const e of audioErrEvents) {
    if (classifyAudioSrc(e.data && e.data.src) !== 'step_voice') continue;
    if (e.type === 'audio_loaderror') audioErrByType.loaderror++;
    else audioErrByType.playerror++;
  }

  return {
    file: session.file,
    shortId: session.meta.shortId,
    date: session.meta.date,
    localClock: session.meta.localClock,
    localNum: session.meta.localNum,
    sessionId: j.sessionId,
    parcoursId: j.parcoursId,
    parcoursName: j.parcoursName,
    parcoursKey: j.parcoursName || j.parcoursId || '?',
    platform: c.devicePlatform || '?',
    osVersion: c.osVersion || '?',
    deviceModel: c.deviceModel || '?',
    manufacturer: c.deviceManufacturer || '?',
    // A5 — persistent identity. Prefer client.deviceUuid (every payload),
    // fall back to session_diag.device_uuid for sessions where the client
    // bundle predates A5 but session_diag was logged after a hot-reload.
    deviceUuid: c.deviceUuid
      || ((ev.find(e => e.type === 'session_diag') || {}).data || {}).device_uuid
      || null,
    isLoanDevice: typeof c.isLoanDevice === 'boolean' ? c.isLoanDevice
      : !!((ev.find(e => e.type === 'session_diag') || {}).data || {}).is_loan,
    startTime: j.startTime,
    durationMs: t0 && tN ? Math.max(0, tN - t0) : 0,
    eventCount: ev.length,

    stepsFired,
    stepsDone,
    maxStep: stepsFired.length ? stepsFired[stepsFired.length - 1] : null,
    stepsContiguous: stepsFired.length
      ? stepsFired.every((s, i) => i === 0 || s === stepsFired[i - 1] + 1) : true,
    resumeStepIndex,
    resumeStepDone,

    resumes: types['session_resume'] || 0,
    restarts: (types['session_restart'] || 0) + (types['session_restart_click'] || 0),
    stepResumeCurrent: types['step_resume_current'] || 0,
    resumePositions,
    staleSeekPos,

    audioErr: audioErrEvents.length,
    audioErrByKind,
    audioErrByType,
    audioTimeout: types['audio_play_timeout'] || 0,
    audioStuck: types['audio_play_stuck'] || 0,
    voiceFail: types['step_voice_failed'] || 0,
    afterplayFallback: apfb.length,
    afterplayFallbackNoSrc: apfb.filter(e => e.data && e.data.reason === 'no_src').length,
    afterplayFallbackLoadErr: apfb.filter(e => e.data && e.data.reason === 'loaderror').length,

    userLost: types['user_lost'] || 0,
    userRecovered: types['user_recovered'] || 0,

    gpsFixCount: fixCount,
    gpsGaps: gaps,
    gpsGapMaxMs: gaps.length ? Math.max(...gaps.map(g => g.ms)) : 0,
    gpsGapTotalMs: gaps.reduce((s, g) => s + g.ms, 0),
    gpsAvgAcc: average(gpsAcc),
    gpsLost: types['gps_lost'] || 0,
    gpsFrozen: types['gps_frozen'] || 0,
    gpsAcquiring: types['gps_acquiring'] || 0,
    gpsRecovered: types['gps_recovered'] || 0,
    gpsRevoked: types['gps_revoked'] || 0,
    gpsTriggerRejected: types['gps_trigger_rejected'] || 0,
    gpsStale: types['gps_stale_callback'] || 0,
    gpsSleepSuspect: types['gps_sleep_suspect'] || 0,
    gpsStartupFix: types['gps_startup_fix'] || 0,
    gpsStartupReady: types['gps_startup_ready'] || 0,
    gpsStartupRejected: types['gps_startup_rejected'] || 0,
    gpsRailConfigured: types['gps_rail_configured'] || 0,
    gpsRailWake: types['gps_rail_wake'] || 0,
    gpsRailMonitorFail: types['gps_rail_monitor_fail'] || 0,
    gpsVisitEvent: types['gps_visit_event'] || 0,
    gpsKeepaliveSamples,
    gpsHeartbeatSamples,
    gpsRealSamples,
    keepaliveOnlySession,
    activeFixOnlySession,
    gpsFrozenTransitions: gpsStateEvents.filter(e => e.data && e.data.state === 'frozen').length,
    gpsAcquiringTransitions: gpsStateEvents.filter(e => e.data && e.data.state === 'acquiring').length,
    gpsStateReasons,
    maxRealCallbackAgeMs,
    maxAnyCallbackAgeMs,
    maskedFreshnessSamples,
    clStateSamples: types['cl_state'] || 0,
    iosStreamHealthSamples: types['ios_stream_health'] || 0,

    bgStopRepeated: types['bg_stop_repeated'] || 0,
    batteryKill: types['battery_kill_overlay'] || 0,
    audiofocusRequestFail: types['audiofocus_request_fail'] || 0,
    audiofocusRequestOk: types['audiofocus_request_ok'] || 0,
    audiofocusLoss: types['audiofocus_loss'] || 0,
    audiofocusRetry: types['audiofocus_auto_retry'] || 0,
    iosNativeFallback: types['ios_native_fallback'] || 0,
    checkaudioFail: types['checkaudio_fail'] || 0,

    mapOpened: ev.filter(e => e.type === 'map_opened').map(e => (e.data && e.data.source) || '?'),
    diag: (ev.find(e => e.type === 'session_diag') || {}).data || null,
    powerState: (ev.find(e => e.type === 'power_state_at_parcours') || {}).data || null,
    types,
  };
}

// Last live-fired step index for each parcours — the "completed" bar.
// Inferred from the dataset so the scripts don't need the parcours JSON. Uses
// step_fire only: resume_step_index can be a past-the-end "finished" sentinel.
export function inferParcoursStepMax(summaries) {
  const max = {};
  for (const s of summaries) {
    if (s.maxStep == null) continue;
    if (s.maxStep > (max[s.parcoursKey] ?? -1)) max[s.parcoursKey] = s.maxStep;
  }
  return max;
}

// Did this session reach the last step — fired live, or resumed already-finished?
export function isCompleted(summary, stepMax) {
  const bar = stepMax[summary.parcoursKey];
  if (bar == null) return false;
  if (summary.maxStep != null && summary.maxStep >= bar) return true;
  // resumed past the last step (finished sentinel), or resumed at the last step already done
  if (summary.resumeStepIndex != null
      && (summary.resumeStepIndex > bar
          || (summary.resumeStepIndex >= bar && summary.resumeStepDone))) return true;
  return false;
}

// Parse `key=value` / `--flag` argv into an options object.
export function parseArgs(argv, defaults = {}) {
  const opts = { ...defaults, _: [] };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
    else if (arg.startsWith('--')) opts[arg.slice(2)] = true;
    else opts._.push(arg);
  }
  return opts;
}
