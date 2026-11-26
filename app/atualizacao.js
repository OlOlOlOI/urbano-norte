'use strict';
/**
 * Atualização automática do app no Windows.
 *
 * O app procura uma versão nova ao abrir e a cada hora, no endereço fixo da release "app-latest" do GitHub
 * (o workflow app-desktop.yml troca os arquivos dela a cada versão). Se houver, baixa em segundo plano e,
 * quando termina, pergunta se pode reiniciar. Se a pessoa disser "Depois", instala sozinho ao fechar o app.
 *
 * Só no Windows e só no app instalado (o portátil e o `npm start` não atualizam). No Mac, a atualização
 * automática exige um certificado pago da Apple; hoje só o desenvolvedor usa Mac, rodando pelo código.
 */
const { app, dialog } = require('electron');

const ENDERECO = 'https://github.com/OlOlOlOI/urbano-norte/releases/download/app-latest';
const UMA_HORA = 60 * 60 * 1000;

function iniciarAtualizacao(janela) {
  if (!app.isPackaged || process.platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_DIR) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { console.error('[atualizacao]', e); return; }

  autoUpdater.setFeedURL({ provider: 'generic', url: ENDERECO });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let perguntou = false;
  autoUpdater.on('error', (e) => console.error('[atualizacao]', e && e.message)); // sem internet etc.: tenta de novo na próxima hora
  autoUpdater.on('update-downloaded', async (info) => {
    if (perguntou) return;
    perguntou = true;
    const dono = janela();
    const opcoes = {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização pronta',
      message: `A versão ${info.version} do Urbano Norte foi baixada.`,
      detail: 'Reinicie para usar a versão nova. Se escolher "Depois", ela é instalada quando você fechar o app.',
    };
    const { response } = dono ? await dialog.showMessageBox(dono, opcoes) : await dialog.showMessageBox(opcoes);
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  const procurar = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(procurar, 10 * 1000);
  setInterval(procurar, UMA_HORA);
}

module.exports = { iniciarAtualizacao, ENDERECO };
