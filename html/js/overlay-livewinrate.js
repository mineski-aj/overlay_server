/* ── [FEATURE: livewinrate-check] ───────────────────────────────────
   Live Win Rate — Gold Graph Check's shell (same slide-in clip, header,
   graphbarback.png / graph_header.png art, persistent-skeleton + CSS
   glide chart) plotting the Winrate API's win-% series instead of gold.
   Data: /api/winrate-proxy (routes/devapi.js, repoint from Settings →
   Winrate API) → { camp1: [%...], camp2: [%...], time: [s...] }, one sample
   per 10s of game time, camp1 + camp2 = 100.
   Chart: camp2 is just 100 - camp1, so ONE line is drawn — camp1's % around
   the 50% midline, blue above it / red below it (same zero-crossing gradient
   technique as Gold Graph's gold diff, with diff = camp1 - 50). The y-axis
   is a fixed 0-100% scale (labels 100/75/50/75/100, midline dead centre).
   Live: re-fetched and redrawn every 1s while shown (the data itself only
   moves every 10s of game time; the glide transitions do the rest).
   Everything is prefixed lwr-/LWR_ so it can sit next to overlay-
   goldgraphcheck.js's globals (plain <script>s share one scope). */
const LWR_LEFT = 46, LWR_RIGHT = 845;
const LWR_CHART_TOP = 14, LWR_CHART_BOTTOM = 194;
const LWR_TIME_BOX_TOP = 211, LWR_TIME_BOX_H = 24, LWR_TIME_BOX_W = 63;
const LWR_MARK_COUNT = 5;       /* including both 0:00 and "now" */
const LWR_LABEL_MARGIN = 22;    /* keeps an edge mark's % label inside the plot */
const LWR_BLUE = '#5096d7', LWR_RED = '#f41100';   /* line/area */
const LWR_LABEL_BLUE = '#143ffc', LWR_LABEL_RED = '#f41100'; /* numbers + header % (same blue as Gold Graph's diff labels) */
const LWR_LINE_POINTS = 160;    /* constant path command count so `d` can transition — see lwrResample */
const LWR_SMOOTH_S = 10;        /* centered moving-average radius; the feed is 10s-stepped and flickers ±4% between samples */
const LWR_FETCH_TIMEOUT_MS = 10000; /* the Winrate API can be slow — give up (and don't show) after this */
const LWR_REVEAL_DELAY = 350;   /* = #live-winrate-overlay's slide-in duration; header flourish fires then */

let lwrShouldShow  = false;
let lwrOutTimer    = null;
let lwrPollTimer   = null;
let lwrRevealTimer = null;
let lwrFetchInFlight = false;
let lwrShowToken   = 0;  /* bumps on every show/hide so a slow first fetch can tell it was superseded */

function lwrInterpolate(series, t) {
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

function lwrSmoothSeries(series, radius) {
  if (series.length < 3) return series;
  return series.map((pt, i) => {
    let sum = 0, count = 0;
    for (let j = i; j >= 0 && pt.t - series[j].t <= radius; j--) { sum += series[j].diff; count++; }
    for (let j = i + 1; j < series.length && series[j].t - pt.t <= radius; j++) { sum += series[j].diff; count++; }
    return { t: pt.t, diff: sum / count };
  });
}

/* Fixed-count resample for the drawn line/area only — Chromium only
   interpolates a CSS `transition: d` between paths with the SAME number of
   commands (same reason as ggcResample). */
function lwrResample(series, from, to, count) {
  const span = Math.max(1, to - from);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = from + (i / (count - 1)) * span;
    out[i] = { t, diff: lwrInterpolate(series, t) };
  }
  return out;
}

function lwrFmtPct(v) {
  /* whole percent for the on-chart numbers; the header shows one decimal */
  return Math.round(v) + '%';
}

