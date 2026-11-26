'use strict';
const $ = (s) => document.querySelector(s);
const botoes = [...document.querySelectorAll('[role="tab"]')];
const PAINEIS = { login: $('#painel-login'), equipe: $('#painel-equipe'), senha: $('#painel-senha') };
let conta = { logado: false, usuario: null };

/** As chamadas de conta voltam { ok, dados, erro }; devolve os dados ou lança o erro. */
async function chamar(p) {
  const r = await p;
  if (!r || !r.ok) throw new Error((r && r.erro) || 'Algo deu errado.');
  return r.dados;
}

// ---------- abas ----------
function marcar(aba) {
  for (const b of botoes) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
}
for (const b of botoes) b.addEventListener('click', () => window.shell.trocar(b.dataset.aba));

// setas esquerda/direita andam entre as abas (padrão de acessibilidade para tablist)
document.querySelector('nav').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = botoes.indexOf(document.activeElement);
  if (i < 0) return;
  const prox = botoes[(i + (e.key === 'ArrowRight' ? 1 : botoes.length - 1)) % botoes.length];
  prox.focus();
});

window.shell.aoMudarAba(marcar);
window.shell.aoContador(({ atendimento }) => {
  const el = $('#contador-atendimento');
  el.textContent = atendimento > 99 ? '99+' : String(atendimento || '');
  el.classList.toggle('oculto', !atendimento);
  el.setAttribute('aria-label', atendimento ? `${atendimento} mensagens não lidas` : '');
});

// ---------- conta na barra ----------
function mostrarConta(e) {
  conta = e || { logado: false };
  const btn = $('#btn-conta');
  btn.classList.toggle('oculto', !conta.logado);
  if (conta.logado) {
    $('#conta-nome').textContent = conta.usuario.nome.split(' ')[0];
    $('#conta-inicial').textContent = (conta.usuario.nome.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    btn.setAttribute('aria-label', `Conta de ${conta.usuario.nome}: equipe, senha, sair`);
  }
}
$('#btn-conta').addEventListener('click', () => window.shell.conta.menu());
window.shell.aoConta(mostrarConta);

// ---------- painéis (login, equipe, senha) ----------
function mostrarPainel(nome) {
  for (const [k, el] of Object.entries(PAINEIS)) el.classList.toggle('oculto', k !== nome);
  document.body.classList.toggle('com-painel', Boolean(nome));
  document.body.classList.toggle('sem-barra', nome === 'login');
  if (nome === 'login') prepararLogin();
  if (nome === 'equipe') carregarEquipe();
  if (nome === 'senha') { $('#form-senha').reset(); $('#senha-erro').textContent = ''; $('#senha-atual').focus(); }
}
window.shell.aoPainel(mostrarPainel);
for (const b of document.querySelectorAll('.btn-voltar')) b.addEventListener('click', () => window.shell.conta.painel(null));

async function ocupado(botao, texto, fn) {
  const antes = botao.textContent;
  botao.disabled = true; botao.textContent = texto;
  try { return await fn(); } finally { botao.disabled = false; botao.textContent = antes; }
}

// ---------- login ----------
async function prepararLogin() {
  $('#entrar-erro').textContent = ''; $('#admin-erro').textContent = '';
  $('#login-sem-conexao').classList.add('oculto');
  let situacao;
  try { situacao = await chamar(window.shell.conta.situacao()); } catch (e) {
    $('#login-sem-conexao-texto').textContent = `${e.message} É preciso internet para entrar pela primeira vez.`;
    $('#login-sem-conexao').classList.remove('oculto');
    $('#form-entrar').classList.add('oculto'); $('#form-admin').classList.add('oculto');
    return;
  }
  const primeiro = !situacao.temContas;
  $('#form-entrar').classList.toggle('oculto', primeiro);
  $('#form-admin').classList.toggle('oculto', !primeiro);
  $('#login-titulo').textContent = primeiro ? 'Primeiro acesso' : 'Entrar';
  $('#login-apoio').classList.toggle('oculto', primeiro);
  (primeiro ? $('#admin-chave') : ($('#entrar-usuario').value ? $('#entrar-senha') : $('#entrar-usuario'))).focus();
}
$('#btn-tentar').addEventListener('click', prepararLogin);

$('#form-entrar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#entrar-erro');
  erro.textContent = '';
  try {
    await ocupado(ev.submitter || $('#form-entrar button[type=submit]'), 'Entrando…', () =>
      chamar(window.shell.conta.entrar({ usuario: $('#entrar-usuario').value, senha: $('#entrar-senha').value })));
    $('#entrar-senha').value = '';
  } catch (e) {
    erro.textContent = e.message;
    $('#entrar-senha').select();
  }
});

