"use strict";

const { eTLDPlus1, isSameSite } = self.PrivacyLensETLD;
const { computeScore } = self.PrivacyLensScore;

const tabs = new Map();

function freshTabState(url) {
  return {
    url: url || "",
    pageDomain: url ? eTLDPlus1(new URL(url).hostname) : "",
    thirdPartyDomains: new Map(),
    requestsCount: 0,
    cookies: {
      firstParty: 0,
      thirdParty: 0,
      session: 0,
      persistent: 0,
      thirdPartyPersistent: 0,
      supercookies: 0
    },
    storage: { localStorage: [], sessionStorage: [], indexedDB: [], keys3p: 0 },
    fingerprint: { canvas: false, webgl: false, audio: false, samples: [] },
    cookieSyncing: false,
    syncSuspects: [],
    superCookies: 0,
    superCookieSamples: [],
    hijacking: 0,
    hijackingSamples: [],
    redirects: []
  };
}

function getTab(tabId, url) {
  if (!tabs.has(tabId)) tabs.set(tabId, freshTabState(url));
  return tabs.get(tabId);
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!/^https?:/i.test(details.url)) return;

    const state = getTab(details.tabId);
    state.requestsCount++;

    if (details.type === "main_frame") {
      tabs.set(details.tabId, freshTabState(details.url));
      return;
    }

    if (!state.pageDomain) {
      browser.tabs.get(details.tabId).then(t => {
        if (t && t.url) {
          state.url = t.url;
          state.pageDomain = eTLDPlus1(new URL(t.url).hostname);
        }
      }).catch(() => {});
    }

    const reqHost = (() => { try { return new URL(details.url).hostname; } catch { return ""; }})();
    if (!reqHost || !state.pageDomain) return;

    if (!isSameSite(reqHost, state.pageDomain)) {
      const reqDomain = eTLDPlus1(reqHost);
      if (!state.thirdPartyDomains.has(reqDomain)) {
        state.thirdPartyDomains.set(reqDomain, new Set());
      }
      state.thirdPartyDomains.get(reqDomain).add(details.type || "other");
    }
  },
  { urls: ["<all_urls>"] }
);

