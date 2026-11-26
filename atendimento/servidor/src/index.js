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
//
// Instagram (opcional — só mensagens diretas):
//   IG_TOKEN        token com instagram_manage_messages. Apps novos da Meta usam o "login unificado":
//                   token de usuário do sistema (não vence) e chamadas em graph.facebook.com
//   IG_ID           (wrangler.toml) ID da conta do Instagram da empresa — com ele, usa graph.facebook.com/{IG_ID}
//                   sem ele, usa a API antiga graph.instagram.com/me (login do Instagram)
//   IG_APP_SECRET   chave secreta do app do Instagram, se for diferente da APP_SECRET (confere a assinatura)

const GRAPH = 'https://graph.facebook.com/v27.0';
const GRAPH_IG = 'https://graph.instagram.com/v27.0';
const ehInstagram = (contato) => String(contato).startsWith('ig_');
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
  return { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contacts: '👤 Contato', story_mention: '📣 Mencionou vocês no Story', share: '🔗 Compartilhou uma publicação' }[tipo] || 'Mensagem';
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
async function salvarEntrada(db, msg, nome, { canal = 'whatsapp', usuario = null } = {}) {
  const t = agora();
  const ja = await db.prepare('SELECT id FROM mensagens WHERE id = ?').bind(msg.id).first();
  if (ja) return false; // a Meta pode reenviar o mesmo webhook
  await db.batch([
    db.prepare(`INSERT INTO mensagens (id, wa_id, direcao, tipo, texto, midia_id, midia_mime, midia_nome, midia_url, status, criada_em, atualizada_em)
                VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, ?, 'recebida', ?, ?)`)
      .bind(msg.id, msg.waId, msg.tipo, msg.texto ?? null, msg.midia?.id ?? null, msg.midia?.mime ?? null, msg.midia?.nome ?? null, msg.midia?.url ?? null, msg.quando, t),
    db.prepare(`INSERT INTO conversas (wa_id, canal, nome, usuario, previa, ultima_msg_em, ultima_entrada_em, nao_lidas, estado, atualizada_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'aberta', ?)
                ON CONFLICT(wa_id) DO UPDATE SET
                  nome = COALESCE(excluded.nome, conversas.nome),
                  usuario = COALESCE(excluded.usuario, conversas.usuario),
                  previa = excluded.previa,
                  ultima_msg_em = MAX(conversas.ultima_msg_em, excluded.ultima_msg_em),
                  ultima_entrada_em = MAX(COALESCE(conversas.ultima_entrada_em, 0), excluded.ultima_entrada_em),
                  nao_lidas = conversas.nao_lidas + 1,
                  estado = 'aberta',
                  atualizada_em = excluded.atualizada_em`)
      .bind(msg.waId, canal, nome || null, usuario || null, resumoDe(msg.tipo, msg.texto), msg.quando, msg.quando, t),
  ]);
  return true;
}

// ---------- Instagram (mensagens diretas) ----------
const TIPO_IG = { image: 'image', audio: 'audio', video: 'video', file: 'document', story_mention: 'story_mention', share: 'share', ig_reel: 'share', reel: 'share', ig_post: 'share', animated_image: 'image' };

/** Converte um evento "messaging" do webhook do Instagram para a nossa tabela. */
export function lerMensagemInstagram(ev, contato) {
  const m = ev.message || {};
  const anexo = (m.attachments || [])[0];
  const tipo = anexo ? (TIPO_IG[anexo.type] || 'document') : 'text';
  let texto = m.text ?? null;
  let midia = null;
  if (anexo) {
    const url = anexo.payload && anexo.payload.url;
    if (tipo === 'story_mention') texto = texto || 'Mencionou vocês no Story' + (url ? ` — ${url}` : '');
    else if (tipo === 'share') texto = [texto, url].filter(Boolean).join(' ') || null;
    else if (url) midia = { id: `${m.mid}_0`.replace(/[^\w-]/g, '').slice(-120), url, mime: { image: 'image/jpeg', audio: 'audio/mp4', video: 'video/mp4' }[tipo] || null, nome: null };
  }
  if (m.reply_to && m.reply_to.story) texto = `↩ Respondeu ao seu Story${texto ? ': ' + texto : ''}`;
  return { id: m.mid, waId: contato, tipo, texto, midia, quando: Number(ev.timestamp) || agora() };
}

