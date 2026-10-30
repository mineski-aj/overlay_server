#!/usr/bin/env node
/* Tools/build-remote-webp.js — builds WebP copies of large PNGs into
   .webcache/ (mirroring the original paths) for REMOTE viewers only
   (Tailscale Funnel / Cloudflare Tunnel). server.js swaps them in
   transparently: same .png URL, ~5-10x fewer bytes over the internet.
   Local vMix/OBS keep getting the original PNGs, untouched.

   - Never modifies or deletes source files.
   - Skips PNGs under MIN_BYTES and copies that wouldn't save >= 25%.
   - Re-runnable: only rebuilds copies older than their source. If a PNG is
     swapped on disk mid-show, server.js serves the original PNG until this
     is re-run (it never serves a stale copy).
   - Caps size at 2560x1440 (the broadcast canvas is 1920x1080).

   Usage:  node Tools/build-remote-webp.js        (needs ffmpeg with libwebp)
*/
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.webcache');
const MIN_BYTES = 200 * 1024;
const QUALITY = 90;
const WORKERS = 4;
const SKIP_DIRS = new Set(['node_modules', '.git', '.webcache', 'HRMServer', 'HRMServer_Sim',
  'Tools', 'postgames', 'logs', 'old']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('z_') || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), out);
    } else if (/\.png$/i.test(e.name)) {
      const p = path.join(dir, e.name);
      const st = fs.statSync(p);
      if (st.size >= MIN_BYTES) out.push({ p, st });
    }
  }
  return out;
}

const files = walk(ROOT, []);
let made = 0, skipped = 0, noGain = 0, failed = 0, bytesIn = 0, bytesOut = 0, done = 0;

function convert({ p, st }) {
  const rel = path.relative(ROOT, p);
  const dest = path.join(OUT, rel + '.webp');
  const marker = dest + '.nogain';
  if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= st.mtimeMs) { skipped++; return Promise.resolve(); }
  if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= st.mtimeMs) { skipped++; return Promise.resolve(); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp.webp';
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', p,
      '-vf', "scale='min(2560,iw)':'min(1440,ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=yuva420p",
      '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '4', tmp],
      (err) => {
        if (err) { failed++; try { fs.unlinkSync(tmp); } catch {} console.warn('FAIL', rel, err.message.split('\n')[0]); return resolve(); }
        const outSize = fs.statSync(tmp).size;
        if (outSize > st.size * 0.75) {
          noGain++; fs.renameSync(tmp, marker); // keep as marker (no delete needed)
        } else {
          fs.renameSync(tmp, dest); made++; bytesIn += st.size; bytesOut += outSize;
        }
        resolve();
      });
  }).finally(() => { if (++done % 100 === 0) console.log(`${done}/${files.length}`); });
}

(async () => {
  console.log(`${files.length} PNGs over ${MIN_BYTES / 1024}KB`);
  let i = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (i < files.length) await convert(files[i++]);
  }));
  const mb = (b) => (b / 1048576).toFixed(1) + 'MB';
  console.log(`made ${made}, up-to-date ${skipped}, no-gain ${noGain}, failed ${failed} — ${mb(bytesIn)} → ${mb(bytesOut)}`);
})();
