// Histórico de sorteios na tela e aba de contato da passageira sorteada.
// O histórico mostrado na tela NÃO tem telefone nem e-mail; eles só aparecem na aba "Contato", aberta por clique.
const histEstado = { selecionadoId: null, protegido: true };

const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const itemPorId = (id) => estado.historico.find((h) => h.id === id);

function celula(tr, texto, classe) {
  const td = document.createElement('td');
  if (classe) td.className = classe;
  td.textContent = texto;
  tr.appendChild(td);
  return td;
}

function linhaHistorico(h, completa) {
  const tr = document.createElement('tr');
  tr.className = 'clicavel' + (h.id === histEstado.selecionadoId ? ' selecionada' : '');
  tr.tabIndex = 0;
  tr.title = 'Mostrar este sorteio e abrir o contato';
  celula(tr, '#' + h.n, 'n');
  celula(tr, fmtDataHora(h.quando));
  celula(tr, h.passageira, 'forte');
  celula(tr, h.dia);
  celula(tr, h.motorista);
  celula(tr, h.os);
  if (completa) {
    const td = celula(tr, h.nomeSorteio || '—');
    if (h.arquivo) { const s = document.createElement('small'); s.textContent = h.arquivo; td.appendChild(s); }
  }
  const escolher = () => { selecionar(h.id, true); fecharHistorico(); };
  tr.addEventListener('click', escolher);
  tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(); } });
  return tr;
}

function renderHistorico() {
  if (!$('histOverlay').hidden) renderGaveta();
}

function renderGaveta() {
  const q = norm($('histBusca').value);
  const lista = estado.historico.filter((h) => !q || norm(h.passageira).includes(q) || norm(h.motorista).includes(q) || norm(h.os).includes(q));
  const corpo = $('histCorpo');
  corpo.innerHTML = '';
  lista.forEach((h) => corpo.appendChild(linhaHistorico(h, true)));
  $('histVazio').hidden = lista.length > 0;
  $('histContagem').textContent = `${lista.length} de ${estado.historico.length}`;
}

function abrirHistorico() {
  $('histBusca').value = '';
  $('histOverlay').hidden = false;
  renderGaveta();
  $('histBusca').focus();
}
function fecharHistorico() { $('histOverlay').hidden = true; }

// Seleciona o sorteio cujo contato a aba "Contato" vai mostrar.
function selecionar(id, mostrarNoBilhete) {
  histEstado.selecionadoId = id;
  const h = itemPorId(id);
  $('btnContato').disabled = !h;
  if (h && mostrarNoBilhete) preencherTicket(h, 'pronto');
  renderHistorico();
}

async function carregarHistorico() {
  try {
    const r = await window.api.historicoObter();
    estado.historico = r.itens.slice().sort((a, b) => b.n - a.n);
    histEstado.protegido = r.contatosProtegidos;
    $('avisoContato').hidden = r.contatosProtegidos;
  } catch { estado.historico = []; }
  atualizarResultados();
  atualizarElegiveis();
  renderHistorico();
}

// ---------- Aba de contato ----------
function contextoContato() {
  const m = mapaAtual();
  const linha = Math.max(1, parseInt($('inpTitulo').value, 10) || 1);
  return { aba: estado.aba, linha, colOS: m.os, colTel: m.tel, colEmail: m.email };
}

function fecharContato() {
  $('contatoOverlay').hidden = true;
  ['cNome', 'cTel', 'cEmail'].forEach((id) => { $(id).textContent = ''; }); // não deixa dados na tela
}

async function abrirContato() {
  const h = itemPorId(histEstado.selecionadoId);
  if (!h) return;
  let c = { telefone: '', email: '' };
  try { c = await window.api.contatoObter(h.id, contextoContato()); } catch { /* mostra "não encontrado" */ }
  $('cNome').textContent = h.passageira;
  $('cDetalhes').textContent = `O.S ${h.os} · corrida de ${h.dia} · motorista ${h.motorista}`;
  $('cTel').textContent = c.telefone || 'Não encontrado';
  $('cEmail').textContent = c.email || 'Não encontrado';
  $('cTel').classList.toggle('ausente', !c.telefone);
  $('cEmail').classList.toggle('ausente', !c.email);
  $('btnCopiarTel').disabled = !c.telefone;
  $('btnCopiarEmail').disabled = !c.email;
  $('cAjuda').hidden = !!(c.telefone && c.email);
  $('contatoOverlay').hidden = false;
  $('btnFecharContato').focus();
}

function copiar(idCampo, botao) {
  const valor = $(idCampo).textContent;
  window.api.copiar(valor).then(() => {
    const antes = botao.textContent;
    botao.textContent = 'Copiado!';
    setTimeout(() => { botao.textContent = antes; }, 1500);
  });
}

$('btnHistorico').addEventListener('click', abrirHistorico);
$('histFechar').addEventListener('click', fecharHistorico);
$('histOverlay').addEventListener('click', (e) => { if (e.target === $('histOverlay')) fecharHistorico(); });
$('histBusca').addEventListener('input', renderGaveta);
$('btnContato').addEventListener('click', abrirContato);
$('btnFecharContato').addEventListener('click', fecharContato);
$('contatoOverlay').addEventListener('click', (e) => { if (e.target === $('contatoOverlay')) fecharContato(); });
$('btnCopiarTel').addEventListener('click', (e) => copiar('cTel', e.currentTarget));
$('btnCopiarEmail').addEventListener('click', (e) => copiar('cEmail', e.currentTarget));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('contatoOverlay').hidden) fecharContato(); else if (!$('histOverlay').hidden) fecharHistorico();
});

carregarHistorico();
