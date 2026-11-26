# Urbano Norte — app unificado (desktop)

Um app só para Windows e Mac, com abas:

- **Sorteio** — o mesmo sorteio de corridas do app "Sorteio Urbano Norte".
- **Disparo (beta)** — o mesmo disparo de campanhas do app "Disparo Urbano Norte" (ainda em modo simulação).
- **Atendimento (beta)** — conversas do WhatsApp da empresa pelo computador (ver `../atendimento/LEIA-ME.md`).

Atalhos: **Ctrl+1** / **Ctrl+2** / **Ctrl+3** (Cmd no Mac) trocam de aba. No modo vertical do sorteio (Reels/Stories) a barra de abas some.

## Como funciona por dentro

- `main.js` abre uma janela com a barra de abas (`shell/`) e uma tela separada (WebContentsView) para cada sistema,
  cada uma com o seu próprio `preload` e `window.api` — os sistemas não se misturam.
- O código de cada sistema **não é copiado à mão**: vem de `../sorteio/desktop/modulo.js` e `../disparo/src/modulo.js`.
  `npm start` e `npm run dist` rodam antes `scripts/montar-modulos.js`, que copia esses arquivos para `modulos/` (pasta ignorada pelo git).
  Uma correção no sorteio ou no disparo vale para o app próprio e para o unificado.
- Dados ficam em `<dados do app>/Urbano Norte/sorteio/` e `/disparo/`.

## Login e equipe

O app abre na tela de login (`shell/`, `conta.js`). As contas ficam no servidor do Atendimento (`../atendimento/servidor/src/contas.js`);
no computador fica só a sessão, cifrada (`conta.dat`), válida por 30 dias sem uso.
- Primeiro acesso (nenhuma conta no servidor): cria o administrador com a chave de instalação (`atendimento/servidor/nova-chave-instalacao.sh`).
- Menu com o nome (canto direito da barra): **Equipe** (só administrador: criar, desativar, nova senha, papel), **Trocar minha senha**, **Sair**.
- O nome da conta vai para o histórico do Disparo e para as respostas do Atendimento.
- O Sorteio e o Disparo funcionam no próprio computador: o login protege a entrada no app, não os arquivos do computador.
- Desenvolvimento: `URBANO_SERVIDOR=http://127.0.0.1:8787 npm start` com `node ../atendimento/servidor/dev.mjs --meta-falsa --chave dev`.

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
- Instaladores: aba **Actions → App unificado (desktop) - gerar instaladores** (rascunho para teste), ou uma tag `app-v*` (versão oficial).

## Distribuir e atualizar (Windows)

O app instalado no Windows se atualiza sozinho (`atualizacao.js`, com `electron-updater`): ao abrir e a cada hora ele consulta
a release fixa **app-latest** do GitHub; se houver versão nova, baixa em segundo plano e pergunta se pode reiniciar
("Depois" instala ao fechar o app). O **portátil** e o **Mac** não se atualizam sozinhos (no Mac exigiria certificado pago da Apple).

Para lançar uma versão:
1. Suba o número em `app/package.json` (`version`, ex.: 1.1.0 → 1.1.1), faça commit e push.
2. Crie e envie a tag igual: `git tag app-v1.1.1 && git push origin app-v1.1.1`.
3. O workflow gera os instaladores, publica a release `app-v1.1.1` e troca os arquivos da release `app-latest`.
   Em até uma hora os computadores com o app aberto baixam a versão nova.

Não apague a release `app-latest`. Se a tag não bater com a versão do `package.json`, o workflow para com erro.

Primeira instalação num computador novo: baixe `Urbano-Norte-Instalador-<versão>.exe` da release mais recente `app-v*`
(no Windows, "O Windows protegeu o computador" → **Mais informações → Executar assim mesmo**, porque o app não tem certificado pago).
Depois, a pessoa entra com o usuário e a senha que o administrador criou e escolhe a pasta compartilhada do Disparo.
