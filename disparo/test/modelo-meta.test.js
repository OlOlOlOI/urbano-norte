'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paraModeloMeta, parametrosPara, nomeTecnico, situacao } = require('../src/core/modelo-meta');
const { criarProvedorMeta, GRAPH } = require('../src/core/provider-meta');
const { executarCampanha } = require('../src/core/sender');

test('mensagem do Disparo vira modelo da Meta com {{1}} e exemplo', () => {
  const r = paraModeloMeta('Olá, {{nome|passageiro}}! Hoje tem 20% de desconto. Até logo!');
  assert.deepStrictEqual(r, { ok: true, texto: 'Olá, {{1}}! Hoje tem 20% de desconto. Até logo!', variaveis: [{ nome: 'nome', padrao: 'passageiro' }], exemplos: ['Maria'] });
  assert.deepStrictEqual(paraModeloMeta('Sem variável nenhuma.'), { ok: true, texto: 'Sem variável nenhuma.', variaveis: [], exemplos: [] });
});

test('recusa o que a Meta recusaria, explicando', () => {
  assert.match(paraModeloMeta('{{nome}}, temos novidade').erro, /começa/);
  assert.match(paraModeloMeta('Novidade para você, {{nome}}!').erro, /termina/);
  assert.match(paraModeloMeta('Oi {{cidade}} tudo bem?').erro, /cidade/);
  assert.match(paraModeloMeta('x'.repeat(1100)).erro, /1024/);
  assert.match(paraModeloMeta('').erro, /Escreva/);
});

test('parâmetros: nome da planilha, ou o padrão, sem quebra de linha', () => {
  const corpo = 'Olá, {{nome|passageiro}}! Até logo.';
  assert.deepStrictEqual(parametrosPara(corpo, { nome: 'Ana' }), ['Ana']);
  assert.deepStrictEqual(parametrosPara(corpo, { nome: '  ' }), ['passageiro']);
  assert.deepStrictEqual(parametrosPara('Olá, {{nome}}! Até logo.', {}), ['cliente']);
  assert.deepStrictEqual(parametrosPara(corpo, { nome: 'Ana\nMaria' }), ['Ana Maria']);
});

test('nome técnico do modelo é aceito pela Meta e não repete', () => {
  assert.strictEqual(nomeTecnico('Promoção de Natal!', 1000), 'un_promocao_de_natal_rs');
  assert.match(nomeTecnico('', 5), /^un_mensagem_[a-z0-9]+$/);
});

test('situação: aprovado, em análise, recusado e texto mudado', () => {
  const meta = { nome: 'un_x', status: 'APPROVED', corpoEnviado: 'Oi, {{nome}}! Tchau.' };
  assert.strictEqual(situacao(meta, 'Oi, {{nome}}! Tchau.').codigo, 'aprovado');
  assert.strictEqual(situacao(meta, 'Oi, {{nome}}! Até.').codigo, 'mudou');
  assert.strictEqual(situacao({ ...meta, status: 'PENDING' }, meta.corpoEnviado).codigo, 'analise');
  assert.strictEqual(situacao({ ...meta, status: 'REJECTED', motivo: 'PROMOTIONAL' }, meta.corpoEnviado).codigo, 'recusado');
  assert.strictEqual(situacao(null).codigo, 'sem');
});

function fetchRoteiro(rotas) {
  const chamadas = [];
  const f = async (url, opcoes) => {
    chamadas.push({ url, corpo: opcoes.body ? JSON.parse(opcoes.body) : null, metodo: opcoes.method });
    const chave = Object.keys(rotas).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => (chave ? rotas[chave] : {}) };
  };
  f.chamadas = chamadas;
  return f;
}

test('descobre a conta do número pelas permissões do token', async () => {
  const f = fetchRoteiro({
    debug_token: { data: { granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['111', '222'] }, { scope: 'pages_messaging', target_ids: ['999'] }] } },
    '111/phone_numbers': { data: [{ id: '555' }] },
    '222/phone_numbers': { data: [{ id: '1501978266325095' }] },
  });
  const r = await criarProvedorMeta({ numeroId: '1501978266325095', token: 't', fetch: f }).descobrirConta();
  assert.deepStrictEqual(r, { ok: true, conta: '222' });
});

test('cria modelo com exemplo e envia modelo com o nome no {{1}}', async () => {
  const f = fetchRoteiro({ message_templates: { id: 'T1', status: 'PENDING', category: 'MARKETING' }, messages: { messages: [{ id: 'wamid.M' }] } });
  const p = criarProvedorMeta({ numeroId: '9', token: 't', fetch: f });
  const c = await p.criarModelo('222', { nome: 'un_x_1', categoria: 'MARKETING', texto: 'Olá, {{1}}! Até.', exemplos: ['Maria'] });
  assert.deepStrictEqual(c, { ok: true, id: 'T1', status: 'PENDING', categoria: 'MARKETING' });
  assert.strictEqual(f.chamadas[0].url, `${GRAPH}/222/message_templates`);
  assert.deepStrictEqual(f.chamadas[0].corpo, { name: 'un_x_1', category: 'MARKETING', language: 'pt_BR', components: [{ type: 'BODY', text: 'Olá, {{1}}! Até.', example: { body_text: [['Maria']] } }] });
  await p.enviarModelo({ telefone: '+5564999998888', modelo: 'un_x_1', parametros: ['Ana'] });
  assert.deepStrictEqual(f.chamadas[1].corpo.template, { name: 'un_x_1', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] });
});

