'use strict';

const { normalizarTelefone } = require('./phone');

const VERDADEIROS = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes', 'y', 'aceito', 'aceitou', 'ok']);

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function ehAceite(valor) {
  return VERDADEIROS.has(semAcento(valor).trim().toLowerCase());
}

/** "MARIA DA SILVA" -> "Maria". Vazio se não houver nome utilizável. */
function primeiroNome(nomeCompleto) {
  const t = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
  if (!/\p{L}/u.test(t)) return '';
  return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * Monta o público a partir das linhas da planilha.
 *
 * @param {Array<object>} linhas
 * @param {{nome?:string, telefone:string, aceite?:string}} mapa  colunas escolhidas
 * @param {object} opcoes
 * @param {Set<string>} [opcoes.descadastrados]  telefones E.164 que não podem receber
 * @param {Set<string>} [opcoes.jaEnviados]      telefones E.164 já enviados nesta campanha
 * @param {boolean} [opcoes.exigirAceite=true]   se true e houver coluna de aceite, só passa quem aceitou
 */
function montarPublico(linhas, mapa, opcoes = {}) {
  const descad = opcoes.descadastrados || new Set();
  const jaEnv = opcoes.jaEnviados || new Set();
  const usarAceite = Boolean(mapa.aceite) && opcoes.exigirAceite !== false;

  const stats = {
    linhas: linhas.length,
    semTelefone: 0,
    telefoneInvalido: 0,
    duplicados: 0,
    semAceite: 0,
    descadastrados: 0,
    jaEnviados: 0,
    corrigidos: 0,
    aptos: 0,
  };
  const destinatarios = [];
  const rejeitados = []; // { linha, valor, motivo } (limitado)
  const vistos = new Set();

  const rejeitar = (linha, valor, motivo) => {
    if (rejeitados.length < 500) rejeitados.push({ linha, valor, motivo });
  };

  linhas.forEach((row, i) => {
    const numLinha = i + 2; // +1 cabeçalho, +1 base 1
    const bruto = row[mapa.telefone];
    if (!String(bruto ?? '').trim()) { stats.semTelefone++; rejeitar(numLinha, '', 'sem telefone'); return; }

    const tel = normalizarTelefone(bruto);
    if (!tel.ok) { stats.telefoneInvalido++; rejeitar(numLinha, bruto, tel.motivo); return; }

    if (usarAceite && !ehAceite(row[mapa.aceite])) {
      stats.semAceite++; rejeitar(numLinha, tel.e164, 'sem aceite'); return;
    }
    if (descad.has(tel.e164)) { stats.descadastrados++; rejeitar(numLinha, tel.e164, 'descadastrado'); return; }
    if (vistos.has(tel.e164)) { stats.duplicados++; rejeitar(numLinha, tel.e164, 'duplicado'); return; }
    vistos.add(tel.e164);
    if (jaEnv.has(tel.e164)) { stats.jaEnviados++; rejeitar(numLinha, tel.e164, 'já recebeu esta campanha'); return; }

    if (tel.corrigido) stats.corrigidos++;
    destinatarios.push({
      linha: numLinha,
      telefone: tel.e164,
      nome: mapa.nome ? primeiroNome(row[mapa.nome]) : '',
      nomeCompleto: mapa.nome ? String(row[mapa.nome] || '').trim() : '',
    });
  });

  stats.aptos = destinatarios.length;
  return { destinatarios, rejeitados, stats, usouAceite: usarAceite };
}

module.exports = { montarPublico, ehAceite, primeiroNome };
