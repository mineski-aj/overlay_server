/* ── [FEATURE: goldgraph-check] ─────────────────────────────────────
   Same fixed-clip / sliding-inner pattern as item-check. Background is
   assets/ingame/graphbarback.png (887×282 — see the CSS block in
   mploverlay_v7.css for the exact layout). Inside it,
   .ggc-rect (the pasted .Rectangle_1 spec: 15,15, 857×253) is the white
   plotting canvas an SVG gold-difference chart draws into — same
   area/line-chart technique as mplfs.html's Consolidated Post graph
   (renderCpgChart / #cpg-chart), reused here with differences the user
   asked for:
     1. No separate Lord/Turtle/Tower/Kill rows below the chart — every
        event is drawn AS AN ICON in one of 4 fixed horizontal rows
        (Lord/Turtle/Tower in the outer top/bottom rows split by camp,
        Kills in the two inner rows) instead of its own labeled row —
        see ggcRowY()/the ggc-row-* markers below.
     2. Whole-game view, same as Consolidated Post — x-axis always runs
        0:00 to "now" (the latest tick in the fetch, which IS the point
        of pressing SHOW/each 500ms poll tick, since data is fetched
        fresh every time — see ggcFetchData()). This USED to be a
        rolling 5-minute window instead; changed back to match
        Consolidated Post because a sliding window was confusing to
        read live. 5 evenly-spaced time marks (0% / 25% / 50% / 75% /
        100% of the whole game) instead of Consolidated Post's 6, each
        rounded to the nearest minute and drawn as a dark-grey box with
        white text instead of plain fill text.
     3. Gold-diff numbers get a white stroke (.ggc-diff-label CSS) and
        render above the line/area/events (see the final template at
        the bottom of ggcRenderChart) instead of underneath them.
   Data: /positions' gold field aggregated per camp per RAW tick for the
   line, /events' lord/turtle/tower/kill entries for the icons.
   Deliberately NOT downsampled onto Consolidated Post's 30s grid — the
   line is smoothed instead (see GGC_SMOOTH_RADIUS_S), which keeps the
   per-second noise that makes the line look "alive" while taking the
   edge off single-tick spikes, rather than discarding data outright.
   Live: re-fetched and redrawn every 500ms while shown (ggcAnimateIn
   starts a setInterval, ggcAnimateOut clears it) — NOT a one-shot
   snapshot. */
const GGC_LEFT = 46, GGC_RIGHT = 845;
const GGC_CHART_TOP = 14, GGC_CHART_BOTTOM = 194;
const GGC_TIME_BOX_TOP = 211, GGC_TIME_BOX_H = 24, GGC_TIME_BOX_W = 63; /* +50% over the original 16×42 */
const GGC_MARK_COUNT = 5; /* including both 0:00 and the point of pressing */
const GGC_LABEL_MARGIN = 22; /* keeps a .ggc-diff-label's text-anchor=middle box from clipping past GGC_LEFT/GGC_RIGHT when its mark sits right at the chart's edge (roughly half a "X.Xk" label's width at 16.5px) */
const GGC_BLUE = '#5096d7', GGC_RED = '#f41100'; /* line/area chart + axis/diff labels */
const GGC_ICON_BLUE = '#143ffc', GGC_ICON_RED = '#ee2626'; /* event icons/X marks on the line — deliberately a different, more saturated pair than the line chart's own colors */
const GGC_ICONS = {
  lord:   '/assets/consolidated_post/consolord.png',
  turtle: '/assets/consolidated_post/consoturtle.png',
  tower:  '/assets/consolidated_post/consotower.png',
};
const GGC_EVENT_TYPES = ['lord', 'turtle', 'tower', 'kill']; /* same event scope as Consolidated Post's graph — assist/death are excluded there too */
const GGC_LINE_POINTS = 160; /* fixed sample count for the plotted line/area — see ggcResample below for why this needs to be constant */
const GGC_REVEAL_DELAY = 350; /* matches #gold-graph-check-overlay's own slide-in transition duration — same idea as Gold Diff Check's GDC_REVEAL_DELAY: the header title's bounce+sheen flourish (ggcPlayHeaderFlourish) fires once the slide has actually finished, not before */
const GGC_EVENTS_STAGGER_MS = 300; /* spread of the left-to-right event-icon fade-in, on top of GGC_REVEAL_DELAY — rightmost icon starts fading GGC_REVEAL_DELAY+this ms after show */
const GGC_EVENTS_FADE_MS    = 400; /* each icon's own fade-in duration */
const GGC_EVENTS_REVEAL_WINDOW_MS = GGC_REVEAL_DELAY + GGC_EVENTS_STAGGER_MS + GGC_EVENTS_FADE_MS + 100; /* +100ms slack before #ggc-events is safe to rebuild again — see ggcEventsRevealApplied below */
/* Smoothing radius (seconds) for the raw per-second series — a centered
   moving average, NOT a poll-rate thing (the 500ms live refresh redraws
   the SAME underlying per-second data more often; it doesn't add data,
   so polling faster can't smooth anything). Full raw resolution (no
   smoothing at all) reads as "spiky" — every single-tick gold blip
   (creep block landing, a canceled recall) shows as its own needle.
   This averages each point against its neighbors within ±this many
   seconds, trading a little of that spikiness for a still-organic (not
   flattened, unlike the old 30s-grid decimation) line.
   Mutable (not a const) + dashboard-Edit-tunable ("Spike Smoothing" on
   #ggc-chart) — same cross-frame direct-call pattern as mplfs.html's
   #mv-hero-img Feather/Intensity, since a smoothing radius isn't a real
   CSS property so it can't go through the normal style-inject path. */
