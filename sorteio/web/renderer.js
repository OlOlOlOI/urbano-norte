const $ = (id) => document.getElementById(id);
const texto = (v) => String(v ?? '').trim();
// Minúsculas e sem acento; "Nº" vira "no" para comparar títulos.
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const fmtNum = (n) => n.toLocaleString('pt-BR');

const estado = {
  aba: null, abas: null, titulos: [], base: [], valoresFiltro: [],
  historico: [], girando: false, sequencia: 0,
};

// ---------- Reconhecimento automático das colunas ----------
const PREFERIDOS = {
  os: ['no os', 'n os', 'os', 'o.s', 'o.s.', 'ordem de servico', 'numero da os', 'numero os'],
  dia: ['momento da solicitacao', 'dia da corrida', 'data da corrida', 'data', 'dia'],
  pass: ['nome do passageiro', 'nome da passageira', 'passageira', 'passageiro'],
  mot: ['motorista', 'nome do motorista', 'nome da motorista'],
  tel: ['telefone do passageiro', 'telefone da passageira', 'telefone', 'celular', 'contato'],
  email: ['e-mail do passageiro', 'email do passageiro', 'e-mail da passageira', 'email da passageira', 'e-mail de cadastro', 'email de cadastro', 'e-mail', 'email'],
};
const PADROES = {
  os: /(^|\b)(o\.?\s?s\.?|ordem)(\b|$)/,
  dia: /\b(data|dia|solicitacao)\b/,
  pass: /passageir/,
  mot: /motorist|condutor/,
  tel: /telefon|celular|whatsapp|contato/,
  email: /e-?mail/,
};
const EXCLUIR_TEL = /(motorista|cadastro|parada|cliente|operador)/;
const EXCLUIR = /(especificad|justificativ|telefone|programad|estimativa|cadastro|parada|pedido|voucher|cupom|momento que|distancia|tempo|informacao|observacao)/;

function detectarColunas(titulos) {
  const t = titulos.map(norm);
  const usados = new Set();
  const achar = (campo) => {
    let i = t.findIndex((x, idx) => !usados.has(idx) && PREFERIDOS[campo].includes(x));
    if (i < 0) i = t.findIndex((x, idx) => !usados.has(idx) && !(campo === 'tel' ? EXCLUIR_TEL : EXCLUIR).test(x) && PADROES[campo].test(x));
    if (i >= 0) usados.add(i);
    return i;
  };
  return {
    os: achar('os'), dia: achar('dia'), pass: achar('pass'), mot: achar('mot'), tel: achar('tel'), email: achar('email'),
    filtro: t.findIndex((x) => x === 'categoria'),
  };
}

