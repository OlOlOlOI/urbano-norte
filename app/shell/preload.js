'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  trocar: (aba) => ipcRenderer.invoke('shell:trocar', aba),
  info: () => ipcRenderer.invoke('shell:info'),
  aoMudarAba: (fn) => ipcRenderer.on('shell:aba', (_e, aba) => fn(aba)),
  aoContador: (fn) => ipcRenderer.on('shell:contador', (_e, c) => fn(c)),
});
