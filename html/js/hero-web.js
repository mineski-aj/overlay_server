/* Hero KOTAK portraits: prefer hero_web/ (512px WebP, ~25KB each) over the
   1000x1000 PNGs in hero/ (~900KB each). Include right after theme-apply.js.
   Missing WebP (new hero not yet converted) transparently falls back to the
   original PNG via the capture-phase error listener below — covers every
   <img> on the page, however its src was assigned. */
function heroWebUrl(id, prefix) {
  return (prefix === undefined ? '' : prefix) + 'hero_web/HERO_' + id + '_KOTAK.webp';
}
document.addEventListener('error', function (e) {
  var img = e.target;
  if (!img || img.tagName !== 'IMG' || img.dataset.heroPngFallback) return;
  var m = /(^|\/)hero_web\/HERO_(\d+)_KOTAK\.webp(\?.*)?$/.exec(img.getAttribute('src') || '');
  if (!m) return;
  img.dataset.heroPngFallback = '1';
  img.src = m[1] + 'hero/HERO_' + m[2] + '_KOTAK.png';
}, true);
