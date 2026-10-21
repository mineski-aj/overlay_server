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

**`routes/*.js` and `lib/*.js` are NOT hot-reloaded — a server restart is
required before those changes take effect.** `html/*.html` changes take
effect on the next page load with no restart needed, which is easy to
conflate since most day-to-day work is HTML/CSS/JS-in-`<script>` edits to
the overlay pages themselves. If you edit a route or a `lib/` file, say so
explicitly and confirm before restarting — this is usually a server the
user started from their own terminal (not one this session spawned), so
don't kill/relaunch it silently. Concretely bit us: editing a shared
`*_api_url.json` file's on-disk *shape* (see "API Mode" below) while the
old route code was still loaded meant the GET endpoints briefly served the
raw new shape (`{live,web,debug}`) instead of the `{url}` contract every
caller expected, until the restart actually happened.

## Map

- `server.js` — Express app entrypoint, mounts everything in `routes/`.
- `routes/*.js` — API endpoints (match state, positions, fights, overlay
  styles, dashboard data, etc).
- `html/mplfs.html` — the main scoreboard/scene overlay (this is the file
  that gets extended with new "scenes" — MVP Highlights, MVP Scene, Final
  Team, Waiting Lobby, Team Line-Up, Casters, Hosts, Standings...).
- `html/heatmap.html` — a standalone, always-up copy of mplfs.html's Post Heatmap scene and nothing else (transparent 1920x1080;
  no show/hide, no scene video). Same markup/CSS/JS as the scene (generated from it once, now edit it directly — a fix to the scene's
  heatmap code must be hand-ported, like ENTVC.html). Loads, fills from `/api/heatmap-config` + `/positions` + the game feed, fades in
  and loops; re-pulls data at every loop wrap and on SSE `heatmap_config` (an empty/failed refresh keeps the map that's playing).
  Uses the shared SharedWorker SSE (`theme`, `heatmap_config`, `reload`) and the SAME saved Edit-tab overrides as the mplfs scene
  (`mplfs` bucket, only the `#hm-*`/`.hm-*`/`#hmst-*` selectors), so "Post Heatmap · mplfs" in the Edit tab positions both.
  **Live look controls (heatmap.html only)** — dashboard Control → Heatmap → "Heatmap Style": map brightness (follows the shared
  Post Heatmap Controls value until moved) + contrast, a brightness multiplier per heat-colour stop (9, blue → white-hot; `hmBuildCmap`)
  the size of the kill/death/assist markers (CSS vars `--hm-kill-size` etc.) and a **Player Photo Shown/Hidden** button (`photo` in the style; `.hm-nophoto` on `<html>` hides `.hm-player-photo-wrap` only —
  plaque/hero/stats stay; default shown; needs the restart for `photo` to be saved/broadcast). `GET/POST /api/heatmap-style` (routes/devapi.js,
  `heatmap_style.json`, clamped) broadcasts SSE `heatmap_style` carrying the full style, so slider drags apply instantly
  (`hmApplyStyle`); the mplfs scene is NOT affected.
  **Show/hide (GPU saver)** — dashboard Control → Heatmap → "Heatmap" toggle = checkOverlays key `heatmappage`
  (`/overlay/heatmappage/show|hide`, SSE `heatmappage`, worker v37). **Hidden by default**: the page loads idle
  (`display:none`, no RAF loop, no fetches; `heatmap_config` ignored) and only fetches/fades in on Show; Hide fades out,
  stops the loop and resets. `?preview=1` copies (Control/Edit iframes) ignore it and are always shown. Needs a server
  restart (new route); `heatmappage` and `heatmap_style` are in `KNOWN_EVENTS` (worker v37).
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
- `html/led_overlay.html`, `html/Led_draft.html`, `html/js/led-events.js` — the
  2532x1024 LED-wall pages (player plates / draft cards + mid panels) and their
  shared event/panel engine. See "LED wall pages" below.
- `html/DraftIndexV2.html` — Draft Index with player strips + hero reveal (see "Playoffs theme — working notes"). `html/js/hero-web.js` — WebP hero portraits with PNG fallback for `mplfs.html` / `mploverlay_v7.html`.
- `html/js/theme-apply.js` — applies the global broadcast theme
  (Regular/10th Anniversary/Playoffs, Settings page picker) as
  `data-theme` on `<html>` for every broadcast-source page (see "Theme
  system" below). Independent of the SharedWorker above — included on
  every overlay page, even the ones with no live SSE connection at all.
- `heromvp/`, `herohighlights/`, `hero/`, `items/`, `role/`, `logos/`,
  `emblem/`, `photos/`, `hires/` — image asset folders, one per asset type
  (see naming conventions below).
- `*.json` at repo root (`match_state.json`, `positions_live.json`,
  `overlay_styles.json`, `mainroster.json`, `theme.json`, etc) — live
  state files the routes read/write; not meant to be hand-edited.
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

**To actually unload an iframe (stop it running, not just hide it),
set `src = 'about:blank'`, never `src = ''`.** An empty string is not
"no document" — the browser resolves it relative to the current page
and the iframe silently loads the *parent page itself*, recursively.
This is a real, easy-to-miss bug: it renders identically (invisible,
since it's normally overlaid or covered anyway) but the parent page's
entire JS keeps running nested inside the iframe, doing whatever that
page does when loaded standalone. Always `about:blank`.

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

**Not yet migrated — `html/fights.html`.** Uses a non-standard
connection pattern (an explicit `host`/`baseUrl` variable instead of
same-origin, plus its own manual reconnect-on-error logic) that needs
individual verification of same-origin assumptions before swapping in
the shim — deliberately deferred rather than migrated blind.

(`html/heart_stopping_moment_v14.html`, the old standalone BPM meter
page previously listed here, is retired — the feature now lives inside
`mploverlay_v7.html` as a normal checkOverlays panel, see
`html/js/overlay-bpmmeter.js`, so it rides the shared SharedWorker
connection like every other mploverlay_v7 feature and was never a
migration candidate on its own.)

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

**Whenever you add a name to `KNOWN_EVENTS` (or otherwise change
`overlay-shared-worker.js`), you MUST also bump
`OVERLAY_WORKER_VERSION` in `html/js/overlay-sse-shim.js`.**
`SharedWorker`s are reused by exact script URL — a tab/OBS
browser-source that's been open since before your change is still
talking to the OLD worker instance in memory, which never learned
the new event name, no matter how many times that tab is refreshed
or how correct routes/overlay.js and the client listener are.
`OVERLAY_WORKER_VERSION` is a cache-busting query param
(`?v=N`) on the worker's URL specifically so a plain page reload is
enough to pick up a fresh worker — skip the bump and the only fix
left is closing every single tab/browser-source on the whole origin
at once. This exact bug shipped once (Post 4 Key's Control-tab
toggle and Edit-tab preview both looked completely broken — right
server route, right client code, stale worker) and cost a full extra
round trip to diagnose, so treat it as a required step, not an
afterthought, when adding a feature to this server.

**Before calling a new feature done, verify the Control-tab
toggle button AND the SSE round-trip actually work — not just that
the server route returns 200.** `curl`ing `/overlay/<key>/show` only
proves the route exists; it says nothing about whether a connected
mplfs.html tab actually reacts, because that hop goes through the
SharedWorker described above. Test it properly: load the page fresh
(a brand-new Playwright/browser context has no stale worker to hide
behind), click the real Control-tab toggle button, and confirm a
*separate* tab/page picks up the change — the Post 4 Key bug above
looked fine under `curl` and only showed up when someone actually
pressed the button in a real, already-open browser tab.

## LED wall pages — `html/led_overlay.html`, `html/Led_draft.html`, `html/js/led-events.js`

Two always-on 2532x1024 browser sources for the LED wall: a gold-framed 1024
square on each side (`assets/led/goldborder.png`, 12px ring, transparent
centre) and two 242px **mid panels** between them (`#mid-left` / `#mid-right`:
team logo + tricode + 4 stat boxes, art `assets/led/sidebacker.png`).
**LED Overlay** fills the squares with 10 player plates; **LED Draft** fills them
with draft cards. Both are Control-tab entries with `previewSize: [2532, 1024]`
(`scalePreview()` honours a per-overlay size) and the same `extraActions`
(HOME/SWAP + the four mid-panel Show/Hide pairs). Same-origin data: game feed
`/api/gamedata-proxy`, BPM `/feed`, `/api/winrate-probability` (proxy in
`routes/proxy.js`), `/proxy/predictions`. HOME/SWAP = SSE `led_side` via
`/led/home|swap`. Not wired on either: Edit-tab positioning, Control-tab Preview
buttons. `routes/led.js` holds every `/led/*` route.

**Auto side from the Match Board (`html/js/led-autoside.js`).** Match Board
HOME is ALWAYS the left LED square, AWAY the right, regardless of which game
camp (blue/red) each is on that game — but only when BOTH game-feed camps match
the Match Board's two teams (`team_simple_name`/`team_name` vs `/match/state`
`home|away` `short`/`name`, case-insensitive). `LedAutoSide.resolve(camp_list)`
returns swapped / not swapped / `null` (can't tell; `/match/state` refreshed every
3s). Both pages keep `manualSwap` (HOME/SWAP buttons, SSE `led_side`, localStorage)
and `autoSwap`; `applySwap()` uses `autoSwap` when non-null, else `manualSwap`, so
the buttons only matter when the teams don't match. Each page's `pollSubInfo()`
calls `resolve()` every tick. Team spellings must match between the Match Board
and the game API or it silently falls back to manual.

**PENDING SERVER RESTART (as of the end of the session that wrote this).** These
server edits are NOT live until the user restarts (ask first — it's their
terminal): `lib/state.js` (`led_*` feature toggles, `checkOverlays.led_draftpred`,
`ledDraftPhotoMode`), `routes/overlay.js` (`VALID_FEATURES` +5 `led_*`),
`routes/proxy.js` (`/api/winrate-probability`), `routes/led.js`
(`/led/draftpredtest-reveal|slot`, `/led/draft-photo-mode[/:mode]`, draft-pred
state). Symptoms before restart: LED event toggles dead, Win Probability empty,
Draft Predict not restored on reload, test buttons / photo-source buttons 404.
No `KNOWN_EVENTS` / `OVERLAY_WORKER_VERSION` change was needed for any of it —
everything rides existing events (`led_side|led_health|led_win|led_fight|
led_draftpred|featuretoggle|theme`), new behaviour is new `action` values.
**Keep it that way** (and make listeners ignore unknown actions — an old `else →
hide` fall-through in the `led_draftpred` listener once hid the panel on every
photo-mode toggle).

### `led-events.js` (an IIFE — the pages' inline scripts reuse global names)
Fed by `LedEvents.onData(gameData)` / `LedEvents.setSwapped(bool)`. Ported from
the old standalone `MPL_LED/led_events.html`:
- **Plate events** (First Item Priority, Trinity, Quick Swap, Level 15,
  Conceal): mploverlay_v7 "eventer" style — one 502x89 card per plate over the
  item row (art `assets/led/eventback.png`), wipes in from the plate's outer edge,
  items right-aligned at 83px (label/time in a left column so item art fills the
  card height), sheen sweep, one-at-a-time per plate with a per-type queue,
  safety-net timeout, `runCard()` is the shared runner. **Right plates' item bar is
  16px further right than the left's** (257..759 vs 241..743 — measured off
  `plateright.png` / `plateleft.png`), hence `.camp2 .led-evt-clip { left: 257px }`.
  Armed by their OWN keys `led_items|led_trinity|led_swap|led_lvl15|led_conceal`
  (independent of v7's `items|trinity|…`; dashboard `featureToggles`). Previous
  state is tracked per SEAT, not plate, so a HOME/SWAP flip can't fire false events.
  `runCard` no-ops when `#plate-N` is absent (Led_draft has no plates).
- **Mid-panel features**: Team Health / Win Probability / Team Fight / Draft
  Predict, shown via SSE `led_health|led_win|led_fight|led_draftpred`. The panels
  start `display:none` set INLINE at init (several guards test
  `style.display === 'none'`, which is false for a CSS-only hide — that bug had
  hidden panels polling forever).
- **Team Health** is a transform-only bar (no canvas, no rAF): `.thp-fill` slides
  by (1-hp)*650px while `.thp-fill-in` counter-slides so the gradient stays pinned;
  red damage trail (`.thp-ghost`) lags a hit; green flash on heal; colour state
  ok/mid/low via CSS vars on the track.
- **Mid-panel "reel"** (in/out animation of the four features): only the LOWER
  region (y 357..1024, the stat boxes) reels; logo + tricode never move. Features
  live in `#led-reel-window` (clip, top:357px, 667px tall) and drop in from the top
  pushing the default `.mp-stats-inner` down; exit keeps going down while the
  default drops back in from the top. Same keyframe times offset by exactly 667px
  keep the seam glued (`ledReelIn/Out`, `ledMidOut/Back`). A MutationObserver in
  `led-events.js` watches the four panels and toggles `led-mid-out/back` on the mid
  panels + `led-reel-on` (a 3px gold cap hiding the notch above the feature art,
  which is opaque only from y=360). The baked divider lines/triangles in
  `sidebacker.png` are covered by `.mid-panel::after` (`sidebacker_plain.png`, a
  line-free tile) while the reel runs and removed when the default is back.
- **Draft Predict** = Draft.html's **v3 engine** (`dp*` mirrors `dp3*`): hero art
  from `candidates[].heroName` via `heronames.json`; reveals read from the same
  `/proxy/predictions` response's `draftState`, matched to slots by elimination;
  active prediction derived from draftState counts; polls from page load so Show
  never replays history; **Show stays up until Hide** (`dpPickToShow()` falls back
  to the current/last slot instead of v3's auto-hide); both columns cleared on new
  draft / Show / SWAP; reel only spins while visible; shown state remembered
  server-side (`checkOverlays.led_draftpred`, restored via `/overlay/check-overlays`).
  Not ported: plate gate, AI rationale bubble. **Dashboard test relay**: the Draft
  Overlay card's "▶ Test Draft Predict v3" button and per-slot ▶ Show / ✓ Settle grid
  also fire `/led/draftpredtest-reveal|slot` (checkbox "Also send to LED Overlay
  (live)", default on, persisted in localStorage) → SSE `led_draftpred`
  `test_reveal|test_slot` → `dpTestReveal()/dpTestSlot()` on the LED page(s). These
  hit the REAL instance, unlike the preview-only originals. Polling is suspended 15s
  per click; the fixture demo hands the screen back to the real feed afterwards.
- **Ported from mploverlay_v7 later** (same data paths/rules as "mploverlay_v7 features added
  later"; unverified against a live feed): **Sky Piercer stacks** (`led_skypiercer`, kind
  `skypiercer`, stack 3/5/7…, `triggerSkyPiercer`, prev milestone per SEAT) and the
  **phase 2 core-item timing** on First Item Priority (`first_item`, arrow + seconds over the
  title strip) and Trinity (`core_item`, time over arrow + seconds in the title column).
  `runCard(..., p2fn)` checks `p2fn` at 1.5s; a view model → `.led-p2` on the clip and hold
  to 4200ms, null → leaves at 2400ms as before. `timingFor()` reads the latest poll for that
  plate's seat (`seatToPlate` is its own inverse) unless the payload carries `core` (debug).
  Lord Advantage was NOT ported (it hangs off the v7 scoreboard, which LED doesn't have).
  `led_skypiercer` also needs the pending server restart (`VALID_FEATURES`, `lib/state.js`).
- Debug panel (`` ` ``): per-event / per-plate trigger buttons (plates only),
  side-panel Show/Hide, DP test picks.

### LED Overlay specifics (`led_overlay.html`)
KDA columns on the plates: left centres 295.7 / 376.2 / 456.7, right is the exact
mirror (right offsets 406.7 / 326.2 / 245.7 on a 1000px plate). Items update with the
ingame_blue/red `item-pop` (no combine animation, in-place slots). Mid panels fall
back to `assets/mpl2026logo.png` when `logos/<TEAM>.png` is missing (tracked via a
dataset flag — `cache-bust.js` appends `?v=` to every `img.src`, so never compare
`img.src`).

### Performance rules learned (headless trace, then fixed) — keep them
- **Raster, not JS, was the cost.** Anything that repaints every frame on the shared
  page layer dirties big tiles (plate art, portraits, borders) → ~230ms/s GPU.
  Per-frame things (EKG line, heart pulse) need their OWN compositor layers
  (`will-change: transform` on BOTH `.ekg-zone-led` and `.heart-bpm` — either alone
  does nothing). 200→100 EKG points (same time span) was free.
- **EKG lines are 62x28 <canvas>es, not SVG paths** (`drawEkg`, led_overlay.html): the SVG path's `d` rewrite + CSS mask cost ~80ms paint +
  ~30ms raster per 3s and 20 full-page repaints/frame; canvas (edge fade baked in via destination-in, no mask-image) drops paint/raster
  to ~0, redraw capped ~30fps, and a flat idle line (no BPM) is not redrawn at all. Don't go back to animating an SVG `d`.
- Death-timer: write text only when the displayed second changes and toggle the
  class only on state change (it was rewriting `class` for all 10 players every frame
  and re-rasterising filtered portraits).
- Poll paths write-if-changed (`setText`), cache image `src` in `dataset.src`
  (the `endsWith(src)` check never matched because of cache-bust → 120 src writes/5s),
  squeeze names only when the name changes, skip `setHP` when unchanged.
- No canvas / rAF loops for hidden panels; no always-on `<video>` decoding; create
  media lazily.
- Measure with: `Tracing` categories `devtools.timeline,disabled-by-default-
  devtools.timeline,cc,gpu` (GPUTask / RendererRasterWorker / BeginMainFrame per
  second), `Profiler` for JS self time, a MutationObserver counting attribute writes
  per frame, and `Paint` event clips. Hiding a suspected element and re-tracing is
  the fastest bisect — but re-test after each fix, early results get confounded.

### LED Draft (`Led_draft.html`)
Same shell; the two squares become **draft cards**: per camp a 1000x1000 box at
(12,12) = header 163 (team logo · slanted tricode block with gold edges ·
series-score bars) + transparent middle 564 + player row 273 (5 slots x 200).
Colour follows the CAMP (blue = camp 1, red = camp 2), layout follows the SIDE
(`.side-left/.side-right`, flipped by HOME/SWAP; the right side is the left
mirrored via `scaleX(-1)` on the header with logo/tricode un-flipped; seat 1 on the
outer edge). Data = Draft.html's feed (`/api/draft-url`, draft-info-only format,
`normalizeDraftPayload`, a changed `BattleID` reloads the page), `/match/state` for
the bars (always filled from the inner edge), game feed for the mid stats.
Player slots port Draft.html: idle FRONT photo on a CSS gold-stripe plate (no asset
existed) → on the picking turn the PICKING video + glow play (NO role icon — the user
removed it from LED Draft, along with the role-assignment code and `/api/draft-roles`
fetch; don't re-add), FRONT → VICTORY → on pick the `HERO_PICK_DRAFT_<id>.webm`
matte-wipe reveal (GPU canvas composite) erases the photo, glow, then the hero-name
strip (Anton, bottom 50px) pops up. Matte/PICKING videos are created lazily.
**The picking glow and "PICKING" video are Draft.html's own per-theme defaults**
(glow: Regular camp blue/red, 10th Anniversary orange, Playoffs gold; video:
`assets/motion/picking{blue,red}.webm` — which already have real alpha — with the
anniversary variants and screen blend only for anniversary). Do NOT re-tint or
re-bake them (a baked-alpha + screen-blend attempt looked wrong and was reverted).
**Player photo source** is LED-Draft-only (`state.ledDraftPhotoMode`,
`/led/draft-photo-mode[/:mode]`, SSE `led_draftpred` action `photo_mode`; dashboard:
LED Draft card → Player Photo Source): `live` matches seat names to photos,
`placeholder` gives every seat a fixed stand-in (sorted photo pool, camp 1 → 0-4,
camp 2 → 5-9) regardless of the draft-API lineup. Deliberately NOT Draft.html's
shared `/overlay/draft-photo-mode`. Debug panel (`` ` ``): photo-source buttons +
a draft sim (`__drSim`) driving the same `applyDraft()` path (the sim must reuse the
live battle id or the page reloads). Not ported from Draft.html (not in the LED
design): ban plates, timer bar, status text, map bug, coach row, Draft Stats / buff
badges — easy follow-ups if wanted (ban plates need a home in the transparent middle).
`Led_draft.html` was assembled from `led_overlay.html` pieces plus new CSS/JS, but
the generator was throwaway: **edit the file directly now**.

**LED Draft perf:** measured idle cost = the 10 looping `HERO_PICK_DRAFT_<id>.webm` videos (200ms GPU/3s; paused = 0). Pick/reveal
animations are cheap (~40-75ms/3s). Opt-in `Led_draft.html?heroloops=N` plays each hero clip N times then holds the last frame
(paused, ~90% less GPU); default (omitted) = loop forever, unchanged. Clips are 4-10s each.

### Testing LED pages without a live feed (what worked)
Throwaway Node mock of the server (static repo files + mutable `/api/gamedata-proxy`,
`/proxy/predictions`, `/api/draft-url` + a draft payload, `/match/state`,
`/api/player-photos` (only names with BOTH FRONT and VICTORY files), `/led/*`,
`/__push?event=&data=` to emit SSE) + headless Edge on a debugging port driven over
raw CDP (see "Verifying changes with a real browser"). Replay
`predictions_test.json` slot by slot for Draft Predict; `sub-info_sample.json`
(contains U+00A0 / U+2028 — split/join them out before `JSON.parse`) for game data.
Gotchas: `pkill -f` must match how the mock was launched (a stale mock silently kept
the port); never `curl` a big JSON without `| head`; when writing JS regexes via a
heredoc, ` ` can turn into the literal character — re-escape it.

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

## `mploverlay_v7.html` — modular per-feature files, two very different feature shapes

Unlike `mplfs.html` (one giant file/script), `mploverlay_v7.html` is a
thin HTML shell that loads one `<script>` per feature —
`overlay-lvl15.js`, `overlay-items.js`, `overlay-trinity.js`,
`overlay-swap.js`, `overlay-conceal.js`, `overlay-killevents.js`,
`overlay-objectivespawn.js`, `overlay-fights.js`, `overlay-itemcheck.js`,
`overlay-emblemcheck.js`, `overlay-golddiffcheck.js`,
`overlay-sidecheck-core.js` + 4 `overlay-side*check.js` variants,
`overlay-playerui.js` — plus two shared files every feature depends on:
`overlay-core.js` (state, the polling engine, item/role data tables) and
`overlay-debug.js` (the on-page debug bar, the one real SSE connection,
and — today — most features' actual auto-trigger *detection* logic, even
though each feature has its own file for everything else). New features
get their own new `.js` file, included as one more `<script>` tag in
`mploverlay_v7.html`.

There are **two unrelated feature shapes** here — figure out which one a
new feature is before wiring anything, since they don't share a
checklist:

**Shape 1 — a persistent on/off panel** (Item Check, Emblem Check,
Gold Diff Check, the four side-\*-checks, Scoreboard, Player UI). This is
just the **checkOverlays pattern** documented above, nothing new: a
`state.checkOverlays[key]` boolean, `/overlay/<key>/show|hide` routes, an
SSE listener in `overlay-debug.js`'s IIFE at the bottom, a `checkToggles`
entry in `dashboard.html`. The only `mploverlay_v7.html`-specific
convention is naming: each panel's build/animate functions share a
short prefix matching its abbreviation (`icBuildPanel`/`icAnimateIn`/
`icAnimateOut` for **i**tem**c**heck, `eccBuildPanel`/`eccAnimateIn`/
`eccAnimateOut` for **e**mblem-**c**heck-**c**heck, `gdcAnimateIn` for
**g**old**d**iff**c**heck, etc.) — follow it so a new panel's functions
are predictable from its abbreviation. The four side-checks additionally
share ONE SSE event (`sidecheck`, with a `check` field) via
`SIDE_CHECK_HANDLERS` in `overlay-debug.js` instead of one event each —
add your panel there, don't invent a new event.

**Shape 2 — an automatic per-player reactive effect** (Level 15, Item
Pickup, Trinity, Quick Swap, Conceal, Kill Events, Objective Spawn).
These aren't manually shown/hidden — they **fire on their own** when
`masterPoll()` (runs every 1s, `overlay-core.js`) notices something in
the live game-data poll, are individually **armable/disarmable** from
the dashboard (so a caster can turn off "Item Pickup" without turning
off the whole overlay), and are **queued** rather than dropped if
another effect is already animating for that same player. This is the
part of the file that's easy to half-wire, since it has more moving
parts than a simple show/hide toggle:

1. **Arm/disarm toggle** — add your feature's key to `VALID_FEATURES` in
   `routes/overlay.js` (`GET /overlay/feature/:feature/:action`, a single
   generic route shared by every feature — you do NOT add a new route),
   add its default to `featureEnabled` in `overlay-core.js`, and add
   `{ name, feature }` to `dashboard.html`'s `featureToggles` array (a
   flat "● Enabled"/toggle list, separate from `checkToggles`). **The SSE
   side is already generic and needs no new listener** —
   `overlay-debug.js`'s existing `sse.addEventListener('featuretoggle', ...)`
   updates `featureEnabled[d.feature]` for ANY key already present in that
   object, so skipping this step entirely (forgetting to add the
   `featureEnabled` default) is what actually breaks — the toggle button
   will exist and looks like it works, but the object it's writing into
   was never listening for that key.
2. **Detection logic** — a block inside `registerPollHandler(function(data)
   {...})` in `overlay-debug.js` (today, all features' detection lives in
   this one shared handler, not split per-file) that compares this poll's
   data against the previous poll's (`prevLevel`, `prevEquipState`,
   `prevTotalDamage`, `prevBlessingGold` — add your own `prevXxx` object
   for whatever you're diffing) and decides whether to fire, gated behind
   `featureEnabled.yourFeature`.
3. **The per-player trigger function itself** — follow
   `triggerLvl15(i, ...)` in `overlay-lvl15.js` as the reference shape
   exactly, it's the smallest complete example:
   - Guard re-entrancy: `if (isPlayingYourFeature[i]) return;` then set it
     `true`.
   - A `cleanup()` closure (guarded by a local `cleanedUp` flag so it only
     ever runs once) that resets the visual state, sets
     `isPlayingYourFeature[i] = false`, and **calls `playNextQueued(i)`**
     — skip this call and anything queued behind your effect for that
     player never fires, silently, forever.
   - A safety-net `setTimeout(cleanup, <a bit longer than the animation>)`
     alongside the normal animation-driven path to `cleanup()` — belt and
     suspenders in case the normal path never fires for some reason.
4. **Wire it into the shared mutual-exclusion system** — add
   `isPlayingYourFeature = {}` and `yourFeatureQueue = {}` (both
   per-player objects, alongside the existing `isPlayingTrinity`/
   `trinityQueue` etc. in `overlay-core.js`), add your feature to the
   OR-chain in `isAnyPlaying(i)`, and add an `else if` branch to
   `playNextQueued(i)` checking `yourFeatureQueue[i] && !isPlayingYourFeature[i]`.
   Miss this and your effect can visually stack on top of another one
   still playing for the same player instead of queueing politely behind
   it.
5. **Debug bar** — a `▶ Pn` button per player in `overlay-debug.js`'s
   loop (same shape as the existing Level 15/Item/Trinity/Swap loops),
   plus a `<div id="tab-yourfeature">`/`<button data-tab="yourfeature">`
   pair in `mploverlay_v7.html`'s debug area markup.
6. **Preview Tester** (`previewDebugTester: true` on the dashboard's
   `mploverlay7` entry) — the "Player / Feature / ▶ Test" widget calls
   `window.iframeTest(playerIdx, feature)`, which is its own manually
   maintained `if (feature === '...')` dispatch chain in
   `overlay-debug.js` — same silent-no-op risk as `previewTrigger`
   elsewhere in this codebase if you forget to add your feature's branch
   here too.
7. Sanity-check + syntax-validate + live-verify as usual (see the Master
   checklist below) — additionally confirm from a real poll tick (not
   just the debug button) that your feature actually fires, since the
   debug button bypasses `masterPoll()`'s detection logic entirely and
   proves nothing about step 2.

`killEventTrigger: true` (kill events' own dashboard video-picker +
manual trigger UI) and the "Kill Event Player Photo" Live/Random toggle
next to it are bespoke, one-off dashboard blocks built specifically for
kill events' fixed enumerable video list — not a reusable pattern to
copy for a different feature.

### mploverlay_v7 features added later (all unverified against a live feed unless noted)

- **Sky Piercer Stacks** (`js/overlay-skypiercer.js`, Shape 2 reactive effect, key
  `skypiercer`, armable via `featureToggles`): Item Pickup card (label SKY PIERCER,
  `Items/2014.png`, "N STACKS" in the time slot, `.skp-label/.skp-time` CSS) per
  player at stack 3, 5, 7… (milestone = largest odd ≥3 ≤ stack; a drop re-arms; first
  poll is baseline only). Stack read from `player.extra_param.sky_piercer_stack.stack`
  (fallback `player.sky_piercer_stack`) — `getSkyPiercerStack()`; the real path was
  never confirmed. Wired into `isAnyPlaying`/`playNextQueued`/`resetGameState`
  (guarded with `typeof` because the file loads after core), debug tab + `iframeTest` +
  dashboard Preview Tester entry.
- **Lord Advantage** (`js/overlay-lordadv.js`, key `lordadv`, armable): white panel under
  each camp's tricode (`#lordadv-c1` left 338 / `#lordadv-c2` left 1218, top 78, 290x58),
  inserted as `#scoreboard-overlay`'s FIRST child so it sits behind the scoreboard art and
  slides with it; top shadow via `::before`. Shows +GOLD / KILLS / TURRET for 90s (`LORDADV_SHOW_MS`) from the moment the Lord dies — once per
  (camp, `begin_time`), triggered as soon as `camp_list[].kill_lord_advantage.begin_time` appears (NOT when `end_time` is set, ~120s later), with the numbers updating LIVE every poll (also reads
  `data.kill_lord_advantage[campid]`). Gold = API `gold`; KILLS/TURRET are the camp's
  `score` / `kill_tower` diffs between per-poll snapshots at begin/end time (the API only
  has tower HP). Lord icon gold both sides, "ADVANTAGE" title blue/red, bar follows theme
  accent (gold in playoffs). Edges measured off `assets/ingame/playoffs/ingamepng2.png`
  (gold logo box starts x=338, gold match-info box x=1508, bar art ends y=80). NOT in the
  dashboard Edit tab. Debug tab has GOLD/KILLS/TURRET inputs + show/hide per side.
- **Trinity + First Item Priority "phase 2"** (core-item timing): after 1.5s the title fades
  to a timing line, then holds to ~4.2s. Trinity: `time ▲/▼ 33s FASTER/SLOWER` from
  `player.extra_param.core_item` (or `player.core_item`); First Item Priority: arrow +
  seconds only (`.trn-p2-notime`, the time is already on the card) from `first_item`
  (`FIRST_ITEM_KEYS`). Shared `coreItemPhase2()` in `overlay-trinity.js`: `no_data` / zero
  times / zero diff → null → card leaves at 2.4s exactly as before; `late` = slower, else
  `time > fastestTime`; seconds = |difference|. Data is looked up from `lastData` at the
  1.5s swap moment (feed may publish a poll late). Green is dark (`#0b6b2a`) on purpose —
  lighter greens vanish on the card. Shared CSS: `.trn-p2*`, `.trn-phase2`, `.trn-slower`.
  Debug tabs (TRINITY, ITEM PICKUP) have a "PHASE 2" dropdown (live / fake faster / fake
  slower / fake no data). `core_item`'s real parent path was never confirmed.

### Team Line-Up V2 — polaroid intro (mplfs.html, `lineupv2_blue` / `lineupv2_red`)

Per-side `featureToggles` (a V1/V2 button inline in the Team Line-Up Blue/Red rows of the Control tab, via the `versionToggle` field on those `features` entries; default off = V1) that swap
Phase 1's group photo for 5 polaroids of the lineup (`photos/Dynamic/2_CROPPED BUT NOT BNW/<TRI>_<ign>.jpg`, TRI = Match
Board `short`, ign = lineup ign) dropping at random jittered spots/tilts, staggered `LU_POL_STAGGER_MS` (5 land in ~2s), held
`LU_POL_HOLD_MS`, then the layer buttons out (`.lu-group-out`) and Phase 2 starts as normal. Big team-name `.lu-bg-photo` stays
behind. Built in `luApplyPolaroids` (called from `luPreloadLineup`), played by `luPlayPolaroidIntro`; photos that 404 are dropped,
and if none load it falls back to V1. Polaroids are random/transient, so not Edit-tab elements. Needs a server restart
(`VALID_FEATURES` in `routes/overlay.js`, `lib/state.js`); no `KNOWN_EVENTS` change (rides `featuretoggle`).

### Credit Reel V2 — side panel (mplfs.html, `credits_v2` featureToggle)

V1/V2 button inline on the Credit Reel row (same `versionToggle` mechanism as Team Line-Up). V2 = the same reel (same
data/speed/style, `crShowImpl`) in its own 480px panel at x=1440 (`#credits-viewport-v2`/`#credits-scroll-v2`, text wraps,
28px side padding, nothing overflows) with a black gradient fade (`#credits-fade-v2`, x 960..1440) beside it; everything left
of x=1440 is transparent. The background is clipped, not hidden: `showSceneVideo('credits')` sets `clip-path: inset(0 0 0 1440px)`
on the layer it starts (`svSetClip`; every other scene's start clears it, so it can't leak) and `crShowImpl` clips `#bg-video`
(un-clipped 450ms after hide, after the video's fade-out). Own Edit config `mplfs_credits_v2` (V1's config previews V1 via
`showCreditsSceneV1`, V2's via `showCreditsSceneV2`; both share the Content box). Needs a server restart (`VALID_FEATURES`,
`lib/state.js`); no `KNOWN_EVENTS` change.

### MVP Scene V2 — transparent over the live camera (mplfs.html, `mvp_v2` featureToggle)

V1/V2 button on the MVP Scene row (`versionToggle`). V2 = `#mvp-page.mv-v2`: same background loop as V1 (no longer transparent — `showSceneVideo('mvp')` via `transitionToImpl` as usual), NO signature photo, (the black right-half gradient was removed), OF THE GAME / "MATCH n - GAME n" (`#mv-matchbox-game`/`#mv-po-matchgame`) keep their V1 colours (black in playoffs) — smaller hero near the left edge of the MVP text webm. Elements animate in `MV_V2_ELEMENTS_DELAY_MS` (1000ms) after the trigger (webm restarted then; CSS `mvV2*` keyframes), background first.
V2 default CSS is `!important` (V1's saved `#mv-hero-img` override is `!important` too); V2 Edit rows (`mplfs_mvp_v2`, `MV2_*` in dashboard.html) save under `html #mvp-page.mv-v2 <id>` so they win and never touch V1.
V2 hero reuses V1's saved Feather/Intensity. `mplfs_mvp`'s showFn is now `showMvpSceneV1` (forces V1 in the Edit preview). Needs a server restart (`VALID_FEATURES`, `lib/state.js`); no `KNOWN_EVENTS` change.

### MVP Highlights V2 — no player photo (mplfs.html, `hl_v2` featureToggle)

V1/V2 button on the MVP Highlights row (`versionToggle: 'hl_v2'`). V2 = `#highlights-page.hl-v2`: identical scene minus the signature photo (`.hl-player-photo-wrap` and, in playoffs, the corner graphic `#hl-playoffs-coverer` that sits over it are `display:none !important`; `hlApply` skips loading the photo). Class is set in `hlShowImpl` (not flipped while the page is still `hl-on`) and removed on hide. `showHighlights` follows the toggle; `showHighlightsV1/V2` force it (the Edit tab config `mplfs_highlights` previews V1 so the photo stays editable). No new Edit rows. Needs a server restart (`VALID_FEATURES`, `lib/state.js`); no `KNOWN_EVENTS` change.

### Team Hexagon — playoffs "V3" layout (mplfs.html, `data-theme="playoffs"` only)

Re-laid-out off the reference "8. Head to Head V3" (all canvas-absolute CSS in the "Playoffs — Team Head to Head V3" block; Regular /
10th Anniversary are untouched). Header strip (inline SVG, blue/gold/red slants + "VERSUS") with the two team LOGOS only (names hidden);
full-height centre panel (`#th-po-center`, gold border); radar centre moved to canvas (960,504), R=261, 8 rings (`thR()`/`thCy()`,
`TH_PO_AXES` label/value positions); bottom stats are 2 groups x 3 full-width bars (blue value | gold label | red value, same six
`#th-bar-*` nodes; `setThBar` sets `data-lead` so a gold triangle marks the leading side, lower-is-better stats respected).
Player panels (535x887, `.th-player`): the BNW crop `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` (grayscale WebP q90, ~0.1-0.3MB each; `thBnwUrl`; the pre-WebP PNGs / pre-recrop originals live in `old/` and a backup zip) + a team hue (`screen`
blend of a deep navy/dark red + an edge-glow gradient) + an inset 2px frame behind + the coloured `hires/LEFT|RIGHT` cutout in the bottom
corner. `thSwapPlayoffs` eases BOTH images in on top of the previous pair (never emptying the frame); a missing file fades that image out.
No Edit-tab config exists for this scene. No art existed for the header/panel/bars, so they are CSS/SVG (old `playoffs_hexa*` art for
accents/banner/statbox is now unused; the two name plates still use `playoffs_hexabluename/redname.png`).

### Post Gold Distribution (mplfs.html, route/event `post_golddistri`, internal `golddistri`)

Post-family scene (Matchboard compact header, middle/player boards off — same board handling as
Post 4 Key; in `POST_FEATURES` + `COMPACT_MATCHBOARD_FEATURES`). Five lane columns (EXP / JUNGLE / MID /
ROAM / GOLD), camp 1 blue left, camp 2 red right: hero card, name, GPM, TOTAL, then one split bar per
gold source. Data: `/api/postinfo-proxy` `hero_list[].gold_map` (same sector keys as v7's Side Gold Distri:
1 minions, 2 jungle creeps, 3 turtle+lord, 4 turrets, 5 roam equip, 6 kills+assists, 9 roam vision; roam
column shows 5 and 9), `total_money`, GPM = total_money / game minutes. The lane of each player comes from
the game feed's `seat.role` matched by NAME (falls back to feed seat order, then leftover order) — if the
two feeds spell a name differently the lanes can end up wrong. Edit config `mplfs_golddistri` moves the
five columns as one unit (`#pgd-cols`). Server restart needed for `/overlay/post_golddistri/*`.

### Post Kill Events (mplfs.html, route/event `post_killevents`, internal `killevents`)

Same Post-family board handling as Post Gold Distribution. Left: OBJECTIVES (TURTLE / LORD / TURRET / PURPLE /
ORANGE / LITHO) from the Post-Info `camp_list` — counts (`kill_totoise` (sic), `kill_lord`, `kill_tower`,
`blue_buff_num` = purple, `red_buff_num` = orange, `crab_kill_num` = litho) + the matching `*_time_list` arrays,
split bar (leader bright, trailer dim). Right: big Kill Map = `assets/postkill/killmap.webp` (consomap.png
upscaled 4x with the Magnific connector, 512 -> 2048, saved as a 1600px WebP) with circular hero portraits
(killer's hero from the game feed seat) at kill positions computed exactly like Consolidated Post 2
(`/events` kills x `/positions` -> `ckmGameToLocal` in its 205x211 space, scaled to the square). Map name/icon
resolve like fetchCmbData's (Map Selection game slot, else Match Board map). Edit config `mplfs_killevents`
(objectives panel + map as two units). Server restart needed for `/overlay/post_killevents/*`.

### Playoffs header bar text (Today's / Tomorrow's / Waiting TVC / Waiting Lobby)

`MPL PH S18 PLAYOFFS` / `SEASON 18 PLAYOFFS` + `DAY n` sit on the baked bar of `S18_Header_playoffs*.png` (924x158; at y=140 the black section is
x 199-599, gold 601-727). Text is **30px**, centred in those two sections (`#ts-season/#ts-week`, `#tw-*`, `.ws-po-phase/.ws-po-day` under
`#ws-/#wl-week-label`), nowrap with side padding (widest text 335px of 401, "DAY n" 86 of 127). Gotcha: the `mplfs::playoffs` Edit bucket
pinned these font sizes at 34px (`!important`) — they were moved to 30px in `overlay_styles.json`; a CSS-only change would not have shown. ENTVC.html's Waiting TVC `#ws-week-label` now uses the identical rules as mplfs.html (30px, phase/day spans centred in the same 401/127px sections).

### Match Board under the playoffs theme (match-dashboard.html)

Day spinner runs to **5** (regular: 3), the **Week** counter is hidden, the preview line is `D#` (no `W#`), and the goodbye label never says "next week".
The iframe re-polls `/api/theme` every 4s (it stays mounted while Settings switches theme). mplfs.html's Tomorrow's Schedule
(`computeTomorrowWeekDay`, `twTitleText`) is playoffs-aware too: tomorrow = day+1, no wrap to next week. Stored `week` is untouched.
**Matches per day (playoffs only):** Days 1-3 = 2 matches, Days 4-5 = 1. Match Board: `poMatchCount(day)` greys out the extra cards in Today's and Tomorrow's lists (Tomorrow's
looks at tomorrow's day = today+1, no wrap; Day 5 -> "Day 6" = 1), the Match picker hides Match 2 on Days 4-5 and Match 3 always, and the current match is
clamped when the day drops the count. mplfs.html: `buildTsMatches` (`poCount`) and `msToTomorrowMatchRows` (tomorrow day >= 4, or a GRAND FINALS label on match 1,
-> 1 row). Today's single-row layout is seeded as `#ts-matches.tsm-count-1` in `mplfs::playoffs` (same spot as Tomorrow's: left 131, top 521); there is NO
Edit-tab config for the 1-match layouts. `routes/overlay.js` Today's highlight cycle follows the same count (needs a server restart).
The **Waiting TVC match list** (`#ws-matches`, mplfs.html AND ENTVC.html — `poWsCount` in `updateWsFromState`) follows it too: 1 box on Days 4-5. Its playoffs
header/matches/sponsor positions are keyed to `.wsm-count-2` in `mplfs::playoffs`, so the same positions are seeded for `.wsm-count-1` (no Edit-tab config for it) — except `#ws-matches.wsm-count-1`, which is centred vertically between the header
bottom (y 218) and the SHOW STARTS IN label (y 806): top 370 (285px block, ~151px free above and below).
**Waiting TVC playoffs team logos** (`#ws-matches .wsm-logo-l/r`, mplfs.html + ENTVC.html): the white logo areas of `MatchBox_*.png` are slanted parallelograms (125px wide,
leaning ~19px across the box), so the logo slots are centred on their mid-height centre (x 165.5 left / 404.5 right: slot `left` 100 / 339, width 131) and logos are 96x96 —
bigger/straighter logos poked into the gold (ONIC did at 122x108, centred ~7px too far right). Regular / 10th Anniversary rules are unchanged.

### Team Line-Up Blue/Red + Waiting Lobby — WebP photos, and where the CPU actually goes

Team Line-Up (`luApplyPlayers`, helper `luSetPhoto`) and Waiting Lobby's photo swap use the existing full-size WebP set (`hires/<POSE>_web/<ign>_<POSE>.webp`, ~60 KB, via `hiresWebUrl()`),
falling back to the PNG if a copy is missing (`wlPhotoUrl` itself is unchanged: Team Hexagon also uses it). Measured (headless trace, playoffs theme) with the Team Line-Up showing and idle:
**photos/layers cost ~0**; the steady CPU/GPU load was two full-screen 1080p@60 VP9 videos — the shared background `playoffsbg_theme.webm` (~190 ms/s) and the lineup page's own
`SHAPES CORNER_1920x1080.webm` (~150 ms/s). **The corner-shapes overlay (`PoShapes`, Waiting Lobby / Team Line-Up / MVP Scene) was REMOVED entirely** (code + calls; the .webm is still on disk in `assets/z_playoffs background/`, unused). The per-team intro webms (9-24 MB) and the stinger only run in Phase 0. No ffmpeg on this machine, so those videos cannot be re-encoded here.

### Team Line-Up Blue/Red playoffs layout — players stand on the bottom edge

The five player boxes (`.lu-player-N`, `mplfs::playoffs` bucket) are placed with `top = 1080 - height` (230 / 230 / 180 / 230 / 230 for sizes 850 / 850 / 900 / 850 / 850): the hires photos' art reaches the bottom
of its box, so every player touches the screen's bottom edge. Name tags (`.lu-nametag-N`) were shifted by the same per-slot amount (+53 / +59 / +49 / +54 / +52) and the secondary-role tags follow them.
`playoffs_bottomfeather.png` (the white fade whose solid band covered y 1004-1080) is `display:none` in the playoffs theme. The team-logo box (`.lu-po-logobox`, bottom centre) is unchanged.
If you change a player box size in the Edit tab, keep top + height = 1080 or a gap reappears.

### Post 4 Key — playoffs taller photo container (+120px)

Playoffs only: `.p4k-photo-box` is 416x536 (was 416), cards are 416x629 (was 509), and everything under the photo moved down 120px (`.p4k-crop`/`.p4k-name-box` top 477, `.p4k-stat-box` 525, `.p4k-value-box` 524) —
seeded in the `mplfs::playoffs` bucket of `overlay_styles.json` (Regular / 10th Anniversary buckets untouched, still 509). The card art `bigfour*.png` (416x509) has no taller version, so `p4kExtendedArt` extends it on a canvas at
show time (marble above the band stretched by 120px; band 357-405 + stat panel stay pixel-exact), also for the Visa layer; `p4kApplyCard` returns a promise `fetchPost4KeyData` awaits. Deal-in and FRONT->pose animations are
unchanged (they act on the box/card, which just got bigger; the crop clip is computed in `p4kApplyCrop`). Bottom of a card is now y=1002 (the baked "LAKAS NG PINAS" text in playoffsbg_theme.webm starts at y≈1034, leaving ~32px).

### Post 4 Key — playoffs phase-2 photo (mplfs.html, `p4kApplyCard`)

Under `data-theme="playoffs"` the card's phase-2 (`.p4k-photo-sig`) image is the B&W crop `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp`
(`thBnwUrl`, TRI = the player's camp `team_simple_name` from the game feed, added to each seat in `fetchPost4KeyData`) instead of the
signature portrait; a player with no crop falls back to the signature portrait. Photo-only — deal-in, FRONT→pose crossfade/bounce and
timing are unchanged. Read at card-fill time, so a theme switch applies on the next show. The crop gets Team Hexagon's look (grayscale +
contrast, plus a team-colour corner-gradient `screen` overlay `.p4k-photo-tint`, blue/red by camp) — copies of the `.th-player-tint`
gradients, shown only while `.p4k-bnw` is set (not for the signature fallback) and faded in with `.p4k-posed`.

### Playoffs kill events — updated webms + overlay sponsors (mploverlay_v7, `overlay-killevents.js`)

`assets/ingame/playoffs/motion/*.webm` are the "updated" set (the previous ones are in `motion/old/`; `motion/updated/` is the delivery folder, same files). The updated webms have NO baked sponsor; the previous ones had Smart
(Double Kill, Turtle Slain: 177x50 at 1204,804) and Visa (Triple Kill: 136x44 at 1225,817) painted above the bar's right end from ~0.4s to ~3.0s. Playoffs now shows them via the normal sponsor element
(`KILL_EVENT_SPONSOR_LOGO`: doublekill + turtleslain = Smart, triplekill = Visa white; `killEventSponsorLogo` no longer returns null for playoffs). The `mploverlay_v7::playoffs` bucket box
`#kill-event-sponsor-logo-clip` = 1202,778 182x102 (sized so the Smart pill lands on its old 177x50 spot — the PNGs are full 1920x1080 canvases with transparent margins); `killEventApplySponsorFit` shrinks/offsets the Visa
image inside that box (inline %) so it lands on its old 136x44. The logo pops in with the player popup (300ms in, out at the playoffs pop-out time) instead of riding the video's own timing.

### Playoffs Lord / Turtle spawn videos

`overlay-objectivespawn.js` (`objSpawnPlayNext`) picks `assets/ingame/playoffs/lordspawn.webm` / `turtlespawn.webm` under `data-theme="playoffs"` (10th Anniversary keeps `assets/ingame/anniversary/`, Regular `assets/ingame/`). Same filenames, same trigger logic; read when each spawn plays, so a theme switch applies on the next spawn.

### Playoffs Team Line-Up stinger

`LU_STINGER_SRC_BY_THEME.playoffs` = `/assets/lineup/playoffs/lineupstinger.webm` (shared by Blue AND Red — one `getLuStingerSrc()`); the per-team intro webms are unchanged. Read when Phase 0 starts, so a theme switch applies on the next Show.

### Playoffs Waiting TVC — "SHARE YOUR FEEDBACK!" QR (mplfs.html + ENTVC.html)

`#ws-qr` (`assets/Waiting Screen TVC/playoffs/QR.png`, 1024x1024 incl. its quiet margin; box 962,45 162x162 = the pasted design rect) and `#ws-qr-text` (3 lines SHARE / YOUR / FEEDBACK!, General Sans 800 22px, left 1126 top 48, black) are two independent playoffs-only elements (`display:none` under other themes) mirrored in BOTH pages (Waiting TVC rule). Edit tab: "Today's Matches · Waiting TVC" config (`WS_MATCHES_*`, groups "Playoffs QR" / "Playoffs QR Text"); both pages read the same `mplfs` bucket, so one edit moves both. New selectors, so no Regular override to fight.

### Final Team logo (mplfs.html `#ft-mpl-logo`)

Playoffs uses the plain MPL logo (no sun burst): `[data-theme="playoffs"] #ft-mpl-logo { content: url('/assets/mpl2026logo.png') }` — same file the Match Board uses. The sun version
(`assets/postgame/mpl_logo.png`, still the `<img src>`) is retired for playoffs only; Regular / 10th Anniversary still show it. Playoffs box stays at its saved 270x270 (`mplfs::playoffs`).

### Post H2H page 2 — gold distribution (mplfs.html)

Post H2H has two pages now: 1 = the role stats (unchanged), 2 = gold distribution for the SAME role's
two players, in the same bar rows: MINIONS / JUNGLE CREEPS / TURTLE + LORD / TURRETS / KILLS + ASSISTS
(+ ROAM EQUIP / ROAM VISION for the roamer = 7 rows -> `#p2h-page.p2h-dense`: 80px row pitch and
`#p2h-sponsor` dropped to y=966). Data: `hero_list[].gold_map` from `/api/postinfo-proxy` matched to the two
seats by NAME (then heroid). Page switch = `GET /overlay/p2hpage/1|2` (state `p2hPage`, SSE `p2hpage`,
dashboard buttons next to the Consolidated Post 2 page buttons); every fresh show resets to page 1
(not from `?preview=1`). Title is "<ROLE> GOLD DISTRIBUTION", font-fitted by canvas measure. Rows 5/6 are
extra markup (`p2h-row-off` when unused). Server restart needed for `/overlay/p2hpage*`.

### Sponsor loops share one resume point (`html/js/sponsor-cursor.js`)

Every mplfs.html sponsor loop (Waiting TVC `runWsSponsorLoop`, Waiting Lobby `runWlSponsorLoop`, and `makeSponsorLoop` for Today's / Tomorrow's /
Bracket / Consolidated Post 2 / Post H2H / Middle Board) and ENTVC.html's Waiting TVC loop start at `SponsorCursor.start(len)` instead of #1, and
call `SponsorCursor.aired(idx)` when a sponsor goes on air — so a freshly-shown scene begins at the sponsor AFTER the last one any loop aired and
the later sponsors get airtime on short scenes. Logo + category tag come from the same list entry. A running loop still keeps its own index (two
scenes on screen at once walk the list side by side). Page-level state: resets on reload; other pages (Draft, sponsors.html...) are unaffected.
A NEW sponsor loop must use these two calls or it will restart at #1 again.

### MPL L3 Lobby strip (`mpltag.html`, checkOverlays key `l3lobby`) — notes

The four white corner-HUD lines were removed (strip only: timer, sponsor loop, 2 players + name plates, match box). It has the playoffs **SUPERFAN ticker** carried over from
Waiting TVC (`#l3l-superfan`, 899x51 at left 12 / top 788 (above the timer panel, just above the strip); same `superfanrunner.png` art, fixed "MPL PH SUPERFAN CITY" label + scrolling text from the
Dynamic tab's Superfan Ticker field via `/api/dynamic-content`, `applySuperfan()` = mplfs.html's `applyWsSuperfan`). It is z 9 — in FRONT of the player photos (behind them a head
hid the label) — and slides/fades in with the strip (`.l3l-in`). **Swap stutter fix (vMix):** the player swap used to load + decode two ~1 MB 1000x1000 PNGs (`hires/LEFT|RIGHT`) at the same instant and start fading before they were decoded, which froze the whole strip in vMix's
embedded browser (not reproducible in a normal browser). Now: overlay-only 640x640 WebP copies in `hires_l3/LEFT|RIGHT/<ign>_LEFT|RIGHT.webp` (~55 KB; falls back to the original PNG on error — **a NEW player
photo needs a `hires_l3` copy too, or it silently uses the heavy PNG**), `preloadLineup()` pre-decodes the lineup in the background, the fade-in waits for `img.decode()`, **both players now swap together** (`showPlayers` prepares both sides in one tick and fires both fade-ins in one `requestAnimationFrame` once BOTH are decoded — the old red-after-140ms stagger is gone; measured: blue and red `opacity:1` land at the identical ms), `.l3l-player` has
`contain: layout style`, photo layers `will-change: opacity, transform`. Biggest remaining steady cost = the 1920x1080 `playoffsbg_theme.webm` of which only the bottom 227px strip is visible. Edit-tab row: group "L3 Lobby Superfan" in `mpltag_l3lobby` — left/top/**width**: the fixed 899x51 `.l3l-sf-inner` is scaled to width/899 (`fitSuperfan`, ResizeObserver) and the box height follows, so the whole ticker resizes uniformly.

### Gold Graph Check header — playoffs gold title bar

`assets/ingame/playoffs/graph_header.png` = the Regular `graph_header.png` (887x60) with only its white title trapezoid recoloured to the playoffs
gold (#f3d067 -> #d0a43e vertical, original shading kept; recoloured neutral pixels x 200-690 only, so the logo squares and blue/red
tricode slants are untouched). Picked by theme in `overlay-goldgraphcheck.js` at build time (a theme switch applies on the next reload,
like every v7 panel). The title's sheen (Gold Graph + Live Win Rate, all themes) is a highlight clipped to the letters (`background-clip:text`, `*-text-sheen`),
not a band across the title box. **Live Win Rate** (`overlay-livewinrate.js`) shares the same art and picks it the same way. Regenerated with a canvas recolour script, not hand-drawn — if the Regular art changes, redo it.

### Gold Graph Check + Live Win Rate — static time checkpoints

The chart's time stamps are FIXED game minutes, no longer 5 marks stretched across however long the game has run: **2, 5, 8, 12, 15 min, then +3 each (18, 21, 24 ...)**
(`ggcMarkMinute` / `lwrMarkMinute`; `GGC_FIXED_MARKS` / `LWR_FIXED_MARKS` = 24 persistent groups, enough to ~72 min). A checkpoint is drawn only once the game has reached it
(`minute*60 <= duration`). The LAST group (`*_MARK_COUNT - 1`) is the live "now" point: dot + number only (no gridline / time box / time label), so the current value still matches the
scoreboard/HUD; a checkpoint within 46px of it yields its dot+number to it. The 0:00 mark is gone. The chart x-axis is still 0 -> now. 3-minute spacing leaves boxes (63px) touching
above ~45 min of game time.

### Live Win Rate (`html/js/overlay-livewinrate.js`, mploverlay_v7, checkOverlays key `livewinrate`)

Gold Graph Check's shell (same art/slot/glide technique, `lwr-`/`#live-winrate-*` copies of its CSS)
plotting the **Winrate API** (Settings → Winrate API, `winrate_api_url.json`, `/api/winrate-url`):
`{camp1:[%], camp2:[%], time:[s]}` every 10s of game time, camp1+camp2 = 100. Data comes through
`/api/winrate-proxy` (`routes/devapi.js`, 1s cache). One line = camp1 % around a 50% midline (blue
above / red below, symmetric y-axis); header shows both current %. Same wiring as any checkOverlays
panel: `lib/state.js`, `routes/overlay.js` (+ `bottomoverlays/hide`), `KNOWN_EVENTS` (worker v31),
`overlay-debug.js` listener, `dashboardSSE` key list, `checkToggles`, Edit config
`mploverlay_v7_livewinrate`. Not restored on page load (same as Gold Graph). Needs a server restart
for `/api/winrate-proxy`, the show/hide routes and the state key.

## Control-tab Preview — keep it fully isolated from real broadcast state

The Control tab's `#preview-iframe` lets you see a scene without
triggering it for real (OBS/vMix). Two different patterns exist,
depending on whether the overlay page is cheap enough to always keep
loaded:

- **`previewButton: true`** (per-feature, e.g. `mplfs.html`'s scenes, or
  overlay-level like `mpltag`) — the page is *already* sitting loaded in
  the iframe (selecting its sidebar row loads it, same as any other
  overlay). The "◈ Preview" button just calls
  `iw.contentWindow.previewTrigger(eventName, 'show'|'hide')` directly —
  no network round trip, no real SSE broadcast, purely local to that one
  loaded instance.
- **`deferredPreview: true`** (currently only `Draft Overlay`/
  `Draft.html`) — for a page heavy enough (lots of concurrent video
  decode/canvas work) that keeping it loaded in the iframe at all times
  would double GPU load whenever it's *also* genuinely live in vMix.
  `selectOverlay()` does **not** auto-load it — the iframe stays at
  `about:blank` (see above) with a "Preview disabled" placeholder until
  you press "◈ Preview", which loads the page fresh with `?preview=1`,
  waits for `onload`, then calls `previewTrigger(...)`; toggling off
  unloads it back to `about:blank` — GPU cost is zero unless you're
  actively looking at it. Its own real Show/Hide toggle (state-based,
  `● Showing`/`○ Hidden`) is completely decoupled from this — the iframe
  is never tied to the real broadcast state at all.

**Any overlay page loaded with `?preview=1` must actively decouple
itself from the real broadcast — reacting to real SSE the same way a
live instance would defeats the entire point.** Two failure modes we
hit, both worth checking for in any new preview-capable page:

1. **The preview instance auto-showing/hiding based on real state.**
   `Draft.html` checks `PREVIEW_ONLY = /[?&]preview=1(?:&|$)/.test(location.search)`
   and, when true, skips the real SSE listeners' show/hide calls AND the
   restore-on-load fetch entirely — visibility is driven *exclusively* by
   `window.previewTrigger(event, action)`, which every preview-capable
   page must expose (same contract mplfs.html already used: dispatch on
   `event`/`action` to the same internal show/hide functions the real SSE
   listener calls). `mplfs.html` has an equivalent existing flag,
   `isPreviewFrame` (`new URLSearchParams(location.search).get('preview') === '1'`,
   originally added for its SSE-leader-election exemption) — reuse it,
   don't add a second differently-named flag for the same check.
2. **A side effect inside the preview instance reaching the real
   server.** Any code that does more than a purely-local visual change —
   e.g. `mplfs.html`'s `syncBoard()`, which reports Matchboard/
   Middleboard/Playerboard visibility to the server so the dashboard
   stays accurate — must check `isPreviewFrame`/`PREVIEW_ONLY` and skip
   the real `fetch()` when true, or clicking Preview silently flips real
   broadcast state. This exact bug shipped: previewing any Post scene
   (Hearts/Emblem/Items/Stats/Timeline/4 Key) was firing the real
   `/overlay/matchboard/show` etc. routes, so a preview click changed
   what was actually live in vMix. If the preview still needs the
   dashboard to *see* the resulting state (e.g. to light up a related
   toggle), use `window.parent.postMessage({...}, window.location.origin)`
   instead of hitting the network — see `previewToggleRegistry` below for
   the receiving side.

**`previewTrigger`'s dispatch table must be kept in sync by hand — it's
just a chain of `if (event === '...')` calls, nothing enforces
completeness.** When adding a new feature that should be previewable,
add its branch here too, or Preview silently does nothing for it (no
error). This has shipped incomplete twice: Credit Reel, Post Stats,
Consolidated Post, and Consolidated Post 2 were all missing from
`mplfs.html`'s `previewTrigger` despite being fully wired for real
Show/Hide. **The external event name (derived from the route,
`feat.show.split('/')[2]`) often does NOT match the page's own internal
`activeFeature`/`transitionTo()` name** — e.g. the route is
`post_stats` but the internal name is `stats`; `final_team` vs
`finalteam`; `team_lineup_blue` vs `lineupblue`. Guessing gets this
wrong silently. The authoritative mapping is the page's own real SSE
listener (`sseSource.addEventListener('post_stats', ...)`) — always
check what event name and internal function *that* uses before adding a
`previewTrigger` branch, don't infer it from the dashboard route or the
internal name alone.

**Only one "◈ Preview" can be meaningfully active at a time — they all
drive the same iframe.** `dashboard.html`'s `buildPreviewToggleBtn(eventName)`
is the shared factory every trigger-only preview button goes through
(don't hand-roll another copy); `activePreviewOff` holds whichever
button's own "turn myself off" closure is currently active, and
activating a new one calls the previous one's `turnOff()` first — both
its button state and a real `previewTrigger(..., 'hide')` into the
iframe. Before this existed, each button tracked its own on/off state
independently, so previewing scene B while scene A's preview was still
"on" left A's button stuck active forever even though the iframe had
already moved on.

Separately, **`previewToggleRegistry`** exists for *passive* reflection —
a board getting shown as a side effect of another feature's own preview
(e.g. Post Hearts implicitly showing Matchboard/Middleboard/Playerboard,
reported to the dashboard via the `postMessage` in point 2 above) should
light up that board's own Preview button too, but must NOT go through
`activePreviewOff`'s exclusivity logic — an implied activation isn't a
"preview just this instead" request, and shouldn't turn off the scene
that's actually driving it. `buildPreviewToggleBtn` registers a passive
setter per `eventName`; the dashboard's `message` listener looks it up
and calls it directly.

Both `activePreviewOff` and `previewToggleRegistry` (and
`draftPreviewActive`, `mplfsLiveBadge`, `mapSelectTagBadge` — anything
holding a reference into the just-replaced `#control-panel-body`) get
reset to `null`/`{}` at the top of `buildControlBody()`, since
`body.innerHTML = ''` just destroyed whatever DOM they pointed at.
Forgetting this reset for a *new* piece of cross-render state is a silent
bug: the stale closure still runs, harmlessly touching a detached
element, but can also misfire a real network call using outdated context.

## API Mode — LIVE / WEB / DEBUG url sets (`lib/apiMode.js`)

The Settings page's 9 per-API URL fields (Game, Standings, Draft, Draft
Recap, HRM, Team Hexagon, MVP Highlights, Draft Index, Post-Info) each
store **three** independent values — `live`, `web`, `debug` — instead of
one flat URL, switched by a single global mode flag
(`api_mode.json`, `lib/apiMode.js`'s `getApiMode()`/`setApiMode()`).
Editing a field's Apply button always writes to whichever mode is
*currently active*; flipping modes (Settings page's 3-way segmented
control) is treated as dangerous on purpose — it changes every one of
those 9 endpoints server-wide, not just for the current dashboard tab —
and requires an explicit confirm dialog before it takes effect.

**Every one of the 9 backing JSON files (`game_api_url.json`,
`draft_api_url.json`, etc.) is read directly by MORE than just
`routes/devapi.js`.** `lib/pollers.js` (game/standings/post-info
pollers) and `lib/hrmPoller.js` (HRM poller) read these same files on
their own, independent of the GET routes. All reads/writes MUST go
through `lib/apiMode.js`'s `readUrlForMode(file, default)` /
`writeUrlForMode(file, url)` — never `fs.readFileSync` the raw file
directly and reach into `.url`, since the file's shape is
`{ live, web, debug }`, not a flat `{ url }`. If you add a NEW poller or
route that reads one of these files, use these helpers or it'll read the
wrong mode (or nothing) the moment someone flips the switch.

If you add a 4th mode (or rename one), update the `API_MODES` array in
`lib/apiMode.js` **and** the hardcoded `API_MODES` array + the 3
`.api-mode-seg-btn[data-mode="..."]` buttons in `dashboard.html` — these
are two independent, unenforced copies of the same list, matching the
existing `MPLFS_ACTIVE_FEATURE_MAP` precedent of "this codebase manually
mirrors small config tables between server and client rather than
sharing them."

## Theme system — Regular / 10th Anniversary / Playoffs

The Settings page has a **Broadcast Theme** picker — a plain `<select>`
(`#theme-select`, same visual shape as `#edit-config-select` elsewhere on
this page), not a segmented switch like API Mode: a 3-way segmented
control doesn't fit this row once a label is as long as "10TH
ANNIVERSARY" (it overflows its container rather than wrapping — this
shipped once and had to be replaced). Changing it shows a
`window.confirm()` first ("Switch the broadcast theme to X? This applies
live to every open overlay page...") since it's still a live,
broadcast-wide change even though — unlike API Mode — it doesn't repoint
any data source; canceling reverts the `<select>` to `currentTheme`
without sending anything. It's one global value —
`regular` / `10th_anniversary` / `playoffs` — stored in `theme.json`
(`{ "theme": "regular" }`) and read/written through `GET`/`POST
/api/theme` in `routes/devapi.js`, the exact same shape as
`heatmap_config`/`h2h_config` just above it in that file: GET returns the
file (or the default if missing/corrupt), POST validates against a
whitelist and re-broadcasts.

**How it reaches every overlay page.** `POST /api/theme` writes
`theme.json` then fans the new value out over the *existing* shared SSE
connection (`state.overlayClients`, the same `/overlay/events` stream
every other live feature uses — no new SSE endpoint):
```js
state.overlayClients.forEach(c => {
  try { c.write('event: theme\ndata: ' + JSON.stringify(cfg) + '\n\n'); } catch {}
});
```
`'theme'` is registered in `KNOWN_EVENTS` in
`html/js/overlay-shared-worker.js` (with `OVERLAY_WORKER_VERSION` bumped
alongside it, per the Dashboard architecture section above — skip this
and any tab/browser-source open since before the change never learns the
new theme). Every overlay page that already holds a live
`createOverlaySSE()` connection (`mplfs.html`, `ENTVC.html`,
`mpltag.html`, `Draft.html`, `DraftIndex.html`, `mploverlay_v7.html` via
`overlay-debug.js`, `fights.html`) has one extra line right next to its
existing listeners:
```js
sse.addEventListener('theme', (e) => applyTheme(JSON.parse(e.data).theme));
```
so a theme switch mid-broadcast applies instantly to every open
instance, not just on next reload.

**`html/js/theme-apply.js`** is the shared client-side piece, included on
EVERY broadcast-source HTML page right after `cache-bust.js` (before
`overlay-sse-shim.js` where both are present) — including pages that
have no live SSE connection at all (`dynamic.html`, `gold-graph.html`,
`ingame_blue.html`, `ingame_camv1.html`, `ingame_red.html`,
`overlays.html`, `postgame.html`, `sponsors.html`, `sponsortv.html`):
those pick up a changed theme on their next reload/refresh only, since
there's nothing pushing to them live. It does two things:
1. On load, reads `/api/theme` and applies the result as
   `data-theme="..."` on `<html>` via `applyTheme(theme)` — this is what
   any future per-theme CSS (or a JS `wsTvcAsset()`-style lookup) actually
   reads.
2. Exposes `applyTheme()`/`THEME_VALUES` globally so each page's own SSE
   listener (above) can call it, instead of duplicating the theme list
   and validation in 16 separate files.

**This initial read is a deliberately SYNCHRONOUS `XMLHttpRequest`, not
`fetch()`.** `theme-apply.js` is loaded first, but an async `fetch()`
only resolves after the browser has already moved on to running every
OTHER script on the page — and several of those build scene content
immediately at top-level script execution, not gated behind any later
event (e.g. `mplfs.html`'s `buildWsSponsor();`, called unconditionally
right after its own definition). Such code reads
`document.documentElement`'s `data-theme` attribute assuming it's
already correct; with an async fetch it usually isn't yet, so
`wsTvcAsset()`-style lookups silently and consistently fall back to
Regular's asset, every single page load, with no error and nothing
that looks broken in the code itself. **This exact bug shipped**:
Waiting TVC's sponsor box kept loading the Regular `Sponsor Box.png`
under 10th Anniversary even though the theme value, `wsTvcAsset()`'s
logic, and the anniversary asset itself were all independently
correct — the read just happened a few milliseconds too early, every
time, which is what made it look like "the code must be wrong
somewhere" rather than a load-order problem. A synchronous XHR blocks
this script — and by extension all HTML parsing/script execution after
it — until the theme is known, at the one-time cost of a few ms per
page load; in exchange, every line of every other script on the page
can read `data-theme` unconditionally, with no ordering requirement
placed on whoever writes that code. **When adding new code that reads
the theme at page-load time (not from inside an SSE listener/event
callback), you don't need to do anything special — this is exactly
the case the synchronous read exists to make safe.** If a similar
"theme looks right but the wrong asset loads" bug ever resurfaces,
suspect a NEW async gap before the theme is known (e.g. a future
`theme-apply.js` rewrite that goes back to `fetch()`), not the
lookup logic itself.

**Adding a 4th theme (or renaming one)** means updating, by hand, the
same "independent unenforced copies of one list" pattern as API Mode:
`THEME_VALID` in `routes/devapi.js`, `THEME_VALUES` in
`html/js/theme-apply.js`, and in `dashboard.html`: `THEME_VALUES`,
`THEME_LABELS` (the confirm dialog's human-readable name), and a new
`<option>` in `#theme-select`.

**The whole point of this architecture is that a theme changes NOTHING
by default.** Every theme currently renders identically — this wiring
only decides *which one is active* and gets that value onto every page
as `data-theme`. To actually give 10th Anniversary (or Playoffs) its own
look for a specific element, add an opt-in CSS override scoped to that
theme and that selector, in the same file the element already lives in:
```css
[data-theme="10th_anniversary"] #foo-title { font-family: 'SomeAnniversaryFont'; }
[data-theme="10th_anniversary"] #foo-page { background-image: url('/assets/10th_anniv_bg.png'); }
```
This works cleanly when Regular has **no** competing rule for that
property on that selector (a brand-new element/property nobody styled
before). **When Regular already sets the SAME property on the SAME (or
a less-specific) selector — which is true for almost every color, since
most elements already have a Regular-theme color — prefer a CSS custom
property instead of a second competing rule:**
```css
[data-theme="10th_anniversary"] { --anniv-accent: #6c4614; }
/* the element's own ONE real rule, unconditional: */
.foo-label { color: var(--anniv-accent, #0a0a0a); }
```
A second `[data-theme="10th_anniversary"] .foo-label { color: ... }`
rule has to out-specificity Regular's existing rule for the browser to
actually pick it — easy to get subtly wrong (a compound/ID selector
elsewhere, an `!important` from a dashboard Edit-tab override, source
order) and, when it goes wrong, silently: no error, the element just
keeps rendering in Regular's color under every theme, which reads
exactly like "the theme CSS isn't taking" and can cost real time to
diagnose. The variable pattern has no specificity question to get
wrong at all — there is only ever one real rule for that property, its
*value* is what changes, and `var()`'s second argument supplies each
element's own correct Regular-theme fallback for free. Define the
variable once, near the top of the file (see `--anniv-accent`), and
reuse it for every element that should pick up the same brand color;
add a differently-named variable only for a genuinely different themed
value (e.g. `#ws-week-label`'s blue is its own literal, unrelated to
the brand accent, and correctly stays a plain hardcoded value in its
own already-`[data-theme]`-scoped rule since nothing else needs it).
**Never write a rule as "everything except regular" (e.g.
`:not([data-theme="regular"])`) or gate on absence of an attribute** —
always scope to the specific theme(s) the change is actually for. Adding
a 4th theme later must not silently inherit a change that was only ever
meant for 10th Anniversary. An element with no theme-specific rule at
all simply keeps its normal (Regular) styling under every theme, which
is the correct default — most elements should never need a themed
override, per the user's explicit "themes don't change everything unless
we say so."

**Themes are purely cosmetic — a reskin, not a feature.** A theme
changes what something *looks like* (background asset, color, font,
image) — never what it *does*, when it fires, its layout/positioning, or
any other behavior. The one exception is when the user explicitly calls
out a behavioral difference for a theme (e.g. "10th Anniversary's reveal
animation is 200ms slower") — that's a real, deliberate exception stated
up front, not something to infer or add speculatively. Any other
architecture/structural work on this codebase (a new feature, a bugfix, a
wiring change, a refactor) applies to **every** theme uniformly and
should never be written as if it only applies to one — the theme system
sits underneath everything else, not the other way around. If you're
tempted to branch behavior on `data-theme` for something that isn't a
skin (timing, data, layout, which elements exist), stop and confirm with
the user first; that's almost certainly a misread of the request.

**JS-driven cosmetic properties (not expressible in CSS) follow the same
opt-in-per-theme shape as the CSS convention above.** A `<video>`'s `src`
picked by JS (`showSceneVideo`/`SCENE_VIDEO_SRC` — see "Video-heavy
overlays" below) can't be reskinned with a CSS override, so it gets a
small lookup table + getter instead, keyed by theme first (matching the
CSS convention's `[data-theme="..."] ...` grouping), falling back to the
plain Regular-theme value when a theme has no override:
```js
const SCENE_VIDEO_SRC_BY_THEME = {
  '10th_anniversary': { waiting: '/assets/annivloopsun.webm', lobby: '/assets/annivloopsun.webm' },
};
function getSceneVideoSrc(feature) {
  const theme = document.documentElement.getAttribute('data-theme') || 'regular';
  return (SCENE_VIDEO_SRC_BY_THEME[theme] && SCENE_VIDEO_SRC_BY_THEME[theme][feature]) || SCENE_VIDEO_SRC[feature];
}
```
Same rules as the CSS convention apply: only list the specific
theme/feature pairs that actually differ, never write it as "everything
except regular", and a feature missing from every theme's table simply
keeps `SCENE_VIDEO_SRC`'s plain value under every theme. **This is
decided once, at the moment a scene's background starts (`showSceneVideo`
is called on Show/transition)** — switching themes while that scene is
already on screen does not swap the running video live; the new theme's
asset applies the next time the scene is (re)shown. Revisit this only if
the user asks for live-swap-mid-scene behavior specifically.

### Playoffs theme — the UNIVERSAL sponsor box (mplfs.html)

Every sponsor box in `mplfs.html` under the **playoffs** theme shares ONE
layout: a gold header strip showing the live sponsor category (OFFICIAL
SPONSOR…) over a white logo area. It lives in a single CSS block,
"PLAYOFFS UNIVERSAL SPONSOR BOX" (next to `.sponsor-cat-label` in
`mplfs.html`), written against the **shared classes**
(`.sponsor-cat-label`, `.wl-sponsor-loop`/`.ws-sponsor-loop`,
`.wl-sponsor-bg`/`.wsm-sponsor-bg`) — never a per-scene id. Waiting TVC,
Waiting Lobby, Today's Schedule, the Bracket (`#br-sponsor`, placed on `#bracket-page` outside the tilting `#bracket-container`) and ENTVC.html's Waiting TVC (its own mirrored copy of the block) use it today; Tomorrow's Schedule, Post
H2H, Consolidated Post 2 and Middle Board inherit the look automatically
(they just haven't had their playoffs position/size reworked yet — Post
H2H's 60px-tall box in particular will look cramped until it is).

Consolidated Post 2's `#cp2-sponsor` used to be a side-by-side exception; it now uses the header-strip layout too (311×120 under the Kill Map), but is excluded from the shared logo Edit row.

**When you add or rework any mplfs.html scene for playoffs that has a
sponsor box, use this universal box — do not restyle a sponsor box for
that one scene.** Build it with the standard markup (`.sponsor-cat-label`
+ `.wl-sponsor-loop`, same as `buildTsSponsor`) and the universal CSS
styles it for free; the only per-scene work is position/size (default
338×120 — add the scene's sponsor selector to the "Default box size" rule
in that block, and seed its position in the `mplfs::playoffs` bucket of
`overlay_styles.json`, since Regular's saved sponsor override would
otherwise win as an `!important` fallback). Also make sure its Edit config
gets the universal rows (below).

**Current shape:** fully CSS (no strip image): 296×120 box, 37px gold
strip, logo area below it 296×83. Default box size rule + per-scene lefts
in mplfs.html; Post H2H / Middle Board / Consolidated Post 2 sizes are
`!important` (their saved Regular-shaped Edit sizes would otherwise win).
Consolidated Post 2 is 311 wide, edge-aligned to its Kill Map.

**Editing it:** every Edit config that contains a sponsor box has one extra
row, group "Playoffs Sponsor" — **Sponsor Logo (all playoffs boxes)**
(left/top/width/height of the sliding logo inside the logo area), added by
`addPlayoffsSponsorEdit()` in `dashboard.html`. It edits the shared loop
classes, so changing it from ANY scene's Edit tab changes every playoffs
sponsor box at once (ENTVC.html too, same `mplfs` bucket) — except
Consolidated Post 2's (`:not(#cp2-sponsor-img)`, different width). The
selector is `html[data-theme=playoffs]`-scoped (unquoted attribute value
on purpose, so the selector survives being used as an element id), so a
save can never leak into another theme. Only the first matching img is
click-draggable in the preview; use the sidebar row / inputs / arrows. A
new scene's Edit config must be added to the pairs list passed to
`addPlayoffsSponsorEdit` in the `forEach` right above `var EDIT_CONFIGS`.
Each box's own position/size stays its normal per-scene "Sponsor Box" row.
The strip height/font size have no Edit row (CSS only).

### Playoffs theme — working notes (read before touching any playoffs scene)

**Playoffs is allowed to be a full re-layout, per scene.** The "themes are purely
cosmetic" rule above has a deliberate, user-stated exception here: the user
supplies a reference image + an asset folder (`assets/<scene>/playoffs/`, or
`photos/...`) and asks for a complete overhaul of that one scene under
`data-theme="playoffs"` (new layout, forced match counts, new text fields…).
Do it, scoped to `[data-theme="playoffs"]`; Regular and 10th Anniversary must
stay exactly as they were. Behavior the user spells out (e.g. "playoffs always
shows exactly 2 matches", "Tomorrow's shows 1 match when match 1 is GRAND
FINALS") is intentional, not a bug.

**Conventions that kept working**
- Assets live in a `playoffs/` sub-folder with the **same filenames** as Regular.
  Swap them with `content: url('/assets/<scene>/playoffs/x.png')` on a static
  `<img>`, a `background-image` rule, or (JS-built art) a theme-picked directory
  (see `gdcAssetDir` in `overlay-golddiffcheck.js`, `icAssetDir` in
  `overlay-itemcheck.js`, `mbAsset()` in `mplfs.html`). Check the new file's
  pixel size against the old one first — usually identical, so no layout change.
- **Gold** = `#edc555` → `#d0a43e` (vertical gradient). Black text on gold/white
  plates, white text on blue/red plates; remove any dark glow when text turns
  black.
- **Seed positions in the playoffs Edit bucket.** Regular's saved Edit-tab
  overrides (`overlay_styles.json`, `!important`) are the per-selector fallback
  for playoffs, so a playoffs `left/top/width/height` in plain CSS silently
  loses. Seed `"<file>::playoffs"` (`mplfs::playoffs`, `Draft::playoffs`, …).
  Symptom of forgetting: the CSS rule is correct but computed style shows the
  Regular value (this cost a round trip on Draft's map icon/name).
- Wiring a new playoffs asset into JS-built panels (v7 check panels, mpltag
  Map Selection, Draft ban slots) reads `data-theme` **once at build time** —
  a theme switch applies on the next reload there (same as Gold Diff Check).
- Universal sponsor box: see the section above. `sponsors.html`'s left box still
  uses the side-by-side layout; its playoffs-only 3rd box (`.po-sponsor`, own
  loop, `?sponsorspage=1` so Joytify is filtered) is the header-strip one, own
  CSS copy (sponsors.html has no Edit config).

**Open / not provided yet (don't invent art)** — star-match scoreboard art
(`ingamepng2_<SUFFIX>.png` in `assets/ingame/playoffs/`), the Side Selection
card (`blueselect/redselect.png`) in mpltag, `mapdetail_v2.png` for Draft's
expanded map panel, Draft's player plate backs / hero name banners / picking
webms (Regular art still), playoffs Post H2H sponsor rework, ban-selection red
glow and `bluepickbg1/redpickbg1.webm` in Draft (still blue/red), real playoffs
team photos for `photos/Playoffs Sched/` (APBR, TWIS missing → placeholder).

**Server restart also pending for `skypiercer` + `lordadv`:** `routes/overlay.js`
(`VALID_FEATURES`) and `lib/state.js` (`featureToggles`) — without it the dashboard
arm/disarm toggles for Sky Piercer Stacks and Lord Advantage don't work (overlay + debug
buttons do). Ask the user first, it's their terminal.

**Server restart still pending?** Two route edits only take effect after a
restart, which needs the user's explicit OK: `routes/overlay.js` (schedule
highlight cycle uses 2 matches under playoffs) and `routes/devapi.js`
(`superfan_text` default + POST whitelist for the Dynamic-tab Superfan ticker).
Ask whether they have restarted before assuming either works.

**Scenes already reworked for playoffs (mplfs.html unless noted)** — MVP Scene,
MVP Highlights, Team Hexagon, Today's / Tomorrow's Schedule (forced 2 rows,
stage label + open-house fields on the Match Board, per-team photos
`photos/Playoffs Sched/<TRI>_sched.png`, animated `GOLD BG W HOLDER` webm that
plays only while shown), Waiting TVC (+ ENTVC mirror; corner HUD removed — it is
baked into the looping webm now; SUPERFAN ticker driven by the Dynamic tab's own
"Superfan Ticker" panel) and Waiting Lobby (mplfs only; player bottom feather),
Team Line-Up Blue/Red (feather PNG, per-team `photos/groupbg_playoffs/` wordmarks),
Bracket (background swaps to `playoffsbg_theme.webm` + sponsor fades while off its
base pose), Final Team, Consolidated Post 2 (pages 1-3, gold stat tracks, page-3
seam fix), Post Match Board VICTORY plaques; `mploverlay_v7` scoreboard /
match-info (stage label from Match Board) / map box (`assets/ingame/playoffs/mapbacker.png`, gold logo square + white name bar) / gold-diff / item / emblem / side-stat
checks / player UI / event-pickup backgrounds; `Draft.html` (background, triangles,
ban icon that fades out when a hero is banned, gold timer + pick glow, gradient-map
Draft Stats, `#121212` role icons, map container); `DraftIndex.html`;
`sponsors.html`, `sponsortv.html`, `ingame_blue/red.html`, `mpltag.html` Map Selection.

**Things that bit us (check these first when something looks wrong)**
- **Removing a CSS block with a script can leave orphan declarations.** A python
  edit that deleted the selector line of the old HUD rules left its body behind;
  the browser dropped the *next* rule (the SUPERFAN ticker's `position:absolute`)
  and the ticker jumped to top-left. After any bulk CSS/markup removal, render
  the scene and diff the neighbours — don't trust the syntax check (it only
  parses JS).
- **Apostrophes in asset paths** (`/assets/Today's Schedule/...`) break a path
  placed inside an inline `onerror="...'...'"` attribute → write `%27`.
- **Re-assigning an `<img src>` to a file that doesn't exist every poll** makes
  it flicker (blank 404 → fallback → repeat every 3s). `sbSetImgWithFallback`
  in `overlay-scoreboard.js` now remembers applied/missing URLs; any new
  "try star art, fall back to plain art" code must do the same.
- **cache-bust.js appends `?v=` to every image src**, so never compare
  `img.src` to a literal; use a flag/dataset (see `mvSetImgWithFallback`,
  `hero-web.js`).
- **`transform` on a clipped parent doesn't change layout** — for scaled
  groups (`#stv-matches`, mpltag Map Selection at 6-7 games) set the layout box
  at native size and scale around a fixed origin.
- **mpltag Map Selection scales down for games 6-7** (`applyMapselScale`,
  origin 29px/1028px, 0.84 at 6, 0.72 at 7) because blocks sit side by side.
- **Stat overlay "gradient map" in Draft Stats** is `backdrop-filter:
  url(#po-gradmap)` (SVG feColorMatrix + feComponentTransfer). Works in Chromium
  / Edge; if vMix's browser source ever fails to show it, fall back to a
  `grayscale() sepia()` filter chain.
- **Waiting Lobby edits stay mplfs-only**; Waiting TVC edits must be mirrored in
  `ENTVC.html` (existing rule above) — hand-port, don't assume it shares CSS.

**Hero art for the overlays**: `hero_web/HERO_<id>_KOTAK.webp` (512px, ~25KB)
replaces the 1000px `hero/` PNGs in `mplfs.html` and `mploverlay_v7` via
`html/js/hero-web.js` (`heroWebUrl(id)` + a capture-phase `error` listener that
falls back to the PNG when a WebP is missing). **`Draft.html` deliberately keeps
`hero/thumb/` (200px PNG)** for the whole page — fewer decoded pixels during the
busy draft. Regenerate `hero/thumb` whenever a new hero is added or Draft falls
back to the full 1000px PNG for it. Other pages (`mploverlay_v5/v6`, `fights.html`,
`mpltag.html`, `arrangement-dashboard.html`) still use the PNGs.

**`html/DraftIndexV2.html`** — copy of Draft Index with player strips + hero
reveal. It listens to the **same** `draftindex` SSE event / `/overlay/draftindex-state`
as `DraftIndex.html` (so the Draft Index Show/Hide drives whichever page is
loaded; the dashboard's "Draft Index v2" entry has the same two routes). Its
saved Edit-tab styles still come from the `DraftIndex` bucket. Strips are
role-icon + name cells (EXP, JUNGLE, MID, ROAM, GOLD = seat_1..5), heroes are
`posthero/<heroid>_POST_HERO.png` (226×130, shown at their natural 326×188, the
rest of each card is a blurred copy so no gap shows over the camera feed), reveal
2s after show, hold 4s, then the "windows close". `DV2_SHOW_CHROME` (top of its
script) is **false** for now: the webm band and the blue/red container art are
transparent; set it true to bring them back (then the webm plays only while shown).
Heroes/strip contents never wait on phase 2's data.
**Hero cards are compositor-only (vMix stutter fix):** each card's art (blur fill + edge-faded hero + team
shade) is painted ONCE into a `<canvas>` (`dv2PaintCard`); the open/close "window" is a skewed
`overflow:hidden` box animated by `scaleX` with a counter-transformed inner box (`dv2WindowFrames`,
pre-sampled keyframes), and the entrance flash is a white overlay's opacity. Don't reintroduce animated
`clip-path`/`filter`, live CSS `blur()` or `mask-image` on the cards — that combination repainted all 10
cards every frame and hitched when the sheen layers kicked in.

### The dashboard's Edit tab is theme-scoped — a drag/resize under one theme never affects another

`overlay_styles.json` (`routes/overlayStyles.js`, `GET`/`POST
/api/overlay-styles`, `POST /api/overlay-nudge`) stores every
selector's Edit-tab position/size override — this predates the theme
system and originally had no concept of themes at all: one flat
`{ [file]: { [selector]: {left,top,width,height,fontSize} } } ` store,
applied unconditionally regardless of anything else. That caused a real,
confusing bug once themes existed: `#waiting-screen-page.wsm-count-2
#ws-header` had a Regular-theme position saved from before 10th
Anniversary existed, and because Edit-tab overrides are injected as
`<style>` rules with `!important` (see `mplfs.html`'s
`fetch('/api/overlay-styles?file=mplfs')` handler), that old saved
position kept winning over the new `[data-theme="10th_anniversary"]
#ws-header { ... }` CSS rule — higher specificity AND `!important` beats
a plain theme-scoped rule with neither, so the header LOOKED like the
theme CSS "wasn't taking" no matter how correct it was.

**The fix — theme-scoped storage, transparent to every existing
caller.** `lib/theme.js` exports `getTheme()` (shared with
`routes/devapi.js`'s `/api/theme`, so both agree on "the current
theme"). Every read/write in `routes/overlayStyles.js` now goes through
a themed bucket key: `theme === 'regular'` keeps using the plain `file`
bucket exactly as before (full backward compatibility — nothing changes
for Regular), while any other theme reads/writes `` `${file}::${theme}` ``
(e.g. `mplfs::10th_anniversary`) instead. `GET /api/overlay-styles`
merges the two **per selector** — a selector customized under the
active theme wins outright (its whole box, not a property blend, since
Edit-tab saves always write a selector's complete box together); a
selector nobody has touched yet under this theme falls back to
Regular's value, so untouched elements don't just disappear. Nudges
(`/api/overlay-nudge`) seed a brand-new themed entry from Regular's
current value first, since a nudge is a relative `+Npx` adjustment, not
an absolute position — starting from `{}` would nudge from `0,0`.

**No client-side changes were needed for this** — `mplfs.html` (and
every other overlay page) already just does
`fetch('/api/overlay-styles?file=X')` and injects whatever comes back
as `!important` CSS; the merge happens entirely server-side, so the
client keeps working unmodified regardless of which theme is active.

**Practical effect: dragging/resizing an element in the Edit tab while
10th Anniversary is the active theme (Settings page picker) only ever
affects 10th Anniversary — Regular's saved position for that same
selector is untouched, and vice versa.** This is exactly the
"themes are cosmetic, opt-in per theme" principle applied to the Edit
tab specifically, per the user's explicit instruction. **When
diagnosing "my theme CSS isn't taking"-type bugs, always check
`overlay_styles.json` for a stale override on that selector before
assuming the CSS itself is wrong** — an Edit-tab override, once saved,
beats a plain `[data-theme="..."]` rule every time, theme-scoped or not.

### Never size/fit content by measuring a possibly-hidden element — use Canvas `measureText()` instead

`mplfs.html`'s Waiting TVC Hosts/Casters name row (`populateWsTalentBox`
→ `buildAnnivNameBox`, 10th Anniversary only) needs to fit a variable
number of variable-length names + separator stars into a fixed box
(`.ws-talent-namebox`, 530×56, positioned inside the 571×61 namebar)
without ever overflowing it — auto-shrinking the whole row (text and
stars together, one `transform: scale()`) only as much as needed.

**The first implementation measured this the "normal" way —
`element.scrollWidth` vs. `element.clientWidth` after rendering at full
size — and shipped a real, confusing bug.** `populateWsTalentBox` runs
from `updateWsFromState()`, an SSE match-state handler that can fire
**before** `showWaitingScreen()` ever shows the scene — the box sits
inside a `display:none` ancestor at that point. `scrollWidth`/
`clientWidth` on a hidden element give meaningless numbers (typically
0/0, or otherwise not reflecting real layout), so the shrink-to-fit
check (`scrollWidth > clientWidth`) silently evaluates false — no
error, nothing that looks broken in the code — and locks in the
unshrunk, full-size row. The overflow only becomes visible once the
scene is *later* shown, by which point the measurement has already run
and won't re-run again until the roster list changes. This reads as a
flaky, hard-to-reproduce bug ("it overflows sometimes") when it's
actually fully deterministic — it depends on whether match-state
happened to update before or after the scene's first Show, not on
anything random.

**The fix: measure with a `<canvas>` 2D context's `measureText()`
instead of any DOM layout property.**
```js
let _annivMeasureCtx = null;
function annivTextWidth(text, font) {
  if (!_annivMeasureCtx) _annivMeasureCtx = document.createElement('canvas').getContext('2d');
  _annivMeasureCtx.font = font;
  return _annivMeasureCtx.measureText(text).width;
}
```
A detached `<canvas>` (never inserted into the document) has no
layout/visibility state to depend on — `measureText()` gives the exact
same answer whether the real scene is shown, hidden, or not yet built
at all. Compute the natural (unscaled) total width from measured text
+ known star/gap widths, compare to the fixed box width, and apply
`Math.min(1, boxWidth / naturalWidth)` as a single `transform: scale()`
on a wrapper — this scales text and stars together (so they never look
mismatched) and mathematically cannot overflow, since the scale factor
is derived directly from the real content width, not inferred from a
live layout that might not exist yet.

**This is the same underlying bug class as the theme-apply.js race
above and the Edit-tab live-sync gap** — something computed before the
thing it depends on (a visible layout / a resolved theme / a broadcasted
change) was actually ready. When building anything that sizes/positions
itself based on *measuring* other content, check whether that
measurement could ever run while hidden or not-yet-shown, and prefer a
measurement technique with no visibility dependency (Canvas
`measureText()` for text; for other cases, consider whether the
calculation can be done from known/config values instead of a live DOM
read at all) over `scrollWidth`/`clientWidth`/`getBoundingClientRect()`,
which are only meaningful once the element has real layout.

### "Copy/use the exact same X" means copy EVERY themed treatment tied to X, not just its most visible asset

When the user says something like "replace the sponsor box with the exact
same sponsor box used in Waiting Lobby/TVC (same everything)", that means
literally everything about how that element already looks under the
active theme — not just its background image. This bit the sponsor-box
category label once: Waiting TVC/Lobby's `#ws-sponsor-cat`/`#wl-sponsor-cat`
already had their own anniversary-only rule removing the label's solid
white plate and recoloring its text (`background-color: transparent` +
`color: var(--anniv-accent, ...)`, scoped per-ID, not on the shared
`.sponsor-cat-label` class every sponsor box uses) — copying only the box
art (`Sponsor Box.png`) in the first pass left Today's/Tomorrow's Schedule
still showing the old white label plate, requiring a second round trip to
notice and fix.

**Before considering a "copy X exactly" task done, grep for every existing
themed rule scoped to X's specific id/class family** (not just the base
selector) — a themed reskin is frequently split across several separate
per-ID overrides (asset src, a background removal, a recolor, a
reposition) rather than living in one place, precisely because the
shared class must stay Regular-look for elements that were *not* asked to
match yet (see `.sponsor-cat-label`'s own comment, which spells out
exactly which per-ID overrides exist and why). Copying the obvious/largest
piece (the background image) and missing the smaller companion rule is
the default failure mode — check for it explicitly every time, don't wait
for the user to notice and correct it.

## Video-heavy overlays — permanently-decoding media is a real, sustained cost

Full-resolution (1920×1080) 60fps VP9 loops that `autoplay`+`loop` and
are never explicitly paused are a genuine, sustained GPU/CPU cost for
as long as the page is open — not a one-time thing. This bit
`mplfs.html` twice:

1. **`#bg-video`** (`bgloop.webm`, the idle-state fallback background)
   had `autoplay` in its HTML tag and was never referenced again anywhere
   in the file — it played, full resolution, 100% of the broadcast's
   runtime, including whenever the overlay was doing nothing at all.
   Fixed by removing `autoplay` entirely; it now sits paused on its
   first decoded frame forever (a `<video>` without `autoplay` still
   renders its first frame once loaded, so this isn't a blank
   rectangle) — a deliberate call that idle doesn't need motion.
2. **`#scene-video-0`/`#scene-video-1`** (the two crossfading
   per-scene backgrounds — `bgloopsun2.webm`, `bgloopwaves2.webm`, etc.,
   picked per feature via `SCENE_VIDEO_SRC`) were only ever *faded to
   opacity 0* on hide (`hideSceneVideo()`), never `.pause()`d — so once
   any scene had been shown once during a broadcast, that layer kept
   decoding invisibly for the rest of the show. Fixed: `.pause()`
   ~400ms after removing the `sv-visible` class (matching its own CSS
   fade-out duration, same setTimeout-after-transition idiom as
   `hideDraftScene()` elsewhere), and `.play()` again whenever
   re-shown. The 400ms defer specifically avoids freezing the fade
   mid-transition; it's guarded against a fast re-show by checking the
   captured element's own class, not the shared `sceneVideoVisible` flag
   (which can belong to a different layer by the time the timeout fires).

**When centralizing "start this shared resource" logic across many
call sites, ordering relative to the OLD resource's own teardown
matters more than it looks.** `showSceneVideo(feature)` was moved into
`transitionToImpl()` so a scene's background starts the instant the
transition is requested, not after that scene's own data-fetch +
`preloadMedia()` (which can take 1.5s+). Putting the call at the *top*
of `transitionToImpl` looked right but broke every scene switch: the
outgoing scene's own hide function calls `hideSceneVideo()` on its own
deferred `setTimeout` (matching ITS fade-out), which reads the shared
`sceneVideoLayer`/`currentSceneVideoSrc` pointers — if the NEW scene's
`showSceneVideo()` already ran and swung those pointers to the new
layer, the outgoing scene's *delayed* hide ends up hiding the layer
that was just started. Fix: call the centralized `showSceneVideo()`
**after** `hideActiveFeature()` has been fully awaited, not before —
this still starts well before any data-fetch (the actual point), it
just correctly sequences after the previous scene's own teardown.

**A missing map entry is a silent no-op, not an error — audit by map
membership, not by guessing which features are exceptions.**
`SCENE_VIDEO_SRC` (the feature→background-file map) was missing
`timeline` (Post Timeline) — a genuine bug, since every other Post
sibling (`hearts`/`emblems`/`items`/`stats`) has an entry. It went
unnoticed for a long time because `#bg-video` used to still be visibly
looping underneath (see point 1) — freezing that exposed the gap.
`richguy` is legitimately absent (its own full-bleed art, deliberately
leaves whatever background was already playing untouched) — so the
correct guard in `transitionToImpl` is
`if (SCENE_VIDEO_SRC[newFeature]) showSceneVideo(newFeature);` (checks
actual map membership), **not** a hardcoded `if (newFeature !== 'timeline')`-
style exception list — hardcoding the one exception you happen to know
about is exactly what caused `timeline` to be missing in the first
place, and would just as easily miss the next one.

**Baking a mask into a real alpha channel offline beats computing it in
JS every frame, if the runtime environment actually decodes it.**
`Draft.html`'s hero-pick reveal used to do a manual per-pixel
`getImageData`/JS-loop/`putImageData` every video frame to combine a
luma-based matte mask with the hero video (no real alpha channel on
either source) — ~0.43ms/frame, non-trivial over a ~1s reveal × up to
10 picks. Replaced with: pre-bake the identical math into a real WebM
alpha channel once, offline —
```
ffmpeg -i in.webm -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255-((77*r(X,Y)+150*g(X,Y)+29*b(X,Y))/256)'" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 out.webm
```
— then at runtime, pure GPU compositing: `drawImage(hero)` →
`globalCompositeOperation = 'destination-in'` → `drawImage(alphaMatte)`
→ reset. Measured ~86x cheaper (0.43ms → 0.005ms), verified pixel-exact
against the original JS formula. **Gotcha when verifying such an
asset:** `ffmpeg`'s *default* VP9 decoder silently ignores WebM's alpha
side-channel and reports a constant fully-opaque value — you must pass
`-c:v libvpx-vp9` explicitly on the decode/verification side (not just
the encode side) to actually read the baked alpha back out; otherwise a
correctly-encoded file looks broken. This technique doesn't generalize
to *every* masking case — a mask that needs to combine with the
target's own pre-existing alpha via something other than a straight
multiply (e.g. Draft.html's player-photo erase, which takes
`Math.min(ownAlpha, matteAlpha)`) doesn't map onto Porter-Duff
compositing operators and was deliberately left on the JS path.

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

## Master checklist — adding any new feature (this is a moving target — use this every time, don't rely on memory)

This project is under continuous, incremental development across
`mplfs.html`, `mpltag.html` ("MPL L3"), and `Draft.html`. Every miss
below has actually shipped at least once and cost a real round trip to
diagnose, because each one is **silent** — no error, no crash, just a
button/preview/copy-icon that quietly does nothing or a "Showing"
indicator that's permanently wrong. Work through the checklist for
whichever file you're extending; don't skip steps because "it's a small
feature" — the small features are exactly the ones where a skipped step
goes unnoticed longest.

### A. New `mplfs.html` scene (full-screen, shares the `activeFeature` slot)

1. Copy the structure of an existing scene closest to what you need (MVP
   Scene is the most fully-featured reference) rather than starting blank.
2. CSS: `#foo-page` container + one absolutely-positioned rule per element,
   each with its own id/class — no shared wrapper unless intentional (see
   "The #1 rule" above).
3. HTML: the container div and its children, wired to the CSS above.
4. JS: fetch function → apply function (sets every element's
   src/textContent, calls fit-to-box helpers) → `showFooScene`/
   `hideFooScene` following the two-class transition pattern (see "Scene
   architecture" above).
5. **Background loop** — decide if this scene needs the shared crossfading
   ambient background (`showSceneVideo`/`SCENE_VIDEO_SRC`, see
   "Video-heavy overlays" above). If yes, add `foo: '/assets/bgloopXXX.webm'`
   to `SCENE_VIDEO_SRC` — check what a sibling scene of the same "family"
   uses (e.g. every Post scene currently uses `bgloopwaves2.webm`) rather
   than guessing. If no (the scene has its own full-bleed art, like
   `richguy`), do nothing — `transitionToImpl`'s
   `if (SCENE_VIDEO_SRC[newFeature])` guard already skips it correctly,
   just don't force an entry in "to be safe."
6. **Post-family boards** — if this is a Post-style scene meant to sit
   alongside Matchboard/Middleboard/Playerboard, add its key to
   `POST_FEATURES` in `transitionToImpl` and decide what it does to
   middle/player board (most Post scenes show both — the `else` branch;
   a few like `post4key`/`consolidated_post` special-case this — check
   whether yours needs a special case too, don't assume the default fits).
   If it's a normal full-screen scene (not Post-family), skip this — it
   goes through the `else` branch that hides all three boards, which is
   correct for a scene that covers the whole frame.
7. Dashboard Edit tab: add `FOO_DEFAULTS`, `FOO_ELEMENTS`, register in
   `EDIT_CONFIGS`.
8. Local debug card in `mplfs.html` (optional, for testing while you
   build — see "Adding a local debug SHOW/HIDE/PREVIEW card" above).
9. Live control wiring (needed for the real dashboard to trigger it
   remotely — see "Live control (SSE)" above): server show/hide routes in
   `routes/overlay.js` → SSE listener in `connectSSE()` → line in
   `hideActiveFeature()` → line in `restoreScene()` → button entry in
   `dashboard.html`'s `OVERLAYS[...].features` → line in
   `MPLFS_ACTIVE_FEATURE_MAP`. All six must use the exact same feature-key
   string. **The last one is the one that gets forgotten** — everything
   still shows/hides fine without it, only the Control-tab "Showing"
   indicator is silently wrong.
10. **Preview** — add a branch to `mplfs.html`'s `window.previewTrigger`
    for the SAME event name used in step 9's `connectSSE()` listener
    (verify it's the same string — see "Control-tab Preview" above for
    why the external route name and the internal `activeFeature` name
    often differ, e.g. `post_stats` vs `stats`). This is the single most
    commonly forgotten step of this whole checklist — Credit Reel, Post
    Stats, Consolidated Post, and Consolidated Post 2 all shipped with
    working real Show/Hide but a completely silent Preview button.
    **Everything else Preview-related is automatic** once step 9's
    `dashboard.html` feature entry exists with `show`/`hide` — the
    "◈ Preview" button, the show/hide copy-route buttons, and the
    Showing/Hidden toggle all come from the SAME `ov.features`/`feat`
    entry via `dashboard.html`'s generic renderer. Do not hand-write any
    of those; if one is missing, the feature entry is malformed, not
    missing a manual step.
10b. **Event log verdict** — add the scene to `olScenes` at the bottom of
    `mplfs.html`'s main script (same event key as step 10, plus its
    internal `active` name). Skip it and the scene still works, but never
    gets a 🟢/🟡/🔴 line in the dashboard's Logs tab or a load status next
    to its Control-tab button — silent, like every other miss here. See
    "Event log" below.
11. New named SSE event → add it to `KNOWN_EVENTS` in
    `html/js/overlay-shared-worker.js` AND bump `OVERLAY_WORKER_VERSION`
    in `html/js/overlay-sse-shim.js` in the same change (see "Dashboard
    architecture" above). Skip the version bump and any tab/OBS
    browser-source already open keeps talking to the old worker forever,
    no matter how many times it's refreshed.
12. Sanity-check before calling it done: grep every id/class used in the new
    `FOO_ELEMENTS`/`FOO_DEFAULTS` against the actual `mplfs.html` markup —
    a mismatch is silent (no error, the Edit row just does nothing). Same
    goes for the feature-key string across all wiring spots in steps 9–10.
13. Validate JS syntax on every file you touched (a fresh `<script>` block
    that fails to parse breaks the whole page):
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
14. Verify live (see "Verifying changes with a real browser" above) —
    not just via `curl`, which only proves a route exists:
    - Click the real Control-tab toggle/Show button and confirm a
      *separate* tab/instance picks up the change over SSE.
    - Click "◈ Preview" and confirm the SAME scene shows **only** in the
      preview iframe, and confirm the real broadcast state (`curl
      /overlay/mplfs-scene`) did NOT change as a result.
    - If the scene touches boards (step 6), confirm the board copy of
      "shown" actually reflects reality afterward
      (`curl /overlay/mplfs-scene`) even after switching to a *different*
      scene — this is exactly the class of bug `syncBoard()` exists to
      prevent, and a new special-cased board branch is a new place it
      can be missed.
    - Click each copy-route button and confirm the copied text is the
      URL you expect.

### B. New `mpltag.html` tag ("MPL L3" — independent, no `activeFeature` slot)

Tags don't share `mplfs.html`'s mutual exclusion, so most use the
simpler **checkOverlays pattern** (see that section above) rather than
the 6-layer SSE wiring:

1. HTML/CSS for the tag, same "every element independently editable" rule.
2. Server: one boolean in `state.checkOverlays`, `GET /overlay/<key>/show`
   and `/hide` routes broadcasting a named SSE event.
3. Client listener in `mpltag.html` toggling a CSS class/animation.
4. Dashboard: add `{ name, key }` to the overlay's `checkToggles` array —
   this alone generates the toggle button and both copy-route buttons.
5. **If the tag needs its own real Show/Hide buttons instead of a single
   toggle** (because, like `mapselecttag`, repeated "Show" clicks do
   something other than a plain on/off — e.g. reveal one more item each
   time), use the plain `show`/`hide` fields on the `OVERLAYS` entry
   instead of `checkToggles`, plus a `mapSelectTagStatus`-style read-only
   pill if you need to show *what* state it's in beyond shown/hidden.
6. **Preview** — `mpltag.html` has its own separate `window.previewTrigger`
   (only handles `mapselecttag` today). Add a branch for your new tag's
   event name, and set `previewButton: true` on its `OVERLAYS` entry if
   you want a "◈ Preview" button at all (optional for tags — many don't
   need cross-tab preview since they're small and quick to check live).
   Player H2H's previews are per-role (`preview: { event, action, group }`
   on its `extraActions` entries → `buildPreviewToggleBtn(event,
   { showAction, group })`), and Player H2H alone has an isolation flag
   (`PH2H_PREVIEW_ONLY`: a `?preview=1` copy skips its restore + real SSE).
   **The rest of `mpltag.html` has no preview-mode isolation flag** (unlike
   `mplfs.html`'s `isPreviewFrame` / `Draft.html`'s `PREVIEW_ONLY`) — if
   your new tag's show/hide logic does anything beyond local DOM/CSS
   changes (a `fetch()`, writing shared state, anything like
   `syncBoard()`), it WILL leak into real broadcast state when previewed
   unless you add that same guard yourself. Purely-local tags don't need
   it.
7. Syntax-check + live-verify exactly as in section A, steps 13–14.

### C. New `Draft.html`-style single whole-scene toggle

For a standalone on/off panel that isn't part of a "family" (like
`draft`, `draftindex`, or Draft.html's own `draftrecap` panel):

1. Server: a bespoke boolean (`state.draftActive`-style) or a
   `state.checkOverlays` entry — either works, see "Simpler show/hide"
   above for when to use which.
2. `GET /overlay/<key>/show` / `/hide` routes + a `GET /overlay/<key>-state`
   restore-on-load route if using the bespoke-boolean style.
3. Dashboard: plain `show`/`hide` fields on the `OVERLAYS` entry
   (`toggleShowHide: true` if you want the single SHOWING/HIDDEN pill
   instead of two separate buttons — see Draft Overlay's entry for the
   pattern, including its own `draftShowState`/`applyDraftShowBtn` cache
   and dedicated `dashboardSSE` listener, since a bespoke boolean isn't
   part of the flat `checkOverlays` map the generic `toggleCheckOverlay`
   loop already handles).
4. **If the page is heavy enough that having it live in vMix AND loaded
   in the Control-tab preview iframe simultaneously would double GPU
   load** (lots of concurrent video/canvas work — this was Draft.html's
   whole reason for existing as a special case), use
   `deferredPreview: true` instead of the normal always-loaded preview
   iframe (see "Control-tab Preview" above) — the iframe stays at
   `about:blank` until "◈ Preview" is explicitly pressed. Add
   `window.previewTrigger` AND the `PREVIEW_ONLY` guard (skip reacting to
   real SSE, skip the restore-on-load fetch) to the page itself — without
   both, a `deferredPreview` iframe will either do nothing when
   previewed, or silently mirror real broadcast state the moment it
   loads.
5. Syntax-check + live-verify exactly as in section A, steps 13–14,
   including confirming the iframe genuinely goes back to `about:blank`
   (not just visually hidden) when Preview is toggled off, if you used
   `deferredPreview`.

### D. New `mploverlay_v7.html` feature

First decide which of the two shapes it is (see the
"`mploverlay_v7.html`" section above — a persistent on/off panel vs. an
automatic per-player reactive effect; they use completely different
checklists, and guessing wrong wastes the whole implementation):

- **Persistent panel** → it's the checkOverlays pattern, same as section
  A/B above, plus this file's `icBuildPanel`/`icAnimateIn`-style naming
  convention and (if it's a side-\*-check) the shared `sidecheck` event.
- **Automatic reactive effect** → the 7-step checklist in the
  "`mploverlay_v7.html`" section above (arm/disarm toggle → detection
  logic in `overlay-debug.js`'s poll handler → the `triggerYourFeature`
  build/cleanup/safety-timeout shape → wiring into `isAnyPlaying`/
  `playNextQueued` → debug bar → `iframeTest` dispatch branch → verify
  from a real poll tick, not just the debug button).

In both cases: syntax-check + live-verify as in section A, steps 13–14.

## Event log — dashboard Logs tab + Control-tab load status

`lib/eventLog.js` (store: in-memory ring of 2000 + daily
`logs/events-YYYY-MM-DD.jsonl`, gitignored) and `routes/eventLog.js`
(`POST /api/event-log` batches from pages, `GET /api/event-log?since=<id>`
for the dashboard, `/days` + `/download?day=` for saved days). Line format
everywhere: `🟢 [14:32:05 - 2026-10-09] - <source> · <text>`, green /
yellow / red = success / warning / crucial.

- **Server side:** upstream pollers (`lib/pollers.js`, `lib/hrmPoller.js`)
  call `eventLog.health(key, label, 'ok'|'slow'|'down', info)`, which logs
  only on state CHANGES (needs 2 consecutive failures / 3 slow ticks) —
  never per tick. The route also logs every `/overlay/<key>/show|hide`
  hit and every `/overlay/events` connect/disconnect (one per browser,
  thanks to the SharedWorker).
- **Pages:** `html/js/event-log-client.js`, included right after
  `theme-apply.js` on mplfs/ENTVC/mpltag/Draft/DraftIndex/mploverlay_v7 and
  the dashboard. Automatically reports failed/slow (>2s) `fetch`es, broken
  images/videos, JS errors. `OverlayLog.warn(msg)`/`.critical(msg)` for
  explicit lines. `OverlayLog.wrapScenes({...})` (only mplfs.html's
  `olScenes` today) times each show function and logs ONE verdict per show,
  folding in any problems that happened while it loaded; boards are
  `child: true` so a Post scene's verdict waits for and includes them; a
  scene not done within 15s is 🔴 with the requests still in flight listed.
- **Must stay zero-cost:** nothing ever awaits logging, wrappers pass
  return values/errors through untouched, batches flush at most every 2s
  on idle, and a missing route/unreachable server just drops entries. Keep
  it that way — never make a scene wait on, or branch on, the logger.
- Pages loaded with `?preview=1` report as `preview` (Control/Edit
  iframes); the Control-tab status shows Live and Preview separately so a
  preview click never looks like the real broadcast.

## Extra verification tips learned on the playoffs work

- **Preview mode renders real data.** `mplfs.html?preview=1` + `window.previewTrigger(event,'show')` (event = the SSE event name, e.g. `final_team`, `consolidated_post_2`, `today_schedule`) gives a safe render of a scene against the current debug game feed. `Draft.html?preview=1` works the same (`previewTrigger('draft','show')`). `DraftIndex*.html` has no preview mode — it restores from the real `/overlay/draftindex-state`, so a reload while the server says "active" comes up shown.
- **mpltag.html**: `<script>` extraction by regex fails on a comment containing `<script` (false "Unexpected token '--'" — also fails on `HEAD`, ignore it). To drive its internals, slice the IIFE by `indexOf` and append `window.__t = {...}` before `restore(); connectSSE();`.
- **Stubbing fetches for a test**: `Page.addScriptToEvaluateOnNewDocument` can replace `window.fetch` for specific URLs so a page doesn't restore real state.
- **Jump straight to a scene's end state** by adding the CSS class the animation would add (`dstats-in`, `ft-reveal`…) instead of waiting out timers; capture crops with `Page.captureScreenshot` `clip` and upscale with PIL to judge alignment.
- **Frame-time check** for "it stutters": a `requestAnimationFrame` gap logger over the whole sequence. Headless Edge showed no >40ms frames even when the user saw a hitch, so treat it as "no big main-thread stalls", not proof of smoothness in vMix.

## Verifying changes with a real browser, without a Playwright/puppeteer dependency

Headless Microsoft Edge (Chromium-based, already installed on this
Mac) driven over raw Chrome DevTools Protocol works well for this and
needs no new dependency — modern Node has native `fetch`/`WebSocket`:
```
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/path/to/scratch/profile --autoplay-policy=no-user-gesture-required about:blank &
```
Then from Node: `fetch('http://localhost:9222/json')` to get the page
target's `webSocketDebuggerUrl`, open a `WebSocket` to it, and send
`Page.navigate`/`Runtime.evaluate` commands. This was used repeatedly
this session to drive real interactions (click a real button, wait,
read DOM/JS state back) against the actual running dev server —
far more reliable than reasoning about timing from reading code alone,
and it's what caught the `showSceneVideo` ordering bug and the iframe
`about:blank` vs `''` bug, neither of which was obvious from the code.
`--headless=new` plus `--virtual-time-budget=N` (with `--dump-dom`) works
for short synchronous checks; for anything involving real video
playback or `setTimeout`-paced async work, use a real long-lived
process (`run_in_background`) and real `sleep`s instead — virtual time
does not advance video decode/playback consistently, which produces
confusing false negatives that look like a real bug.

**Never let a test touch real state that a live show depends on
without restoring it.** `state.mplfsScene`/`state.checkOverlays`/
`state.draftActive`/`api_mode.json`/the 9 `*_api_url.json` files are all
real, shared, persistent server state — hitting their real routes from
a test is fine (often necessary — see the Preview section's `syncBoard`
example, which could only be caught this way), but capture the
pre-test value first and restore it after (`curl .../fs/hide` to fully
reset `mplfs.html`'s scene state is the fastest full reset). Prefer an
isolated harness when the code under test doesn't strictly need the
real server: extract the actual `<script>` content from the real file
(`fs.readFileSync` + regex, not hand-retyped) into a scratch HTML page,
append one line exposing whatever internal functions/state the test
needs (`window.__test = {...}`), and drive it directly — this exercises
the literal shipped code with zero risk to shared state. `node --check
file.js` (parse-only, no execution) is safer than `node -e
"require(...)"` for a quick syntax check of a `lib/`/`routes/` file
that starts intervals/pollers at require-time (e.g. `lib/pollers.js`) —
`require`-ing it for real hangs the process on those timers.

### Bracket pose moves (mplfs.html) — vMix frame-skip notes

While the bracket is OFF its base pose (`brApplyPose`, `brAnimActive`) the trophy video and the playoffs sponsor loop are stopped once their
fade-out ends (`brTrophyPoseSync`, `brSponsorPoseSync`; resumed on return to base, flags reset in show/hide), and `#br-trophy`, `#br-header`,
`#br-sponsor` have `will-change: opacity` so their fades don't repaint the tilting container. Measured at 20x CPU throttle in headless Edge
(can't reproduce vMix itself): gpu ~1000 -> ~790ms, video decode ~1080 -> ~850ms, main ~6.8 -> ~6.1s; >25ms frames per move barely changed
(still ~15-20 on leave/return of base). Remaining suspect: the bg video crossfade (`bracket` <-> `bracket_anim`, a cold 1080p webm) at the
moment the pose leaves/returns base — not changed because delaying/pre-warming it alters visual timing.

### Post H2H — playoffs phase-2 photo (mplfs.html, `p2hApplyCard`)

Same treatment as Post 4 Key: under `data-theme="playoffs"` the card's phase-2 image (`.p2h-photo-sig`) is the B&W crop `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp`
(`thBnwUrl`, TRI = the camp's `team_simple_name`), greyscale + a team-colour corner tint (`.p2h-photo-tint`, blue = home / red = away, copies of the `.p4k-photo-tint` gradients,
screen blend) that fades in with the `.p2h-posed` crossfade. `.p2h-bnw` on `.p2h-photo-box` is only set while the crop is used; a player with no crop falls back to the signature
portrait with no grey/tint. Front->pose button, bounce and timing unchanged. Read at card-fill time (next Show after a theme switch). Verified in a headless preview (filter + tint opacity 1 once posed).

### Bracket — eliminated teams + winner path glow (mplfs.html, `brApplyData`)

A series counts as decided when a side reaches the wins its stage title's "BOn" needs (`brWinsNeeded`: BO5 -> 3, BO7 -> 4, none -> BO5). Loser: all four pieces of its slot get `.br-defeated`
(`grayscale(1) brightness(.5)`, eased 600ms; static filter on purpose). Winner: its path over `bracket_lines.png` glows (`.br-glow-on`, clipped copies of the lines art per `BR_PATHS`, coordinates measured off the art, gold
drop-shadow bloom, opacity-only pulse — never animate the filter, the plane is 3D-tilted). Only the drawn winner connectors glow (M1/M2->M3/M4, M3/M4->M5, M6->M7, M5/M7->M8); loser paths aren't on the art. Merely leading
keeps the old `*_win` cell art, no glow/dim. Live: rides the existing bracket `data` SSE refresh. No server change.

### Bracket return-to-base hitch — `showSceneVideo` no longer re-assigns an unchanged src

Measured (headless Edge over raw CDP, `Emulation.setCPUThrottlingRate` 20, rAF gap logger, 3 runs of off-base -> base 800ms): the `bracket_anim` <-> `bracket` background swap was the one controllable cost (no-swap
variant ~halved the slow frames). Cause: `showSceneVideo` set `nextEl.src = src` every swap, restarting resource selection (cold demux + VP9 decoder init) even when that paused layer still held the file. It now skips the
assignment when `getAttribute('src')` already equals it, so after the first leave-base the return swap is just rewind+play. Measured slow frames (>=33ms) per move ~11-12 -> ~7-10 (noisy). Tried and NOT better: delaying
the bg swap to the end of the move (hitch just moves there), deferring trophy play / sponsor loop start to the move end, removing the new defeated/glow layers (they cost nothing). The rest is the 3D plane move itself
in a throttled headless browser (can't reproduce vMix). **Measurement gotcha:** orphaned headless Edge processes from earlier failed harness runs starve the CPU and the server (6-connection cap) and fake a huge
stutter — kill leftovers (`msedge` with the harness `--user-data-dir`) before trusting numbers.

### Bracket — background first, then tilt (playoffs, leaving the base pose)

`brApplyPose` now starts the 3D move `BR_BG_LEAD_MS` (550ms) AFTER the background crossfade (+ trophy/header/sponsor fades) when the bracket leaves its base pose under the playoffs theme (`leavingBase`), so the
full-screen fade and the tilt never overlap. **Return to base is mirrored:** the tilt goes back first (theme background, no trophy/header/sponsor until it lands), then `surround()` (background crossfade + trophy/header/sponsor fades + their syncs) runs `durMs + 60`ms later (`brRestoreTimer`). Angle -> angle, live slider edits (durMs 0) and other themes move immediately. `brMoveTimer` is cleared by every `brApplyPose` and by hide. Verified: bg swaps at
t+200ms, transform unchanged until ~550ms, angle->angle immediate. Adds ~0.55s of lead to the first Show-again step.

### Bracket (playoffs) — one constant background + a header webm that does the fading

The playoffs bracket background is now `playoffsbg_theme.webm` at ALL times (`SCENE_VIDEO_SRC_BY_THEME.playoffs.bracket`; `bracket_anim` is the same file, so `brSyncBg` never swaps — no more full-screen crossfade).
`#br-header-bg` (`HEADER BG_1920x250.webm`, playoffs only, flush top-left at 0,0, outside the tilting container, behind `#br-header`) is the layer that fades: opacity = base ? 1 : 0 (500ms) from `brApplyPose`'s `surround()` along
with trophy/header/sponsor, played on base and paused ~560ms after fading out (`brHeaderBgSync`). `playoffsbg_waiting.webm` is no longer used by the bracket (still used by Waiting/Lobby/Schedules).

### Bracket pre-warming the background videos was tried and REVERTED

Prefetching both bracket background webms (detached `preload=auto` videos) made the 20x-throttle run much worse (103 slow frames vs 46, worst 467ms) — don't re-add it.

## Handoff — state at the end of the vMix-optimization / playoffs session (read first in a fresh chat)

**Nothing is committed** (git status was dirty before this work too; `hires_l3/` is untracked). Don't commit unless asked.

**Server restart still pending (ask the user first — it's their terminal):** `routes/overlay.js` + `lib/state.js` (`heatmappage` show/hide + state key; playoffs per-day highlight cycle; `lordadv`/`skypiercer`/`led_*` `VALID_FEATURES`),
`routes/devapi.js` (`superfan_text`, `/api/heatmap-style`, `/api/winrate-proxy`), `routes/proxy.js`, `routes/led.js`. HTML-only changes (everything else in this session) need no restart.
`OVERLAY_WORKER_VERSION` is currently 38 (worker auto-recreates a dead EventSource); bump it again whenever `overlay-shared-worker.js` changes.

**vMix perf lessons (headless Edge can't reproduce vMix; measure under `Emulation.setCPUThrottlingRate` ~20x with Tracing + a rAF gap logger):**
- Cheap: compositor-only animation (transform/opacity), `will-change` own layers, canvas pre-paint, WebP copies with PNG fallback, `img.decode()` before a fade, staggered swaps, pausing hidden videos.
- Expensive: full-screen 1080p60 VP9 loops (dominant idle cost), big PNG decode at swap time, animated SVG `d` / mask / clip-path / filter, anything repainting the big tilting container.
- Always A/B: a "plausible" optimisation can make it worse (bracket background pre-warm: 46 -> 103 slow frames). Revert what doesn't measure better.
- No ffmpeg on this machine, so videos can't be re-encoded/cropped here (installing needs the user's OK).

**Open / offered but not requested:**
- Bracket: only remaining lever is delaying the `bracket` <-> `bracket_anim` background swap until the pose move ends (changes visible timing) — user hasn't chosen it.
- L3 Lobby: background video re-cut/crop (needs ffmpeg); optionally use existing `hires/*_web` instead of `hires_l3`.
- webp copies of Team Line-Up group/bg PNGs; Final Team plain-logo for Regular/10th Anniversary (currently playoffs only).
- A NEW player needs a `hires_l3` WebP copy (L3 Lobby) and a `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` crop (Team Hexagon, Post 4 Key, Post H2H) or it silently falls back.

**Scratch test harness pattern** (scripts live in the session scratchpad, not the repo, so recreate): spawn headless Edge with `--remote-debugging-port`, open a tab over raw CDP WebSocket, `Page.navigate` to
`http://localhost:3000/html/mplfs.html?preview=1`, drive with `window.previewTrigger('<sse event>','show'|'hide')`, read DOM/computed style back. Gotcha: never `await` a `Runtime.evaluate` that itself sets
`location.href` (it hangs) — wrap in `setTimeout(...,10);1`.
