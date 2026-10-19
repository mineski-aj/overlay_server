/* ── Playoffs gold header text ───────────────────────────────────────
   The dark "MPL PHILIPPINES" / "TODAY'S MATCHES" header titles become gold
   under data-theme="playoffs": the looping GOLD BG webm is masked by the
   text's shape, with a subtle dark-gold outline behind it for depth.
   Included by mplfs.html and ENTVC.html (Waiting TVC mirror). Every layer is
   display:none under any other theme, so Regular / 10th Anniversary are
   untouched.

   Two sources of "the text shape":
   - Baked art (Waiting TVC / Waiting Lobby): the title is part of
     S18_Header_playoffs.png, so the page swaps that <img> to the
     *_notext.png and calls PoGoldText.imageHeader(host) — masks are the
     pre-cut *_textmask.png (full glyph = dark-gold layer) and *_textfill.png
     (glyph eroded 2px = gold layer), so a 2px dark-gold ring shows INSIDE the edge —
     the same look as the Bracket header art (outline #b47e00, fill ~#e9c853) —
     plus a subtle dark drop-shadow glow around the outside (OUTER_GLOW) to lift it off white.
   - Real text (Today's / Tomorrow's Schedule titles): PoGoldText.textTitle(el)
     renders the element's own text (its computed font / size / letter-
     spacing) onto a canvas and uses that as the mask. The text itself is made
     transparent by CSS but stays in the DOM, so the existing fit / scaleX /
     Edit-tab logic keeps working untouched; the layers are CHILDREN of el, so
     they inherit its transform. Code that replaces el.textContent wipes the
     layers — the MutationObserver re-adds them.

   The gold videos only decode while on screen (IntersectionObserver: a
   display:none scene is not intersecting), per the project's video rule. */
