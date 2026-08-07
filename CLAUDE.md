# CLAUDE.md — whatsMD

Extensão Chrome (**Manifest V3**) que exporta conversas do WhatsApp Web para Markdown (`.md`).

## Convenções

- **Código, comentários, commits e respostas em português (pt-BR).**
- JavaScript **vanilla, sem build step** — toda mudança precisa funcionar ao recarregar a extensão descompactada (`chrome://extensions` → "Carregar sem compactação").
- Estrutura MV3: `background.js` (service worker) · `content_script.js` + `capture_main.js` (página do WhatsApp Web) · `popup/` (UI) · `relay.js` · `utils/` · `vendor/` (dependências vendorizadas, ex. wa-js) · `server/` (serviço auxiliar opcional em Python/Docker).
- **wa-js vendorizado:** quando o WhatsApp Web atualiza, a integração pode quebrar — desde a v1.7.0 a extensão detecta e avisa. Ao mexer em `vendor/`, testar captura de conversa real antes de versionar.
- **Privacidade primeiro:** as conversas são do usuário e são processadas localmente. Nunca adicionar telemetria, analytics ou envio de conteúdo a servidores sem opt-in explícito e documentado.
- Não logar conteúdo de mensagens nem dados pessoais em `console.log` de produção.

## Testar

1. Carregar a pasta como extensão descompactada em `chrome://extensions`.
2. Abrir o WhatsApp Web, exportar uma conversa de teste e conferir o `.md` gerado.
3. Após mudança no `manifest.json` ou no service worker, recarregar a extensão inteira.
