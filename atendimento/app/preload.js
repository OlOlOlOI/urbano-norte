'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const chamar = (canal) => (arg) => ipcRenderer.invoke(canal, arg);
const ouvir = (canal) => (fn) => { const f = (_e, d) => fn(d); ipcRenderer.on(canal, f); return () => ipcRenderer.removeListener(canal, f); };

contextBridge.exposeInMainWorld('api', {
  config: { ler: chamar('atendimento:config:ler'), salvar: chamar('atendimento:config:salvar'), apagar: chamar('atendimento:config:apagar') },
  conversas: chamar('atendimento:conversas'),
  mensagens: chamar('atendimento:mensagens'),
  enviar: chamar('atendimento:enviar'),
  lida: chamar('atendimento:lida'),
  resolver: chamar('atendimento:resolver'),
  reabrir: chamar('atendimento:reabrir'),
  midia: chamar('atendimento:midia'),
  diagnostico: chamar('atendimento:diagnostico'),
  aoAtualizar: ouvir('atendimento:atualizou'),
  aoAbrir: ouvir('atendimento:abrir'),
});
