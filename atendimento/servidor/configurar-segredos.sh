#!/bin/bash
# Grava os 4 segredos do servidor do Atendimento na Cloudflare.
# - Inventa sozinho a VERIFY_TOKEN e a CHAVE_APP e guarda as duas num arquivo na Área de Trabalho.
# - Pede só os 2 valores que vêm da Meta (chave secreta do app e token).
# Pode rodar de novo quando quiser: cada valor é regravado por cima do anterior.
set -e
cd "$(dirname "$0")"

ARQUIVO="$HOME/Desktop/Urbano Norte - chaves do Atendimento.txt"
VERIFY_TOKEN="urbano-norte-$(openssl rand -hex 8)"
CHAVE_APP="$(openssl rand -hex 24)"

gravar() { printf '%s' "$2" | npx wrangler secret put "$1" >/dev/null 2>&1 && echo "   ✓ $1 salvo no servidor"; }

clear
echo "==============================================================="
echo " Segredos do servidor do Atendimento"
echo "==============================================================="
echo
echo "Gerando a palavra do webhook e a chave do escritório..."
gravar VERIFY_TOKEN "$VERIFY_TOKEN"
gravar CHAVE_APP "$CHAVE_APP"
umask 077
cat > "$ARQUIVO" <<EOF
Atendimento Urbano Norte — guarde este arquivo em lugar seguro (é como uma senha).

Endereço do servidor (vai no app, aba Atendimento > Configurar):
https://atendimento-urbano-norte.atendimento-urbano-norte-servidor.workers.dev

Chave de acesso (vai no app, em cada computador do escritório):
$CHAVE_APP

Webhook na Meta (WhatsApp > Configuração > Webhook):
  URL de retorno:        https://atendimento-urbano-norte.atendimento-urbano-norte-servidor.workers.dev/webhook
  Token de verificação:  $VERIFY_TOKEN
EOF
echo "   ✓ Guardados no arquivo: $ARQUIVO"
echo

pedir() {
  local nome="$1" instrucao="$2" valor=""
  while [ -z "$valor" ]; do
    echo "---------------------------------------------------------------"
    echo "$instrucao"
    read -r -s -p "Cole aqui e aperte Enter (não aparece na tela): " valor; echo
    valor="$(printf '%s' "$valor" | tr -d '[:space:]')"
  done
  gravar "$nome" "$valor"
}

pedir APP_SECRET "1 de 2 — Na Meta: Configurações do app > Básico > Chave Secreta do Aplicativo > Mostrar. Copie (32 letras e números)."
pedir WHATSAPP_TOKEN "2 de 2 — Na Meta: WhatsApp > Etapa 1. Experimente > Gerar token. Copie o token (começa com EAA)."

echo
echo "==============================================================="
echo " PRONTO: 4 segredos salvos. Pode voltar para a conversa."
echo "==============================================================="
