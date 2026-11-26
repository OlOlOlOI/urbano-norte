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
const jsonPost = (corpo, token) => ({ method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
// Na primeira chamada de cada ambiente, cria o administrador (com a chave de instalação) e guarda a sessão.
async function sessaoAdmin(env) {
  if (!env.__token) env.__token = (await (await chamar(env, '/api/conta/primeiro-admin', jsonPost({ chave: CHAVE, nome: 'Rayan', usuario: 'rayan', senha: 'senha-do-rayan' }))).json()).token;
  return env.__token;
}
const api = async (env, caminho, opcoes = {}) => chamar(env, caminho, { ...opcoes, headers: { Authorization: `Bearer ${await sessaoAdmin(env)}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });

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
  assert.strictEqual(por['ig.mid.S'], undefined, 'menção no Story não entra no Atendimento');
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

test('Instagram: conversa feita só de menção no Story nem aparece', async () => {
  const env = ambiente();
  await webhook(env, dmInstagram([dm('777', 'ig.mid.SO', { attachments: [{ type: 'story_mention', payload: { url: 'https://cdn.exemplo/s' } }] })]));
  const c = (await (await api(env, '/api/conversas')).json()).conversas;
  assert.strictEqual(c.length, 0);
});

test('conversas resolvidas há mais de 3 dias somem da lista, mas a busca ainda acha', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.V', 'oi', { de: '556411110000', nome: 'Antiga' }));
  await webhook(env, mensagemCliente('wamid.N', 'oi', { de: '556422220000', nome: 'Nova' }));
  await api(env, '/api/conversas/556411110000/resolver', { method: 'POST' });
  await env.DB.prepare('UPDATE conversas SET atualizada_em = ? WHERE wa_id = ?').bind(Date.now() - 4 * 24 * 3600 * 1000, '556411110000').run();
  const todas = (await (await api(env, '/api/conversas')).json()).conversas.map((c) => c.nome);
  assert.deepStrictEqual(todas, ['Nova']);
  const busca = (await (await api(env, '/api/conversas?busca=Antiga')).json()).conversas.map((c) => c.nome);
  assert.deepStrictEqual(busca, ['Antiga']);
});

test('apelido dado pela equipe: salva, busca, sobrevive a mensagem nova e pode ser apagado', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.AP1', 'oi'));
  let r = await (await api(env, '/api/conversas/556492937604/apelido', { method: 'POST', body: JSON.stringify({ apelido: '  Motorista   Carlos ' }) })).json();
  assert.strictEqual(r.apelido, 'Motorista Carlos');
  assert.strictEqual((await (await api(env, '/api/conversas?busca=carlos')).json()).conversas.length, 1);
  await webhook(env, mensagemCliente('wamid.AP2', 'de novo'));
  let c = (await (await api(env, '/api/conversas')).json()).conversas[0];
  assert.strictEqual(c.apelido, 'Motorista Carlos');
  r = await (await api(env, '/api/conversas/556492937604/apelido', { method: 'POST', body: JSON.stringify({ apelido: '' }) })).json();
  assert.strictEqual(r.apelido, null);
  const nada = await api(env, '/api/conversas/550000000000/apelido', { method: 'POST', body: JSON.stringify({ apelido: 'x' }) });
  assert.strictEqual(nada.status, 404);
});

// ---------- contas da equipe (login) ----------
const comToken = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const entrar = async (env, usuario, senha) => chamar(env, '/api/conta/entrar', jsonPost({ usuario, senha, dispositivo: 'PC-TESTE' }));

test('primeiro administrador: só com a chave de instalação e só uma vez', async () => {
  const env = ambiente();
  assert.deepStrictEqual(await (await chamar(env, '/api/conta/estado')).json(), { ok: true, temContas: false });
  const errada = await chamar(env, '/api/conta/primeiro-admin', jsonPost({ chave: 'outra', nome: 'X', usuario: 'xxx', senha: '12345678' }));
  assert.strictEqual(errada.status, 401);
  const curta = await chamar(env, '/api/conta/primeiro-admin', jsonPost({ chave: CHAVE, nome: 'Rayan', usuario: 'rayan', senha: '123' }));
  assert.strictEqual(curta.status, 400);
  const ok = await (await chamar(env, '/api/conta/primeiro-admin', jsonPost({ chave: CHAVE, nome: 'Rayan', usuario: 'Rayan', senha: 'senha-do-rayan' }))).json();
  assert.strictEqual(ok.usuario.usuario, 'rayan');
  assert.strictEqual(ok.usuario.papel, 'admin');
  assert.match(ok.token, /^[a-f0-9]{64}$/);
  const de_novo = await chamar(env, '/api/conta/primeiro-admin', jsonPost({ chave: CHAVE, nome: 'Outro', usuario: 'outro', senha: 'senha-do-outro' }));
  assert.strictEqual(de_novo.status, 409);
  assert.strictEqual((await (await chamar(env, '/api/conta/estado')).json()).temContas, true);
  // a chave de instalação não abre mais o Atendimento
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(CHAVE))).status, 401);
  // senha guardada só como hash, e o token também
  const linha = env.DB.db.prepare('SELECT senha_hash FROM usuarios').get();
  assert.ok(linha.senha_hash.startsWith('pbkdf2$') && !linha.senha_hash.includes('senha-do-rayan'));
  assert.strictEqual(env.DB.db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE token_hash = ?').get(ok.token).n, 0);
});

test('entrar: senha errada não diz se o usuário existe; 5 erros bloqueiam; o admin trocando a senha desbloqueia', async () => {
  const env = ambiente();
  await sessaoAdmin(env);
  const r1 = await entrar(env, 'rayan', 'errada');
  const r2 = await entrar(env, 'ninguem', 'errada');
  assert.strictEqual(r1.status, 401);
  assert.strictEqual((await r1.json()).erro, (await r2.json()).erro);
  const criado = await (await api(env, '/api/equipe', { method: 'POST', body: JSON.stringify({ nome: 'Maria Silva', usuario: 'maria', senha: 'senha-da-maria' }) })).json();
  for (let i = 0; i < 5; i++) await entrar(env, 'maria', 'errada');
  const bloqueada = await entrar(env, 'maria', 'senha-da-maria');
  assert.strictEqual(bloqueada.status, 429);
  assert.match((await bloqueada.json()).erro, /Muitas tentativas/);
  await api(env, `/api/equipe/${criado.usuario.id}`, { method: 'POST', body: JSON.stringify({ senha: 'nova-senha-maria' }) });
  const ok = await (await entrar(env, 'MARIA ', 'nova-senha-maria')).json();
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.usuario.nome, 'Maria Silva');
});

test('atendente: usa o Atendimento, não mexe na equipe; a resposta sai com o nome da conta', async () => {
  const env = ambiente();
  await api(env, '/api/equipe', { method: 'POST', body: JSON.stringify({ nome: 'Maria Silva', usuario: 'maria', senha: 'senha-da-maria', papel: 'atendente' }) });
  const { token } = await (await entrar(env, 'maria', 'senha-da-maria')).json();
  assert.strictEqual((await chamar(env, '/api/equipe', comToken(token))).status, 403);
  assert.strictEqual((await chamar(env, '/api/diagnostico', { method: 'POST', ...comToken(token) })).status, 403);
  await webhook(env, mensagemCliente('wamid.L1', 'oi'));
  const meta = metaFalsa();
  try {
    const r = await chamar(env, '/api/conversas/556492937604/enviar', { ...jsonPost({ texto: 'Olá!', operador: 'Outra pessoa' }, token) });
    assert.strictEqual(r.status, 200);
  } finally { meta.restaurar(); }
  const msgs = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  assert.strictEqual(msgs.mensagens.find((m) => m.direcao === 'saida').operador, 'Maria Silva');
  const eu = await (await chamar(env, '/api/conta/eu', comToken(token))).json();
  assert.strictEqual(eu.usuario.papel, 'atendente');
});

test('desativar alguém derruba o acesso na hora; sair encerra só aquela sessão', async () => {
  const env = ambiente();
  const { usuario } = await (await api(env, '/api/equipe', { method: 'POST', body: JSON.stringify({ nome: 'João', usuario: 'joao', senha: 'senha-do-joao' }) })).json();
  const a = (await (await entrar(env, 'joao', 'senha-do-joao')).json()).token;
  const b = (await (await entrar(env, 'joao', 'senha-do-joao')).json()).token;
  await chamar(env, '/api/conta/sair', { method: 'POST', ...comToken(a) });
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(a))).status, 401);
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(b))).status, 200);
  await api(env, `/api/equipe/${usuario.id}`, { method: 'POST', body: JSON.stringify({ ativo: false }) });
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(b))).status, 401);
  assert.strictEqual((await entrar(env, 'joao', 'senha-do-joao')).status, 403);
  const lista = await (await api(env, '/api/equipe')).json();
  assert.deepStrictEqual(lista.equipe.map((u) => [u.usuario, u.ativo]), [['rayan', true], ['joao', false]]);
  assert.ok(!('senha_hash' in lista.equipe[0]));
});

test('admin não tira o próprio acesso; usuário repetido é recusado', async () => {
  const env = ambiente();
  const eu = (await (await api(env, '/api/conta/eu')).json()).usuario;
  assert.strictEqual((await api(env, `/api/equipe/${eu.id}`, { method: 'POST', body: JSON.stringify({ papel: 'atendente' }) })).status, 400);
  assert.strictEqual((await api(env, `/api/equipe/${eu.id}`, { method: 'POST', body: JSON.stringify({ ativo: false }) })).status, 400);
  assert.strictEqual((await api(env, '/api/equipe', { method: 'POST', body: JSON.stringify({ nome: 'R', usuario: 'rayan', senha: 'qualquer-coisa' }) })).status, 409);
  assert.strictEqual((await api(env, '/api/equipe', { method: 'POST', body: JSON.stringify({ nome: 'R', usuario: 'com espaço', senha: 'qualquer-coisa' }) })).status, 400);
});

test('trocar a própria senha: confere a atual e tira as outras sessões', async () => {
  const env = ambiente();
  const aqui = await sessaoAdmin(env);
  const outro = (await (await entrar(env, 'rayan', 'senha-do-rayan')).json()).token;
  assert.strictEqual((await chamar(env, '/api/conta/senha', jsonPost({ atual: 'errada', nova: 'nova-senha-123' }, aqui))).status, 400);
  assert.strictEqual((await chamar(env, '/api/conta/senha', jsonPost({ atual: 'senha-do-rayan', nova: 'nova-senha-123' }, aqui))).status, 200);
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(aqui))).status, 200);
  assert.strictEqual((await chamar(env, '/api/conversas', comToken(outro))).status, 401);
  assert.strictEqual((await entrar(env, 'rayan', 'nova-senha-123')).status, 200);
});

test('sessão vencida (30 dias sem uso) pede login de novo', async () => {
  const env = ambiente();
  const token = await sessaoAdmin(env);
  env.DB.db.prepare('UPDATE sessoes SET expira_em = ?').run(Date.now() - 1);
  const r = await chamar(env, '/api/conversas', comToken(token));
  assert.strictEqual(r.status, 401);
  assert.match((await r.json()).erro, /Entre de novo/);
});

test('botão "Não quero receber" da campanha: descadastra, confirma para a pessoa e aparece para o Disparo', async () => {
  const env = ambiente();
  const clique = mensagemCliente('wamid.SAIR1', '');
  clique.entry[0].changes[0].value.messages[0] = { id: 'wamid.SAIR1', from: '556492937604', timestamp: String(Math.floor(Date.now() / 1000)), type: 'button', button: { payload: 'SAIR_UN', text: 'Não quero receber' } };
  const meta = metaFalsa();
  try {
    await webhook(env, clique);
    await webhook(env, clique); // a Meta pode reenviar: não duplica
  } finally { meta.restaurar(); }
  const lista = await (await api(env, '/api/descadastros')).json();
  assert.deepStrictEqual(lista.descadastros.map((d) => [d.wa_id, d.origem]), [['556492937604', 'botao']]);
  const resposta = meta.chamadas.filter((c) => c.url.includes('/messages'));
  assert.strictEqual(resposta.length, 1);
  assert.match(resposta[0].corpo.text.body, /não vai mais receber/);
  const msgs = await (await api(env, '/api/conversas/556492937604/mensagens')).json();
  assert.deepStrictEqual(msgs.mensagens.map((m) => [m.direcao, m.texto.slice(0, 17), m.operador]), [['entrada', 'Não quero receber', null], ['saida', 'Pronto! Você não ', 'Automático']]);
  // outro botão qualquer não descadastra
  const outro = mensagemCliente('wamid.B2', '', { de: '556299990000' });
  outro.entry[0].changes[0].value.messages[0] = { id: 'wamid.B2', from: '556299990000', timestamp: String(Math.floor(Date.now() / 1000)), type: 'button', button: { payload: 'OUTRO', text: 'Quero saber mais' } };
  await webhook(env, outro);
  assert.strictEqual((await (await api(env, '/api/descadastros')).json()).descadastros.length, 1);
});

test('equipe manda foto e PDF pelo WhatsApp: sobe para a Meta, envia e aparece na conversa com o nome de quem mandou', async () => {
  const env = ambiente();
  await webhook(env, mensagemCliente('wamid.F0', 'me manda o comprovante?'));
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    chamadas.push({ url: u, op });
    if (u.endsWith('/media')) return Response.json({ id: 'MEDIA-77' });
    return Response.json({ messages: [{ id: `wamid.ARQ${chamadas.length}` }] });
  };
  try {
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64');
    const r = await (await api(env, '/api/conversas/556492937604/enviar-arquivo', { method: 'POST', body: JSON.stringify({ nome: 'comprovante.png', tipo: 'image/png', base64: png, legenda: 'Aqui está' }) })).json();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.mensagem.midia_id, 'MEDIA-77');
    assert.strictEqual(r.mensagem.operador, 'Rayan');
    assert.ok(chamadas[0].op.body instanceof FormData);
    const envio = JSON.parse(chamadas[1].op.body);
    assert.deepStrictEqual(envio.image, { id: 'MEDIA-77', caption: 'Aqui está' });
    const pdf = Buffer.from('%PDF-1.4 teste').toString('base64');
    const r2 = await (await api(env, '/api/conversas/556492937604/enviar-arquivo', { method: 'POST', body: JSON.stringify({ nome: 'tabela.pdf', tipo: 'application/pdf', base64: pdf }) })).json();
    assert.strictEqual(JSON.parse(chamadas[3].op.body).document.filename, 'tabela.pdf');
    assert.strictEqual(r2.mensagem.tipo, 'document');
    const ruim = await api(env, '/api/conversas/556492937604/enviar-arquivo', { method: 'POST', body: JSON.stringify({ nome: 'x.exe', tipo: 'application/x-msdownload', base64: pdf }) });
    assert.strictEqual(ruim.status, 400);
  } finally { globalThis.fetch = original; }
  const conv = (await (await api(env, '/api/conversas')).json()).conversas[0];
  assert.strictEqual(conv.previa, '📄 Documento');
});
