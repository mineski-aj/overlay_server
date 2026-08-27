/* ── [FEATURE: goldgraph-check] ─────────────────────────────────────
   Same fixed-clip / sliding-inner pattern as item-check. Background is
   assets/ingame/graphbarback.png (887×282 — see the CSS block in
   mploverlay_v7.css for the exact layout). Inside it,
   .ggc-rect (the pasted .Rectangle_1 spec: 15,15, 857×253) is the white
   plotting canvas an SVG gold-difference chart draws into — same
   area/line-chart technique as mplfs.html's Consolidated Post graph
   (renderCpgChart / #cpg-chart), reused here with two differences the
   user asked for:
     1. No separate Lord/Turtle/Tower/Kill rows below the chart — every
        event is drawn AS AN ICON directly on the line, at the exact
        (time, gold-diff) point it happened (ggcInterpolate gives the
        diff value the line has at that instant; the icon sits right on
        top of the line at that point instead of in its own row).
     2. Shows a rolling 5-minute window instead of Consolidated Post's
        whole-game view — the window's right edge is "now" (the latest
        tick in the fetch, which IS the point of pressing SHOW, since
        data is fetched fresh on every show — see ggcAnimateIn()), and
        its left edge is 5 minutes earlier (clamped to 0 if the game
        hasn't reached 5 minutes yet). 5 evenly-spaced time marks (0% /
        25% / 50% / 75% / 100% of THAT window — always includes both the
        window's start and the point of pressing) instead of Consolidated
        Post's 6, each rounded to the nearest minute of absolute game
        time and drawn as a dark-grey box with white text instead of
        plain fill text.
   Data: /positions' gold field aggregated per camp per tick for the
   line, /events' lord/turtle/tower/kill entries for the on-line icons —
   same two endpoints and same aggregation as fetchCpgData(). Fetched
   fresh each time the panel is shown (a one-shot snapshot of the game
   so far, not a per-second poll — matches Consolidated Post's own
   fetch-on-show, and avoids re-fetching positions_live.json, which can
   grow into the megabytes over a match, every 1s poll tick) — the
   5-minute window is then trimmed out of that fetch in ggcRenderChart(),
   not re-fetched separately. */
const GGC_LEFT = 46, GGC_RIGHT = 845;
const GGC_CHART_TOP = 14, GGC_CHART_BOTTOM = 194;
const GGC_TIME_BOX_TOP = 211, GGC_TIME_BOX_H = 24, GGC_TIME_BOX_W = 63; /* +50% over the original 16×42 */
const GGC_MARK_COUNT = 5; /* including both the window's start and the point of pressing */
const GGC_WINDOW_SECONDS = 5 * 60; /* rolling timeline width, anchored to the point of pressing */
const GGC_BLUE = '#5096d7', GGC_RED = '#f41100'; /* line/area chart + axis/diff labels */
const GGC_ICON_BLUE = '#143ffc', GGC_ICON_RED = '#ee2626'; /* event icons/X marks on the line — deliberately a different, more saturated pair than the line chart's own colors */
const GGC_ICONS = {
  lord:   '/assets/consolidated_post/consolord.png',
  turtle: '/assets/consolidated_post/consoturtle.png',
  tower:  '/assets/consolidated_post/consotower.png',
};
const GGC_EVENT_TYPES = ['lord', 'turtle', 'tower', 'kill']; /* same event scope as Consolidated Post's graph — assist/death are excluded there too */

let ggcShouldShow = false;
let ggcOutTimer    = null;
let ggcDuration     = 1; // seconds — module-scope so ggcInterpolate/event placement can read it without threading it through

