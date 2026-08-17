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
- `html/mpltag.html` — lower thirds and other "tag" overlays (small,
  self-contained broadcast graphics that sit on top of the main feed —
  e.g. Map Selection) as opposed to `mplfs.html`'s full-screen scenes.
  Same 1920x1080 transparent-canvas broadcast-overlay conventions as
  `mplfs.html` (see "Scene architecture" below), but each tag is much
  smaller and simpler than a full scene, and multiple tags can in
  principle be on screen at once since they don't share `mplfs.html`'s
  mutually-exclusive `activeFeature` slot. New tags get added here.
- `html/dashboard.html` — control panel: SHOW/HIDE/PREVIEW buttons per
  feature, plus the **Edit tab** (drag/resize/font-size editor for every
  overlay element, persisted to `overlay_styles.json` via
  `routes/overlayStyles.js`).
- `html/match-dashboard.html`, `html/map-selection-dashboard.html`,
  `html/standings-dashboard.html` — Match Board / Map Selection /
  Standings tabs, each a static always-mounted iframe inside
  `dashboard.html` (see "Dashboard architecture" below for why they
  share a connection budget and must use `html/js/relay-client.js`
  instead of their own `EventSource`, not just for these three but for
  any future tab of the same kind).
- `html/js/overlay-shared-worker.js` + `html/js/overlay-sse-shim.js` —
  the ONE real `/overlay/events` connection for the entire browser,
  shared across every overlay page via `SharedWorker` (see "Dashboard
  architecture" below). Every overlay page's own SSE connection
  (`dashboard.html`, `mplfs.html`, `ENTVC.html`, `mpltag.html`,
  `Draft.html`, `DraftIndex.html`, `mploverlay_v7.html`) goes through
  this — use `createOverlaySSE()` for any new page, never
  `new EventSource(...)` directly.
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

## Dashboard architecture — tabs, iframes, and the connection budget

`html/dashboard.html` is one page with several `.page` divs (Match
Board, Map Selection, Standings, Roster, Sponsors, Dynamic, Control,
Edit, Settings), switched by CSS class toggling on click — **not** by
navigating away, so most of them stay mounted (scripts still running)
for the entire life of the dashboard tab:

- **Always-mounted, by design** — Match Board (`match-dashboard.html`),
  Map Selection (`map-selection-dashboard.html`), Standings
  (`standings-dashboard.html`) each sit in a static `<iframe>` in the
  markup and are never torn down when you switch tabs, so their live
  state keeps syncing in the background.
- **Released on navigate-away** — the Control tab's `#preview-iframe`
  and the Edit tab's `#edit-iframe` show "whatever is currently
  selected/being edited", not a fixed thing, so their `src` resets to
  `about:blank` the moment you switch to a different top-level tab
  (the `tabBtns` click handler). Returning to Edit reloads the
  last-picked config automatically; returning to Control needs a fresh
  sidebar click.

**Why this matters — the browser's per-host connection cap.** Plain
HTTP/1.1 (this server, no HTTP/2) caps a browser at ~6 concurrent
connections to one host. Every persistent `EventSource` an
always-mounted tab holds open permanently occupies one of those 6
slots for as long as the dashboard tab stays open. Add Control/Edit's
own connection on top and it's easy to hit the ceiling — when that
happens, the 7th+ request from that tab (including the tab's own
refresh) just queues forever with no error, which reads as "the whole
dashboard hangs, only fixable by closing and reopening the tab". This
actually happened: adding the Map Selection tab (a 4th always-mounted
SSE connection, plus a redundant 5th it briefly opened by mistake) ate
the safety margin that used to absorb Control+Edit's own connections,
and locked the dashboard up after a few tab switches.

**First fix tried (superseded, keep reading) — one shared connection
per backend channel, held by dashboard.html's own parent page, not by
each of its iframes.** `dashboard.html` opened 3 fixed `EventSource`
connections itself (`/match/events`, `/mapselection/events`,
`/standings/events`) and relayed data down to whichever iframe(s)
needed it via `postMessage` (`html/js/relay-client.js`'s
`connectRelay(...)` on the iframe side; `dashboard.html`'s
`relayCache`/`relayIframeIds`/`relaySend` on the parent side — these
still exist and still work, see below). This capped the
*always-mounted-within-the-dashboard-tab* connection count at a fixed
low number — **but it only helped connections inside one page.** It
did nothing for the case that actually matters most in production:
**vMix (or a normal browser) loading several SEPARATE overlay pages as
independent browser sources/tabs at once** — `mplfs.html`,
`ENTVC.html`, `mploverlay_v7.html`, `mpltag.html`, `Draft.html`, etc.
The 6-connections-per-host cap is shared across the **whole browser**,
not per-tab/per-source, so each of those pages still opened its own
`EventSource('/overlay/events')`, and opening even a handful of them
side by side reproduced the exact same hang — this is what actually
happened: dashboard.html open on the control PC plus a single
`mplfs.html` tab was enough to exhaust the pool.

**The real fix — a `SharedWorker` holding the ONE real connection for
the entire browser, no matter how many overlay pages are open.** A
`SharedWorker` is a browser feature where one script instance is
automatically shared across every tab/window of the same origin.
`html/js/overlay-shared-worker.js` is that script: it holds the single
real `EventSource('/overlay/events')` and rebroadcasts every named
event to every connected page over `postMessage`.
`html/js/overlay-sse-shim.js` is the client-side half —
`createOverlaySSE()` returns an object exposing the same subset of the
`EventSource` API every page already used (`addEventListener`,
`.onopen`, `.onerror`, `.close()`), backed by the worker instead of a
real connection, so **no page's existing `sse.addEventListener('foo',
fn)` call sites needed to change** — only the one line that used to
say `new EventSource('/overlay/events')` became
`createOverlaySSE()`. Migrated: `dashboard.html`, `mplfs.html`,
`ENTVC.html`, `mpltag.html`, `Draft.html`, `DraftIndex.html`, and
`html/js/overlay-debug.js` (mploverlay_v7.html's shared SSE block).
Verified live: opening all 7 of those simultaneously in one browser
produces exactly **one** `GET /overlay/events` request server-side,
regardless of how many are open.

**Not yet migrated — `html/fights.html` and
`html/heart_stopping_moment_v14.html`.** Both use non-standard
connection patterns (an explicit `host`/`baseUrl` variable instead of
same-origin, plus their own manual reconnect-on-error logic) that need
individual verification of same-origin assumptions before swapping in
the shim — deliberately deferred rather than migrated blind.

**dashboard.html's own internal relay (previous section) still
exists and composes with this cleanly** — `dashboardSSE` is now itself
a `createOverlaySSE()` shim instead of a raw `EventSource`, so its
`relayIframeIds`/`relaySend` system for Match Board/Map
Selection/Standings keeps working unchanged, just riding on the shared
worker's one connection instead of a dedicated one. Layer boundary:
the **SharedWorker** solves "how many real connections exist across
the whole browser" (always exactly 1 now); dashboard.html's **own
relay** solves a separate, narrower problem — fanning a single page's
one connection out to its own several always-mounted iframes via
`postMessage`, which the SharedWorker doesn't replace.

**If you add a brand-new overlay page that needs live SSE data, do
NOT give it its own `new EventSource(...)`.** Include
`html/js/overlay-sse-shim.js` and call `createOverlaySSE()` instead —
same for any NEW named event: add it to `KNOWN_EVENTS` in
`html/js/overlay-shared-worker.js` (EventSource requires an explicit
`addEventListener(name, ...)` per named event, so the worker has to
know every name up front; there's no generic "any event" API) or it
will silently never reach any page no matter how many
`addEventListener('yourNewEvent', ...)` calls exist client-side.

## ENTVC.html — the EN broadcast mirror of Waiting TVC/Lobby

`html/ENTVC.html` is a separate, mostly-duplicate copy of `mplfs.html`'s
Waiting Screen TVC, Waiting Lobby, Today's Schedule, Tomorrow's Schedule,
and Standings scenes, used for the English-language broadcast. It shares
`mplfs.html`'s scene architecture, `showSceneVideo`/SSE wiring, and
helpers like `msToMatchRows`/`buildTsMatches` almost byte-for-byte.

**Standing rule: any change to Waiting TVC content in `mplfs.html` — new
features, CSS/animation fixes, graphics swaps, tunable settings,
anything, including future updates not yet made — must be mirrored
into `ENTVC.html` too. Waiting Lobby is NOT covered by this rule —
despite ENTVC.html also having its own copy of that scene, edits to
Waiting Lobby stay mplfs.html-only unless the user separately asks for
ENTVC.html to be updated too (confirmed explicitly after the
Waiting Lobby `redcorner.webm` accent was mirrored in by mistake). The
other deliberate exception is EN Casters positioning: it uses its own
`ws-encasters`-prefixed selectors and its own dashboard Edit config
(`entvc_encasters`), independent of the regular Casters panel,
precisely so it CAN be positioned differently per broadcast — don't
fold it into the mirroring rule either.**

How the mirroring actually happens, two different ways depending on
what changed:
- **Position/size edits** (dashboard Edit tab drag/resize) — automatic,
  no extra work needed. Both files write to and read from the SAME
  `overlay_styles.json` bucket (`styleFile: 'mplfs'`) for any selector
  that exists identically in both files' DOM — see
  `routes/overlayStyles.js`. A selector that only exists in one file
  (like EN Casters' `ws-encasters-slot-*`) only ever affects that file.
- **Everything else** (new JS features, CSS/animation fixes, new
  tunable settings, structural HTML changes) — must be hand-ported to
  both files, since they're independent `<script>` blocks, not shared
  modules. When asked to change one, check whether the same code exists
  in the other and update both. For a new shared *tunable* value (not a
  position/size), follow the small-dedicated-JSON-file-and-route
  pattern already used for `credits_speed.json` (`/api/credits-speed`)
  — both files fetch the same endpoint fresh each time the scene is
  shown, so tuning it once (from either file's Edit panel) affects
  both.

## Working from pasted design-tool CSS

The user often pastes CSS blocks exported from a design tool (layer
names like `.Layer_10`, `.Rectangle_2_copy`, `.Triangle_1_copy_2`) to
spec out a new overlay element's placement. **Extract only `left`,
`top`, `width`, and `height` (the position/size) from each block —
ignore everything else in it**: `background-color`/`background-image`
values, `z-index`, border-radius, etc. are placeholder/export noise
from the design tool, not real styling intent (the actual background
is almost always a real asset the user names separately, e.g. "this
container's background is `mapselectblue.png`"; the placeholder fill
color in the pasted CSS is not that asset's color). Nesting matters
though: when the user says "inside this container, .Foo goes here",
`.Foo`'s `left`/`top` are relative to that parent container, not the
overall 1920x1080 canvas — build it as a positioned child, not another
absolute-to-canvas sibling.

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

## Simpler show/hide — the checkOverlays pattern

Not every show/hide feature needs the full 6-layer mplfs-scene wiring
above — that's specifically for scenes that share mplfs.html's mutually
exclusive `activeFeature` slot. For a single independent on/off panel
(Draft.html's whole-scene toggle; mploverlay_v7.html's scoreboard,
player UI, item-check, emblem-check, gold-diff-check, and the four
side-*-checks), use this simpler pattern instead:

1. **Server state** — one boolean per key in `state.checkOverlays`
   (`lib/state.js`), regardless of which overlay page it belongs to.
2. **Server routes** — `GET /overlay/<key>/show` and `/hide` in
   `routes/overlay.js`, each flipping `state.checkOverlays[key]` and
   broadcasting a named SSE event (see itemcheck/emblemcheck/
   golddiffcheck for the pattern). The four side-*-check panels share
   ONE event name (`sidecheck`) with a `check` field naming the panel
   instead of one event per panel — do that when you have a family of
   near-identical panels, not for a one-off feature.
3. **Restore-on-load** — `GET /overlay/check-overlays` returns the
   whole `state.checkOverlays` object as-is; both the overlay page and
   the dashboard fetch it once on load instead of guessing.
4. **Client listener** — in the overlay's own JS (or
   `overlay-debug.js`'s shared SSE block for mploverlay_v7.html),
   `sse.addEventListener('<key>', ...)` toggling a CSS class that
   drives the animation.
5. **Dashboard control** — add `{ name, key }` to that overlay's
   `checkToggles` array in `dashboard.html`'s `OVERLAYS` entry. This
   auto-generates the toggle button AND both copy-route buttons next to
   it — no per-feature dashboard code needed. For a single whole-scene
   toggle with no "family" of panels, use the plain `show`/`hide` fields
   on the `OVERLAYS` entry instead (see `draft` and `draftindex`) — same
   copy-button behavior, just Show/Hide buttons instead of one on/off
   toggle.

**Default state matters for restore-on-load.** If a feature is normally
*on* (scoreboard, player UI, Draft's whole scene), default its CSS to
the SHOWN position with no modifier class, and only add a "hidden"
class once told to hide. Do it the other way around — CSS hidden by
default, "shown" class added once the restore-fetch resolves — and
every page load flashes blank for the length of that fetch. This bit
Draft.html and player-ui the first time they were wired up.

**A hide animation must clear the WHOLE box, not just one element in
it.** `#scoreboard-overlay` is a single 1920×1080 layer holding the top
HUD bar AND the map box (which sits as low as top:210px) AND the
sponsor loop — `translateY(-130px)` was tuned only for the top bar, so
the map box stayed on-screen after "hiding". The fix was
`translateY(-1080px)` — the layer's own full height, guaranteed to
clear everything inside it regardless of where any individual child
sits. When adding a new child element to an existing show/hide layer,
re-check that the hide transform still clears its lowest point — don't
assume the old offset still works.

