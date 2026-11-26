'use strict';
// App unificado da Urbano Norte: uma janela com abas, cada sistema na sua própria tela (WebContentsView).
// Cada tela tem o seu preload e o seu window.api, então os sistemas não se misturam.
// O código de cada sistema vem de ../sorteio/desktop e ../disparo/src (copiado para modulos/ por scripts/montar-modulos.js).
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell } = require('electron');

// A atualização automática vem PRIMEIRO e é registrada antes de carregar o resto: se uma versão sair com defeito
// (ex.: faltar um arquivo no instalador), o app ainda procura e instala a correção sozinho.
const atualizacao = require('./atualizacao');
app.whenReady().then(() => atualizacao.iniciarAtualizacao(() => { try { return janelaViva(); } catch { return null; } }));

const path = require('path');
const fs = require('fs');
const { migrar } = require('./migracao');
const conta = require('./conta');

// Para testes: guardar os dados em outra pasta, sem mexer nos dados reais deste computador.
if (process.env.URBANO_PASTA_DADOS) app.setPath('userData', process.env.URBANO_PASTA_DADOS);

const sorteio = require('./modulos/sorteio/modulo');
const disparo = require('./modulos/disparo/modulo');
const atendimento = require('./modulos/atendimento/modulo');

const BARRA = 48; // altura da barra de abas
const ABAS = {
  sorteio: { preload: 'modulos/sorteio/preload.js', pagina: 'modulos/sorteio/renderer/index.html', fundo: '#eceff2' },
  disparo: { preload: 'modulos/disparo/preload.js', pagina: 'modulos/disparo/renderer/index.html', fundo: '#ffffff' },
  atendimento: { preload: 'modulos/atendimento/preload.js', pagina: 'modulos/atendimento/renderer/index.html', fundo: '#f1f4f1' },
};

let janela = null;
const telas = {};
let abaAtual = 'sorteio';
let vertical = false;
let painel = null; // tela da própria barra que cobre as abas: 'login' | 'equipe' | 'senha' (null = abas)
let naoLidas = 0; // mensagens do Atendimento ainda não lidas (contador na aba) // modo vertical do sorteio (Reels/Stories): a tela ocupa a janela toda, sem barra

const pastaModulo = (nome) => path.join(app.getPath('userData'), nome);
const arqPrefs = () => path.join(app.getPath('userData'), 'app.json');
const lerPrefs = () => { try { return JSON.parse(fs.readFileSync(arqPrefs(), 'utf8')); } catch { return {}; } };
const gravarPrefs = (p) => { try { fs.writeFileSync(arqPrefs(), JSON.stringify({ ...lerPrefs(), ...p })); } catch { /* ignora */ } };

function posicionar() {
  if (!janela || janela.isDestroyed()) return;
  const [largura, altura] = janela.getContentSize();
  const topo = vertical ? 0 : BARRA;
  for (const [nome, tela] of Object.entries(telas)) {
    tela.setBounds({ x: 0, y: topo, width: largura, height: Math.max(0, altura - topo) });
    tela.setVisible(!painel && nome === abaAtual);
  }
}

function mostrarAba(nome) {
  if (!ABAS[nome] || vertical || painel) return;
  abaAtual = nome;
  posicionar();
  telas[nome].webContents.focus();
  janela.webContents.send('shell:aba', nome);
  gravarPrefs({ aba: nome });
}

// Ctrl+1 / Ctrl+2 / Ctrl+3 (Cmd no Mac) trocam de aba de qualquer tela.
function atalhos(wc) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt || input.shift) return;
    const alvo = { 1: 'sorteio', 2: 'disparo', 3: 'atendimento' }[input.key];
    if (alvo) { e.preventDefault(); mostrarAba(alvo); }
  });
}

function protegerNavegacao(wc) {
  // links externos abrem no navegador, nunca dentro do app
  wc.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e) => e.preventDefault());
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1180, height: 780 + BARRA, minWidth: 960, minHeight: 680 + BARRA,
    title: 'Urbano Norte',
    backgroundColor: '#2b2a2c',
    icon: path.join(__dirname, 'build', 'icon-win.png'),
    webPreferences: { preload: path.join(__dirname, 'shell', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  janela.removeMenu();
  janela.loadFile(path.join(__dirname, 'shell', 'index.html'));
  protegerNavegacao(janela.webContents);
  atalhos(janela.webContents);

  for (const [nome, cfg] of Object.entries(ABAS)) {
    const tela = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, cfg.preload), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    tela.setBackgroundColor(cfg.fundo);
    janela.contentView.addChildView(tela);
    protegerNavegacao(tela.webContents);
    atalhos(tela.webContents);
    tela.webContents.loadFile(path.join(__dirname, cfg.pagina));
    telas[nome] = tela;
  }

  const salva = lerPrefs().aba;
  if (ABAS[salva]) abaAtual = salva;
  posicionar();
  janela.on('resize', posicionar);
  janela.webContents.on('did-finish-load', () => { janela.webContents.send('shell:aba', abaAtual); janela.webContents.send('shell:contador', { atendimento: naoLidas }); janela.webContents.send('shell:painel', painel); });
  janela.on('closed', () => { janela = null; for (const k of Object.keys(telas)) delete telas[k]; });
}

const janelaViva = () => (janela && !janela.isDestroyed() ? janela : null);

