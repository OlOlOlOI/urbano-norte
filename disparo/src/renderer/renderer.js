'use strict';

/* =====================================================================
   Utilidades
   ===================================================================== */
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
const $ = (sel) => document.querySelector(sel);
/* append nativo escreve "null"/"false" como texto; aqui valores vazios são ignorados */
function limparAppend(el) {
  const orig = el.append.bind(el);
  el.append = (...f) => orig(...f.flat().filter((v) => v != null && v !== false));
  return el;
}
const vazio = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return limparAppend(el); };
const pl = (n, um, varios) => (n === 1 ? um : varios);
const dataBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
let idSeq = 0;
const novoId = (p) => `${p}-${++idSeq}`;

/* Campo com rótulo associado (para leitor de tela) */
function campo(rotulo, controle, ajuda) {
  const id = novoId('c');
  controle.id = id;
  const partes = [h('label', { for: id }, rotulo, ajuda ? h('span', { class: 'ajuda', id: id + '-ajuda' }, ajuda) : null), controle];
  if (ajuda) controle.setAttribute('aria-describedby', id + '-ajuda');
  return partes;
}

/* =====================================================================
   Avisos (leitor de tela anuncia sozinho)
   ===================================================================== */
function limparAvisos() {
  for (const id of ['#aviso-status', '#aviso-erro']) { const e = $(id); e.classList.add('oculto'); e.textContent = ''; }
}
function avisoOk(texto) { limparAvisos(); const e = $('#aviso-status'); e.textContent = texto; e.classList.remove('oculto'); }
function avisoErro(texto) { limparAvisos(); const e = $('#aviso-erro'); e.textContent = texto; e.classList.remove('oculto'); e.scrollIntoView({ block: 'nearest' }); }

/* Chama a API; em caso de erro mostra o aviso e devolve undefined */
async function chamar(promessa) {
  const r = await promessa;
  if (!r.ok) { avisoErro(r.erro); return undefined; }
  return r.dados;
}

/* =====================================================================
   Preferência: tamanho do texto
   ===================================================================== */
function lerTexto() { try { return localStorage.getItem('texto') || 'normal'; } catch { return 'normal'; } }
function aplicarTexto(v) {
  if (v === 'normal') delete document.documentElement.dataset.texto; else document.documentElement.dataset.texto = v;
  try { localStorage.setItem('texto', v); } catch { /* sem armazenamento: vale só nesta sessão */ }
}
aplicarTexto(lerTexto());

/* =====================================================================
   Estado da tela
   ===================================================================== */
const S = {
  ajustes: null, planilha: null, config: {}, modelos: [],
  rota: 'campanha',
  fase: 'montando',            // montando | enviando | resultado
  camp: { passo: 1, modeloId: null, nome: '', publico: null, autorizou: false },
  confirmarColunas: false,
  rascunhoNome: '',
  enviando: false, resultado: null,
};
const novaCampanha = () => { S.camp = { passo: 1, modeloId: null, nome: '', publico: null, autorizou: false }; S.fase = 'montando'; S.resultado = null; };

async function carregarBase() {
  S.ajustes = await chamar(window.api.ajustes.ler());
  S.planilha = null; S.config = {}; S.modelos = [];
  if (S.ajustes && S.ajustes.pronto) {
    const p = await chamar(window.api.planilha.estado());
    if (p) { S.planilha = p.resumo; S.config = p.config || {}; S.modelos = S.config.modelos || []; }
  }
  desenharModo();
}

function desenharModo() {
  const m = $('#modo');
  vazio(m);
  const teste = !S.ajustes || S.ajustes.simulacao;
  m.classList.toggle('real', !teste);
  m.append(h('span', { class: 'selo' }, teste ? 'Modo de teste' : 'Envio real'),
    teste ? 'Nenhuma mensagem real é enviada.' : 'As mensagens serão enviadas de verdade.');
}

/* O que falta configurar? (null = tudo pronto) */
function pendencia() {
  if (!S.ajustes || !S.ajustes.pronto) return 1;
  const p = S.planilha;
  if (!p || !(p.mapa && p.mapa.telefone) || p.mapaProblema.length || S.confirmarColunas) return 2;
  if (!S.modelos.length) return 3;
  return null;
}

/* =====================================================================
   Diálogos (elemento <dialog>: foco preso e Esc fecham sozinhos)
   ===================================================================== */
function abrirDialogo(montar) {
  return new Promise((resolve) => {
    const d = $('#dialogo');
    vazio(d);
    d.classList.remove('largo');
    let resultado;
    const fechar = (v) => { resultado = v; d.close(); };
    d.addEventListener('close', () => resolve(resultado), { once: true });
    montar(d, fechar);
    d.showModal();
  });
}

function confirmar({ titulo, texto, sim = 'Confirmar', perigo = false }) {
  return abrirDialogo((d, fechar) => {
    d.append(h('h2', { id: 'dialogo-titulo' }, titulo), ...[].concat(texto).map((t) => h('p', {}, t)),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => fechar(false) }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn vai ' + (perigo ? 'perigo' : 'principal'), onclick: () => fechar(true) }, sim)));
  }).then((v) => v === true);
}

async function previa(corpo, nome = 'Maria') {
  const r = await window.api.envio.previa({ corpo, nome });
  return r.ok ? r.dados : '';
}

/* ---------- prévia como no WhatsApp ---------- */
// Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~, `código`, ```bloco```, "> " citação, "- " lista, "1. " lista numerada.
const RE_INLINE = /(```[\s\S]+?```|`[^`\n]+`|\*[^\s*](?:[^*\n]*[^\s*])?\*|_[^\s_](?:[^_\n]*[^\s_])?_|~[^\s~](?:[^~\n]*[^\s~])?~)/;
function inlineWhats(texto) {
  const frag = document.createDocumentFragment();
  for (const parte of String(texto).split(RE_INLINE)) {
    if (!parte) continue;
    if (parte.startsWith('```') && parte.length > 6) { frag.append(h('code', { class: 'bloco' }, parte.slice(3, -3))); continue; }
    const marca = { '`': 'code', '*': 'strong', _: 'em', '~': 's' }[parte[0]];
    if (marca && parte.length > 2 && parte.endsWith(parte[0]) && RE_INLINE.test(parte) && parte.match(RE_INLINE)[0] === parte) {
      const el = h(marca, {});
      el.append(marca === 'code' ? parte.slice(1, -1) : inlineWhats(parte.slice(1, -1)));
      frag.append(el);
    } else frag.append(parte);
  }
  return frag;
}
function formatarWhats(texto) {
  const frag = document.createDocumentFragment();
  const linhas = String(texto || '').split('\n');
  for (let i = 0; i < linhas.length;) {
    const l = linhas[i];
    const bloco = (re, montar) => { const itens = []; while (i < linhas.length && re.test(linhas[i])) itens.push(linhas[i++].replace(re, '')); frag.append(montar(itens)); };
    if (/^> ?/.test(l)) bloco(/^> ?/, (it) => { const q = h('blockquote', {}); it.forEach((t, k) => { if (k) q.append(h('br', {})); q.append(inlineWhats(t)); }); return q; });
    else if (/^[-*] /.test(l)) bloco(/^[-*] /, (it) => h('ul', {}, it.map((t) => { const li = h('li', {}); li.append(inlineWhats(t)); return li; })));
    else if (/^\d+\. /.test(l)) bloco(/^\d+\. /, (it) => h('ol', {}, it.map((t) => { const li = h('li', {}); li.append(inlineWhats(t)); return li; })));
    else { const p = h('div', { class: 'linha' }); p.append(l ? inlineWhats(l) : '\u00a0'); frag.append(p); i++; }
  }
  return frag;
}
/* Balão completo: imagem no topo, texto formatado, rodapé cinza e botões embaixo. */
function balaoWhats({ texto, imagemUrl, rodape, botoes }) {
  const site = botoes && botoes.site && (botoes.site.texto || botoes.site.url) ? botoes.site : null;
  const lista = [site ? `↗ ${site.texto || 'Abrir link'}` : null, botoes && botoes.sair ? '↩ Não quero receber' : null].filter(Boolean);
  const corpo = h('div', { class: 'balao-texto' });
  corpo.append(formatarWhats(texto));
  return h('div', { class: 'whats' },
    h('div', { class: 'balao' },
      imagemUrl ? h('img', { class: 'balao-img', src: imagemUrl, alt: 'Imagem da mensagem' }) : null,
      corpo,
      rodape && rodape.trim() ? h('div', { class: 'balao-rodape' }, rodape.trim()) : null),
    lista.length ? h('div', { class: 'balao-botoes' }, lista.map((b) => h('span', {}, b))) : null);
}
/* Prévia de uma mensagem salva, com o nome de exemplo. */
async function balaoDe(m, nome = 'Maria') {
  const [texto, imagemUrl] = await Promise.all([previa(m.corpo, nome), m.imagem ? window.api.modelos.imagem(m.imagem).then((r) => (r && r.ok ? r.dados : null)) : null]);
  return balaoWhats({ texto, imagemUrl, rodape: m.rodape, botoes: m.botoes });
}

