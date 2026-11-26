// Testes do servidor do Atendimento: banco SQLite local no lugar do D1 e uma Meta falsa no lugar da Graph API.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import servidor, { lerMensagemMeta } from '../src/index.js';

const { D1Local } = createRequire(import.meta.url)('../d1-local.cjs');
const SEGREDO = 'segredo-do-app';
const CHAVE = 'chave-do-escritorio';

function ambiente() {
  return { DB: new D1Local(), APP_SECRET: SEGREDO, VERIFY_TOKEN: 'combinado', WHATSAPP_TOKEN: 'TOKEN', CHAVE_APP: CHAVE, PHONE_NUMBER_ID: '999' };
}
const chamar = (env, caminho, opcoes = {}) => servidor.fetch(new Request('https://atendimento.exemplo' + caminho, opcoes), env, null);
const api = (env, caminho, opcoes = {}) => chamar(env, caminho, { ...opcoes, headers: { Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });

function webhook(env, corpo, assinatura) {
  const bruto = JSON.stringify(corpo);
  const sig = assinatura ?? 'sha256=' + createHmac('sha256', SEGREDO).update(bruto).digest('hex');
  return chamar(env, '/webhook', { method: 'POST', body: bruto, headers: { 'X-Hub-Signature-256': sig, 'Content-Type': 'application/json' } });
}
const mensagemCliente = (id, texto, { de = '556492937604', nome = 'Maria', quando = Math.floor(Date.now() / 1000) } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: '999' },
    contacts: [{ wa_id: de, profile: { name: nome } }],
    messages: [{ id, from: de, timestamp: String(quando), type: 'text', text: { body: texto } }],
  } }] }],
});
const statusMeta = (id, status, errors) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id, status, recipient_id: '556492937604', ...(errors ? { errors } : {}) }] } }] }] });

// Meta falsa: registra as chamadas e responde como a Graph API
function metaFalsa(resposta = { messages: [{ id: 'wamid.SAIDA1' }] }) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push({ url: String(url), corpo: op.body ? JSON.parse(op.body) : null, auth: op.headers && op.headers.Authorization });
    return new Response(JSON.stringify(resposta), { status: resposta.error ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

test('confirmação do webhook pela Meta: só responde com a palavra combinada', async () => {
  const env = ambiente();
  const ok = await chamar(env, '/webhook?hub.mode=subscribe&hub.verify_token=combinado&hub.challenge=12345');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await ok.text(), '12345');
  assert.strictEqual((await chamar(env, '/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1')).status, 403);
});

test('webhook com assinatura errada é recusado e nada é gravado', async () => {
  const env = ambiente();
  const r = await webhook(env, mensagemCliente('wamid.A', 'oi'), 'sha256=' + '0'.repeat(64));
  assert.strictEqual(r.status, 401);
  const lista = await (await api(env, '/api/conversas')).json();
  assert.strictEqual(lista.conversas.length, 0);
});

test('mensagem do cliente cria a conversa, conta como não lida e não duplica se a Meta reenviar', async () => {
  const env = ambiente();
  assert.strictEqual((await webhook(env, mensagemCliente('wamid.A', 'Oi, preciso de ajuda'))).status, 200);
  await webhook(env, mensagemCliente('wamid.A', 'Oi, preciso de ajuda')); // reenvio
  await webhook(env, mensagemCliente('wamid.B', 'Meu motorista não chegou'));
  const lista = await (await api(env, '/api/conversas')).json();
  assert.strictEqual(lista.conversas.length, 1);
  const c = lista.conversas[0];
  assert.strictEqual(c.nome, 'Maria');
  assert.strictEqual(c.nao_lidas, 2);
  assert.strictEqual(c.previa, 'Meu motorista não chegou');
  assert.strictEqual(lista.naoLidas, 2);
  const msgs = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  assert.deepStrictEqual(msgs.mensagens.map((m) => m.texto), ['Oi, preciso de ajuda', 'Meu motorista não chegou']);
});

test('API sem a chave do escritório é recusada', async () => {
  const env = ambiente();
  assert.strictEqual((await chamar(env, '/api/conversas')).status, 401);
  assert.strictEqual((await chamar(env, '/api/conversas', { headers: { Authorization: 'Bearer outra' } })).status, 401);
});

test('responder: envia pela Meta com o token do servidor, grava a saída e acompanha entregue/lida', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.A', 'Oi'));
  const meta = metaFalsa();
  try {
    const r = await (await api(env, '/api/conversas/556492937604/enviar', { method: 'POST', body: JSON.stringify({ texto: 'Olá Maria! Já vamos ver.', operador: 'Rayan' }) })).json();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(meta.chamadas[0].url, 'https://graph.facebook.com/v27.0/999/messages');
    assert.strictEqual(meta.chamadas[0].auth, 'Bearer TOKEN');
    assert.deepStrictEqual(meta.chamadas[0].corpo.text, { preview_url: false, body: 'Olá Maria! Já vamos ver.' });
    assert.strictEqual(r.mensagem.status, 'enviada');
    assert.strictEqual(r.mensagem.operador, 'Rayan');
  } finally { meta.restaurar(); }
  await webhook(env, statusMeta('wamid.SAIDA1', 'read'));
  await webhook(env, statusMeta('wamid.SAIDA1', 'delivered')); // chegou atrasado: não pode voltar de "lida" para "entregue"
  const msgs = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  const saida = msgs.mensagens.find((m) => m.id === 'wamid.SAIDA1');
  assert.strictEqual(saida.status, 'lida');
  assert.strictEqual(msgs.conversa.previa, 'Olá Maria! Já vamos ver.');
});

