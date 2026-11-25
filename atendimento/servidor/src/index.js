// Atendimento Urbano Norte — servidor na nuvem (Cloudflare Worker + banco D1).
//
// Fica no ar o tempo todo para:
//   1. receber da Meta (webhook) as mensagens dos clientes e os avisos de entregue/lido/falhou;
//   2. guardar tudo no banco;
//   3. servir o app do escritório (aba Atendimento): listar conversas, mensagens, responder, abrir mídia.
//
// Segredos (configurados com `npx wrangler secret put NOME`, nunca no código):
//   APP_SECRET      chave secreta do app da Meta — confere a assinatura de cada webhook
//   VERIFY_TOKEN    palavra combinada com a Meta na hora de cadastrar o webhook
//   WHATSAPP_TOKEN  token de acesso permanente (usuário do sistema) para responder pela API
//   CHAVE_APP       chave que o app do escritório usa para entrar aqui
// Variável comum (wrangler.toml): PHONE_NUMBER_ID

const GRAPH = 'https://graph.facebook.com/v27.0';
const JANELA_MS = 24 * 60 * 60 * 1000;

// ---------- utilidades ----------
const json = (dados, status = 200) => new Response(JSON.stringify(dados), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const erro = (status, mensagem) => json({ ok: false, erro: mensagem }, status);
const agora = () => Date.now();

function igualSeguro(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

async function hmacHex(segredo, corpo) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign('HMAC', chave, corpo);
  return [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Confere o cabeçalho X-Hub-Signature-256 da Meta. */
export async function assinaturaValida(segredo, corpoBytes, cabecalho) {
  if (!segredo || !cabecalho || !cabecalho.startsWith('sha256=')) return false;
  return igualSeguro(await hmacHex(segredo, corpoBytes), cabecalho.slice(7));
}

const STATUS = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };
const ORDEM = { recebida: 0, enviada: 1, entregue: 2, lida: 3, falhou: 4 };

const ERROS_META = {
  131047: 'Passaram mais de 24 h desde a última mensagem do cliente. Agora só dá para enviar um modelo aprovado.',
  130497: 'A Meta bloqueia envio de número estrangeiro para celulares do Brasil.',
  131026: 'A mensagem não pôde ser entregue (o número pode não ter WhatsApp).',
  131030: 'Este número não está na lista de destinatários do número de teste.',
  131049: 'A Meta segurou a mensagem para não cansar o cliente com muitas mensagens de empresas.',
  190: 'O token do WhatsApp no servidor venceu ou é inválido.',
};
const explicar = (e) => (e && (ERROS_META[e.code] || `${e.title || e.message || 'Erro da Meta'} [código ${e.code}]`)) || 'Erro desconhecido';

/** Texto curto que representa a mensagem na lista de conversas. */
function resumoDe(tipo, texto) {
  if (texto) return texto.slice(0, 120);
  return { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contacts: '👤 Contato' }[tipo] || 'Mensagem';
}

/** Converte uma mensagem do webhook da Meta para a nossa tabela. */
export function lerMensagemMeta(m) {
  const tipo = m.type || 'desconhecido';
  let texto = null; let midia = null;
  switch (tipo) {
    case 'text': texto = (m.text && m.text.body) ?? null; break;
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const d = m[tipo] || {};
      midia = { id: d.id, mime: d.mime_type, nome: d.filename || null };
      texto = d.caption || null;
      break;
    }
    case 'location': {
      const l = m.location || {};
      texto = [l.name, l.address, `https://maps.google.com/?q=${l.latitude},${l.longitude}`].filter(Boolean).join(' — ');
      break;
    }
    case 'contacts': texto = (m.contacts || []).map((c) => [c.name && c.name.formatted_name, ...(c.phones || []).map((p) => p.phone)].filter(Boolean).join(' ')).join('\n'); break;
    case 'button': texto = (m.button && m.button.text) ?? null; break;
    case 'interactive': {
      const i = m.interactive || {};
      texto = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || null;
      break;
    }
    case 'reaction': texto = m.reaction && m.reaction.emoji ? `Reagiu com ${m.reaction.emoji}` : null; break;
    default: texto = null;
  }
  return { id: m.id, waId: m.from, tipo, texto, midia, quando: Number(m.timestamp) * 1000 || agora() };
}

// ---------- banco ----------
async function salvarEntrada(db, msg, nome) {
  const t = agora();
  const ja = await db.prepare('SELECT id FROM mensagens WHERE id = ?').bind(msg.id).first();
  if (ja) return false; // a Meta pode reenviar o mesmo webhook
  await db.batch([
    db.prepare(`INSERT INTO mensagens (id, wa_id, direcao, tipo, texto, midia_id, midia_mime, midia_nome, status, criada_em, atualizada_em)
                VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, 'recebida', ?, ?)`)
      .bind(msg.id, msg.waId, msg.tipo, msg.texto ?? null, msg.midia?.id ?? null, msg.midia?.mime ?? null, msg.midia?.nome ?? null, msg.quando, t),
    db.prepare(`INSERT INTO conversas (wa_id, nome, previa, ultima_msg_em, ultima_entrada_em, nao_lidas, estado, atualizada_em)
                VALUES (?, ?, ?, ?, ?, 1, 'aberta', ?)
                ON CONFLICT(wa_id) DO UPDATE SET
                  nome = COALESCE(excluded.nome, conversas.nome),
                  previa = excluded.previa,
                  ultima_msg_em = MAX(conversas.ultima_msg_em, excluded.ultima_msg_em),
                  ultima_entrada_em = MAX(COALESCE(conversas.ultima_entrada_em, 0), excluded.ultima_entrada_em),
                  nao_lidas = conversas.nao_lidas + 1,
                  estado = 'aberta',
                  atualizada_em = excluded.atualizada_em`)
      .bind(msg.waId, nome || null, resumoDe(msg.tipo, msg.texto), msg.quando, msg.quando, t),
  ]);
  return true;
}

async function atualizarStatus(db, s) {
  const novo = STATUS[s.status];
  if (!novo) return;
  const atual = await db.prepare('SELECT status FROM mensagens WHERE id = ?').bind(s.id).first();
  if (!atual) return; // mensagem que não saiu pelo Atendimento (ex.: campanha do Disparo)
  if (ORDEM[novo] < ORDEM[atual.status]) return; // os avisos podem chegar fora de ordem
  const err = novo === 'falhou' ? explicar((s.errors || [])[0]) : null;
  await db.prepare('UPDATE mensagens SET status = ?, erro = ?, atualizada_em = ? WHERE id = ?').bind(novo, err, agora(), s.id).run();
}

/** Processa o corpo de um webhook da Meta já conferido. Devolve quantas mensagens novas entraram. */
export async function processarWebhook(db, corpo) {
  let novas = 0;
  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const v = mudanca.value || {};
      const nomes = new Map((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
      for (const m of v.messages || []) {
        const msg = lerMensagemMeta(m);
        if (msg.id && msg.waId && await salvarEntrada(db, msg, nomes.get(msg.waId))) novas++;
      }
      for (const s of v.statuses || []) await atualizarStatus(db, s);
    }
  }
  return novas;
}

// ---------- Meta (Graph API) ----------
async function graph(env, caminho, opcoes = {}) {
  const r = await fetch(`${GRAPH}/${caminho}`, {
    ...opcoes,
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) },
  });
  let dados = null;
  try { dados = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok || (dados && dados.error)) return { ok: false, erro: explicar(dados && dados.error), codigo: dados && dados.error && dados.error.code };
  return { ok: true, dados };
}

