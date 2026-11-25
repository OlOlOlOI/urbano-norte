'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const chamar = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);
const ouvir = (canal) => (fn) => { const f = (_e, d) => fn(d); ipcRenderer.on(canal, f); return () => ipcRenderer.removeListener(canal, f); };

contextBridge.exposeInMainWorld('api', {
  ajustes: { ler: chamar('ajustes:ler'), escolherPasta: chamar('ajustes:escolherPasta'), salvarOperador: chamar('ajustes:salvarOperador'), salvarLimites: chamar('ajustes:salvarLimites') },
  planilha: {
    estado: chamar('planilha:estado'), escolherArquivo: chamar('planilha:escolherArquivo'), definirUrl: chamar('planilha:definirUrl'),
    recarregar: chamar('planilha:recarregar'), salvarMapa: chamar('planilha:salvarMapa'),
  },
  modelos: { salvar: chamar('modelos:salvar') },
  publico: { calcular: chamar('publico:calcular') },
  envio: { previa: chamar('envio:previa'), iniciar: chamar('envio:iniciar'), cancelar: chamar('envio:cancelar') },
  descadastros: { listar: chamar('descadastros:listar'), adicionar: chamar('descadastros:adicionar'), remover: chamar('descadastros:remover') },
  historico: { ler: chamar('historico:ler') },
  abrirPasta: chamar('app:abrirPasta'),
  aoMudarPlanilha: ouvir('planilha-mudou'),
  aoProgredir: ouvir('envio:progresso'),
  aoTerminar: ouvir('envio:fim'),
});