test('falha de entrega aparece explicada em português', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.A', 'Oi'));
  const meta = metaFalsa();
  try { await api(env, '/api/conversas/556492937604/enviar', { method: 'POST', body: JSON.stringify({ texto: 'teste' }) }); } finally { meta.restaurar(); }
  await webhook(env, statusMeta('wamid.SAIDA1', 'failed', [{ code: 130497, title: 'Business account is restricted from messaging users in this country.' }]));
  const msgs = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  const saida = msgs.mensagens.find((m) => m.id === 'wamid.SAIDA1');
  assert.strictEqual(saida.status, 'falhou');
  assert.match(saida.erro, /estrangeiro/);
});

test('fora da janela de 24 h não deixa responder com texto livre (nem chama a Meta)', async () => {
  const env = ambiente();
  const ontem = Math.floor((Date.now() - 25 * 3600 * 1000) / 1000);
  await webhook(env, mensagemCliente('wamid.VELHA', 'Oi', { quando: ontem }));
  const meta = metaFalsa();
  try {
    const r = await api(env, '/api/conversas/556492937604/enviar', { method: 'POST', body: JSON.stringify({ texto: 'oi' }) });
    assert.strictEqual(r.status, 409);
    assert.match((await r.json()).erro, /24 h/);
    assert.strictEqual(meta.chamadas.length, 0);
  } finally { meta.restaurar(); }
});