let ggcSmoothRadius = 3;
window.ggcSetSmoothRadius = function(v) {
  const n = parseFloat(v);
  if (!isNaN(n) && n >= 0) ggcSmoothRadius = n;
};
(function loadGgcSmoothRadius() {
  fetch('/api/overlay-styles?file=mploverlay_v7')
    .then(r => r.json())
    .then(styles => {
      const v = styles && styles['#ggc-chart'] && styles['#ggc-chart'].smoothRadius;
      const n = parseFloat(v);
      if (!isNaN(n) && n >= 0) ggcSmoothRadius = n;
    })
    .catch(() => {});
})();

let ggcShouldShow = false;
let ggcOutTimer    = null;
let ggcPollTimer   = null; // live-refresh while shown — see ggcAnimateIn/Out
let ggcRevealTimer = null; // header title's bounce+sheen flourish, fired once the slide-in finishes — see ggcPlayHeaderFlourish
/* Event-icon left-to-right fade-in, synced with the header flourish —
   see the events block in ggcRenderChart. ggcEventsRevealArmed is true
   for the whole GGC_EVENTS_REVEAL_WINDOW_MS after a fresh show;
   ggcEventsRevealApplied flips true the FIRST time that window's fade
   markup actually gets drawn, and gates every render after that (while
   still armed) to skip touching #ggc-events entirely — a 500ms poll
   tick landing mid-window would otherwise innerHTML-rebuild the icons
   using an ordinary <g> rebuild before their queued CSS animation-delay
   even started, silently cancelling the still-pending stagger for
   whichever icons hadn't started fading in yet. */
let ggcEventsRevealArmed   = false;
let ggcEventsRevealApplied = false;
let ggcEventsRevealTimer   = null;
let ggcDuration     = 1; // seconds — module-scope so ggcInterpolate/event placement can read it without threading it through

function ggcFmtDiff(v) {
  // Always the magnitude, never a sign — which team is ahead is already
  // shown by the dot/number's own color (blue/red) and which side of the
  // zero line it's on, so a "-" here would just be redundant/confusing.
  return (Math.abs(v) / 1000).toFixed(1) + 'k';
}

function ggcInterpolate(series, t) {
  if (!series.length) return 0;
  if (t <= series[0].t) return series[0].diff;
  const last = series[series.length - 1];
  if (t >= last.t) return last.diff;
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i], b = series[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = (b.t === a.t) ? 0 : (t - a.t) / (b.t - a.t);
      return a.diff + (b.diff - a.diff) * frac;
    }
  }
  return last.diff;
}

// Centered moving average within ±radiusSeconds — assumes series is
// sorted by t ascending (always true here, built from sorted allTicks).
// O(n·window), fine at this size (a 300s window is at most ~300 points).
function ggcSmoothSeries(series, radiusSeconds) {
  if (series.length < 3) return series;
  return series.map((pt, i) => {
    let sum = 0, count = 0;
    for (let j = i; j >= 0 && pt.t - series[j].t <= radiusSeconds; j--) { sum += series[j].diff; count++; }
    for (let j = i + 1; j < series.length && series[j].t - pt.t <= radiusSeconds; j++) { sum += series[j].diff; count++; }
    return { t: pt.t, diff: sum / count };
  });
}

// Fixed-count resample across [from, to] via ggcInterpolate — used only
// for the drawn line/area, NOT for marks/events (which stay accurate to
// the real data via ggcInterpolate directly). This exists purely so the
// path's `d` has the EXACT SAME number of "L" commands on every single
// render: Chromium only smoothly interpolates a CSS `transition: d`
// between two path values when their command counts match — with the
// raw (variable-length, ~1 new point/sec) series, point count would
// drift tick to tick and the transition would silently fall back to an
// instant snap on any tick where it didn't match. A fixed count makes
// every tick eligible to glide.
function ggcResample(series, from, to, count) {
  const span = Math.max(1, to - from);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = from + (i / (count - 1)) * span;
    out[i] = { t, diff: ggcInterpolate(series, t) };
  }
  return out;
}

