'use strict';
// Disparo Urbano Norte — parte do processo principal (planilha, campanhas, descadastros...).
// Usado pelo app próprio do disparo (main.js) e pelo app unificado da Urbano Norte (pasta app/ do monorepo).

const { app, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { lerPlanilha } = require('./core/parse');
const { montarPublico } = require('./core/audience');
const { normalizarTelefone, formatarTelefone } = require('./core/phone');
const { renderizar } = require('./core/template');
const { Estado, slug } = require('./core/state');
const { executarCampanha } = require('./core/sender');
const { adivinharColunas, colunasFaltando } = require('./core/columns');
const { criarProvedorSimulacao } = require('./core/provider-sim');
const { criarProvedorMeta } = require('./core/provider-meta');
const { paraModeloMeta, nomeTecnico, mesmoTexto, situacao, CATEGORIAS, validarExtras, assinaturaExtras, componentesModelo, componentesEnvio, TIPOS_IMAGEM, MAX_IMAGEM } = require('./core/modelo-meta');

// ---------- imagens das mensagens (ficam na pasta compartilhada, em imagens/) ----------
const EXT_IMAGEM = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
function caminhoImagem(arquivo) {
  const rel = String(arquivo || '');
  if (!/^imagens\/[\w.-]+$/.test(rel)) throw new Error('Imagem inválida.');
  return path.join(estado.pasta, rel);
}
function lerImagem(img) {
  const p = caminhoImagem(img.arquivo);
  if (!fs.existsSync(p)) throw new Error(`A imagem "${img.nome || img.arquivo}" não está mais na pasta compartilhada. Escolha a imagem de novo.`);
  return fs.readFileSync(p);
}

// ---------- configuração local (por computador) ----------
let pastaDados = () => app.getPath('userData');
const arqLocal = () => path.join(pastaDados(), 'config-local.json');
function lerLocal() { try { return JSON.parse(fs.readFileSync(arqLocal(), 'utf8')); } catch { return {}; } }
function gravarLocal(p) { const n = { ...lerLocal(), ...p }; fs.mkdirSync(path.dirname(arqLocal()), { recursive: true }); fs.writeFileSync(arqLocal(), JSON.stringify(n, null, 2)); return n; }

// ---------- WhatsApp (API oficial da Meta): credenciais deste computador ----------
// O token NUNCA vai para a pasta compartilhada: fica cifrado pelo sistema (Keychain no Mac, DPAPI no Windows).
const arqWhats = () => path.join(pastaDados(), 'whatsapp.dat');
const protecao = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
function lerWhats() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(arqWhats()))); } catch { return {}; }
}
function gravarWhats(dados) {
  if (!protecao()) throw new Error('Este computador não oferece cofre seguro para guardar o token.');
  fs.mkdirSync(path.dirname(arqWhats()), { recursive: true });
  fs.writeFileSync(arqWhats() + '.tmp', safeStorage.encryptString(JSON.stringify(dados)));
  fs.renameSync(arqWhats() + '.tmp', arqWhats());
}
function provedorMeta() {
  const w = lerWhats();
  if (!w.numeroId || !w.token) throw new Error('Configure o WhatsApp em Configurações primeiro.');
  return criarProvedorMeta({ numeroId: w.numeroId, token: w.token });
}

/** Envio real só quando este computador ligou o modo real E o WhatsApp está configurado. */
function modoReal() { const w = lerWhats(); return Boolean(lerLocal().envioReal && w.numeroId && w.token); }

/** Conta do WhatsApp (onde ficam os modelos). Descobre uma vez e guarda junto das credenciais. */
// Conta (WABA) "Urbano Norte Rio Verde", dona do +55 64 99905-1127. Testada primeiro; as outras são procuradas pelo token.
const WABAS_CONHECIDAS = ['1789237192189564'];

async function contaWhats() {
  const w = lerWhats();
  if (w.waba) return w.waba;
  const r = await provedorMeta().descobrirConta(WABAS_CONHECIDAS);
  if (!r.ok) throw new Error(r.erro);
  gravarWhats({ ...w, waba: r.conta });
  return r.conta;
}

