# Privacy Lens

Extensão Firefox pque detecta vetores de rastreamento e violação de privacidade em páginas web e calcula um score consolidado.

O que a extensão observa:

- domínios de terceira parte contactados, com tipo de recurso
- cookies por aba (1ª/3ª parte, sessão/persistente) e supercookies via ETag e HSTS
- `localStorage`, `sessionStorage` e `IndexedDB`
- chamadas a Canvas, WebGL e AudioContext (fingerprinting)
- cookie syncing entre domínios
- sinais de hijacking (redirect sem clique, pushState em rajada, script vindo de IP literal, WebSocket suspeito)

A metodologia fica em [`docs/PRIVACY_SCORE.md`](docs/PRIVACY_SCORE.md).

## Estrutura

```
firefox-privacy-monitor/
├── manifest.json
├── background/background.js   webRequest, cookies, agregação por aba
├── content/
│   ├── content.js             roda na página, lê storage, repassa eventos
│   └── injector.js            roda no contexto da página, hookia APIs
├── popup/                     UI do clique no ícone
├── lib/
│   ├── etld.js                eTLD+1 para 1ª vs 3ª parte
│   └── score.js               cálculo do Privacy Score
├── icons/icon-48.png
└── docs/PRIVACY_SCORE.md
```

## Instalação

1. Abra `about:debugging#/runtime/this-firefox` no Firefox.
2. Clique em **Carregar extensão temporária**.
3. Selecione `manifest.json` desta pasta.

A extensão fica carregada até o Firefox fechar. Para aplicar edições de código, use **Recarregar** na mesma página.

## Uso

Navegue para qualquer site e clique no ícone **PL**. O popup mostra o Privacy Score e seis abas com o detalhamento: Resumo, 3ª parte, Cookies, Storage, Fingerprint e Hijack. O botão **Resetar dados desta aba** limpa o estado coletado.

Para testar:

- `amiunique.org` — clique em "See My Fingerprint" para disparar Canvas/WebGL/Audio.
- `uol.com.br` ou outro portal de notícias — muitos domínios de 3ª parte e cookies.
- `example.com` — controle, score próximo de 100.

## Depuração

- **Background:** `about:debugging` → botão **Inspecionar**.
- **Content script:** F12 na página, no console troque o contexto de "Top" para "Privacy Lens".

## Limitações

- O parser de eTLD+1 cobre só os sufixos compostos mais comuns; sites em TLDs nacionais menos usados podem ser mal classificados como 3ª parte.
- Cookie syncing usa heurística sobre IDs longos em URLs e pode dar falso positivo com tokens CSRF.
- O content script roda apenas no top frame, então storage dentro de iframes não é inspecionado.
- A extensão observa, não bloqueia.
