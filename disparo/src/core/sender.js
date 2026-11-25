'use strict';

const { renderizar } = require('./template');

/**
 * Executa uma campanha, um destinatário por vez.
 * Cada resultado é gravado no estado compartilhado ANTES de passar ao próximo,
 * então uma queda no meio não gera envio duplicado ao retomar.
 *
 * @param {object} p
 * @param {Array}  p.destinatarios  [{ telefone, nome }]
 * @param {string} p.corpo          texto do modelo, com {{nome}}
 * @param {string} p.campanha       identificador da campanha
 * @param {object} p.provedor       ver provider-sim.js
 * @param {Estado} p.estado
 * @param {number} [p.limiteDiario] máximo de envios por dia (somando todos os operadores); 0 = sem limite
 * @param {number} [p.intervaloMs]  pausa entre envios
 * @param {function} [p.aoProgredir] ({ feitos, total, ultimo }) => void
 * @param {{cancelado:boolean}} [p.sinal]
 */
async function executarCampanha(p) {
  const { destinatarios, corpo, campanha, provedor, estado } = p;
  const limiteDiario = p.limiteDiario || 0;
  const intervaloMs = p.intervaloMs || 0;
  const sinal = p.sinal || { cancelado: false };

  const resumo = { total: destinatarios.length, enviados: 0, falhas: 0, parouPorLimite: false, cancelado: false };
  let jaHoje = limiteDiario ? estado.enviadosHoje(provedor.simulacao) : 0;

  for (let i = 0; i < destinatarios.length; i++) {
    if (sinal.cancelado) { resumo.cancelado = true; break; }
    if (limiteDiario && jaHoje >= limiteDiario) { resumo.parouPorLimite = true; break; }

    const d = destinatarios[i];
    const texto = renderizar(corpo, { nome: d.nome });
    let res;
    try {
      res = await provedor.enviar({ telefone: d.telefone, texto, campanha });
    } catch (e) {
      res = { ok: false, erro: String(e && e.message || e) };
    }

    estado.registrarEnvio({
      campanha, telefone: d.telefone, status: res.ok ? 'enviado' : 'falhou',
      simulacao: provedor.simulacao, erro: res.ok ? undefined : res.erro,
    });
    if (res.ok) { resumo.enviados++; jaHoje++; } else resumo.falhas++;

    if (p.aoProgredir) p.aoProgredir({ feitos: i + 1, total: destinatarios.length, ultimo: d.telefone, ok: res.ok });
    if (intervaloMs && i < destinatarios.length - 1) await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return resumo;
}

module.exports = { executarCampanha };
