// Server event log — logs/server.log, one timestamped line per event.
//
// Infomaniak's front serves its « maintenance » page whenever Node does not
// answer, and keeps no log of why (support answer, 2026-10). This file is the
// app-side record to correlate the next hit with: process start/stop, crashes,
// slow or failed requests, requests the client gave up on, socket.io churn,
// event-loop stalls, and a 10-minute heartbeat that proves the process was alive.
//
// Observation only: nothing here changes how the server answers or crashes
// (uncaughtExceptionMonitor watches without swallowing; signals still exit).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __basepath = path.resolve(path.dirname(fileURLToPath(import.meta.url)) + '/..');
const LOG_DIR = path.join(__basepath, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024;   // rotated to server.log.1 at start

const SLOW_MS = 1000;                      // time to first byte worth a line
const LAG_MS = 500;                        // event-loop stall worth a line
const HEARTBEAT_MS = 10 * 60 * 1000;

function stamp() {
  return new Date().toISOString();
}

// Sync append: lines must land even when the next statement is process.exit().
export function slog(...parts) {
  try {
    fs.appendFileSync(LOG_FILE, `${stamp()} [${process.pid}] ${parts.join(' ')}\n`);
  } catch (e) {
    console.error('[serverlog] write failed:', e.message);
  }
}

function rotate() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES)
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch (e) {
    console.error('[serverlog] rotate failed:', e.message);
  }
}

function mb(bytes) {
  return Math.round(bytes / 1048576) + 'MB';
}

// Process lifecycle, crashes, event-loop lag, heartbeat. Call first thing.
export function installProcessLog() {
  rotate();
  slog(`START node ${process.version} cwd ${process.cwd()}`);

  // Fires for uncaught exceptions AND unhandled rejections (Node's default
  // --unhandled-rejections=throw turns them into uncaught exceptions) without
  // changing the default behaviour: the process still crashes and run.sh restarts it.
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    slog(`CRASH ${origin}: ${err && err.stack ? err.stack : err}`);
  });
  process.on('warning', (w) => slog(`WARNING ${w.name}: ${w.message}`));

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => {
      slog(`SIGNAL ${sig} — exiting`);
      process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 })[sig]);
    });
  }
  process.on('exit', (code) => {
    slog(`EXIT code ${code} after ${Math.round(process.uptime())}s`);
  });

  // Event-loop lag: a timer that fires late means nothing else could run either.
  let last = Date.now();
  let maxLag = 0;
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 1000;
    last = now;
    if (lag > maxLag) maxLag = lag;
    if (lag > LAG_MS) slog(`LAG event loop blocked ~${lag}ms`);
  }, 1000).unref();

  setInterval(() => {
    const m = process.memoryUsage();
    slog(`ALIVE up ${Math.round(process.uptime())}s rss ${mb(m.rss)} heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} maxLag ${maxLag}ms`);
    maxLag = 0;
  }, HEARTBEAT_MS).unref();
}

// Keep-alive above the front's idle timeout, listen errors.
// Node's default keepAliveTimeout (5 s) closes idle upstream sockets the
// front may still reuse — the suspected cause of the instant 504s.
export function installServerLog(server) {
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.on('listening', () => {
    const a = server.address();
    slog(`LISTEN port ${a && a.port} keepAlive ${server.keepAliveTimeout}ms headers ${server.headersTimeout}ms`);
  });
  server.on('error', (e) => slog(`SERVER ERROR ${e.code || ''} ${e.message}`));
}

// Express middleware: a line for every 5xx, every response whose headers took
// longer than SLOW_MS, and every request the client dropped before any answer
// (what a front timing out looks like from here). Media transfers are timed to
// the first byte, so big downloads are not "slow".
export function requestLog(req, res, next) {
  const t0 = Date.now();
  let ttfb = null;
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (ttfb === null) ttfb = Date.now() - t0;
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    if (res.statusCode >= 500 || ttfb > SLOW_MS)
      slog(`REQ ${res.statusCode} ${req.method} ${req.originalUrl} ttfb ${ttfb}ms total ${Date.now() - t0}ms`);
  });
  res.on('close', () => {
    if (!res.headersSent)
      slog(`REQ ABORTED before response ${req.method} ${req.originalUrl} after ${Date.now() - t0}ms`);
  });
  next();
}

// socket.io: connections/disconnections summed per minute (only when nonzero),
// with close reasons and connection errors. Counted at the engine.io level so
// every namespace (the chat mounts its own) is seen.
export function installSocketLog(io) {
  const engine = io && io.engine;
  if (!engine) return;
  let conn = 0;
  const reasons = {};
  engine.on('connection', (socket) => {
    conn++;
    socket.on('close', (reason) => { reasons[reason] = (reasons[reason] || 0) + 1; });
  });
  engine.on('connection_error', (e) => {
    slog(`SOCKET connection_error ${e.code} ${e.message} ${e.req && e.req.url ? e.req.url : ''}`);
  });
  setInterval(() => {
    const disc = Object.values(reasons).reduce((a, b) => a + b, 0);
    if (conn || disc)
      slog(`SOCKET +${conn} -${disc} now ${engine.clientsCount} ${JSON.stringify(reasons)}`);
    conn = 0;
    for (const k in reasons) delete reasons[k];
  }, 60000).unref();
}
