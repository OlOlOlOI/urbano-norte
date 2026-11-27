'use strict';
/* Aba Atendimento: conversas do WhatsApp da empresa, lidas e respondidas pelo computador. */

/* ---------- utilidades ---------- */
function h(tag, props, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
const $ = (s) => document.querySelector(s);
const limpar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let relogioAviso = null;
function aviso(texto, erro = false) {
  const a = $('#aviso');
  a.textContent = texto;
  a.classList.toggle('erro', erro);
  a.classList.remove('oculto');
  clearTimeout(relogioAviso);
  relogioAviso = setTimeout(() => a.classList.add('oculto'), erro ? 9000 : 3500);
}
async function chamar(promessa, { calado = false } = {}) {
  const r = await promessa;
  if (!r.ok) { if (!calado) aviso(r.erro, true); return undefined; }
  return r.dados;
}

function formatarNumero(waId) {
  const d = String(waId || '');
  let m = /^55(\d{2})(9\d{4})(\d{4})$/.exec(d); if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  // o WhatsApp guarda o celular brasileiro sem o 9 extra: mostra com o 9, como as pessoas conhecem
  m = /^55(\d{2})([6-9]\d{3})(\d{4})$/.exec(d); if (m) return `(${m[1]}) 9${m[2]}-${m[3]}`;
  m = /^55(\d{2})(\d{4})(\d{4})$/.exec(d); if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return d ? '+' + d : '';
}
const ehIg = (c) => Boolean(c) && (c.canal === 'instagram' || String(c.wa_id || '').startsWith('ig_'));
// Nome do perfil só vale se tiver letra ou número (tem gente que usa "-", "." ou emoji como nome no WhatsApp).
const nomeReal = (c) => { const n = String((c && c.nome) || '').trim(); return /[\p{L}\p{N}]/u.test(n) ? n : ''; };
const nomeDe = (c) => (c && (c.apelido || nomeReal(c) || (ehIg(c) ? (c.usuario ? '@' + c.usuario : 'Instagram') : formatarNumero(c.wa_id)))) || '';
const identificacao = (c) => {
  const perfil = c.apelido && nomeReal(c) && nomeReal(c) !== c.apelido ? ` · no perfil: ${nomeReal(c)}` : '';
  if (ehIg(c)) return `Instagram${c.usuario ? ' · @' + c.usuario : ''}${perfil}`;
  return (c.apelido || nomeReal(c)) ? `WhatsApp · ${formatarNumero(c.wa_id)}${perfil}` : 'WhatsApp · sem nome no perfil';
};
const selo = (c) => h('span', { class: 'canal ' + (ehIg(c) ? 'ig' : 'wa'), title: ehIg(c) ? 'Instagram' : 'WhatsApp', 'aria-label': ehIg(c) ? 'Instagram' : 'WhatsApp' }, ehIg(c) ? 'IG' : 'WA');
const inicial = (c) => ((c.apelido || nomeReal(c) || (ehIg(c) ? c.usuario || '' : '')).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function quando(ms) {
  const d = new Date(ms); const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return hora(ms);
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function rotuloDia(ms) {
  const q = quando(ms);
  if (/^\d{2}:\d{2}$/.test(q)) return 'Hoje';
  return q === 'Ontem' ? 'Ontem' : new Date(ms).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
const JANELA_MS = 24 * 60 * 60 * 1000;

/* ---------- estado ---------- */
const S = {
  cfg: null,
  filtro: 'aberta',
  canal: '',            // '' (todos) | whatsapp | instagram
  busca: '',
  conversas: [],
  atual: null,          // wa_id aberto
  conversa: null,       // dados da conversa aberta
  mensagens: new Map(), // id -> mensagem
  desde: 0,
  difRelogio: 0,        // relógio do servidor - relógio daqui
  enviando: false,
  midias: new Map(),    // midia_id -> dataUrl já baixada
};
const agoraServidor = () => Date.now() + S.difRelogio;

/* ---------- configurar ---------- */
async function telaConfig() {
  const raiz = limpar($('#raiz'));
  const c = S.cfg || {};
  if (c.porConta) { // app unificado: quem entra é a conta da pessoa (login do app); aqui só a conferência da Meta
    raiz.append(h('div', { class: 'config' },
      h('h1', {}, 'Ligação com o WhatsApp'),
      c.configurado
        ? h('p', { class: 'apoio' }, `Você está no Atendimento como ${c.operador}. As suas respostas aparecem com esse nome para a equipe (o cliente não vê).`)
        : h('p', { class: 'apoio' }, 'Entre com o seu usuário e senha para usar o Atendimento.'),
      h('div', { class: 'acoes' },
        c.configurado ? h('button', { type: 'button', class: 'btn', onclick: () => iniciar() }, 'Voltar') : null,
        c.admin ? h('button', { type: 'button', class: 'btn', id: 'btn-diagnostico', onclick: diagnosticar }, 'Conferir ligação com o WhatsApp') : null)));
    return;
  }
  const url = h('input', { type: 'url', value: c.url || '', placeholder: 'https://atendimento-urbano-norte.SEU-USUARIO.workers.dev', spellcheck: 'false', autocomplete: 'off', id: 'cfg-url' });
  const chave = h('input', { type: 'password', value: '', placeholder: c.temChave ? 'Chave salva. Cole outra só para trocar.' : '', autocomplete: 'off', id: 'cfg-chave' });
  const operador = h('input', { type: 'text', value: c.operador || '', autocomplete: 'off', id: 'cfg-operador', placeholder: 'Ex.: Rayan' });
  const salvar = h('button', { type: 'button', class: 'btn principal', onclick: async () => {
    salvar.disabled = true; salvar.textContent = 'Conferindo…';
    const ok = await chamar(window.api.config.salvar({ url: url.value, chave: chave.value, operador: operador.value }));
    salvar.disabled = false; salvar.textContent = 'Salvar e conferir';
    if (ok) { aviso('Atendimento conectado.'); await iniciar(); }
  } }, 'Salvar e conferir');
  raiz.append(h('div', { class: 'config' },
    h('h1', {}, 'Configurar o Atendimento'),
    h('p', { class: 'apoio' }, 'O Atendimento usa um servidor próprio na nuvem, que recebe as mensagens dos clientes 24 h por dia. Peça o endereço e a chave a quem montou o servidor (passo a passo em atendimento/servidor/LEIA-ME.md). Ficam guardados só neste computador, cifrados.'),
    !c.protecao && c.protecao !== undefined ? h('div', { class: 'caixa' }, 'Este computador não oferece cofre seguro, então a chave não pode ser guardada.') : null,
    h('label', { for: 'cfg-url' }, 'Endereço do servidor', h('span', { class: 'ajuda' }, 'Começa com https://')), url,
    h('label', { for: 'cfg-chave' }, 'Chave de acesso', h('span', { class: 'ajuda' }, 'A mesma em todos os computadores do escritório.')), chave,
    h('label', { for: 'cfg-operador' }, 'Seu nome', h('span', { class: 'ajuda' }, 'Aparece nas suas respostas, para a equipe saber quem respondeu. O cliente não vê.')), operador,
    h('div', { class: 'acoes' }, salvar,
      c.configurado ? h('button', { type: 'button', class: 'btn', onclick: () => iniciar() }, 'Voltar') : null,
      c.configurado ? h('button', { type: 'button', class: 'btn', id: 'btn-diagnostico', onclick: diagnosticar }, 'Conferir ligação com o WhatsApp') : null,
      c.configurado ? h('button', { type: 'button', class: 'btn discreto', onclick: async () => {
        if (await confirmar('Desconectar este computador?', 'O endereço e a chave saem deste computador. As conversas continuam no servidor.', 'Desconectar')
          && await chamar(window.api.config.apagar())) { await iniciar(); }
      } }, 'Desconectar este computador') : null)));
  (c.url ? operador : url).focus();
}

async function diagnosticar() {
  const b = $('#btn-diagnostico');
  b.disabled = true; b.textContent = 'Conferindo com a Meta…';
  const r = await window.api.diagnostico();
  b.disabled = false; b.textContent = 'Conferir ligação com o WhatsApp';
  const d = limpar($('#dialogo'));
  const passos = r.ok ? r.dados.passos : [{ item: 'Servidor do Atendimento', ok: false, detalhe: r.erro }];
  d.append(h('h2', { id: 'dialogo-titulo' }, 'Ligação com o WhatsApp'),
    h('ul', { class: 'diagnostico' }, passos.map((p) => h('li', { class: p.ok ? 'ok' : 'falha' }, h('strong', {}, (p.ok ? '✓ ' : '✗ ') + p.item), h('div', {}, p.detalhe || '')))),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', autofocus: true, onclick: () => d.close() }, 'Fechar')));
  d.showModal();
}

function confirmar(titulo, texto, sim) {
  return new Promise((resolve) => {
    const d = limpar($('#dialogo'));
    let r = false;
    d.append(h('h2', { id: 'dialogo-titulo' }, titulo), h('p', {}, texto),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => d.close() }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn principal', onclick: () => { r = true; d.close(); } }, sim)));
    d.addEventListener('close', () => resolve(r), { once: true });
    d.showModal();
  });
}

async function salvarMidia(m, botao) {
  if (botao) { botao.disabled = true; }
  const r = await chamar(window.api.salvarMidia({ midiaId: m.midia_id, nome: m.midia_nome, tipoMsg: m.tipo }));
  if (botao) { botao.disabled = false; }
  if (r && r.salvo) aviso('Arquivo salvo no computador.');
}

// icone=true: só o ⬇ (ao lado do "Abrir" de documentos); senão um link discreto embaixo do áudio
function botaoSalvar(m, icone = false) {
  const b = h('button', { type: 'button', class: icone ? 'btn btn-salvar-icone' : 'btn-salvar', title: 'Salvar no computador', 'aria-label': 'Salvar no computador', onclick: () => salvarMidia(m, b) }, icone ? '⬇' : '⬇ Salvar');
  return b;
}

function verImagem(src, m) {
  const d = limpar($('#dialogo'));
  d.append(h('img', { src, alt: 'Foto enviada pelo cliente' }),
    h('div', { class: 'acoes' },
      m ? h('button', { type: 'button', class: 'btn', onclick: (e) => salvarMidia(m, e.currentTarget) }, '⬇ Salvar no computador') : null,
      h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => d.close() }, 'Fechar')));
  d.showModal();
}

/* Ícones dos canais (desenho próprio, cor pelo CSS via currentColor) */
const ICONES = {
  whatsapp: '<path d="M12 2.6a9.4 9.4 0 0 0-8.1 14.2L2.6 21.4l4.7-1.2A9.4 9.4 0 1 0 12 2.6zm0 1.8a7.6 7.6 0 1 1-3.9 14.1l-.3-.2-2.6.7.7-2.5-.2-.3A7.6 7.6 0 0 1 12 4.4z"/><path d="M9.1 7.3c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 4 2.2.9 2.7.7 3.2.7.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-1.9-.9c-.3-.1-.5-.1-.7.1l-.8 1c-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2z"/>',
  instagram: '<path d="M12 2.8c2.5 0 2.8 0 3.8.1 2.5.1 3.7 1.3 3.8 3.8.1 1 .1 1.3.1 3.8v3c0 2.5 0 2.8-.1 3.8-.1 2.5-1.3 3.7-3.8 3.8-1 .1-1.3.1-3.8.1s-2.8 0-3.8-.1c-2.5-.1-3.7-1.3-3.8-3.8-.1-1-.1-1.3-.1-3.8v-3c0-2.5 0-2.8.1-3.8.1-2.5 1.3-3.7 3.8-3.8 1-.1 1.3-.1 3.8-.1zm0-1.8c-2.6 0-2.9 0-3.9.1-3.4.2-5.4 2.1-5.6 5.6C2.4 7.7 2.4 8 2.4 12s0 4.3.1 5.3c.2 3.4 2.1 5.4 5.6 5.6 1 .1 1.3.1 3.9.1s2.9 0 3.9-.1c3.4-.2 5.4-2.1 5.6-5.6.1-1 .1-1.3.1-5.3s0-4.3-.1-5.3c-.2-3.4-2.1-5.4-5.6-5.6-1-.1-1.3-.1-3.9-.1z"/><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"/><circle cx="17.3" cy="6.7" r="1.2"/>',
};
function iconeCanal(canal) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'icone-canal');
  s.innerHTML = ICONES[canal]; // texto fixo deste arquivo
  return s;
}

/* ---------- painel ---------- */
function telaPainel() {
  const raiz = limpar($('#raiz'));
  const busca = h('input', { type: 'search', class: 'busca', placeholder: 'Buscar por nome, número ou @', 'aria-label': 'Buscar conversa', value: S.busca });
  let relogioBusca = null;
  busca.addEventListener('input', () => { clearTimeout(relogioBusca); relogioBusca = setTimeout(() => { S.busca = busca.value; carregarLista(); }, 300); });
  const filtros = [['aberta', 'Abertas'], ['resolvida', 'Resolvidas'], ['todas', 'Todas']].map(([v, rot]) =>
    h('button', { type: 'button', 'aria-pressed': String(S.filtro === v), onclick: () => { S.filtro = v; telaPainel(); carregarLista(); } }, rot));
  const canais = [['', 'Todos'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']].map(([v, rot]) =>
    h('button', { type: 'button', class: v ? `canal-${v}` : null, 'aria-pressed': String(S.canal === v), 'aria-label': v ? `Só ${rot}` : 'Todos os canais', title: v ? `Só ${rot}` : 'Todos os canais',
      onclick: () => { S.canal = v; telaPainel(); carregarLista(); } }, v ? iconeCanal(v) : rot));
  raiz.append(h('div', { class: 'painel' },
    h('aside', { class: 'lado', 'aria-label': 'Conversas' },
      h('div', { class: 'lado-topo' },
        h('div', { class: 'lado-titulo' }, h('h1', {}, 'Atendimento'),
          h('span', {},
            h('button', { type: 'button', class: 'btn discreto', id: 'btn-atualizar', title: 'Buscar mensagens novas agora (F5)', onclick: atualizarAgora }, '↻ Atualizar'),
            // no app unificado, o teste de conexão fica em Configurações (menu com o nome da pessoa)
            !S.cfg.porConta ? h('button', { type: 'button', class: 'btn discreto', title: 'Configurar o Atendimento', onclick: telaConfig }, 'Configurar') : null)),
        h('div', { class: 'filtros', role: 'group', 'aria-label': 'Mostrar' }, filtros),
        h('div', { class: 'filtros canais', role: 'group', 'aria-label': 'Canal' }, canais),
        busca),
      h('ul', { class: 'lista', id: 'lista' })),
    h('section', { class: 'conversa', id: 'conversa', 'aria-label': 'Conversa' })));
  desenharLista();
  desenharConversa();
}

function desenharLista() {
  const ul = $('#lista');
  if (!ul) return;
  limpar(ul);
  if (!S.conversas.length) {
    ul.append(h('li', { class: 'lista-vazia' }, S.busca ? 'Nenhuma conversa encontrada.' : S.filtro === 'aberta' ? 'Nenhuma conversa aberta. Quando um cliente mandar mensagem, ela aparece aqui.' : 'Nada por aqui.'));
    return;
  }
  for (const c of S.conversas) {
    ul.append(h('li', { class: c.estado === 'resolvida' ? 'item-resolvida' : '' },
      h('button', { type: 'button', 'aria-current': String(c.wa_id === S.atual), onclick: () => abrir(c.wa_id) },
        h('span', { class: 'avatar-caixa' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, inicial(c)), selo(c)),
        h('span', { class: 'item-texto' }, h('div', { class: 'item-nome' }, nomeDe(c)), h('div', { class: 'item-previa' }, c.previa || '')),
        h('span', { class: 'item-lado' }, quando(c.ultima_msg_em),
          c.nao_lidas > 0 ? h('span', { class: 'contador', 'aria-label': `${c.nao_lidas} não lidas` }, String(c.nao_lidas)) : null))));
  }
}

function infoJanela(c) {
  if (!c || !c.ultima_entrada_em) return { aberta: false, texto: 'Janela fechada' };
  const fim = c.ultima_entrada_em + JANELA_MS;
  const resta = fim - agoraServidor();
  if (resta <= 0) return { aberta: false, texto: 'Janela de 24 h fechada' };
  const horas = Math.floor(resta / 3600000);
  return { aberta: true, texto: horas >= 1 ? `Pode responder até ${quando(fim) === hora(fim) ? hora(fim) : `${quando(fim)} ${hora(fim)}`}` : `Janela fecha em ${Math.max(1, Math.round(resta / 60000))} min` };
}

/* Transforma endereços https:// do texto em links (abrem no navegador do computador). */
function comLinks(texto) {
  const partes = [];
  let ultimo = 0;
  for (const achado of String(texto).matchAll(/https:\/\/[^\s<>"]+/g)) {
    if (achado.index > ultimo) partes.push(texto.slice(ultimo, achado.index));
    const url = achado[0];
    const curto = url.length > 60 ? url.slice(0, 57) + '…' : url;
    partes.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, curto));
    ultimo = achado.index + url.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

function bolha(m) {
  const saida = m.direcao === 'saida';
  const story = m.tipo === 'story_mention';
  const filhos = [];
  if (saida && m.operador) filhos.push(h('div', { class: 'operador' }, m.operador));
  if (m.midia_id) {
    const imagem = (m.midia_mime || '').startsWith('image/') || m.tipo === 'image' || m.tipo === 'sticker';
    const audio = m.tipo === 'audio' || (m.midia_mime || '').startsWith('audio/');
    const naTela = imagem || audio || story; // Story: foto aparece aqui; vídeo abre no programa do computador
    const ja = S.midias.get(m.midia_id);
    if (ja && ja.startsWith('data:image')) filhos.push(h('div', { class: 'midia' }, h('img', { src: ja, alt: m.texto || 'Foto', onclick: () => verImagem(ja, m) })));
    else if (ja && ja.startsWith('data:audio')) filhos.push(h('div', { class: 'midia' }, h('audio', { src: ja, controls: true, preload: 'metadata', 'aria-label': 'Áudio do cliente' })), botaoSalvar(m));
    else {
      const rotulo = story ? '📣 Story' : { image: '📷 Foto', sticker: 'Figurinha', audio: '🎤 Áudio', video: '🎬 Vídeo', document: `📄 ${m.midia_nome || 'Documento'}` }[m.tipo] || '📎 Arquivo';
      const textoBotao = imagem ? 'Ver foto' : audio ? '▶ Ouvir' : story ? 'Ver Story' : 'Abrir';
      const botao = h('button', { type: 'button', class: 'btn', onclick: async () => {
        botao.disabled = true; botao.textContent = 'Baixando…';
        const r = await chamar(window.api.midia({ midiaId: m.midia_id, nome: m.midia_nome, abrir: !naTela, tipoMsg: m.tipo }));
        botao.disabled = false; botao.textContent = textoBotao;
        if (r && r.dataUrl) { S.midias.set(m.midia_id, r.dataUrl); desenharMensagens(false); }
      } }, textoBotao);
      // foto: salva na tela ampliada; áudio: embaixo do player depois de ouvir; documento e vídeo: ⬇ ao lado do "Abrir"
      filhos.push(h('div', { class: 'midia' }, rotulo, botao, !imagem && !audio && !story ? botaoSalvar(m, true) : null));
    }
  }
  if (m.texto) filhos.push(h('div', {}, comLinks(story ? '📣 ' + m.texto : m.texto)));
  if (!m.texto && !m.midia_id) filhos.push(h('div', { class: 'item-previa' }, `(mensagem do tipo "${m.tipo}" — abra no celular do cliente para ver)`));
  const tique = saida ? { enviada: ['✓', 'Enviada'], entregue: ['✓✓', 'Entregue'], lida: ['✓✓', 'Lida'], falhou: ['⚠', 'Não entregue'] }[m.status] : null;
  filhos.push(h('div', { class: 'meta' }, hora(m.criada_em),
    tique ? h('span', { class: 'tique' + (m.status === 'lida' ? ' lida' : ''), title: tique[1], 'aria-label': tique[1] }, tique[0]) : null));
  if (m.status === 'falhou' && m.erro) filhos.push(h('div', { class: 'erro-msg' }, m.erro));
  return h('div', { class: `bolha ${saida ? 'saida' : 'entrada'}${m.status === 'falhou' ? ' falhou' : ''}` }, filhos);
}

function desenharMensagens(rolarParaFim) {
  const area = $('#mensagens');
  if (!area) return;
  const pertoDoFim = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
  limpar(area);
  const lista = [...S.mensagens.values()].sort((a, b) => a.criada_em - b.criada_em || (a.seq || 0) - (b.seq || 0));
  let dia = '';
  for (const m of lista) {
    const d = new Date(m.criada_em).toDateString();
    if (d !== dia) { dia = d; area.append(h('div', { class: 'dia' }, rotuloDia(m.criada_em))); }
    area.append(bolha(m));
  }
  if (rolarParaFim || pertoDoFim) area.scrollTop = area.scrollHeight;
}

function desenharConversa() {
  const sec = $('#conversa');
  if (!sec) return;
  limpar(sec);
  if (!S.atual) {
    sec.append(h('div', { class: 'vazio' }, h('div', {}, h('strong', {}, 'Escolha uma conversa'), 'As mensagens dos clientes no WhatsApp e no direct do Instagram da Urbano Norte aparecem na lista ao lado.')));
    return;
  }
  const c = S.conversa || S.conversas.find((x) => x.wa_id === S.atual) || { wa_id: S.atual };
  const j = infoJanela(c);
  const resolvida = c.estado === 'resolvida';
  sec.append(h('header', { class: 'conversa-topo' },
    h('span', { class: 'avatar-caixa' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, inicial(c)), selo(c)),
    h('div', { class: 'quem' },
      h('div', { class: 'nome-linha' }, h('div', { class: 'nome' }, nomeDe(c)),
        h('button', { type: 'button', class: 'btn-icone', title: 'Dar um nome a este contato (todos do escritório veem)', 'aria-label': 'Renomear contato', onclick: () => editarApelido(c) }, '✎')),
      h('div', { class: 'numero' }, identificacao(c))),
    h('span', { class: 'janela' + (j.aberta ? '' : ' fechada'), title: 'O WhatsApp e o Instagram só deixam a empresa responder com texto livre até 24 h depois da última mensagem do cliente.' }, j.texto),
    resolvida
      ? h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.reabrir({ waId: S.atual }))) { aviso('Conversa reaberta.'); await recarregarTudo(); } } }, 'Reabrir')
      : h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.resolver({ waId: S.atual }))) { aviso('Conversa marcada como resolvida.'); await recarregarTudo(); } } }, 'Resolver')));
  sec.append(h('div', { class: 'mensagens', id: 'mensagens', role: 'log', 'aria-live': 'polite' }));

  if (j.aberta) {
    const texto = h('textarea', { id: 'texto', rows: '1', placeholder: 'Escreva a resposta… (Enter envia, Shift+Enter pula linha)', 'aria-label': 'Resposta' });
    texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 160) + 'px'; });
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); } });
    // colar uma imagem (Ctrl+V / Cmd+V) na resposta abre a confirmação de envio da foto
    texto.addEventListener('paste', async (e) => {
      const arq = [...(e.clipboardData && e.clipboardData.files || [])].find((f) => /^image\/(png|jpeg)$/.test(f.type));
      if (!arq || ehIg(c)) return;
      e.preventDefault();
      const bytes = new Uint8Array(await arq.arrayBuffer());
      const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(arq); });
      prepararArquivo({ nome: arq.name && arq.name !== 'image.png' ? arq.name : `foto-${Date.now()}.${arq.type === 'image/png' ? 'png' : 'jpg'}`, tipo: arq.type, tamanho: bytes.length, dataUrl, bytes });
    });
    const anexar = h('button', { type: 'button', class: 'btn btn-anexo', id: 'btn-anexo', disabled: ehIg(c),
      title: ehIg(c) ? 'Mandar foto pelo Instagram ainda não está disponível' : 'Mandar foto (JPG/PNG) ou PDF. Também dá para colar uma imagem na resposta.',
      'aria-label': 'Mandar foto ou PDF', onclick: async () => { const a = await chamar(window.api.escolherArquivo()); if (a) prepararArquivo(a); } }, '📎');
    sec.append(h('div', { class: 'escrever' }, anexar, texto, h('button', { type: 'button', class: 'btn principal', id: 'btn-enviar', onclick: enviar }, 'Enviar')));
  } else {
    sec.append(h('div', { class: 'fechada-aviso' }, 'Já passaram 24 h desde a última mensagem do cliente. Pelas regras do WhatsApp e do Instagram, só dá para responder quando ele escrever de novo (ou com um modelo aprovado pela Meta, que chegará numa próxima versão).'));
  }
  desenharMensagens(true);
}

