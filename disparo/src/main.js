'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { lerPlanilha } = require('./core/parse');
const { montarPublico } = require('./core/audience');
const { normalizarTelefone, formatarTelefone } = require('./core/phone');
const { renderizar } = require('./core/template');
const { Estado, slug } = require('./core/state');
const { executarCampanha } = require('./core/sender');
const { adivinharColunas, colunasFaltando } = require('./core/columns');
const { criarProvedorSimulacao } = require('./core/provider-sim');

// ---------- configuração local (por computador) ----------
const arqLocal = () => path.join(app.getPath('userData'), 'config-local.json');
function lerLocal() { try { return JSON.parse(fs.readFileSync(arqLocal(), 'utf8')); } catch { return {}; } }
function gravarLocal(p) { const n = { ...lerLocal(), ...p }; fs.mkdirSync(path.dirname(arqLocal()), { recursive: true }); fs.writeFileSync(arqLocal(), JSON.stringify(n, null, 2)); return n; }

let janela = null;
let estado = null;          // Estado compartilhado (null até escolher pasta + nome)
let planilha = null;        // { headers, rows, origem, atualizadoEm, hash }
let envioAtual = null;      // { sinal } enquanto uma campanha roda
let vigia = null;           // timer que confere se a planilha mudou

function abrirEstado() {
  const l = lerLocal();
  estado = l.pasta && l.operador ? new Estado(l.pasta, l.operador) : null;
  return estado;
}
const avisar = (canal, dados) => { if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados); };

// ---------- planilha ----------
async function baixarUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Use um link https://');
  const r = await fetch(u, { redirect: 'follow' });
  if (!r.ok) throw new Error(`O link respondeu ${r.status}. Confira se a planilha está publicada/compartilhada.`);
  return Buffer.from(await r.arrayBuffer());
}

async function carregarPlanilha() {
  if (!estado) throw new Error('Escolha a pasta compartilhada e informe seu nome em Ajustes.');
  const cfg = estado.lerConfig();
  const f = cfg.fonte;
  if (!f) { planilha = null; return null; }

  let buf; let nome;
  if (f.tipo === 'arquivo') {
    const caminho = path.join(estado.pasta, f.nome);
    if (!fs.existsSync(caminho)) throw new Error(`Não achei "${f.nome}" na pasta compartilhada.`);
    buf = fs.readFileSync(caminho); nome = f.nome;
  } else if (f.tipo === 'url') {
    buf = await baixarUrl(f.url); nome = f.url;
  } else return null;

  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (planilha && planilha.hash === hash) return planilha; // nada mudou
  const { headers, rows } = await lerPlanilha(buf, nome);
  planilha = { headers, rows, hash, origem: f.tipo === 'arquivo' ? f.nome : f.url, atualizadoEm: new Date().toISOString() };
  // primeira vez (ou mapa vazio): descobre as colunas sozinho e já deixa salvo para todos
  if (!(cfg.mapa && cfg.mapa.telefone)) {
    const chute = adivinharColunas(headers);
    if (chute.telefone) { estado.gravarConfig({ mapa: chute }); planilha.mapaAutomatico = true; }
  }
  return planilha;
}

function iniciarVigia() {
  if (vigia) clearInterval(vigia);
  vigia = setInterval(async () => {
    if (!estado || envioAtual) return;
    try {
      const antes = planilha && planilha.hash;
      const p = await carregarPlanilha();
      if (p && p.hash !== antes) avisar('planilha-mudou', resumoPlanilha());
    } catch { /* erro transitório (arquivo sendo sincronizado, sem internet): tenta no próximo ciclo */ }
  }, 15000);
}

function resumoPlanilha() {
  if (!planilha) return null;
  const mapa = (estado && estado.lerConfig().mapa) || {};
  return {
    headers: planilha.headers, linhas: planilha.rows.length, origem: planilha.origem, atualizadoEm: planilha.atualizadoEm,
    amostra: planilha.rows.slice(0, 3), mapa, mapaAutomatico: Boolean(planilha.mapaAutomatico),
    mapaProblema: colunasFaltando(mapa, planilha.headers),
  };
}

function publico(campanha, simulacao) {
  const cfg = estado.lerConfig();
  const mapa = cfg.mapa || {};
  if (!planilha) throw new Error('Nenhuma planilha carregada.');
  if (!mapa.telefone) throw new Error('Escolha a coluna do telefone na aba Planilha.');
  return montarPublico(planilha.rows, mapa, {
    descadastrados: estado.descadastrados(),
    jaEnviados: campanha ? estado.enviados(campanha, simulacao) : new Set(),
  });
}