/* ---------- aprovação na Meta (modelos) ---------- */
const reais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// mesma regra de core/modelo-meta.js#situacao e #assinaturaExtras, resumida para a tela
function assinaturaExtras(m) {
  const rodape = String((m && m.rodape) || '').replace(/\s+/g, ' ').trim();
  const s = m && m.botoes && m.botoes.site;
  const site = s && (s.texto || s.url) ? { texto: String(s.texto || '').trim(), url: String(s.url || '').trim() } : null;
  return JSON.stringify({ img: (m && m.imagem && m.imagem.hash) || null, rodape, site, sair: Boolean(m && m.botoes && m.botoes.sair) });
}
function situacaoMeta(m) {
  const meta = m && m.meta;
  if (!meta || !meta.nome) return { codigo: 'sem', texto: 'Não enviada para aprovação' };
  if (meta.corpoEnviado !== undefined && meta.corpoEnviado !== m.corpo) return { codigo: 'mudou', texto: 'Texto mudou: aprovar de novo' };
  if (assinaturaExtras(m) !== (meta.extrasEnviados ?? assinaturaExtras({}))) return { codigo: 'mudou', texto: 'Imagem, rodapé ou botões mudaram: aprovar de novo' };
  const st = String(meta.status || '').toUpperCase();
  if (st === 'APPROVED') return { codigo: 'aprovado', texto: 'Aprovada pela Meta' };
  if (st === 'REJECTED') return { codigo: 'recusado', texto: 'Recusada pela Meta' + (meta.motivo && meta.motivo !== 'NONE' ? ` (${meta.motivo})` : '') };
  if (st === 'PAUSED' || st === 'DISABLED') return { codigo: 'pausado', texto: 'Pausada pela Meta (baixa qualidade)' };
  if (st === 'DELETED') return { codigo: 'sem', texto: 'Apagada na Meta: envie de novo' };
  return { codigo: 'analise', texto: 'Em análise pela Meta' };
}
const seloMeta = (m) => { const sm = situacaoMeta(m); return h('span', { class: 'selo-meta ' + sm.codigo }, sm.texto); };

/* Atualiza a situação das mensagens na Meta (sem travar a tela se a Meta não responder). */
async function atualizarMeta() {
  const r = await window.api.modelos.situacao();
  if (r && r.ok) { S.modelos = r.dados.modelos; S.categorias = r.dados.categorias; return true; }
  return false;
}

/* Diálogo: escolher o tipo e mandar a mensagem para a Meta aprovar. */
function pedirAprovacao(m) {
  return abrirDialogo((d, fechar) => {
    const cats = S.categorias || { MARKETING: { rotulo: 'Promoção ou novidade', custo: 0.3217 }, UTILITY: { rotulo: 'Aviso de serviço (corrida, cadastro, pagamento)', custo: 0.035 } };
    const erro = h('div', { class: 'caixa erro oculto', role: 'alert' });
    const opcoes = Object.entries(cats).map(([cod, c], i) => {
      const id = novoId('cat');
      return h('label', { class: 'marcar', for: id }, h('input', { type: 'radio', name: 'categoria', id, value: cod, checked: i === 0 }),
        `${c.rotulo} — cerca de ${reais(c.custo)} por mensagem entregue`);
    });
    const botao = h('button', { type: 'button', class: 'btn principal vai', onclick: async () => {
      const categoria = (d.querySelector('input[name=categoria]:checked') || {}).value;
      botao.disabled = true; botao.textContent = 'Enviando para a Meta…';
      const r = await window.api.modelos.enviarMeta({ id: m.id, categoria });
      if (r.ok) { fechar(r.dados); return; }
      erro.textContent = r.erro; erro.classList.remove('oculto');
      botao.disabled = false; botao.textContent = 'Enviar para aprovação';
    } }, 'Enviar para aprovação');
    d.append(h('h2', { id: 'dialogo-titulo' }, `Aprovar “${m.nome}” na Meta`),
      h('p', {}, 'Para mandar mensagem a quem não falou com a Urbano Norte nas últimas 24 horas, o WhatsApp exige que o texto seja aprovado pela Meta antes. A análise costuma levar de minutos a algumas horas.'),
      erro,
      h('fieldset', {}, h('legend', {}, 'Que tipo de mensagem é?'), opcoes),
      h('p', { class: 'pequeno' }, 'A Meta confere o tipo. Se uma mensagem marcada como aviso tiver tom de promoção (desconto, “aproveite”), ela muda para promoção e cobra o valor de promoção.'),
      h('p', { class: 'pequeno' }, 'Depois de aprovada, qualquer mudança no texto precisa de nova aprovação.'),
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => fechar(undefined) }, 'Cancelar'), botao));
  });
}

