# Atendimento Urbano Norte

Aba **Atendimento** do app unificado: as conversas do **WhatsApp** e as **mensagens diretas do Instagram** da empresa, lidas e respondidas pelo computador do escritório (menções, marcações e comentários do Instagram ficam de fora, de propósito).

- `servidor/` — fica na nuvem (Cloudflare Workers + banco D1, plano grátis). Recebe da Meta as mensagens dos clientes 24 h por dia e serve o app.
- `app/` — a aba no app desktop (copiada para `app/modulos/atendimento` pelo `montar-modulos.js`).

## O que já faz (versão 1)
- Lista de conversas (abertas / resolvidas / todas), busca por nome ou número, contador de não lidas na aba e no ícone do app, aviso do sistema quando chega mensagem com o app em segundo plano.
- WhatsApp e Instagram na mesma lista, com selo do canal (WA/IG) e filtro Todos / WhatsApp / Instagram; no Instagram aparece o @.
- Conversa com texto, fotos e áudios (aparecem e tocam na tela), vídeo/documento (abrem no programa do computador), localização, contatos e respostas a Stories (Instagram). Menções em Stories são ignoradas de propósito.
- Responder com texto; mostra quem respondeu e se foi enviada / entregue / lida / não entregue (com o motivo).
- Marca como lida no celular do cliente (dois tiques azuis) ao abrir a conversa.
- Indica a janela de 24 h do WhatsApp e bloqueia texto livre quando ela fecha.
- Resolver / reabrir conversa (se o cliente escrever de novo, ela reabre sozinha).

Ainda não: enviar fotos/arquivos/áudio, responder com modelo aprovado fora das 24 h, transferir conversa entre pessoas.

## Instagram
- Banco: rode uma vez `npx wrangler d1 execute atendimento-urbano-norte --remote --file=migracoes/001-instagram.sql` (já feito em 2026-11-25).
- Na Meta: adicionar o caso de uso de mensagens do Instagram, ligar a conta @ da empresa, gerar o token e cadastrar o mesmo webhook (`/webhook`, mesma palavra) para o objeto Instagram, campo `messages`.
- `bash configurar-instagram.sh` grava o IG_TOKEN (e IG_APP_SECRET, se a Meta mostrar uma chave própria do Instagram).
- Para receber DM de qualquer pessoa, a Meta exige análise do app (App Review) da permissão de mensagens do Instagram; antes disso, só contas com papel no app.

## Testar no próprio computador (sem Cloudflare, sem Meta)
```
cd atendimento/servidor
npm test                                   # testes do servidor
node dev.mjs --meta-falsa --chave dev      # servidor local em http://127.0.0.1:8787
curl -X POST http://127.0.0.1:8787/dev/simular -d '{"nome":"Ana","texto":"Oi!"}'   # finge um cliente
```
No app: aba Atendimento → Configurar → endereço `http://127.0.0.1:8787`, chave `dev`.
O teste visual do app (`cd app && npm run test:visual`) já faz tudo isso sozinho.

## Colocar no ar (uma vez)
Pré-requisitos: número brasileiro da empresa já na Meta (Etapa 2) e uma conta grátis na Cloudflare.

1. **Cloudflare:** crie a conta em cloudflare.com (e-mail da empresa). No terminal:
   ```
   cd atendimento/servidor
   npx wrangler login                                   # abre o navegador para autorizar
   npx wrangler d1 create atendimento-urbano-norte      # copie o database_id para o wrangler.toml
   npx wrangler d1 execute atendimento-urbano-norte --remote --file=schema.sql
   ```
2. No `wrangler.toml`, troque `PHONE_NUMBER_ID` pelo ID do número brasileiro.
3. **Segredos** (cada comando pede o valor; nada fica no código nem no GitHub):
   ```
   npx wrangler secret put APP_SECRET      # Meta: app > Configurações do app > Básico > Chave secreta do app
   npx wrangler secret put VERIFY_TOKEN    # uma palavra qualquer, combinada com a Meta no passo 5
   npx wrangler secret put WHATSAPP_TOKEN  # token PERMANENTE de usuário do sistema (Business Suite > Usuários do sistema)
   npx wrangler secret put CHAVE_APP       # senha longa para os computadores do escritório (ex.: gerada por gerenciador de senhas)
   ```
4. `npx wrangler deploy` → mostra o endereço, ex.: `https://atendimento-urbano-norte.SEU-USUARIO.workers.dev`.
5. **Meta:** app > WhatsApp > Configuração > Webhook: URL de retorno = endereço + `/webhook`, token de verificação = o VERIFY_TOKEN. Depois, em "Campos do webhook", assine **messages**.
6. **Em cada computador:** aba Atendimento → endereço do passo 4 + CHAVE_APP + nome da pessoa.

## Segurança
- Toda mensagem da Meta é conferida pela assinatura (APP_SECRET); sem ela, é recusada.
- O app só entra com a CHAVE_APP; o token do WhatsApp fica só no servidor.
- Nos computadores, endereço e chave ficam cifrados pelo sistema (Keychain no Mac, DPAPI no Windows).
