'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizarTelefone } = require('../src/core/phone');
const { lerPlanilha } = require('../src/core/parse');
const { montarPublico, primeiroNome } = require('../src/core/audience');
const { renderizar } = require('../src/core/template');
const { Estado } = require('../src/core/state');
const { executarCampanha } = require('../src/core/sender');
const { criarProvedorSimulacao } = require('../src/core/provider-sim');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'disparo-'));

test('telefone: formatos comuns viram E.164', () => {
  const casos = [
    ['(69) 99291-5141', '+5569992915141'],
    ['69992915141', '+5569992915141'],
    ['+55 69 99291-5141', '+5569992915141'],
    ['5569992915141', '+5569992915141'],
    ['0069992915141', '+5569992915141'],
    ['55991234567', '+5555991234567'], // DDD 55 não pode perder o "55"
    ['5555991234567', '+5555991234567'],
  ];
  for (const [entrada, esperado] of casos) {
    const r = normalizarTelefone(entrada);
    assert.equal(r.ok, true, entrada);
    assert.equal(r.e164, esperado, entrada);
  }
});

test('telefone: celular sem o 9 é corrigido; fixo e lixo são rejeitados', () => {
  const corrigido = normalizarTelefone('(69) 9291-5141');
  assert.equal(corrigido.e164, '+5569992915141');
  assert.equal(corrigido.corrigido, true);

  assert.equal(normalizarTelefone('(69) 3221-1234').motivo, 'telefone fixo');
  assert.equal(normalizarTelefone('12345').motivo, 'tamanho inválido');
  assert.equal(normalizarTelefone('').motivo, 'vazio');
  assert.equal(normalizarTelefone(null).motivo, 'vazio');
  assert.equal(normalizarTelefone('(00) 99999-9999').ok, false);
  assert.equal(normalizarTelefone('69 88291-5141').motivo, 'não é celular');
});

test('planilha: CSV com ; , aspas, BOM e acentos em UTF-8', async () => {
  const csv = '﻿Nome;Telefone;Aceite\r\n"Silva, Maria";(69) 99291-5141;Sim\r\nJoão;69 98888-7777;Não\r\n';
  const { headers, rows } = await lerPlanilha(Buffer.from(csv, 'utf8'), 'x.csv');
  assert.deepEqual(headers, ['Nome', 'Telefone', 'Aceite']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Nome, 'Silva, Maria');
  assert.equal(rows[1].Nome, 'João');
});

test('planilha: CSV em Windows-1252 (Excel antigo) mantém os acentos', async () => {
  const buf = Buffer.from('Nome,Telefone\nJoão Gonçalves,69992915141\n', 'latin1');
  const { rows } = await lerPlanilha(buf, 'x.csv');
  assert.equal(rows[0].Nome, 'João Gonçalves');
});

test('planilha: XLSX', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados');
  ws.addRow(['Passageira', 'Celular', 'Aceita']);
  ws.addRow(['ANA PAULA', 69992915141, 'sim']); // telefone como número
  ws.addRow(['Carlos', '(69) 98888-7777', 'não']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { headers, rows } = await lerPlanilha(buf, 'dados.xlsx');
  assert.deepEqual(headers, ['Passageira', 'Celular', 'Aceita']);
  assert.equal(rows[0].Celular, '69992915141');
  assert.equal(rows.length, 2);
});

test('público: filtra inválidos, duplicados, sem aceite e descadastrados', () => {
  const linhas = [
    { n: 'maria da silva', t: '(69) 99291-5141', a: 'Sim' },
    { n: 'MARIA DUPLICADA', t: '69992915141', a: 'sim' },
    { n: 'João', t: '(69) 98888-7777', a: 'Não' },
    { n: 'Pedro', t: '(69) 97777-1111', a: 'sim' },
    { n: 'Sem tel', t: '', a: 'sim' },
    { n: 'Fixo', t: '(69) 3221-1234', a: 'sim' },
    { n: 'Lúcia', t: '(69) 96666-2222', a: 'sim' },
  ];
  const r = montarPublico(linhas, { nome: 'n', telefone: 't', aceite: 'a' }, {
    descadastrados: new Set(['+5569977771111']),
    jaEnviados: new Set(['+5569966662222']),
  });
  assert.deepEqual(r.destinatarios.map((d) => d.telefone), ['+5569992915141']);
  assert.equal(r.destinatarios[0].nome, 'Maria');
  assert.deepEqual(r.stats, {
    linhas: 7, semTelefone: 1, telefoneInvalido: 1, duplicados: 1, semAceite: 1,
    descadastrados: 1, jaEnviados: 1, corrigidos: 0, aptos: 1,
  });
});