/* Editor de mensagem. Devolve o id salvo (ou undefined se cancelou). */
function editarMensagem(modelo) {
  const novo = !modelo;
  return abrirDialogo((d, fechar) => {
    d.classList.add('largo');
    const nome = h('input', { type: 'text', value: modelo ? modelo.nome : '', autocomplete: 'off' });
    const texto = h('textarea', { rows: '10' }, modelo ? modelo.corpo : '');
    const rodape = h('input', { type: 'text', value: (modelo && modelo.rodape) || '', maxlength: '60', autocomplete: 'off', placeholder: 'Ex.: Urbano Norte · Feito na nossa cidade' });
    const site = (modelo && modelo.botoes && modelo.botoes.site) || {};
    const temSite = h('input', { type: 'checkbox', checked: Boolean(site.url) });
    const siteTexto = h('input', { type: 'text', value: site.texto || 'Baixar o app', maxlength: '25', autocomplete: 'off' });
    const siteUrl = h('input', { type: 'url', value: site.url || '', placeholder: 'https://', autocomplete: 'off', spellcheck: 'false' });
    const sair = h('input', { type: 'checkbox', checked: modelo ? Boolean(modelo.botoes && modelo.botoes.sair) : true });
    const caixaPrevia = h('div', { class: 'previa-whats', 'aria-live': 'polite' });
    const erro = h('div', { class: 'caixa erro oculto', role: 'alert' });
    let imagem = (modelo && modelo.imagem) || null;
    let imagemUrl = null;
    let confirmandoExcluir = false;

    const botoes = () => ({ site: temSite.checked ? { texto: siteTexto.value.trim(), url: siteUrl.value.trim() } : null, sair: sair.checked });
    let t;
    const atualizar = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const txt = await previa(texto.value);
        vazio(caixaPrevia).append(balaoWhats({ texto: txt, imagemUrl, rodape: rodape.value, botoes: botoes() }));
      }, 150);
    };
    for (const el of [texto, rodape, siteTexto, siteUrl]) el.addEventListener('input', atualizar);
    for (const el of [temSite, sair]) el.addEventListener('change', () => { linhaSite.classList.toggle('oculto', !temSite.checked); atualizar(); });

    // ---------- barra de formatação ----------
    const envolver = (marca) => {
      const ini = texto.selectionStart; const fim = texto.selectionEnd;
      const sel = texto.value.slice(ini, fim) || 'texto';
      texto.setRangeText(marca + sel + marca, ini, fim, 'end');
      if (ini === fim) texto.setSelectionRange(ini + marca.length, ini + marca.length + sel.length);
      texto.focus(); atualizar();
    };
    const prefixar = (fn) => { // aplica em cada linha selecionada (citação, lista)
      const v = texto.value;
      const ini = v.lastIndexOf('\n', texto.selectionStart - 1) + 1;
      let fim = v.indexOf('\n', texto.selectionEnd); if (fim < 0) fim = v.length;
      const linhas = v.slice(ini, fim).split('\n').map((l, i) => fn(l, i));
      texto.setRangeText(linhas.join('\n'), ini, fim, 'select');
      texto.focus(); atualizar();
    };
    const inserirNome = () => { const marca = '{{nome|passageiro}}'; texto.setRangeText(marca, texto.selectionStart, texto.selectionEnd, 'end'); texto.focus(); atualizar(); };
    const ferramenta = (rotulo, titulo, acao, classe = '') => h('button', { type: 'button', class: 'ferramenta ' + classe, title: titulo, 'aria-label': titulo, onclick: acao }, rotulo);
    const barra = h('div', { class: 'barra-formatar', role: 'toolbar', 'aria-label': 'Formatação' },
      ferramenta('B', 'Negrito (*texto*)', () => envolver('*'), 'negrito'),
      ferramenta('I', 'Itálico (_texto_)', () => envolver('_'), 'italico'),
      ferramenta('S', 'Riscado (~texto~)', () => envolver('~'), 'riscado'),
      ferramenta('❝ Citação', 'Citação: barrinha do lado (> no começo da linha)', () => prefixar((l) => (l.startsWith('> ') ? l.slice(2) : l ? '> ' + l : l))),
      ferramenta('• Lista', 'Lista com marcadores (- no começo da linha)', () => prefixar((l) => (l.startsWith('- ') ? l.slice(2) : l ? '- ' + l : l))),
      ferramenta('1. Lista', 'Lista numerada', () => prefixar((l, i) => (/^\d+\. /.test(l) ? l.replace(/^\d+\. /, '') : l ? `${i + 1}. ${l}` : l))),
      ferramenta('+ Nome da pessoa', 'Inserir o nome da pessoa', inserirNome));

    // ---------- imagem ----------
    const areaImagem = h('div', { class: 'area-imagem' });
    const desenharImagem = () => {
      vazio(areaImagem).append(imagem
        ? h('div', { class: 'imagem-escolhida' },
          imagemUrl ? h('img', { src: imagemUrl, alt: '' }) : null,
          h('span', {}, imagem.nome, h('span', { class: 'pequeno' }, ` · ${(imagem.tamanho / 1024).toFixed(0)} KB`)),
          h('button', { type: 'button', class: 'btn', onclick: escolherImagem }, 'Trocar'),
          h('button', { type: 'button', class: 'btn discreto', onclick: () => { imagem = null; imagemUrl = null; desenharImagem(); atualizar(); } }, 'Tirar imagem'))
        : h('button', { type: 'button', class: 'btn', onclick: escolherImagem }, '🖼 Escolher imagem (JPG ou PNG, até 5 MB)'));
    };
    async function escolherImagem() {
      const r = await chamar(window.api.modelos.escolherImagem());
      if (!r) return;
      imagem = r.imagem; imagemUrl = r.dataUrl;
      desenharImagem(); atualizar();
    }
    if (imagem) window.api.modelos.imagem(imagem).then((r) => { if (r && r.ok && r.dados) { imagemUrl = r.dados; desenharImagem(); atualizar(); } });
    desenharImagem();

    const linhaSite = h('div', { class: 'linha-site' + (temSite.checked ? '' : ' oculto') },
      h('div', {}, ...campo('Texto do botão', siteTexto, 'até 25 letras')), h('div', {}, ...campo('Link', siteUrl, 'começa com https://')));

    const salvar = async () => {
      const falta = !nome.value.trim() ? ['Dê um nome à mensagem para reconhecê-la depois.', nome] : !texto.value.trim() ? ['Escreva o texto da mensagem.', texto]
        : temSite.checked && !/^https:\/\/\S+$/.test(siteUrl.value.trim()) ? ['O link do botão precisa começar com https://', siteUrl]
          : temSite.checked && !siteTexto.value.trim() ? ['Escreva o texto do botão do link.', siteTexto] : null;
      if (falta) { erro.textContent = falta[0]; erro.classList.remove('oculto'); falta[1].focus(); return; }
      const dados = { nome: nome.value.trim(), corpo: texto.value, imagem, rodape: rodape.value.trim(), botoes: botoes() };
      const lista = S.modelos.map((m) => ({ ...m }));
      let id;
      if (novo) { id = String(Date.now()); lista.push({ id, ...dados }); }
      else { id = modelo.id; Object.assign(lista.find((x) => x.id === id), dados); }
      if (await chamar(window.api.modelos.salvar(lista))) { S.modelos = lista; fechar(id); }
    };

    const excluir = async (ev) => {
      if (!confirmandoExcluir) { confirmandoExcluir = true; ev.target.textContent = 'Confirmar exclusão'; return; }
      const lista = S.modelos.filter((m) => m.id !== modelo.id);
      if (await chamar(window.api.modelos.salvar(lista))) { S.modelos = lista; fechar('excluida'); }
    };

    d.append(
      h('h2', { id: 'dialogo-titulo' }, novo ? 'Nova mensagem' : 'Editar mensagem'),
      erro,
      h('div', { class: 'editor-colunas' },
        h('div', { class: 'editor-campos' },
          ...campo('Nome da mensagem', nome, 'Serve só para você reconhecer a mensagem depois.'),
          h('p', { class: 'rotulo' }, 'Imagem no topo (opcional)'), areaImagem,
          ...(() => { const [rot, ctl] = campo('Texto da mensagem', texto, 'Selecione um trecho e use os botões. Quando a planilha não trouxer o nome, o texto usa “passageiro”.'); return [rot, barra, ctl]; })(),
          ...campo('Rodapé (opcional)', rodape, 'Texto pequeno e cinza embaixo, até 60 letras.'),
          h('fieldset', { class: 'botoes-msg' }, h('legend', {}, 'Botões embaixo da mensagem'),
            h('label', { class: 'marcar' }, sair, ' “Não quero receber” — quem clica sai da lista de envios sozinho (recomendado: menos bloqueios e denúncias)'),
            h('label', { class: 'marcar' }, temSite, ' Botão com link (ex.: baixar o app, site, Instagram)'),
            linhaSite)),
        h('div', { class: 'editor-previa' }, h('p', { class: 'rotulo' }, 'Como a Maria vai ver'), caixaPrevia,
          h('p', { class: 'pequeno' }, 'Para o envio real, depois de salvar, mande a mensagem para aprovação da Meta. Mudou o texto, a imagem, o rodapé ou os botões de uma mensagem aprovada: ela precisa ser aprovada de novo.'))),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => fechar(undefined) }, 'Cancelar'),
        !novo && h('button', { type: 'button', class: 'btn perigo', onclick: excluir }, 'Excluir'),
        h('button', { type: 'button', class: 'btn principal vai', onclick: salvar }, 'Salvar mensagem')));
    atualizar();
  });
}

/* =====================================================================
   Peças reutilizáveis
   ===================================================================== */
function rota(atual) {
  const nomes = ['Mensagem', 'Quem recebe', 'Enviar'];
  return h('ol', { class: 'rota', 'aria-label': 'Etapas da campanha' }, nomes.map((n, i) => {
    const num = i + 1;
    const estado = num < atual ? 'feito' : num === atual ? 'atual' : '';
    return h('li', { class: estado, 'aria-current': estado === 'atual' ? 'step' : false },
      h('span', { class: 'parada', 'aria-hidden': 'true' }, estado === 'feito' ? '✓' : String(num)),
      n, h('span', { class: 'so-leitor' }, estado === 'feito' ? ' (etapa concluída)' : estado === 'atual' ? ` (etapa ${num} de 3)` : ''));
  }));
}

function formColunas(p, aoSalvar, rotuloBotao = 'Salvar colunas') {
  const mapa = { ...(p.mapa || {}) };
  const sel = (chave, vazioTxt) => {
    const s = h('select', {}, h('option', { value: '' }, vazioTxt), p.headers.map((x) => h('option', { value: x, selected: mapa[chave] === x }, x)));
    s.addEventListener('change', () => { mapa[chave] = s.value; });
    return s;
  };
  return h('div', {},
    ...campo('Coluna do telefone', sel('telefone', 'Escolha uma coluna'), 'Obrigatória. É para onde a mensagem vai.'),
    ...campo('Coluna do nome', sel('nome', 'Não usar nome'), 'Para escrever “Oi, Maria”. Só o primeiro nome é usado.'),
    ...campo('Coluna da autorização para receber mensagens', sel('aceite', 'Não tenho essa coluna'), 'Quem tem “sim” nessa coluna recebe. Sem ela, todos os telefones válidos recebem.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: () => {
      if (!mapa.telefone) return avisoErro('Escolha qual coluna tem o telefone.');
      aoSalvar(mapa);
    } }, rotuloBotao)));
}

