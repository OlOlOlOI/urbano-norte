// App próprio do sorteio. A lógica fica em modulo.js (compartilhada com o app unificado da Urbano Norte).
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registrar } = require('./modulo');

function criarJanela() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    title: 'Sorteio Urbano Norte',
    backgroundColor: '#eceff2',
    icon: path.join(__dirname, 'build', 'icon-win.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

registrar();

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null); // sem menu, sem atalho para ferramentas do desenvolvedor
  criarJanela();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