function ggcBuildPanel() {
  const overlay = document.getElementById('gold-graph-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'ggc-bg';
  bg.src = '/assets/ingame/graphbarback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  /* Header — plain siblings of .ggc-bg inside the same overlay, not a
     separately-animated element (see the CSS comment above
     #gold-graph-check-clip: this whole panel, header included, slides
     in as ONE unit, same shape as Gold Diff Check's own header-shaped
     reserved space at the top of its one #golddiff-check-overlay).
     Tricode/logo content comes from the live game poll (ggcHeaderUpdate
     below), same camp1/camp2 team_simple_name source as the scoreboard's
     own #scoreboard-tricode-c1/c2 and #sb-logo-c1/c2. */
  const headerBg = document.createElement('img');
  headerBg.className = 'ggc-header-bg';
  headerBg.src = '/assets/ingame/graph_header.png';
  headerBg.alt = '';
  overlay.appendChild(headerBg);

  // Text in its own child span (not the box's own textContent) so the
  // sheen div below can be a sibling instead of getting wiped out —
  // same shape as golddiff-check's .gdc-smart chip (.gdc-smart-img +
  // .gdc-smart-sheen), just text instead of an image for the base layer.
  const headerTitle = document.createElement('div');
  headerTitle.id = 'ggc-header-title';
  headerTitle.className = 'ggc-header-title';
  const headerTitleText = document.createElement('span');
  headerTitleText.textContent = 'GOLD & EVENTS TIMELINE';
  const headerTitleSheen = document.createElement('div');
  headerTitleSheen.className = 'ggc-header-title-sheen';
  headerTitle.appendChild(headerTitleText);
  headerTitle.appendChild(headerTitleSheen);
  overlay.appendChild(headerTitle);

  const headerTri1 = document.createElement('div');
  headerTri1.id = 'ggc-header-tri-c1';
  headerTri1.className = 'ggc-header-tri';
  overlay.appendChild(headerTri1);

  const headerTri2 = document.createElement('div');
  headerTri2.id = 'ggc-header-tri-c2';
  headerTri2.className = 'ggc-header-tri';
  overlay.appendChild(headerTri2);

  // Fallback-circle-until-loaded wrapper — same shape as buildScoreboard's
  // #sb-logo-c1/c2 in overlay-scoreboard.js, own classes/sizing (see the
  // CSS comment on #ggc-header-logo-c1/c2 for why it's not reused as-is).
  ['ggc-header-logo-c1', 'ggc-header-logo-c2'].forEach(id => {
    const wrap = document.createElement('div');
    wrap.id = id;
    const fb = document.createElement('div');
    fb.className = 'ggc-header-logo-fallback';
    const img = document.createElement('img');
    img.className = 'ggc-header-logo-img';
    img.alt = '';
    img.style.display = 'none';
    img.onload  = () => { img.style.display = 'block'; fb.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none';  fb.style.display = ''; };
    wrap.appendChild(fb);
    wrap.appendChild(img);
    overlay.appendChild(wrap);
  });

  const rect = document.createElement('div');
  rect.className = 'ggc-rect';
  rect.id = 'ggc-rect';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'ggc-chart');
  svg.setAttribute('class', 'ggc-chart');
  svg.setAttribute('viewBox', '0 0 857 253');

  /* Persistent skeleton — built ONCE here, then only ATTRIBUTES (or, for
     <line>/<text> — see the CSS comment above #ggc-zeroline —
     style.transform) are touched on every render (see ggcRenderChart).
     This is what makes the transition rules in mploverlay_v7.css
     actually animate: a CSS transition only has something to glide FROM
     when the same element instance persists across updates. The old
     approach (one big `svg.innerHTML = …` rebuild every poll tick)
     destroyed and recreated every node each time, so the browser had no
     previous state to interpolate from and the whole chart visibly
     snapped to its new shape every 500ms instead of flowing into it.
     #ggc-events (variable count — events accumulate over the game) and
     the "Spike Smoothing" setting stay dynamic/JS-only; everything
     else that's drawn is a fixed, always-present set of elements. */
  svg.innerHTML = `
    <defs>
      <linearGradient id="ggcGrad" gradientUnits="userSpaceOnUse" x1="${GGC_LEFT}" y1="0" x2="${GGC_RIGHT}" y2="0"></linearGradient>
      <filter id="ggcTintBlue" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="${GGC_ICON_BLUE}"></feFlood>
        <feComposite in2="SourceGraphic" operator="in"></feComposite>
      </filter>
      <filter id="ggcTintRed" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="${GGC_ICON_RED}"></feFlood>
        <feComposite in2="SourceGraphic" operator="in"></feComposite>
      </filter>
    </defs>
    <text id="ggc-axis-max" class="ggc-axis-label" x="${GGC_LEFT - 8}" y="${GGC_CHART_TOP + 8}" text-anchor="end"></text>
    <text id="ggc-axis-zero" class="ggc-axis-label" x="${GGC_LEFT - 8}" y="0" text-anchor="end">0</text>
    <path id="ggc-area" fill="url(#ggcGrad)" opacity="0.18"></path>
    <path id="ggc-line" fill="none" stroke="url(#ggcGrad)" stroke-width="2.7"></path>
    <line id="ggc-zeroline" x1="${GGC_LEFT}" x2="${GGC_RIGHT}" y1="0" y2="0" stroke="rgba(0,0,0,0.25)" stroke-width="1"></line>
    <g id="ggc-events"></g>
    <g id="ggc-marks"></g>
  `;

  // 5 persistent mark groups (gridline + timebox + time label + dot +
  // diff number) — GGC_MARK_COUNT never varies, so unlike events these
  // can be built once and just have attributes updated in place.
  //
  // .ggc-mark-gridline/.ggc-time-label/.ggc-diff-label keep whichever of
  // their x/y SVG attributes never actually changes as a real fixed
  // attribute (baked in once here), and start whichever axis DOES move
  // at a 0 baseline — ggcRenderChart moves them via `style.transform:
  // translate(...)` instead of re-setting that attribute every render,
  // since <line>'s x1/x2/y1/y2 and <text>'s x/y aren't CSS-animatable
  // (see the CSS comment above #ggc-zeroline) but `transform` is.
  const marksGroup = svg.querySelector('#ggc-marks');
  for (let i = 0; i < GGC_MARK_COUNT; i++) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'ggc-mark');
    g.innerHTML = `
      <line class="ggc-mark-gridline" x1="0" x2="0" y1="${GGC_CHART_TOP}" y2="${GGC_TIME_BOX_TOP}" stroke="rgba(0,0,0,0.1)" stroke-width="1"></line>
      <rect class="ggc-timebox" y="${GGC_TIME_BOX_TOP}" width="${GGC_TIME_BOX_W}" height="${GGC_TIME_BOX_H}" rx="3" fill="#333333"></rect>
      <text class="ggc-time-label" x="0" y="${GGC_TIME_BOX_TOP + GGC_TIME_BOX_H / 2 + 5.25}" text-anchor="middle"></text>
      <circle class="ggc-diff-dot" fill="#fff"></circle>
      <text class="ggc-diff-label" x="0" y="0" text-anchor="middle"></text>
    `;
    marksGroup.appendChild(g);
  }

  rect.appendChild(svg);

  /* Row markers — NOT drawn themselves, just draggable-in-the-dashboard-
     Edit-tab position references. Real DOM children of .ggc-rect (same
     857×253 box the SVG's viewBox maps 1:1 to px), so their computed
     `top` can be read directly as an SVG y-coordinate with no unit
     conversion. Default position comes from mploverlay_v7.css; a saved
     dashboard-Edit override applies the normal way (a `!important` CSS
     rule on the same #id, via loadSbOverrides()/applyToEditIframe()) —
     nothing here needs to know whether a row has been moved. */
  ['ggc-row-lord-top', 'ggc-row-kill-top', 'ggc-row-kill-bottom', 'ggc-row-lord-bottom'].forEach(id => {
    const marker = document.createElement('div');
    marker.id = id;
    marker.className = 'ggc-row-marker';
    rect.appendChild(marker);
  });

  overlay.appendChild(rect);
}
ggcBuildPanel();

