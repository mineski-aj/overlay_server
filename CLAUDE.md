# overlay_server — instruction manual

MLBB (Mobile Legends: Bang Bang) esports broadcast overlay system. Each
overlay is a browser-source HTML page (OBS reads it), driven by live game
data and controlled from a central dashboard. This file is the onboarding
doc for a fresh `/clear`'d conversation — read it before touching anything.

## Running it

```
node server.js        # or: npm start
```
Default port 3000 (autoPort in `.claude/launch.json`). Dashboard is at
`/html/dashboard.html`; individual overlay pages are served under `/html/`.

## Map

- `server.js` — Express app entrypoint, mounts everything in `routes/`.
- `routes/*.js` — API endpoints (match state, positions, fights, overlay
  styles, dashboard data, etc).
- `html/mplfs.html` — the main scoreboard/scene overlay (this is the file
  that gets extended with new "scenes" — MVP Highlights, MVP Scene, Final
  Team, Waiting Lobby, Team Line-Up, Casters, Hosts, Standings...).
- `html/dashboard.html` — control panel: SHOW/HIDE/PREVIEW buttons per
  feature, plus the **Edit tab** (drag/resize/font-size editor for every
  overlay element, persisted to `overlay_styles.json` via
  `routes/overlayStyles.js`).
- `heromvp/`, `herohighlights/`, `hero/`, `items/`, `role/`, `logos/`,
  `emblem/`, `photos/`, `hires/` — image asset folders, one per asset type
  (see naming conventions below).
- `*.json` at repo root (`match_state.json`, `positions_live.json`,
  `overlay_styles.json`, `mainroster.json`, etc) — live state files the
  routes read/write; not meant to be hand-edited.
- `/Users/ajsarmiento/.claude/projects/-Users-ajsarmiento/memory/` — my
  cross-project memory. Check `reference_mlbb_api.md` for the live
  main-info API shape, and the `feedback_*` files for standing UI rules
  (animation timing, feature-toggle state, fetch caching) that apply here.

## Scene architecture (how every overlay page is built)

Each "scene" (MVP Highlights, MVP Scene, Final Team, etc.) is one
full-screen container in `mplfs.html`:

```html
<div id="foo-page">
  ...scene's own elements, each absolutely positioned...
</div>
```
```css
#foo-page {
  position: absolute; top: 0; left: 0; width: 1920px; height: 1080px;
  display: none; overflow: hidden;
  background: transparent;   /* #scene-video shows through underneath */
  opacity: 0; transition: opacity 400ms ease;
}
#foo-page.foo-on { display: block; }
#foo-page.foo-visible { opacity: 1; }
```

Show/hide is a two-class dance (matches the 400ms CSS transition):

```js
async function showFooScene() {
  const dataPromise = fooFetchData();
  await transitionTo('foo');                 // hands off to shared bg video
  const data = await dataPromise;
  if (activeFeature !== 'foo') return;        // guard: superseded mid-await
  fooApply(data);
  await preloadMedia(fooPage.querySelectorAll('img, video'), 1500);
  if (activeFeature !== 'foo') return;
  showSceneVideo('foo');
  fooPage.classList.add('foo-on');
  void fooPage.offsetWidth;                   // force reflow before opacity
  fooPage.classList.add('foo-visible');
}
function hideFooScene() {
  activeFeature = null;
  fooPage.classList.remove('foo-visible');
  return new Promise(resolve => setTimeout(() => {
    fooPage.classList.remove('foo-on');
    hideSceneVideo();
    resolve();
  }, 420));
}
```

Never hide on `animationend` — use the `setTimeout` + `activeFeature`
guard pattern above (see memory: `feedback_overlay_animations.md`).

## The #1 rule: every element is independently editable

**Every visual piece — image, video, text — gets its own id/class, its
own absolute CSS position, and is never nested inside a shared
positioning wrapper**, so it can be dragged/resized on its own from the
dashboard Edit tab. Don't group a label with its value, or a background
video with the image in front of it, unless you explicitly want them to
move together.

To make a new element editable from the dashboard, THREE things must all
reference the exact same selector string — miss one and the row is dead
(this exact bug shipped once: `#mv-box`/`#mv-kda-col` etc. were registered
in `MV_ELEMENTS` but didn't exist in the DOM, so those Edit rows did
nothing):

1. **The DOM**, in `mplfs.html` — the real `id="..."` or `class="..."`.
2. **`..._DEFAULTS`** object, in `dashboard.html` — starting
   `{ left, top, width, height }` (add `fontSize` for text) keyed by that
   same CSS selector (`'#foo-el'` or `'.foo-el'`).
3. **`..._ELEMENTS`** array, in `dashboard.html` — `{ group, id, name }`
   where `id` is again that same selector, `name` is the human label shown
   in the Edit sidebar, and `group` is a heading string.

