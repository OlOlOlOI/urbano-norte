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

/* Editor de mensagem. Devolve o id salvo (ou undefined se cancelou). */
function editarMensagem(modelo) {
  const novo = !modelo;
  return abrirDialogo((d, fechar) => {
    const nome = h('input', { type: 'text', value: modelo ? modelo.nome : '', autocomplete: 'off' });
    const texto = h('textarea', {}, modelo ? modelo.corpo : '');
    const balao = h('div', { class: 'balao', 'aria-live': 'polite' });
    const erro = h('div', { class: 'caixa erro oculto', role: 'alert' });
    let confirmandoExcluir = false;

    let t;
    const atualizar = () => { clearTimeout(t); t = setTimeout(async () => { balao.textContent = await previa(texto.value); }, 150); };
    texto.addEventListener('input', atualizar);
    atualizar();

    const inserir = () => {
      const marca = '{{nome|passageiro}}';
      const ini = texto.selectionStart ?? texto.value.length;
      const fim = texto.selectionEnd ?? ini;
      texto.value = texto.value.slice(0, ini) + marca + texto.value.slice(fim);
      texto.focus();
      texto.setSelectionRange(ini + marca.length, ini + marca.length);
      atualizar();
    };

    const salvar = async () => {
      if (!nome.value.trim() || !texto.value.trim()) {
        erro.textContent = !nome.value.trim() ? 'Dê um nome à mensagem para reconhecê-la depois.' : 'Escreva o texto da mensagem.';
        erro.classList.remove('oculto');
        (!nome.value.trim() ? nome : texto).focus();
        return;
      }
      const lista = S.modelos.map((m) => ({ ...m }));
      let id;
      if (novo) { id = String(Date.now()); lista.push({ id, nome: nome.value.trim(), corpo: texto.value }); }
      else { id = modelo.id; const m = lista.find((x) => x.id === id); m.nome = nome.value.trim(); m.corpo = texto.value; }
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
      ...campo('Nome da mensagem', nome, 'Serve só para você reconhecer a mensagem depois.'),
      ...campo('Texto da mensagem', texto),
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn', onclick: inserir }, 'Inserir o nome da pessoa')),
      h('p', { class: 'pequeno' }, 'Quando a planilha não trouxer o nome, o texto usa “passageiro”.'),
      h('p', { class: 'rotulo' }, 'Como a Maria vai ver'), balao,
      h('p', { class: 'pequeno' }, 'No envio real, este texto precisa ser igual ao modelo aprovado pelo WhatsApp.'),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => fechar(undefined) }, 'Cancelar'),
        !novo && h('button', { type: 'button', class: 'btn perigo', onclick: excluir }, 'Excluir'),
        h('button', { type: 'button', class: 'btn principal vai', onclick: salvar }, 'Salvar mensagem')));
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
    ...campo('Seu nome', nome, 'Aparece no histórico. Cada pessoa usa um nome diferente.'),
    h('p', { class: 'rotulo' }, 'Pasta compartilhada'),
    h('p', { class: 'ajuda' }, 'Guarda a planilha, as mensagens e o histórico. Todos os usuários escolhem a mesma pasta (do Google Drive, OneDrive etc.).'),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'btn', onclick: async () => { if (await chamar(window.api.ajustes.escolherPasta())) await ir(S.rota); } }, a.pasta ? 'Escolher outra pasta' : 'Escolher a pasta'),
      a.pasta ? h('span', { class: 'pequeno' }, 'Pasta escolhida: ', a.pasta) : null),
    h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'btn principal', onclick: async () => {
      if (!a.pasta) return avisoErro('Escolha a pasta compartilhada primeiro.');
      if (await chamar(window.api.ajustes.salvarOperador(nome.value))) { S.rascunhoNome = ''; await ir(S.rota); }
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
        h('label', { for: id, class: 'conteudo' }, h('span', { class: 'titulo' }, m.nome), h('span', { class: 'trecho' }, trecho)),
        h('button', { type: 'button', class: 'btn', 'aria-label': `Editar a mensagem ${m.nome}`, onclick: async () => { const r = await editarMensagem(m); if (r) { if (r === 'excluida') S.camp.modeloId = null; await ir('campanha'); } } }, 'Editar'));
    }));

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
  const balao = h('div', { class: 'balao' });
  previa(modelo.corpo).then((t) => { balao.textContent = t; });

  raiz.append(rota(3), h('h1', {}, 'Revisar e enviar'),
    h('dl', { class: 'resumo' },
      h('dt', {}, 'Mensagem'), h('dd', {}, modelo.nome),
      h('dt', {}, 'Como a Maria vai ver'), h('dd', {}, balao),
      h('dt', {}, 'Quem recebe'), h('dd', {}, `${n} ${pl(n, 'pessoa', 'pessoas')}`),
      h('dt', {}, 'Tipo de envio'), h('dd', {}, teste ? 'Teste. Nada será enviado de verdade.' : 'Envio real')),
    ...campo('Nome da campanha', nome, 'Quem já recebeu uma campanha com este nome não recebe de novo. Para mandar a mesma mensagem outra vez a todos, mude o nome.'),
    !r.usouAceite ? h('label', { class: 'marcar', for: 'confirma-autorizacao' }, confirma, 'Confirmo que todas as pessoas desta lista autorizaram receber mensagens da Urbano Norte.') : null);

  raiz.append(h('div', { class: 'acoes' },
    h('button', { type: 'button', class: 'btn', onclick: async () => { S.camp.passo = 2; await ir('campanha'); } }, 'Voltar'),
    h('button', { type: 'button', class: 'btn principal vai', onclick: () => enviar(modelo, r, confirma) }, `Enviar para ${n} ${pl(n, 'pessoa', 'pessoas')}`)));
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
  const ok = await confirmar({
    titulo: `Enviar para ${n} ${pl(n, 'pessoa', 'pessoas')}?`,
    texto: [
      S.ajustes.simulacao ? 'É um teste. Nenhuma mensagem real será enviada.' : 'Depois de começar, você só pode parar o envio. Não dá para desfazer.',
      mudou ? `O número mudou de ${publicoMostrado.stats.aptos} para ${n} porque a planilha ou o nome da campanha mudou.` : null,
    ].filter(Boolean),
    sim: 'Enviar agora',
  });
  if (!ok) return;

  const r = await chamar(window.api.envio.iniciar({ campanha, corpo: modelo.corpo }));
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
  raiz.append(h('h2', {}, 'Você'),
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
