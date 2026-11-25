// Leitura de planilhas (Excel e CSV). Sem dependência do Electron, para poder ser testado isoladamente.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function decodificar(buf) {
  // Tenta UTF-8; se falhar (comum em CSV exportado por sistemas no Windows), usa Windows-1252.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function detectarSeparador(texto) {
  const primeira = texto.slice(0, texto.search(/\r?\n/) >= 0 ? texto.search(/\r?\n/) : texto.length);
  const cont = (c) => primeira.split(c).length - 1;
  const opcoes = [';', ',', '\t', '|'];
  return opcoes.reduce((melhor, c) => (cont(c) > cont(melhor) ? c : melhor), ';');
}

function lerCSV(texto, sep) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') {
      aspas = true;
    } else if (c === sep) {
      linha.push(campo); campo = '';
    } else if (c === '\n') {
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else if (c !== '\r') {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Devolve { nomesAbas, abas } onde cada aba é uma matriz de textos.
function lerArquivo(caminho) {
  const ext = path.extname(caminho).toLowerCase();
  const buf = fs.readFileSync(caminho);

  if (ext === '.csv' || ext === '.txt') {
    const texto = decodificar(buf);
    return { nomesAbas: ['Planilha'], abas: { Planilha: lerCSV(texto, detectarSeparador(texto)) } };
  }

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const abas = {};
  for (const nome of wb.SheetNames) {
    abas[nome] = XLSX.utils.sheet_to_json(wb.Sheets[nome], {
      header: 1,
      raw: false,
      dateNF: 'dd/mm/yyyy',
      defval: '',
    });
  }
  return { nomesAbas: wb.SheetNames, abas };
}

module.exports = { lerArquivo, lerCSV, decodificar, detectarSeparador };
