/* Sponsor rotation resume point, shared by EVERY sponsor loop on a page (mplfs.html: Waiting TVC/Lobby, Today's/Tomorrow's
   Schedule, Bracket, Consolidated Post 2, Post H2H, Middle Board; ENTVC.html: Waiting TVC).
   Each scene used to restart its own loop at sponsor #1 every time it was shown, so on short scenes the later sponsors never
   aired. Now a loop starts at the sponsor AFTER the last one any loop put on air, and keeps going from there; the logo and its
   category tag come from the same list entry, so they stay together. Loops still keep their own index while running (two
   scenes on screen together walk the list side by side, as before) — this only decides where a freshly-shown scene begins.
   start(len): index to begin at for a list of `len` sponsors (wraps if the list changed length).
   aired(idx): call when sponsor `idx` goes on air. */
window.SponsorCursor = {
  pos: 0,
  start: function (len) { return len > 0 ? this.pos % len : 0; },
  aired: function (idx) { this.pos = idx + 1; },
};