async function enviarTexto(env, db, waId, texto, operador) {
  const conversa = await db.prepare('SELECT ultima_entrada_em FROM conversas WHERE wa_id = ?').bind(waId).first();
  if (!conversa) return erro(404, 'Conversa não encontrada.');
  if (!conversa.ultima_entrada_em || agora() - conversa.ultima_entrada_em > JANELA_MS) {
    return erro(409, ERROS_META[131047]);
  }
  const r = await graph(env, `${env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body: texto } }),
  });
  if (!r.ok) return erro(502, r.erro);
  const id = r.dados.messages && r.dados.messages[0] && r.dados.messages[0].id;
  const t = agora();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO mensagens (id, wa_id, direcao, tipo, texto, status, operador, criada_em, atualizada_em)
                VALUES (?, ?, 'saida', 'text', ?, 'enviada', ?, ?, ?)`).bind(id, waId, texto, operador || null, t, t),
    db.prepare('UPDATE conversas SET previa = ?, ultima_msg_em = ?, atualizada_em = ? WHERE wa_id = ?').bind(resumoDe('text', texto), t, t, waId),
  ]);
  return json({ ok: true, mensagem: await db.prepare('SELECT * FROM mensagens WHERE id = ?').bind(id).first() });
}

// ---------- rotas ----------
async function rotaWebhook(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    // A Meta confere o endereço uma vez, quando o webhook é cadastrado.
    if (url.searchParams.get('hub.mode') === 'subscribe' && env.VERIFY_TOKEN && igualSeguro(url.searchParams.get('hub.verify_token'), env.VERIFY_TOKEN)) {
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Proibido', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const bruto = await request.arrayBuffer();
  if (!(await assinaturaValida(env.APP_SECRET, bruto, request.headers.get('X-Hub-Signature-256')))) {
    return new Response('Assinatura inválida', { status: 401 });
  }
  let corpo;
  try { corpo = JSON.parse(new TextDecoder().decode(bruto)); } catch { return new Response('JSON inválido', { status: 400 }); }
  const tarefa = processarWebhook(env.DB, corpo);
  // responde rápido para a Meta; o banco termina de gravar em seguida
  if (ctx && ctx.waitUntil) ctx.waitUntil(tarefa); else await tarefa;
  return new Response('ok', { status: 200 });
}

async function rotaApi(request, env, caminho) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.CHAVE_APP || !igualSeguro(auth, `Bearer ${env.CHAVE_APP}`)) return erro(401, 'Chave de acesso inválida.');
  const db = env.DB;
  const url = new URL(request.url);
  const partes = caminho.split('/').filter(Boolean); // ['api', 'conversas', waId, acao]

  if (request.method === 'GET' && caminho === '/api/status') {
    return json({ ok: true, numero: env.PHONE_NUMBER_ID || null, versao: 1 });
  }

  if (request.method === 'GET' && caminho === '/api/conversas') {
    const estado = url.searchParams.get('estado');
    const busca = (url.searchParams.get('busca') || '').trim();
    let sql = 'SELECT * FROM conversas';
    const cond = []; const args = [];
    if (estado === 'aberta' || estado === 'resolvida') { cond.push('estado = ?'); args.push(estado); }
    if (busca) { cond.push('(nome LIKE ? OR wa_id LIKE ?)'); args.push(`%${busca}%`, `%${busca.replace(/\D/g, '') || busca}%`); }
    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY ultima_msg_em DESC LIMIT 300';
    const { results } = await db.prepare(sql).bind(...args).all();
    const naoLidas = await db.prepare("SELECT COALESCE(SUM(nao_lidas), 0) AS n FROM conversas WHERE estado = 'aberta'").first();
    return json({ ok: true, conversas: results, naoLidas: naoLidas ? naoLidas.n : 0, agora: agora() });
  }

  if (partes[0] === 'api' && partes[1] === 'conversas' && partes[2]) {
    const waId = partes[2].replace(/\D/g, '');
    const acao = partes[3];
    if (request.method === 'GET' && acao === 'mensagens') {
      const desde = Number(url.searchParams.get('desde')) || 0;
      const { results } = desde
        ? await db.prepare('SELECT *, rowid AS seq FROM mensagens WHERE wa_id = ? AND atualizada_em > ? ORDER BY criada_em, rowid').bind(waId, desde).all()
        : await db.prepare('SELECT * FROM (SELECT *, rowid AS seq FROM mensagens WHERE wa_id = ? ORDER BY criada_em DESC, rowid DESC LIMIT 500) ORDER BY criada_em, seq').bind(waId).all();
      const conversa = await db.prepare('SELECT * FROM conversas WHERE wa_id = ?').bind(waId).first();
      return json({ ok: true, conversa, mensagens: results, agora: agora() });
    }
    if (request.method === 'POST' && acao === 'enviar') {
      let corpo = {};
      try { corpo = await request.json(); } catch { /* vazio */ }
      const texto = String(corpo.texto || '').trim();
      if (!texto) return erro(400, 'Escreva a mensagem.');
      if (texto.length > 4096) return erro(400, 'A mensagem passou de 4096 caracteres.');
      return enviarTexto(env, db, waId, texto, String(corpo.operador || '').slice(0, 60));
    }
    if (request.method === 'POST' && acao === 'lida') {
      await db.prepare('UPDATE conversas SET nao_lidas = 0, atualizada_em = ? WHERE wa_id = ?').bind(agora(), waId).run();
      // dois tiques azuis no celular do cliente (não atrapalha se falhar)
      const ultima = await db.prepare("SELECT id FROM mensagens WHERE wa_id = ? AND direcao = 'entrada' ORDER BY criada_em DESC, rowid DESC LIMIT 1").bind(waId).first();
      if (ultima && env.WHATSAPP_TOKEN) {
        await graph(env, `${env.PHONE_NUMBER_ID}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: ultima.id }) }).catch(() => {});
      }
      return json({ ok: true });
    }
    if (request.method === 'POST' && (acao === 'resolver' || acao === 'reabrir')) {
      await db.prepare('UPDATE conversas SET estado = ?, nao_lidas = CASE WHEN ? = \'resolvida\' THEN 0 ELSE nao_lidas END, atualizada_em = ? WHERE wa_id = ?')
        .bind(acao === 'resolver' ? 'resolvida' : 'aberta', acao === 'resolver' ? 'resolvida' : 'aberta', agora(), waId).run();
      return json({ ok: true });
    }
  }

  if (request.method === 'GET' && partes[0] === 'api' && partes[1] === 'midia' && partes[2]) {
    const midiaId = partes[2].replace(/[^\w-]/g, '');
    const existe = await db.prepare('SELECT midia_mime FROM mensagens WHERE midia_id = ?').bind(midiaId).first();
    if (!existe) return erro(404, 'Mídia não encontrada.');
    const info = await graph(env, midiaId);
    if (!info.ok) return erro(502, info.erro);
    const arquivo = await fetch(info.dados.url, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
    if (!arquivo.ok) return erro(502, 'A Meta não entregou o arquivo (ele pode ter expirado).');
    return new Response(arquivo.body, { headers: { 'Content-Type': info.dados.mime_type || existe.midia_mime || 'application/octet-stream', 'Cache-Control': 'no-store' } });
  }

  return erro(404, 'Rota não encontrada.');
}


// ---------- página pública de privacidade (a Meta exige para publicar o app) ----------
const PRIVACIDADE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de Privacidade — Atendimento Urbano Norte</title>
<style>body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#2b2a2c;max-width:760px;margin:0 auto;padding:32px 20px;background:#f1f4f1}
h1{color:#007a43;font-size:28px;margin:0 0 4px}h2{color:#007a43;font-size:19px;margin-top:28px}.data{color:#5d6360;margin:0 0 20px}</style></head><body>
<h1>Política de Privacidade</h1>
<p class="data">Atendimento Urbano Norte (WhatsApp) — Urbano Norte, transporte por aplicativo, Rio Verde-GO. Atualizada em 25/11/2026.</p>
<p>Esta política explica como a Urbano Norte trata os dados de quem conversa com a empresa pelo WhatsApp, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>
<h2>Quais dados usamos</h2>
<p>Quando você manda mensagem para o WhatsApp da Urbano Norte, recebemos pela plataforma oficial do WhatsApp (Meta): seu número de telefone, o nome do seu perfil, o conteúdo das mensagens (texto, fotos, áudios, documentos e localização que você enviar) e a data e hora de cada mensagem.</p>
<h2>Para que usamos</h2>
<p>Somente para responder ao seu atendimento (dúvidas, objetos esquecidos, reclamações, informações sobre corridas) e, quando você autorizar, para enviar comunicados da Urbano Norte. Não vendemos nem compartilhamos seus dados com terceiros para fins de publicidade.</p>
<h2>Onde ficam e por quanto tempo</h2>
<p>As conversas ficam guardadas em servidor seguro, acessado apenas pela equipe de atendimento da Urbano Norte com chave de acesso. Mantemos o histórico enquanto for necessário para o atendimento e para obrigações legais. Arquivos de mídia ficam com a Meta e expiram conforme as regras do WhatsApp.</p>
<h2 id="exclusao">Seus direitos e como apagar seus dados</h2>
<p>Você pode pedir a qualquer momento: acesso, correção ou exclusão dos seus dados, ou deixar de receber comunicados. Basta enviar uma mensagem para o próprio WhatsApp da Urbano Norte dizendo, por exemplo, "quero apagar meus dados" ou "não quero receber mensagens". Atendemos em até 15 dias.</p>
<h2>Contato</h2>
<p>Dúvidas sobre esta política: fale com a Urbano Norte pelo WhatsApp oficial ou pelos canais oficiais da empresa.</p>
</body></html>`;

export default {
  async fetch(request, env, ctx) {
    const caminho = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    try {
      if (caminho === '/webhook') return await rotaWebhook(request, env, ctx);
      if (caminho.startsWith('/api/')) return await rotaApi(request, env, caminho);
      if (caminho === '/') return new Response('Atendimento Urbano Norte: no ar.', { status: 200 });
      if (caminho === '/privacidade') return new Response(PRIVACIDADE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      console.error(e);
      return erro(500, 'Erro interno no servidor.');
    }
  },
};