/* Troca o nome no topo por um campo: Enter salva, Esc cancela, vazio volta ao nome do perfil. */
function editarApelido(c) {
  const linha = $('.conversa-topo .nome-linha');
  if (!linha) return;
  const campo = h('input', { type: 'text', class: 'apelido', maxlength: '60', value: c.apelido || nomeReal(c) || '', placeholder: 'Ex.: Motorista Carlos', 'aria-label': 'Nome do contato' });
  let feito = false;
  const sair = async (salvar) => {
    if (feito) return; feito = true;
    const novo = campo.value.replace(/\s+/g, ' ').trim();
    if (salvar && novo !== (c.apelido || '') && !(novo === nomeReal(c) && !c.apelido)) {
      const r = await chamar(window.api.apelido({ waId: c.wa_id, apelido: novo }));
      if (r) aviso(novo ? `Contato salvo como "${novo}".` : 'Voltou a usar o nome do perfil.');
    }
    await recarregarTudo();
  };
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sair(true); } else if (e.key === 'Escape') { e.preventDefault(); sair(false); } });
  campo.addEventListener('blur', () => sair(true));
  limpar(linha);
  linha.append(campo, h('span', { class: 'apelido-dica' }, 'Enter salva · Esc cancela · vazio volta ao nome do perfil'));
  campo.focus(); campo.select();
}

