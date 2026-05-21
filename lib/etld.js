// eTLD+1 simplificado. Cobre os TLDs compostos mais comuns; o resto cai no
// fallback "últimas duas labels".

(function () {
  "use strict";

  const COMPOSITE_SUFFIXES = new Set([
    "co.uk", "ac.uk", "gov.uk", "org.uk", "ltd.uk", "plc.uk",
    "com.br", "net.br", "org.br", "gov.br", "edu.br",
    "com.ar", "com.au", "com.mx", "com.tr", "com.cn", "com.tw", "com.hk",
    "co.jp", "co.kr", "co.in", "co.za", "co.nz",
    "ne.jp", "or.jp",
    "ac.jp", "ac.kr", "ac.in",
    "com.sg", "edu.sg", "gov.sg",
    "github.io", "vercel.app", "netlify.app"
  ]);

  function eTLDPlus1(hostname) {
    if (!hostname) return "";
    hostname = String(hostname).toLowerCase().replace(/^\.+/, "").trim();
    if (!hostname || hostname.indexOf(".") === -1) return hostname;

    const labels = hostname.split(".");
    if (labels.length < 2) return hostname;

    const last2 = labels.slice(-2).join(".");
    const last3 = labels.slice(-3).join(".");

    if (labels.length >= 3 && COMPOSITE_SUFFIXES.has(last2)) {
      return last3;
    }
    return last2;
  }

  function isSameSite(hostA, hostB) {
    if (!hostA || !hostB) return false;
    return eTLDPlus1(hostA) === eTLDPlus1(hostB);
  }

  self.PrivacyLensETLD = { eTLDPlus1, isSameSite };
})();
