#!/usr/bin/env node
/* Tools/optimize-images.js — builds lightweight WebP COPIES of oversized
   broadcast art. Never modifies or deletes the source files: each job reads
   a source folder and writes into its own separate "_web" folder, which the
   overlay pages try first and fall back from (to the original PNG) if a
   copy is missing — see mplfs.html's mvSetImgWithFallback.

   Why: heromvp/ alone was ~414MB (avg 3.1MB/file, up to 42MB at 8000x4501)
   for art displayed in an 867x470 box — every MVP Scene show downloaded and
   decoded up to 36 megapixels. Capped at 1080px tall (the full broadcast
   canvas, so an Edit-tab resize can never outgrow it) + WebP with alpha,
   the same file is ~100x smaller with no visible difference.

   Re-runnable: skips any copy that's already newer than its source, so
   after adding new hero art just run it again:
       node Tools/optimize-images.js
   Requires ffmpeg (with libwebp) on PATH. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JOBS = [
  { src: 'heromvp',         dest: 'heromvp_web',         maxHeight: 1080 },
  // Player pose photos (1000x1000, ~1MB each) — size kept, WebP only.
  { src: 'hires/SIGNATURE', dest: 'hires/SIGNATURE_web', maxHeight: 1080 },
  { src: 'hires/FRONT',     dest: 'hires/FRONT_web',     maxHeight: 1080 },
  { src: 'hires/LEFT',      dest: 'hires/LEFT_web',      maxHeight: 1080 },
  { src: 'hires/RIGHT',     dest: 'hires/RIGHT_web',     maxHeight: 1080 },
  { src: 'hires/VICTORY',   dest: 'hires/VICTORY_web',   maxHeight: 1080 },
  { src: 'hires/DEFEAT',    dest: 'hires/DEFEAT_web',    maxHeight: 1080 },
  // Hero square icons: 1000x1000 (~870KB) but shown as small icons (e.g.
  // 86x62 on Post Carry's card) — 512px is still several times sharper
  // than any slot they're used in so far. If a future scene shows these
  // bigger than ~512px, raise this and re-run (copies get regenerated
  // only when older than their source, so delete hero_web/ first).
  { src: 'hero',            dest: 'hero_web',            maxHeight: 512 },
];
const QUALITY = 90;

let made = 0, skipped = 0, failed = 0, bytesIn = 0, bytesOut = 0;
for (const job of JOBS) {
  const srcDir = path.join(ROOT, job.src);
  const destDir = path.join(ROOT, job.dest);
  if (!fs.existsSync(srcDir)) { console.log(`skip job: ${job.src} not found`); continue; }
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!/\.png$/i.test(name)) continue;
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name.replace(/\.png$/i, '.webp'));
    const srcStat = fs.statSync(src);
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= srcStat.mtimeMs) { skipped++; continue; }
    try {
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-vf', `scale=-2:'min(${job.maxHeight},ih)':flags=lanczos,format=yuva420p`,
        '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6',
        dest,
      ]);
      const outSize = fs.statSync(dest).size;
      bytesIn += srcStat.size; bytesOut += outSize; made++;
      console.log(`${job.src}/${name}: ${(srcStat.size / 1e6).toFixed(2)}MB -> ${(outSize / 1e6).toFixed(2)}MB`);
    } catch (e) {
      failed++;
      try { fs.unlinkSync(dest); } catch {}
      console.error(`FAILED ${job.src}/${name}: ${e.message.split('\n')[0]}`);
    }
  }
}
console.log(`\nDone: ${made} converted, ${skipped} already up to date, ${failed} failed.`);
if (made) console.log(`Converted total: ${(bytesIn / 1e6).toFixed(0)}MB -> ${(bytesOut / 1e6).toFixed(0)}MB`);
