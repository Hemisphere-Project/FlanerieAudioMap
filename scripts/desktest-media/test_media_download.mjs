// Desk test: run the REAL apputils.js media_download against the production
// server, with XHR stubbed over node fetch and the cordova file API stubbed
// over a tmpdir. Verifies chunking, resume, stale-part restart, no-Range
// fallback, retry, 404 fast-fail, and byte-exactness.
import fs from 'fs';
import path from 'path';
import os from 'os';
import vm from 'vm';
import crypto from 'crypto';

const WEB = 'https://flanerie.bloffique-theatre.com';
const FILE = 'flanerie_invites_v3/BLOC_02BIS_Parents_Carla/GIVORS26_BLOC_02B_Parents_Carla_AFTER.mp3';
const SIZE = 413151;

// ---------- XHR stub ----------
const reqLog = [];
const knobs = { failNextN: 0, stripRange: false };

class XHR {
  constructor() { this.headers = {}; }
  open(m, u) { this.url = u; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  getResponseHeader(k) { return this._h ? this._h.get(k) : null; }
  abort() { this._aborted = true; }
  send() {
    reqLog.push({ url: this.url, range: this.headers['Range'] || null, ifRange: this.headers['If-Range'] || null });
    if (knobs.failNextN > 0) {
      knobs.failNextN--;
      setTimeout(() => this.onerror && this.onerror(new Error('neterr')), 5);
      return;
    }
    const h = { ...this.headers };
    if (knobs.stripRange) { delete h['Range']; delete h['If-Range']; }
    fetch(this.url, { headers: h }).then(async r => {
      const buf = await r.arrayBuffer();
      if (this._aborted) return;
      this.status = r.status; this.response = buf; this._h = r.headers;
      this.onprogress && this.onprogress({ loaded: buf.byteLength });
      this.onload && this.onload();
    }).catch(e => { if (!this._aborted) this.onerror && this.onerror(e); });
  }
}

// ---------- cordova file API stub over tmpdir ----------
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flantest-'));
function dirEntry(p) {
  fs.mkdirSync(p, { recursive: true });
  return {
    __p: p,
    getDirectory(name, opts, ok, fail) {
      const q = path.join(p, name);
      if (!fs.existsSync(q)) { if (!opts || !opts.create) return fail({ code: 1 }); fs.mkdirSync(q); }
      ok(dirEntry(q));
    },
    getFile(name, opts, ok, fail) {
      const q = path.join(p, name);
      if (!fs.existsSync(q)) { if (!opts || !opts.create) return fail({ code: 1 }); fs.writeFileSync(q, Buffer.alloc(0)); }
      ok(fileEntry(q));
    },
  };
}
function fileEntry(q) {
  return {
    file(ok) { ok({ size: fs.statSync(q).size }); },
    createWriter(ok) {
      const w = {
        length: fs.statSync(q).size, _pos: 0,
        seek(n) { this._pos = n; },
        write(blob) {
          blob.arrayBuffer().then(ab => {
            const buf = Buffer.from(ab);
            const fd = fs.openSync(q, 'r+');
            fs.writeSync(fd, buf, 0, buf.length, this._pos);
            fs.closeSync(fd);
            setImmediate(() => this.onwriteend && this.onwriteend());
          }).catch(e => this.onerror && this.onerror(e));
        },
      };
      ok(w);
    },
    remove(ok) { try { fs.unlinkSync(q); } catch (e) {} ok(); },
    moveTo(dir, newName, ok, fail) {
      try { fs.renameSync(q, path.join(dir.__p, newName)); ok(); } catch (e) { fail(e); }
    },
  };
}

// ---------- globals + load real apputils.js ----------
globalThis.window = globalThis;
globalThis.document = { WEBAPP_URL: WEB, LOCALMEDIA_DIR: 'media' };
globalThis.XMLHttpRequest = XHR;
globalThis.LocalFileSystem = { PERSISTENT: 1 };
globalThis.requestFileSystem = (t, s, ok) => ok({ root: dirEntry(ROOT) });
globalThis.Response = class { constructor(b, o) { this._b = b; this.status = o.status; } blob() { return Promise.resolve(new Blob([this._b])); } };

vm.runInThisContext(fs.readFileSync('/home/mgr/Bakery/Flanerie/FlanerieCordova/www/apputils.js', 'utf8'), { filename: 'apputils.js' });

MEDIA_FETCH.CHUNK_BYTES = 64 * 1024;  // multi-chunk on a 400KB file
MEDIA_FETCH.BACKOFF_MS = 50;

// ---------- helpers ----------
const finalPath = path.join(ROOT, 'media', FILE);
const partPath = finalPath + '.' + SIZE + '.part';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const clean = () => fs.rmSync(path.join(ROOT, 'media'), { recursive: true, force: true });
const reqsSince = mark => reqLog.slice(mark);

console.log('fetching reference copy...');
const ref = Buffer.from(await (await fetch(WEB + '/media/' + FILE)).arrayBuffer());
if (ref.length !== SIZE) throw new Error('reference size mismatch ' + ref.length);
const REFSHA = sha(ref);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra || ''); }
}