function ggcFmtDiff(v) {
  return (v >= 0 ? '+' : '-') + (Math.abs(v) / 1000).toFixed(1) + 'k';
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

function ggcBuildPanel() {
  const overlay = document.getElementById('gold-graph-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'ggc-bg';
  bg.src = '/assets/ingame/graphbarback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const rect = document.createElement('div');
  rect.className = 'ggc-rect';
  rect.id = 'ggc-rect';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'ggc-chart');
  svg.setAttribute('class', 'ggc-chart');
  svg.setAttribute('viewBox', '0 0 857 253');
  rect.appendChild(svg);

  overlay.appendChild(rect);
}
ggcBuildPanel();

function ggcRenderChart(fullSeries, fullEvents) {
  const svg = document.getElementById('ggc-chart');
  if (!svg) return;
  if (!fullSeries.length) { svg.innerHTML = ''; return; }

  // Trailing 5-minute window, anchored to "now" = the latest tick in the
  // fetch — since ggcFetchData() re-fetches fresh every time the panel is
  // shown, "now" IS the point of pressing SHOW. Interpolate a point AT
  // windowStart (against the FULL series, before trimming) so the left
  // edge of the chart isn't a jagged cut mid-segment; if the game hasn't
  // reached 5 minutes yet, windowStart clamps to 0 and the whole (shorter)
  // game-so-far is shown instead.
  const now         = fullSeries[fullSeries.length - 1].t || 0;
  const windowStart = Math.max(0, now - GGC_WINDOW_SECONDS);
  const windowStartDiff = ggcInterpolate(fullSeries, windowStart);
  let series = fullSeries.filter(s => s.t >= windowStart);
  if (!series.length || series[0].t > windowStart + 0.001) {
    series = [{ t: windowStart, diff: windowStartDiff }, ...series];
  }
  const events = fullEvents.filter(e => e.time_s >= windowStart && e.time_s <= now);

  ggcDuration = now || 1; /* window's right edge, in absolute game-time seconds */
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

  const linePts = series.map(s => `${xScale(s.t).toFixed(1)},${yScale(s.diff).toFixed(1)}`);
  const lineD   = 'M' + linePts.join(' L');
  const areaD   = `${lineD} L${xScale(ggcDuration).toFixed(1)},${zeroY.toFixed(1)} L${xScale(windowStart).toFixed(1)},${zeroY.toFixed(1)} Z`;

  // Gradient color-switches exactly at zero-crossings — same technique as
  // mplfs.html's renderCpgChart (Desktop/gold_difference_zero_line.html).
  const stops = [];
  let isBlue = series[0].diff >= 0;
  stops.push({ x: xScale(windowStart), blue: isBlue });
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i].diff, b = series[i + 1].diff;
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      const frac = a / (a - b);
      const tCross = series[i].t + frac * (series[i + 1].t - series[i].t);
      const x = xScale(tCross);
      stops.push({ x: x - 0.5, blue: isBlue });
      isBlue = !isBlue;
      stops.push({ x: x + 0.5, blue: isBlue });
    }
  }
  stops.push({ x: xScale(ggcDuration), blue: isBlue });
  const gradStops = stops.map(s => {
    const frac = Math.max(0, Math.min(1, (s.x - GGC_LEFT) / (GGC_RIGHT - GGC_LEFT)));
    return `<stop offset="${frac.toFixed(4)}" stop-color="${s.blue ? GGC_BLUE : GGC_RED}"></stop>`;
  }).join('');

  // 5 evenly-spaced time marks spanning the 5-minute window (0%, 25%,
  // 50%, 75%, 100% of the window — always includes both windowStart and
  // now/the point of pressing), each rounded to the nearest minute of
  // absolute game time, drawn as a dark-grey box with white text instead
  // of Consolidated Post's plain fill-color text.
  let gridSvg = '';
  for (let i = 0; i < GGC_MARK_COUNT; i++) {
    const frac       = i / (GGC_MARK_COUNT - 1);
    const rawT        = windowStart + frac * (ggcDuration - windowStart);
    const minuteMark = Math.round(rawT / 60);
    const t          = Math.max(windowStart, Math.min(ggcDuration, minuteMark * 60));
    const x           = xScale(t);
    const diffAtT     = ggcInterpolate(series, t);
    const y           = yScale(diffAtT);
    /* Diff-label color: blue side uses the same icon blue (#143ffc) as
       the event markers, not the line/area chart's own lighter blue
       (GGC_BLUE) — a deliberate one-sided request, red side is unchanged. */
    const diffLabelColor = diffAtT >= 0 ? GGC_ICON_BLUE : GGC_RED;

    gridSvg += `<line x1="${x.toFixed(1)}" y1="${GGC_CHART_TOP}" x2="${x.toFixed(1)}" y2="${GGC_TIME_BOX_TOP}" stroke="rgba(0,0,0,0.1)" stroke-width="1"></line>`;
    const labelY = Math.max(GGC_CHART_TOP + 10, y - 10);
    gridSvg += `<text class="ggc-diff-label" x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" fill="${diffLabelColor}">${ggcFmtDiff(diffAtT)}</text>`;

    const boxX = Math.max(GGC_LEFT, Math.min(GGC_RIGHT - GGC_TIME_BOX_W, x - GGC_TIME_BOX_W / 2));
    gridSvg += `<rect class="ggc-timebox" x="${boxX.toFixed(1)}" y="${GGC_TIME_BOX_TOP}" width="${GGC_TIME_BOX_W}" height="${GGC_TIME_BOX_H}" rx="3" fill="#333333"></rect>`;
    gridSvg += `<text class="ggc-time-label" x="${(boxX + GGC_TIME_BOX_W / 2).toFixed(1)}" y="${(GGC_TIME_BOX_TOP + GGC_TIME_BOX_H / 2 + 5.25).toFixed(1)}" text-anchor="middle">${minuteMark}Min.</text>`;
  }

  // Events drawn directly on the line — at the exact (time, diff-at-that-
  // instant) point, not in their own row below the chart. No halo behind
  // the mark — icon/X sit directly on the line, at 125% of their base size.
  let eventsSvg = '';
  events
    .filter(e => GGC_EVENT_TYPES.includes(e.type) && (e.camp === 'camp1' || e.camp === 'camp2'))
    .forEach(e => {
      const x       = xScale(Math.max(windowStart, Math.min(ggcDuration, e.time_s)));
      const y       = yScale(ggcInterpolate(series, e.time_s));
      const color   = e.camp === 'camp1' ? GGC_ICON_BLUE : GGC_ICON_RED;
      if (e.type === 'kill') {
        /* X mark, no halo — 25% bigger than the original 8px (half-width
           4) / 2px-stroke mark. */
        eventsSvg += `<path d="M${(x-5).toFixed(1)},${(y-5).toFixed(1)} L${(x+5).toFixed(1)},${(y+5).toFixed(1)} `
                   + `M${(x-5).toFixed(1)},${(y+5).toFixed(1)} L${(x+5).toFixed(1)},${(y-5).toFixed(1)}" `
                   + `stroke="${color}" stroke-width="2.5" stroke-linecap="round"></path>`;
      } else {
        /* Lord/Turtle/Tower icon, no halo — 25% bigger than the original
           12px, then a further +30% on top of that (19.5px total). */
        const tintFilter = e.camp === 'camp1' ? 'url(#ggcTintBlue)' : 'url(#ggcTintRed)';
        eventsSvg += `<image x="${(x-9.75).toFixed(2)}" y="${(y-9.75).toFixed(2)}" width="19.5" height="19.5" href="${GGC_ICONS[e.type]}" filter="${tintFilter}"></image>`;
      }
    });

  svg.innerHTML = `
    <defs>
      <linearGradient id="ggcGrad" gradientUnits="userSpaceOnUse" x1="${GGC_LEFT}" y1="0" x2="${GGC_RIGHT}" y2="0">
        ${gradStops}
      </linearGradient>
      <filter id="ggcTintBlue" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="${GGC_ICON_BLUE}"></feFlood>
        <feComposite in2="SourceGraphic" operator="in"></feComposite>
      </filter>
      <filter id="ggcTintRed" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="${GGC_ICON_RED}"></feFlood>
        <feComposite in2="SourceGraphic" operator="in"></feComposite>
      </filter>
    </defs>
    ${gridSvg}
    <text class="ggc-axis-label" x="${GGC_LEFT - 8}" y="${GGC_CHART_TOP + 8}" text-anchor="end">${(yMax / 1000).toFixed(0)}K</text>
    <text class="ggc-axis-label" x="${GGC_LEFT - 8}" y="${(zeroY + 4).toFixed(1)}" text-anchor="end">0</text>
    <path d="${areaD}" fill="url(#ggcGrad)" opacity="0.18"></path>
    <path d="${lineD}" fill="none" stroke="url(#ggcGrad)" stroke-width="2.7"></path>
    <line x1="${GGC_LEFT}" y1="${zeroY.toFixed(1)}" x2="${GGC_RIGHT}" y2="${zeroY.toFixed(1)}" stroke="rgba(0,0,0,0.25)" stroke-width="1"></line>
    ${eventsSvg}
  `;
}