async function escolherPlanilha() {
  const r = await chamar(window.api.planilha.escolherArquivo());
  if (r) { S.confirmarColunas = true; avisoOk(`Planilha carregada: ${r.linhas} ${pl(r.linhas, 'contato', 'contatos')}.`); await ir(S.rota); }
}

function blocoLink(rotuloBtn = 'Usar este link') {
  const url = h('input', { type: 'text', placeholder: 'https://…', autocomplete: 'off' });
  return h('details', {}, h('summary', {}, 'Prefere usar um link em vez de um arquivo?'),
    ...campo('Link da planilha', url, 'Aceita uma planilha do Google publicada como CSV, ou outro endereço https.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async () => {
      const r = await chamar(window.api.planilha.definirUrl(url.value));
      if (r) { S.confirmarColunas = true; avisoOk(`Link carregado: ${r.linhas} ${pl(r.linhas, 'contato', 'contatos')}.`); await ir(S.rota); }
    } }, rotuloBtn)));
}

/* =====================================================================
   Primeiros passos (aparece só até deixar tudo pronto)
   ===================================================================== */
async function telaPrimeirosPassos(raiz) {
  const atual = pendencia();
  const a = S.ajustes;
  const p = S.planilha;

  raiz.append(h('h1', {}, 'Vamos deixar tudo pronto'),
    h('p', { class: 'apoio' }, 'São 3 passos e você faz uma vez só. Quem escolher a mesma pasta compartilhada já encontra tudo configurado.'));

  const item = (num, titulo, feitoTxt, conteudo) => {
    const estado = num < atual ? 'feito' : num === atual ? 'atual' : 'futuro';
    return h('li', { class: estado },
      h('h2', {}, titulo, estado === 'feito' ? h('span', { class: 'so-leitor' }, ' (concluído)') : null),
      estado === 'feito' ? h('p', { class: 'apoio' }, feitoTxt, ' ', h('button', { type: 'button', class: 'btn discreto', onclick: () => ir('config') }, 'Alterar')) : null,
      estado === 'atual' ? conteudo : null);
  };

  // Passo 1: nome e pasta
  const nome = h('input', { type: 'text', value: S.rascunhoNome || a.operador || '', autocomplete: 'off' });
  nome.addEventListener('input', () => { S.rascunhoNome = nome.value; });
  const passo1 = h('div', {},
    ...(a.operadorPelaConta ? [h('p', { class: 'apoio' }, `Você está como ${a.operador} (nome da sua conta). Ele aparece no histórico.`)]
      : campo('Seu nome', nome, 'Aparece no histórico. Cada pessoa usa um nome diferente.')),
    h('p', { class: 'rotulo' }, 'Pasta compartilhada'),
    h('p', { class: 'ajuda' }, 'Guarda a planilha, as mensagens e o histórico. Todos os usuários escolhem a mesma pasta (do Google Drive, OneDrive etc.).'),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.ajustes.escolherPasta())) await ir(S.rota); } }, a.pasta ? 'Escolher outra pasta' : 'Escolher a pasta'),
      a.pasta ? h('span', { class: 'pequeno' }, 'Pasta escolhida: ', a.pasta) : null),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: async () => {
      if (!a.pasta) return avisoErro('Escolha a pasta compartilhada primeiro.');
      if (a.operadorPelaConta || await chamar(window.api.ajustes.salvarOperador(nome.value))) { S.rascunhoNome = ''; await ir(S.rota); }
    } }, 'Salvar e continuar')));

  // Passo 2: planilha
  const passo2 = h('div', {},
    p && S.confirmarColunas ? h('div', {},
      h('p', {}, `Encontramos ${p.linhas} ${pl(p.linhas, 'contato', 'contatos')}. Confira se as colunas estão certas:`),
      p.mapaAutomatico ? h('p', { class: 'pequeno' }, 'Escolhemos as colunas sozinhos. Mude se alguma estiver errada.') : null,
      formColunas(p, async (mapa) => { if (await chamar(window.api.planilha.salvarMapa(mapa))) { S.confirmarColunas = false; await ir(S.rota); } }, 'Confirmar colunas'))
      : h('div', {},
        p && p.mapaProblema.length ? h('div', { class: 'caixa erro' }, `A coluna “${p.mapaProblema[0]}” não existe mais na planilha. Escolha as colunas de novo.`) : null,
        p && p.mapaProblema.length ? formColunas(p, async (mapa) => { if (await chamar(window.api.planilha.salvarMapa(mapa))) await ir(S.rota); }, 'Confirmar colunas') : h('div', {},
          h('p', {}, 'Escolha a planilha com os contatos (.xlsx ou .csv). Para atualizar depois, basta trocar o arquivo na pasta compartilhada.'),
          h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: escolherPlanilha }, 'Escolher a planilha')),
          blocoLink())));

  // Passo 3: mensagem
  const passo3 = h('div', {},
    h('p', {}, 'Escreva o texto que será enviado. Você pode ter várias mensagens salvas e escolher uma em cada campanha.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: async () => { const id = await editarMensagem(null); if (id) await ir(S.rota); } }, 'Escrever a primeira mensagem')));

  raiz.append(h('ol', { class: 'passos' },
    item(1, 'Seu nome e a pasta compartilhada', `${a.operador}, pasta “${a.pasta}”.`, passo1),
    item(2, 'Planilha de contatos', p ? `${p.linhas} contatos em “${p.origem}”.` : '', passo2),
    item(3, 'Sua primeira mensagem', `${S.modelos.length} ${pl(S.modelos.length, 'mensagem salva', 'mensagens salvas')}.`, passo3)));
}

/* =====================================================================
   Nova campanha: 3 passos
   ===================================================================== */
async function telaCampanha(raiz) {
  if (pendencia()) return telaPrimeirosPassos(raiz);
  if (S.fase === 'enviando') return telaEnviando(raiz);
  if (S.fase === 'resultado') return telaResultado(raiz);
  const modelo = S.modelos.find((m) => m.id === S.camp.modeloId);
  if (S.camp.passo > 1 && !modelo) S.camp.passo = 1;
  return [passo1Mensagem, passo2Quem, passo3Enviar][S.camp.passo - 1](raiz, modelo);
}

async function passo1Mensagem(raiz) {
  if (!S.modelos.some((m) => m.id === S.camp.modeloId)) S.camp.modeloId = S.modelos[0].id;
  const w = await chamar(window.api.whatsapp.ler());
  const temWhats = Boolean(w && w.conta);
  if (temWhats) await atualizarMeta();
  const previas = await Promise.all(S.modelos.map((m) => previa(m.corpo)));

  raiz.append(rota(1), h('h1', {}, 'Qual mensagem você quer enviar?'),
    h('p', { class: 'apoio' }, 'Escolha uma mensagem salva ou escreva uma nova.'));

  const grupo = h('fieldset', {}, h('legend', { class: 'so-leitor' }, 'Mensagens salvas'),
    S.modelos.map((m, i) => {
      const id = novoId('msg');
      const radio = h('input', { type: 'radio', name: 'modelo', id, value: m.id, checked: m.id === S.camp.modeloId });
      radio.addEventListener('change', () => { S.camp.modeloId = m.id; S.camp.nome = ''; });
      const trecho = previas[i].length > 160 ? previas[i].slice(0, 160) + '…' : previas[i];
      return h('div', { class: 'opcao' }, radio,
        h('label', { for: id, class: 'conteudo' }, h('span', { class: 'titulo' }, m.nome), h('span', { class: 'trecho' }, m.imagem ? '🖼 ' : '', trecho), temWhats ? seloMeta(m) : null),
        h('div', { class: 'botoes-opcao' },
          temWhats && ['sem', 'mudou', 'recusado'].includes(situacaoMeta(m).codigo)
            ? h('button', { type: 'button', class: 'btn', 'aria-label': `Enviar a mensagem ${m.nome} para aprovação da Meta`, onclick: async () => { const r = await pedirAprovacao(m); if (r) { await ir('campanha'); avisoOk(`“${m.nome}” foi para a Meta. ${r.situacao.texto}.`); } } }, 'Aprovar na Meta')
            : null,
          h('button', { type: 'button', class: 'btn', 'aria-label': `Editar a mensagem ${m.nome}`, onclick: async () => { const r = await editarMensagem(m); if (r) { if (r === 'excluida') S.camp.modeloId = null; await ir('campanha'); } } }, 'Editar')));
    }));

  if (temWhats && S.modelos.some((m) => situacaoMeta(m).codigo === 'analise')) {
    grupo.append(h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async () => { await ir('campanha'); avisoOk('Situação na Meta atualizada.'); } }, '↻ Ver se já foi aprovada')));
  }
  raiz.append(grupo, h('div', { class: 'acoes' },
    h('button', { type: 'button', class: 'btn', onclick: async () => { const id = await editarMensagem(null); if (id) { S.camp.modeloId = id; S.camp.nome = ''; await ir('campanha'); } } }, 'Escrever nova mensagem'),
    h('button', { type: 'button', class: 'btn principal vai', onclick: async () => { S.camp.passo = 2; await ir('campanha'); } }, 'Continuar')));
}