(function () {
  'use strict';

  var GOLD_SRC    = "/assets/Today's Schedule/playoffs/GOLD BG_612x242.webm";
  var STROKE_CLR  = '#b47e00';   /* dark gold — the Bracket header art's own outline colour */
  var GOLD_TINT   = '#fff0d4';   /* multiplied over the video: its lemon-yellow (~#e5d466) -> the Bracket art's warm gold (~#e9c853) */
  var HDR_DIR     = '/assets/Waiting Screen TVC/playoffs/S18_Header_playoffs';
  var MASK_SCALE  = 2;           /* canvas text masks are drawn at 2x for crisp edges */
  var OUTER_GLOW  = 'drop-shadow(0 0 4px rgba(40, 26, 0, 0.32))';   /* subtle dark outer glow — lifts the gold off the white playoffs background */
  var RING_PX     = 2.5;         /* dark-gold ring width, drawn INSIDE the glyph edge like the Bracket header art */

  function isPlayoffs() { return document.documentElement.getAttribute('data-theme') === 'playoffs'; }

  var css = document.createElement('style');
  css.textContent =
    '.po-gt{position:absolute;left:0;top:0;width:100%;height:100%;display:none;pointer-events:none;filter:' + OUTER_GLOW + ';}' +
    '[data-theme="playoffs"] .po-gt{display:block;}' +
    '.po-gt-stroke,.po-gt-fill{position:absolute;left:0;top:0;width:100%;height:100%;' +
      '-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}' +
    '.po-gt-stroke{background:' + STROKE_CLR + ';}' +
    '.po-gt-fill video{display:block;width:100%;height:100%;object-fit:cover;}' +
    '.po-gt-fill::after{content:"";position:absolute;left:0;top:0;width:100%;height:100%;background:' + GOLD_TINT + ';mix-blend-mode:multiply;}' +
    /* the real text stays for layout/fit but is not drawn — the gold layers are */
    '[data-theme="playoffs"] .po-gt-host{color:transparent !important;text-shadow:none !important;}';
  document.head.appendChild(css);

  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var v = en.target;
      if (en.isIntersecting) { v.play().catch(function () {}); } else { v.pause(); }
    });
  }) : null;

  function setMask(node, url) {
    var v = 'url("' + url + '")';
    node.style.webkitMaskImage = v;
    node.style.maskImage = v;
  }

  /* Builds <div.po-gt><div.po-gt-stroke/><div.po-gt-fill><video/></div></div>
     (appended to host). Returns { root, stroke, fill }. */
  function buildLayers(host) {
    var root = document.createElement('div');
    root.className = 'po-gt';
    var stroke = document.createElement('div');
    stroke.className = 'po-gt-stroke';
    var fill = document.createElement('div');
    fill.className = 'po-gt-fill';
    var vid = document.createElement('video');
    vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
    vid.src = GOLD_SRC;
    fill.appendChild(vid);
    root.appendChild(stroke);
    root.appendChild(fill);
    host.appendChild(root);
    if (io) io.observe(vid);
    return { root: root, stroke: stroke, fill: fill };
  }

  /* Baked-text header (Waiting TVC / Lobby): masks come from pre-cut PNGs: _textmask (full glyph, dark-gold layer) and _textfill (glyph eroded 2px, gold layer) so a 2px dark ring shows inside the edge. */
  function imageHeader(host) {
    if (!host || host.querySelector(':scope > .po-gt')) return;
    var L = buildLayers(host);
    setMask(L.stroke, HDR_DIR + '_textmask.png');
    setMask(L.fill,   HDR_DIR + '_textfill.png');
  }

  /* Real-text title: mask drawn from the element's own computed text style. */
  function drawMask(el, mode) {   /* mode: 'stroke' (full glyph) | 'fill' (glyph minus RING_PX) */
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return null;
    var cs = getComputedStyle(el);
    var text = '';
    el.childNodes.forEach(function (n) { if (n.nodeType === 3) text += n.nodeValue; });
    text = text.trim();
    if (cs.textTransform === 'uppercase') text = text.toUpperCase();
    if (!text) return null;
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    try { ctx.letterSpacing = (cs.letterSpacing === 'normal') ? '0px' : cs.letterSpacing; } catch (e) {}
    /* The text may be wider than its box (it just overflows visibly with a
       plain color) — grow the mask on both sides so nothing is clipped, and
       report the growth so the layers can be widened to match. */
    var extra = Math.max(0, Math.ceil((ctx.measureText(text).width - w) / 2) + 8);
    var W = w + 2 * extra;
    cv.width = Math.ceil(W * MASK_SCALE); cv.height = Math.ceil(h * MASK_SCALE);
    ctx = cv.getContext('2d');
    ctx.scale(MASK_SCALE, MASK_SCALE);
    ctx.translate(extra, 0);
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    try { ctx.letterSpacing = (cs.letterSpacing === 'normal') ? '0px' : cs.letterSpacing; } catch (e) {}
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end') ? 'right' : 'left';
    /* CSS puts the baseline at half-leading + ascent inside the line box */
    var m = ctx.measureText(text);
    var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    var lh = parseFloat(cs.lineHeight); if (!isFinite(lh)) lh = asc + desc;   /* 'normal' */
    var top = 0;
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      /* flex container (e.g. #hl-title): the text is an anonymous flex item —
         justify-content places it horizontally, align-items vertically */
      var jc = cs.justifyContent;
      ctx.textAlign = jc === 'center' ? 'center' : (jc === 'flex-end' || jc === 'end') ? 'right' : 'left';
      if (cs.alignItems === 'center') top = (h - lh) / 2;
      else if (cs.alignItems === 'flex-end' || cs.alignItems === 'end') top = h - lh;
    }
    var x = ctx.textAlign === 'center' ? w / 2 : ctx.textAlign === 'right' ? w : (parseFloat(cs.paddingLeft) || 0);
    var y = top + (lh - (asc + desc)) / 2 + asc;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    function shape(c, erode) {   /* glyph, optionally shaved `erode` px off its inside edge */
      c.fillText(text, x, y);
      if (erode) {
        c.globalCompositeOperation = 'destination-out';
        c.lineWidth = erode * 2; c.lineJoin = 'round'; c.strokeText(text, x, y);
        c.globalCompositeOperation = 'source-over';
      }
    }
    shape(ctx, mode === 'stroke' ? 0 : RING_PX);
    return { url: cv.toDataURL('image/png'), extra: extra, w: w };
  }

  function renderTitle(el) {
    var L = el.__poGt;
    if (!L || !L.root.isConnected) {
      el.querySelectorAll(':scope > .po-gt').forEach(function (n) { n.remove(); });
      L = el.__poGt = buildLayers(el);
    }
    var fill = drawMask(el, 'fill');
    if (!fill) return;
    var stroke = drawMask(el, 'stroke');
    L.root.style.left  = (-fill.extra) + 'px';
    L.root.style.width = (fill.w + 2 * fill.extra) + 'px';
    setMask(L.fill, fill.url);
    setMask(L.stroke, stroke.url);
  }

  function textTitle(el) {
    if (!el || el.__poGtInit) return;
    el.__poGtInit = true;
    el.classList.add('po-gt-host');
    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; if (isPlayoffs()) renderTitle(el); });
    }
    /* text replaced (applyTwTitle's el.textContent = …) → layers gone → redraw */
    new MutationObserver(function () {
      if (!el.querySelector(':scope > .po-gt') || !el.__poGt || !el.__poGt.root.isConnected) schedule();
      else schedule();
    }).observe(el, { childList: true, characterData: true });
    /* shown (0 → real size) or resized from the Edit tab */
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }

  window.PoGoldText = { imageHeader: imageHeader, textTitle: textTitle };
})();
