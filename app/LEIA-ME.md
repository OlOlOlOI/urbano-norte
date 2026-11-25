# Urbano Norte — app unificado (desktop)

Um app só para Windows e Mac, com abas:

- **Sorteio** — o mesmo sorteio de corridas do app "Sorteio Urbano Norte".
- **Disparo (beta)** — o mesmo disparo de campanhas do app "Disparo Urbano Norte" (ainda em modo simulação).

Atalhos: **Ctrl+1** / **Ctrl+2** (Cmd no Mac) trocam de aba. No modo vertical do sorteio (Reels/Stories) a barra de abas some.

## Como funciona por dentro

- `main.js` abre uma janela com a barra de abas (`shell/`) e uma tela separada (WebContentsView) para cada sistema,
  cada uma com o seu próprio `preload` e `window.api` — os sistemas não se misturam.
- O código de cada sistema **não é copiado à mão**: vem de `../sorteio/desktop/modulo.js` e `../disparo/src/modulo.js`.
  `npm start` e `npm run dist` rodam antes `scripts/montar-modulos.js`, que copia esses arquivos para `modulos/` (pasta ignorada pelo git).
  Uma correção no sorteio ou no disparo vale para o app próprio e para o unificado.
- Dados ficam em `<dados do app>/Urbano Norte/sorteio/` e `/disparo/`.

## Dados dos apps antigos

Na primeira vez que abre, o app copia (sem apagar nada) dos apps antigos:

- Sorteio: histórico, personalização (nome, logo, cores) e pasta de saída.
- Disparo: pasta compartilhada e nome de quem usa — então já abre configurado.

**Os telefones/e-mails guardados dos sorteios antigos não vêm junto**: eles são cifrados pelo sistema com uma chave presa ao app antigo.
Eles continuam no app "Sorteio Urbano Norte" antigo. Antes de desinstalá-lo, use **Salvar em Excel (com contato)** nele.
Para sorteios feitos no app novo isso não muda nada.

## Comandos (dentro de `app/`)

- `npm install` — uma vez.
- `npm start` — abre o app.
- `npm test` — testes da migração.
- `npm run test:visual` — abre o app com dados temporários, confere as abas e o modo vertical e salva capturas de tela.
- Instaladores: aba **Actions → App unificado (desktop) - gerar instaladores**, ou uma tag `app-v*`.