function nomeDaCampanha(modelo) { return (S.camp.nome || modelo.nome || 'Campanha').trim(); }

async function passo2Quem(raiz, modelo) {
  const r = await chamar(window.api.publico.calcular({ campanha: nomeDaCampanha(modelo) }));
  raiz.append(rota(2), h('h1', {}, 'Quem vai receber?'));
  if (!r) { raiz.append(h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async () => { S.camp.passo = 1; await ir('campanha'); } }, 'Voltar'))); return; }

  S.camp.publico = r;
  const s = r.stats;
  const fora = [
    [s.semAceite, (n) => `${n} ${pl(n, 'não autorizou', 'não autorizaram')} receber mensagens`],
    [s.descadastrados, (n) => `${n} ${pl(n, 'pediu', 'pediram')} para sair da lista`],
    [s.jaEnviados, (n) => `${n} ${pl(n, 'já recebeu', 'já receberam')} esta campanha`],
    [s.telefoneInvalido + s.semTelefone, (n) => `${n} ${pl(n, 'tem', 'têm')} telefone vazio ou inválido`],
    [s.duplicados, (n) => `${n} ${pl(n, 'aparece repetido', 'aparecem repetidos')} na planilha`],
  ].filter(([n]) => n > 0);
  const totalFora = fora.reduce((t, [n]) => t + n, 0);

  raiz.append(
    h('p', { class: 'destaque' }, h('strong', {}, String(s.aptos)), s.aptos === 1 ? 'pessoa vai receber esta mensagem' : 'pessoas vão receber esta mensagem'),
    !r.usouAceite ? h('div', { class: 'caixa' }, h('strong', {}, 'Sua planilha não tem coluna de autorização. '), 'Todos os telefones válidos vão receber. Na próxima etapa você confirma que todos autorizaram.') : null,
    s.aptos === 0 ? h('div', { class: 'caixa erro' }, 'Ninguém pode receber agora. Veja abaixo o motivo.') : null);

  if (fora.length) {
    raiz.append(h('h2', {}, `${totalFora} ${pl(totalFora, 'pessoa ficou', 'pessoas ficaram')} de fora`),
      h('ul', { class: 'lista-fora' }, fora.map(([n, f]) => h('li', {}, f(n)))));
  }
  if (s.corrigidos) raiz.append(h('p', { class: 'pequeno' }, `Em ${s.corrigidos} ${pl(s.corrigidos, 'telefone acrescentamos', 'telefones acrescentamos')} o 9 que faltava.`));

  if (r.amostra.length) {
    raiz.append(h('details', {}, h('summary', {}, 'Ver as primeiras pessoas da lista'),
      h('div', { class: 'tabela' }, h('table', {}, h('caption', { class: 'so-leitor' }, 'Primeiras pessoas que vão receber'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Nome'), h('th', { scope: 'col' }, 'Telefone'))),
        h('tbody', {}, r.amostra.map((d) => h('tr', {}, h('td', {}, d.nomeCompleto || 'Sem nome'), h('td', {}, d.exibir))))))));
  }
  if (r.rejeitados.length) {
    raiz.append(h('details', {}, h('summary', {}, 'Ver quem ficou de fora, linha por linha'),
      h('div', { class: 'tabela' }, h('table', {}, h('caption', { class: 'so-leitor' }, 'Linhas da planilha que não vão receber'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Linha'), h('th', { scope: 'col' }, 'Valor'), h('th', { scope: 'col' }, 'Motivo'))),
        h('tbody', {}, r.rejeitados.map((x) => h('tr', {}, h('td', {}, x.linha), h('td', {}, x.valor), h('td', {}, x.motivo))))))));
  }

  raiz.append(h('div', { class: 'acoes' },
    h('button', { type: 'button', class: 'btn', onclick: async () => { S.camp.passo = 1; await ir('campanha'); } }, 'Voltar'),
    h('button', { type: 'button', class: 'btn principal vai', disabled: s.aptos === 0, onclick: async () => { S.camp.passo = 3; await ir('campanha'); } }, 'Continuar')));
}

async function passo3Enviar(raiz, modelo) {
  const r = S.camp.publico || (await chamar(window.api.publico.calcular({ campanha: nomeDaCampanha(modelo) })));
  if (!r) { S.camp.passo = 2; return ir('campanha'); }
  const n = r.stats.aptos;
  const teste = S.ajustes.simulacao;
  const nome = h('input', { type: 'text', value: nomeDaCampanha(modelo), autocomplete: 'off' });
  nome.addEventListener('input', () => { S.camp.nome = nome.value; });
  const confirma = h('input', { type: 'checkbox', id: 'confirma-autorizacao', checked: S.camp.autorizou });
  confirma.addEventListener('change', () => { S.camp.autorizou = confirma.checked; });
  const balao = h('div', { class: 'previa-whats' });
  balaoDe(modelo).then((b) => balao.append(b));

  const sm = situacaoMeta(modelo);
  const custo = !teste && modelo.meta && S.categorias && S.categorias[modelo.meta.categoria] ? S.categorias[modelo.meta.categoria].custo * n : null;
  raiz.append(rota(3), h('h1', {}, 'Revisar e enviar'),
    !teste && sm.codigo !== 'aprovado' ? h('div', { class: 'caixa erro' }, h('strong', {}, 'Esta mensagem ainda não pode ir no envio real. '), `${sm.texto}. Volte ao passo 1 e use “Aprovar na Meta”.`) : null,
    h('dl', { class: 'resumo' },
      h('dt', {}, 'Mensagem'), h('dd', {}, modelo.nome),
      h('dt', {}, 'Como a Maria vai ver'), h('dd', {}, balao),
      h('dt', {}, 'Quem recebe'), h('dd', {}, `${n} ${pl(n, 'pessoa', 'pessoas')}`),
      h('dt', {}, 'Tipo de envio'), h('dd', {}, teste ? 'Teste. Nada será enviado de verdade.' : 'Envio real, pelo WhatsApp da Urbano Norte'),
      custo !== null ? h('dt', {}, 'Custo estimado') : null,
      custo !== null ? h('dd', {}, `cerca de ${reais(custo)} (cobrado pela Meta no cartão, só das mensagens entregues)`) : null),
    ...campo('Nome da campanha', nome, 'Quem já recebeu uma campanha com este nome não recebe de novo. Para mandar a mesma mensagem outra vez a todos, mude o nome.'),
    !r.usouAceite ? h('label', { class: 'marcar', for: 'confirma-autorizacao' }, confirma, 'Confirmo que todas as pessoas desta lista autorizaram receber mensagens da Urbano Norte.') : null);

  // Prévia de verdade só no WhatsApp de quem está usando (a planilha nunca é usada aqui)
  const w = await chamar(window.api.whatsapp.ler());
  if (w && w.conta) {
    const aprovado = situacaoMeta(modelo).codigo === 'aprovado';
    const btnMim = h('button', { type: 'button', class: 'btn', onclick: async () => {
      const texto = await previa(modelo.corpo, (S.ajustes.operador || '').split(' ')[0] || 'Maria');
      btnMim.disabled = true; btnMim.textContent = 'Enviando…';
      const res = await chamar(window.api.whatsapp.teste(aprovado ? { tipo: 'modeloDisparo', modeloId: modelo.id } : { tipo: 'texto', texto }));
      btnMim.disabled = false; btnMim.textContent = 'Enviar só para o meu WhatsApp';
      if (res) avisoOk(`Prévia enviada só para ${res.para}. Ninguém da planilha recebeu.`);
    } }, 'Enviar só para o meu WhatsApp');
    raiz.append(h('div', { class: 'caixa ok' },
      h('strong', {}, 'Quer ver no celular antes? '),
      `Este botão manda esta mensagem só para ${w.meuNumero}, com o seu nome no lugar de {{nome}}. Ninguém da planilha recebe.`,
      aprovado ? ' Vai pela mensagem aprovada, igual à que a planilha recebe.' : ' Como ainda não está aprovada, vai como texto livre: só chega se você escreveu para o número da empresa nas últimas 24 horas.',
      h('div', { class: 'acoes' }, btnMim)));
  }

  raiz.append(h('div', { class: 'acoes' },
    h('button', { type: 'button', class: 'btn', onclick: async () => { S.camp.passo = 2; await ir('campanha'); } }, 'Voltar'),
    h('button', { type: 'button', class: 'btn principal vai', disabled: !teste && sm.codigo !== 'aprovado', onclick: () => enviar(modelo, r, confirma) }, `Enviar para ${n} ${pl(n, 'pessoa', 'pessoas')}`)));
}

async function enviar(modelo, publicoMostrado, confirma) {
  const campanha = nomeDaCampanha(modelo);
  if (!publicoMostrado.usouAceite && !confirma.checked) { avisoErro('Marque a confirmação de que todas as pessoas autorizaram receber mensagens.'); confirma.focus(); return; }
  limparAvisos();
  // recalcula na hora: o nome da campanha pode ter mudado e a planilha também
  const fresco = await chamar(window.api.publico.calcular({ campanha }));
  if (!fresco) return;
  const n = fresco.stats.aptos;
  if (n === 0) { avisoErro('Ninguém pode receber esta campanha agora. Volte e confira a lista.'); return; }
  const mudou = n !== publicoMostrado.stats.aptos;
  const ok = !S.ajustes.simulacao ? await confirmarReal(modelo, n, mudou ? publicoMostrado.stats.aptos : null) : await confirmar({
    titulo: `Enviar para ${n} ${pl(n, 'pessoa', 'pessoas')}?`,
    texto: [
      S.ajustes.simulacao ? 'É um teste. Nenhuma mensagem real será enviada.' : 'Depois de começar, você só pode parar o envio. Não dá para desfazer.',
      mudou ? `O número mudou de ${publicoMostrado.stats.aptos} para ${n} porque a planilha ou o nome da campanha mudou.` : null,
    ].filter(Boolean),
    sim: 'Enviar agora',
  });
  if (!ok) return;

  const r = await chamar(window.api.envio.iniciar({ campanha, corpo: modelo.corpo, modeloId: modelo.id }));
  if (!r) return;
  S.enviando = true; S.fase = 'enviando'; S.resultado = null;
  S.envio = { total: r.total, feitos: 0, campanha };
  const fora1 = window.api.aoProgredir((p) => {
    S.envio.feitos = p.feitos;
    const barra = $('#prog'); if (barra) barra.value = p.feitos;
    const t = $('#prog-texto'); if (t) t.textContent = `${p.feitos} de ${p.total}`;
  });
  const fora2 = window.api.aoTerminar((res) => {
    fora1(); fora2();
    S.enviando = false; S.fase = 'resultado'; S.resultado = { ...res, campanha };
    ir('campanha');
  });
  await ir('campanha');
}

/* Trava do envio real: a pessoa digita a quantidade de mensagens para confirmar. */
function confirmarReal(modelo, n, antes) {
  return abrirDialogo((d, fechar) => {
    const cat = modelo.meta && S.categorias && S.categorias[modelo.meta.categoria];
    const campoN = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'trava-ajuda' });
    const botao = h('button', { type: 'button', class: 'btn vai perigo', disabled: true, onclick: () => fechar(true) }, `Enviar ${n} ${pl(n, 'mensagem', 'mensagens')} de verdade`);
    campoN.addEventListener('input', () => { botao.disabled = campoN.value.replace(/\D/g, '') !== String(n); });
    campoN.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !botao.disabled) fechar(true); });
    d.append(h('h2', { id: 'dialogo-titulo' }, `Envio real para ${n} ${pl(n, 'pessoa', 'pessoas')}`),
      h('p', {}, `As mensagens saem de verdade pelo WhatsApp da Urbano Norte${cat ? `, com custo estimado de ${reais(cat.custo * n)}` : ''}. Depois de começar, dá para parar, mas não dá para desfazer o que já foi enviado.`),
      antes !== null ? h('p', {}, `O número mudou de ${antes} para ${n} porque a planilha ou o nome da campanha mudou.`) : null,
      h('label', { for: campoN.id || (campoN.id = novoId('trava')) }, `Para confirmar, digite ${n}:`), campoN,
      h('p', { id: 'trava-ajuda', class: 'pequeno' }, 'É a quantidade de pessoas que vão receber.'),
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => fechar(false) }, 'Cancelar'), botao));
  }).then((v) => v === true);
}