$('#form-admin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#admin-erro');
  erro.textContent = '';
  if ($('#admin-senha').value !== $('#admin-senha2').value) { erro.textContent = 'As duas senhas não são iguais.'; $('#admin-senha2').focus(); return; }
  try {
    await ocupado(ev.submitter || $('#form-admin button[type=submit]'), 'Criando…', () => chamar(window.shell.conta.primeiroAdmin({
      chave: $('#admin-chave').value, nome: $('#admin-nome').value, usuario: $('#admin-usuario').value, senha: $('#admin-senha').value,
    })));
    $('#form-admin').reset();
  } catch (e) { erro.textContent = e.message; }
});

// ---------- trocar a própria senha ----------
$('#form-senha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#senha-erro');
  erro.textContent = '';
  if ($('#senha-nova').value !== $('#senha-nova2').value) { erro.textContent = 'As duas senhas novas não são iguais.'; return; }
  try {
    await ocupado(ev.submitter || $('#form-senha button[type=submit]'), 'Trocando…', () =>
      chamar(window.shell.conta.senha({ atual: $('#senha-atual').value, nova: $('#senha-nova').value })));
    $('#form-senha').reset();
    await window.shell.conta.painel(null);
  } catch (e) { erro.textContent = e.message; }
});

// ---------- equipe ----------
const PAPEL = { admin: 'Administrador', atendente: 'Atendente' };
const dataHora = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Nunca entrou');
function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') e.addEventListener('click', v); else if (v !== null && v !== undefined) e.setAttribute(k, v); }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}
/** Senha provisória fácil de ditar: 3 sílabas + 4 números (ex.: bapeti-4821). */
function gerarSenha() {
  const c = 'bcdfghjlmnprstv', v = 'aeiou';
  const n = new Uint32Array(8); crypto.getRandomValues(n);
  let s = '';
  for (let i = 0; i < 3; i++) s += c[n[i] % c.length] + v[n[i + 3] % v.length];
  return `${s}-${String(n[6] % 10000).padStart(4, '0')}`;
}
function avisoEquipe(texto) {
  const a = $('#equipe-aviso');
  a.textContent = texto;
  a.classList.toggle('oculto', !texto);
}

async function carregarEquipe() {
  const corpo = $('#equipe-lista');
  let lista;
  try { lista = await chamar(window.shell.conta.equipe.listar()); } catch (e) {
    corpo.replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'erro-campo' }, e.message)));
    return;
  }
  corpo.replaceChildren(...lista.map((u) => {
    const eu = conta.usuario && u.id === conta.usuario.id;
    const alterar = async (botao, mudanca, ok) => {
      try {
        await ocupado(botao, '…', () => chamar(window.shell.conta.equipe.alterar({ id: u.id, ...mudanca })));
        avisoEquipe(ok); await carregarEquipe();
      } catch (e) { avisoEquipe(''); alert(e.message); } // eslint-disable-line no-alert
    };
    return el('tr', { class: u.ativo ? null : 'inativo' },
      el('td', {}, u.nome, eu ? el('span', { class: 'selo' }, 'você') : null),
      el('td', {}, u.usuario),
      el('td', {}, PAPEL[u.papel] || u.papel),
      el('td', {}, u.ativo ? 'Ativa' : 'Desativada'),
      el('td', {}, dataHora(u.ultimo_acesso)),
      el('td', { class: 'acoes-linha' },
        el('button', { type: 'button', class: 'btn mini', onclick: () => pedirSenha(u) }, 'Nova senha'),
        eu ? null : el('button', { type: 'button', class: 'btn mini', onclick: (ev) => alterar(ev.currentTarget, { papel: u.papel === 'admin' ? 'atendente' : 'admin' },
          `${u.nome} agora é ${u.papel === 'admin' ? 'atendente' : 'administrador'}.`) }, u.papel === 'admin' ? 'Tornar atendente' : 'Tornar admin'),
        eu ? null : el('button', { type: 'button', class: `btn mini ${u.ativo ? 'perigo' : ''}`, onclick: (ev) => {
          if (u.ativo && !confirm(`Desativar ${u.nome}? A pessoa sai na hora de todos os computadores.`)) return; // eslint-disable-line no-alert
          alterar(ev.currentTarget, { ativo: !u.ativo }, u.ativo ? `${u.nome} foi desativado(a).` : `${u.nome} pode entrar de novo.`);
        } }, u.ativo ? 'Desativar' : 'Reativar')));
  }));
}