// Header tricode/logo — driven by the live game poll, not gated on
// ggcShouldShow (same as the always-on scoreboard's own registerPollHandler
// in overlay-scoreboard.js) so the panel never flashes stale team info for
// a tick right after it's shown; the cost of updating 2 text nodes + an
// img src comparison every ~1s poll is negligible either way.
registerPollHandler(function(data) {
  const camps = data.camp_list || [];
  const c1 = camps.find(c => c.campid === 1);
  const c2 = camps.find(c => c.campid === 2);

  const t1 = document.getElementById('ggc-header-tri-c1');
  const t2 = document.getElementById('ggc-header-tri-c2');
  if (t1 && c1) { const n = c1.team_simple_name || ''; if (n) t1.textContent = n.toUpperCase(); }
  if (t2 && c2) { const n = c2.team_simple_name || ''; if (n) t2.textContent = n.toUpperCase(); }

  [['ggc-header-logo-c1', c1], ['ggc-header-logo-c2', c2]].forEach(([id, c]) => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    const img  = wrap.querySelector('.ggc-header-logo-img');
    const name = c ? (c.team_simple_name || '').toUpperCase() : '';
    if (img && name && img.dataset.team !== name) {
      img.dataset.team  = name;
      img.style.display = 'none';
      img.src = '/logos/' + name + '.png';
    }
  });
});