async function telaEnviando(raiz) {
  const e = S.envio || { total: 0, feitos: 0 };
  raiz.append(h('h1', {}, 'Enviando as mensagens'),
    h('p', { class: 'apoio' }, 'Pode deixar o app aberto. Se precisar, você pode parar o envio a qualquer momento.'),
    h('progress', { id: 'prog', max: String(e.total), value: String(e.feitos), 'aria-label': 'Progresso do envio' }),
    h('p', { id: 'prog-texto', 'aria-live': 'off' }, `${e.feitos} de ${e.total}`),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async (ev) => { ev.target.disabled = true; await window.api.envio.cancelar(); } }, 'Parar o envio')));
}

async function telaResultado(raiz) {
  const r = S.resultado || {};
  const teste = S.ajustes.simulacao;
  if (r.erro) {
    raiz.append(h('h1', {}, 'O envio não terminou'), h('div', { class: 'caixa erro' }, r.erro));
  } else {
    const falhas = r.falhas || 0;
    raiz.append(h('h1', {}, falhas ? 'Envio terminado com falhas' : r.cancelado ? 'Envio interrompido' : 'Pronto, envio concluído'),
      h('p', { class: 'destaque' }, h('strong', {}, String(r.enviados || 0)), pl(r.enviados, 'mensagem enviada', 'mensagens enviadas')),
      teste ? h('div', { class: 'caixa' }, 'Foi um teste: nenhuma mensagem real saiu.') : null,
      falhas ? h('div', { class: 'caixa erro' }, `${falhas} ${pl(falhas, 'mensagem falhou', 'mensagens falharam')}. Veja os detalhes no histórico.`) : null,
      r.parouPorLimite ? h('div', { class: 'caixa' }, 'O envio parou no limite diário. Quem já recebeu não recebe de novo: continue amanhã com o mesmo nome de campanha.') : null,
      r.cancelado ? h('p', {}, 'Você parou o envio. Quem já recebeu não recebe de novo se você continuar com o mesmo nome de campanha.') : null);
  }
  raiz.append(h('div', { class: 'acoes' },
    h('button', { type: 'button', class: 'btn', onclick: () => ir('historico') }, 'Ver o histórico'),
    h('button', { type: 'button', class: 'btn principal vai', onclick: async () => { novaCampanha(); await ir('campanha'); } }, 'Nova campanha')));
}

/* =====================================================================
   Quem pediu para sair
   ===================================================================== */
