// html/js/theme-apply.js — broadcast theme plumbing, included by every
// overlay page (OBS/vMix browser source). Applies the current global
// theme as `data-theme` on <html> as early as possible (this script is
// included right after cache-bust.js, near the top of <head>), so any
// future per-theme CSS override takes effect before first paint.
//
// The theme itself is one global value, GET/POST '/api/theme'
// (routes/devapi.js), same read/write/SSE-broadcast shape as
// heatmap_config/h2h_config — picked from the Settings page's Theme
// picker (dashboard.html).
//
// IMPORTANT — a theme changes NOTHING by default. Regular, 10th
// Anniversary, and Playoffs render identically until a page's own CSS
// adds an explicit opt-in override:
//   [data-theme="10th_anniversary"] #some-element { ... }
// Never gate a selector on a theme "by omission" (e.g. hiding it only in
// :not([data-theme="regular"])) — always write the override on the
// specific theme(s) it's meant for, so adding a FOURTH theme later can't
// silently inherit changes meant for a different one. See CLAUDE.md's
// "Theme system" section before adding the first real per-theme override.
var THEME_VALUES = ['regular', '10th_anniversary', 'playoffs'];
var THEME_DEFAULT = 'regular';

function applyTheme(theme) {
  var t = THEME_VALUES.indexOf(theme) !== -1 ? theme : THEME_DEFAULT;
  document.documentElement.setAttribute('data-theme', t);
  window.CURRENT_THEME = t;
}

// Deliberately SYNCHRONOUS (not fetch()). This script tag runs before
// every other script on the page, but an async fetch() only resolves
// AFTER the browser has already moved on to executing those — and
// several of them build scene content immediately at top-level script
// load (e.g. mplfs.html's `buildWsSponsor();`, called unconditionally
// right after its own definition, not gated behind any later event).
// Those read document.documentElement's data-theme attribute assuming
// it's already correct — with an async fetch, it usually isn't yet, so
// they silently fall back to Regular's assets every time. This exact bug
// shipped: Waiting TVC's sponsor box kept loading the Regular Sponsor
// Box.png under 10th Anniversary, even though wsTvcAsset()'s logic and
// the theme value itself were both correct — the read just happened a
// few milliseconds too early. A synchronous XHR blocks this script (and
// everything after it, including further HTML parsing) until the theme
// is known, which costs a few ms once per page load and, in exchange,
// every line of every other script on the page can trust data-theme
// unconditionally, with no ordering requirement at all.
(function () {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/theme', false); // false = synchronous
    xhr.send(null);
    applyTheme(xhr.status === 200 ? JSON.parse(xhr.responseText).theme : THEME_DEFAULT);
  } catch (e) {
    applyTheme(THEME_DEFAULT);
  }
})();

// Pages that hold a live overlay-sse-shim connection (see
// html/js/overlay-sse-shim.js) additionally add, right next to their own
// SSE listeners:
//   sse.addEventListener('theme', function (e) { applyTheme(JSON.parse(e.data).theme); });
// so a theme change during a live broadcast applies instantly instead of
// waiting for a reload. Not auto-wired here since not every page that
// includes this file has an `sse`/`es` object in scope.
