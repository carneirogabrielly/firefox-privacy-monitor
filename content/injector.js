(function () {
  "use strict";

  function fire(type, method) {
    try {
      window.dispatchEvent(new CustomEvent("privacy-lens-fp", {
        detail: { type, method }
      }));
    } catch {}
  }

  function fireHijack(reason, detail) {
    try {
      window.dispatchEvent(new CustomEvent("privacy-lens-hijack", {
        detail: { reason, detail }
      }));
    } catch {}
  }

  // Canvas
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      fire("canvas", "toDataURL");
      return origToDataURL.apply(this, args);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    if (origToBlob) {
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        fire("canvas", "toBlob");
        return origToBlob.apply(this, args);
      };
    }

    const ctxProto = CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    if (ctxProto && ctxProto.getImageData) {
      const orig = ctxProto.getImageData;
      ctxProto.getImageData = function (...args) {
        // só sinaliza se a área lida é grande o suficiente (heurística contra falsos positivos)
        const w = args[2] || 0, h = args[3] || 0;
        if (w * h >= 100) fire("canvas", "getImageData");
        return orig.apply(this, args);
      };
    }
  } catch (e) { /* ignore */ }

  // WebGL
  try {
    function hookWebGL(proto) {
      if (!proto || !proto.getParameter) return;
      const orig = proto.getParameter;
      proto.getParameter = function (param) {
        // 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL
        // 7937 = VERSION, 7938 = RENDERER, 7936 = VENDOR
        if (param === 37445 || param === 37446 || param === 7937 || param === 7938 || param === 7936) {
          fire("webgl", "getParameter(" + param + ")");
        }
        return orig.call(this, param);
      };
      if (proto.getExtension) {
        const origExt = proto.getExtension;
        proto.getExtension = function (name) {
          if (name === "WEBGL_debug_renderer_info") {
            fire("webgl", "getExtension(WEBGL_debug_renderer_info)");
          }
          return origExt.call(this, name);
        };
      }
    }
    if (typeof WebGLRenderingContext !== "undefined") hookWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== "undefined") hookWebGL(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // AudioContext
  try {
    function hookAudio(Ctor) {
      if (!Ctor || !Ctor.prototype) return;
      const proto = Ctor.prototype;
      if (proto.createOscillator) {
        const orig = proto.createOscillator;
        proto.createOscillator = function (...args) {
          fire("audio", "createOscillator");
          return orig.apply(this, args);
        };
      }
      if (proto.createDynamicsCompressor) {
        const orig = proto.createDynamicsCompressor;
        proto.createDynamicsCompressor = function (...args) {
          fire("audio", "createDynamicsCompressor");
          return orig.apply(this, args);
        };
      }
      if (proto.createAnalyser) {
        const orig = proto.createAnalyser;
        proto.createAnalyser = function (...args) {
          fire("audio", "createAnalyser");
          return orig.apply(this, args);
        };
      }
    }
    if (typeof AudioContext !== "undefined") hookAudio(AudioContext);
    if (typeof OfflineAudioContext !== "undefined") hookAudio(OfflineAudioContext);
    if (typeof webkitAudioContext !== "undefined") hookAudio(webkitAudioContext);
  } catch (e) {}

  // Hijack
  try {
    // pushState em rajada: muitas chamadas em janela curta = tentativa de
    // mascarar URL/histórico. SPA normal espalha pushState ao longo do tempo.
    let pushTimes = [];
    let pushAlerted = false;
    const origPush = history.pushState;
    history.pushState = function (...args) {
      const now = Date.now();
      pushTimes.push(now);
      pushTimes = pushTimes.filter(t => now - t < 2000);  // janela 2s
      if (pushTimes.length > 15 && !pushAlerted) {
        pushAlerted = true;
        fireHijack("pushstate-burst", { count: pushTimes.length, windowMs: 2000 });
      }
      return origPush.apply(this, args);
    };

    // history.replaceState repetido: técnica para esconder redirect
    let replaceCount = 0;
    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      replaceCount++;
      if (replaceCount === 50) {
        fireHijack("replacestate-abuse", { count: replaceCount });
      }
      return origReplace.apply(this, args);
    };

    // Script tag carregada de IP direto = assinatura clássica de BeEF/C2.
    // Servidores legítimos quase nunca servem JS por IP — usam DNS.
    const ipRe = /^(?:https?:)?\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\//i;
    function inspectScriptNode(node) {
      try {
        if (node && node.tagName === "SCRIPT" && node.src && ipRe.test(node.src)) {
          fireHijack("script-from-ip", { src: String(node.src).slice(0, 200) });
        }
      } catch {}
    }

    // Observa scripts adicionados dinamicamente após o load
    try {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.tagName === "SCRIPT") inspectScriptNode(n);
            else if (n.querySelectorAll) {
              n.querySelectorAll("script[src]").forEach(inspectScriptNode);
            }
          }
        }
      });
      // espera o DOM existir
      const start = () => mo.observe(document.documentElement, { childList: true, subtree: true });
      if (document.documentElement) start();
      else document.addEventListener("DOMContentLoaded", start, { once: true });
    } catch {}

    // WebSocket para host externo em porta não padrão
    // (assinatura típica de C2; o tráfego web normal usa 443)
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      window.WebSocket = function (url, protocols) {
        try {
          const u = new URL(url, location.href);
          if (u.hostname !== location.hostname &&
              (u.port && !["443", "80", ""].includes(u.port))) {
            fireHijack("suspicious-websocket", { url: String(url).slice(0, 200) });
          }
          if (ipRe.test(String(url))) {
            fireHijack("websocket-to-ip", { url: String(url).slice(0, 200) });
          }
        } catch {}
        return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
      };
      window.WebSocket.prototype = OrigWS.prototype;
      window.WebSocket.CONNECTING = OrigWS.CONNECTING;
      window.WebSocket.OPEN = OrigWS.OPEN;
      window.WebSocket.CLOSING = OrigWS.CLOSING;
      window.WebSocket.CLOSED = OrigWS.CLOSED;
    }
  } catch (e) {}
})();
