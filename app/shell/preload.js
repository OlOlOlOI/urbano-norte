'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const chamar = (canal) => (arg) => ipcRenderer.invoke(canal, arg);

contextBridge.exposeInMainWorld('shell', {
  trocar: (aba) => ipcRenderer.invoke('shell:trocar', aba),
  info: () => ipcRenderer.invoke('shell:info'),
  aoMudarAba: (fn) => ipcRenderer.on('shell:aba', (_e, aba) => fn(aba)),
  aoContador: (fn) => ipcRenderer.on('shell:contador', (_e, c) => fn(c)),
  aoPainel: (fn) => ipcRenderer.on('shell:painel', (_e, p) => fn(p)),
  aoConta: (fn) => ipcRenderer.on('shell:conta', (_e, c) => fn(c)),
  aoAtualizacao: (fn) => ipcRenderer.on('shell:atualizacao', (_e, s) => fn(s)),
  instalarAtualizacao: () => ipcRenderer.invoke('shell:instalarAtualizacao'),
  conta: {
    estado: chamar('conta:estado'),
    situacao: chamar('conta:situacao'),
    entrar: chamar('conta:entrar'),
    primeiroAdmin: chamar('conta:primeiroAdmin'),
    sair: chamar('conta:sair'),
    senha: chamar('conta:senha'),
    menu: chamar('conta:menu'),
    painel: chamar('conta:painel'),
    equipe: { listar: chamar('conta:equipe:listar'), criar: chamar('conta:equipe:criar'), alterar: chamar('conta:equipe:alterar') },
  },
});
