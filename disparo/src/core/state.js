'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Estado compartilhado entre as pessoas que usam o app.
 *
 * Fica numa pasta sincronizada (Google Drive, OneDrive, Dropbox...). Para evitar
 * conflito de edição, cada operador só ESCREVE no próprio arquivo (append-only);
 * a leitura junta os arquivos de todos.
 *
 *   descadastros-<operador>.jsonl   { t, acao:'add'|'remove', telefone, motivo, operador }
 *   envios-<operador>.jsonl         { t, campanha, telefone, status, simulacao, erro?, operador }
 *   config-compartilhada.json       origem da planilha, mapeamento de colunas, modelos de mensagem
 */
function slug(s) {
  return String(s || 'operador')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'operador';
}

class Estado {
  constructor(pasta, operador) {
    this.pasta = pasta;
    this.operador = operador || 'operador';
    fs.mkdirSync(pasta, { recursive: true });
  }

  _arquivosDe(prefixo) {
    return fs.readdirSync(this.pasta)
      .filter((f) => f.startsWith(prefixo + '-') && f.endsWith('.jsonl'))
      .map((f) => path.join(this.pasta, f));
  }

  _ler(prefixo) {
    const eventos = [];
    for (const arq of this._arquivosDe(prefixo)) {
      let txt = '';
      try { txt = fs.readFileSync(arq, 'utf8'); } catch { continue; }
      for (const linha of txt.split('\n')) {
        if (!linha.trim()) continue;
        try { eventos.push(JSON.parse(linha)); } catch { /* linha incompleta durante sincronização */ }
      }
    }
    return eventos.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  }

  _anexar(prefixo, evento) {
    const arq = path.join(this.pasta, `${prefixo}-${slug(this.operador)}.jsonl`);
    fs.appendFileSync(arq, JSON.stringify({ t: new Date().toISOString(), operador: this.operador, ...evento }) + '\n');
  }

  // ---------- descadastros ----------
  adicionarDescadastro(telefone, motivo = '') { this._anexar('descadastros', { acao: 'add', telefone, motivo }); }
  removerDescadastro(telefone) { this._anexar('descadastros', { acao: 'remove', telefone }); }

  _descadastrosAtuais() {
    const mapa = new Map();
    for (const e of this._ler('descadastros')) {
      if (e.acao === 'add') mapa.set(e.telefone, e);
      else if (e.acao === 'remove') mapa.delete(e.telefone);
    }
    return mapa;
  }
  descadastrados() { return new Set(this._descadastrosAtuais().keys()); }
  listaDescadastros() { return [...this._descadastrosAtuais().values()].reverse(); }

  // ---------- envios ----------
  registrarEnvio({ campanha, telefone, status, simulacao, erro }) {
    this._anexar('envios', { campanha, telefone, status, simulacao: Boolean(simulacao), ...(erro ? { erro } : {}) });
  }

  /** Telefones que já receberam a campanha (no mesmo modo: simulado ou real). */
  enviados(campanha, simulacao) {
    const s = new Set();
    for (const e of this._ler('envios')) {
      if (e.campanha === campanha && e.status === 'enviado' && Boolean(e.simulacao) === Boolean(simulacao)) s.add(e.telefone);
    }
    return s;
  }

  /** Quantos envios (de todos os operadores) já saíram hoje, para respeitar o limite diário. */
  enviadosHoje(simulacao, agora = new Date()) {
    const dia = (d) => new Date(d).toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
    const hoje = dia(agora);
    return this._ler('envios').filter((e) => e.status === 'enviado' && Boolean(e.simulacao) === Boolean(simulacao) && dia(e.t) === hoje).length;
  }

  historico(limite = 200) {
    return this._ler('envios').reverse().slice(0, limite);
  }

  resumoCampanhas() {
    const mapa = new Map();
    for (const e of this._ler('envios')) {
      const chave = `${e.campanha}|${Boolean(e.simulacao)}`;
      const r = mapa.get(chave) || { campanha: e.campanha, simulacao: Boolean(e.simulacao), enviados: 0, falhas: 0, ultimo: '', operadores: new Set() };
      if (e.status === 'enviado') r.enviados++; else r.falhas++;
      r.ultimo = e.t;
      r.operadores.add(e.operador);
      mapa.set(chave, r);
    }
    return [...mapa.values()].map((r) => ({ ...r, operadores: [...r.operadores] })).sort((a, b) => b.ultimo.localeCompare(a.ultimo));
  }

  // ---------- configuração compartilhada ----------
  lerConfig() {
    try { return JSON.parse(fs.readFileSync(path.join(this.pasta, 'config-compartilhada.json'), 'utf8')); } catch { return {}; }
  }
  gravarConfig(parcial) {
    const nova = { ...this.lerConfig(), ...parcial };
    const arq = path.join(this.pasta, 'config-compartilhada.json');
    const tmp = arq + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(nova, null, 2));
    fs.renameSync(tmp, arq);
    return nova;
  }
}

module.exports = { Estado, slug };