async function telaSair(raiz) {
  const caixa = h('textarea', { placeholder: '(69) 99999-0000' });
  raiz.append(h('h1', {}, 'Quem pediu para sair'),
    h('p', { class: 'apoio' }, 'Estas pessoas nunca recebem campanhas, em nenhum computador.'),
    ...campo('Adicionar telefones', caixa, 'Um por linha.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: async () => {
      if (!caixa.value.trim()) return avisoErro('Digite ou cole pelo menos um telefone.');
      const r = await chamar(window.api.descadastros.adicionar(caixa.value));
      if (!r) return;
      await ir('sair');
      const invalidos = r.invalidos.length ? ` Não foram adicionados por estarem inválidos: ${r.invalidos.join(', ')}.` : '';
      if (r.invalidos.length) avisoErro(`${r.ok} adicionados.${invalidos}`); else avisoOk(`${r.ok} ${pl(r.ok, 'telefone adicionado', 'telefones adicionados')}.`);
    } }, 'Adicionar à lista')));

  const itens = (await chamar(window.api.descadastros.listar())) || [];
  raiz.append(h('h2', {}, `Na lista (${itens.length})`));
  if (!itens.length) { raiz.append(h('p', { class: 'apoio' }, 'Ninguém na lista por enquanto.')); return; }
  raiz.append(h('div', { class: 'tabela' }, h('table', {}, h('caption', { class: 'so-leitor' }, 'Telefones que não recebem campanhas'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Telefone'), h('th', { scope: 'col' }, 'Motivo'), h('th', { scope: 'col' }, 'Adicionado por'), h('th', { scope: 'col' }, h('span', { class: 'so-leitor' }, 'Ação')))),
    h('tbody', {}, itens.map((d) => h('tr', {}, h('td', {}, d.exibir), h('td', {}, d.motivo || '—'), h('td', {}, `${d.operador}, ${dataBR(d.t)}`),
      h('td', {}, h('button', { type: 'button', class: 'btn', 'aria-label': `Reativar ${d.exibir}`, onclick: async () => {
        if (await confirmar({ titulo: 'Voltar a enviar para esta pessoa?', texto: `${d.exibir} voltará a receber campanhas.`, sim: 'Sim, voltar a enviar' })) {
          if (await chamar(window.api.descadastros.remover(d.telefone))) { await ir('sair'); avisoOk('Pessoa removida da lista.'); }
        }
      } }, 'Reativar'))))))));
}

/* =====================================================================
   Histórico
   ===================================================================== */
async function telaHistorico(raiz) {
  const r = await chamar(window.api.historico.ler());
  raiz.append(h('h1', {}, 'Histórico de envios'), h('p', { class: 'apoio' }, 'Tudo o que foi enviado, por qualquer usuário.'));
  if (!r) return;
  if (!r.resumo.length) { raiz.append(h('p', {}, 'Nenhum envio ainda. Quando você enviar a primeira campanha, ela aparece aqui.')); return; }
  raiz.append(h('div', { class: 'tabela' }, h('table', {}, h('caption', { class: 'so-leitor' }, 'Campanhas enviadas'),
    h('thead', {}, h('tr', {}, ['Campanha', 'Tipo', 'Enviadas', 'Falhas', 'Quem enviou', 'Último envio'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, r.resumo.map((c) => h('tr', {}, h('td', {}, c.campanha),
      h('td', {}, h('span', { class: 'etiqueta' + (c.simulacao ? ' teste' : '') }, c.simulacao ? 'Teste' : 'Real')),
      h('td', {}, c.enviados), h('td', {}, c.falhas), h('td', {}, c.operadores.join(', ')), h('td', {}, dataBR(c.ultimo))))))));
  raiz.append(h('details', {}, h('summary', {}, `Ver os últimos ${r.recentes.length} envios, um por um`),
    h('div', { class: 'tabela' }, h('table', {}, h('caption', { class: 'so-leitor' }, 'Últimos envios'),
      h('thead', {}, h('tr', {}, ['Quando', 'Campanha', 'Telefone', 'Resultado', 'Quem enviou'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, r.recentes.map((e) => h('tr', {}, h('td', {}, dataBR(e.t)), h('td', {}, e.campanha), h('td', {}, e.exibir),
        h('td', {}, e.status === 'enviado' ? 'Enviado' : `Falhou${e.erro ? `: ${e.erro}` : ''}`), h('td', {}, e.operador))))))));
}

/* =====================================================================
   Configurações
   ===================================================================== */
async function telaConfig(raiz) {
  const a = S.ajustes;
  const p = S.planilha;
  raiz.append(h('h1', {}, 'Configurações'));

  // Você
  const nome = h('input', { type: 'text', value: a.operador, autocomplete: 'off' });
  if (a.operadorPelaConta) raiz.append(h('h2', {}, 'Você'), h('p', { class: 'apoio' }, `${a.operador} (nome da sua conta, aparece no histórico).`));
  else raiz.append(h('h2', {}, 'Você'),
    ...campo('Seu nome', nome, 'Aparece no histórico. Cada pessoa usa um nome diferente.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (!a.pasta) return avisoErro('Escolha a pasta compartilhada antes de salvar o nome.');
      if (await chamar(window.api.ajustes.salvarOperador(nome.value))) { await ir('config'); avisoOk('Nome salvo.'); }
    } }, 'Salvar nome')));

  // Pasta
  raiz.append(h('h2', {}, 'Pasta compartilhada'),
    h('p', { class: 'apoio' }, 'Todos os usuários devem escolher a mesma pasta. Ela guarda a planilha, as mensagens, os limites e o histórico.'),
    h('p', {}, a.pasta ? `Pasta atual: ${a.pasta}` : 'Nenhuma pasta escolhida.'),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.ajustes.escolherPasta())) { await ir('config'); avisoOk('Pasta escolhida.'); } } }, a.pasta ? 'Escolher outra pasta' : 'Escolher a pasta'),
      a.pasta ? h('button', { type: 'button', class: 'btn', onclick: () => window.api.abrirPasta() }, 'Abrir a pasta') : null));

  if (a.pronto) {
    // Planilha
    raiz.append(h('h2', {}, 'Planilha de contatos'));
    if (p) {
      raiz.append(h('p', {}, `${p.linhas} contatos em “${p.origem}”. Lida em ${dataBR(p.atualizadoEm)}. O app confere se ela mudou a cada 15 segundos.`));
      if (p.mapaProblema.length) raiz.append(h('div', { class: 'caixa erro' }, `A coluna “${p.mapaProblema[0]}” não existe mais na planilha. Escolha as colunas de novo.`));
    } else raiz.append(h('p', { class: 'apoio' }, 'Nenhuma planilha escolhida ainda.'));
    raiz.append(h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn', onclick: escolherPlanilha }, p ? 'Escolher outra planilha' : 'Escolher a planilha'),
      p ? h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.planilha.recarregar())) { await ir('config'); avisoOk('Planilha atualizada.'); } } }, 'Atualizar agora') : null),
      blocoLink());
    if (p) raiz.append(h('h3', { class: 'rotulo' }, 'Colunas usadas'), formColunas(p, async (mapa) => { if (await chamar(window.api.planilha.salvarMapa(mapa))) { S.confirmarColunas = false; await ir('config'); avisoOk('Colunas salvas para todos.'); } }));

    // Limites
    const limite = h('input', { type: 'number', min: '0', value: String(a.limiteDiario), inputmode: 'numeric' });
    const intervalo = h('input', { type: 'number', min: '0', step: '100', value: String(a.intervaloMs), inputmode: 'numeric' });
    raiz.append(h('h2', {}, 'Limites de envio'),
      h('p', { class: 'apoio' }, 'Valem para todos os usuários. O WhatsApp libera o volume aos poucos, então comece com um número baixo.'),
      ...campo('Máximo de mensagens por dia', limite, 'Soma todos os usuários. Use 0 para não limitar.'),
      ...campo('Pausa entre uma mensagem e outra, em milissegundos', intervalo, 'Vale só no envio real.'),
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (await chamar(window.api.ajustes.salvarLimites({ limiteDiario: limite.value, intervaloMs: intervalo.value }))) avisoOk('Limites salvos.');
      } }, 'Salvar limites')));
  }

  // WhatsApp (API oficial da Meta) — fica só neste computador
  await secaoWhatsApp(raiz);

  // Envio real (por computador)
  if (a.pronto) {
    const real = !a.simulacao;
    raiz.append(h('h2', {}, 'Envio real das campanhas'),
      h('p', { class: 'apoio' }, real
        ? 'Ligado neste computador: as campanhas saem de verdade pelo WhatsApp, só com mensagens aprovadas pela Meta.'
        : 'Desligado: as campanhas são só um teste e nada é enviado. Ligue quando tiver uma mensagem aprovada pela Meta e o cartão cadastrado na Meta.'),
      a.querReal && a.simulacao ? h('div', { class: 'caixa' }, 'O envio real está ligado, mas falta configurar o WhatsApp acima.') : null,
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn ' + (real ? '' : 'perigo'), onclick: async () => {
        if (!real && !(await confirmar({ titulo: 'Ligar o envio real neste computador?', texto: ['As próximas campanhas enviadas daqui vão sair de verdade e a Meta cobra cada mensagem entregue.', 'Antes de cada envio você ainda vai revisar e digitar a quantidade de mensagens para confirmar.'], sim: 'Ligar o envio real', perigo: true }))) return;
        const r = await chamar(window.api.ajustes.modoReal(!a.querReal));
        if (r) { await carregarBase(); await ir('config'); avisoOk(r.simulacao ? 'Envio real desligado: campanhas voltam a ser só teste.' : 'Envio real ligado neste computador.'); }
      } }, a.querReal ? 'Desligar o envio real' : 'Ligar o envio real')));
  }

  // Tamanho do texto
  const atual = lerTexto();
  const opcoes = [['normal', 'Normal'], ['grande', 'Grande'], ['enorme', 'Muito grande']];
  raiz.append(h('h2', {}, 'Tamanho do texto'),
    h('fieldset', {}, h('legend', { class: 'so-leitor' }, 'Tamanho do texto'),
      opcoes.map(([v, rot]) => {
        const id = novoId('tx');
        const r = h('input', { type: 'radio', name: 'texto', id, value: v, checked: v === atual });
        r.addEventListener('change', () => aplicarTexto(v));
        return h('label', { class: 'marcar', for: id }, r, rot);
      })),
    h('h2', {}, 'Sobre'), h('p', { class: 'apoio' }, `Versão ${a.versao}.`));
}

