# WhatsMD — Design Spec

**Data:** 2026-05-21  
**Projeto:** WhatsMD — Chrome Extension  
**Objetivo:** Transformar uma conversa do WhatsApp Web em um arquivo `.md` com imagens embutidas em base64, pronto para arrastar no Claude Code.

---

## Problema

Ao querer contextualizar o Claude Code com uma conversa do WhatsApp, não existe forma nativa de exportar a conversa como markdown com imagens inline. O export padrão do WhatsApp App gera `.txt` + pasta de mídia — complexo de usar no chat de IA.

## Solução

Uma Chrome Extension (Manifest V3) que, com um clique, captura a conversa visível no WhatsApp Web e gera um `.md` com imagens em base64 embutidas, fazendo o download automático.

---

## Arquitetura

```
[WhatsApp Web Tab]
    └── content_script.js
            │ scrape DOM → mensagens + URLs de mídia
            │ chrome.runtime.sendMessage()
            ▼
[Service Worker — background.js]
            │ fetch() imagens → base64
            │ md_builder.js → renderizar .md
            │ chrome.downloads.download()
            ▼
[Download automático — conversa.md]
```

**Três camadas:**
1. **Captura** — content script lê o DOM do WhatsApp Web
2. **Processamento** — service worker baixa mídia e monta o markdown
3. **Saída** — download automático do `.md`

---

## Estrutura de Arquivos

```
whatsMD/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content_script.js
├── background.js
├── utils/
│   └── md_builder.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Componentes

### `manifest.json`
- Manifest V3
- Permissões: `activeTab`, `downloads`, `scripting`
- Host permission: `https://web.whatsapp.com/*`

### `popup/popup.html` + `popup.js`
- Botão "Exportar conversa"
- Indicador de status (carregando / concluído / erro)
- Ao clicar: `chrome.scripting.executeScript` injeta e aciona o content script na aba ativa

### `content_script.js`
- Verifica se está em `web.whatsapp.com` com chat aberto
- Varre elementos `[data-id]` — seletores de mensagem do WhatsApp Web
- Extrai por mensagem: remetente, timestamp, texto, URLs de imagens/stickers/documentos
- Envia array de mensagens via `chrome.runtime.sendMessage` ao background

### `background.js` (Service Worker)
- Recebe array de mensagens do content script
- Para cada URL de mídia: `fetch()` → `ArrayBuffer` → base64
- Imagens com falha no fetch: substituídas por placeholder `![mídia indisponível]()`
- Processa em batches de 50 mensagens para não travar
- Chama `md_builder.js` para montar o `.md`
- Executa `chrome.downloads.download()` com o arquivo gerado

### `utils/md_builder.js`
- Funções puras (sem side effects)
- `buildMarkdown(messages, metadata)` → string markdown
- `formatMessage(msg)` → linha formatada individual

---

## Formato do `.md` Gerado

```markdown
# Conversa: João Silva
Exportado em: 2026-05-21 às 14:32
Total de mensagens: 47

---

**João Silva** · 14:30
Olha essa imagem aqui

![imagem_001](data:image/jpeg;base64,/9j/4AAQ...)

**Você** · 14:31
Perfeito!

**João Silva** · 14:32
👍
```

---

## Error Handling

| Situação | Comportamento |
|----------|--------------|
| Não está no WhatsApp Web | Popup mostra "Abra o WhatsApp Web primeiro" |
| Nenhum chat selecionado | Popup mostra "Selecione uma conversa" |
| URL de mídia expirada/inacessível | Substituída por `![mídia indisponível]()`, exportação continua |
| Conversa muito longa | Processada em batches de 50, barra de progresso no popup |

---

## Verificação

1. Instalar em modo desenvolvedor: `chrome://extensions` → "Carregar sem compactação" → selecionar pasta `whatsMD/`
2. Abrir `web.whatsapp.com`, selecionar conversa com imagens
3. Clicar no ícone da extensão → "Exportar conversa"
4. Confirmar download do `.md`
5. Arrastar o `.md` no Claude Code e verificar que imagens renderizam inline

---

## Fora do Escopo (v1)

- Vídeos (apenas imagens e stickers)
- Seleção de intervalo de mensagens
- Exportação de grupos (funciona, mas sem otimizações especiais)
- Auto-scroll para carregar histórico mais antigo
