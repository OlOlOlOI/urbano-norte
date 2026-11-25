'use strict';
// App próprio do disparo. A lógica fica em modulo.js (compartilhada com o app unificado da Urbano Norte).

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registrar } = require('./modulo');

let janela = null;

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
  registrar({
    janela: () => (janela && !janela.isDestroyed() ? janela : null),
    conteudo: () => (janela && !janela.isDestroyed() ? janela.webContents : null),
  });
  criarJanela();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