test('campanha com modelo aprovado envia pelo modelo, com o nome de cada pessoa', async () => {
  const envios = [];
  const provedor = { simulacao: false, enviar: async () => { throw new Error('não devia mandar texto livre'); }, enviarModelo: async (x) => { envios.push(x); return { ok: true }; } };
  const registros = [];
  const estado = { enviadosHoje: () => 0, registrarEnvio: (e) => registros.push(e) };
  const r = await executarCampanha({
    destinatarios: [{ telefone: '+5564999990001', nome: 'Ana' }, { telefone: '+5564999990002', nome: '' }],
    corpo: 'Olá, {{nome|passageiro}}! Até logo.', campanha: 'c', provedor, estado, modeloMeta: { nome: 'un_c_1', idioma: 'pt_BR' },
  });
  assert.strictEqual(r.enviados, 2);
  assert.deepStrictEqual(envios.map((e) => [e.modelo, e.componentes[0].parameters[0].text]), [['un_c_1', 'Ana'], ['un_c_1', 'passageiro']]);
});

test('campanha com imagem, rodapé e botões: imagem no topo e o botão de sair com o código de descadastro', async () => {
  const envios = [];
  const provedor = { simulacao: false, enviar: async () => ({ ok: false }), enviarModelo: async (x) => { envios.push(x); return { ok: true }; } };
  const mensagem = { corpo: 'Oi, {{nome}}! Novidade.', imagem: { tipo: 'image/jpeg', tamanho: 10, hash: 'h1' }, rodape: 'Urbano Norte', botoes: { site: { texto: 'Baixar o app', url: 'https://exemplo.com' }, sair: true } };
  await executarCampanha({
    destinatarios: [{ telefone: '+5564999990001', nome: 'Ana' }], corpo: mensagem.corpo, campanha: 'c', provedor,
    estado: { enviadosHoje: () => 0, registrarEnvio: () => {} }, modeloMeta: { nome: 'un_c_2' }, mensagem, imagemId: 'MID1',
  });
  assert.deepStrictEqual(envios[0].componentes, [
    { type: 'header', parameters: [{ type: 'image', image: { id: 'MID1' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
    { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'SAIR_UN' }] },
  ]);
});

test('extras: regras da Meta para imagem, rodapé e botões', () => {
  const { validarExtras } = require('../src/core/modelo-meta');
  assert.strictEqual(validarExtras({ imagem: { tipo: 'image/gif', tamanho: 1 } }).ok, false);
  assert.strictEqual(validarExtras({ imagem: { tipo: 'image/png', tamanho: 6 * 1024 * 1024 } }).ok, false);
  assert.match(validarExtras({ rodape: 'x'.repeat(61) }).erro, /60/);
  assert.match(validarExtras({ rodape: 'Oi {{nome}}' }).erro, /rodapé/);
  assert.match(validarExtras({ botoes: { site: { texto: 'Abrir', url: 'http://inseguro.com' } } }).erro, /https/);
  assert.match(validarExtras({ botoes: { site: { texto: 'x'.repeat(26), url: 'https://a.com' } } }).erro, /25/);
  assert.strictEqual(validarExtras({ rodape: 'Urbano Norte', botoes: { site: { texto: 'Baixar', url: 'https://a.com' }, sair: true } }).ok, true);
});

test('mudar imagem, rodapé ou botões depois de aprovada pede nova aprovação', () => {
  const { situacao, assinaturaExtras } = require('../src/core/modelo-meta');
  const m = { corpo: 'Oi! Tudo bem?', rodape: 'Urbano Norte' };
  const meta = { nome: 'un_x', status: 'APPROVED', corpoEnviado: m.corpo, extrasEnviados: assinaturaExtras(m) };
  assert.strictEqual(situacao(meta, m.corpo, assinaturaExtras(m)).codigo, 'aprovado');
  assert.strictEqual(situacao(meta, m.corpo, assinaturaExtras({ ...m, rodape: 'Outro' })).codigo, 'mudou');
  assert.strictEqual(situacao(meta, m.corpo, assinaturaExtras({ ...m, imagem: { hash: 'h' } })).codigo, 'mudou');
  // modelo antigo (sem extras guardados) continua aprovado se a mensagem não tem extras
  assert.strictEqual(situacao({ nome: 'un_y', status: 'APPROVED', corpoEnviado: 'A b' }, 'A b', assinaturaExtras({})).codigo, 'aprovado');
});
