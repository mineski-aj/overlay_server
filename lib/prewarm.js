// lib/prewarm.js — manifest of the assets a remote viewer should download
// BEFORE going live (GET /api/prewarm-manifest, html/prewarm.html). Every
// entry is the exact URL a page will request, so the browser's HTTP cache key
// matches. Player photos are WebP only (the hires/photos PNGs were retired).
const fs   = require('fs');
const path = require('path');
const { getTheme } = require('./theme');

const ROOT = path.join(__dirname, '..');
const THEMES = ['regular', '10th_anniversary', 'playoffs'];
const SKIP_DIRS = new Set(['old', 'updated']);

function enc(rel) { return '/' + rel.split('/').map(encodeURIComponent).join('/'); }

function entry(rel, urlOverride) {
  try {
    const st = fs.statSync(path.join(ROOT, rel));
    if (!st.isFile()) return null;
    return { u: urlOverride || enc(rel), s: st.size, m: Math.floor(st.mtimeMs) };
  } catch (e) { return null; }
}

function listDir(relDir, re) {
  let names;
  try { names = fs.readdirSync(path.join(ROOT, relDir)); } catch (e) { return []; }
  return names.filter((n) => re.test(n) && !SKIP_DIRS.has(n)).sort()
    .map((n) => entry(relDir + '/' + n)).filter(Boolean);
}

// Pull a `const NAME = { ... };` object literal out of a page's source.
function extractObject(src, name) {
  const at = src.indexOf('const ' + name + ' =');
  if (at < 0) return {};
  let i = src.indexOf('{', at), depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  try { return new Function('return ' + src.slice(i, j + 1))(); } catch (e) { return {}; }
}