async function ggcFetchData() {
  try {
    const [posR, evR] = await Promise.allSettled([
      fetch('/positions', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/events', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!ggcShouldShow) return; /* hidden again while we were fetching */
    const posLog = posR.value?.positions || [];
    const events = evR.value?.events || [];

    // Sum gold per camp for each exact tick, then downsample onto a
    // clean 30s grid — same aggregation as mplfs.html's fetchCpgData().
    const byExactTick = {};
    posLog.forEach(p => {
      const rec = byExactTick[p.game_time_s] || (byExactTick[p.game_time_s] = { c1: 0, c2: 0 });
      if (p.camp === 1) rec.c1 += p.gold || 0;
      else if (p.camp === 2) rec.c2 += p.gold || 0;
    });
    const allTicks = Object.keys(byExactTick).map(Number).sort((a, b) => a - b);
    if (!allTicks.length) { ggcRenderChart([], events); return; }

    const duration = allTicks[allTicks.length - 1];
    const SAMPLE_INTERVAL = 30;
    const series = [];
    let ptr = 0;
    for (let t = 0; t <= duration; t += SAMPLE_INTERVAL) {
      while (ptr + 1 < allTicks.length && allTicks[ptr + 1] <= t) ptr++;
      const rec = byExactTick[allTicks[ptr]];
      series.push({ t, diff: rec.c1 - rec.c2 });
    }
    const lastRec = byExactTick[duration];
    series.push({ t: duration, diff: lastRec.c1 - lastRec.c2 });

    ggcRenderChart(series, events);
  } catch {}
}

function ggcAnimateIn() {
  ggcShouldShow = true;
  clearTimeout(ggcOutTimer);
  const clip    = document.getElementById('gold-graph-check-clip');
  const overlay = document.getElementById('gold-graph-check-overlay');
  clip.style.display = 'block';

  ggcFetchData();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('ggc-in');
  }));
}

function ggcAnimateOut() {
  ggcShouldShow = false;
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
