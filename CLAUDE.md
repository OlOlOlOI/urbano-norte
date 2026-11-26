# Urbano Norte — monorepo de sistemas

Empresa: Urbano Norte (transporte por aplicativo, Rio Verde-GO). Idioma de todos os apps e da documentação: português do Brasil.
Marca: grafite #414042, verde-escuro #007a43, verde #00a651, lima #68c52f, carvão #2b2a2c, fundo claro #f1f4f1. Fonte: Outfit.

## Sistemas

- `sorteio/` — sorteio de corridas (web PWA + desktop Electron). Contexto e regras em `sorteio/CLAUDE.md`.
- `disparo/` — disparo de campanhas por WhatsApp (desktop Electron, modo simulação). Contexto em `disparo/README.md`.
- `atendimento/` — atendimento pelo WhatsApp e direct do Instagram: `servidor/` (Cloudflare Worker + D1, recebe o webhook da Meta) e `app/` (aba no app). Contexto em `atendimento/LEIA-ME.md`.
- `app/` — app desktop unificado (Sorteio + Disparo + Atendimento em abas). Contexto em `app/LEIA-ME.md`.

Cada sistema é independente (seu próprio `package.json`); comandos `npm` rodam dentro da pasta do sistema.
Workflows ficam em `.github/workflows/`, com o nome do sistema como prefixo; tags de versão usam o prefixo (`sorteio-v*`, `disparo-v*`, `app-v*`).

## App unificado (`app/`)

Um app desktop só, com abas "Sorteio", "Disparo (beta)" e "Atendimento (beta)" (detalhes em `app/LEIA-ME.md`). A versão web continua só com o sorteio.
- Cada aba é uma WebContentsView com seu próprio preload/`window.api`; o processo principal de cada sistema está em
  `sorteio/desktop/modulo.js`, `disparo/src/modulo.js` e `atendimento/app/modulo.js` (função `registrar(opcoes)`), usados tanto pelo app próprio quanto pelo unificado.
- `app/modulos/` é gerado por `app/scripts/montar-modulos.js` — nunca editar lá.
- Dados em `userData/sorteio` e `userData/disparo`. `app/migracao.js` copia uma vez os dados dos apps antigos.
  O cofre `contatos.dat` (safeStorage) não migra: a chave é presa ao app antigo.
- Os apps próprios (`sorteio/desktop`, `disparo`) continuam existindo até todos migrarem.
- Pendente: escolher uma só biblioteca de planilha (sorteio usa `xlsx`, disparo usa `exceljs`); ícone próprio do app (hoje usa o do sorteio).

## Origem

Criado em 2026-11-25 a partir dos repositórios `OlOlOlOI/sorteio-urbano-norte` e `OlOlOlOI/disparo-de-mensagem` (histórico antigo não foi trazido; consulte os repositórios originais).

## WhatsApp (Meta) — o que já se sabe
- App na Meta: "Disparo Urbano Norte", portfólio "Urbano Norte Rio Verde" (não verificado). Graph API v27.0.
- O número de teste da Meta (+1) NÃO entrega no Brasil (erro 130497: restrição da Meta a envio de outro país para o Brasil). É preciso um número brasileiro da empresa (Etapa 2). Desde 2026-11-26 o número real é +55 64 99905-1127 (eSIM Vivo Easy Lite, linha "URBANO NORTE SUPORTE" no iPhone do Rayan; não instalar WhatsApp nele; manter a assinatura ativa). WABA nova "Urbano Norte Rio Verde" 1789237192189564, PHONE_NUMBER_ID 1501978266325095 (AtendimentoUN tem acesso total). A WABA de teste 1146655898265244 ficou só com o +1.
- O WhatsApp guarda celulares brasileiros sem o 9 extra (wa_id 5564XXXXXXXX); a tela mostra com o 9.
- Campanhas do Disparo: simulação por padrão; envio real se ligado em Configurações (por computador) e SÓ com mensagem aprovada pela Meta (modelo/template criado pelo próprio Disparo em "Aprovar na Meta", `src/core/modelo-meta.js`; a variável {{nome}} vira {{1}}). A conta (WABA) é descoberta pelo debug_token do token. Cartão cadastrado na WABA em 2026-11-26. Mensagens com imagem no topo, formatação, rodapé e botões (link e "Não quero receber", payload SAIR_UN → tabela descadastros no servidor, que o Disparo puxa antes de enviar). Falhas que a Meta avisa depois do envio (webhook) ainda não voltam para o Disparo.
- Instagram no Atendimento: só mensagens diretas (decisão do dono: sem menções/marcações/comentários; menções em Stories que chegam pelo direct também são ignoradas no servidor). Conversas do Instagram usam id `ig_<IGSID>` e canal `instagram`; envio por graph.instagram.com com IG_TOKEN.
- Login no app (desde a v1.2.0): contas por pessoa no servidor do Atendimento (D1, tabelas usuarios/sessoes, `src/contas.js`); papéis admin e atendente; Rayan é o administrador. A CHAVE_APP só cria o primeiro admin. O app fala com o servidor da empresa por padrão (`app/conta.js`, URBANO_SERVIDOR para testes).
- Token do servidor (WHATSAPP_TOKEN e IG_TOKEN): token PERMANENTE do usuário do sistema "AtendimentoUN" (Business Suite, função Employee — Admin só depois de 7 dias como admin do portfólio). Ativos: Página Urbano Norte Rio Verde, Instagram urbanorioverde, WhatsApp e app, com acesso total. Gravar com `atendimento/servidor/gravar-token-permanente.sh`.
- Instagram com token do Facebook (EAA…): as DMs chegam pela Página do Facebook ligada à conta; a Página precisa assinar o app (o "Conferir ligação" faz isso) e o token precisa de `pages_messaging` — que só aparece com o caso de uso "Messenger" adicionado ao app (adicionado só por isso; o Messenger não é atendido). Perfil, resposta e "visto" usam o token da Página (o servidor busca sozinho).
- Para receber DM de qualquer cliente no Instagram ainda falta a análise da Meta (App Review) das permissões de mensagens; hoje funciona com contas testadoras (@_rayanluiz.kk).