async function perfilInstagram(env, igsid) {
  if (!env || !env.IG_TOKEN) return {};
  try {
    const r = await fetch(`${(await idDoInstagram(env)) ? GRAPH : GRAPH_IG}/${igsid}?fields=name,username`, { headers: { Authorization: `Bearer ${env.IG_TOKEN}` } });
    const d = await r.json();
    return r.ok ? { nome: d.name || null, usuario: d.username || null } : {};
  } catch { return {}; }
}

async function processarInstagram(db, corpo, env) {
  let novas = 0;
  for (const entrada of corpo.entry || []) {
    const contaEmpresa = String(entrada.id || '');
    // A Meta manda as DMs em dois formatos: entry[].messaging[] e entry[].changes[] {field: 'messages', value: {...}}
    const eventos = [...(entrada.messaging || []), ...(entrada.changes || []).filter((c) => /^(messages|messaging_seen|message_reactions)$/.test(c.field)).map((c) => c.value || {})];
    for (const ev of eventos) {
      const eco = Boolean(ev.message && ev.message.is_echo) || String(ev.sender && ev.sender.id) === contaEmpresa;
      const cliente = String(eco ? ev.recipient && ev.recipient.id : ev.sender && ev.sender.id);
      if (!cliente || cliente === 'undefined') continue;
      const contato = `ig_${cliente}`;
      if (ev.read) {
        await db.prepare("UPDATE mensagens SET status = 'lida', atualizada_em = ? WHERE wa_id = ? AND direcao = 'saida' AND status IN ('enviada', 'entregue')").bind(agora(), contato).run();
        continue;
      }
      if (ev.reaction) {
        if (ev.reaction.action === 'react' && !eco) {
          const msg = { id: `${ev.reaction.mid}_reacao_${ev.timestamp}`, waId: contato, tipo: 'reaction', texto: `Reagiu com ${ev.reaction.emoji || '❤️'}`, midia: null, quando: Number(ev.timestamp) || agora() };
          if (await salvarEntrada(db, msg, null, { canal: 'instagram' })) novas++;
        }
        continue;
      }
      if (!ev.message || !ev.message.mid || ev.message.is_deleted) continue;
      const msg = lerMensagemInstagram(ev, contato);
      if (eco) {
        // mensagem mandada pelo app do Instagram no celular (as do Atendimento já estão gravadas)
        const ja = await db.prepare('SELECT id FROM mensagens WHERE id = ?').bind(msg.id).first();
        if (ja) continue;
        const t = agora();
        await db.batch([
          db.prepare(`INSERT INTO mensagens (id, wa_id, direcao, tipo, texto, midia_id, midia_mime, midia_url, status, operador, criada_em, atualizada_em)
                      VALUES (?, ?, 'saida', ?, ?, ?, ?, ?, 'enviada', 'pelo app do Instagram', ?, ?)`)
            .bind(msg.id, contato, msg.tipo, msg.texto ?? null, msg.midia?.id ?? null, msg.midia?.mime ?? null, msg.midia?.url ?? null, msg.quando, t),
          db.prepare(`UPDATE conversas SET previa = ?, ultima_msg_em = MAX(ultima_msg_em, ?), atualizada_em = ? WHERE wa_id = ?`).bind(resumoDe(msg.tipo, msg.texto), msg.quando, t, contato),
        ]);
        continue;
      }
      const existe = await db.prepare('SELECT nome FROM conversas WHERE wa_id = ?').bind(contato).first();
      const perfil = existe && existe.nome ? {} : await perfilInstagram(env, cliente);
      if (await salvarEntrada(db, msg, perfil.nome, { canal: 'instagram', usuario: perfil.usuario })) novas++;
    }
  }
  return novas;
}

