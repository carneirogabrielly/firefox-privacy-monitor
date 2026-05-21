# Metodologia do Privacy Score

Pontuação de **0 a 100** atribuída a cada página: 100 representa ausência de sinais de rastreamento e 0 representa comportamento abertamente hostil à privacidade.

A nota começa em 100 e desconta por evidência observada — não há bônus por ausência de trackers. Sinais que indicam intenção deliberada (fingerprinting, supercookies, hijacking) pesam mais que sinais volumétricos (domínios de 3ª parte, cookies). Para os volumétricos uso `sqrt(n)`, evitando que um único site extremo zere o score sozinho.

## Fórmula

```
score = 100
       − round(2 * sqrt(domínios_3p) * 1.5)
       − round(4 * sqrt(cookies_3p)  * 1.5)
       − 2  * min(cookies_3p_persistentes, 5)
       − 1  * min(chaves_storage_3p, 10)
       − 15 * canvas_fingerprint?
       − 10 * webgl_fingerprint?
       − 10 * audio_fingerprint?
       − 10 * cookie_syncing?
       − 15 * min(supercookies, 2)
       − 20 * min(sinais_hijacking, 2)
```

Resultado é truncado em `[0, 100]`.

## Pesos

| Categoria | Peso | Por quê |
|---|---|---|
| Domínio 3ª parte (sqrt) | 2 | Frequente; inclui muito uso legítimo (CDN, fonts). |
| Cookie 3ª parte (sqrt) | 4 | Rastreamento ativo, não apenas comunicação. |
| Cookie 3ª parte persistente | 2 (cap 5) | Identificador sobrevive entre sessões. |
| Chave de storage 3ª parte | 1 (cap 10) | Mesmo papel que cookie, com menos visibilidade. |
| Canvas fingerprinting | 15 | Identificação por GPU/render; raramente legítimo. |
| WebGL fingerprinting | 10 | Expõe modelo da GPU. |
| AudioContext fingerprinting | 10 | Mesmo princípio, via processamento de áudio. |
| Cookie syncing | 10 | Conluio entre redes de rastreamento. |
| Supercookie (ETag/HSTS) | 15 (cap 2) | Evasão deliberada da limpeza de cookies. |
| Sinal de hijacking | 20 (cap 2) | Comportamento abertamente malicioso. |

## Faixas

| Score | Faixa | Cor |
|---|---|---|
| 80–100 | Bom | verde |
| 50–79 | Médio | laranja |
| 0–49 | Ruim | vermelho |

## Heurísticas

**Supercookie ETag** — valor de ETag classificado como suspeito se for hex com 16+ caracteres ou base64/URL-safe com 20+. ETags curtos baseados em mtime (padrão Apache/nginx) são ignorados.

**Supercookie HSTS** — `Strict-Transport-Security` em resposta de 3ª parte conta apenas quando vem de subdomínio curto (1–3 chars), formato típico de "bucket de bits" usado por trackers.

**Cookie syncing** — `Set-Cookie` de 3ª parte cuja URL contém segmento `[A-Za-z0-9_-]{16,}` (ID opaco). Pode dar falso positivo em CSRF tokens.

**Redirect programático** — `location.href` muda sem clique ou tecla do usuário nos últimos 3 segundos.

**Hijacking** — sinais individuais:
- `pushstate-burst`: mais de 15 `pushState` em janela de 2s.
- `replacestate-abuse`: 50+ `replaceState` (técnica para apagar histórico de redirect).
- `script-from-ip`: `<script src>` apontando para IP literal — assinatura clássica de BeEF e frameworks de C2.
- `suspicious-websocket`: WebSocket para host externo em porta não padrão.
- `websocket-to-ip`: WebSocket apontando para IP literal.

`beforeunload` sozinho não conta, porque e-commerce e formulários longos usam legitimamente.

**Fingerprinting** — marcado na primeira chamada de `canvas.toDataURL`, `canvas.toBlob`, `getImageData` em área ≥ 100 px², `WebGL.getParameter` para VENDOR/RENDERER/VERSION, `WEBGL_debug_renderer_info`, ou `createOscillator`/`createDynamicsCompressor`/`createAnalyser` em `AudioContext` ou `OfflineAudioContext`.

## Limitações

- Fingerprinting é binário: uso casual de Canvas (preview de imagem) também marca a página.
- Iframes não são inspecionados — storage dentro deles passa despercebido.
- A lista interna de TLDs compostos não cobre toda a Public Suffix List.
- Não há baseline por categoria de site: blog estático e portal de notícias usam o mesmo escalonamento.
