"use strict";

(function () {
  try {
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("content/injector.js");
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {
    console.warn("[Privacy Lens] falha ao injetar:", e);
  }

  window.addEventListener("privacy-lens-fp", (ev) => {
    try {
      browser.runtime.sendMessage({
        kind: "fingerprint",
        type: ev.detail && ev.detail.type,
        method: ev.detail && ev.detail.method
      });
    } catch {}
  });

  window.addEventListener("privacy-lens-hijack", (ev) => {
    try {
      browser.runtime.sendMessage({
        kind: "hijack-signal",
        reason: ev.detail && ev.detail.reason,
        detail: ev.detail && ev.detail.detail
      });
    } catch {}
  });

  function safeKeys(storage) {
    const out = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        let size = 0;
        try { size = (storage.getItem(k) || "").length; } catch {}
        out.push({ key: k, size, is3p: false });
      }
    } catch {}
    return out;
  }

  async function listIndexedDB() {
    if (!indexedDB.databases) return [];
    try {
      const dbs = await indexedDB.databases();
      return dbs.map(d => ({ key: d.name, size: 0, is3p: false }));
    } catch { return []; }
  }

  async function sendSnapshot() {
    try {
      const ls = safeKeys(window.localStorage);
      const ss = safeKeys(window.sessionStorage);
      const idb = await listIndexedDB();
      browser.runtime.sendMessage({
        kind: "storage-snapshot",
        localStorage: ls,
        sessionStorage: ss,
        indexedDB: idb
      });
    } catch {}
  }

  if (document.readyState === "complete") {
    sendSnapshot();
  } else {
    window.addEventListener("load", sendSnapshot, { once: true });
  }
  // re-snapshot porque tracker pode escrever no storage depois do load
  setInterval(sendSnapshot, 5000);

  let lastUserGesture = 0;
  ["click", "keydown", "touchstart"].forEach(ev => {
    window.addEventListener(ev, () => { lastUserGesture = Date.now(); }, true);
  });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      const sinceGesture = Date.now() - lastUserGesture;
      if (lastUserGesture === 0 || sinceGesture > 3000) {
        try {
          browser.runtime.sendMessage({
            kind: "hijack-signal",
            reason: "programmatic-redirect",
            detail: { from: lastHref.slice(0, 200), to: location.href.slice(0, 200) }
          });
        } catch {}
      }
      lastHref = location.href;
    }
  }, 1000);
})();