function lwrBuildPanel() {
  const overlay = document.getElementById('live-winrate-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'lwr-bg';
  bg.src = '/assets/ingame/graphbarback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const headerBg = document.createElement('img');
  headerBg.className = 'lwr-header-bg';
  /* Playoffs: Gold Graph Check's gold-title-trapezoid header art (same 887x60 layout). */
  { const th = document.documentElement.getAttribute('data-theme');
    headerBg.src = th === '10th_anniversary' ? '/assets/ingame/anniversary/graph_header.png'
                 : th === 'playoffs'         ? '/assets/ingame/playoffs/graph_header.png'
                 :                             '/assets/ingame/graph_header.png'; }
  headerBg.alt = '';
  overlay.appendChild(headerBg);

  const headerTitle = document.createElement('div');
  headerTitle.id = 'lwr-header-title';
  headerTitle.className = 'lwr-header-title';
  const headerTitleText = document.createElement('span');
  headerTitleText.textContent = 'LIVE WIN RATE';
  const headerTitleSheen = document.createElement('div');
  headerTitleSheen.className = 'lwr-header-title-sheen';
  headerTitle.appendChild(headerTitleText);
  headerTitle.appendChild(headerTitleSheen);
  overlay.appendChild(headerTitle);

  ['lwr-header-tri-c1', 'lwr-header-tri-c2'].forEach(id => {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'lwr-header-tri';
    overlay.appendChild(d);
  });

  /* Current win % per side, flanking the title on the header's white middle. */
  ['lwr-header-pct-c1', 'lwr-header-pct-c2'].forEach(id => {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'lwr-header-pct';
    overlay.appendChild(d);
  });

  ['lwr-header-logo-c1', 'lwr-header-logo-c2'].forEach(id => {
    const wrap = document.createElement('div');
    wrap.id = id;
    const fb = document.createElement('div');
    fb.className = 'lwr-header-logo-fallback';
    const img = document.createElement('img');
    img.className = 'lwr-header-logo-img';
    img.alt = '';
    img.style.display = 'none';
    img.onload  = () => { img.style.display = 'block'; fb.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none';  fb.style.display = ''; };
    wrap.appendChild(fb);
    wrap.appendChild(img);
    overlay.appendChild(wrap);
  });

  const rect = document.createElement('div');
  rect.className = 'lwr-rect';
  rect.id = 'lwr-rect';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'lwr-chart');
  svg.setAttribute('class', 'lwr-chart');
  svg.setAttribute('viewBox', '0 0 857 253');

  /* Persistent skeleton, built once — see ggcBuildPanel for why (CSS
     transitions need the same element instance across updates). */
  const midY = (LWR_CHART_TOP + LWR_CHART_BOTTOM) / 2;
  const qUp = (LWR_CHART_TOP + midY) / 2, qDn = (midY + LWR_CHART_BOTTOM) / 2;  /* the 75% rows (75% blue-ahead / 75% red-ahead) */
  svg.innerHTML = `
    <defs>
      <linearGradient id="lwrGrad" gradientUnits="userSpaceOnUse" x1="${LWR_LEFT}" y1="0" x2="${LWR_RIGHT}" y2="0"></linearGradient>
    </defs>
    <line class="lwr-gridline" x1="${LWR_LEFT}" x2="${LWR_RIGHT}" y1="${qUp}" y2="${qUp}"></line>
    <line class="lwr-gridline" x1="${LWR_LEFT}" x2="${LWR_RIGHT}" y1="${qDn}" y2="${qDn}"></line>
    <text class="lwr-axis-label" x="${LWR_LEFT - 5}" y="${LWR_CHART_TOP + 8}" text-anchor="end">100%</text>
    <text class="lwr-axis-label" x="${LWR_LEFT - 5}" y="${qUp + 4}" text-anchor="end">75%</text>
    <text class="lwr-axis-label" x="${LWR_LEFT - 5}" y="${midY + 4}" text-anchor="end">50%</text>
    <text class="lwr-axis-label" x="${LWR_LEFT - 5}" y="${qDn + 4}" text-anchor="end">75%</text>
    <text class="lwr-axis-label" x="${LWR_LEFT - 5}" y="${LWR_CHART_BOTTOM}" text-anchor="end">100%</text>
    <path id="lwr-area" fill="url(#lwrGrad)" opacity="0.18"></path>
    <path id="lwr-line" fill="none" stroke="url(#lwrGrad)" stroke-width="2.7"></path>
    <line id="lwr-midline" x1="${LWR_LEFT}" x2="${LWR_RIGHT}" y1="${midY}" y2="${midY}" stroke="rgba(0,0,0,0.25)" stroke-width="1"></line>
    <g id="lwr-marks"></g>
  `;

  const marksGroup = svg.querySelector('#lwr-marks');
  for (let i = 0; i < LWR_MARK_COUNT; i++) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'lwr-mark');
    g.innerHTML = `
      <line class="lwr-mark-gridline" x1="0" x2="0" y1="${LWR_CHART_TOP}" y2="${LWR_TIME_BOX_TOP}" stroke="rgba(0,0,0,0.1)" stroke-width="1"></line>
      <rect class="lwr-timebox" y="${LWR_TIME_BOX_TOP}" width="${LWR_TIME_BOX_W}" height="${LWR_TIME_BOX_H}" rx="3" fill="#333333"></rect>
      <text class="lwr-time-label" x="0" y="${LWR_TIME_BOX_TOP + LWR_TIME_BOX_H / 2 + 5.25}" text-anchor="middle"></text>
      <circle class="lwr-diff-dot" fill="#fff"></circle>
      <text class="lwr-diff-label" x="0" y="0" text-anchor="middle"></text>
    `;
    marksGroup.appendChild(g);
  }

  rect.appendChild(svg);
  overlay.appendChild(rect);
}
lwrBuildPanel();