test('público: sem coluna de aceite não filtra por aceite', () => {
  const r = montarPublico([{ t: '69992915141' }], { telefone: 't' });
  assert.equal(r.stats.aptos, 1);
  assert.equal(r.usouAceite, false);
});

test('nome: primeiro nome com capitalização; lixo vira vazio', () => {
  assert.equal(primeiroNome('  ÁGATA  souza'), 'Ágata');
  assert.equal(primeiroNome('123'), '');
  assert.equal(primeiroNome(''), '');
});

test('template: variáveis, padrão e limpeza de espaços', () => {
  assert.equal(renderizar('Oi, {{nome}}! Tudo bem?', { nome: 'Ana' }), 'Oi, Ana! Tudo bem?');
  assert.equal(renderizar('Oi, {{nome|passageiro}}!', { nome: '' }), 'Oi, passageiro!');
  assert.equal(renderizar('Oi {{nome}}, bora?', { nome: '' }), 'Oi, bora?');
});

test('estado compartilhado: descadastros e envios de operadores diferentes se juntam', () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  const b = new Estado(pasta, 'Chefe Um');

  a.adicionarDescadastro('+5569992915141', 'pediu para sair');
  b.adicionarDescadastro('+5569988887777');
  assert.deepEqual([...a.descadastrados()].sort(), ['+5569988887777', '+5569992915141']);
  assert.equal(fs.readdirSync(pasta).filter((f) => f.startsWith('descadastros-')).length, 2);

  b.removerDescadastro('+5569992915141');
  assert.deepEqual([...a.descadastrados()], ['+5569988887777']);

  a.registrarEnvio({ campanha: 'black-friday', telefone: '+5569911112222', status: 'enviado', simulacao: false });
  b.registrarEnvio({ campanha: 'black-friday', telefone: '+5569933334444', status: 'enviado', simulacao: false });
  b.registrarEnvio({ campanha: 'black-friday', telefone: '+5569955556666', status: 'falhou', simulacao: false });
  a.registrarEnvio({ campanha: 'black-friday', telefone: '+5569977778888', status: 'enviado', simulacao: true });

  assert.deepEqual([...a.enviados('black-friday', false)].sort(), ['+5569911112222', '+5569933334444']);
  assert.deepEqual([...b.enviados('black-friday', true)], ['+5569977778888']);
  assert.equal(a.enviadosHoje(false), 2);
});

test('estado: linha truncada (sincronização em andamento) é ignorada', () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  a.adicionarDescadastro('+5569992915141');
  fs.appendFileSync(path.join(pasta, 'descadastros-rayan.jsonl'), '{"t":"2026-11-24T10:00:00Z","aca');
  assert.equal(a.descadastrados().size, 1);
});

test('config compartilhada: grava por cima sem perder o resto', () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  a.gravarConfig({ mapa: { telefone: 'Celular' } });
  a.gravarConfig({ modelos: [{ id: 1 }] });
  assert.deepEqual(a.lerConfig(), { mapa: { telefone: 'Celular' }, modelos: [{ id: 1 }] });
});

