(function () {
  "use strict";

  const WEIGHTS = {
    thirdPartyDomain: 2,
    thirdPartyCookie: 4,
    persistentCookie3p: 2,
    storage3pKey: 1,
    canvasFingerprint: 15,
    webglFingerprint: 10,
    audioFingerprint: 10,
    cookieSyncing: 10,
    superCookie: 15,
    hijackingSignal: 20
  };

  const BANDS = [
    { min: 80, label: "Bom",   color: "#2e7d32" },
    { min: 50, label: "Médio", color: "#ed6c02" },
    { min: 0,  label: "Ruim",  color: "#c62828" }
  ];

  function computeScore(tabData) {
    let score = 100;
    const reasons = [];

    const tp = tabData.thirdPartyDomains ? tabData.thirdPartyDomains.size : 0;
    if (tp > 0) {
      const penalty = Math.round(WEIGHTS.thirdPartyDomain * Math.sqrt(tp) * 1.5);
      score -= penalty;
      reasons.push({ k: "thirdPartyDomains", n: tp, penalty });
    }

    const tpc = tabData.cookies ? tabData.cookies.thirdParty : 0;
    if (tpc > 0) {
      const penalty = Math.round(WEIGHTS.thirdPartyCookie * Math.sqrt(tpc) * 1.5);
      score -= penalty;
      reasons.push({ k: "thirdPartyCookies", n: tpc, penalty });
    }

    const tpcPersist = tabData.cookies ? tabData.cookies.thirdPartyPersistent : 0;
    if (tpcPersist > 0) {
      const penalty = WEIGHTS.persistentCookie3p * Math.min(tpcPersist, 5);
      score -= penalty;
      reasons.push({ k: "persistent3pCookies", n: tpcPersist, penalty });
    }

    const sk = tabData.storage ? tabData.storage.keys3p : 0;
    if (sk > 0) {
      const penalty = WEIGHTS.storage3pKey * Math.min(sk, 10);
      score -= penalty;
      reasons.push({ k: "storage3pKeys", n: sk, penalty });
    }

    const fp = tabData.fingerprint || {};
    if (fp.canvas) { score -= WEIGHTS.canvasFingerprint; reasons.push({ k: "canvasFingerprint", penalty: WEIGHTS.canvasFingerprint }); }
    if (fp.webgl)  { score -= WEIGHTS.webglFingerprint;  reasons.push({ k: "webglFingerprint",  penalty: WEIGHTS.webglFingerprint }); }
    if (fp.audio)  { score -= WEIGHTS.audioFingerprint;  reasons.push({ k: "audioFingerprint",  penalty: WEIGHTS.audioFingerprint }); }

    if (tabData.cookieSyncing) {
      score -= WEIGHTS.cookieSyncing;
      reasons.push({ k: "cookieSyncing", penalty: WEIGHTS.cookieSyncing });
    }

    const sc = tabData.superCookies || 0;
    if (sc > 0) {
      const penalty = WEIGHTS.superCookie * Math.min(sc, 2);
      score -= penalty;
      reasons.push({ k: "superCookies", n: sc, penalty });
    }

    const hj = tabData.hijacking || 0;
    if (hj > 0) {
      const penalty = WEIGHTS.hijackingSignal * Math.min(hj, 2);
      score -= penalty;
      reasons.push({ k: "hijacking", n: hj, penalty });
    }

    score = Math.max(0, Math.min(100, score));

    const band = BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1];
    return { score, band, reasons };
  }

  self.PrivacyLensScore = { computeScore, WEIGHTS, BANDS };
})();
