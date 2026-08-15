// html/js/overlay-sse-shim.js — drop-in replacement for
// `new EventSource('/overlay/events')`, used across every overlay page.
// Instead of opening its own persistent connection, it talks to the one
// SharedWorker (overlay-shared-worker.js) that holds a single real
// EventSource shared across every tab/browser-source of this origin — see
// that file for why. Exposes the same subset of the EventSource API every
// page already uses (addEventListener, .onopen, .onerror, .close()), so
// existing `sse.addEventListener('foo', fn)` call sites don't need to
// change — only the one line that used to say `new EventSource(...)`.
function createOverlaySSE() {
  if (typeof SharedWorker === 'undefined') {
    // Shouldn't happen in Chromium/CEF (what vMix and every browser this
    // system targets uses), but fall back to a direct connection rather
    // than leaving the page with no live updates at all.
    return new EventSource('/overlay/events');
  }

  const listeners = {}; // eventName -> [fn, fn, ...]
  let onopenFn = null;
  let onerrorFn = null;

  const worker = new SharedWorker('/html/js/overlay-shared-worker.js');
  worker.port.onmessage = (e) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'sse-status') {
      if (msg.ok && typeof onopenFn === 'function') onopenFn();
      if (!msg.ok && typeof onerrorFn === 'function') onerrorFn();
    } else if (msg.type === 'sse-event') {
      (listeners[msg.event] || []).forEach((fn) => {
        try { fn({ data: msg.data }); } catch (err) {}
      });
    }
  };
  worker.port.start();

  // The worker has no way to detect a tab closing on its own (MessagePort
  // doesn't expose that) — tell it explicitly so its port list doesn't
  // accumulate dead entries over a long session with many tabs opening
  // and closing.
  window.addEventListener('beforeunload', () => {
    try { worker.port.postMessage({ type: 'disconnect' }); } catch (e) {}
  });

  return {
    addEventListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      if (!listeners[name]) return;
      const i = listeners[name].indexOf(fn);
      if (i !== -1) listeners[name].splice(i, 1);
    },
    set onopen(fn) { onopenFn = fn; },
    get onopen() { return onopenFn; },
    set onerror(fn) { onerrorFn = fn; },
    get onerror() { return onerrorFn; },
    // The real connection is owned by the worker, shared with every other
    // tab — one page asking to "close" it would break every other open
    // page, so this just detaches the noisier no-op: nothing to actually
    // tear down per-page (the worker/browser handle the real connection's
    // lifecycle). Existing `if (sseSource) sseSource.close();` call sites
    // stay harmless.
    close() {},
  };
}