/** Atualiza a situação (aprovada, em análise...) das mensagens que já foram para a Meta. */
async function atualizarSituacaoMeta() {
  if (!estado) return [];
  const modelos = estado.lerConfig().modelos || [];
  if (!modelos.some((m) => m.meta && m.meta.nome)) return modelos;
  const r = await provedorMeta().listarModelos(await contaWhats());
  if (!r.ok) throw new Error(r.erro);
  const porNome = new Map(r.modelos.map((m) => [m.nome, m]));
  let mudou = false;
  const novos = modelos.map((m) => {
    if (!m.meta || !m.meta.nome) return m;
    const x = porNome.get(m.meta.nome);
    const status = x ? x.status : 'DELETED';
    const motivo = x ? x.motivo : 'apagado na Meta';
    const categoria = (x && x.categoria) || m.meta.categoria;
    if (status === m.meta.status && motivo === m.meta.motivo && categoria === m.meta.categoria) return m;
    mudou = true;
    return { ...m, meta: { ...m.meta, status, motivo, categoria } };
  });
  if (mudou) estado.gravarConfig({ modelos: novos });
  return novos;
}

let janela = () => null;   // janela dona dos diálogos
let conteudo = () => null; // tela do disparo, que recebe os avisos
let estado = null;          // Estado compartilhado (null até escolher pasta + nome)
let planilha = null;        // { headers, rows, origem, atualizadoEm, hash }
let envioAtual = null;      // { sinal } enquanto uma campanha roda
let vigia = null;           // timer que confere se a planilha mudou

let operadorDaConta = () => null; // no app unificado, o nome vem do login (app/conta.js)
let pedirServidor = null;          // no app unificado: chamada ao servidor do Atendimento com a conta logada

/**
 * Traz para a lista de descadastros quem clicou em "Não quero receber" numa campanha
 * (o servidor do Atendimento recebe o clique pela Meta). Sem internet ou sem login, segue com a lista que tem.
 */
async function sincronizarDescadastros() {
  if (!pedirServidor || !estado) return 0;
  let r;
  try { r = await pedirServidor('/api/descadastros'); } catch { return 0; }
  const ja = estado.descadastrados();
  let novos = 0;
  for (const d of (r && r.descadastros) || []) {
    const t = normalizarTelefone(d.wa_id);
    if (t.ok && !ja.has(t.e164)) { estado.adicionarDescadastro(t.e164, 'Clicou em “Não quero receber” numa campanha'); ja.add(t.e164); novos++; }
  }
  return novos;
}

function abrirEstado() {
  const l = lerLocal();
  const operador = operadorDaConta() || l.operador;
  estado = l.pasta && operador ? new Estado(l.pasta, operador) : null;
  return estado;
}
const avisar = (canal, dados) => { const wc = conteudo(); if (wc && !wc.isDestroyed()) wc.send(canal, dados); };

// ---------- planilha ----------
async function baixarUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Use um link https://');
  const r = await fetch(u, { redirect: 'follow' });
  if (!r.ok) throw new Error(`O link respondeu ${r.status}. Confira se a planilha está publicada/compartilhada.`);
  return Buffer.from(await r.arrayBuffer());
}

async function carregarPlanilha() {
  if (!estado) throw new Error('Escolha a pasta compartilhada e informe seu nome em Ajustes.');
  const cfg = estado.lerConfig();
  const f = cfg.fonte;
  if (!f) { planilha = null; return null; }

  let buf; let nome;
  if (f.tipo === 'arquivo') {
    const caminho = path.join(estado.pasta, f.nome);
    if (!fs.existsSync(caminho)) throw new Error(`Não achei "${f.nome}" na pasta compartilhada.`);
    buf = fs.readFileSync(caminho); nome = f.nome;
  } else if (f.tipo === 'url') {
    buf = await baixarUrl(f.url); nome = f.url;
  } else return null;

  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (planilha && planilha.hash === hash) return planilha; // nada mudou
  const { headers, rows } = await lerPlanilha(buf, nome);
  planilha = { headers, rows, hash, origem: f.tipo === 'arquivo' ? f.nome : f.url, atualizadoEm: new Date().toISOString() };
  // primeira vez (ou mapa vazio): descobre as colunas sozinho e já deixa salvo para todos
  if (!(cfg.mapa && cfg.mapa.telefone)) {
    const chute = adivinharColunas(headers);
    if (chute.telefone) { estado.gravarConfig({ mapa: chute }); planilha.mapaAutomatico = true; }
  }
  return planilha;
}

function iniciarVigia() {
  if (vigia) clearInterval(vigia);
  vigia = setInterval(async () => {
    if (!estado || envioAtual) return;
    try {
      const antes = planilha && planilha.hash;
      const p = await carregarPlanilha();
      if (p && p.hash !== antes) avisar('planilha-mudou', resumoPlanilha());
    } catch { /* erro transitório (arquivo sendo sincronizado, sem internet): tenta no próximo ciclo */ }
  }, 15000);
}