ipcMain.handle('shell:trocar', (_e, nome) => { mostrarAba(String(nome)); return abaAtual; });
const VERSAO = require('./package.json').version;
ipcMain.handle('shell:info', () => ({ aba: abaAtual, versao: VERSAO, conta: conta.estado(), painel, atualizacao: atualizacao.situacao() }));
ipcMain.handle('shell:instalarAtualizacao', () => atualizacao.instalarAgora());
atualizacao.aoMudar((s) => { try { if (janelaViva()) janela.webContents.send('shell:atualizacao', s); } catch { /* janela ainda não existe */ } });

// ---------- login e equipe (app/conta.js) ----------
function abrirPainel(nome) {
  painel = nome;
  posicionar();
  if (janelaViva()) { janela.webContents.send('shell:painel', painel); if (!painel && telas[abaAtual]) telas[abaAtual].webContents.focus(); }
}
const hConta = (canal, fn) => ipcMain.handle(canal, async (_e, ...args) => {
  try { return { ok: true, dados: await fn(...args) }; } catch (e) { return { ok: false, erro: String((e && e.message) || e) }; }
});
hConta('conta:estado', () => conta.estado());
hConta('conta:situacao', () => conta.situacaoServidor());
hConta('conta:entrar', (d) => conta.entrar(d || {}));
hConta('conta:primeiroAdmin', (d) => conta.primeiroAdmin(d || {}));
hConta('conta:sair', () => conta.sair());
hConta('conta:senha', (d) => conta.trocarSenha(d || {}));
hConta('conta:equipe:listar', () => conta.equipe.listar());
hConta('conta:equipe:criar', (d) => conta.equipe.criar(d || {}));
hConta('conta:equipe:alterar', ({ id, ...d } = {}) => conta.equipe.alterar(id, d));
hConta('conta:painel', (nome) => { if (conta.estado().logado) abrirPainel(['equipe', 'senha'].includes(nome) ? nome : null); return painel; });
hConta('conta:menu', () => {
  const e = conta.estado();
  if (!e.logado || !janelaViva()) return null;
  Menu.buildFromTemplate([
    { label: `${e.usuario.nome} (${e.usuario.usuario})`, enabled: false },
    { type: 'separator' },
    ...(e.usuario.papel === 'admin' ? [{ label: 'Equipe…', click: () => abrirPainel('equipe') }] : []),
    { label: 'Trocar minha senha…', click: () => abrirPainel('senha') },
    { type: 'separator' },
    ...(() => {
      const a = atualizacao.situacao();
      if (a.fase === 'desligada') return [{ label: `Versão ${VERSAO} · ${a.motivo || 'atualização automática desligada'}`, enabled: false }];
      if (a.fase === 'pronta') return [{ label: `Reiniciar e instalar a versão ${a.versao}`, click: () => atualizacao.instalarAgora() }];
      const situacaoTxt = { procurando: 'procurando…', baixando: `baixando ${a.versao} (${a.progresso}%)`, 'em-dia': 'em dia', erro: `erro: ${a.erro}` }[a.fase] || '';
      return [{ label: `Versão ${VERSAO}${situacaoTxt ? ` · ${situacaoTxt}` : ''}`, enabled: false },
        { label: 'Procurar atualização agora', enabled: a.fase !== 'procurando' && a.fase !== 'baixando', click: () => atualizacao.procurarAgora() }];
    })(),
    { type: 'separator' },
    { label: 'Sair', click: () => conta.sair() },
  ]).popup({ window: janela });
  return null;
});

// Entrou, saiu ou a sessão terminou: mostra o login ou as abas e avisa os sistemas (o nome de quem usa mudou).
conta.aoMudar((e) => {
  abrirPainel(e.logado ? null : 'login');
  if (janelaViva()) janela.webContents.send('shell:conta', e);
  disparo.reiniciar();
  atendimento.reiniciar();
  if (telas.disparo && !telas.disparo.webContents.isDestroyed()) telas.disparo.webContents.reload();
});

sorteio.registrar({
  pastaDados: () => pastaModulo('sorteio'),
  janelaDe: janelaViva,
  aoVertical: (ativo) => {
    vertical = !!ativo;
    if (vertical) abaAtual = 'sorteio';
    posicionar();
  },
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null); // sem menu, sem atalho para ferramentas do desenvolvedor
  try { migrar(app.getPath('appData'), app.getPath('userData')); } catch (e) { console.error('[migracao]', e); }
  if (!conta.carregar().logado) painel = 'login';
  const nomeDaConta = () => { const s = conta.sessao(); return s ? s.usuario.nome : null; };
  disparo.registrar({
    operador: nomeDaConta,
    pedir: (caminho, op) => conta.pedir(caminho, op),
    pastaDados: () => pastaModulo('disparo'),
    janela: janelaViva,
    conteudo: () => (telas.disparo && !telas.disparo.webContents.isDestroyed() ? telas.disparo.webContents : null),
  });
  atendimento.registrar({
    pastaDados: () => pastaModulo('atendimento'),
    pedir: (caminho, op) => conta.pedir(caminho, op),
    sessao: () => conta.sessao(),
    janela: janelaViva,
    conteudo: () => (telas.atendimento && !telas.atendimento.webContents.isDestroyed() ? telas.atendimento.webContents : null),
    visivel: () => Boolean(janelaViva() && janela.isFocused() && abaAtual === 'atendimento'),
    aoNaoLidas: (n) => {
      naoLidas = n;
      if (janelaViva()) janela.webContents.send('shell:contador', { atendimento: n });
      try { app.setBadgeCount(n); } catch { /* sistema sem contador no ícone */ }
    },
  });
  criarJanela();
  conta.conferir(); // confere com o servidor em segundo plano (senha trocada, conta desativada...)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { mostrarAba, telas: () => telas, janela: () => janela, aba: () => abaAtual, vertical: () => vertical, painel: () => painel };
