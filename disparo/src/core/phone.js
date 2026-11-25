'use strict';

/**
 * Normaliza telefone brasileiro para E.164 (+55DDNNNNNNNNN).
 * Retorna { ok, e164, corrigido, motivo }.
 * WhatsApp só aceita celular: fixo é rejeitado.
 */
function normalizarTelefone(entrada) {
  if (entrada === null || entrada === undefined) return { ok: false, motivo: 'vazio' };
  let d = String(entrada).replace(/\D/g, '');
  if (!d) return { ok: false, motivo: 'vazio' };

  // prefixos de discagem: 00 (internacional) e 0 (operadora/tronco)
  d = d.replace(/^0+/, '');

  // remove o código do país só quando o tamanho confirma (12 ou 13 dígitos)
  // (DDD 55 existe, então 10/11 dígitos começando com 55 NÃO perdem o 55)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);

  if (d.length !== 10 && d.length !== 11) return { ok: false, motivo: 'tamanho inválido' };

  const ddd = d.slice(0, 2);
  if (ddd[0] === '0' || ddd[1] === '0') return { ok: false, motivo: 'DDD inválido' };

  let assinante = d.slice(2);
  let corrigido = false;

  if (assinante.length === 8) {
    // 8 dígitos: celular antigo sem o 9 (começa 6-9) ou telefone fixo (começa 2-5)
    if (/^[6-9]/.test(assinante)) {
      assinante = '9' + assinante;
      corrigido = true;
    } else {
      return { ok: false, motivo: 'telefone fixo' };
    }
  }

  if (assinante[0] !== '9') return { ok: false, motivo: 'não é celular' };

  return { ok: true, e164: '+55' + ddd + assinante, corrigido };
}

/** Formata +5569992915141 -> (69) 99291-5141 para exibição. */
function formatarTelefone(e164) {
  const m = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(e164 || '');
}

module.exports = { normalizarTelefone, formatarTelefone };