$('#btn-gerar').addEventListener('click', () => { $('#novo-senha').value = gerarSenha(); });
$('#form-novo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#novo-erro');
  erro.textContent = '';
  const dados = { nome: $('#novo-nome').value, usuario: $('#novo-usuario').value.trim().toLowerCase(), senha: $('#novo-senha').value, papel: $('#novo-papel').value };
  try {
    const u = await ocupado(ev.submitter || $('#form-novo button[type=submit]'), 'Adicionando…', () => chamar(window.shell.conta.equipe.criar(dados)));
    $('#form-novo').reset();
    avisoEquipe(`Conta criada. Passe para ${u.nome} (pessoalmente ou por mensagem privada): usuário "${u.usuario}" e senha "${dados.senha}". Depois ela pode trocar a senha no menu com o nome dela.`);
    await carregarEquipe();
  } catch (e) { erro.textContent = e.message; }
});

// nova senha para alguém (esqueceu ou ficou bloqueado)
let senhaDe = null;
function pedirSenha(u) {
  senhaDe = u;
  $('#dlg-senha-apoio').textContent = `Para ${u.nome} (${u.usuario}). A pessoa sai dos computadores em que estava e entra com esta senha.`;
  $('#dlg-senha-valor').value = gerarSenha();
  $('#dlg-senha-erro').textContent = '';
  $('#dlg-senha').showModal();
  $('#dlg-senha-valor').select();
}
$('#dlg-gerar').addEventListener('click', () => { $('#dlg-senha-valor').value = gerarSenha(); });
$('#dlg-cancelar').addEventListener('click', () => $('#dlg-senha').close());
$('#form-dlg-senha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const senha = $('#dlg-senha-valor').value;
  try {
    await chamar(window.shell.conta.equipe.alterar({ id: senhaDe.id, senha }));
    $('#dlg-senha').close();
    avisoEquipe(`Senha de ${senhaDe.nome} trocada para "${senha}". Passe para a pessoa por um canal privado.`);
    await carregarEquipe();
  } catch (e) { $('#dlg-senha-erro').textContent = e.message; }
});

// ---------- atualização (só no Windows instalado) ----------
function mostrarAtualizacao(a) {
  const b = $('#btn-atualizacao');
  if (!a) return;
  const texto = a.fase === 'baixando' ? `Baixando versão ${a.versao}… ${a.progresso}%`
    : a.fase === 'pronta' ? `Versão ${a.versao} pronta · reiniciar`
      : a.fase === 'erro' ? 'Atualização com erro' : '';
  b.textContent = texto;
  b.title = a.fase === 'erro' ? `${a.erro}\nO app tenta de novo a cada hora (ou: menu com o seu nome → Procurar atualização agora).` : a.fase === 'pronta' ? 'Clique para reiniciar e instalar agora.' : '';
  b.disabled = a.fase !== 'pronta';
  b.className = `atualizacao ${a.fase}${texto ? '' : ' oculto'}`;
}
$('#btn-atualizacao').addEventListener('click', () => window.shell.instalarAtualizacao());
window.shell.aoAtualizacao(mostrarAtualizacao);

// ---------- início ----------
window.shell.info().then(({ aba, versao, conta: c, painel, atualizacao }) => {
  marcar(aba);
  $('#versao').textContent = 'v' + versao;
  $('#login-versao').textContent = `Versão ${versao}`;
  mostrarConta(c);
  mostrarPainel(painel);
  mostrarAtualizacao(atualizacao);
});
