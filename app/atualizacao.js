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
 *
 * A situação (procurando, baixando, pronta, erro) aparece na barra do app, e cada passo fica registrado em
 * <dados do app>/atualizacao.log — assim dá para saber por que um computador não atualizou.
 */
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const ENDERECO = 'https://github.com/OlOlOlOI/urbano-norte/releases/download/app-latest';
const UMA_HORA = 60 * 60 * 1000;

let atualizador = null;
let situacao = { fase: 'desligada', motivo: '', versao: '', progresso: 0, erro: '', quando: 0 };
const ouvintes = new Set();

function registrar(linha) {
  try {
    const arq = path.join(app.getPath('userData'), 'atualizacao.log');
    try { if (fs.statSync(arq).size > 200 * 1024) fs.renameSync(arq, arq + '.antigo'); } catch { /* ainda não existe */ }
    fs.appendFileSync(arq, `${new Date().toISOString()} v${app.getVersion()} ${linha}\n`);
  } catch { /* sem disco: segue */ }
}

function mudar(novo) {
  situacao = { ...situacao, ...novo, quando: Date.now() };
  for (const fn of ouvintes) { try { fn(situacao); } catch { /* tela fechada */ } }
}

/** Por que este app não se atualiza sozinho (ou '' se atualiza). */
function motivoDesligada() {
  if (!app.isPackaged) return 'rodando pelo código (npm start)';
  if (process.platform !== 'win32') return 'no Mac a atualização é manual';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'versão portátil: instale o "Instalador" para atualizar sozinho';
  return '';
}

function iniciarAtualizacao(janela) {
  const motivo = motivoDesligada();
  if (motivo) { mudar({ fase: 'desligada', motivo }); return; }
  try { ({ autoUpdater: atualizador } = require('electron-updater')); } catch (e) {
    registrar(`erro ao carregar electron-updater: ${e && e.message}`);
    mudar({ fase: 'erro', erro: 'Não foi possível ligar a atualização automática.' });
    return;
  }

  atualizador.setFeedURL({ provider: 'generic', url: ENDERECO });
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;
  atualizador.logger = { info: (m) => registrar(`info ${m}`), warn: (m) => registrar(`aviso ${m}`), error: (m) => registrar(`erro ${m}`), debug: () => {} };

  let perguntou = '';
  atualizador.on('checking-for-update', () => mudar({ fase: 'procurando', erro: '' }));
  atualizador.on('update-not-available', () => mudar({ fase: 'em-dia', versao: '' }));
  atualizador.on('update-available', (info) => { registrar(`versão nova ${info.version}`); mudar({ fase: 'baixando', versao: info.version, progresso: 0 }); });
  atualizador.on('download-progress', (p) => mudar({ fase: 'baixando', progresso: Math.round(p.percent || 0) }));
  atualizador.on('error', (e) => {
    const msg = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    registrar(`erro ${msg}`);
    mudar({ fase: 'erro', erro: msg }); // sem internet etc.: tenta de novo na próxima hora
  });
  atualizador.on('update-downloaded', async (info) => {
    registrar(`baixada ${info.version}`);
    mudar({ fase: 'pronta', versao: info.version, progresso: 100 });
    if (perguntou === info.version) return;
    perguntou = info.version;
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
    if (response === 0) instalarAgora();
  });

  setTimeout(procurarAgora, 10 * 1000);
  setInterval(procurarAgora, UMA_HORA);
}

function procurarAgora() {
  if (!atualizador) return situacao;
  atualizador.checkForUpdates().catch((e) => { registrar(`erro ao procurar ${e && e.message}`); });
  return situacao;
}

function instalarAgora() {
  if (!atualizador || situacao.fase !== 'pronta') return false;
  registrar(`instalando ${situacao.versao}`);
  setImmediate(() => atualizador.quitAndInstall(true, true));
  return true;
}

module.exports = {
  iniciarAtualizacao, procurarAgora, instalarAgora, ENDERECO,
  situacao: () => situacao,
  aoMudar: (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  arquivoRegistro: () => path.join(app.getPath('userData'), 'atualizacao.log'),
};
