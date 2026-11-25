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

## Falta para o envio real
Ligar a API oficial do WhatsApp (Meta). O ponto de ligação é `src/core/provider-sim.js`: um provedor real precisa só do método `enviar({telefone, texto, campanha})`.
