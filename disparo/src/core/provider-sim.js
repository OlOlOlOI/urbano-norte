'use strict';

/**
 * Provedor de SIMULAÇÃO: não envia nada. Serve para testar o fluxo inteiro
 * (público, modelo, limites, histórico) antes de ligar a API oficial do WhatsApp.
 *
 * Interface que qualquer provedor real precisa ter:
 *   nome: string
 *   simulacao: boolean
 *   enviar({ telefone, texto, campanha }) -> Promise<{ ok: boolean, erro?: string }>
 */
function criarProvedorSimulacao({ atrasoMs = 0 } = {}) {
  return {
    nome: 'simulacao',
    simulacao: true,
    async enviar() {
      if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
      return { ok: true };
    },
  };
}

module.exports = { criarProvedorSimulacao };