/* WhatsApp: credenciais da API oficial e teste no próprio número.
   Aqui só sai mensagem para o número da própria pessoa; campanhas reais dependem do envio real ligado. */
async function secaoWhatsApp(raiz) {
  const w = await chamar(window.api.whatsapp.ler());
  if (!w) return;
  raiz.append(h('h2', {}, 'WhatsApp (API oficial da Meta)'),
    h('p', { class: 'apoio' }, 'Copie os dados do painel da Meta (developers.facebook.com › seu app › WhatsApp › Configuração da API). ',
      'Ficam guardados só neste computador, cifrados. Os testes abaixo só mandam mensagem para o seu número; as campanhas só saem de verdade com o envio real ligado (mais abaixo).'));
  if (!w.protecao) { raiz.append(h('div', { class: 'caixa erro' }, 'Este computador não oferece cofre seguro, então o token não pode ser guardado.')); return; }
  if (w.conta) raiz.append(h('div', { class: 'caixa ok', role: 'status' }, h('strong', {}, 'Conectado. '), `Número da empresa: ${w.conta.numero}${w.conta.nome ? ` (${w.conta.nome})` : ''}. Seu número para testes: ${w.meuNumero}.`));

  const numeroId = h('input', { type: 'text', value: w.numeroId, autocomplete: 'off', inputmode: 'numeric', spellcheck: 'false' });
  const token = h('input', { type: 'password', value: '', autocomplete: 'off', spellcheck: 'false', placeholder: w.temToken ? 'Token salvo. Cole outro só para trocar.' : '' });
  const meu = h('input', { type: 'tel', value: w.meuNumero, autocomplete: 'off', placeholder: '(64) 99999-8888' });
  raiz.append(
    ...campo('ID do número de telefone', numeroId, 'Em inglês aparece como "Phone number ID". Só números.'),
    ...campo('Token de acesso', token, 'Use o token permanente do usuário do sistema (AtendimentoUN), gerado com expiração "Nunca".'),
    ...campo('Seu número de WhatsApp (para testes)', meu, 'Quem recebe o teste. Com DDD, ex.: (64) 99999-8888.'),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn principal', onclick: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'Conferindo com a Meta…';
        const c = await chamar(window.api.whatsapp.salvar({ numeroId: numeroId.value, token: token.value, meuNumero: meu.value }));
        if (c) { await ir('config'); avisoOk(`WhatsApp conectado: ${c.numero}.`); } else { ev.target.disabled = false; ev.target.textContent = 'Salvar e conferir'; }
      } }, 'Salvar e conferir'),
      w.temToken ? h('button', { type: 'button', class: 'btn discreto', onclick: async () => {
        if (await confirmar({ titulo: 'Apagar os dados do WhatsApp?', texto: 'O ID e o token saem deste computador. Os outros computadores não são afetados.', sim: 'Apagar', perigo: true })
          && await chamar(window.api.whatsapp.apagar())) { await ir('config'); avisoOk('Dados do WhatsApp apagados deste computador.'); }
      } }, 'Apagar deste computador') : null));

  if (!w.conta) return;
  const texto = h('textarea', { rows: '3' });
  texto.value = 'Olá! Este é um teste do Disparo Urbano Norte.';
  const enviarTeste = async (tipo, botao) => {
    const rotulo = botao.textContent;
    botao.disabled = true; botao.textContent = 'Enviando…';
    const r = await chamar(window.api.whatsapp.teste({ tipo, texto: texto.value }));
    botao.disabled = false; botao.textContent = rotulo;
    if (r) avisoOk(`A Meta aceitou a mensagem para ${r.para}${r.waId ? ` (WhatsApp de destino: ${r.waId})` : ''}. Código: ${r.id || '—'}. Confira o seu WhatsApp, inclusive em Arquivadas.`);
  };
  raiz.append(h('h3', { class: 'rotulo' }, 'Testar no seu número'),
    h('p', { class: 'apoio' }, 'Regra do WhatsApp: texto livre só chega para quem mandou mensagem para o número da empresa, (64) 99905-1127, nas últimas 24 horas. A Meta aceita o envio, mas ele falha depois se a pessoa não escreveu antes. ',
      'Se nunca mandou, mande um "oi" para o número da empresa antes. Para testar como quem nunca escreveu, use a mensagem aprovada pela Meta (botão de teste na tela da campanha).'),
    ...campo('Texto do teste', texto),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn principal', onclick: (ev) => enviarTeste('texto', ev.target) }, 'Enviar este texto')));
}

/* =====================================================================
   Navegação
   ===================================================================== */
const TELAS = { campanha: telaCampanha, sair: telaSair, historico: telaHistorico, config: telaConfig };

async function ir(rotaNova) {
  if (S.enviando && rotaNova !== 'campanha') { avisoErro('Há um envio em andamento. Espere terminar ou pare o envio antes de sair desta tela.'); return; }
  const mudouDeTela = rotaNova !== S.rota;
  if (mudouDeTela) limparAvisos();
  await carregarBase();
  if (!S.ajustes || !S.ajustes.pronto) { if (rotaNova === 'sair' || rotaNova === 'historico') rotaNova = 'campanha'; }
  S.rota = rotaNova;
  document.querySelectorAll('#menu button').forEach((b) => { if (b.dataset.rota === rotaNova) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const raiz = vazio($('#tela'));
  await TELAS[rotaNova](raiz);
  document.title = `${(raiz.querySelector('h1') || {}).textContent || 'Início'} · Disparo Urbano Norte`;
  const t = raiz.querySelector('h1');
  if (t) { t.tabIndex = -1; t.focus({ preventScroll: false }); }
  $('#principal').scrollTop = 0;
}

document.querySelectorAll('#menu button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.rota === 'campanha' && S.fase === 'resultado' && !S.enviando) novaCampanha();
  ir(b.dataset.rota);
}));

/* A planilha mudou na pasta compartilhada: avisa e recalcula se estiver montando a campanha */
window.api.aoMudarPlanilha(async (resumo) => {
  if (S.enviando) return;
  S.camp.publico = null;
  if (S.rota === 'campanha' && S.fase === 'montando' && S.camp.passo > 1) { await ir('campanha'); avisoOk(`A planilha foi atualizada (${resumo.linhas} contatos). Recalculamos quem vai receber.`); }
  else if (S.rota === 'campanha' || S.rota === 'config') { await ir(S.rota); avisoOk(`A planilha foi atualizada (${resumo.linhas} contatos).`); }
});

ir('campanha');
