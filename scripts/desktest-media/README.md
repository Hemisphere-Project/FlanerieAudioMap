# Media downloader desk tests

Run before building an APK that touches `FlanerieCordova/www/apputils.js`
(media download path) or `www/app/assets/parcours.js` (`loadmedia`).

```sh
node scripts/desktest-media/test_media_download.mjs   # REAL apputils.js vs PRODUCTION server
node scripts/desktest-media/test_loadmedia_pool.mjs   # REAL parcours.js loadmedia, stubbed media_download
```

- `test_media_download.mjs` loads the real `apputils.js` with XHR stubbed over
  node `fetch` and the cordova file API stubbed over a tmpdir, then downloads a
  real 413KB file from production in 64KB chunks. Covers: multi-chunk Range
  assembly (byte-exact sha256), skip-on-cached, resume from `.part`, stale
  oversized part restart, 200 no-Range fallback, transient-error retry,
  404 fast-fail, dryrun.
- `test_loadmedia_pool.mjs` checks pool concurrency ≤4, the final retry sweep
  (transient failure recovers / persistent failure → `media_partial` reject),
  progress accounting and telemetry events.

Both exit non-zero on failure. Sources live in the repos they test — these
harnesses load them by absolute path (adjust if the checkout moves).
