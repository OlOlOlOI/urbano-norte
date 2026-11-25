// Modo celular: tela única do sorteio, barra de navegação embaixo e ajustes em tela separada.
(() => {
  const el = (id) => document.getElementById(id);
  const app = el('app');
  const consulta = '(max-width: 760px), (pointer: coarse) and (max-width: 900px)';
  const mq = matchMedia(consulta);
  const marcar = (aba) => document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));

  function abrirAjustes() { app.classList.add('ajustes-abertos'); marcar('ajustes'); el('painel').scrollTop = 0; }
  function fecharAjustes() { app.classList.remove('ajustes-abertos'); marcar('sorteio'); }

  document.querySelectorAll('#abas button').forEach((b) => b.addEventListener('click', () => {
    const aba = b.dataset.aba;
    if (aba === 'ajustes') { if (app.classList.contains('ajustes-abertos')) fecharAjustes(); else abrirAjustes(); return; }
    fecharAjustes();
    if (aba === 'historico') el('btnHistorico').click();
    if (aba === 'contato') el('btnContato').click();
  }));
  el('btnIrSorteio').addEventListener('click', fecharAjustes);
  el('btnOcultar').addEventListener('click', () => { if (mq.matches) fecharAjustes(); });

  // Estado vazio: botão grande para escolher a planilha
  el('btnEscolherM').addEventListener('click', () => el('btnAbrir').click());
  const api = window.api;
  const abrirOriginal = api.abrirPlanilha;
  api.abrirPlanilha = async function () {
    const r = await abrirOriginal.apply(this, arguments);
    if (r && r.ok) { app.classList.add('com-planilha'); if (mq.matches) fecharAjustes(); }
    return r;
  };

  // Resumo acima do bilhete (arquivo + quantidade de corridas)
  const resumo = () => {
    const nome = el('arquivoNome').textContent, info = el('infoElegiveis').textContent;
    const ok = app.classList.contains('com-planilha') && info;
    el('infoMobile').hidden = !ok;
    if (ok) el('infoMobile').textContent = info;
  };
  new MutationObserver(resumo).observe(el('infoElegiveis'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(resumo).observe(app, { attributes: true, attributeFilter: ['class'] });

  // Botões de vídeo e imagem do bilhete seguem os da barra lateral
  el('btnGravarM').addEventListener('click', () => el('btnGravar').click());
  el('btnImagemM').addEventListener('click', () => el('btnImagem').click());
  setInterval(() => {
    el('btnGravarM').disabled = el('btnGravar').disabled;
    el('btnImagemM').disabled = el('btnImagem').disabled;
    el('abas').querySelector('[data-aba="contato"]').disabled = el('btnContato').disabled;
  }, 300);

  // Vídeo guardado e ainda não salvo: botão na tela do sorteio
  const pend = el('btnVideoPendenteM');
  pend.addEventListener('click', () => el('btnSalvarVideoDeNovo').click());
  setInterval(() => { pend.hidden = el('btnSalvarVideoDeNovo').hidden; }, 300);

  // Durante a gravação, a faixa fora da página também fica clara
  const grav = el('gravacao');
  new MutationObserver(() => document.documentElement.classList.toggle('gravando', !grav.hidden)).observe(grav, { attributes: true, attributeFilter: ['hidden'] });

  // Janelas acompanham a área visível (o teclado do iPhone não encolhe a página, só a "área visível")
  const vv = window.visualViewport;
  const raiz = document.documentElement.style;
  const ajustarVisivel = () => {
    if (!vv) return;
    raiz.setProperty('--vvh', vv.height + 'px');
    raiz.setProperty('--vvt', vv.offsetTop + 'px');
    // altura que o teclado cobre embaixo (0 quando fechado)
    raiz.setProperty('--vvb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
  };
  if (vv) { vv.addEventListener('resize', ajustarVisivel); vv.addEventListener('scroll', ajustarVisivel); ajustarVisivel(); }

  // Ajustes em sanfona: toque no título abre e fecha cada bloco
  const secoes = [...document.querySelectorAll('#painel > section')];
  secoes.forEach((sec) => {
    const h = sec.querySelector('h2');
    if (!h) return;
    h.addEventListener('click', () => { if (mq.matches) sec.classList.toggle('fechada'); });
  });
  ['blocoVertical', 'blocoTema', 'blocoApp'].forEach((id) => { const s = el(id); if (s) s.classList.add('fechada'); });
})();