// T1: fresh multi-chunk download
{
  clean(); const m = reqLog.length;
  const prog = [];
  await media_download(FILE, { size: SIZE }, false, b => prog.push(b));
  const reqs = reqsSince(m);
  check('T1 byte-exact', fs.existsSync(finalPath) && sha(fs.readFileSync(finalPath)) === REFSHA);
  check('T1 chunk count', reqs.length === Math.ceil(SIZE / MEDIA_FETCH.CHUNK_BYTES), 'got ' + reqs.length);
  check('T1 first range', reqs[0].range === 'bytes=0-65535', reqs[0].range);
  check('T1 if-range on later chunks', reqs.length > 1 && reqs[1].ifRange !== null, JSON.stringify(reqs[1]));
  check('T1 part cleaned', !fs.existsSync(partPath));
  check('T1 progress monotonic to total', prog.length > 0 && prog[prog.length - 1] === SIZE && prog.every((v, i) => i === 0 || v >= prog[i - 1]));
}

// T2: second call skips (file cached)
{
  const m = reqLog.length;
  await media_download(FILE, { size: SIZE });
  check('T2 no requests on cached file', reqsSince(m).length === 0);
}

// T3: resume from a valid part
{
  clean(); const m = reqLog.length;
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  fs.writeFileSync(partPath, ref.subarray(0, 100000));
  await media_download(FILE, { size: SIZE });
  const reqs = reqsSince(m);
  check('T3 byte-exact after resume', sha(fs.readFileSync(finalPath)) === REFSHA);
  check('T3 first range starts at part size', reqs[0].range === 'bytes=100000-165535', reqs[0].range);
}

// T4: oversized stale part → restart from zero
{
  clean(); const m = reqLog.length;
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  fs.writeFileSync(partPath, crypto.randomBytes(SIZE + 5));
  await media_download(FILE, { size: SIZE });
  const reqs = reqsSince(m);
  check('T4 byte-exact after stale part', sha(fs.readFileSync(finalPath)) === REFSHA);
  check('T4 restarted at 0', reqs[0].range === 'bytes=0-65535', reqs[0].range);
}

// T5: proxy strips Range → single 200 full-body fallback
{
  clean(); knobs.stripRange = true; const m = reqLog.length;
  await media_download(FILE, { size: SIZE });
  knobs.stripRange = false;
  check('T5 byte-exact via 200 fallback', sha(fs.readFileSync(finalPath)) === REFSHA);
  check('T5 single request', reqsSince(m).length === 1, reqsSince(m).length);
}

// T6: transient network error → retried, succeeds
{
  clean(); knobs.failNextN = 1; const m = reqLog.length;
  await media_download(FILE, { size: SIZE });
  check('T6 byte-exact after retry', sha(fs.readFileSync(finalPath)) === REFSHA);
  check('T6 one extra request', reqsSince(m).length === Math.ceil(SIZE / MEDIA_FETCH.CHUNK_BYTES) + 1);
}

// T7: 404 fails fast (no retries)
{
  const m = reqLog.length;
  let rejected = null;
  await media_download('flanerie_invites_v3/does_not_exist.mp3', { size: 1234 }).catch(e => rejected = e);
  check('T7 rejected', rejected !== null, String(rejected));
  check('T7 single request (no retry on 404)', reqsSince(m).length === 1, reqsSince(m).length);
}

// T8: dryrun on a missing file rejects DRYRUN without network
{
  clean(); const m = reqLog.length;
  let r = null;
  await media_download(FILE, { size: SIZE }, true).catch(e => r = e);
  check('T8 DRYRUN rejection', r === 'DRYRUN', String(r));
  check('T8 no requests', reqsSince(m).length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
