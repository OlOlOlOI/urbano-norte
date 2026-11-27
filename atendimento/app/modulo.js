'use strict';
// Atendimento Urbano Norte — parte do processo principal (aba Atendimento do app unificado).
// Conversa com o servidor do Atendimento (atendimento/servidor, na Cloudflare): lista conversas, mensagens, responde.
// O token do WhatsApp fica só no servidor. No app unificado, quem entra é a CONTA da pessoa (login, app/conta.js):
// o app passa `pedir` e `sessao` em registrar() e o Atendimento usa essa sessão. Sem isso (modo antigo),
// usa o endereço e a chave guardados aqui (cifrados).
const { app, ipcMain, safeStorage, shell, Notification, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let pastaDados = () => path.join(app.getPath('userData'), 'atendimento');
let janela = () => null;
let conteudo = () => null;
let aoNaoLidas = () => {};
let visivel = () => false;
let pedirConta = null;      // (caminho, opções) => chamada autenticada pela conta logada (app unificado)
let sessaoConta = () => null;

// ---------- configuração (cifrada neste computador) ----------
const arqConfig = () => path.join(pastaDados(), 'config.dat');
const protecao = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
function lerConfig() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(arqConfig()))); } catch { return {}; }
}
function gravarConfig(c) {
  if (!protecao()) throw new Error('Este computador não oferece cofre seguro para guardar a chave de acesso.');
  fs.mkdirSync(pastaDados(), { recursive: true });
  fs.writeFileSync(arqConfig() + '.tmp', safeStorage.encryptString(JSON.stringify(c)));
  fs.renameSync(arqConfig() + '.tmp', arqConfig());
}

/** Só https (ou o servidor de teste no próprio computador). */
function validarUrl(bruto) {
  let u;
  try { u = new URL(String(bruto || '').trim()); } catch { throw new Error('Endereço do servidor inválido. Ex.: https://atendimento-urbano-norte.SEU-USUARIO.workers.dev'); }
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('O endereço do servidor precisa começar com https://');
  return u.origin;
}

// ---------- chamadas ao servidor ----------
const configurado = () => (pedirConta ? Boolean(sessaoConta()) : (() => { const c = lerConfig(); return Boolean(c.url && c.chave); })());

async function chamarServidor(caminho, { metodo = 'GET', corpo, cfg, binario = false } = {}) {
  if (pedirConta && !cfg) return pedirConta(caminho, { metodo, corpo, binario });
  cfg = cfg || lerConfig();
  if (!cfg.url || !cfg.chave) throw new Error('Configure o Atendimento primeiro.');
  let r;
  try {
    r = await fetch(cfg.url + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.chave}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error('Sem conexão com o servidor do Atendimento. Confira a internet.' + (e && e.name === 'TimeoutError' ? ' (demorou demais)' : ''));
  }
  if (binario && r.ok) return { tipo: r.headers.get('Content-Type') || 'application/octet-stream', bytes: Buffer.from(await r.arrayBuffer()) };
  let dados = null;
  try { dados = await r.json(); } catch { /* sem JSON */ }
  if (r.status === 401) throw new Error('A chave de acesso do Atendimento não confere. Confira em Configurar.');
  if (!r.ok || !dados || dados.ok === false) throw new Error((dados && dados.erro) || `O servidor respondeu ${r.status}.`);
  return dados;
}

/**
 * Descobre o tipo do arquivo pelos primeiros bytes. O Instagram às vezes entrega áudio e foto marcados como
 * "arquivo genérico" (application/octet-stream): sem isso o app salvava sem extensão e o computador abria como texto.
 * @param {Buffer} b
 * @param {string} [tipoMsg] tipo da mensagem (audio, image, video...) para desempatar o MP4
 */
function tipoPelosBytes(b, tipoMsg = '') {
  const ascii = (ini, fim) => b.subarray(ini, fim).toString('latin1');
  if (b.length < 12) return null;
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(4, 8) === 'ftyp') return /^M4A|^M4B/.test(ascii(8, 12)) || tipoMsg === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return tipoMsg === 'audio' ? 'audio/webm' : 'video/webm';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  return null;
}

