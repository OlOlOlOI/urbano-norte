'use strict';
// Banco local que imita a API do Cloudflare D1, usando o SQLite que já vem no Node (node:sqlite).
// Serve para os testes e para rodar o servidor no próprio computador (dev.js). Na nuvem, o D1 de verdade é usado.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

class Consulta {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) {
    // igual ao D1: undefined não é aceito (evita gravar lixo sem perceber)
    args.forEach((v, i) => { if (v === undefined) throw new Error(`D1_TYPE_ERROR: undefined no parâmetro ${i + 1} de: ${this.sql.slice(0, 60)}`); });
    return new Consulta(this.db, this.sql, args);
  }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
  async first() { const r = this.db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: r.changes } }; }
}

class D1Local {
  constructor(arquivo = ':memory:') {
    this.db = new DatabaseSync(arquivo);
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  }
  prepare(sql) { return new Consulta(this.db, sql); }
  async batch(consultas) {
    this.db.exec('BEGIN');
    try { const r = []; for (const c of consultas) r.push(await c.run()); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

module.exports = { D1Local };