test('campanha: envia, registra e uma 2ª pessoa não repete quem já recebeu', async () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  const b = new Estado(pasta, 'Chefe Um');
  const prov = criarProvedorSimulacao();
  const lista = [
    { telefone: '+5569911112222', nome: 'Ana' },
    { telefone: '+5569933334444', nome: '' },
  ];

  const r1 = await executarCampanha({ destinatarios: lista, corpo: 'Oi, {{nome|passageiro}}!', campanha: 'c1', provedor: prov, estado: a });
  assert.equal(r1.enviados, 2);

  const publico = montarPublico([{ t: '69911112222' }, { t: '69933334444' }, { t: '69955556666' }], { telefone: 't' },
    { jaEnviados: b.enviados('c1', true), descadastrados: b.descadastrados() });
  assert.deepEqual(publico.destinatarios.map((d) => d.telefone), ['+5569955556666']);
});

test('campanha: respeita limite diário somando operadores, e cancelamento', async () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  const b = new Estado(pasta, 'Chefe Um');
  const prov = criarProvedorSimulacao();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ telefone: `+55699${String(1000000 + i).padStart(8, '0')}`, nome: '' }));

  await executarCampanha({ destinatarios: mk(3), corpo: 'x', campanha: 'c', provedor: prov, estado: a, limiteDiario: 5 });
  const r = await executarCampanha({ destinatarios: mk(10).slice(3), corpo: 'x', campanha: 'c', provedor: prov, estado: b, limiteDiario: 5 });
  assert.equal(r.enviados, 2);
  assert.equal(r.parouPorLimite, true);

  const sinal = { cancelado: false };
  const r2 = await executarCampanha({
    destinatarios: mk(5), corpo: 'x', campanha: 'outra', provedor: prov, estado: a, sinal,
    aoProgredir: ({ feitos }) => { if (feitos === 2) sinal.cancelado = true; },
  });
  assert.equal(r2.enviados, 2);
  assert.equal(r2.cancelado, true);
});

test('campanha: falha do provedor é registrada e não conta como enviado', async () => {
  const pasta = tmp();
  const a = new Estado(pasta, 'Rayan');
  const quebrado = { nome: 'x', simulacao: false, async enviar() { return { ok: false, erro: 'número sem WhatsApp' }; } };
  const r = await executarCampanha({ destinatarios: [{ telefone: '+5569911112222', nome: '' }], corpo: 'x', campanha: 'c', provedor: quebrado, estado: a });
  assert.equal(r.falhas, 1);
  assert.equal(a.enviados('c', false).size, 0);
  assert.equal(a.historico()[0].erro, 'número sem WhatsApp');
});

const { adivinharColunas, colunasFaltando } = require('../src/core/columns');

test('colunas: acha telefone, nome e autorização em planilhas comuns', () => {
  assert.deepEqual(adivinharColunas(['Passageira', 'Celular', 'Aceita receber', 'E-mail']),
    { telefone: 'Celular', nome: 'Passageira', aceite: 'Aceita receber' });
  assert.deepEqual(adivinharColunas(['Nome', 'Telefone', 'Autorizou LGPD']),
    { telefone: 'Telefone', nome: 'Nome', aceite: 'Autorizou LGPD' });
  assert.deepEqual(adivinharColunas(['WhatsApp', 'Cliente']), { telefone: 'WhatsApp', nome: 'Cliente', aceite: '' });
});

test('colunas: em exportação de corridas, prefere os dados do passageiro e não do motorista', () => {
  const headers = ['O.S', 'Data da corrida', 'Motorista', 'Telefone do motorista', 'Nome da passageira', 'Telefone da passageira', 'E-mail da passageira'];
  const r = adivinharColunas(headers);
  assert.equal(r.telefone, 'Telefone da passageira');
  assert.equal(r.nome, 'Nome da passageira');
});

test('colunas: sem pistas, devolve vazio em vez de chutar', () => {
  assert.deepEqual(adivinharColunas(['A', 'B', 'C']), { telefone: '', nome: '', aceite: '' });
});

test('colunas: avisa quando uma coluna salva sumiu da planilha', () => {
  assert.deepEqual(colunasFaltando({ telefone: 'Celular', nome: 'Nome' }, ['Celular', 'Passageira']), ['Nome']);
  assert.deepEqual(colunasFaltando({ telefone: 'Celular' }, ['Celular']), []);
});
