/* ── [FEATURE: bpm-meter] "Heart-Stopping Moment" BPM meter ───────────
   Ported from the retired standalone heart_stopping_moment_v14.html page
   into mploverlay_v7 as a checkOverlays-style panel (see
   overlay-debug.js's 'bpmmeter'/'meter' SSE listeners and dashboard.html's
   BPM Meter checkToggle + extraActions in the mploverlay7 OVERLAYS entry).
   See the #bpmmeter-* CSS block in mploverlay_v7.css for the four-layer
   split (position / slide / size-scale / shake) this relies on.

   The old page's "overload" mechanic (mashing + past max eventually
   triggered a dramatic LED-break-and-reset animation) is gone — pressing
   + at max level (10/10) is now a no-op. The strongest rumble + glow-throb
   at max level (already the most intense visual state) is the only
   "maxed out" feedback now.

   Performance: the rAF loop only ever runs while the panel is actually
   shown (`shouldShow`) — while hidden, level changes just update state,
   no DOM writes and no per-frame loop, since this runs alongside every
   other mploverlay_v7 feature. Segment DOM writes are diffed against
   last-committed state (stA/stB) so a steady level costs zero writes. */
(function() {
  const BASE_LEVEL = 10;
  const SEG_GAP = 6, PAD_X = 10, PAD_Y = 8;
  const SHELL_W = 508, SHELL_H = 97, SHELL_BORDER = 2;
  const SLOT_W = 182, SLOT_BORDER = 2, SCALE_H = 21;
  const METER_W = SHELL_W - SLOT_W - SLOT_BORDER - SHELL_BORDER * 2;
  const AVAIL_H = SHELL_H - SHELL_BORDER * 2 - PAD_Y * 2 - SCALE_H;
  const SEG_H   = Math.floor(AVAIL_H / 2);
  const AVAIL_W = METER_W - PAD_X * 2;

  // --- segment count (fills AVAIL_W with the widest even split whose
  // segments stay >=8px) ---
  let SEGS = 1, SEG_W = AVAIL_W;
  { let n = 1;
    while (true) {
      const next = n + 1;
      if (Math.floor((AVAIL_W - (next - 1) * SEG_GAP) / next) < 8) break;
      n = next;
    }
    SEGS = n; SEG_W = Math.floor((AVAIL_W - (n - 1) * SEG_GAP) / n);
  }

  // --- colour table (built once, indexed by segment) ---
  const COLOR_HEX = new Array(SEGS);
  const COLOR_RGB = new Array(SEGS); // "r,g,b" strings for rgba()
  for (let i = 0; i < SEGS; i++) {
    const t = i / (SEGS - 1);
    let r, g, b, h;
    if      (t < 0.55) { r=0;   g=224; b=64;  h='#00e040'; }
    else if (t < 0.68) { r=136; g=238; b=0;   h='#88ee00'; }
    else if (t < 0.78) { r=255; g=221; b=0;   h='#ffdd00'; }
    else if (t < 0.88) { r=255; g=136; b=0;   h='#ff8800'; }
    else               { r=255; g=24;  b=0;   h='#ff1800'; }
    COLOR_HEX[i] = h;
    COLOR_RGB[i] = `${r},${g},${b}`;
  }

  // --- pre-baked static bg strings (off state never changes) ---
  const OFF_BG = COLOR_RGB.map(rgb => `rgba(${rgb},0.10)`);
  const ON_BG  = COLOR_RGB.map(rgb => `rgb(${rgb})`);

  // glow string cache: keyed by "segIndex|throbBucket" (throb quantised
  // to 20 steps at max level, or by level everywhere else)
  const THROB_STEPS = 20;
  const glowCache = new Map();

  function buildGlow(i, throbM) {
    const f = level / BASE_LEVEL;
    const hex = COLOR_HEX[i];
    if (level === BASE_LEVEL) {
      const t = throbM;
      const px0 = (1.5 + t * 4).toFixed(1);
      const px1 = (3 + t * 6).toFixed(1);
      const px2 = (7 + t * 12).toFixed(1);
      const px3 = (12 + t * 18).toFixed(1);
      const wA  = Math.round(t * 0.70 * 255).toString(16).padStart(2,'0');
      const a1 = Math.round((0.55 + t * 0.2) * 255).toString(16).padStart(2,'0');
      const a2 = Math.round((0.25 + t * 0.2) * 255).toString(16).padStart(2,'0');
      const a3 = Math.round((0.08 + t * 0.12) * 255).toString(16).padStart(2,'0');
      return `0 0 ${px0}px 1px #ffffff${wA},0 0 ${px1}px 1px ${hex}${a1},0 0 ${px2}px 3px ${hex}${a2},0 0 ${px3}px 5px ${hex}${a3}`;
    }
    const px1 = (2 + f * 5).toFixed(0);
    const px2 = (6 + f * 14).toFixed(0);
    const a2  = Math.round((0.25 + f * 0.45) * 255).toString(16).padStart(2,'0');
    return `0 0 ${px1}px 1px ${hex},0 0 ${px2}px 2px ${hex}${a2}`;
  }

  function getGlow(i, throbM) {
    if (level === 0) return 'none';
    const bucket = level === BASE_LEVEL ? Math.round(throbM * THROB_STEPS) : level;
    const key = i * 100 + bucket;
    let s = glowCache.get(key);
    if (s === undefined) { s = buildGlow(i, bucket / (level === BASE_LEVEL ? THROB_STEPS : 1)); glowCache.set(key, s); }
    return s;
  }

  // --- DOM ---
  const clip   = document.getElementById('bpmmeter-clip');
  const slide  = document.getElementById('bpmmeter-slide');
  const shell  = document.getElementById('bpmmeter-shell');
  const trackA = document.getElementById('bpmmeter-track-a');
  const trackB = document.getElementById('bpmmeter-track-b');
  const segsA  = [], segsB  = [];
  const stA    = [], stB    = []; // per-segment committed state {on, glowKey}

  function makeSeg() {
    const d = document.createElement('div');
    d.className = 'bpmmeter-seg';
    d.style.width  = SEG_W + 'px';
    d.style.height = SEG_H + 'px';
    return d;
  }

  function buildTrack(track, arr, st) {
    for (let i = 0; i < SEGS; i++) {
      const d = makeSeg();
      d.style.background = OFF_BG[i];
      track.appendChild(d);
      arr.push(d);
      st.push({ on: false, glowKey: -1 });
    }
  }

  function buildScale() {
    const inner = document.getElementById('bpmmeter-scale-inner');
    [-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12].forEach(v => {
      const sp = document.createElement('span');
      sp.className = 'bpmmeter-scale-num';
      sp.textContent = v > 0 ? '+' + v : v;
      inner.appendChild(sp);
    });
  }

  // --- state ---
  let shouldShow = false;
  let level = 0;
  let displayA = 0, displayB = 0;
  let idleTargetA = 0, idleTargetB = 0;
  let rumblePhase = 0, throbPhase = 0, throbMult = 0;

  // idle ticker — rAF-based accumulator, no setInterval
  let lastIdleTime = 0;
  const IDLE_INTERVAL = 30; // ms

  // rAF handle — null when the loop is stopped (hidden, or fully settled)
  let rafId = null;
  function startLoop() { if (rafId === null) rafId = requestAnimationFrame(masterLoop); }
  function stopLoop()  { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

  function forceFullRedraw() {
    for (let i = 0; i < SEGS; i++) {
      stA[i].on = null; stA[i].glowKey = null;
      stB[i].on = null; stB[i].glowKey = null;
    }
  }

  // shell transform dirty tracking — avoids redundant style writes every frame
  let lastShellTransform = '';

  function levelToSegs(lvl) { return Math.round((lvl / BASE_LEVEL) * SEGS); }

  function getRumble() {
    if (level === 0) return null;
    if (level <= 2) return { tx:0.15, ty:0.10, rx:0.04, speed:0.025 };
    if (level <= 4) return { tx:0.30, ty:0.20, rx:0.06, speed:0.04  };
    if (level <= 6) return { tx:0.50, ty:0.35, rx:0.10, speed:0.05  };
    if (level <= 8) return { tx:0.80, ty:0.55, rx:0.14, speed:0.075 };
    if (level <= 9) return { tx:1.25, ty:0.88, rx:0.20, speed:0.11  };
                    return { tx:2.00, ty:1.38, rx:0.35, speed:0.20  };
  }

  // --- render: only write to DOM when a value actually changed ---
  function updateTrack(segs, st, vis, throbM) {
    const bucket = level === BASE_LEVEL ? Math.round(throbM * THROB_STEPS) : level;
    for (let i = 0; i < SEGS; i++) {
      const on = i < vis;
      const glowKey = on ? bucket : -1;
      const s = st[i];
      if (s.on === on && s.glowKey === glowKey) continue; // nothing changed
      const el = segs[i];
      if (s.on !== on)           el.style.background = on ? ON_BG[i] : OFF_BG[i];
      if (s.glowKey !== glowKey) el.style.boxShadow  = on ? getGlow(i, throbM) : 'none';
      s.on = on; s.glowKey = glowKey;
    }
  }

  function render(throbM) {
    updateTrack(segsA, stA, Math.round(displayA), throbM);
    updateTrack(segsB, stB, Math.round(displayB), throbM);
  }

  // --- master loop (single rAF, no setInterval) — only ever scheduled
  // while shouldShow is true (see startLoop() call sites below) ---
  let idleTick = 0;
  function masterLoop(ts) {
    rafId = null;
    if (!shouldShow) return;

    // rumble (shake)
    const p = getRumble();
    let dx = 0, dy = 0, rot = 0;
    if (p) {
      rumblePhase += p.speed;
      dx  = Math.sin(rumblePhase * 7.3)  * p.tx + Math.sin(rumblePhase * 13.1) * p.tx * 0.5;
      dy  = Math.sin(rumblePhase * 9.7)  * p.ty + Math.sin(rumblePhase * 17.3) * p.ty * 0.4;
      rot = Math.sin(rumblePhase * 5.9)  * p.rx;
    }
    if (dx === 0 && dy === 0 && rot === 0) {
      if (lastShellTransform !== 'none') { shell.style.transform = 'none'; lastShellTransform = 'none'; }
    } else {
      const tr = `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
      if (tr !== lastShellTransform) { shell.style.transform = tr; lastShellTransform = tr; }
    }

    // throb (glow pulse) — only at max level now, nothing else drives it
    if (level === BASE_LEVEL) {
      throbPhase += 0.065;
      const fast  = Math.sin(throbPhase * 3.1);
      const slow  = Math.sin(throbPhase * 1.1);
      const spike = Math.pow(Math.max(0, Math.sin(throbPhase * 1.7)), 3) * 0.6;
      const raw   = fast * 0.5 + slow * 0.35 + spike + 0.15;
      throbMult = Math.min(1, Math.max(0, raw));
    }

    // idle drift (rate-limited inside rAF — no setInterval)
    if (ts - lastIdleTime >= IDLE_INTERVAL) {
      lastIdleTime = ts;
      idleTick++;
      if (level === BASE_LEVEL) {
        displayA = displayB = SEGS;
      } else {
        if (idleTick % 26 === 0) {
          const base   = levelToSegs(level);
          const jitter = level === 0 ? 0 : Math.max(1, Math.round(level * 0.22));
          const flip   = () => (Math.random() < 0.5 ? -1 : 1) * jitter * (Math.random() < 0.65 ? 1 : 0);
          idleTargetA  = Math.max(0, Math.min(SEGS, base + flip()));
          idleTargetB  = Math.max(0, Math.min(SEGS, base + flip()));
        }
        displayA += (idleTargetA - displayA) * 0.2;
        displayB += (idleTargetB - displayB) * 0.2;
      }
    }

    render(throbMult);

    if (level > 0 || Math.round(displayA) > 0 || Math.round(displayB) > 0) rafId = requestAnimationFrame(masterLoop);
  }

  function setLevel(v) {
    level = Math.max(0, Math.min(BASE_LEVEL, v));
    glowCache.clear();
    if (level === BASE_LEVEL) {
      idleTargetA = idleTargetB = displayA = displayB = SEGS;
    } else {
      idleTargetA = idleTargetB = levelToSegs(level);
      throbPhase = 0; throbMult = 0;
    }
    if (!shouldShow) return; // state still tracked, just no DOM/loop cost while hidden
    if (level === 0 && lastShellTransform !== 'none') { shell.style.transform = 'none'; lastShellTransform = 'none'; }
    render(0);
    startLoop();
  }

  // Pressing + at max level is now a plain no-op — no more overload/break.
  // While hidden, +/- are fully ignored — not just skipped-rendering, the
  // command never touches `level`/idle-targets/glowCache at all, so a
  // pile of presses sent while hidden can't silently accumulate and pop
  // out at some unexpected level next time it's shown.
  function bpmmeterPressPlus()  { if (!shouldShow) return; if (level < BASE_LEVEL) setLevel(level + 1); }
  function bpmmeterPressMinus() { if (!shouldShow) return; setLevel(level - 1); }
  // Not guarded the same way — this IS the reset mechanism itself, also
  // used internally by bpmmeterAnimateOut() below after shouldShow is
  // already false, so it has to keep working while hidden.
  function bpmmeterPressClear() { forceFullRedraw(); setLevel(0); }

  // --- slide in / out ---
  let hideTimer = null;

  function bpmmeterAnimateIn() {
    shouldShow = true;
    clearTimeout(hideTimer);
    // Sync visuals to whatever `level` already is before revealing, so
    // there's no visible pop/flash of stale state from before it was hidden.
    forceFullRedraw();
    render(0);
    clip.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      slide.classList.add('bpmmeter-in');
    }));
    startLoop();
  }

  function bpmmeterAnimateOut() {
    // Stop all operation right away — shouldShow=false makes the rAF
    // loop's own top-of-frame check bail on its very next tick, but a
    // frame can already be in flight (requestAnimationFrame scheduled,
    // not yet fired), so cancel it outright too instead of waiting for
    // that one wasted callback. From this point on nothing is drawing,
    // shaking, or throbbing — the panel is fully off, not just invisible.
    shouldShow = false;
    stopLoop();
    slide.classList.remove('bpmmeter-in');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      clip.style.display = 'none';
      // Reset everything (level back to 0, every segment's committed
      // on/glow state cleared) only after the slide-out finishes, so the
      // reset itself is never visible — by the time anything's actually
      // zeroed, the panel is already off-canvas.
      bpmmeterPressClear();
    }, 420);
  }

  buildScale();
  buildTrack(trackA, segsA, stA);
  buildTrack(trackB, segsB, stB);
  setLevel(0);

  window.bpmmeterAnimateIn   = bpmmeterAnimateIn;
  window.bpmmeterAnimateOut  = bpmmeterAnimateOut;
  window.bpmmeterPressPlus   = bpmmeterPressPlus;
  window.bpmmeterPressMinus  = bpmmeterPressMinus;
  window.bpmmeterPressClear  = bpmmeterPressClear;
})();