function resumoPlanilha() {
  if (!planilha) return null;
  const mapa = (estado && estado.lerConfig().mapa) || {};
  return {
    headers: planilha.headers, linhas: planilha.rows.length, origem: planilha.origem, atualizadoEm: planilha.atualizadoEm,
    amostra: planilha.rows.slice(0, 3), mapa, mapaAutomatico: Boolean(planilha.mapaAutomatico),
    mapaProblema: colunasFaltando(mapa, planilha.headers),
  };
}

function publico(campanha, simulacao) {
  const cfg = estado.lerConfig();
  const mapa = cfg.mapa || {};
  if (!planilha) throw new Error('Nenhuma planilha carregada.');
  if (!mapa.telefone) throw new Error('Escolha a coluna do telefone na aba Planilha.');
  return montarPublico(planilha.rows, mapa, {
    descadastrados: estado.descadastrados(),
    jaEnviados: campanha ? estado.enviados(campanha, simulacao) : new Set(),
  });
}

// ---------- IPC ----------
/**
 * Registra os canais IPC do disparo e começa a vigiar a planilha.
 * Chamar depois de app.whenReady().
 * @param {object} [op]
 * @param {() => string} [op.pastaDados] onde gravar a configuração deste computador (padrão: userData)
 * @param {() => Electron.BrowserWindow|null} op.janela janela dona dos diálogos
 * @param {() => Electron.WebContents|null} op.conteudo tela do disparo, que recebe os avisos de progresso
 */
function registrar(op = {}) {
  if (op.pastaDados) pastaDados = op.pastaDados;
  if (op.janela) janela = op.janela;
  if (op.conteudo) conteudo = op.conteudo;
  if (op.operador) operadorDaConta = op.operador;
  if (op.pedir) pedirServidor = op.pedir;
  registrarIpc();
  abrirEstado();
  if (estado) { carregarPlanilha().catch(() => {}); iniciarVigia(); }
}