function ggcRowY(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(getComputedStyle(el).top);
  return Number.isFinite(v) ? v : fallback;
}

function ggcRenderChart(fullSeries, fullEvents) {
  const svg = document.getElementById('ggc-chart');
  if (!svg) return;
  if (!fullSeries.length) return; /* nothing recorded yet — leave the persistent elements at whatever (blank, pre-first-render) state they're already in */

  // Whole game, 0:00 to "now" = the latest tick in the fetch — since
  // ggcFetchData() re-fetches fresh every time (every 500ms while shown),
  // "now" is always the live edge. windowStart is always 0 (kept as a
  // named constant rather than inlined below since it still does real
  // work: if the game's first recorded tick isn't exactly at t=0,
  // interpolating/prepending a point AT 0 keeps the area fill's left
  // edge flush instead of starting mid-air at the first tick's x.
  const now         = fullSeries[fullSeries.length - 1].t || 0;
  const windowStart = 0;
  const windowStartDiff = ggcInterpolate(fullSeries, windowStart);
  let series = fullSeries.filter(s => s.t >= windowStart);
  if (!series.length || series[0].t > windowStart + 0.001) {
    series = [{ t: windowStart, diff: windowStartDiff }, ...series];
  }
  const events = fullEvents.filter(e => e.time_s >= windowStart && e.time_s <= now);

  ggcDuration = now || 1; /* right edge of the chart, in absolute game-time seconds */
  const diffs  = series.map(s => s.diff);
  const rawMax = Math.max(...diffs, 0);
  const rawMin = Math.min(...diffs, 0);
  const pad    = Math.max((rawMax - rawMin) * 0.15, 500);
  const yMax   = rawMax + pad;
  const yMin   = rawMin - pad;

  const windowSpan = Math.max(1, ggcDuration - windowStart);
  const xScale = t => GGC_LEFT + ((t - windowStart) / windowSpan) * (GGC_RIGHT - GGC_LEFT);
  const yScale = v => GGC_CHART_BOTTOM - ((v - yMin) / (yMax - yMin)) * (GGC_CHART_BOTTOM - GGC_CHART_TOP);
  const zeroY  = yScale(0);

  // Fixed-count resample for the drawn line/area only (marks/events below
  // still read the real series via ggcInterpolate) — see ggcResample for
  // why this needs to be a constant count.
  const plotSeries = ggcResample(series, windowStart, ggcDuration, GGC_LINE_POINTS);
  const linePts = plotSeries.map(s => `${xScale(s.t).toFixed(1)},${yScale(s.diff).toFixed(1)}`);
  const lineD   = 'M' + linePts.join(' L');
  const areaD   = `${lineD} L${xScale(ggcDuration).toFixed(1)},${zeroY.toFixed(1)} L${xScale(windowStart).toFixed(1)},${zeroY.toFixed(1)} Z`;
  document.getElementById('ggc-line').setAttribute('d', lineD);
  document.getElementById('ggc-area').setAttribute('d', areaD);

  // Gradient color-switches exactly at zero-crossings — same technique as
  // mplfs.html's renderCpgChart (Desktop/gold_difference_zero_line.html).
  // Computed against plotSeries (not the raw series) so the crossing
  // points line up exactly with what's actually drawn.
  const stops = [];
  let isBlue = plotSeries[0].diff >= 0;
  stops.push({ x: xScale(windowStart), blue: isBlue });
  for (let i = 0; i < plotSeries.length - 1; i++) {
    const a = plotSeries[i].diff, b = plotSeries[i + 1].diff;
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      const frac = a / (a - b);
      const tCross = plotSeries[i].t + frac * (plotSeries[i + 1].t - plotSeries[i].t);
      const x = xScale(tCross);
      stops.push({ x: x - 0.5, blue: isBlue });
      isBlue = !isBlue;
      stops.push({ x: x + 0.5, blue: isBlue });
    }
  }
  stops.push({ x: xScale(ggcDuration), blue: isBlue });
  document.getElementById('ggcGrad').innerHTML = stops.map(s => {
    const frac = Math.max(0, Math.min(1, (s.x - GGC_LEFT) / (GGC_RIGHT - GGC_LEFT)));
    return `<stop offset="${frac.toFixed(4)}" stop-color="${s.blue ? GGC_BLUE : GGC_RED}"></stop>`;
  }).join('');

  // x1/x2/y1/y2 stay at their fixed baseline (set once in ggcBuildPanel)
  // — only the vertical position actually varies, via transform (see the
  // CSS comment above #ggc-zeroline for why: <line>'s y1/y2 aren't
  // CSS-animatable, but transform is).
  document.getElementById('ggc-zeroline').style.transform = `translateY(${zeroY.toFixed(1)}px)`;

  const axisMax = document.getElementById('ggc-axis-max');
  axisMax.textContent = (yMax / 1000).toFixed(0) + 'K'; /* position never changes — no transform needed, just content */
  document.getElementById('ggc-axis-zero').style.transform = `translateY(${(zeroY + 4).toFixed(1)}px)`;

  // 5 evenly-spaced time marks spanning the whole game (0%, 25%, 50%,
  // 75%, 100% of 0:00→now — always includes both 0:00 and the point of
  // pressing), each rounded to the nearest minute of absolute game time.
  // Updates the 5 persistent .ggc-mark groups built once in
  // ggcBuildPanel (instead of rebuilding them from scratch) so their
  // gridline/timebox/label/dot/number can all glide via CSS transition
  // between polls instead of snapping.
  const markEls = svg.querySelectorAll('.ggc-mark');
  for (let i = 0; i < GGC_MARK_COUNT; i++) {
    const frac       = i / (GGC_MARK_COUNT - 1);
    const rawT       = windowStart + frac * (ggcDuration - windowStart);
    const minuteMark = Math.round(rawT / 60);
    const t          = Math.max(windowStart, Math.min(ggcDuration, minuteMark * 60));
    const x          = xScale(t);
    const diffAtT    = ggcInterpolate(series, t);
    const y          = yScale(diffAtT);
    /* Diff-label color: blue side uses the same icon blue (#143ffc) as
       the event markers, not the line/area chart's own lighter blue
       (GGC_BLUE) — a deliberate one-sided request, red side is unchanged. */
    const diffLabelColor = diffAtT >= 0 ? GGC_ICON_BLUE : GGC_RED;
    const labelY = Math.max(GGC_CHART_TOP + 10, y - 10);
    const boxX   = Math.max(GGC_LEFT, Math.min(GGC_RIGHT - GGC_TIME_BOX_W, x - GGC_TIME_BOX_W / 2));
    /* The number's own text-anchor="middle" box can hang past GGC_RIGHT
       (clipped by .ggc-rect's edge) when its mark sits at/near the
       chart's right edge — nudge ONLY the label left in that case, same
       clamp idea as boxX above for the time-box. The dot stays at the
       real, unclamped point (x) — it's small enough to never clip, and
       it's what's actually marking the data. */
    const labelX = Math.max(GGC_LEFT + GGC_LABEL_MARGIN, Math.min(GGC_RIGHT - GGC_LABEL_MARGIN, x));

    const g = markEls[i];
    // <line>'s x1/x2 aren't CSS-animatable — moved via transform instead
    // (x1/x2 stay at their fixed "0" baseline from ggcBuildPanel).
    g.querySelector('.ggc-mark-gridline').style.transform = `translateX(${x.toFixed(1)}px)`;

    const timebox = g.querySelector('.ggc-timebox');
    timebox.setAttribute('x', boxX.toFixed(1));

    // <text>'s x/y aren't CSS-animatable either — y is fixed at build
    // time (it never actually changes for this element), so only x
    // needs a transform.
    const timeLabel = g.querySelector('.ggc-time-label');
    timeLabel.style.transform = `translateX(${(boxX + GGC_TIME_BOX_W / 2).toFixed(1)}px)`;
    timeLabel.textContent = minuteMark + 'Min.';

    /* Dot marks the exact (t, diffAtT) point the number is labeling —
       size/stroke editable via .ggc-diff-dot in dashboard Edit
       (GGC_DEFAULTS). cx/cy ARE CSS-animatable on <circle>, so these
       stay plain attributes. */
    const dot = g.querySelector('.ggc-diff-dot');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('stroke', diffLabelColor);

    const label = g.querySelector('.ggc-diff-label');
    label.style.transform = `translate(${labelX.toFixed(1)}px, ${labelY.toFixed(1)}px)`;
    label.setAttribute('fill', diffLabelColor);
    label.textContent = ggcFmtDiff(diffAtT);
  }

  // Events sit in one of 4 fixed horizontal rows instead of directly on
  // the line — Lord/Turtle/Tower in the outer top/bottom rows (top for
  // camp1/blue, bottom for camp2/red), Kills in the two inner rows
  // (between each outer row and the middle). Row Y comes from the
  // ggc-row-* marker elements (mploverlay_v7.css defaults, draggable via
  // the dashboard Edit tab — see ggcRowY above), not from the line's
  // value at that instant. Still a plain innerHTML rebuild (not
  // persistent+transitioned like the line/marks above) — the event
  // count grows over the game, so there's no fixed identity to update
  // in place the way there is for the always-5 marks.
  const rowObjTop    = ggcRowY('ggc-row-lord-top', 30);
  const rowKillTop    = ggcRowY('ggc-row-kill-top', 75);
  const rowKillBottom = ggcRowY('ggc-row-kill-bottom', 133);
  const rowObjBottom  = ggcRowY('ggc-row-lord-bottom', 178);

  const eventsEl = document.getElementById('ggc-events');
  if (ggcEventsRevealArmed && ggcEventsRevealApplied) {
    /* Reveal is still playing out from the first render — see the big
       comment on ggcEventsRevealArmed above. Leave the already-fading
       icons alone instead of rebuilding over them. */
    return;
  }

  let eventsSvg = '';
  events
    .filter(e => GGC_EVENT_TYPES.includes(e.type) && (e.camp === 'camp1' || e.camp === 'camp2'))
    .forEach(e => {
      const x       = xScale(Math.max(windowStart, Math.min(ggcDuration, e.time_s)));
      const color   = e.camp === 'camp1' ? GGC_ICON_BLUE : GGC_ICON_RED;
      const isCamp1 = e.camp === 'camp1';
      const y = e.type === 'kill'
        ? (isCamp1 ? rowKillTop : rowKillBottom)
        : (isCamp1 ? rowObjTop  : rowObjBottom);
      /* Left-to-right staggered fade-in, timed to start alongside the
         header title's bounce+sheen (GGC_REVEAL_DELAY) — only applied
         on the reveal render itself; every ordinary poll-tick update
         (ggcEventsRevealArmed false) draws icons at full opacity with
         no animation, same as before this feature existed. */
      const revealStyle = ggcEventsRevealArmed
        ? (() => {
            const frac  = Math.max(0, Math.min(1, (x - GGC_LEFT) / (GGC_RIGHT - GGC_LEFT)));
            const delay = GGC_REVEAL_DELAY + frac * GGC_EVENTS_STAGGER_MS;
            return ` style="opacity:0;animation:ggc-event-fadein ${GGC_EVENTS_FADE_MS}ms ease-out ${delay.toFixed(0)}ms forwards"`;
          })()
        : '';
      if (e.type === 'kill') {
        /* X mark, no halo — 25% bigger than the original 8px (half-width
           4) / 2px-stroke mark. */
        eventsSvg += `<path${revealStyle} d="M${(x-5).toFixed(1)},${(y-5).toFixed(1)} L${(x+5).toFixed(1)},${(y+5).toFixed(1)} `
                   + `M${(x-5).toFixed(1)},${(y+5).toFixed(1)} L${(x+5).toFixed(1)},${(y-5).toFixed(1)}" `
                   + `stroke="${color}" stroke-width="2.5" stroke-linecap="round"></path>`;
      } else {
        /* Lord/Turtle/Tower icon, no halo — 25% bigger than the original
           12px, then a further +30% on top of that (19.5px total). */
        const tintFilter = e.camp === 'camp1' ? 'url(#ggcTintBlue)' : 'url(#ggcTintRed)';
        eventsSvg += `<image${revealStyle} x="${(x-9.75).toFixed(2)}" y="${(y-9.75).toFixed(2)}" width="19.5" height="19.5" href="${GGC_ICONS[e.type]}" filter="${tintFilter}"></image>`;
      }
    });
  eventsEl.innerHTML = eventsSvg;
  if (ggcEventsRevealArmed) ggcEventsRevealApplied = true;
}

