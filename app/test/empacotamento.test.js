'use strict';
// Todo arquivo que o app carrega (require('./...')) precisa estar na lista "build.files" do package.json.
// Sem isso, o app funciona no `npm start` mas quebra instalado (aconteceu na v1.2.0 com conta.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const { files } = require('../package.json').build;
const coberto = (rel) => files.some((f) => {
  if (f === rel) return true;
  if (f.endsWith('/**/*')) return rel.startsWith(f.slice(0, -4));
  return false;
});

function requiresLocais(arquivo, vistos = new Set()) {
  if (vistos.has(arquivo)) return vistos;
  vistos.add(arquivo);
  const codigo = fs.readFileSync(arquivo, 'utf8');
  for (const [, alvo] of codigo.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    let p = path.resolve(path.dirname(arquivo), alvo);
    if (!path.extname(p)) p += '.js';
    if (p.startsWith(path.join(raiz, 'modulos'))) { vistos.add(p); continue; } // gerado por montar-modulos (coberto por modulos/**/*)
    if (p.startsWith(raiz) && fs.existsSync(p)) requiresLocais(p, vistos);
  }
  return vistos;
}

test('todo arquivo carregado pelo app vai para o instalador', () => {
  const faltando = [...requiresLocais(path.join(raiz, 'main.js'))]
    .map((p) => path.relative(raiz, p).split(path.sep).join('/'))
    .filter((rel) => !coberto(rel));
  assert.deepStrictEqual(faltando, [], `Acrescente em package.json > build.files: ${faltando.join(', ')}`);
});

test('arquivos de shell e preload vão para o instalador', () => {
  for (const rel of ['shell/index.html', 'shell/shell.js', 'shell/preload.js', 'shell/shell.css']) assert.ok(coberto(rel), rel);
});