// ---------- IPC ----------
function registrarIpc() {
  const h = (canal, fn) => ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, dados: await fn(...args) }; } catch (e) { return { ok: false, erro: String(e && e.message || e) }; }
  });

  h('ajustes:ler', () => {
    const l = lerLocal();
    const cfg = estado ? estado.lerConfig() : {};
    return { pasta: l.pasta || '', operador: l.operador || '', pronto: Boolean(estado), simulacao: true, limiteDiario: cfg.limiteDiario ?? 250, intervaloMs: cfg.intervaloMs ?? 1000, versao: app.getVersion() };
  });
  h('ajustes:escolherPasta', async () => {
    const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'createDirectory'], title: 'Pasta compartilhada (Drive, OneDrive...)' });
    if (r.canceled || !r.filePaths[0]) return null;
    gravarLocal({ pasta: r.filePaths[0] });
    abrirEstado();
    return r.filePaths[0];
  });
  h('ajustes:salvarOperador', (nome) => {
    const n = String(nome || '').trim();
    if (!n) throw new Error('Informe seu nome.');
    gravarLocal({ operador: n });
    abrirEstado();
    return true;
  });
  h('ajustes:salvarLimites', ({ limiteDiario, intervaloMs }) => {
    if (!estado) throw new Error('Configure a pasta primeiro.');
    estado.gravarConfig({ limiteDiario: Math.max(0, Number(limiteDiario) || 0), intervaloMs: Math.max(0, Number(intervaloMs) || 0) });
    return true;
  });

  h('planilha:estado', async () => { if (estado) await carregarPlanilha().catch(() => {}); return { resumo: resumoPlanilha(), config: estado ? estado.lerConfig() : {} }; });
  h('planilha:escolherArquivo', async () => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    const r = await dialog.showOpenDialog(janela, { properties: ['openFile'], filters: [{ name: 'Planilhas', extensions: ['xlsx', 'csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let origem = r.filePaths[0];
    const dentro = path.relative(estado.pasta, origem);
    let nome = path.basename(origem);
    if (dentro.startsWith('..') || path.isAbsolute(dentro)) {
      fs.copyFileSync(origem, path.join(estado.pasta, nome)); // traz para a pasta compartilhada
    } else nome = dentro;
    estado.gravarConfig({ fonte: { tipo: 'arquivo', nome } });
    planilha = null;
    await carregarPlanilha();
    iniciarVigia();
    return resumoPlanilha();
  });
  h('planilha:definirUrl', async (url) => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    estado.gravarConfig({ fonte: { tipo: 'url', url: String(url).trim() } });
    planilha = null;
    await carregarPlanilha();
    iniciarVigia();
    return resumoPlanilha();
  });
  h('planilha:recarregar', async () => { planilha = null; await carregarPlanilha(); return resumoPlanilha(); });
  h('planilha:salvarMapa', (mapa) => { estado.gravarConfig({ mapa }); return true; });

  h('modelos:salvar', (modelos) => { estado.gravarConfig({ modelos }); return true; });

  h('publico:calcular', ({ campanha }) => {
    const r = publico(campanha ? slug(campanha) : '', true);
    return { stats: r.stats, usouAceite: r.usouAceite, amostra: r.destinatarios.slice(0, 20).map((d) => ({ ...d, exibir: formatarTelefone(d.telefone) })), rejeitados: r.rejeitados.slice(0, 200) };
  });

  h('envio:previa', ({ corpo, nome }) => renderizar(corpo, { nome }));

  h('envio:iniciar', async ({ campanha, corpo }) => {
    if (envioAtual) throw new Error('Já existe um envio em andamento.');
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    const id = slug(campanha);
    if (!campanha.trim()) throw new Error('Dê um nome à campanha.');
    if (!String(corpo || '').trim()) throw new Error('Escreva a mensagem.');
    const provedor = criarProvedorSimulacao({ atrasoMs: 0 });
    const { destinatarios } = publico(id, provedor.simulacao);
    if (!destinatarios.length) throw new Error('Não há destinatários aptos para esta campanha.');
    const cfg = estado.lerConfig();
    const sinal = { cancelado: false };
    envioAtual = { sinal };
    // roda em segundo plano; o progresso volta por evento
    executarCampanha({
      destinatarios, corpo, campanha: id, provedor, estado, sinal,
      limiteDiario: cfg.limiteDiario ?? 250, intervaloMs: provedor.simulacao ? 40 : (cfg.intervaloMs ?? 1000),
      aoProgredir: (p) => avisar('envio:progresso', p),
    }).then((resumo) => avisar('envio:fim', resumo))
      .catch((e) => avisar('envio:fim', { erro: String(e.message || e) }))
      .finally(() => { envioAtual = null; });
    return { total: destinatarios.length, simulacao: provedor.simulacao };
  });
  h('envio:cancelar', () => { if (envioAtual) envioAtual.sinal.cancelado = true; return true; });

  h('descadastros:listar', () => estado.listaDescadastros().map((d) => ({ ...d, exibir: formatarTelefone(d.telefone) })));
  h('descadastros:adicionar', (texto) => {
    const numeros = String(texto || '').split(/[\n;,]+/).map((s) => s.trim()).filter(Boolean);
    let ok = 0; const invalidos = [];
    for (const n of numeros) {
      const t = normalizarTelefone(n);
      if (t.ok) { estado.adicionarDescadastro(t.e164, 'adicionado manualmente'); ok++; } else invalidos.push(n);
    }
    return { ok, invalidos };
  });
  h('descadastros:remover', (telefone) => { estado.removerDescadastro(telefone); return true; });

  h('historico:ler', () => ({ resumo: estado.resumoCampanhas(), recentes: estado.historico(100).map((e) => ({ ...e, exibir: formatarTelefone(e.telefone) })) }));

  h('app:abrirPasta', () => { if (estado) shell.openPath(estado.pasta); return true; });
}

// ---------- janela ----------
function criarJanela() {
  janela = new BrowserWindow({
    width: 1100, height: 760, minWidth: 900, minHeight: 600, backgroundColor: '#0f1b2d',
    title: 'Disparo Urbano Norte',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // links externos abrem no navegador, nunca dentro do app
  janela.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  registrarIpc();
  abrirEstado();
  criarJanela();
  if (estado) { carregarPlanilha().catch(() => {}); iniciarVigia(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
