# Disparo Urbano Norte

App desktop (Windows e Mac) para campanhas de WhatsApp. **Versão atual: modo simulação** (nada é enviado de verdade).

## Primeiro uso (em cada computador, 1 vez)
1. Instale o app e abra **Ajustes**.
2. **Pasta compartilhada:** escolha a MESMA pasta nos 4 computadores (Google Drive para computador, OneDrive etc.).
3. **Seu nome:** use um nome diferente em cada computador (ex.: Rayan, Chefe 1...).
4. Em quem configura primeiro: aba **Planilha** → escolher arquivo → escolher colunas; aba **Mensagens** → criar modelo. Os outros já veem tudo.

## Atualizar a planilha
Substitua o arquivo na pasta compartilhada, **com o mesmo nome**. O app confere a cada 15 s e avisa quando mudou.

## O que é compartilhado
Planilha, colunas, modelos, limites, descadastros e histórico de envios. Cada pessoa grava só no próprio arquivo (`envios-<nome>.jsonl`, `descadastros-<nome>.jsonl`), então não há conflito. Quem recebeu uma campanha não recebe de novo, mesmo que outra pessoa dispare.

## Gerar os instaladores
Rode a ação **Disparo (desktop) - gerar instaladores** na aba Actions do monorepo `urbano-norte` (ou crie uma tag `disparo-v*`). Baixe o `.exe` e o `.dmg` nos artefatos.
Sem certificado de desenvolvedor: o Windows mostra "SmartScreen" (Mais informações > Executar assim mesmo) e o Mac pede clique direito > Abrir.

## Testes
Dentro da pasta `disparo/`: `npm install` e `npm test` (núcleo). `npm start` abre o app.

## WhatsApp de verdade (API oficial da Meta)
Em **Configurações → WhatsApp (API oficial da Meta)** cada computador cola o *ID do número de telefone* e o *token de acesso* do painel da Meta, mais o número de quem vai testar.
O token fica cifrado só naquele computador (nunca vai para a pasta compartilhada). O app confere com a Meta antes de salvar.

Por enquanto só existe o **teste no próprio número** (texto livre ou o modelo `hello_world`). As campanhas continuam em modo simulação.

O provedor real está em `src/core/provider-meta.js` (Graph API v27.0). Falta para ligar as campanhas:
- modelos (templates) aprovados pela Meta — fora da janela de 24 h o WhatsApp só aceita modelos;
- número próprio da empresa verificado (o número de teste da Meta só envia para até 5 números cadastrados);
- token permanente (usuário do sistema), pois o do painel vence em 24 h.
