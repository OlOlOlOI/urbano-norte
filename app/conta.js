'use strict';
/**
 * Login no app: cada pessoa entra com o próprio usuário e senha (contas guardadas no servidor do Atendimento,
 * atendimento/servidor/src/contas.js). Aqui fica só a sessão (token), cifrada pelo sistema (Keychain/DPAPI).
 *
 * - Sem sessão, o app mostra a tela de login e esconde as abas.
 * - Se o servidor disser que a sessão terminou (senha trocada, conta desativada, 30 dias sem uso), volta ao login.
 * - Sem internet, quem já entrou continua usando o Sorteio e o Disparo; o Atendimento avisa que está sem conexão.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVIDOR_PADRAO = 'https://atendimento-urbano-norte.atendimento-urbano-norte-servidor.workers.dev';

let sessao = null; // { token, usuario: { id, nome, usuario, papel } }
const ouvintes = new Set();

const arq = () => path.join(app.getPath('userData'), 'conta.dat');
const cofre = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

/** Endereço do servidor: URBANO_SERVIDOR (testes/desenvolvimento) ou o da empresa. */
function servidor() {
  const u = process.env.URBANO_SERVIDOR || SERVIDOR_PADRAO;
  return u.replace(/\/+$/, '');
}

function ler() {
  try { const s = JSON.parse(safeStorage.decryptString(fs.readFileSync(arq()))); return s && s.token && s.servidor === servidor() ? s : null; } catch { return null; }
}
function gravar(s) {
  if (!s) { fs.rmSync(arq(), { force: true }); return; }
  if (!cofre()) throw new Error('Este computador não oferece cofre seguro para guardar o login.');
  fs.writeFileSync(arq() + '.tmp', safeStorage.encryptString(JSON.stringify({ ...s, servidor: servidor() })));
  fs.renameSync(arq() + '.tmp', arq());
}

function mudar(nova) {
  sessao = nova;
  gravar(nova);
  for (const fn of ouvintes) { try { fn(estado()); } catch (e) { console.error('[conta]', e); } }
}

const estado = () => ({ logado: Boolean(sessao), usuario: sessao ? sessao.usuario : null, servidor: servidor() });

/** Chamada ao servidor. Com `autenticado`, manda o token e, se a sessão terminou, sai sozinho. */
async function pedir(caminho, { metodo = 'GET', corpo, autenticado = true, binario = false } = {}) {
  if (autenticado && !sessao) throw new Error('Entre com o seu usuário e senha.');
  let r;
  try {
    r = await fetch(servidor() + caminho, {
      method: metodo,
      headers: { ...(autenticado ? { Authorization: `Bearer ${sessao.token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error('Sem conexão com o servidor. Confira a internet.' + (e && e.name === 'TimeoutError' ? ' (demorou demais)' : ''));
  }
  if (binario && r.ok) return { tipo: r.headers.get('Content-Type') || 'application/octet-stream', bytes: Buffer.from(await r.arrayBuffer()) };
  let dados = null;
  try { dados = await r.json(); } catch { /* sem JSON */ }
  if (r.status === 401 && autenticado) { mudar(null); throw new Error((dados && dados.erro) || 'Sua sessão terminou. Entre de novo.'); }
  if (!r.ok || !dados || dados.ok === false) throw new Error((dados && dados.erro) || `O servidor respondeu ${r.status}.`);
  return dados;
}

const dispositivo = () => { try { return os.hostname().slice(0, 80); } catch { return ''; } };

/** Ao abrir o app: lê a sessão guardada (sem esperar a internet). */
function carregar() { sessao = ler(); return estado(); }

/** Confere com o servidor se a sessão guardada ainda vale e atualiza nome/papel. Sem internet, segue como está. */
async function conferir() {
  if (!sessao) return estado();
  try {
    const u = (await pedir('/api/conta/eu')).usuario;
    const mudou = JSON.stringify(u) !== JSON.stringify(sessao.usuario);
    if (mudou) mudar({ ...sessao, usuario: u });
  } catch { /* sem internet: segue; 401 já saiu */ }
  return estado();
}

async function situacaoServidor() { return pedir('/api/conta/estado', { autenticado: false }); }

async function entrar({ usuario, senha }) {
  const r = await pedir('/api/conta/entrar', { metodo: 'POST', autenticado: false, corpo: { usuario: String(usuario || ''), senha: String(senha || ''), dispositivo: dispositivo() } });
  mudar({ token: r.token, usuario: r.usuario });
  return estado();
}

async function primeiroAdmin({ chave, nome, usuario, senha }) {
  const r = await pedir('/api/conta/primeiro-admin', { metodo: 'POST', autenticado: false, corpo: { chave: String(chave || '').trim(), nome, usuario, senha, dispositivo: dispositivo() } });
  mudar({ token: r.token, usuario: r.usuario });
  return estado();
}

async function sair() {
  if (sessao) { try { await pedir('/api/conta/sair', { metodo: 'POST' }); } catch { /* sem internet: sai daqui mesmo assim */ } }
  mudar(null);
  return estado();
}

const trocarSenha = ({ atual, nova }) => pedir('/api/conta/senha', { metodo: 'POST', corpo: { atual: String(atual || ''), nova: String(nova || '') } }).then(() => true);
const equipe = {
  listar: () => pedir('/api/equipe').then((r) => r.equipe),
  criar: (c) => pedir('/api/equipe', { metodo: 'POST', corpo: c }).then((r) => r.usuario),
  alterar: (id, c) => pedir(`/api/equipe/${Number(id)}`, { metodo: 'POST', corpo: c }).then((r) => r.usuario),
};

module.exports = {
  carregar, conferir, estado, servidor, situacaoServidor, entrar, primeiroAdmin, sair, trocarSenha, equipe, pedir,
  aoMudar: (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  sessao: () => sessao,
};