// número do WhatsApp (só dígitos) ou "ig_<id>" do Instagram
const enc = (waId) => { const v = String(waId || ''); return encodeURIComponent(v.startsWith('ig_') ? 'ig_' + v.slice(3).replace(/\D/g, '') : v.replace(/\D/g, '')); };

// ---------- vigia de mensagens novas (avisos e contador na aba) ----------
let ultimoTotal = null;
let ultimaVista = new Map(); // waId -> ultima_msg_em já avisada
let vigia = null;

async function conferirNovidades() {
  if (!configurado()) { aoNaoLidas(0); return; }
  let r;
  try { r = await chamarServidor('/api/conversas?estado=aberta'); } catch { return; } // sem internet: tenta no próximo ciclo
  aoNaoLidas(r.naoLidas || 0);
  const primeiraVez = ultimoTotal === null;
  for (const c of r.conversas) {
    const antes = ultimaVista.get(c.wa_id);
    ultimaVista.set(c.wa_id, c.ultima_msg_em);
    const novaDoCliente = c.nao_lidas > 0 && c.ultima_entrada_em === c.ultima_msg_em && antes !== undefined && c.ultima_msg_em > antes;
    if (!primeiraVez && (novaDoCliente || (antes === undefined && c.nao_lidas > 0)) && !visivel() && Notification.isSupported()) {
      const n = new Notification({ title: `Atendimento: ${c.apelido || (/[\p{L}\p{N}]/u.test(c.nome || '') && c.nome) || formatar(c.wa_id)}`, body: c.previa || 'Nova mensagem', silent: false });
      n.on('click', () => { const w = janela(); if (w) { w.show(); w.focus(); } avisar('atendimento:abrir', c.wa_id); });
      n.show();
    }
  }
  ultimoTotal = r.naoLidas || 0;
  avisar('atendimento:atualizou', { naoLidas: ultimoTotal });
}

function avisar(canal, dados) { const wc = conteudo(); if (wc && !wc.isDestroyed()) wc.send(canal, dados); }

function formatar(waId) {
  const d = String(waId || '');
  let m = /^55(\d{2})(9\d{4})(\d{4})$/.exec(d); if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  // o WhatsApp guarda o celular brasileiro sem o 9 extra: mostra com o 9, como as pessoas conhecem
  m = /^55(\d{2})([6-9]\d{3})(\d{4})$/.exec(d); if (m) return `(${m[1]}) 9${m[2]}-${m[3]}`;
  m = /^55(\d{2})(\d{4})(\d{4})$/.exec(d); if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return d ? '+' + d : '';
}

function iniciarVigia() {
  if (vigia) clearInterval(vigia);
  ultimoTotal = null; ultimaVista = new Map();
  conferirNovidades();
  vigia = setInterval(conferirNovidades, 20000);
}

