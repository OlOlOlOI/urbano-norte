'use strict';

const RE = /\{\{\s*([a-zA-Z_]\w*)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Substitui {{variavel}} e {{variavel|texto padrão}}.
 * Sem valor e sem padrão, a variável vira texto vazio (e espaços sobrando são limpos).
 */
function renderizar(corpo, vars = {}) {
  const out = String(corpo || '').replace(RE, (_, nome, padrao) => {
    const v = vars[nome];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    return padrao !== undefined ? padrao.trim() : '';
  });
  return out.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Lista as variáveis usadas, para avisar sobre nomes desconhecidos. */
function variaveisUsadas(corpo) {
  const s = new Set();
  for (const m of String(corpo || '').matchAll(RE)) s.add(m[1]);
  return [...s];
}

module.exports = { renderizar, variaveisUsadas };
