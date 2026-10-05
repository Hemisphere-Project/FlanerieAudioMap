#!/usr/bin/env node
// live.mjs — follow a field walk live from the telemetry directory.
//
// Usage:
//   node telemetry/scripts/live.mjs [options]
//
// Examples:
//   node telemetry/scripts/live.mjs --since=1145 --expect=5d6b813
//   node telemetry/scripts/live.mjs --since=1300 --poll=10 --focus      # phone-call tests
//
// Options:
//   --dir=PATH        Telemetry directory (default: SFTP mount, see common.mjs)
//   --since=HHMM      Only sessions started at/after this local time today
//                     (or --since=YYYYMMDD_HHMM; default: the last 60 min)
//   --expect=COMMIT   Flag any session whose webapp commit differs (stale bundle → relaunch)
//   --poll=SECONDS    Re-scan interval (default 30 — phones push every ~30 s anyway)
//   --focus           Also print audio-focus and playback events (call / interruption tests)
//
// Prints one line per noteworthy change — new session (+ build), step fired, audio /
// GPS / crash issues, a phone silent for 3 min — and a one-line FLEET summary every
// 5 min. Read-only. A newer session from the same phone (walk start after onboarding)
// supersedes the older one, so it is not reported as silent.

import fs from 'fs';
import path from 'path';
import { DEFAULT_DIR, parseArgs } from './common.mjs';

const opts = parseArgs(process.argv.slice(2), { dir: DEFAULT_DIR, poll: '30' });
if (opts.help || opts.h) {
  console.log('Usage: node telemetry/scripts/live.mjs [--dir=] [--since=HHMM] [--expect=COMMIT] [--poll=SECONDS] [--focus]');
  process.exit(0);
}

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const SINCE = !opts.since ? stamp(new Date(Date.now() - 60 * 60000))
  : /^\d{4}$/.test(opts.since) ? stamp(new Date()).slice(0, 9) + opts.since
  : String(opts.since);
const EXPECT = opts.expect ? String(opts.expect).slice(0, 7) : null;
const POLL_MS = Number(opts.poll) * 1000;
const SUMMARY_MS = 5 * 60000;
const SILENT_MS = 3 * 60000;
const ACTIVE_MS = 45 * 60000;

// Placeholder jingles (see README "Reading the output") — not real defects.
const JINGLE = /\/(resume|afterplay|youlost|gpslost)\.mp3/i;
const ISSUES = new Set([
  'audio_loaderror', 'audio_playerror', 'step_voice_failed', 'audio_play_stuck', 'audio_play_timeout',
  'checkaudio_fail', 'session_resume', 'session_restart', 'session_restart_click',
  'gps_lost', 'gps_frozen', 'gps_frozen_escalated', 'gps_revoked', 'gps_degraded', 'gps_sleep_suspect',
  'bg_stop_repeated', 'battery_kill_overlay', 'background_restricted',
  'audiofocus_request_fail', 'audiofocus_loss', 'audiofocus_service_restarted', 'ios_native_fallback',
  'user_lost', 'step_afterplay_fallback', 'walk_end_timeout',
  'audio_engine_reset_error', 'force_reacquire_failed',
]);
const INFO = new Set(['step_skip_done', 'gps_recovered', 'user_recovered', 'walk_end_shutdown', 'audio_play_timeout_self_healed']);
const FOCUS = new Set([
  'audiofocus_change', 'audiofocus_paused', 'audiofocus_resumed', 'audiofocus_request_ok',
  'audiofocus_request_in_call', 'audiofocus_auto_retry', 'audiofocus_resume_retry',
  'audio_play_requested', 'audio_play_started',
]);

const fmt = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });
const age = ms => ms < 90000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60000) + 'm';
const base = src => String(src || '').split('/').pop();
const out = s => process.stdout.write(s + '\n');

const sessions = new Map();   // file -> tracking state

function label(j, file) {
  const c = j.client || {};
  const model = (c.deviceModel || c.platform || '?').replace(/^SM-/, '');
  const plat = String(c.devicePlatform || c.platform || '').toLowerCase().startsWith('i') ? 'iOS' : 'And';
  return `${model}/${plat}${c.osVersion ? String(c.osVersion).split('.')[0] : ''}#${file.slice(16, 20)}`;
}

function buildFlag(web) {
  return EXPECT && web && web !== '?' && web !== EXPECT ? ` ⚠ NOT ${EXPECT} — relaunch app` : '';
}

function detail(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'audio_loaderror': case 'audio_playerror':
      return `${base(d.src)} ${d.code != null ? 'code=' + d.code : ''} ${d.message ? String(d.message).slice(0, 60) : ''}`;
    case 'step_voice_failed': return `step=${d.step} reason=${d.reason}`;
    case 'session_resume': return `resume_step=${d.resume_step_index} done=${d.resume_step_done}`;
    case 'audiofocus_change': return d.state || d.focusState || '';
    case 'audiofocus_paused': return `${d.state} paused=${d.paused} ${(d.srcs || []).map(base).join(',')}`;
    case 'audiofocus_resumed': return `${d.state} resumed=${d.resumed}`;
    case 'audio_play_started': case 'audio_play_requested':
      return `${base(d.src)}${d.seek != null ? ' seek=' + d.seek : ''}`;
    case 'step_skip_done': return `step=${d.step}`;
    default: {
      const s = JSON.stringify(d);
      return s === '{}' ? '' : s.slice(0, 110);
    }
  }
}

