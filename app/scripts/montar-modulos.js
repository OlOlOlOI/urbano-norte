'use strict';
// Copia o código do sorteio e do disparo para app/modulos/ antes de rodar ou empacotar o app unificado.
// A fonte de verdade continua em ../sorteio/desktop e ../disparo/src; não edite nada dentro de modulos/.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..');
const destino = path.join(__dirname, '..', 'modulos');

const copias = [
  ['sorteio/desktop/modulo.js', 'sorteio/modulo.js'],
  ['sorteio/desktop/leitor.js', 'sorteio/leitor.js'],
  ['sorteio/desktop/preload.js', 'sorteio/preload.js'],
  ['sorteio/desktop/renderer', 'sorteio/renderer'],
  ['disparo/src/modulo.js', 'disparo/modulo.js'],
  ['disparo/src/preload.js', 'disparo/preload.js'],
  ['disparo/src/core', 'disparo/core'],
  ['disparo/src/renderer', 'disparo/renderer'],
  ['atendimento/app/modulo.js', 'atendimento/modulo.js'],
  ['atendimento/app/preload.js', 'atendimento/preload.js'],
  ['atendimento/app/renderer', 'atendimento/renderer'],
];

fs.rmSync(destino, { recursive: true, force: true });
for (const [de, para] of copias) {
  const origem = path.join(raiz, de);
  if (!fs.existsSync(origem)) throw new Error(`Não achei ${de}`);
  fs.cpSync(origem, path.join(destino, para), { recursive: true });
}
fs.writeFileSync(path.join(destino, 'LEIA-ME.txt'), 'Pasta gerada por scripts/montar-modulos.js. Não edite aqui: edite sorteio/desktop, disparo/src e atendimento/app.\n');
console.log('[montar-modulos] ok:', destino);