/* ---------- dados ---------- */
async function carregarLista() {
  const r = await chamar(window.api.conversas({ estado: S.filtro === 'todas' ? '' : S.filtro, busca: S.busca, canal: S.canal }), { calado: true });
  if (!r) return;
  S.difRelogio = r.agora - Date.now();
  S.conversas = r.conversas;
  desenharLista();
}

async function carregarMensagens(inicial) {
  if (!S.atual) return;
  const waId = S.atual;
  const r = await chamar(window.api.mensagens({ waId, desde: inicial ? 0 : S.desde }), { calado: !inicial });
  if (!r || waId !== S.atual) return;
  S.desde = r.agora;
  const antes = S.conversa;
  S.conversa = r.conversa;
  let novaDoCliente = false;
  for (const m of r.mensagens) { if (!S.mensagens.has(m.id) && m.direcao === 'entrada') novaDoCliente = true; S.mensagens.set(m.id, m); }
  const mudouJanela = !antes || !r.conversa || infoJanela(antes).aberta !== infoJanela(r.conversa).aberta || antes.estado !== r.conversa.estado
    || antes.apelido !== r.conversa.apelido || antes.nome !== r.conversa.nome;
  const editando = Boolean($('.conversa-topo input.apelido'));
  if (inicial || (mudouJanela && !editando)) desenharConversa(); else if (r.mensagens.length) desenharMensagens(false);
  if (novaDoCliente && !inicial && document.visibilityState === 'visible') window.api.lida({ waId });
}