// Scene backgrounds from mplfs.html + ENTVC.html's own SCENE_VIDEO_SRC tables.
function backgroundFiles(themes) {
  const seen = new Map();
  for (const page of ['html/mplfs.html', 'html/ENTVC.html']) {
    let src;
    try { src = fs.readFileSync(path.join(ROOT, page), 'utf8'); } catch (e) { continue; }
    const base = extractObject(src, 'SCENE_VIDEO_SRC');
    const byTheme = extractObject(src, 'SCENE_VIDEO_SRC_BY_THEME');
    for (const theme of themes) {
      const merged = Object.assign({}, base, byTheme[theme] || {});
      for (const u of Object.values(merged)) {
        if (typeof u !== 'string' || !/\.webm$/i.test(u)) continue;
        const rel = decodeURIComponent(u.replace(/^\//, ''));
        if (!seen.has(rel)) seen.set(rel, entry(rel, u));
      }
    }
  }
  const out = [...seen.values()];
  // Playoffs also uses a few loops that aren't in the scene table (bracket header, L3 Lobby).
  if (themes.includes('playoffs')) {
    for (const e of listDir('assets/z_playoffs background', /\.webm$/i)) if (!seen.has(decodeURIComponent(e.u.slice(1)))) out.push(e);
  }
  return out.filter(Boolean);
}

function killEventFiles(themes) {
  const out = [];
  if (themes.includes('regular')) out.push(...listDir('assets/motion', /\.webm$/i));
  if (themes.includes('10th_anniversary')) out.push(...listDir('assets/motion/anniversary', /\.webm$/i));
  if (themes.includes('playoffs')) out.push(...listDir('assets/ingame/playoffs/motion', /\.webm$/i));
  return out;
}

function draftHeroFiles() {
  return [
    ...listDir('assets/draft/webm', /^HERO_PICK_DRAFT_\d+\.webm$/i),
    ...listDir('assets/motion', /^picking(blue|red)\.webm$/i),
    ...listDir('assets/draft/motion', /^(blue|red)pickbg1\.webm$/i),
  ];
}

// Draft photos (photos/FRONT|VICTORY), kill-event signature photos
// (regular: photos/SIGNATURE; 10th/playoffs: hires/SIGNATURE_web). All WebP.
function photoFiles(themes) {
  const out = [
    ...listDir('photos/FRONT', /_FRONT_resized\.webp$/i),
    ...listDir('photos/VICTORY', /_VICTORY_resized\.webp$/i),
  ];
  if (themes.includes('regular')) out.push(...listDir('photos/SIGNATURE', /_SIGNATURE_resized\.webp$/i));
  if (themes.includes('10th_anniversary') || themes.includes('playoffs')) {
    out.push(...listDir('hires/SIGNATURE_web', /\.webp$/i));
  }
  return out;
}

// EVERY player photo any overlay uses (all WebP): hires/<POSE>_web (mplfs,
// mpltag, kill events, heatmap), hires_l3 (L3 Lobby), photos/<POSE> resized
// (Draft, LED Draft, side checks, playerboard) and the BNW crops (Team
// Hexagon, Post 4 Key, Post H2H). Superset of the 'photos' set.
function allPlayerPhotoFiles(themes) {
  const out = [...photoFiles(['regular', '10th_anniversary', 'playoffs'])];
  for (const pose of ['DEFEAT', 'FRONT', 'LEFT', 'RIGHT', 'SIGNATURE', 'VICTORY']) {
    out.push(...listDir('hires/' + pose + '_web', /\.webp$/i));
    out.push(...listDir('photos/' + pose, /_resized\.webp$/i));
  }
  for (const side of ['LEFT', 'RIGHT']) out.push(...listDir('hires_l3/' + side, /\.webp$/i));
  out.push(...listDir('photos/Dynamic/3_CROPPED BNW', /\.webp$/i));
  const seen = new Set();
  return out.filter((f) => !seen.has(f.u) && seen.add(f.u));
}

// Sponsor logos: /sponsors (loops, Waiting TVC, Today's...), /sponsors/white
// (Credit Reel etc.) and /assets/sponsors (Credit Reel @file.png lines).
function sponsorFiles() {
  return [
    ...listDir('sponsors', /\.(png|webp|jpg)$/i),
    ...listDir('sponsors/white', /\.(png|webp|jpg)$/i),
    ...listDir('assets/sponsors', /\.(png|webp|jpg)$/i),
  ];
}

// Big optional sets (team intros 9-24MB each).
function lineupFiles() {
  return [...listDir('assets/lineup', /\.webm$/i), ...listDir('assets/lineup/playoffs', /\.webm$/i)];
}
function matchcardFiles() { return listDir('assets/matchcard', /\.webm$/i); }

const SETS = {
  'draft-heroes': { label: 'Draft hero pick videos', build: () => draftHeroFiles(), def: true },
  'backgrounds':  { label: 'Scene background loops', build: (t) => backgroundFiles(t), def: true },
  'players-all':  { label: 'All player photos (every overlay)', build: (t) => allPlayerPhotoFiles(t), def: true },
  'photos':       { label: 'Draft + kill-event photos only (subset of the above)', build: (t) => photoFiles(t), def: false },
  'sponsors':     { label: 'Sponsor logos', build: () => sponsorFiles(), def: true },
  'killevents':   { label: 'Kill-event videos', build: (t) => killEventFiles(t), def: true },
  'lineup':       { label: 'Team Line-Up intros (large)', build: () => lineupFiles(), def: false },
  'matchcard':    { label: 'Match card loops', build: () => matchcardFiles(), def: false },
};

function buildManifest(themeParam) {
  const active = getTheme();
  const themes = themeParam === 'all' ? THEMES : [THEMES.includes(themeParam) ? themeParam : active];
  const sets = {};
  for (const [key, def] of Object.entries(SETS)) {
    const files = def.build(themes);
    sets[key] = { label: def.label, def: def.def, count: files.length,
      bytes: files.reduce((a, f) => a + f.s, 0), files };
  }
  return { generatedAt: Date.now(), themes, activeTheme: active, sets };
}

module.exports = { buildManifest };
