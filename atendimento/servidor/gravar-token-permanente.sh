#!/bin/bash
# Grava o token permanente do usuário do sistema (Business Suite) como token do WhatsApp E do Instagram.
# Pede o token uma vez só; nada aparece na tela.
set -e
cd "$(dirname "$0")"
clear
echo "== Cole o TOKEN do usuario do sistema (comeca com EAA) e aperte Enter (nao aparece na tela):"
read -r -s TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
case "$TOKEN" in
  EAA*) ;;
  *) echo "Esse valor nao comeca com EAA. Nada foi gravado. Confira se copiou o token certo."; exit 1 ;;
esac
printf '%s' "$TOKEN" | npx wrangler secret put WHATSAPP_TOKEN >/dev/null 2>&1 && echo "   ✓ WHATSAPP_TOKEN salvo"
printf '%s' "$TOKEN" | npx wrangler secret put IG_TOKEN >/dev/null 2>&1 && echo "   ✓ IG_TOKEN salvo"
unset TOKEN
echo
echo "PRONTO. Volte para a conversa."