async function abrir(waId) {
  S.atual = waId;
  S.conversa = null;
  S.mensagens = new Map();
  S.desde = 0;
  desenharLista();
  desenharConversa();
  await carregarMensagens(true);
  await chamar(window.api.lida({ waId }), { calado: true });
  const c = S.conversas.find((x) => x.wa_id === waId); if (c) { c.nao_lidas = 0; desenharLista(); }
  const t = $('#texto'); if (t) t.focus();
}

/* Confirma a foto/PDF antes de mandar, com legenda opcional (aproveita o que já estava escrito na resposta). */
function prepararArquivo(a) {
  const d = limpar($('#dialogo'));
  const caixa = $('#texto');
  const legenda = h('textarea', { rows: '2', class: 'legenda', placeholder: 'Legenda (opcional)', 'aria-label': 'Legenda' });
  legenda.value = caixa ? caixa.value.trim() : '';
  const erro = h('p', { class: 'erro-texto', role: 'alert' });
  const botao = h('button', { type: 'button', class: 'btn principal', onclick: async () => {
    botao.disabled = true; botao.textContent = 'Enviando…'; erro.textContent = '';
    const r = await window.api.enviarArquivo({ waId: S.atual, nome: a.nome, bytes: a.bytes, legenda: legenda.value });
    if (!r || !r.ok) { erro.textContent = (r && r.erro) || 'Não foi possível enviar.'; botao.disabled = false; botao.textContent = 'Enviar'; return; }
    const m = r.dados.mensagem;
    if (a.dataUrl && m.midia_id) S.midias.set(m.midia_id, a.dataUrl);
    S.mensagens.set(m.id, m);
    if (caixa && legenda.value.trim() && caixa.value.trim() === legenda.value.trim()) { caixa.value = ''; caixa.style.height = 'auto'; }
    d.close();
    desenharMensagens(true);
    carregarLista();
  } }, 'Enviar');
  d.append(h('h2', { id: 'dialogo-titulo' }, a.tipo === 'application/pdf' ? 'Mandar PDF' : 'Mandar foto'),
    a.dataUrl ? h('img', { src: a.dataUrl, alt: 'Foto que vai ser enviada', class: 'previa-envio' }) : h('p', { class: 'arquivo-envio' }, `📄 ${a.nome} · ${Math.ceil(a.tamanho / 1024)} KB`),
    legenda, erro,
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), botao));
  d.showModal();
  legenda.focus();
}