test('ler mensagens só do que mudou (desde) e marcar como lida / resolver / reabrir', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.A', 'primeira'));
  const r1 = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  await new Promise((r) => setTimeout(r, 5));
  await webhook(env, mensagemCliente('wamid.B', 'segunda'));
  const r2 = await (await api(env, `/api/conversas/556492937604/mensagens?desde=${r1.agora}`)).json();
  assert.deepStrictEqual(r2.mensagens.map((m) => m.texto), ['segunda']);

  const meta = metaFalsa({ success: true });
  try {
    await api(env, '/api/conversas/556492937604/lida', { method: 'POST' });
    assert.deepStrictEqual(meta.chamadas[0].corpo, { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.B' });
  } finally { meta.restaurar(); }
  let c = (await (await api(env, '/api/conversas')).json()).conversas[0];
  assert.strictEqual(c.nao_lidas, 0);

  await api(env, '/api/conversas/556492937604/resolver', { method: 'POST' });
  assert.strictEqual((await (await api(env, '/api/conversas?estado=aberta')).json()).conversas.length, 0);
  await webhook(env, mensagemCliente('wamid.C', 'voltei')); // cliente escreveu de novo: reabre sozinha
  c = (await (await api(env, '/api/conversas?estado=aberta')).json()).conversas[0];
  assert.strictEqual(c.estado, 'aberta');
});

test('busca por nome ou número', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.A', 'oi', { de: '556492937604', nome: 'Maria' }));
  await webhook(env, mensagemCliente('wamid.B', 'oi', { de: '556299990000', nome: 'João' }));
  assert.deepStrictEqual((await (await api(env, '/api/conversas?busca=jo')).json()).conversas.map((c) => c.nome), ['João']);
  assert.deepStrictEqual((await (await api(env, '/api/conversas?busca=9293')).json()).conversas.map((c) => c.nome), ['Maria']);
});

test('converte os tipos de mensagem da Meta', () => {
  assert.deepStrictEqual(lerMensagemMeta({ id: 'x', from: '55', timestamp: '1', type: 'image', image: { id: 'M1', mime_type: 'image/jpeg', caption: 'comprovante' } }).midia, { id: 'M1', mime: 'image/jpeg', nome: null });
  assert.match(lerMensagemMeta({ id: 'x', from: '55', timestamp: '1', type: 'location', location: { latitude: -17.8, longitude: -50.9, name: 'Rodoviária' } }).texto, /Rodoviária.*maps\.google/);
  assert.strictEqual(lerMensagemMeta({ id: 'x', from: '55', timestamp: '1', type: 'interactive', interactive: { button_reply: { title: 'Sim' } } }).texto, 'Sim');
  assert.strictEqual(lerMensagemMeta({ id: 'x', from: '55', timestamp: '1', type: 'audio', audio: { id: 'A1' } }).texto, null);
});

test('foto do cliente: o app baixa pelo servidor, que busca na Meta com o token', async () => {
  const env = ambiente();
  const corpo = mensagemCliente('wamid.F', '');
  corpo.entry[0].changes[0].value.messages[0] = { id: 'wamid.F', from: '556492937604', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'MIDIA1', mime_type: 'image/jpeg' } };
  await webhook(env, corpo);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).endsWith('/MIDIA1')
    ? new Response(JSON.stringify({ url: 'https://lookaside.exemplo/arquivo', mime_type: 'image/jpeg' }), { status: 200 })
    : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  try {
    const r = await api(env, '/api/midia/MIDIA1');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('Content-Type'), 'image/jpeg');
    assert.deepStrictEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
    assert.strictEqual((await api(env, '/api/midia/OUTRA')).status, 404); // só mídias que estão no banco
  } finally { globalThis.fetch = original; }
  const c = (await (await api(env, '/api/conversas')).json()).conversas[0];
  assert.strictEqual(c.previa, '📷 Foto');
});

test('página pública de privacidade (exigida pela Meta)', async () => {
  const r = await chamar(ambiente(), '/privacidade');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(await r.text(), /apagar seus dados/);
});

test('diagnóstico: confere o token e liga a conta do WhatsApp ao app quando falta', async () => {
  const env = { ...ambiente(), WABA_ID: '777' };
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push(`${op.method || 'GET'} ${String(url).replace('https://graph.facebook.com/v27.0/', '')}`);
    if (String(url).includes('fields=')) return Response.json({ display_phone_number: '+1 555 0100', verified_name: 'Test Number' });
    if (String(url).endsWith('/subscribed_apps') && (op.method || 'GET') === 'GET') return Response.json({ data: [] });
    return Response.json({ success: true });
  };
  try {
    const r = await (await api(env, '/api/diagnostico', { method: 'POST' })).json();
    assert.strictEqual(r.tudoCerto, true);
    assert.deepStrictEqual(chamadas, ['GET 999?fields=display_phone_number,verified_name', 'GET 777/subscribed_apps', 'POST 777/subscribed_apps']);
    assert.match(r.passos[1].detalhe, /ligada agora/);
  } finally { globalThis.fetch = original; }
});

