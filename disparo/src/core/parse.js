'use strict';

const path = require('path');

/** Decodifica bytes de CSV: UTF-8 (com/sem BOM); se tiver caracteres inválidos, usa Windows-1252. */
function decodificarTexto(buf) {
  let texto = new TextDecoder('utf-8').decode(buf);
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
  return texto.replace(/^﻿/, '');
}

function detectarSeparador(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const cont = { ';': 0, ',': 0, '\t': 0 };
  let aspas = false;
  for (const c of primeira) {
    if (c === '"') aspas = !aspas;
    else if (!aspas && c in cont) cont[c]++;
  }
  return Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
}

/** Parser CSV (RFC 4180): aspas, aspas duplas escapadas e quebras de linha dentro de campo. */
function parseCsv(texto, sep) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function cabecalhosUnicos(cabecalhos) {
  const vistos = new Map();
  return cabecalhos.map((h, i) => {
    let nome = String(h ?? '').trim() || `coluna_${i + 1}`;
    const n = vistos.get(nome) || 0;
    vistos.set(nome, n + 1);
    return n ? `${nome}_${n + 1}` : nome;
  });
}

function matrizParaTabela(matriz) {
  const nonEmpty = matriz.filter((l) => l.some((c) => String(c ?? '').trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = cabecalhosUnicos(nonEmpty[0]);
  const rows = nonEmpty.slice(1).map((l) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = String(l[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

function valorCelula(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);          // hyperlink
    if (v.result !== undefined) return valorCelula(v.result); // fórmula
    if (v.error) return '';
  }
  return String(v);
}

async function lerXlsx(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const matriz = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(valorCelula(row.getCell(c).value));
    matriz.push(vals);
  });
  return matrizParaTabela(matriz);
}

/**
 * Lê CSV ou XLSX a partir de um Buffer. Retorna { headers, rows } com tudo como texto.
 * @param {Buffer} buf
 * @param {string} nome  nome do arquivo/URL, usado para escolher o formato
 */
async function lerPlanilha(buf, nome = '') {
  const ext = path.extname(String(nome).split('?')[0]).toLowerCase();
  const ehZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" = xlsx
  if (ext === '.xlsx' || ehZip) return lerXlsx(buf);
  const texto = decodificarTexto(buf);
  return matrizParaTabela(parseCsv(texto, detectarSeparador(texto)));
}

module.exports = { lerPlanilha, parseCsv, detectarSeparador, decodificarTexto };