// ---------- IPC ----------
function registrarIpc() {
  const h = (canal, fn) => ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, dados: await fn(...args) }; } catch (e) { return { ok: false, erro: String((e && e.message) || e) }; }
  });

  h('atendimento:config:ler', () => {
    if (pedirConta) {
      const s = sessaoConta();
      return { porConta: true, configurado: Boolean(s), operador: s ? s.usuario.nome : '', admin: Boolean(s && s.usuario.papel === 'admin'), protecao: protecao() };
    }
    const c = lerConfig();
    return { url: c.url || '', temChave: Boolean(c.chave), operador: c.operador || '', configurado: Boolean(c.url && c.chave), protecao: protecao() };
  });
  h('atendimento:config:salvar', async ({ url, chave, operador }) => {
    const atual = lerConfig();
    const nova = { url: validarUrl(url), chave: String(chave || '').trim() || atual.chave, operador: String(operador || '').trim().slice(0, 60) };
    if (!nova.chave) throw new Error('Cole a chave de acesso do Atendimento.');
    if (!nova.operador) throw new Error('Informe o seu nome (aparece nas respostas, para a equipe saber quem respondeu).');
    await chamarServidor('/api/status', { cfg: nova }); // confere antes de salvar
    gravarConfig(nova);
    iniciarVigia();
    return true;
  });
  h('atendimento:config:apagar', () => { fs.rmSync(arqConfig(), { force: true }); aoNaoLidas(0); return true; });

  h('atendimento:conversas', ({ estado, busca, canal } = {}) => {
    const q = new URLSearchParams();
    if (estado) q.set('estado', estado);
    if (canal) q.set('canal', canal);
    if (busca) q.set('busca', String(busca).slice(0, 60));
    return chamarServidor('/api/conversas' + (q.toString() ? '?' + q : ''));
  });
  h('atendimento:mensagens', ({ waId, desde }) => chamarServidor(`/api/conversas/${enc(waId)}/mensagens${desde ? `?desde=${Number(desde)}` : ''}`));
  h('atendimento:enviar', ({ waId, texto }) => chamarServidor(`/api/conversas/${enc(waId)}/enviar`, { metodo: 'POST', corpo: { texto: String(texto || ''), ...(pedirConta ? {} : { operador: lerConfig().operador || '' }) } }));
  h('atendimento:lida', async ({ waId }) => { await chamarServidor(`/api/conversas/${enc(waId)}/lida`, { metodo: 'POST' }); conferirNovidades(); return true; });
  h('atendimento:resolver', async ({ waId }) => { await chamarServidor(`/api/conversas/${enc(waId)}/resolver`, { metodo: 'POST' }); conferirNovidades(); return true; });
  h('atendimento:apelido', ({ waId, apelido }) => chamarServidor(`/api/conversas/${enc(waId)}/apelido`, { metodo: 'POST', corpo: { apelido: String(apelido || '') } }));
  h('atendimento:reabrir', ({ waId }) => chamarServidor(`/api/conversas/${enc(waId)}/reabrir`, { metodo: 'POST' }));

  // Fotos e áudios aparecem na própria conversa; outros arquivos (PDF, vídeo) abrem no programa padrão do computador.
  async function baixarMidia(midiaId, tipoMsg) {
    const id = String(midiaId || '').replace(/[^\w-]/g, '');
    const r = await chamarServidor(`/api/midia/${id}`, { binario: true });
    if (!r.bytes) throw new Error('Não foi possível baixar o arquivo.');
    // vale o que o arquivo é de verdade (o Instagram às vezes declara tipo genérico ou errado); sem reconhecer, fica o declarado
    const pelosBytes = tipoPelosBytes(r.bytes, tipoMsg);
    if (pelosBytes) r.tipo = pelosBytes;
    r.id = id;
    return r;
  }
  function nomeDoArquivo(r, nome) {
    const ext = { 'application/pdf': '.pdf', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/webm': '.webm', 'video/mp4': '.mp4', 'video/webm': '.webm', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[String(r.tipo || '').split(';')[0].trim()] || '.bin';
    const seguro = String(nome || `arquivo-${r.id}`).replace(/[^\w.\- ]/g, '_').slice(0, 80);
    return seguro.includes('.') ? seguro : seguro + ext;
  }

  // Fotos e áudios aparecem na própria conversa; outros arquivos (PDF, vídeo) abrem no programa padrão do computador.
  h('atendimento:midia', async ({ midiaId, nome, abrir, tipoMsg }) => {
    const r = await baixarMidia(midiaId, tipoMsg);
    if (!abrir && /^(image|audio)\//.test(r.tipo) && r.bytes.length < 16 * 1024 * 1024) {
      return { dataUrl: `data:${r.tipo};base64,${r.bytes.toString('base64')}` };
    }
    const pasta = path.join(app.getPath('temp'), 'atendimento-urbano-norte');
    fs.mkdirSync(pasta, { recursive: true });
    const alvo = path.join(pasta, nomeDoArquivo(r, nome));
    fs.writeFileSync(alvo, r.bytes);
    const falha = await shell.openPath(alvo);
    if (falha) throw new Error(falha);
    return { aberto: true };
  });

  // Salvar foto, áudio ou arquivo do cliente onde a pessoa escolher (padrão: Downloads).
  h('atendimento:salvarMidia', async ({ midiaId, nome, tipoMsg }) => {
    const r = await baixarMidia(midiaId, tipoMsg);
    const sugerido = nomeDoArquivo(r, nome || `${{ image: 'foto', sticker: 'figurinha', audio: 'audio', video: 'video' }[tipoMsg] || 'arquivo'}-${r.id.slice(-8)}`);
    const escolha = await dialog.showSaveDialog(janela() || undefined, { title: 'Salvar no computador', defaultPath: path.join(app.getPath('downloads'), sugerido) });
    if (escolha.canceled || !escolha.filePath) return null;
    fs.writeFileSync(escolha.filePath, r.bytes);
    shell.showItemInFolder(escolha.filePath);
    return { salvo: escolha.filePath };
  });

  // Foto (JPG/PNG até 5 MB) ou PDF (até 16 MB) para o cliente. Vem do botão 📎 (escolher=true) ou colado na resposta (bytes).
  h('atendimento:escolherArquivo', async () => {
    const r = await dialog.showOpenDialog(janela() || undefined, { title: 'Mandar foto ou PDF', properties: ['openFile'], filters: [{ name: 'Foto ou PDF', extensions: ['jpg', 'jpeg', 'png', 'pdf'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const bytes = fs.readFileSync(r.filePaths[0]);
    const tipo = tipoPelosBytes(bytes);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(tipo)) throw new Error('Dá para mandar foto (JPG ou PNG) ou PDF.');
    return { nome: path.basename(r.filePaths[0]), tipo, tamanho: bytes.length, dataUrl: tipo.startsWith('image/') ? `data:${tipo};base64,${bytes.toString('base64')}` : null, bytes };
  });
  h('atendimento:enviarArquivo', async ({ waId, nome, bytes, legenda }) => {
    const buf = Buffer.from(bytes || []);
    const tipo = tipoPelosBytes(buf);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(tipo)) throw new Error('Dá para mandar foto (JPG ou PNG) ou PDF.');
    const max = tipo === 'application/pdf' ? 16 : 5;
    if (buf.length > max * 1024 * 1024) throw new Error(`O arquivo passa de ${max} MB.`);
    return chamarServidor(`/api/conversas/${enc(waId)}/enviar-arquivo`, { metodo: 'POST', corpo: { nome: String(nome || '').slice(0, 120), tipo, base64: buf.toString('base64'), legenda: String(legenda || '') } });
  });

  h('atendimento:diagnostico', () => chamarServidor('/api/diagnostico', { metodo: 'POST' }));
  h('atendimento:visivel', () => visivel());
}

/**
 * Registra os canais IPC do Atendimento e começa a vigiar mensagens novas.
 * Chamar depois de app.whenReady().
 * @param {object} op
 * @param {() => string} [op.pastaDados]
 * @param {() => Electron.BrowserWindow|null} op.janela
 * @param {() => Electron.WebContents|null} op.conteudo  tela da aba Atendimento
 * @param {(n: number) => void} [op.aoNaoLidas]  total de mensagens não lidas (contador na aba)
 * @param {() => boolean} [op.visivel]  a aba Atendimento está na frente e a janela em foco?
 */
function registrar(op = {}) {
  if (op.pastaDados) pastaDados = op.pastaDados;
  if (op.janela) janela = op.janela;
  if (op.conteudo) conteudo = op.conteudo;
  if (op.aoNaoLidas) aoNaoLidas = op.aoNaoLidas;
  if (op.visivel) visivel = op.visivel;
  if (op.pedir) { pedirConta = op.pedir; sessaoConta = op.sessao || (() => null); }
  registrarIpc();
  iniciarVigia();
}

/** Recomeça a vigia (ex.: alguém entrou ou saiu da conta). */
function reiniciar() { aoNaoLidas(0); iniciarVigia(); avisar('atendimento:conta', null); }

module.exports = { registrar, reiniciar, validarUrl, formatar, tipoPelosBytes };