test('diagnóstico: token vencido aparece explicado', async () => {
  const env = { ...ambiente(), WABA_ID: '777' };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 401 });
  try {
    const r = await (await api(env, '/api/diagnostico', { method: 'POST' })).json();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tudoCerto, false);
    assert.match(r.passos[0].detalhe, /token/i);
  } finally { globalThis.fetch = original; }
});

// ---------- Instagram (mensagens diretas) ----------
const IG_EMPRESA = '17841400000000000';
const dmInstagram = (eventos) => ({ object: 'instagram', entry: [{ id: IG_EMPRESA, time: Date.now(), messaging: eventos }] });
const dm = (de, mid, extra = {}) => ({ sender: { id: de }, recipient: { id: IG_EMPRESA }, timestamp: Date.now(), message: { mid, ...extra } });

test('Instagram: DM vira conversa com canal, nome e @ (buscados no perfil)', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'IGTOKEN' };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('graph.instagram.com') && String(url).includes('fields=name,username')
    ? Response.json({ name: 'Bia Souza', username: 'bia.souza' }) : original(url);
  try {
    await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi! Vocês atendem em Montividiu?' })]));
  } finally { globalThis.fetch = original; }
  const c = (await (await api(env, '/api/conversas')).json()).conversas[0];
  assert.strictEqual(c.wa_id, 'ig_900');
  assert.strictEqual(c.canal, 'instagram');
  assert.strictEqual(c.nome, 'Bia Souza');
  assert.strictEqual(c.usuario, 'bia.souza');
  assert.strictEqual(c.nao_lidas, 1);
  const so = (await (await api(env, '/api/conversas?canal=instagram')).json()).conversas.length;
  const nenhuma = (await (await api(env, '/api/conversas?canal=whatsapp')).json()).conversas.length;
  assert.deepStrictEqual([so, nenhuma], [1, 0]);
  assert.strictEqual((await (await api(env, '/api/conversas?busca=@bia')).json()).conversas.length, 1);
});

test('Instagram: responder sai pela API do Instagram e "lida" vira visto no direct', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'IGTOKEN' };
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push({ url: String(url), corpo: op.body ? JSON.parse(op.body) : null, auth: op.headers && op.headers.Authorization });
    return Response.json({ recipient_id: '900', message_id: 'ig.mid.SAIDA' });
  };
  try {
    const r = await (await api(env, '/api/conversas/ig_900/enviar', { method: 'POST', body: JSON.stringify({ texto: 'Atendemos sim!', operador: 'Rayan' }) })).json();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(chamadas[0].url, 'https://graph.instagram.com/v27.0/me/messages');
    assert.strictEqual(chamadas[0].auth, 'Bearer IGTOKEN');
    assert.deepStrictEqual(chamadas[0].corpo, { recipient: { id: '900' }, message: { text: 'Atendemos sim!' } });
    await api(env, '/api/conversas/ig_900/lida', { method: 'POST' });
    assert.deepStrictEqual(chamadas[1].corpo, { recipient: { id: '900' }, sender_action: 'mark_seen' });
  } finally { globalThis.fetch = original; }
  // o próprio Instagram devolve o eco da nossa mensagem: não duplica
  await webhook(env, dmInstagram([{ sender: { id: IG_EMPRESA }, recipient: { id: '900' }, timestamp: Date.now(), message: { mid: 'ig.mid.SAIDA', text: 'Atendemos sim!', is_echo: true } }]));
  // cliente viu a mensagem
  await webhook(env, dmInstagram([{ sender: { id: '900' }, recipient: { id: IG_EMPRESA }, timestamp: Date.now(), read: { mid: 'ig.mid.SAIDA' } }]));
  const msgs = (await (await api(env, '/api/conversas/ig_900/mensagens')).json()).mensagens;
  assert.strictEqual(msgs.filter((m) => m.direcao === 'saida').length, 1);
  assert.strictEqual(msgs.find((m) => m.id === 'ig.mid.SAIDA').status, 'lida');
});

