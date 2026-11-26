'use strict';

/**
 * Converte as mensagens do Disparo para MODELOS da Meta (templates) e de volta.
 *
 * Por que: o WhatsApp só deixa a empresa iniciar conversa (mandar para quem não escreveu
 * nas últimas 24 h) com um modelo aprovado pela Meta. No modelo, as variáveis viram {{1}}, {{2}}...
 * e cada envio manda os valores na mesma ordem.
 *
 * No Disparo a pessoa escreve "Olá, {{nome|passageiro}}!" — aqui vira "Olá, {{1}}!" com o
 * exemplo "Maria" (a Meta exige exemplo) e, no envio, o valor do nome (ou "passageiro").
 */

const RE = /\{\{\s*([a-zA-Z_]\w*)\s*(?:\|([^}]*))?\}\}/g;
const VARIAVEIS_ACEITAS = { nome: 'Maria' }; // variável -> exemplo que vai para a Meta

/** Categorias que a empresa usa, com o custo aproximado por mensagem entregue no Brasil (nov/2026). */
const CATEGORIAS = {
  MARKETING: { rotulo: 'Promoção ou novidade', custo: 0.3217 },
  UTILITY: { rotulo: 'Aviso de serviço (corrida, cadastro, pagamento)', custo: 0.035 },
};

/**
 * @param {string} corpo texto do Disparo
 * @returns {{ ok: true, texto: string, variaveis: Array<{nome: string, padrao: string}>, exemplos: string[] } | { ok: false, erro: string }}
 */
function paraModeloMeta(corpo) {
  const original = String(corpo || '').trim();
  if (!original) return { ok: false, erro: 'Escreva o texto da mensagem.' };
  if (original.length > 1024) return { ok: false, erro: `A Meta aceita até 1024 caracteres; esta mensagem tem ${original.length}.` };

  const variaveis = [];
  const desconhecidas = new Set();
  const texto = original.replace(RE, (_, nome, padrao) => {
    if (!(nome in VARIAVEIS_ACEITAS)) { desconhecidas.add(nome); return _; }
    variaveis.push({ nome, padrao: (padrao || '').trim() });
    return `{{${variaveis.length}}}`;
  });
  if (desconhecidas.size) return { ok: false, erro: `A Meta só aceita o nome da pessoa como variável. Tire: ${[...desconhecidas].map((v) => `{{${v}}}`).join(', ')}.` };
  if (/^\{\{\d+\}\}/.test(texto)) return { ok: false, erro: 'A Meta não aceita mensagem que começa com o nome da pessoa. Comece com uma palavra, ex.: "Olá, {{nome}}!".' };
  if (/\{\{\d+\}\}[\s.!?…,;:]*$/.test(texto)) return { ok: false, erro: 'A Meta não aceita mensagem que termina com o nome da pessoa. Acrescente algo depois, ex.: "... Até logo!".' };
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(texto)) return { ok: false, erro: 'Duas variáveis seguidas não são aceitas pela Meta. Coloque texto entre elas.' };
  return { ok: true, texto, variaveis, exemplos: variaveis.map((v) => VARIAVEIS_ACEITAS[v.nome]) };
}

/** Valores de {{1}}, {{2}}... para um destinatário. A Meta recusa parâmetro vazio, com quebra de linha ou tab. */
function parametrosPara(corpo, vars = {}) {
  const m = paraModeloMeta(corpo);
  if (!m.ok) throw new Error(m.erro);
  return m.variaveis.map((v) => {
    const bruto = vars[v.nome] !== undefined && vars[v.nome] !== null && String(vars[v.nome]).trim() !== '' ? vars[v.nome] : (v.padrao || 'cliente');
    return String(bruto).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 60);
  });
}

/**
 * Nome técnico do modelo na Meta: minúsculas, números e _ (máx. 512).
 * Leva um sufixo de data para nunca colidir com um modelo antigo (a Meta não deixa reaproveitar nome apagado por 30 dias).
 */
function nomeTecnico(nome, agora = Date.now()) {
  const base = String(nome || 'mensagem').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mensagem';
  return `un_${base}_${agora.toString(36)}`;
}

/** O texto salvo ainda é o mesmo que foi para a Meta? (se editou depois, precisa aprovar de novo) */
function mesmoTexto(corpo, meta) {
  if (!meta || !meta.texto) return false;
  const m = paraModeloMeta(corpo);
  return m.ok && m.texto === meta.texto;
}

/** Situação do modelo em português, para a tela. */
function situacao(meta, corpo) {
  if (!meta || !meta.nome) return { codigo: 'sem', texto: 'Ainda não enviada para aprovação da Meta' };
  if (corpo !== undefined && (meta.corpoEnviado !== undefined ? meta.corpoEnviado !== corpo : !mesmoTexto(corpo, meta))) return { codigo: 'mudou', texto: 'O texto mudou depois de ir para a Meta: envie para aprovação de novo' };
  const s = String(meta.status || '').toUpperCase();
  if (s === 'APPROVED') return { codigo: 'aprovado', texto: 'Aprovada pela Meta' };
  if (s === 'PENDING' || s === 'IN_APPEAL') return { codigo: 'analise', texto: 'Em análise pela Meta (costuma levar de minutos a algumas horas)' };
  if (s === 'REJECTED') return { codigo: 'recusado', texto: `Recusada pela Meta${meta.motivo && meta.motivo !== 'NONE' ? ` (${meta.motivo})` : ''}` };
  if (s === 'PAUSED' || s === 'DISABLED') return { codigo: 'pausado', texto: 'Pausada pela Meta por baixa qualidade (muitas pessoas bloquearam ou denunciaram)' };
  return { codigo: 'analise', texto: `Situação na Meta: ${s || 'desconhecida'}` };
}

module.exports = { paraModeloMeta, parametrosPara, nomeTecnico, mesmoTexto, situacao, CATEGORIAS };