function registrarIpc() {
  const h = (canal, fn) => ipcMain.handle(canal, async (_e, ...args) => {
    try { return { ok: true, dados: await fn(...args) }; } catch (e) { return { ok: false, erro: String(e && e.message || e) }; }
  });

  h('ajustes:ler', () => {
    const l = lerLocal();
    const cfg = estado ? estado.lerConfig() : {};
    return { pasta: l.pasta || '', operador: operadorDaConta() || l.operador || '', operadorPelaConta: Boolean(operadorDaConta()), pronto: Boolean(estado), simulacao: !modoReal(), querReal: Boolean(l.envioReal), limiteDiario: cfg.limiteDiario ?? 250, intervaloMs: cfg.intervaloMs ?? 1000, versao: app.getVersion() };
  });
  h('ajustes:escolherPasta', async () => {
    const r = await dialog.showOpenDialog(janela() || undefined, { properties: ['openDirectory', 'createDirectory'], title: 'Pasta compartilhada (Drive, OneDrive...)' });
    if (r.canceled || !r.filePaths[0]) return null;
    gravarLocal({ pasta: r.filePaths[0] });
    abrirEstado();
    return r.filePaths[0];
  });
  h('ajustes:salvarOperador', (nome) => {
    const n = String(nome || '').trim();
    if (!n) throw new Error('Informe seu nome.');
    gravarLocal({ operador: n });
    abrirEstado();
    return true;
  });
  h('ajustes:salvarLimites', ({ limiteDiario, intervaloMs }) => {
    if (!estado) throw new Error('Configure a pasta primeiro.');
    estado.gravarConfig({ limiteDiario: Math.max(0, Number(limiteDiario) || 0), intervaloMs: Math.max(0, Number(intervaloMs) || 0) });
    return true;
  });

  h('planilha:estado', async () => { if (estado) await carregarPlanilha().catch(() => {}); return { resumo: resumoPlanilha(), config: estado ? estado.lerConfig() : {} }; });
  h('planilha:escolherArquivo', async () => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    const r = await dialog.showOpenDialog(janela() || undefined, { properties: ['openFile'], filters: [{ name: 'Planilhas', extensions: ['xlsx', 'csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let origem = r.filePaths[0];
    const dentro = path.relative(estado.pasta, origem);
    let nome = path.basename(origem);
    if (dentro.startsWith('..') || path.isAbsolute(dentro)) {
      fs.copyFileSync(origem, path.join(estado.pasta, nome)); // traz para a pasta compartilhada
    } else nome = dentro;
    estado.gravarConfig({ fonte: { tipo: 'arquivo', nome } });
    planilha = null;
    await carregarPlanilha();
    iniciarVigia();
    return resumoPlanilha();
  });
  h('planilha:definirUrl', async (url) => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    estado.gravarConfig({ fonte: { tipo: 'url', url: String(url).trim() } });
    planilha = null;
    await carregarPlanilha();
    iniciarVigia();
    return resumoPlanilha();
  });
  h('planilha:recarregar', async () => { planilha = null; await carregarPlanilha(); return resumoPlanilha(); });
  h('planilha:salvarMapa', (mapa) => { estado.gravarConfig({ mapa }); return true; });

  h('modelos:salvar', (modelos) => { estado.gravarConfig({ modelos }); return true; });
  h('modelos:escolherImagem', async () => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    const r = await dialog.showOpenDialog(janela() || undefined, { title: 'Imagem da mensagem', properties: ['openFile'], filters: [{ name: 'Imagens (JPG ou PNG)', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const origem = r.filePaths[0];
    const tipo = EXT_IMAGEM[path.extname(origem).toLowerCase()];
    if (!tipo || !TIPOS_IMAGEM.includes(tipo)) throw new Error('A imagem precisa ser JPG ou PNG.');
    const bytes = fs.readFileSync(origem);
    if (bytes.length > MAX_IMAGEM) throw new Error(`A imagem tem ${(bytes.length / 1024 / 1024).toFixed(1)} MB; o WhatsApp aceita até 5 MB.`);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const arquivo = `imagens/${hash}${tipo === 'image/png' ? '.png' : '.jpg'}`;
    fs.mkdirSync(path.join(estado.pasta, 'imagens'), { recursive: true });
    if (!fs.existsSync(caminhoImagem(arquivo))) fs.writeFileSync(caminhoImagem(arquivo), bytes); // copia para a pasta: todos os computadores veem
    return { imagem: { arquivo, nome: path.basename(origem), tipo, tamanho: bytes.length, hash }, dataUrl: `data:${tipo};base64,${bytes.toString('base64')}` };
  });
  h('modelos:imagem', (img) => {
    if (!estado || !img) return null;
    try { return `data:${img.tipo};base64,${lerImagem(img).toString('base64')}`; } catch { return null; }
  });
  h('modelos:situacao', async () => ({ modelos: await atualizarSituacaoMeta(), categorias: CATEGORIAS }));
  h('modelos:enviarMeta', async ({ id, categoria }) => {
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    if (!CATEGORIAS[categoria]) throw new Error('Escolha o tipo da mensagem.');
    const modelos = estado.lerConfig().modelos || [];
    const m = modelos.find((x) => x.id === id);
    if (!m) throw new Error('Mensagem não encontrada. Ela pode ter sido apagada em outro computador.');
    const conv = paraModeloMeta(m.corpo);
    if (!conv.ok) throw new Error(conv.erro);
    const extras = validarExtras(m);
    if (!extras.ok) throw new Error(extras.erro);
    const nome = nomeTecnico(m.nome);
    const p = provedorMeta();
    let handle;
    if (m.imagem) {
      const up = await p.subirImagemModelo({ bytes: lerImagem(m.imagem), tipo: m.imagem.tipo, nome: path.basename(m.imagem.arquivo) });
      if (!up.ok) throw new Error(`Não consegui enviar a imagem para a Meta: ${up.erro}`);
      handle = up.handle;
    }
    const r = await p.criarModelo(await contaWhats(), { nome, categoria, idioma: 'pt_BR', componentes: componentesModelo(m, conv, handle) });
    if (!r.ok) throw new Error(r.erro);
    const meta = { nome, idioma: 'pt_BR', texto: conv.texto, corpoEnviado: m.corpo, extrasEnviados: assinaturaExtras(m), categoria: r.categoria || categoria, status: r.status || 'PENDING', id: r.id, enviadoEm: new Date().toISOString(), por: estado.operador };
    // relê antes de gravar: outro computador pode ter mexido na lista enquanto a Meta respondia
    const atuais = estado.lerConfig().modelos || [];
    estado.gravarConfig({ modelos: atuais.map((x) => (x.id === id ? { ...x, meta } : x)) });
    return { meta, situacao: situacao(meta, m.corpo, assinaturaExtras(m)) };
  });
  h('ajustes:modoReal', async (ligar) => {
    if (ligar) {
      const w = lerWhats();
      if (!w.numeroId || !w.token) throw new Error('Configure o WhatsApp (ID do número e token) antes de ligar o envio real.');
    }
    gravarLocal({ envioReal: Boolean(ligar) });
    return { simulacao: !modoReal() };
  });

  h('publico:calcular', async ({ campanha }) => {
    await sincronizarDescadastros();
    const r = publico(campanha ? slug(campanha) : '', true);
    return { stats: r.stats, usouAceite: r.usouAceite, amostra: r.destinatarios.slice(0, 20).map((d) => ({ ...d, exibir: formatarTelefone(d.telefone) })), rejeitados: r.rejeitados.slice(0, 200) };
  });

  h('envio:previa', ({ corpo, nome }) => renderizar(corpo, { nome }));

  h('envio:iniciar', async ({ campanha, corpo, modeloId }) => {
    if (envioAtual) throw new Error('Já existe um envio em andamento.');
    if (!estado) throw new Error('Configure a pasta compartilhada primeiro.');
    await sincronizarDescadastros(); // quem clicou em "Não quero receber" desde a última vez fica de fora
    const id = slug(campanha);
    if (!campanha.trim()) throw new Error('Dê um nome à campanha.');
    if (!String(corpo || '').trim()) throw new Error('Escreva a mensagem.');
    const real = modoReal();
    let modeloMeta = null;
    let mensagem = null;
    let imagemId;
    if (real) {
      const m = (estado.lerConfig().modelos || []).find((x) => x.id === modeloId);
      if (!m || m.corpo !== corpo) throw new Error('A mensagem mudou. Volte ao passo 1 e escolha de novo.');
      const sit = situacao(m.meta, m.corpo, assinaturaExtras(m));
      if (sit.codigo !== 'aprovado') throw new Error(`Esta mensagem não pode ir no envio real: ${sit.texto.toLowerCase()}.`);
      modeloMeta = { nome: m.meta.nome, idioma: m.meta.idioma || 'pt_BR' };
      mensagem = m;
    }
    const provedor = real ? provedorMeta() : criarProvedorSimulacao({ atrasoMs: 0 });
    if (real && mensagem && mensagem.imagem) { // a imagem sobe uma vez só; cada pessoa recebe pelo id
      const up = await provedor.subirMidia({ bytes: lerImagem(mensagem.imagem), tipo: mensagem.imagem.tipo, nome: path.basename(mensagem.imagem.arquivo) });
      if (!up.ok) throw new Error(`Não consegui enviar a imagem para a Meta: ${up.erro}`);
      imagemId = up.id;
    }
    const { destinatarios } = publico(id, provedor.simulacao);
    if (!destinatarios.length) throw new Error('Não há destinatários aptos para esta campanha.');
    const cfg = estado.lerConfig();
    const sinal = { cancelado: false };
    envioAtual = { sinal };
    // roda em segundo plano; o progresso volta por evento
    executarCampanha({
      destinatarios, corpo, campanha: id, provedor, estado, sinal, modeloMeta, mensagem, imagemId,
      limiteDiario: cfg.limiteDiario ?? 250, intervaloMs: provedor.simulacao ? 40 : (cfg.intervaloMs ?? 1000),
      aoProgredir: (p) => avisar('envio:progresso', p),
    }).then((resumo) => avisar('envio:fim', resumo))
      .catch((e) => avisar('envio:fim', { erro: String(e.message || e) }))
      .finally(() => { envioAtual = null; });
    return { total: destinatarios.length, simulacao: provedor.simulacao };
  });
  h('envio:cancelar', () => { if (envioAtual) envioAtual.sinal.cancelado = true; return true; });

  h('descadastros:listar', async () => {
    await sincronizarDescadastros();
    return estado.listaDescadastros().map((d) => ({ ...d, exibir: formatarTelefone(d.telefone) }));
  });
  h('descadastros:adicionar', (texto) => {
    const numeros = String(texto || '').split(/[\n;,]+/).map((s) => s.trim()).filter(Boolean);
    let ok = 0; const invalidos = [];
    for (const n of numeros) {
      const t = normalizarTelefone(n);
      if (t.ok) { estado.adicionarDescadastro(t.e164, 'adicionado manualmente'); ok++; } else invalidos.push(n);
    }
    return { ok, invalidos };
  });
  h('descadastros:remover', (telefone) => { estado.removerDescadastro(telefone); return true; });

  h('historico:ler', () => ({ resumo: estado.resumoCampanhas(), recentes: estado.historico(100).map((e) => ({ ...e, exibir: formatarTelefone(e.telefone) })) }));

  // ---------- WhatsApp: credenciais e teste no próprio número ----------
  h('whatsapp:ler', () => {
    const w = lerWhats();
    return { numeroId: w.numeroId || '', temToken: Boolean(w.token), meuNumero: w.meuNumero ? formatarTelefone(w.meuNumero) : '', conta: w.conta || null, protecao: protecao() };
  });
  h('whatsapp:salvar', async ({ numeroId, token, meuNumero }) => {
    const atual = lerWhats();
    const id = String(numeroId || '').trim();
    if (!/^\d{5,25}$/.test(id)) throw new Error('O ID do número de telefone tem só números (copie do painel da Meta).');
    const tok = String(token || '').trim() || atual.token;
    if (!tok) throw new Error('Cole o token de acesso.');
    const digitos = String(meuNumero || '').replace(/\D/g, '');
    if (/^1?555\d{7}$/.test(digitos) || String(meuNumero || '').trim().startsWith('+1')) {
      throw new Error('Esse é o número de teste da Meta (o remetente). Neste campo vai o SEU celular, que recebe o teste, ex.: (64) 99999-8888.');
    }
    const tel = normalizarTelefone(meuNumero);
    if (!tel.ok) throw new Error(`Seu número parece errado (${tel.motivo}). Use DDD + número, ex.: (64) 99999-8888.`);
    // confere com a Meta antes de salvar, para já avisar se algo está errado
    const c = await criarProvedorMeta({ numeroId: id, token: tok }).conferir();
    if (!c.ok) throw new Error(c.erro);
    const conta = { numero: c.numero, nome: c.nome, conferidoEm: new Date().toISOString() };
    gravarWhats({ numeroId: id, token: tok, meuNumero: tel.e164, conta, ...(atual.numeroId === id && atual.waba ? { waba: atual.waba } : {}) });
    return conta;
  });
  h('whatsapp:apagar', () => { fs.rmSync(arqWhats(), { force: true }); return true; });
  h('whatsapp:teste', async ({ tipo, texto, modeloId }) => {
    const w = lerWhats();
    if (!w.meuNumero) throw new Error('Salve o seu número primeiro.');
    const p = provedorMeta();
    // só para o número da própria pessoa: este botão nunca envia para a planilha
    let r;
    if (tipo === 'modeloDisparo') {
      // a mensagem aprovada, como a planilha vai receber, com o primeiro nome de quem está testando
      const m = ((estado && estado.lerConfig().modelos) || []).find((x) => x.id === modeloId);
      if (!m || situacao(m.meta, m.corpo, assinaturaExtras(m)).codigo !== 'aprovado') throw new Error('Esta mensagem ainda não foi aprovada pela Meta.');
      const primeiro = String((estado && estado.operador) || '').split(' ')[0];
      let imagemId;
      if (m.imagem) {
        const up = await p.subirMidia({ bytes: lerImagem(m.imagem), tipo: m.imagem.tipo, nome: path.basename(m.imagem.arquivo) });
        if (!up.ok) throw new Error(`Não consegui enviar a imagem para a Meta: ${up.erro}`);
        imagemId = up.id;
      }
      r = await p.enviarModelo({ telefone: w.meuNumero, modelo: m.meta.nome, idioma: m.meta.idioma || 'pt_BR', componentes: componentesEnvio(m, { nome: primeiro }, imagemId) });
    } else r = await p.enviar({ telefone: w.meuNumero, texto: String(texto || '').slice(0, 4096) || 'Teste do Disparo Urbano Norte ✅' });
    if (!r.ok) throw new Error(r.erro);
    return { para: formatarTelefone(w.meuNumero), id: r.id, waId: r.waId ? '+' + r.waId : '' };
  });

  h('app:abrirPasta', () => { if (estado) shell.openPath(estado.pasta); return true; });
}

/** Outra pessoa entrou no app (o nome do histórico muda): reabre o estado. */
function reiniciar() {
  abrirEstado();
  if (estado) { carregarPlanilha().catch(() => {}); iniciarVigia(); }
}

module.exports = { registrar, reiniciar };
