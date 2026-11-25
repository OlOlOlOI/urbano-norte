'use strict';

/**
 * Provedor REAL: API oficial do WhatsApp (WhatsApp Cloud API, da Meta).
 * Mesma interface do provider-sim.js: enviar({ telefone, texto, campanha }) -> { ok, erro?, id? }.
 *
 * Precisa de:
 *   numeroId  "Phone number ID" (Meta for Developers > WhatsApp > Configuração da API)
 *   token     token de acesso (o temporário do painel vale 24 h; para uso contínuo, token de usuário do sistema)
 *
 * Regra do WhatsApp: texto livre só chega se a pessoa falou com o número da empresa nas últimas 24 h.
 * Fora disso, só modelos (templates) aprovados pela Meta — por isso enviarModelo().
 */
const GRAPH = 'https://graph.facebook.com/v27.0';

// Erros mais comuns, explicados em português.
const ERROS = {
  190: 'O token de acesso venceu ou é inválido. Gere um novo no painel da Meta e salve de novo.',
  131030: 'Este número ainda não está na lista de números autorizados do número de teste. Adicione-o no painel da Meta (campo "Para").',
  131047: 'Passaram mais de 24 h desde a última mensagem desta pessoa para o número da empresa. Mande um "oi" do seu WhatsApp para o número da empresa e tente de novo, ou use o modelo hello_world.',
  131026: 'A mensagem não pôde ser entregue: confira se o número tem WhatsApp.',
  132001: 'O modelo (template) não existe ou não está aprovado neste idioma.',
  100: 'Algum dado está errado (confira o ID do número de telefone).',
  10: 'O token não tem permissão para enviar por este número.',
  130497: 'A Meta bloqueia envio de número estrangeiro para celulares do Brasil. O número de teste (+1, dos EUA) não entrega no Brasil: é preciso usar um número brasileiro da empresa (Etapa 2 no painel da Meta).',
  80007: 'Limite de envios da Meta atingido. Espere um pouco e tente de novo.',
  130429: 'Limite de envios da Meta atingido. Espere um pouco e tente de novo.',
};

function explicarErro(corpo, status) {
  const e = corpo && corpo.error;
  if (!e) return `A Meta respondeu ${status}.`;
  const codigo = e.code;
  const sub = e.error_data && e.error_data.details;
  return ERROS[codigo] || `${e.message || 'Erro da Meta'}${sub ? ` (${sub})` : ''} [código ${codigo}]`;
}

/** +5564999998888 -> 5564999998888 (a API usa só dígitos). */
const paraApi = (e164) => String(e164 || '').replace(/\D/g, '');
/** 5564992937605 -> 556492937605; null se não for celular brasileiro com 9. */
const semNonoDigito = (d) => { const m = /^55(\d{2})9(\d{8})$/.exec(d); return m ? `55${m[1]}${m[2]}` : null; };

/**
 * @param {object} p
 * @param {string} p.numeroId
 * @param {string} p.token
 * @param {typeof fetch} [p.fetch] para testes
 */
function criarProvedorMeta({ numeroId, token, fetch: buscar = globalThis.fetch } = {}) {
  if (!numeroId || !/^\d+$/.test(String(numeroId))) throw new Error('Informe o ID do número de telefone (só números).');
  if (!token) throw new Error('Informe o token de acesso.');

  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    let r;
    try {
      r = await buscar(`${GRAPH}/${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (e) {
      return { ok: false, erro: 'Sem conexão com a Meta. Confira a internet. (' + (e && e.message || e) + ')' };
    }
    let json = null;
    try { json = await r.json(); } catch { /* resposta sem JSON */ }
    if (!r.ok || (json && json.error)) return { ok: false, erro: explicarErro(json, r.status), codigo: json && json.error && json.error.code };
    return { ok: true, dados: json };
  }

  const postar = (para, conteudo) => chamar(`${numeroId}/messages`, {
    metodo: 'POST',
    corpo: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...conteudo },
  });

  async function mensagem(telefone, conteudo) {
    let r = await postar(paraApi(telefone), conteudo);
    // Celular do Brasil: o WhatsApp às vezes registra o número sem o 9 extra (5564 9 9293-7605 -> 5564 9293-7605).
    // Se a Meta disser que o número não está autorizado, tenta de novo sem o 9.
    const semNove = semNonoDigito(paraApi(telefone));
    if (!r.ok && r.codigo === 131030 && semNove) {
      const r2 = await postar(semNove, conteudo);
      if (r2.ok) r = r2;
    }
    if (!r.ok) return r;
    const id = r.dados && r.dados.messages && r.dados.messages[0] && r.dados.messages[0].id;
    const waId = r.dados && r.dados.contacts && r.dados.contacts[0] && r.dados.contacts[0].wa_id;
    return { ok: true, id, waId };
  }

  return {
    nome: 'meta',
    simulacao: false,

    /** Texto livre (só chega dentro da janela de 24 h). */
    enviar: ({ telefone, texto }) => mensagem(telefone, { type: 'text', text: { preview_url: false, body: String(texto || '') } }),

    /** Modelo aprovado pela Meta (ex.: hello_world, idioma en_US). */
    enviarModelo: ({ telefone, modelo, idioma = 'pt_BR' }) =>
      mensagem(telefone, { type: 'template', template: { name: modelo, language: { code: idioma } } }),

    /** Confere token e número: devolve o número exibido e o nome verificado. */
    async conferir() {
      const r = await chamar(`${numeroId}?fields=display_phone_number,verified_name,quality_rating`);
      if (!r.ok) return r;
      return { ok: true, numero: r.dados.display_phone_number, nome: r.dados.verified_name, qualidade: r.dados.quality_rating };
    },
  };
}

module.exports = { criarProvedorMeta, explicarErro, GRAPH };