async function enviar() {
  const t = $('#texto'); const b = $('#btn-enviar');
  if (!t || S.enviando) return;
  const texto = t.value.trim();
  if (!texto) return;
  S.enviando = true; b.disabled = true; b.textContent = 'Enviando…';
  const r = await chamar(window.api.enviar({ waId: S.atual, texto }));
  S.enviando = false; b.disabled = false; b.textContent = 'Enviar';
  if (!r) return;
  t.value = ''; t.style.height = 'auto';
  S.mensagens.set(r.mensagem.id, r.mensagem);
  desenharMensagens(true);
  carregarLista();
  t.focus();
}

async function recarregarTudo() { await carregarLista(); await carregarMensagens(true); }

async function atualizarAgora() {
  const b = $('#btn-atualizar');
  if (b) { b.disabled = true; b.textContent = '↻ Atualizando…'; }
  await carregarLista();
  if (S.atual) await carregarMensagens(false);
  if (b) { b.disabled = false; b.textContent = '↻ Atualizar'; }
  aviso(`Atualizado às ${hora(Date.now())}.`);
}
document.addEventListener('keydown', (e) => { if ((e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'r')) && $('#lista')) { e.preventDefault(); atualizarAgora(); } });

/* ---------- início ---------- */
let relogio = null;
async function iniciar() {
  S.cfg = await chamar(window.api.config.ler());
  if (!S.cfg || !S.cfg.configurado) { clearInterval(relogio); return telaConfig(); }
  telaPainel();
  await carregarLista();
  clearInterval(relogio);
  // atualiza sozinho enquanto a aba está na frente (fora dela, o app só confere a cada 20 s para avisar)
  relogio = setInterval(() => { if (document.visibilityState === 'visible' && $('#lista')) { carregarLista(); carregarMensagens(false); } }, 4000);
}

window.api.aoAtualizar(() => { if ($('#lista')) carregarLista(); });
window.api.aoAbrir((waId) => { if ($('#lista')) abrir(waId); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#lista')) { carregarLista(); carregarMensagens(false); } });
iniciar();
window.api.aoConta(() => { S.atual = null; iniciar(); }); // entrou ou saiu outra pessoa