### Universal "hide all in a group" buttons

To add a single button that hides several independent panels at once
(e.g. `Hide Bottom Overlays` for item-check/emblem-check/gold-diff-check
/fight-recap, `Hide Side Overlays` for all four side-*-checks): add ONE
new route in `routes/overlay.js` that flips every key's state and
re-broadcasts each panel's OWN existing event name/payload shape — do
NOT invent a new event for this. Zero client-side changes are needed,
since each panel already has a listener for its own event; the
"universal" button is purely a server-side fan-out. Wire it into the
dashboard via `extraActions` (auto-gets a copy button), not
`checkToggles` — that's for individual on/off state, this is a
fire-and-forget action with no "showing/hidden" indicator of its own.

### The dashboard must live-sync via SSE too — this is the part that bit us

`dashboard.html` keeps its own local cache of every toggle's state
(`featureStates`, `checkOverlayStates`, `mplfsSceneState`) so a button
can show "● Showing"/"○ Hidden" without re-fetching on every render. The
first version of this only updated that cache when the dashboard's OWN
button was clicked (an optimistic local flip on click) — so a universal
hide button, another dashboard tab, or a raw curl call would change the
real server state while the dashboard's indicator kept showing the
stale value forever, until a full page reload.

The fix: `dashboard.html` opens its own `EventSource('/overlay/events')`
(`dashboardSSE`, declared right after `toggleMplfsFeature`) and listens
for every toggle-relevant event, updating the cached state + button
straight from the SSE payload instead of from whichever button was
clicked. **Any new show/hide feature you add MUST get a matching
listener added to this same `dashboardSSE` block**, or its toggle button
will silently drift out of sync the exact same way — no error, it'll
just be wrong forever after the first change that didn't come from that
button. The click handlers (`toggleFeature`, `toggleCheckOverlay`,
`toggleMplfsFeature`) no longer flip local state at all — they only
fire the request and let the SSE echo-back update the UI.

## Data & assets

- Player/match data: `hlFetchMvp()` / `hlExtractPlayer()` hit the
  `game-mvp/view` API (repointable from Settings → `/api/highlights-url`);
  match/game number comes from `/match/state` instead.
- `campid`: `1` = blue/left/team1, `2` = red/right/team2 — same convention
  everywhere, including the main-info API (memory:
  `reference_mlbb_api.md`).
- Asset path conventions (all indexed by `heroid` or an id from the API,
  not hardcoded):
  - `/heromvp/MVP_<heroid>.png` — hero art for MVP Scene.
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
