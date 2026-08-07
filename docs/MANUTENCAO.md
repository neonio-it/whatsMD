# Manutenção — quando o WhatsApp Web atualiza

A extensão lê mensagens e baixa mídias pelos **módulos internos** do WhatsApp Web, via
[`@wppconnect/wa-js`](https://www.npmjs.com/package/@wppconnect/wa-js) (arquivo `vendor/wppconnect-wa.js`).
O DOM não expõe mais os blobs de áudio, então não há alternativa por scraping.

Esses módulos são internos e mudam sem aviso. Quando o WhatsApp Web atualiza, o wa-js pode
parar de resolvê-los — `WPP.whatsapp.MsgStore` fica `undefined` e **todo `downloadMedia` falha**.
No markdown isso aparece como `[áudio não carregado]`, `[mídia não exportada]`, etc.

Aconteceu em 30/07/2026: WhatsApp Web `2.3000.1044096409` quebrou o wa-js até a `4.4.2`.
Em 07/08/2026 o WhatsApp Web atualizou para `2.3000.1044725657` **sem** quebrar o wa-js `4.5.0`
— atualização de versão nem sempre significa quebra, por isso a sonda profunda abaixo.

## Como a extensão se adapta (v1.8.0+)

A sonda de saúde é **profunda**: além de `MsgStore`/`ChatStore` (leitura de mensagens), checa os
módulos que o `downloadMedia` usa por baixo — `WPP.chat.downloadMedia`, `MediaBlobCache`,
`OpaqueData` e `MediaPrep` (campo `mediaOk`). Com isso ela distingue "atualizou mas está OK"
de "atualizou e quebrou":

| Quando | Comportamento |
|--------|---------------|
| Popup: versão mudou desde a última exportação limpa, sonda OK | Banner azul informativo: deve funcionar normalmente |
| Popup: versão mudou e a sonda de mídia falhou | Banner amarelo/vermelho: atualize o wa-js |
| Popup: módulos não resolvem | Banner vermelho + botão **"🔎 Ver se saiu wa-js novo"** |
| Exportar com wa-js quebrado | **Modo degradado automático**: scraping DOM (texto e imagens visíveis), com aviso — não recusa mais a exportação |
| Exportar com só a mídia quebrada | Exporta o texto normalmente e marca as mídias como não exportadas, sem tentar downloads que travariam |
| 3 downloads de mídia falham em sequência | Disjuntor: pula as mídias restantes (cada tentativa quebrada pode segurar 120s) e exporta o texto |
| Ao terminar uma exportação com mídias faltando | Banner amarelo com a contagem de falhas |

O botão **"Ver se saiu wa-js novo"** consulta `registry.npmjs.org/@wppconnect/wa-js/latest`
e compara com `vendor/VERSION.txt`. É um GET só de metadados, **nenhum dado do usuário ou da
conversa é enviado**, e só acontece quando você clica (privacidade primeiro).

A versão do WhatsApp Web da última exportação **sem nenhuma falha** fica salva em
`chrome.storage.local` como `lastGoodWaVersion` — é ela que serve de referência para os avisos
de "versão mudou". A sonda profunda espera até 5s pelos módulos antes de declarar quebra
(`isReady` dispara antes de tudo resolver).

## Como atualizar o wa-js

```bash
curl -sL -o wa-js.tgz https://registry.npmjs.org/@wppconnect/wa-js/-/wa-js-<VERSAO>.tgz && tar -xzf wa-js.tgz
```

Depois copie `package/dist/wppconnect-wa.js` e o `.LICENSE.txt` para `vendor/`, e atualize
`vendor/VERSION.txt` com a versão nova.

A última versão publicada está em `https://registry.npmjs.org/@wppconnect/wa-js/latest`.
O changelog fica em https://github.com/wppconnect-team/wa-js/releases — procure por
"compatibility" / a versão do WhatsApp Web citada.

## Validar

1. **Recarregue a extensão** em `chrome://extensions` (🔄). O Chrome serve os arquivos da
   extensão em cache — editar em disco não basta, e o sintoma é ficar testando código velho.
2. Dê F5 no WhatsApp Web.
3. No console da aba, confirme que os módulos resolvem:
   ```js
   typeof WPP.whatsapp.MsgStore  // 'object' = ok; 'undefined' = ainda quebrado
   ```
4. Exporte uma conversa com áudio e confirme a transcrição no `.md`.
