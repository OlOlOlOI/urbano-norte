'use strict';
// App unificado da Urbano Norte: uma janela com abas, cada sistema na sua própria tela (WebContentsView).
// Cada tela tem o seu preload e o seu window.api, então os sistemas não se misturam.
// O código de cada sistema vem de ../sorteio/desktop e ../disparo/src (copiado para modulos/ por scripts/montar-modulos.js).
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { migrar } = require('./migracao');
const { iniciarAtualizacao } = require('./atualizacao');

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
    tela.setVisible(nome === abaAtual);
  }
}

function mostrarAba(nome) {
  if (!ABAS[nome] || vertical) return;
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
  janela.webContents.on('did-finish-load', () => { janela.webContents.send('shell:aba', abaAtual); janela.webContents.send('shell:contador', { atendimento: naoLidas }); });
  janela.on('closed', () => { janela = null; for (const k of Object.keys(telas)) delete telas[k]; });
}

const janelaViva = () => (janela && !janela.isDestroyed() ? janela : null);

ipcMain.handle('shell:trocar', (_e, nome) => { mostrarAba(String(nome)); return abaAtual; });
const VERSAO = require('./package.json').version;
ipcMain.handle('shell:info', () => ({ aba: abaAtual, versao: VERSAO }));

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
  disparo.registrar({
    pastaDados: () => pastaModulo('disparo'),
    janela: janelaViva,
    conteudo: () => (telas.disparo && !telas.disparo.webContents.isDestroyed() ? telas.disparo.webContents : null),
  });
  atendimento.registrar({
    pastaDados: () => pastaModulo('atendimento'),
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
  iniciarAtualizacao(janelaViva);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { mostrarAba, telas: () => telas, janela: () => janela, aba: () => abaAtual, vertical: () => vertical };
