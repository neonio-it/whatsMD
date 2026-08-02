# Manutenção — quando o WhatsApp Web atualiza

A extensão lê mensagens e baixa mídias pelos **módulos internos** do WhatsApp Web, via
[`@wppconnect/wa-js`](https://www.npmjs.com/package/@wppconnect/wa-js) (arquivo `vendor/wppconnect-wa.js`).
O DOM não expõe mais os blobs de áudio, então não há alternativa por scraping.

Esses módulos são internos e mudam sem aviso. Quando o WhatsApp Web atualiza, o wa-js pode
parar de resolvê-los — `WPP.whatsapp.MsgStore` fica `undefined` e **todo `downloadMedia` falha**.
No markdown isso aparece como `[áudio não carregado]`, `[mídia não exportada]`, etc.

Aconteceu em 30/07/2026: WhatsApp Web `2.3000.1044096409` quebrou o wa-js até a `4.4.2`.

## Como a extensão avisa (v1.7.0+)

| Quando | Aviso |
|--------|-------|
| Ao abrir o popup, se os módulos não resolvem | Banner vermelho: wa-js incompatível, mídias não vão baixar |
| Ao abrir o popup, se a versão do WhatsApp Web mudou desde a última exportação limpa | Banner amarelo: pode ter quebrado, fique de olho |
| Ao terminar uma exportação com mídias faltando | Banner amarelo com a contagem de falhas |
| Ao tentar exportar com os módulos quebrados | Erro explicativo, sem gerar `.md` capenga |

A versão do WhatsApp Web da última exportação **sem nenhuma falha** fica salva em
`chrome.storage.local` como `lastGoodWaVersion` — é ela que serve de referência para o aviso amarelo.

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
