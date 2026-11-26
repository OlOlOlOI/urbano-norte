#!/bin/bash
# Liga o Instagram (mensagens diretas) ao servidor do Atendimento.
# Pede o token do Instagram e, se o app do Instagram tiver chave secreta própria, ela também.
set -e
cd "$(dirname "$0")"
gravar() { printf '%s' "$2" | npx wrangler secret put "$1" >/dev/null 2>&1 && echo "   ✓ $1 salvo no servidor"; }
pedir() {
  local nome="$1" instrucao="$2" opcional="$3" valor=""
  echo "---------------------------------------------------------------"
  echo "$instrucao"
  read -r -s -p "Cole aqui e aperte Enter (não aparece na tela)${opcional:+; Enter vazio pula}: " valor; echo
  valor="$(printf '%s' "$valor" | tr -d '[:space:]')"
  if [ -n "$valor" ]; then gravar "$nome" "$valor"; elif [ -z "$opcional" ]; then echo "   (vazio: nada foi gravado)"; fi
}
clear
echo "==============================================================="
echo " Instagram no Atendimento"
echo "==============================================================="
pedir IG_TOKEN "1 de 2 — Na Meta: caso de uso do Instagram > Configuração da API > Gerar token da conta @urbanorioverde. Copie o token."
pedir IG_APP_SECRET "2 de 2 — SÓ se a Meta mostrar uma 'Chave secreta do app do Instagram' diferente da chave do app. Senão, só aperte Enter." opcional
echo
echo "PRONTO. Volte para a conversa."