const recentETags = new Map();
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!details.responseHeaders) return;
    const state = getTab(details.tabId);
    if (!state.pageDomain) return;

    let reqHost;
    try { reqHost = new URL(details.url).hostname; } catch { return; }
    const reqDomain = eTLDPlus1(reqHost);
    const isThirdParty = !isSameSite(reqHost, state.pageDomain);

    for (const h of details.responseHeaders) {
      const name = h.name.toLowerCase();

      if (name === "etag") {
        const val = (h.value || "").replace(/^W\//, "").replace(/"/g, "");
        // ETag longo/opaco vira ID estável — etag fraco baseado em mtime fica de fora
        if (/^[a-f0-9]{16,}$/i.test(val) || /^[A-Za-z0-9+/=_-]{20,}$/.test(val)) {
          state.superCookies++;
          state.superCookieSamples.push({
            type: "etag", domain: reqDomain, value: val.slice(0, 32),
            thirdParty: isThirdParty
          });
        }
        if (!recentETags.has(reqDomain)) recentETags.set(reqDomain, new Set());
        recentETags.get(reqDomain).add(val);
      }

      if (name === "strict-transport-security" && isThirdParty) {
        if (/max-age=\d+/i.test(h.value || "")) {
          // só conta se o subdomínio tiver cara de "bucket" de bits (1-3 chars)
          if (/^[a-z0-9]{1,3}\./.test(reqHost)) {
            state.superCookies++;
            state.superCookieSamples.push({
              type: "hsts", domain: reqHost, value: "max-age",
              thirdParty: true
            });
          }
        }
      }

      if (name === "set-cookie" && isThirdParty) {
        // ID opaco de 16+ chars na URL costuma significar handoff de cookie
        const urlIdMatch = details.url.match(/[?&=/]([A-Za-z0-9_-]{16,})(?:[&?/]|$)/);
        if (urlIdMatch) {
          state.cookieSyncing = true;
          state.syncSuspects.push({
            url: details.url.slice(0, 120),
            domain: reqDomain,
            id: urlIdMatch[1].slice(0, 24)
          });
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const state = getTab(details.tabId);
    if (details.type === "main_frame") {
      state.redirects.push({ from: details.url, to: details.redirectUrl });
    }
  },
  { urls: ["<all_urls>"] }
);

async function refreshCookies(tabId) {
  const state = tabs.get(tabId);
  if (!state || !state.url) return;
  let cookies = [];
  try {
    cookies = await browser.cookies.getAll({ url: state.url });
    for (const d of state.thirdPartyDomains.keys()) {
      try {
        const more = await browser.cookies.getAll({ domain: d });
        cookies = cookies.concat(more);
      } catch {}
    }
  } catch (e) {
    return;
  }

  const c = { firstParty: 0, thirdParty: 0, session: 0, persistent: 0,
              thirdPartyPersistent: 0, supercookies: state.cookies.supercookies };

  const seen = new Set();
  for (const ck of cookies) {
    const key = ck.domain + "|" + ck.name + "|" + (ck.path || "");
    if (seen.has(key)) continue;
    seen.add(key);

    const third = !isSameSite(ck.domain, state.pageDomain);
    if (third) c.thirdParty++; else c.firstParty++;

    if (ck.expirationDate) {
      c.persistent++;
      if (third) c.thirdPartyPersistent++;
    } else {
      c.session++;
    }
  }
  state.cookies = c;
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : (msg.tabId || -1);

  if (msg.kind === "storage-snapshot" && sender.tab) {
    const state = getTab(tabId, sender.tab.url);
    state.storage.localStorage = msg.localStorage || [];
    state.storage.sessionStorage = msg.sessionStorage || [];
    state.storage.indexedDB = msg.indexedDB || [];
    state.storage.keys3p = (msg.localStorage || []).filter(k => k.is3p).length
                          + (msg.sessionStorage || []).filter(k => k.is3p).length
                          + (msg.indexedDB || []).filter(k => k.is3p).length;
    return;
  }

  if (msg.kind === "fingerprint" && sender.tab) {
    const state = getTab(tabId, sender.tab.url);
    if (msg.type === "canvas") state.fingerprint.canvas = true;
    if (msg.type === "webgl")  state.fingerprint.webgl  = true;
    if (msg.type === "audio")  state.fingerprint.audio  = true;
    state.fingerprint.samples.push({
      type: msg.type, method: msg.method, ts: Date.now()
    });
    if (state.fingerprint.samples.length > 50) {
      state.fingerprint.samples.shift();
    }
    return;
  }

  if (msg.kind === "hijack-signal" && sender.tab) {
    const state = getTab(tabId, sender.tab.url);
    state.hijacking++;
    state.hijackingSamples.push({
      reason: msg.reason, detail: msg.detail, ts: Date.now()
    });
    return;
  }

  if (msg.kind === "get-tab-data") {
    (async () => {
      const id = msg.tabId;
      await refreshCookies(id);
      const state = tabs.get(id) || freshTabState();
      const serializable = {
        url: state.url,
        pageDomain: state.pageDomain,
        thirdPartyDomains: Array.from(state.thirdPartyDomains.entries())
          .map(([d, types]) => ({ domain: d, types: Array.from(types) })),
        requestsCount: state.requestsCount,
        cookies: state.cookies,
        storage: state.storage,
        fingerprint: state.fingerprint,
        cookieSyncing: state.cookieSyncing,
        syncSuspects: state.syncSuspects,
        superCookies: state.superCookies,
        superCookieSamples: state.superCookieSamples,
        hijacking: state.hijacking,
        hijackingSamples: state.hijackingSamples,
        redirects: state.redirects
      };
      const scoreInput = {
        thirdPartyDomains: new Set(serializable.thirdPartyDomains.map(d => d.domain)),
        cookies: state.cookies,
        storage: state.storage,
        fingerprint: state.fingerprint,
        cookieSyncing: state.cookieSyncing,
        superCookies: state.superCookies,
        hijacking: state.hijacking
      };
      const score = computeScore(scoreInput);
      sendResponse({ data: serializable, score });
    })();
    return true;
  }

  if (msg.kind === "reset-tab" && msg.tabId != null) {
    tabs.delete(msg.tabId);
    sendResponse({ ok: true });
    return;
  }
});

browser.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
browser.webNavigation && browser.webNavigation.onCommitted &&
  browser.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId === 0) {
      tabs.set(d.tabId, freshTabState(d.url));
    }
  });