function scan(firstRun) {
  let files;
  try {
    files = fs.readdirSync(opts.dir).filter(f => /^\d{8}_\d{6}_\w+\.json$/.test(f) && f.slice(0, 13) >= SINCE);
  } catch (e) {
    out(`!! telemetry dir unreadable (mount dropped?): ${e.message}`);
    return;
  }
  const now = Date.now();
  for (const f of files.sort()) {
    let st;
    try { st = fs.statSync(path.join(opts.dir, f)); } catch { continue; }
    let s = sessions.get(f);
    if (s && s.size === st.size && s.mtimeMs === st.mtimeMs) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(opts.dir, f), 'utf8')); } catch { continue; }   // mid-write: next round
    const ev = Array.isArray(j.events) ? j.events : [];
    const isNew = !s;
    if (isNew) {
      const uuid = (j.client || {}).deviceUuid || null;
      for (const o of sessions.values()) if (uuid && o.uuid === uuid) o.superseded = true;   // same phone, newer session
      s = { n: 0, uuid, lbl: label(j, f), step: null, lastT: 0, lastGps: 0, ended: false, silentWarned: false, issues: {} };
      sessions.set(f, s);
    }
    s.size = st.size; s.mtimeMs = st.mtimeMs;
    if (s.silentWarned) { out(`${fmt(now)} ${s.lbl} ✓ telemetry back (after silence)`); s.silentWarned = false; }
    const quiet = firstRun || isNew;   // a session's history is summarised once, not replayed
    const lines = [];
    for (const e of ev.slice(s.n)) {
      const d = e.data || {};
      if (e.t > s.lastT) s.lastT = e.t;
      if (e.type === 'gps') s.lastGps = e.t;
      if (e.type === 'walk_end_shutdown') s.ended = true;
      if (e.type === 'step_fire' && Number.isInteger(d.step)) {
        s.step = d.step;
        if (!quiet) lines.push(`${fmt(e.t)} ${s.lbl} ▶ step ${d.step}${d.name ? ' ' + d.name : ''}`);
      }
      let issue = ISSUES.has(e.type);
      if ((e.type === 'audio_loaderror' || e.type === 'audio_playerror') && JINGLE.test(d.src || '')) issue = false;
      if (e.type === 'step_afterplay_fallback' && d.reason === 'no_src') issue = false;   // step has no afterplay by design
      if (e.type === 'audiofocus_change' && /LOSS/.test(d.state || d.focusState || '')) issue = true;
      if (issue) {
        s.issues[e.type] = (s.issues[e.type] || 0) + 1;
        if (!quiet) lines.push(`${fmt(e.t)} ${s.lbl} ⚠ ${e.type} ${detail(e)}`);
      } else if (!quiet && (INFO.has(e.type) || (opts.focus && FOCUS.has(e.type)))) {
        lines.push(`${fmt(e.t)} ${s.lbl} · ${e.type} ${detail(e)}`);
      }
    }
    s.n = ev.length;
    if (isNew) {
      const c = j.client || {};
      const diag = (ev.find(e => e.type === 'session_diag') || {}).data || {};
      const web = String(c.webappCommit || diag.webapp_commit || '?').slice(0, 7);
      s.web = web !== '?' ? web : null;
      const iss = Object.entries(s.issues).map(([k, v]) => `${k}×${v}`).join(' ');
      lines.push(`${fmt(now)} ${s.lbl} ${firstRun ? 'tracking' : 'NEW session'}: ${j.parcoursName || j.parcoursId || '?'}, ` +
        `step ${s.step ?? '-'}, apk ${c.appVersion || diag.apk_version || '?'} web ${web}${buildFlag(web)}, ` +
        `last event ${age(now - s.lastT)} ago` + (iss ? ` | issues so far: ${iss}` : ''));
    }
    lines.forEach(out);
  }
  // Silent phones: no upload for a while, walk not ended, not replaced by a newer session.
  for (const s of sessions.values()) {
    const idle = now - s.mtimeMs;
    if (!s.ended && !s.superseded && !s.silentWarned && idle > SILENT_MS && idle < ACTIVE_MS) {
      out(`${fmt(now)} ${s.lbl} ⚠ no telemetry for ${age(idle)} (last step ${s.step ?? '-'}, last event ${fmt(s.lastT)}) — no data link, app killed, or JS suspended?`);
      s.silentWarned = true;
    }
  }
}

function summary() {
  const now = Date.now();
  const act = [...sessions.values()].filter(s => !s.superseded && now - s.mtimeMs < ACTIVE_MS);
  if (!act.length) return;
  out(`${fmt(now)} FLEET ` + act.map(s =>
    `${s.lbl}${s.web ? '@' + s.web : ''}: s${s.step ?? '-'}${s.ended ? ' END' : ''}` +
    `${now - s.mtimeMs > SILENT_MS ? ' SILENT ' + age(now - s.mtimeMs) : ''}` +
    `${s.lastGps ? ' gps ' + age(now - s.lastGps) : ''}`).join(' | '));
}

out(`watching ${opts.dir} — sessions from ${SINCE}${EXPECT ? ', expecting web ' + EXPECT : ''}, poll ${POLL_MS / 1000}s${opts.focus ? ', focus events on' : ''}`);
scan(true);
summary();
setInterval(() => scan(false), POLL_MS);
setInterval(summary, SUMMARY_MS);