/* Header tricode/logo from the live game poll — same as ggc's handler. */
registerPollHandler(function(data) {
  const camps = data.camp_list || [];
  const c1 = camps.find(c => c.campid === 1);
  const c2 = camps.find(c => c.campid === 2);

  const t1 = document.getElementById('lwr-header-tri-c1');
  const t2 = document.getElementById('lwr-header-tri-c2');
  if (t1 && c1) { const n = c1.team_simple_name || ''; if (n) t1.textContent = n.toUpperCase(); }
  if (t2 && c2) { const n = c2.team_simple_name || ''; if (n) t2.textContent = n.toUpperCase(); }

  [['lwr-header-logo-c1', c1], ['lwr-header-logo-c2', c2]].forEach(([id, c]) => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    const img  = wrap.querySelector('.lwr-header-logo-img');
    const name = c ? (c.team_simple_name || '').toUpperCase() : '';
    if (img && name && img.dataset.team !== name) {
      img.dataset.team  = name;
      img.style.display = 'none';
      img.src = '/logos/' + name + '.png';
    }
  });
});

/* wr = { camp1: [...], camp2: [...], time: [...] } */
function lwrRenderChart(wr) {
  const svg = document.getElementById('lwr-chart');
  if (!svg || !wr) return;
  const c1 = wr.camp1, times = wr.time;
  if (!Array.isArray(c1) || !Array.isArray(times) || !c1.length || c1.length !== times.length) return;

  /* diff = camp1's lead over 50% — positive blue, negative red. */
  const raw = times.map((t, i) => ({ t: Number(t), diff: Number(c1[i]) - 50 }));
  const lastRaw = raw[raw.length - 1];
  const now = lastRaw.t || 1;
  let series = lwrSmoothSeries(raw, LWR_SMOOTH_S);
  if (series[0].t > 0.001) series = [{ t: 0, diff: series[0].diff }, ...series];
  /* Pin the trailing point to the exact latest sample so the line, the dot
     and the header % all agree (smoothing would otherwise average it down). */
  series = series.filter(s => s.t < now - 0.001);
  series.push({ t: now, diff: lastRaw.diff });

  const half   = 50;  /* fixed full scale: top = 100% blue, bottom = 100% red */
  const xScale = t => LWR_LEFT + (t / now) * (LWR_RIGHT - LWR_LEFT);
  const yScale = v => LWR_CHART_BOTTOM - ((v + half) / (2 * half)) * (LWR_CHART_BOTTOM - LWR_CHART_TOP);
  const zeroY  = yScale(0);

  const plot  = lwrResample(series, 0, now, LWR_LINE_POINTS);
  const pts   = plot.map(s => `${xScale(s.t).toFixed(1)},${yScale(s.diff).toFixed(1)}`);
  const lineD = 'M' + pts.join(' L');
  const areaD = `${lineD} L${xScale(now).toFixed(1)},${zeroY.toFixed(1)} L${xScale(0).toFixed(1)},${zeroY.toFixed(1)} Z`;
  document.getElementById('lwr-line').setAttribute('d', lineD);
  document.getElementById('lwr-area').setAttribute('d', areaD);

  /* Blue/red gradient switching exactly at the 50% crossings. */
  const stops = [];
  let isBlue = plot[0].diff >= 0;
  stops.push({ x: xScale(0), blue: isBlue });
  for (let i = 0; i < plot.length - 1; i++) {
    const a = plot[i].diff, b = plot[i + 1].diff;
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      const tCross = plot[i].t + (a / (a - b)) * (plot[i + 1].t - plot[i].t);
      const x = xScale(tCross);
      stops.push({ x: x - 0.5, blue: isBlue });
      isBlue = !isBlue;
      stops.push({ x: x + 0.5, blue: isBlue });
    }
  }
  stops.push({ x: xScale(now), blue: isBlue });
  document.getElementById('lwrGrad').innerHTML = stops.map(s => {
    const frac = Math.max(0, Math.min(1, (s.x - LWR_LEFT) / (LWR_RIGHT - LWR_LEFT)));
    return `<stop offset="${frac.toFixed(4)}" stop-color="${s.blue ? LWR_BLUE : LWR_RED}"></stop>`;
  }).join('');

  /* Header: both sides' current win %, one decimal. */
  const p1 = 50 + lastRaw.diff, p2 = 100 - p1;
  const h1 = document.getElementById('lwr-header-pct-c1');
  const h2 = document.getElementById('lwr-header-pct-c2');
  if (h1) { h1.textContent = p1.toFixed(1) + '%'; h1.style.color = LWR_LABEL_BLUE; }
  if (h2) { h2.textContent = p2.toFixed(1) + '%'; h2.style.color = LWR_LABEL_RED; }

  /* 5 evenly-spaced marks, minute-snapped except "now" (pinned to the live edge). */
  const markEls = svg.querySelectorAll('.lwr-mark');
  for (let i = 0; i < LWR_MARK_COUNT; i++) {
    const isNow = i === LWR_MARK_COUNT - 1;
    const minuteMark = Math.round((i / (LWR_MARK_COUNT - 1)) * now / 60);
    const t = isNow ? now : Math.max(0, Math.min(now, minuteMark * 60));
    const x = xScale(t);
    const d = isNow ? lastRaw.diff : lwrInterpolate(series, t);
    const y = yScale(d);
    const color  = d >= 0 ? LWR_LABEL_BLUE : LWR_LABEL_RED;
    const labelY = d >= 0 ? Math.max(LWR_CHART_TOP + 10, y - 10) : Math.min(LWR_CHART_BOTTOM - 4, y + 20);
    const boxX   = Math.max(LWR_LEFT, Math.min(LWR_RIGHT - LWR_TIME_BOX_W, x - LWR_TIME_BOX_W / 2));
    const labelX = Math.max(LWR_LEFT + LWR_LABEL_MARGIN, Math.min(LWR_RIGHT - LWR_LABEL_MARGIN, x));

    const g = markEls[i];
    g.querySelector('.lwr-mark-gridline').style.transform = `translateX(${x.toFixed(1)}px)`;
    g.querySelector('.lwr-timebox').setAttribute('x', boxX.toFixed(1));
    const timeLabel = g.querySelector('.lwr-time-label');
    timeLabel.style.transform = `translateX(${(boxX + LWR_TIME_BOX_W / 2).toFixed(1)}px)`;
    timeLabel.textContent = minuteMark + (minuteMark > 1 ? 'Mins.' : 'Min.');

    const dot = g.querySelector('.lwr-diff-dot');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('stroke', color);

    const label = g.querySelector('.lwr-diff-label');
    label.style.transform = `translate(${labelX.toFixed(1)}px, ${labelY.toFixed(1)}px)`;
    label.setAttribute('fill', color);
    /* The leading side's % at that moment (so a red-ahead mark reads red's %). */
    label.textContent = (i === 0) ? '' : lwrFmtPct(50 + Math.abs(d));
  }
}

