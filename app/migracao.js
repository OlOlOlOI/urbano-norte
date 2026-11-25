'use strict';
// Traz, uma única vez, os dados dos apps antigos (Sorteio Urbano Norte e Disparo Urbano Norte) para o app unificado.
// Os arquivos originais ficam intactos: o app antigo continua funcionando com os seus dados.
//
// O cofre de contatos do sorteio (contatos.dat) NÃO é copiado: ele é cifrado pelo sistema com uma chave
// presa ao app antigo (Keychain no Mac, "Local State" no Windows) e não abriria aqui. Os telefones dos
// sorteios antigos continuam acessíveis no app antigo e no Excel que ele exporta.
const fs = require('fs');
const path = require('path');

const ORIGENS = {
  sorteio: { pastas: ['Sorteio Urbano Norte', 'sorteio-urbano-norte'], arquivos: ['historico.json', 'tema.json', 'preferencias.json'] },
  disparo: { pastas: ['Disparo Urbano Norte', 'disparo-urbano-norte'], arquivos: ['config-local.json'] },
};

/**
 * @param {string} pastaApps pasta de dados dos aplicativos do sistema (app.getPath('appData'))
 * @param {string} pastaDados pasta de dados do app unificado (app.getPath('userData'))
 * @returns {object} registro do que foi feito (também gravado em migracao.json)
 */
function migrar(pastaApps, pastaDados) {
  const arqRegistro = path.join(pastaDados, 'migracao.json');
  try { return JSON.parse(fs.readFileSync(arqRegistro, 'utf8')); } catch { /* ainda não migrou */ }

  const registro = { quando: new Date().toISOString(), modulos: {} };
  for (const [modulo, { pastas, arquivos }] of Object.entries(ORIGENS)) {
    const destino = path.join(pastaDados, modulo);
    const jaTemDados = arquivos.some((a) => fs.existsSync(path.join(destino, a)));
    if (jaTemDados) { registro.modulos[modulo] = { origem: null, motivo: 'já havia dados no app unificado' }; continue; }

    const origem = pastas.map((p) => path.join(pastaApps, p)).find((p) => arquivos.some((a) => fs.existsSync(path.join(p, a))));
    if (!origem) { registro.modulos[modulo] = { origem: null, motivo: 'app antigo não encontrado' }; continue; }

    fs.mkdirSync(destino, { recursive: true });
    const copiados = [];
    for (const a of arquivos) {
      const de = path.join(origem, a);
      if (fs.existsSync(de)) { fs.copyFileSync(de, path.join(destino, a)); copiados.push(a); }
    }
    registro.modulos[modulo] = { origem, copiados, contatosFicaramNoAppAntigo: modulo === 'sorteio' && fs.existsSync(path.join(origem, 'contatos.dat')) };
  }

  fs.mkdirSync(pastaDados, { recursive: true });
  fs.writeFileSync(arqRegistro, JSON.stringify(registro, null, 2));
  return registro;
}

module.exports = { migrar };