// Descobre sozinho o ID da conta do Instagram quando o token é do Facebook (começa com "EAA") e o IG_ID não foi
// configurado: procura a conta do Instagram ligada às Páginas que o token enxerga. Fica guardado enquanto o servidor roda.
let igIdDescoberto = null;
async function idDoInstagram(env) {
  // token do Instagram (IG...): usa graph.instagram.com/me, sem ID; token do Facebook (EAA...): graph.facebook.com/{ID}
  if (String(env.IG_TOKEN || '').startsWith('IG')) return null;
  if (env.IG_ID) return env.IG_ID;
  if (!String(env.IG_TOKEN || '').startsWith('EAA')) return null;
  if (igIdDescoberto) return igIdDescoberto;
  try {
    const r = await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account{id,username}&limit=50`, { headers: { Authorization: `Bearer ${env.IG_TOKEN}` } });
    const d = await r.json();
    const conta = (d.data || []).map((p) => p.instagram_business_account).find(Boolean);
    if (conta) igIdDescoberto = conta.id;
  } catch { /* sem rede: tenta na próxima */ }
  return igIdDescoberto;
}

async function instagram(env, caminho, opcoes = {}) {
  // login unificado (apps novos): graph.facebook.com/{IG_ID}/...; login do Instagram (antigo): graph.instagram.com/me/...
  const igId = await idDoInstagram(env);
  const base = igId ? GRAPH : GRAPH_IG;
  const alvo = igId ? caminho.replace(/^me(?=[/?]|$)/, igId) : caminho;
  let r;
  try {
    r = await fetch(`${base}/${alvo}`, { ...opcoes, headers: { Authorization: `Bearer ${env.IG_TOKEN}`, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { return { ok: false, erro: 'Sem conexão com o Instagram.' }; }
  let dados = null;
  try { dados = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok || (dados && dados.error)) {
    const e = (dados && dados.error) || {};
    const fora = e.error_subcode === 2534022 || /outside of allowed window/i.test(e.message || '');
    const erro = fora ? 'Passaram mais de 24 h desde a última mensagem do cliente no Instagram.'
      : e.code === 190 ? 'O token do Instagram no servidor venceu ou é inválido. Gere outro na Meta (API do Instagram > Gerar token da urbanorioverde) e grave com o configurar-instagram.sh.'
      : explicar(e);
    return { ok: false, erro, codigo: e.code };
  }
  return { ok: true, dados };
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
export async function processarWebhook(db, corpo, env) {
  if (corpo.object === 'instagram') return processarInstagram(db, corpo, env);
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
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) },  });
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
  let id;
  if (ehInstagram(waId)) {
    if (!env.IG_TOKEN) return erro(503, 'O Instagram ainda não foi ligado ao servidor (falta o IG_TOKEN).');
    const r = await instagram(env, 'me/messages', { method: 'POST', body: JSON.stringify({ recipient: { id: waId.slice(3) }, message: { text: texto } }) });
    if (!r.ok) return erro(502, r.erro);
    id = r.dados.message_id;
  } else {
    const r = await graph(env, `${env.PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body: texto } }),
    });
    if (!r.ok) return erro(502, r.erro);
    id = r.dados.messages && r.dados.messages[0] && r.dados.messages[0].id;
  }
  if (!id) return erro(502, 'A Meta não devolveu o código da mensagem.');
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
  const assinatura = request.headers.get('X-Hub-Signature-256');
  const valida = (await assinaturaValida(env.APP_SECRET, bruto, assinatura)) || (await assinaturaValida(env.IG_APP_SECRET, bruto, assinatura));
  if (!valida) {
    return new Response('Assinatura inválida', { status: 401 });
  }
  let corpo;
  try { corpo = JSON.parse(new TextDecoder().decode(bruto)); } catch { return new Response('JSON inválido', { status: 400 }); }
  const tarefa = processarWebhook(env.DB, corpo, env);
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

  // Confere a ligação com a Meta e corrige o que dá: token válido? a conta do WhatsApp (WABA) assina este app?
  // Sem essa assinatura a Meta não manda as mensagens dos clientes, mesmo com o webhook cadastrado.
  if (request.method === 'POST' && caminho === '/api/diagnostico') {
    const passos = [];
    const numero = await graph(env, `${env.PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`);
    passos.push({ item: 'Token do WhatsApp e número', ok: numero.ok, detalhe: numero.ok ? `${numero.dados.display_phone_number} (${numero.dados.verified_name || 'sem nome'})` : numero.erro });
    if (!env.WABA_ID) {
      passos.push({ item: 'Conta do WhatsApp (WABA)', ok: false, detalhe: 'WABA_ID não configurado no wrangler.toml.' });
    } else if (numero.ok) {
      const lista = await graph(env, `${env.WABA_ID}/subscribed_apps`);
      const assinado = lista.ok && (lista.dados.data || []).length > 0;
      if (assinado) {
        passos.push({ item: 'Conta do WhatsApp manda mensagens para este app', ok: true, detalhe: 'já estava ligada' });
      } else {
        const r = await graph(env, `${env.WABA_ID}/subscribed_apps`, { method: 'POST' });
        passos.push({ item: 'Conta do WhatsApp manda mensagens para este app', ok: r.ok, detalhe: r.ok ? 'ligada agora' : (lista.ok ? r.erro : lista.erro) });
      }
    }
    if (env.APP_ID && env.APP_SECRET) {
      // Para onde a Meta manda os avisos deste app (token do próprio app: APP_ID|APP_SECRET)
      const r = await fetch(`${GRAPH}/${env.APP_ID}/subscriptions?access_token=${encodeURIComponent(`${env.APP_ID}|${env.APP_SECRET}`)}`).then((x) => x.json()).catch(() => null);
      const wa = r && r.data && r.data.find((x) => x.object === 'whatsapp_business_account');
      const nosso = new URL(request.url).origin + '/webhook';
      const campos = wa ? (wa.fields || []).map((f) => f.name || f) : [];
      passos.push({
        item: 'Webhook do app aponta para este servidor',
        ok: Boolean(wa && wa.active && wa.callback_url === nosso && campos.includes('messages')),
        detalhe: !r ? 'não consegui consultar' : r.error ? explicar(r.error) + ' (confira a chave secreta do app: APP_SECRET)' : !wa ? 'nenhum webhook de WhatsApp cadastrado' : `${wa.active ? 'ativo' : 'INATIVO'} → ${wa.callback_url} · campos: ${campos.join(', ') || 'nenhum'}`,
      });
    }
    if (env.IG_TOKEN) {
      const igId = await idDoInstagram(env);
      const eu = await instagram(env, igId ? 'me?fields=username' : 'me?fields=user_id,username');
      // tipo do token pelas primeiras letras (não é segredo): IGAA… = login do Instagram; EAA… = Facebook/usuário do sistema
      const tok = String(env.IG_TOKEN);
      const tipo = tok.startsWith('IG') ? 'token do Instagram (IG…)' : tok.startsWith('EAA') ? 'token do Facebook (EAA…)' : `formato desconhecido (começa com "${tok.slice(0, 3)}…", ${tok.length} caracteres)`;
      passos.push({ item: 'Instagram conectado', ok: eu.ok, detalhe: (eu.ok ? `@${eu.dados.username}${igId ? ` (conta ${igId})` : ''}` : eu.erro) + ` · ${tipo}` });
      if (eu.ok && igId) {
        // Token do Facebook (login unificado): as DMs do Instagram chegam pela Página do Facebook ligada à conta,
        // e é a Página que precisa assinar o app (com o token da própria Página).
        let paginas = null;
        try {
          const r = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100`, { headers: { Authorization: `Bearer ${env.IG_TOKEN}` } });
          paginas = await r.json();
        } catch { /* sem rede */ }
        const lista = (paginas && paginas.data) || [];
        const pagina = lista.find((p) => p.instagram_business_account && p.instagram_business_account.id === igId) || null;
        if (!paginas || paginas.error) {
          passos.push({ item: 'Página do Facebook ligada ao Instagram', ok: false, detalhe: paginas && paginas.error ? explicar(paginas.error) + ' — o token precisa das permissões pages_show_list e pages_manage_metadata.' : 'não consegui consultar' });
        } else if (!pagina) {
          passos.push({ item: 'Página do Facebook ligada ao Instagram', ok: false, detalhe: lista.length ? `o token enxerga ${lista.length} página(s), mas nenhuma está ligada a esta conta do Instagram` : 'o token não enxerga nenhuma Página do Facebook (falta a permissão pages_show_list ou a Página não foi incluída ao gerar o token)' });
        } else {
          const r = await fetch(`${GRAPH}/${pagina.id}/subscribed_apps?subscribed_fields=messages,message_reactions,message_reads`, { method: 'POST', headers: { Authorization: `Bearer ${pagina.access_token}` } }).then((x) => x.json()).catch(() => null);
          const ok = Boolean(r && r.success);
          passos.push({ item: 'Página do Facebook manda as DMs do Instagram para este app', ok, detalhe: ok ? `ligada: ${pagina.name}` : (r && r.error ? explicar(r.error) + (r.error.code === 200 || r.error.code === 10 ? ' — o token precisa da permissão pages_manage_metadata.' : '') : 'não consegui ligar') });
        }
      }
      if (eu.ok && !igId) {
        // a conta do Instagram precisa pedir os avisos de mensagens para este app
        const r = await instagram(env, 'me/subscribed_apps?subscribed_fields=messages,message_reactions,messaging_seen', { method: 'POST' });
        passos.push({ item: 'Instagram manda as mensagens diretas para este app', ok: r.ok, detalhe: r.ok ? 'ligado' : r.erro });
      }
    }
    // ok: o diagnóstico rodou; tudoCerto: todos os itens passaram (o app mostra cada item com ✓ ou ✗)
    return json({ ok: true, tudoCerto: passos.every((p) => p.ok), passos });
  }

  if (request.method === 'GET' && caminho === '/api/conversas') {
    const estado = url.searchParams.get('estado');
    const busca = (url.searchParams.get('busca') || '').trim();
    let sql = 'SELECT * FROM conversas';
    const cond = []; const args = [];
    if (estado === 'aberta' || estado === 'resolvida') { cond.push('estado = ?'); args.push(estado); }
    const canal = url.searchParams.get('canal');
    if (canal === 'whatsapp' || canal === 'instagram') { cond.push('canal = ?'); args.push(canal); }
    if (busca) { cond.push('(nome LIKE ? OR usuario LIKE ? OR wa_id LIKE ?)'); args.push(`%${busca}%`, `%${busca.replace(/^@/, '')}%`, `%${busca.replace(/\D/g, '') || busca}%`); }
    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY ultima_msg_em DESC LIMIT 300';
    const { results } = await db.prepare(sql).bind(...args).all();
    const naoLidas = await db.prepare("SELECT COALESCE(SUM(nao_lidas), 0) AS n FROM conversas WHERE estado = 'aberta'").first();
    return json({ ok: true, conversas: results, naoLidas: naoLidas ? naoLidas.n : 0, agora: agora() });
  }

  if (partes[0] === 'api' && partes[1] === 'conversas' && partes[2]) {
    const waId = partes[2].startsWith('ig_') ? 'ig_' + partes[2].slice(3).replace(/\D/g, '') : partes[2].replace(/\D/g, '');
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
      if (ehInstagram(waId)) {
        if (env.IG_TOKEN) await instagram(env, 'me/messages', { method: 'POST', body: JSON.stringify({ recipient: { id: waId.slice(3) }, sender_action: 'mark_seen' }) }).catch(() => {});
      } else if (ultima && env.WHATSAPP_TOKEN) {
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
    const existe = await db.prepare('SELECT midia_mime, midia_url FROM mensagens WHERE midia_id = ?').bind(midiaId).first();
    if (!existe) return erro(404, 'Mídia não encontrada.');
    if (existe.midia_url) {
      const arq = await fetch(existe.midia_url);
      if (!arq.ok) return erro(502, 'O Instagram não entregou o arquivo (ele pode ter expirado).');
      return new Response(arq.body, { headers: { 'Content-Type': arq.headers.get('Content-Type') || existe.midia_mime || 'application/octet-stream', 'Cache-Control': 'no-store' } });
    }
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
<p class="data">Atendimento Urbano Norte (WhatsApp e Instagram) — Urbano Norte, transporte por aplicativo, Rio Verde-GO. Atualizada em 25/11/2026.</p>
<p>Esta política explica como a Urbano Norte trata os dados de quem conversa com a empresa pelo WhatsApp ou pelas mensagens diretas do Instagram, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>
<h2>Quais dados usamos</h2>
<p>Quando você manda mensagem para o WhatsApp ou para o direct do Instagram da Urbano Norte, recebemos pelas plataformas oficiais da Meta: seu número de telefone (WhatsApp) ou seu nome de usuário e identificador (Instagram), o nome do seu perfil, o conteúdo das mensagens (texto, fotos, áudios, documentos e localização que você enviar) e a data e hora de cada mensagem.</p>
<h2>Para que usamos</h2>
<p>Somente para responder ao seu atendimento (dúvidas, objetos esquecidos, reclamações, informações sobre corridas) e, quando você autorizar, para enviar comunicados da Urbano Norte. Não vendemos nem compartilhamos seus dados com terceiros para fins de publicidade.</p>
<h2>Onde ficam e por quanto tempo</h2>
<p>As conversas ficam guardadas em servidor seguro, acessado apenas pela equipe de atendimento da Urbano Norte com chave de acesso. Mantemos o histórico enquanto for necessário para o atendimento e para obrigações legais. Arquivos de mídia ficam com a Meta e expiram conforme as regras do WhatsApp e do Instagram.</p>
<h2 id="exclusao">Seus direitos e como apagar seus dados</h2>
<p>Você pode pedir a qualquer momento: acesso, correção ou exclusão dos seus dados, ou deixar de receber comunicados. Basta enviar uma mensagem para o WhatsApp ou para o direct do Instagram da Urbano Norte dizendo, por exemplo, "quero apagar meus dados" ou "não quero receber mensagens". Atendemos em até 15 dias.</p>
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
