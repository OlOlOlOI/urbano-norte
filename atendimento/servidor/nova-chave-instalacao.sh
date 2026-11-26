#!/bin/bash
# Gera uma CHAVE_APP nova (chave de instalação), grava no servidor e mostra SÓ nesta tela.
# Ela serve apenas para criar o primeiro administrador no app (tela "Primeiro acesso").
# Depois que o administrador existe, a chave não abre mais nada.
set -e
cd "$(dirname "$0")"
CHAVE="$(openssl rand -hex 16)"
printf '%s' "$CHAVE" | npx wrangler secret put CHAVE_APP >/dev/null 2>&1
echo
echo "Chave de instalação gravada no servidor. Copie e cole na tela 'Primeiro acesso' do app:"
echo
echo "    $CHAVE"
echo
echo "Não mande esta chave por mensagem. Depois de criar o administrador, ela não serve para mais nada."
unset CHAVE
