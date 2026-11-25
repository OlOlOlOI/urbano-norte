'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrar } = require('../migracao');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'un-migra-'));
const escrever = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };

test('copia histórico, tema e preferências do sorteio e a configuração do disparo, sem o cofre de contatos', () => {
  const apps = tmp(); const dados = path.join(apps, 'Urbano Norte');
  escrever(path.join(apps, 'Sorteio Urbano Norte', 'historico.json'), '[{"id":"a"}]');
  escrever(path.join(apps, 'Sorteio Urbano Norte', 'tema.json'), '{}');
  escrever(path.join(apps, 'Sorteio Urbano Norte', 'contatos.dat'), 'cifrado');
  escrever(path.join(apps, 'Disparo Urbano Norte', 'config-local.json'), '{"operador":"Rayan"}');

  const r = migrar(apps, dados);
  assert.deepStrictEqual(r.modulos.sorteio.copiados, ['historico.json', 'tema.json']);
  assert.strictEqual(r.modulos.sorteio.contatosFicaramNoAppAntigo, true);
  assert.strictEqual(fs.readFileSync(path.join(dados, 'sorteio', 'historico.json'), 'utf8'), '[{"id":"a"}]');
  assert.ok(!fs.existsSync(path.join(dados, 'sorteio', 'contatos.dat')));
  assert.strictEqual(fs.readFileSync(path.join(dados, 'disparo', 'config-local.json'), 'utf8'), '{"operador":"Rayan"}');
  assert.ok(fs.existsSync(path.join(apps, 'Sorteio Urbano Norte', 'historico.json')), 'original fica intacto');
});

test('roda uma vez só: não sobrescreve o que já foi usado no app unificado', () => {
  const apps = tmp(); const dados = path.join(apps, 'Urbano Norte');
  escrever(path.join(apps, 'sorteio-urbano-norte', 'historico.json'), '[1]');
  migrar(apps, dados);
  escrever(path.join(dados, 'sorteio', 'historico.json'), '[1,2]');
  escrever(path.join(apps, 'sorteio-urbano-norte', 'historico.json'), '[9]');
  migrar(apps, dados);
  assert.strictEqual(fs.readFileSync(path.join(dados, 'sorteio', 'historico.json'), 'utf8'), '[1,2]');
});

test('sem apps antigos, só registra e segue', () => {
  const apps = tmp(); const dados = path.join(apps, 'Urbano Norte');
  const r = migrar(apps, dados);
  assert.strictEqual(r.modulos.sorteio.origem, null);
  assert.strictEqual(r.modulos.disparo.origem, null);
  assert.ok(fs.existsSync(path.join(dados, 'migracao.json')));
});