test('Instagram: resposta mandada pelo celular (eco) aparece na conversa como saída', async () => {
  const env = ambiente();
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  await webhook(env, dmInstagram([{ sender: { id: IG_EMPRESA }, recipient: { id: '900' }, timestamp: Date.now(), message: { mid: 'ig.mid.CEL', text: 'Respondi pelo celular', is_echo: true } }]));
  const msgs = (await (await api(env, '/api/conversas/ig_900/mensagens')).json()).mensagens;
  const eco = msgs.find((m) => m.id === 'ig.mid.CEL');
  assert.strictEqual(eco.direcao, 'saida');
  assert.strictEqual(eco.operador, 'pelo app do Instagram');
});

test('Instagram: áudio, foto, menção no Story e resposta ao Story', async () => {
  const env = ambiente();
  await webhook(env, dmInstagram([
    dm('900', 'ig.mid.A', { attachments: [{ type: 'audio', payload: { url: 'https://cdn.exemplo/audio.mp4' } }] }),
    dm('900', 'ig.mid.F', { attachments: [{ type: 'image', payload: { url: 'https://cdn.exemplo/foto.jpg' } }] }),
    dm('900', 'ig.mid.S', { attachments: [{ type: 'story_mention', payload: { url: 'https://cdn.exemplo/story' } }] }),
    dm('900', 'ig.mid.R', { text: 'Que legal!', reply_to: { story: { id: '1', url: 'https://cdn.exemplo/s' } } }),
  ]));
  const msgs = (await (await api(env, '/api/conversas/ig_900/mensagens')).json()).mensagens;
  const por = Object.fromEntries(msgs.map((m) => [m.id, m]));
  assert.strictEqual(por['ig.mid.A'].tipo, 'audio');
  assert.strictEqual(por['ig.mid.A'].midia_url, 'https://cdn.exemplo/audio.mp4');
  assert.strictEqual(por['ig.mid.F'].tipo, 'image');
  assert.match(por['ig.mid.S'].texto, /Mencionou vocês no Story/);
  assert.strictEqual(por['ig.mid.R'].texto, '↩ Respondeu ao seu Story: Que legal!');
  // o app baixa o áudio pelo servidor (link direto do Instagram)
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(new Uint8Array([7, 7]), { status: 200, headers: { 'Content-Type': 'audio/mp4' } });
  try {
    const r = await api(env, `/api/midia/${por['ig.mid.A'].midia_id}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('Content-Type'), 'audio/mp4');
  } finally { globalThis.fetch = original; }
});

test('Instagram: webhook assinado com a chave do app do Instagram também é aceito', async () => {
  const env = { ...ambiente(), APP_SECRET: 'outra', IG_APP_SECRET: SEGREDO };
  const r = await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  assert.strictEqual(r.status, 200);
});

test('Instagram sem IG_TOKEN: avisa ao tentar responder', async () => {
  const env = ambiente();
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  const r = await api(env, '/api/conversas/ig_900/enviar', { method: 'POST', body: JSON.stringify({ texto: 'oi' }) });
  assert.strictEqual(r.status, 503);
  assert.match((await r.json()).erro, /Instagram/);
});

test('Instagram com login unificado (IG_ID): envia por graph.facebook.com/{IG_ID}/messages', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'EAASUAT', IG_ID: '17841400000000000' };
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op = {}) => { chamadas.push(String(url)); return Response.json({ recipient_id: '900', message_id: 'ig.mid.X' }); };
  try {
    const r = await (await api(env, '/api/conversas/ig_900/enviar', { method: 'POST', body: JSON.stringify({ texto: 'oi' }) })).json();
    assert.strictEqual(r.ok, true);
    // sem Página encontrada, cai no envio direto pela conta do Instagram
    assert.ok(chamadas.includes('https://graph.facebook.com/v27.0/17841400000000000/messages'), chamadas.join('\n'));
  } finally { globalThis.fetch = original; }
});

test('Instagram com token do Facebook (EAA): descobre a Página e responde pela Página com o token dela', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'EAAxyz' };
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push({ url: String(url), auth: op.headers && op.headers.Authorization });
    if (String(url).includes('/me/accounts')) return Response.json({ data: [{ id: 'PAGINA', access_token: 'TOKEN_DA_PAGINA', instagram_business_account: { id: '1784199', username: 'urbanorioverde' } }] });
    return Response.json({ recipient_id: '900', message_id: 'ig.mid.Y' });
  };
  try {
    const r = await (await api(env, '/api/conversas/ig_900/enviar', { method: 'POST', body: JSON.stringify({ texto: 'oi' }) })).json();
    assert.strictEqual(r.ok, true);
    const envio = chamadas.find((c) => c.url.endsWith('/messages'));
    assert.strictEqual(envio.url, 'https://graph.facebook.com/v27.0/PAGINA/messages');
    assert.strictEqual(envio.auth, 'Bearer TOKEN_DA_PAGINA');
  } finally { globalThis.fetch = original; }
});

test('Instagram: aceita também o formato "changes" (usado no teste do painel da Meta)', async () => {
  const env = ambiente();
  const r = await webhook(env, { object: 'instagram', entry: [{ id: '23245', time: 1, changes: [{ field: 'messages', value: { sender: { id: '12334' }, recipient: { id: '23245' }, timestamp: '1527459824', message: { mid: 'random_mid', text: 'random_text' } } }] }] });
  assert.strictEqual(r.status, 200);
  const c = (await (await api(env, '/api/conversas')).json()).conversas;
  assert.strictEqual(c[0].wa_id, 'ig_12334');
  assert.strictEqual(c[0].previa, 'random_text');
});

test('Instagram: token IG… ignora o IG_ID e usa graph.instagram.com/me', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'IGAAxyz', IG_ID: '17841400000000000' };
  await webhook(env, dmInstagram([dm('900', 'ig.mid.1', { text: 'Oi' })]));
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { chamadas.push(String(url)); return Response.json({ recipient_id: '900', message_id: 'ig.mid.Z' }); };
  try {
    await api(env, '/api/conversas/ig_900/enviar', { method: 'POST', body: JSON.stringify({ texto: 'oi' }) });
    assert.strictEqual(chamadas[0], 'https://graph.instagram.com/v27.0/me/messages');
  } finally { globalThis.fetch = original; }
});

test('Instagram: perfil (nome e @) é buscado com o token da Página', async () => {
  const env = { ...ambiente(), IG_TOKEN: 'EAAperfil' };
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push({ url: String(url), auth: op.headers && op.headers.Authorization });
    if (String(url).includes('/me/accounts')) return Response.json({ data: [{ id: 'PAG', access_token: 'TOK_PAG', instagram_business_account: { id: '1784' } }] });
    if (String(url).includes('fields=name,username')) return Response.json({ name: 'Rayan', username: '_rayanluiz.kk' });
    return Response.json({ data: [] });
  };
  try {
    await webhook(env, dmInstagram([dm('555', 'ig.mid.P', { text: 'Oi' })]));
  } finally { globalThis.fetch = original; }
  const c = (await (await api(env, '/api/conversas')).json()).conversas.find((x) => x.wa_id === 'ig_555');
  assert.strictEqual(c.nome, 'Rayan');
  assert.strictEqual(c.usuario, '_rayanluiz.kk');
  assert.strictEqual(chamadas.find((x) => x.url.includes('fields=name,username')).auth, 'Bearer TOK_PAG');
});