// ---------- Formatação ----------
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
function formatarNome(s) {
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (s === s.toUpperCase()) s = s.toLowerCase();
  return s.split(' ').map((p, i) => (i > 0 && PARTICULAS.has(p.toLowerCase()))
    ? p.toLowerCase()
    : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
function formatarDia(s) {
  const m = /^\d{1,2}\/\d{1,2}\/\d{4}/.exec(s);
  return m ? m[0] : s;
}

// Número aleatório criptográfico, sem viés de módulo.
function inteiroAleatorio(n) {
  const limite = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
  return buf[0] % n;
}

function mostrarErro(msg) {
  const el = $('erro');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function letraColuna(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function preencherSelect(sel, titulos, indice, rotuloVazio) {
  sel.innerHTML = '';
  sel.add(new Option(rotuloVazio, '-1'));
  titulos.forEach((t, i) => sel.add(new Option(`${letraColuna(i)} — ${texto(t) || '(sem título)'}`, String(i))));
  sel.value = String(indice);
}

function detectarLinhaTitulos(linhas) {
  const i = linhas.findIndex((l) => l.filter((c) => texto(c) !== '').length >= 2);
  return i < 0 ? 1 : i + 1;
}

// ---------- Carregamento ----------
async function escolherAba(nome) {
  estado.aba = nome;
  $('inpTitulo').value = detectarLinhaTitulos(estado.abas.topo[nome] || []);
  await carregarTitulos(true);
}

async function carregarTitulos(automatico) {
  const linha = Math.max(1, parseInt($('inpTitulo').value, 10) || 1);
  estado.titulos = await window.api.obterTitulos(estado.aba, linha);
  const m = automatico
    ? detectarColunas(estado.titulos)
    : { os: +$('selOS').value, dia: +$('selDia').value, pass: +$('selPass').value, mot: +$('selMot').value, tel: +$('selTel').value, email: +$('selEmail').value, filtro: +$('selFiltroCol').value };
  preencherSelect($('selOS'), estado.titulos, m.os, '(escolha a coluna)');
  preencherSelect($('selDia'), estado.titulos, m.dia, '(escolha a coluna)');
  preencherSelect($('selPass'), estado.titulos, m.pass, '(escolha a coluna)');
  preencherSelect($('selMot'), estado.titulos, m.mot, '(escolha a coluna)');
  preencherSelect($('selTel'), estado.titulos, m.tel, '(sem telefone)');
  preencherSelect($('selEmail'), estado.titulos, m.email, '(sem e-mail)');
  preencherSelect($('selFiltroCol'), estado.titulos, m.filtro, '(todas as corridas)');
  await recarregarBase();
}

function mapaAtual() {
  return { os: +$('selOS').value, dia: +$('selDia').value, pass: +$('selPass').value, mot: +$('selMot').value, tel: +$('selTel').value, email: +$('selEmail').value, filtro: +$('selFiltroCol').value };
}

function colunasCompletas() {
  const m = mapaAtual();
  return m.os >= 0 && m.dia >= 0 && m.pass >= 0 && m.mot >= 0;
}

// Busca no app só as colunas escolhidas e monta a lista de corridas.
async function recarregarBase() {
  const seq = ++estado.sequencia;
  const m = mapaAtual();
  const filtroAnterior = $('selFiltroVal').value;

  if (!colunasCompletas()) {
    estado.base = []; estado.valoresFiltro = [];
    atualizarFiltroValores('');
    atualizarElegiveis();
    return;
  }
  $('infoElegiveis').textContent = 'Lendo corridas…';
  const linha = Math.max(1, parseInt($('inpTitulo').value, 10) || 1);
  const dados = await window.api.extrairColunas(estado.aba, linha, [m.os, m.dia, m.pass, m.mot, m.filtro]);
  if (seq !== estado.sequencia) return; // chegou uma resposta mais nova

  const base = [];
  const valores = new Set();
  for (const [os, dia, pass, mot, filtro] of dados) {
    if (os === '') continue;
    base.push({ os, dia: formatarDia(dia), passageira: formatarNome(pass), motorista: formatarNome(mot), filtro });
    if (filtro !== '') valores.add(filtro);
  }
  estado.base = base;
  estado.valoresFiltro = [...valores].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  atualizarFiltroValores(filtroAnterior);
  atualizarElegiveis();
}

function atualizarFiltroValores(anterior) {
  const sel = $('selFiltroVal');
  const ativo = +$('selFiltroCol').value >= 0;
  $('lblFiltroVal').hidden = !ativo;
  sel.innerHTML = '';
  if (!ativo) return;
  sel.add(new Option('(todos)', ''));
  estado.valoresFiltro.slice(0, 300).forEach((v) => sel.add(new Option(v, v)));
  sel.value = estado.valoresFiltro.includes(anterior) ? anterior : '';
}

// ---------- Regras do sorteio ----------
function corridasDoFiltro() {
  const ativo = +$('selFiltroCol').value >= 0;
  const valor = $('selFiltroVal').value;
  return ativo && valor !== '' ? estado.base.filter((c) => c.filtro === valor) : estado.base;
}

function corridasElegiveis() {
  const jaOS = new Set(), jaPass = new Set(), jaMot = new Set();
  const arquivo = estado.abas ? estado.abas.arquivo : '';
  estado.historico.filter((h) => h.arquivo === arquivo).forEach((h) => {
    jaOS.add(norm(h.os)); jaPass.add(norm(h.passageira)); jaMot.add(norm(h.motorista));
  });
  const naoOS = $('optOS').checked, naoPass = $('optPass').checked, naoMot = $('optMot').checked;
  return corridasDoFiltro().filter((c) =>
    !(naoOS && jaOS.has(norm(c.os))) &&
    !(naoPass && c.passageira && jaPass.has(norm(c.passageira))) &&
    !(naoMot && c.motorista && jaMot.has(norm(c.motorista))));
}

function atualizarElegiveis() {
  if (!colunasCompletas()) {
    $('infoElegiveis').textContent = 'Escolha as quatro colunas para liberar o sorteio.';
    $('btnSortear').disabled = true;
    return;
  }
  const eleg = corridasElegiveis().length;
  const noFiltro = corridasDoFiltro().length;
  const filtrado = noFiltro !== estado.base.length;
  $('infoElegiveis').textContent =
    `${fmtNum(estado.base.length)} corridas na planilha` +
    (filtrado ? `, ${fmtNum(noFiltro)} no filtro` : '') +
    `, ${fmtNum(eleg)} disponíveis para sortear.`;
  $('btnSortear').disabled = estado.girando || eleg === 0;
}

// ---------- Sorteio ----------
function preencherTicket(c, classe) {
  $('tPass').textContent = c.passageira || '—';
  $('tDia').textContent = c.dia || '—';
  $('tMot').textContent = c.motorista || '—';
  $('tOS').textContent = c.os || '—';
  $('ticket').className = 'ticket ' + classe;
  if (classe === 'pronto') estado.exibido = c; else if (classe === 'vazio') estado.exibido = null;
  if (typeof atualizarBotaoImagem === 'function') atualizarBotaoImagem();
  if (classe !== 'girando') { ajustarNome(); ajustarUmaLinha($('tMot')); }
}

// O motorista fica sempre em uma linha (a letra diminui se for preciso), para a altura do bilhete não mudar.
function ajustarUmaLinha(el) {
  el.classList.remove('cortar');
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  let tam = base;
  while (tam > base * 0.55 && el.getBoundingClientRect().height > tam * 1.45) {
    tam -= 1;
    el.style.fontSize = tam + 'px';
  }
  // Caso extremo: ainda não coube em uma linha, corta com reticências (o nome completo fica no histórico).
  el.title = el.textContent;
  if (el.getBoundingClientRect().height > tam * 1.45) el.classList.add('cortar');
}

// Nomes longos encolhem até caber em, no máximo, duas linhas; a altura do cabeçalho do bilhete nunca muda.
function ajustarNome() {
  const el = $('tPass');
  el.style.fontSize = '';
  let tam = parseFloat(getComputedStyle(el).fontSize);
  while (tam > 24 && el.getBoundingClientRect().height > tam * 1.05 * 2 + 2) {
    tam -= 2;
    el.style.fontSize = tam + 'px';
  }
}

function sortear() {
  const eleg = corridasElegiveis();
  if (!eleg.length || estado.girando) return;

  const vencedora = eleg[inteiroAleatorio(eleg.length)]; // definida antes da animação
  estado.girando = true;
  $('btnSortear').disabled = true;
  $('btnAbrir').disabled = true;

  // Nada de nomes trocando na tela: o carro anda enquanto o resultado (já definido acima) é "buscado".
  preencherTicket({}, 'girando');
  const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => finalizar(vencedora), reduzir ? 0 : 3400);
}

async function finalizar(c) {
  preencherTicket(c, 'pronto');
  if (window.fundoAnimado) window.fundoAnimado.celebrar();
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    n: estado.historico.reduce((mx, h) => Math.max(mx, h.n), 0) + 1,
    quando: new Date().toISOString(),
    nomeSorteio: $('temaNome').value.trim(),
    arquivo: estado.abas ? estado.abas.arquivo : '',
    os: c.os, dia: c.dia, passageira: c.passageira, motorista: c.motorista,
  };
  estado.historico.unshift(item);
  selecionar(item.id, false);
  estado.girando = false;
  $('btnAbrir').disabled = false;
  atualizarResultados();
  atualizarElegiveis();
  // Salva no computador; o contato (telefone/e-mail) é buscado pelo sistema e não passa pela tela.
  try { await window.api.historicoAdicionar(item, contextoContato()); } catch (e) { mostrarErro('Não foi possível salvar o histórico: ' + e.message); }
}

function atualizarResultados() {
  const n = estado.historico.length;
  $('resumoSorteios').textContent = n === 0 ? 'Nenhum sorteio feito ainda.' : (n === 1 ? '1 sorteio salvo.' : `${n} sorteios salvos.`);
  $('btnExportar').disabled = n === 0;
  $('btnLimpar').disabled = n === 0;
  if (typeof renderHistorico === 'function') renderHistorico();
}

async function abrir() {
  mostrarErro('');
  const botao = $('btnAbrir');
  const r = await window.api.abrirPlanilha();
  if (!r) return;
  if (!r.ok) { mostrarErro(r.erro); return; }
  if (!r.nomesAbas.length) { mostrarErro('A planilha não tem nenhuma aba.'); return; }

  botao.disabled = true;
  estado.abas = r;
  preencherTicket({}, 'vazio');
  $('arquivoNome').textContent = r.arquivo;

  const selAba = $('selAba');
  selAba.innerHTML = '';
  r.nomesAbas.forEach((n) => selAba.add(new Option(n, n)));
  $('blocoColunas').hidden = false;
  $('blocoRegras').hidden = false;
  $('blocoResultados').hidden = false;
  try {
    await escolherAba(r.nomesAbas[0]);
  } finally {
    botao.disabled = false;
  }
}

$('btnAbrir').addEventListener('click', abrir);
$('btnSortear').addEventListener('click', sortear);
$('selAba').addEventListener('change', (e) => escolherAba(e.target.value));
$('inpTitulo').addEventListener('change', () => carregarTitulos(true));
['selOS', 'selDia', 'selPass', 'selMot', 'selTel', 'selFiltroCol'].forEach((id) => $(id).addEventListener('change', recarregarBase));
['selFiltroVal', 'optOS', 'optPass', 'optMot'].forEach((id) => $(id).addEventListener('change', atualizarElegiveis));

$('btnLimpar').addEventListener('click', async () => {
  if (!confirm('Apagar TODO o histórico de sorteios, inclusive os contatos guardados? Esta ação não pode ser desfeita. (Dica: use antes "Salvar em Excel".)')) return;
  await window.api.historicoLimpar();
  estado.historico = [];
  histEstado.selecionadoId = null;
  $('btnContato').disabled = true;
  preencherTicket({}, 'vazio');
  atualizarResultados();
  atualizarElegiveis();
});

$('btnExportar').addEventListener('click', async () => {
  // Telefone e e-mail são buscados só na hora de salvar e vão direto para o arquivo.
  const r = await window.api.exportarHistorico(contextoContato());
  if (r && r.ok) {
    $('resumoSorteios').textContent = 'Arquivo salvo.';
    setTimeout(atualizarResultados, 3000);
  } else if (r && r.ok === false && !r.cancelado) {
    mostrarErro('Não foi possível salvar: ' + r.erro);
  }
});

atualizarResultados();

// Painel de configurações: ocultar e mostrar.
function alternarPainel(ocultar) {
  $('app').classList.toggle('sem-lateral', ocultar);
}
$('btnOcultar').addEventListener('click', () => alternarPainel(true));
$('btnMostrar').addEventListener('click', () => alternarPainel(false));
