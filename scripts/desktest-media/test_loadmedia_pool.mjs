// Desk test: run the REAL parcours.js loadmedia() with a stubbed
// media_download. Verifies pool concurrency (≤4), the one-shot final sweep
// (transient failure recovers, persistent failure rejects media_partial),
// progress accounting, and dryrun semantics.
import fs from 'fs';
import vm from 'vm';

// ---------- minimal browser globals ----------
globalThis.window = globalThis;
globalThis.document = { WEBAPP_URL: 'https://example.test' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'desktest' }, configurable: true }); } catch (e) {}

const telemetry = [];
globalThis.TELEMETRY = { log: (ev, data) => telemetry.push({ ev, data }) };

// jQuery stub: common.js touches $('#logs') at load, parcours methods we don't
// call use it further. Chainable no-op is enough.
const jqStub = () => new Proxy(() => jqStub(), { get: (t, k) => k === 'length' ? 0 : () => jqStub() });
globalThis.$ = jqStub;

// ---------- load real common.js (EventEmitter, get) + parcours.js ----------
const base = '/home/mgr/Bakery/Flanerie/FlanerieAudioMap/www/app/assets/';
vm.runInThisContext(fs.readFileSync(base + 'common.js', 'utf8'), { filename: 'common.js' });
vm.runInThisContext(fs.readFileSync(base + 'parcours.js', 'utf8'), { filename: 'parcours.js' });

const P = document.PARCOURS;
P.store = () => {};

// ---------- fake media list + media_download stub ----------
const N = 10;
const LIST = {};
for (let i = 0; i < N; i++) LIST['Objets/f' + i + '.mp3'] = { size: 1000 + i };

globalThis.get = (path) => Promise.resolve(LIST);

let active = 0, maxActive = 0;
let calls = [];
let failPlan = {}; // file -> number of times to fail

globalThis.media_download = (path, info, dryrun, onprogress) => {
  calls.push(path);
  active++; maxActive = Math.max(maxActive, active);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      active--;
      const leaf = path.split('/').slice(1).join('/');
      if (dryrun) return reject('DRYRUN');
      if (failPlan[leaf] > 0) { failPlan[leaf]--; return reject(new TypeError('stalled')); }
      if (onprogress) { onprogress(Math.floor(info.size / 2)); onprogress(info.size); }
      resolve();
    }, 10 + Math.random() * 30);
  });
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra || ''); }
};

const reset = () => {
  P.pID = 'testpack';
  P.state.mediaPack = []; P.state.mediaPackLoaded = 0; P.state.mediaPackSize = 0;
  P.state.medialoaded = false;
  calls = []; telemetry.length = 0; maxActive = 0; failPlan = {};
};

// S1: clean load — all succeed, concurrency capped at 4
reset();
await P.loadmedia(false);
check('S1 resolves, medialoaded set', P.state.medialoaded === true);
check('S1 all files attempted once', calls.length === N, calls.length);
check('S1 concurrency <= 4', maxActive <= 4 && maxActive >= 2, 'max=' + maxActive);
check('S1 loaded sums sizes', P.state.mediaPackLoaded === P.state.mediaPackSize);
check('S1 progress 100', P.loadprogress() === 100, P.loadprogress());
check('S1 telemetry media_pack_loaded', telemetry.some(t => t.ev === 'media_pack_loaded' && t.data.retried === 0));

// S2: one transient failure — sweep recovers, still resolves
reset(); failPlan['Objets/f3.mp3'] = 1;
await P.loadmedia(false);
check('S2 resolves despite transient failure', P.state.medialoaded === true);
check('S2 f3 attempted twice', calls.filter(c => c.endsWith('f3.mp3')).length === 2);
check('S2 telemetry retried=1', telemetry.some(t => t.ev === 'media_pack_loaded' && t.data.retried === 1));
check('S2 loaded sums sizes', P.state.mediaPackLoaded === P.state.mediaPackSize);

// S3: persistent failure — rejects media_partial after sweep
reset(); failPlan['Objets/f7.mp3'] = 99;
let err = null;
await P.loadmedia(false).catch(e => err = e);
check('S3 rejects media_partial', String(err).startsWith('media_partial: 1'), String(err));
check('S3 medialoaded stays false', P.state.medialoaded === false);
check('S3 f7 attempted twice', calls.filter(c => c.endsWith('f7.mp3')).length === 2);
check('S3 telemetry partial with path', telemetry.some(t => t.ev === 'media_download_partial' && t.data.files[0] === 'testpack/Objets/f7.mp3' && typeof t.data.ms === 'number'));
check('S3 progress reaches 100 (failed counted as processed)', P.loadprogress() === 100, P.loadprogress());

// S4: dryrun — DRYRUN rejections are not failures, resolves, medialoaded untouched
reset();
await P.loadmedia(true);
check('S4 dryrun resolves', err !== undefined);
check('S4 medialoaded not set by dryrun', P.state.medialoaded === false);
check('S4 no media_pack_loaded telemetry on dryrun', !telemetry.some(t => t.ev === 'media_pack_loaded'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