`group` is not cosmetic-only: selecting a group and nudging with arrow
keys moves every element sharing that `group` string together. Give an
element its own unique `group` value unless you *want* it tied to its
siblings (e.g. a title + subtitle that should always move as a pair is
fine to group; a background video and the photo drawn on top of it is
not).

Then wire the new config into `EDIT_CONFIGS` in `dashboard.html`:
```js
mplfs_foo: {
  label: 'Foo Scene · mplfs', file: 'mplfs.html', styleFile: 'mplfs',
  defaultsKey: 'sb_edit_defaults_mplfs_foo',
  elements: FOO_ELEMENTS, defaults: FOO_DEFAULTS,
  showFn: 'showFooScene',
},
```

## Adding a local debug SHOW/HIDE/PREVIEW card (inside `mplfs.html` itself)

`mplfs.html` has its own on-page debug bar (toggle with the `` ` ``
key) for testing a scene without touching the network — its buttons call
the local JS functions directly, bypassing SSE entirely:

```html
<div class="feature-card">
  <div class="feature-card-label">Foo Scene</div>
  <div class="feature-card-btns">
    <button class="dbg-btn show" onclick="showFooScene()">▶ SHOW</button>
    <button class="dbg-btn hide" onclick="hideFooScene()">■ HIDE</button>
    <button class="dbg-btn preview" id="preview-foo" onclick="toggleLocalPreview('foo', this)">◈ PREVIEW</button>
  </div>
</div>
```
Also add `'foo'` to `toggleLocalPreview`'s and `window.previewTrigger`'s
if-chains in `mplfs.html` so the preview button actually maps to
`showFooScene()`. **This card is local-only** — it does nothing for other
open tabs or OBS. For real remote control, see the next section.

Also check `dashboard.html`'s live-state-on-open logic (memory:
`feedback_feature_toggle_state.md`) if a card has an enable/disable
toggle — it must read real server state, never assume "Enabled".

## Live control (SSE) — wiring a feature into the real dashboard

This is the part that actually lets you click SHOW/HIDE in
`dashboard.html`'s **Control tab** and have every open `mplfs.html`
tab/OBS-browser-source react at once. It's a 6-layer chain and every
layer must use the exact same feature key (e.g. `'foo'`) or the chain
silently breaks at that link:

**1. Server route + broadcast — `routes/overlay.js`.** One `show` and one
`hide` route. Both flip `state.mplfsScene.activeFeature` (so a
freshly-loaded tab can restore it) and write an SSE event named after the
feature key to every connected client in `state.overlayClients`:
```js
router.get('/overlay/foo/show', (req, res) => {
  state.mplfsScene.activeFeature = 'foo';
  state.overlayClients.forEach(c => { try { c.write('event: foo\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});
router.get('/overlay/foo/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: foo\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});
```
No new SSE endpoint needed — every scene shares the one persistent
connection at `GET /overlay/events` (`state.overlayClients`, heartbeat
every 15s). `GET /overlay/mplfs-scene` returns `state.mplfsScene` as-is;
you don't need to touch it unless the new feature needs extra fields
beyond `activeFeature`.

**2. Client SSE listener — `mplfs.html`'s `connectSSE()`.** Add a
listener for the same event name:
```js
sseSource.addEventListener('foo', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.action === 'show') {
    document.getElementById('config-bar').classList.remove('debug-open');
    setTimeout(showFooScene, 100);
  } else if (msg.action === 'hide') hideActiveFeature();
});
```

**3. Hide dispatch — `mplfs.html`'s `hideActiveFeature()`.** Add one line
so hiding "whatever is currently active" reaches your scene:
```js
if (prev === 'foo') return hideFooScene();
```

**4. Restore-on-load — `mplfs.html`'s `restoreScene()`.** Add one line so
a tab that (re)loads mid-broadcast comes up already showing the active
feature instead of blank:
```js
else if (scene.activeFeature === 'foo') showFooScene();
```

**5. Dashboard Control-tab button — `dashboard.html`'s `OVERLAYS` array**,
inside the `id: 'mplfs'` entry's `features` list. Adding this entry
generates the real SHOW/HIDE buttons on the Control tab, which just
`fetch()` the two routes from step 1:
```js
{ name: 'Foo Scene', show: '/overlay/foo/show', hide: '/overlay/foo/hide' },
```

**6. Dashboard "Showing" indicator — `dashboard.html`'s
`MPLFS_ACTIVE_FEATURE_MAP`.** A *separate* map from step 5 — easy to
forget because step 5 alone is enough to make SHOW/HIDE work, so nothing
looks broken. This map is what the Control-tab toggle button reads to
decide `'● Showing'` vs `'○ Hidden'`; the key is auto-extracted from the
show URL (`feat.show.split('/')[2]`), so it must match exactly:
```js
foo: 'foo',   // add alongside mvp: 'mvp', final_team: 'finalteam', etc.
```
Skip this and SHOW/HIDE both work fine, but the toggle button silently
never flips to "Showing" — no error, just a permanently-wrong indicator
(exactly what happened when Credit Reel first shipped).

If a feature only ever needs to be triggered from within `mplfs.html`
itself (no cross-tab/remote control), you can skip this whole section and
use only the local debug card above. If it needs to work from the real
dashboard on a different machine than the OBS tab, you need all 6 steps.

## Data & assets

- Player/match data: `hlFetchMvp()` / `hlExtractPlayer()` hit the
  `game-mvp/view` API (repointable from Settings → `/api/highlights-url`);
  match/game number comes from `/match/state` instead.
- `campid`: `1` = blue/left/team1, `2` = red/right/team2 — same convention
  everywhere, including the main-info API (memory:
  `reference_mlbb_api.md`).
- Asset path conventions (all indexed by `heroid` or an id from the API,
  not hardcoded):
  - `/heromvp/MVP_<heroid>.png` — hero art for MVP Scene (two files are
    typo'd `MPV_129.png`/`MPV_130.png`, handled as a special case).
  - `/herohighlights/<heroid>heromvp.png` — hero art for MVP Highlights.
  - `/items/<id>.png`, `/role/<role>.png`, `/logos/<TRICODE>.png`,
    `/emblem/square_<id>_RUNES.png`.
  - Player signature photo: `hlPhotoUrl(name)`.
- Any `fetch()` of a JSON file that can change at runtime needs
  `{ cache: 'no-store' }` (memory: `feedback_fetch_cache.md`) — a hard
  browser refresh does NOT bypass fetch cache.

## Fonts & text fitting

- **Anton** (black, `#0a0a0a`) — big display numbers and titles: KDA/GPM/
  KP% values, "OF THE GAME", scene titles.
- **General Sans** — labels, player names, secondary text. Bold/700 for
  names, semibold/600 for small uppercase labels.
- Any text element that must never overflow its box uses a shrink-to-fit
  helper, e.g.:
  ```js
  function fooFitValue(el, maxSize, minSize) {
    let size = maxSize;
    el.style.fontSize = size + 'px';
    while (el.scrollWidth > el.clientWidth && size > minSize) {
      el.style.fontSize = (--size) + 'px';
    }
  }
  ```
  Start `maxSize` near the box height for "maximized" display numbers
  (e.g. a 67px-tall box → ~64px Anton), and give it a sane `minSize` floor
  (~half of max) so worst-case long values don't disappear.

## Checklist: building a brand-new scene from scratch

1. Copy the structure of an existing scene closest to what you need (MVP
   Scene is the most fully-featured reference) rather than starting blank.
2. CSS: `#foo-page` container + one absolutely-positioned rule per element,
   each with its own id/class — no shared wrapper unless intentional.
3. HTML: the container div and its children, wired to the CSS above.
4. JS: fetch function → apply function (sets every element's
   src/textContent, calls fit-to-box helpers) → `showFooScene`/
   `hideFooScene` following the two-class transition pattern.
5. Dashboard Edit tab: add `FOO_DEFAULTS`, `FOO_ELEMENTS`, register in
   `EDIT_CONFIGS`.
6. Local debug card in `mplfs.html` (optional, for testing while you
   build — see "Adding a local debug SHOW/HIDE/PREVIEW card" above).
7. Live control wiring (needed for the real dashboard to trigger it
   remotely — see "Live control (SSE)" above): server show/hide routes in
   `routes/overlay.js` → SSE listener in `connectSSE()` → line in
   `hideActiveFeature()` → line in `restoreScene()` → button entry in
   `dashboard.html`'s `OVERLAYS[...].features` → line in
   `MPLFS_ACTIVE_FEATURE_MAP`. All six must use the exact same feature-key
   string. **The last one is the one that gets forgotten** — everything
   still shows/hides fine without it, only the Control-tab "Showing"
   indicator is silently wrong.
8. Sanity-check before calling it done: grep every id/class used in the new
   `FOO_ELEMENTS`/`FOO_DEFAULTS` against the actual `mplfs.html` markup —
   a mismatch is silent (no error, the Edit row just does nothing). Same
   goes for the feature-key string across all 6 SSE-wiring spots.
9. Validate JS syntax on both `mplfs.html` and `dashboard.html` (a fresh
   `<script>` block that fails to parse breaks the whole page):
   ```
   node -e "
   const fs=require('fs');
   for (const f of ['html/mplfs.html','html/dashboard.html']) {
     const src = fs.readFileSync(f,'utf8');
     [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
       .forEach((m,i) => { try { new Function(m[1]); }
         catch(e){ console.log(f, i, e.message); } });
   }"
   ```
