// Popup — busca dados do background e renderiza.
"use strict";

const REASON_LABELS = {
  thirdPartyDomains:    "Domínios de 3ª parte",
  thirdPartyCookies:    "Cookies de 3ª parte",
  persistent3pCookies:  "Cookies 3ª parte persistentes",
  storage3pKeys:        "Chaves de storage 3ª parte",
  canvasFingerprint:    "Canvas fingerprinting",
  webglFingerprint:     "WebGL fingerprinting",
  audioFingerprint:     "AudioContext fingerprinting",
  cookieSyncing:        "Cookie syncing",
  superCookies:         "Supercookies (ETag/HSTS)",
  hijacking:            "Sinais de hijacking"
};

function $(sel) { return document.querySelector(sel); }

async function getCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setText(sel, val) {
  const el = $(sel);
  if (el) el.textContent = String(val);
}

function renderOverview(data, score) {
  setText("#m-tp",      data.thirdPartyDomains.length);
  setText("#m-cookies", data.cookies.thirdParty);
  const storageTotal = data.storage.localStorage.length
                     + data.storage.sessionStorage.length
                     + data.storage.indexedDB.length;
  setText("#m-storage", storageTotal);
  const fpCount = [data.fingerprint.canvas, data.fingerprint.webgl, data.fingerprint.audio].filter(Boolean).length;
  setText("#m-fp", fpCount);
  setText("#m-super",  data.superCookies);
  setText("#m-hijack", data.hijacking);

  setText("#score-num", score.score);
  setText("#score-label", score.band.label);
  $("#score-box").style.background = score.band.color + "22";
  $("#score-num").style.color = score.band.color;
  $("#score-label").style.color = score.band.color;

  const ul = $("#reasons");
  ul.innerHTML = "";
  if (!score.reasons.length) {
    ul.innerHTML = "<li>Nenhuma penalidade. Página parece respeitar privacidade.</li>";
  }
  for (const r of score.reasons) {
    const li = document.createElement("li");
    const label = REASON_LABELS[r.k] || r.k;
    const detail = r.n != null ? ` (${r.n})` : "";
    li.innerHTML = `<span>${label}${detail}</span><span class="penalty">−${r.penalty}</span>`;
    ul.appendChild(li);
  }
}

function renderThirdParty(data) {
  const tb = $("#tp-body");
  tb.innerHTML = "";
  if (!data.thirdPartyDomains.length) {
    tb.innerHTML = "<tr><td colspan='2'><em>Nenhum domínio de 3ª parte detectado.</em></td></tr>";
    return;
  }
  for (const d of data.thirdPartyDomains.sort((a,b) => a.domain.localeCompare(b.domain))) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.domain}</td><td>${d.types.join(", ")}</td>`;
    tb.appendChild(tr);
  }
}

function renderCookies(data) {
  setText("#c-1p",      data.cookies.firstParty);
  setText("#c-3p",      data.cookies.thirdParty);
  setText("#c-sess",    data.cookies.session);
  setText("#c-pers",    data.cookies.persistent);
  setText("#c-3p-pers", data.cookies.thirdPartyPersistent);
  setText("#c-super",   data.superCookies);

  const sup = $("#super-list");
  sup.innerHTML = "";
  if (!data.superCookieSamples.length) {
    sup.innerHTML = "<li><em>Nenhum supercookie suspeito.</em></li>";
  }
  for (const s of data.superCookieSamples.slice(0, 20)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge ${s.thirdParty ? "warn" : ""}">${s.type}</span>${s.domain} <code>${s.value}</code>`;
    sup.appendChild(li);
  }

  const syn = $("#sync-list");
  syn.innerHTML = "";
  if (!data.syncSuspects.length) {
    syn.innerHTML = "<li><em>Nenhuma suspeita de cookie syncing.</em></li>";
  }
  for (const s of data.syncSuspects.slice(0, 20)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge warn">${s.domain}</span> id=<code>${s.id}</code>`;
    syn.appendChild(li);
  }
}

function renderStorage(data) {
  const fill = (sel, arr) => {
    const ul = $(sel); ul.innerHTML = "";
    if (!arr.length) { ul.innerHTML = "<li><em>vazio</em></li>"; return; }
    for (const k of arr.slice(0, 40)) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="badge">${k.size}B</span><code>${k.key}</code>`;
      ul.appendChild(li);
    }
  };
  fill("#ls-list",  data.storage.localStorage);
  fill("#ss-list",  data.storage.sessionStorage);
  fill("#idb-list", data.storage.indexedDB);
}

function renderFingerprint(data) {
  setText("#fp-canvas", data.fingerprint.canvas ? "Sim" : "Não");
  setText("#fp-webgl",  data.fingerprint.webgl  ? "Sim" : "Não");
  setText("#fp-audio",  data.fingerprint.audio  ? "Sim" : "Não");

  const ul = $("#fp-samples");
  ul.innerHTML = "";
  if (!data.fingerprint.samples.length) {
    ul.innerHTML = "<li><em>Nenhuma chamada observada.</em></li>";
  }
  for (const s of data.fingerprint.samples.slice(-20).reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge ${s.type === 'canvas' ? 'bad' : 'warn'}">${s.type}</span><code>${s.method}</code>`;
    ul.appendChild(li);
  }
}

function renderHijack(data) {
  const ul = $("#hijack-list");
  ul.innerHTML = "";
  if (!data.hijackingSamples.length && !data.redirects.length) {
    ul.innerHTML = "<li><em>Nenhum sinal de hijacking detectado.</em></li>";
    return;
  }
  for (const r of data.redirects.slice(-10)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge warn">redirect</span>${r.from} → ${r.to}`;
    ul.appendChild(li);
  }
  for (const s of data.hijackingSamples.slice(-20).reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge bad">${s.reason}</span><code>${JSON.stringify(s.detail).slice(0,180)}</code>`;
    ul.appendChild(li);
  }
}

async function refresh() {
  const tab = await getCurrentTab();
  if (!tab) return;
  $("#page-domain").textContent = tab.url || "—";

  const resp = await browser.runtime.sendMessage({ kind: "get-tab-data", tabId: tab.id });
  if (!resp) return;
  const { data, score } = resp;

  renderOverview(data, score);
  renderThirdParty(data);
  renderCookies(data);
  renderStorage(data);
  renderFingerprint(data);
  renderHijack(data);
}

// Tabs
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

$("#refresh").addEventListener("click", refresh);
$("#reset").addEventListener("click", async () => {
  const tab = await getCurrentTab();
  if (!tab) return;
  await browser.runtime.sendMessage({ kind: "reset-tab", tabId: tab.id });
  refresh();
});

refresh();
