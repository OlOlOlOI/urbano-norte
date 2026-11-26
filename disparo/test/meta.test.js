'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarProvedorMeta, GRAPH } = require('../src/core/provider-meta');

function fetchFalso(resposta, status = 200) {
  const chamadas = [];
  const f = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    return { ok: status < 400, status, json: async () => resposta };
  };
  f.chamadas = chamadas;
  return f;
}

test('envia texto no formato da Cloud API, com token no cabeçalho e número só com dígitos', async () => {
  const f = fetchFalso({ messages: [{ id: 'wamid.ABC' }] });
  const p = criarProvedorMeta({ numeroId: '123456', token: 'TK', fetch: f });
  const r = await p.enviar({ telefone: '+5564999998888', texto: 'Oi' });
  assert.deepStrictEqual(r, { ok: true, id: 'wamid.ABC', waId: undefined });
  const c = f.chamadas[0];
  assert.strictEqual(c.url, `${GRAPH}/123456/messages`);
  assert.strictEqual(c.opcoes.method, 'POST');
  assert.strictEqual(c.opcoes.headers.Authorization, 'Bearer TK');
  assert.deepStrictEqual(c.corpo, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5564999998888', type: 'text', text: { preview_url: false, body: 'Oi' } });
  assert.strictEqual(p.simulacao, false);
});

test('envia modelo hello_world', async () => {
  const f = fetchFalso({ messages: [{ id: 'wamid.X' }] });
  await criarProvedorMeta({ numeroId: '1', token: 't', fetch: f }).enviarModelo({ telefone: '+5564999998888', modelo: 'hello_world', idioma: 'en_US' });
  assert.deepStrictEqual(f.chamadas[0].corpo.template, { name: 'hello_world', language: { code: 'en_US' } });
});

test('explica em português os erros comuns da Meta', async () => {
  const fora24h = criarProvedorMeta({ numeroId: '1', token: 't', fetch: fetchFalso({ error: { code: 131047, message: 'Re-engagement message' } }, 400) });
  assert.match((await fora24h.enviar({ telefone: '+5564999998888', texto: 'x' })).erro, /24 h/);
  const token = criarProvedorMeta({ numeroId: '1', token: 't', fetch: fetchFalso({ error: { code: 190, message: 'expired' } }, 401) });
  assert.match((await token.conferir()).erro, /token/i);
  const desconhecido = criarProvedorMeta({ numeroId: '1', token: 't', fetch: fetchFalso({ error: { code: 999, message: 'Algo' } }, 400) });
  assert.match((await desconhecido.enviar({ telefone: '+5564999998888', texto: 'x' })).erro, /Algo.*999/);
});

test('falta de internet vira mensagem clara, sem derrubar o app', async () => {
  const p = criarProvedorMeta({ numeroId: '1', token: 't', fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  const r = await p.enviar({ telefone: '+5564999998888', texto: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /internet/);
});

test('conferir devolve número e nome da conta', async () => {
  const f = fetchFalso({ display_phone_number: '+1 555 0100', verified_name: 'Test Number', quality_rating: 'GREEN' });
  const r = await criarProvedorMeta({ numeroId: '42', token: 't', fetch: f }).conferir();
  assert.deepStrictEqual(r, { ok: true, numero: '+1 555 0100', nome: 'Test Number', qualidade: 'GREEN' });
  assert.match(f.chamadas[0].url, /\/42\?fields=display_phone_number/);
});

test('recusa ID com letras e token vazio', () => {
  assert.throws(() => criarProvedorMeta({ numeroId: 'abc', token: 't' }), /só números/);
  assert.throws(() => criarProvedorMeta({ numeroId: '1', token: '' }), /token/);
});

test('celular do Brasil: se a Meta recusar como não autorizado, tenta de novo sem o 9', async () => {
  const enviados = [];
  const f = async (url, o) => {
    const c = JSON.parse(o.body); enviados.push(c.to);
    const ok = c.to === '556492937605';
    return { ok, status: ok ? 200 : 400, json: async () => (ok ? { messages: [{ id: 'wamid.OK' }] } : { error: { code: 131030, message: 'not in allowed list' } }) };
  };
  const r = await criarProvedorMeta({ numeroId: '1', token: 't', fetch: f }).enviarModelo({ telefone: '+5564992937605', modelo: 'hello_world', idioma: 'en_US' });
  assert.deepStrictEqual(enviados, ['5564992937605', '556492937605']);
  assert.strictEqual(r.ok, true);
});

test('imagem do modelo: upload retomável pelo app da Meta devolve o header_handle', async () => {
  const chamadas = [];
  const respostas = [{ data: { app_id: '777' } }, { id: 'upload:ABC' }, { h: 'HANDLE-1' }];
  const f = async (url, op) => { chamadas.push({ url, op }); return { ok: true, status: 200, json: async () => respostas.shift() }; };
  const p = criarProvedorMeta({ numeroId: '1', token: 'TK', fetch: f });
  const r = await p.subirImagemModelo({ bytes: Buffer.from('12345'), tipo: 'image/png', nome: 'arte.png' });
  assert.deepStrictEqual(r, { ok: true, handle: 'HANDLE-1' });
  assert.match(chamadas[1].url, /\/777\/uploads\?file_name=arte\.png&file_length=5&file_type=image%2Fpng$/);
  assert.strictEqual(chamadas[2].url, `${GRAPH}/upload:ABC`);
  assert.strictEqual(chamadas[2].op.headers.Authorization, 'OAuth TK');
  assert.strictEqual(chamadas[2].op.headers.file_offset, '0');
});

test('imagem do envio: sobe como mídia do número e devolve o id', async () => {
  const chamadas = [];
  const f = async (url, op) => { chamadas.push({ url, op }); return { ok: true, status: 200, json: async () => ({ id: 'MEDIA-9' }) }; };
  const p = criarProvedorMeta({ numeroId: '55', token: 'TK', fetch: f });
  const r = await p.subirMidia({ bytes: Buffer.from('x'), tipo: 'image/jpeg', nome: 'a.jpg' });
  assert.deepStrictEqual(r, { ok: true, id: 'MEDIA-9' });
  assert.strictEqual(chamadas[0].url, `${GRAPH}/55/media`);
  assert.ok(chamadas[0].op.body instanceof FormData);
  assert.strictEqual(chamadas[0].op.body.get('messaging_product'), 'whatsapp');
});

test('criar modelo com componentes prontos manda todos eles', async () => {
  const f = fetchFalso({ id: 'T1', status: 'PENDING', category: 'MARKETING' });
  const p = criarProvedorMeta({ numeroId: '1', token: 'TK', fetch: f });
  const componentes = [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['H'] } }, { type: 'BODY', text: 'Oi' }, { type: 'FOOTER', text: 'UN' }];
  await p.criarModelo('WABA', { nome: 'un_a', categoria: 'MARKETING', componentes });
  assert.deepStrictEqual(f.chamadas[0].corpo.components, componentes);
});