let ggcFetchInFlight = false; // skip a poll tick rather than pile up if a fetch is still resolving

async function ggcFetchData() {
  if (ggcFetchInFlight) return;
  ggcFetchInFlight = true;
  try {
    const [posR, evR] = await Promise.allSettled([
      fetch('/positions', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/events', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!ggcShouldShow) return; /* hidden again while we were fetching */
    const posLog = posR.value?.positions || [];
    const events = evR.value?.events || [];

    // Sum gold per camp for each exact tick — unlike Consolidated Post's
    // whole-game chart (which downsamples onto a 30s grid to stay
    // legible), this plots every raw per-second tick of the whole game.
    // That per-second noise (creep waves, small trades) is what gives
    // the line its natural "alive" look instead of a flattened, blocky
    // one; ggcSmoothRadius below takes the edge off single-tick
    // spikes without discarding data the way a decimated grid would.
    const byExactTick = {};
    posLog.forEach(p => {
      const rec = byExactTick[p.game_time_s] || (byExactTick[p.game_time_s] = { c1: 0, c2: 0 });
      if (p.camp === 1) rec.c1 += p.gold || 0;
      else if (p.camp === 2) rec.c2 += p.gold || 0;
    });
    const allTicks = Object.keys(byExactTick).map(Number).sort((a, b) => a - b);
    if (!allTicks.length) { ggcRenderChart([], events); return; }

    const rawSeries = allTicks.map(t => ({ t, diff: byExactTick[t].c1 - byExactTick[t].c2 }));
    const series = ggcSmoothSeries(rawSeries, ggcSmoothRadius);

    ggcRenderChart(series, events);
  } catch {}
  finally { ggcFetchInFlight = false; }
}

// Bounce+sheen flourish on the header title — same effect/timing as
// golddiff-check's .gdc-smart chip (gdcPlaySmartFlourish): remove-then-
// reflow-then-add so a re-trigger while a previous play is still
// mid-animation restarts cleanly instead of no-oping (adding a class
// that's already present doesn't replay a CSS animation).
function ggcPlayHeaderFlourish() {
  const title = document.getElementById('ggc-header-title');
  if (!title) return;
  title.classList.remove('ggc-bounce-play', 'ggc-sheen-play');
  void title.offsetWidth;
  title.classList.add('ggc-bounce-play', 'ggc-sheen-play');
}

function ggcAnimateIn() {
  ggcShouldShow = true;
  clearTimeout(ggcOutTimer);
  clearTimeout(ggcRevealTimer);
  clearTimeout(ggcEventsRevealTimer);
  const clip    = document.getElementById('gold-graph-check-clip');
  const overlay = document.getElementById('gold-graph-check-overlay');
  const svg     = document.getElementById('ggc-chart');
  clip.style.display = 'block';

  /* Arm the event-icon left-to-right fade-in for this show — see the big
     comment on ggcEventsRevealArmed above. The very next ggcRenderChart()
     call (the ggcFetchData() below) draws the fade-in markup; every poll
     tick after that until GGC_EVENTS_REVEAL_WINDOW_MS elapses is a no-op
     for #ggc-events specifically, so the already-queued per-icon
     animation-delays actually get to play out undisturbed. */
  ggcEventsRevealArmed   = true;
  ggcEventsRevealApplied = false;
  ggcEventsRevealTimer = setTimeout(() => { ggcEventsRevealArmed = false; }, GGC_EVENTS_REVEAL_WINDOW_MS);

  /* Suppress the glide transitions (.ggc-no-anim, mploverlay_v7.css) for
     just this first render — every element still sits at its untouched
     ggcBuildPanel() baseline (top-left) until this fetch resolves, and
     without this guard THAT first jump plays as a transition too, since
     the transition rules are already live. Removed again once this
     render has actually happened so subsequent (live poll) renders
     glide normally. */
  if (svg) svg.classList.add('ggc-no-anim');
  ggcFetchData().then(() => {
    if (!svg) return;
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove('ggc-no-anim')));
  });

  /* Live-refresh while the panel is up — re-fetch/re-render every 500ms
     instead of the one-shot snapshot this used to be. clearInterval first
     so a rapid hide→show doesn't stack a second timer. */
  clearInterval(ggcPollTimer);
  ggcPollTimer = setInterval(ggcFetchData, 500);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('ggc-in');
  }));

  /* Header title's bounce+sheen still fires once the slide-in transition
     itself finishes — same GGC_REVEAL_DELAY-after-show pattern as
     golddiff-check's own gdcRevealTimer/GDC_REVEAL_DELAY. */
  ggcRevealTimer = setTimeout(() => {
    if (!ggcShouldShow) return;
    ggcPlayHeaderFlourish();
  }, GGC_REVEAL_DELAY);
}

function ggcAnimateOut() {
  ggcShouldShow = false;
  clearInterval(ggcPollTimer);
  ggcPollTimer = null;
  clearTimeout(ggcRevealTimer);
  ggcRevealTimer = null;
  clearTimeout(ggcEventsRevealTimer);
  ggcEventsRevealTimer = null;
  ggcEventsRevealArmed = false; /* a hide mid-reveal shouldn't leave #ggc-events permanently stuck skipping updates */
  const clip    = document.getElementById('gold-graph-check-clip');
  const overlay = document.getElementById('gold-graph-check-overlay');
  overlay.classList.remove('ggc-in');
  clearTimeout(ggcOutTimer);
  ggcOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, 350);
  /* Resume any kill events that queued up while this panel was blocking
     them (see killEventsBlocked() in overlay-killevents.js). */
  playNextKillEvent();
}
