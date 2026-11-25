'use strict';
const botoes = [...document.querySelectorAll('[role="tab"]')];

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
  const el = document.getElementById('contador-atendimento');
  el.textContent = atendimento > 99 ? '99+' : String(atendimento || '');
  el.classList.toggle('oculto', !atendimento);
  el.setAttribute('aria-label', atendimento ? `${atendimento} mensagens não lidas` : '');
});
window.shell.info().then(({ aba, versao }) => { marcar(aba); document.getElementById('versao').textContent = 'v' + versao; });