/* Resolves true once a real payload has been rendered, false on timeout /
   error / hidden-meanwhile. A poll tick that lands while a fetch is still in
   flight is skipped (resolves false) rather than piling up. */
async function lwrFetchData() {
  if (lwrFetchInFlight) return false;
  lwrFetchInFlight = true;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LWR_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch('/api/winrate-proxy', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return false;
    const wr = await r.json();
    if (!lwrShouldShow) return false; /* hidden again while we were fetching */
    if (!Array.isArray(wr && wr.camp1) || !wr.camp1.length) return false;
    lwrRenderChart(wr);
    return true;
  } catch { return false; }
  finally { clearTimeout(timer); lwrFetchInFlight = false; }
}

function lwrPlayHeaderFlourish() {
  const title = document.getElementById('lwr-header-title');
  if (!title) return;
  title.classList.remove('lwr-bounce-play', 'lwr-sheen-play');
  void title.offsetWidth;
  title.classList.add('lwr-bounce-play', 'lwr-sheen-play');
}

async function lwrAnimateIn() {
  lwrShouldShow = true;
  const tok = ++lwrShowToken;
  clearTimeout(lwrOutTimer);
  clearTimeout(lwrRevealTimer);
  clearInterval(lwrPollTimer);
  lwrPollTimer = null;
  const clip    = document.getElementById('live-winrate-clip');
  const overlay = document.getElementById('live-winrate-overlay');
  const svg     = document.getElementById('lwr-chart');

  /* Don't slide in until there is real data: the Winrate API is slow, so the
     first fetch happens while the panel is still off-screen (clip hidden,
     overlay translated away). No value within LWR_FETCH_TIMEOUT_MS → give up
     and leave it hidden. A hide (or a newer show) meanwhile cancels this. */
  if (svg) svg.classList.add('lwr-no-anim');   /* first render must not glide from the build-time baseline */
  const ok = await lwrFetchData();
  if (tok !== lwrShowToken) return;            /* superseded by a hide / newer show */
  if (!ok) {
    lwrShouldShow = false;
    if (window.OverlayLog && OverlayLog.warn) OverlayLog.warn('Live Win Rate: no data from the Winrate API within ' + (LWR_FETCH_TIMEOUT_MS / 1000) + 's — not shown');
    return;
  }

  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (tok !== lwrShowToken) return;
    if (svg) svg.classList.remove('lwr-no-anim');
    overlay.classList.add('lwr-in');
  }));

  lwrPollTimer = setInterval(lwrFetchData, 1000);

  lwrRevealTimer = setTimeout(() => {
    if (!lwrShouldShow) return;
    lwrPlayHeaderFlourish();
  }, LWR_REVEAL_DELAY);
}

function lwrAnimateOut() {
  lwrShouldShow = false;
  lwrShowToken++;
  clearInterval(lwrPollTimer);
  lwrPollTimer = null;
  clearTimeout(lwrRevealTimer);
  lwrRevealTimer = null;
  const clip    = document.getElementById('live-winrate-clip');
  const overlay = document.getElementById('live-winrate-overlay');
  overlay.classList.remove('lwr-in');
  clearTimeout(lwrOutTimer);
  lwrOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, 350);
  playNextKillEvent();
}
