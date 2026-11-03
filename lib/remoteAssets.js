// lib/remoteAssets.js — remote-viewer (tunnel) asset policy.
//
// 1. Never serve the full-size /hires/<POSE>/*.png remotely: the same URL is
//    answered with the existing /hires/<POSE>_web/*.webp copy (~60-100KB vs
//    ~1MB). A PNG with no WebP copy is a 404 (logged once) rather than a
//    1MB download over the tunnel.
// 2. Cache headers for assets that are stable by name (videos, photos): a
//    day of max-age so a prewarmed browser cache is actually used. The
//    prewarm page force-refreshes entries whose mtime changed.
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HIRES_RE = /^\/hires\/(DEFEAT|FRONT|LEFT|RIGHT|SIGNATURE|VICTORY)\/(.+)\.png$/i;
const warned = new Set();

function hiresGate(isRemoteRequest) {
  return (req, res, next) => {
    if (req.method !== 'GET' || !isRemoteRequest(req)) return next();
    let p;
    try { p = decodeURIComponent(req.path); } catch (e) { return next(); }
    const m = HIRES_RE.exec(p);
    if (!m || m[2].includes('..')) return next();
    const web = path.join(ROOT, 'hires', m[1].toUpperCase() + '_web', m[2] + '.webp');
    fs.stat(web, (err, st) => {
      if (err || !st.isFile()) {
        if (!warned.has(p)) { warned.add(p); console.warn('[remote] no WebP copy for', p, '— blocked'); }
        return res.status(404).end();
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(web, { headers: { 'Content-Type': 'image/webp' } }, (e) => { if (e && !res.headersSent) next(); });
    });
  };
}

// For express.static setHeaders (remote branch). Returns a Cache-Control
// value, or null to leave the caller's default.
function remoteCacheControl(posixPath) {
  if (/\.webm$/i.test(posixPath) || /\/(photos|hires[^/]*|hero_web|heromvp_web)\//i.test(posixPath)) {
    return 'public, max-age=86400';
  }
  return null;
}

module.exports = { hiresGate, remoteCacheControl };
