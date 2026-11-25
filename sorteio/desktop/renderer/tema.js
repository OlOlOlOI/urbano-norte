// Personalização visual: cores da marca, logo, nome do sorteio e animação de abertura.
(function () {
  const PADRAO = { rotulo: 'Pessoa sorteada', nome: '', corBotao: '#00a651', corDestaque: '#68c52f', corEscuro: '#2b2a2c', abertura: true, fundo: 'hexagonos', celebrar: true, logo: null, logoPoster: null };
  const EMBLEMA = 'assets/emblema.png';
  let tema = { ...PADRAO };

  const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const luminancia = (h) => {
    const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const escurecer = (h, f) => '#' + hex2rgb(h).map((v) => Math.round(v * (1 - f)).toString(16).padStart(2, '0')).join('');
  const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  function aplicar() {
    const raiz = document.documentElement.style;
    raiz.setProperty('--verde', tema.corBotao);
    raiz.setProperty('--sombra-botao', escurecer(tema.corBotao, 0.28));
    // Texto branco no botão (padrão da marca), salvo se o contraste ficar muito baixo.
    raiz.setProperty('--sobre-botao', contraste('#ffffff', tema.corBotao) >= 3 ? '#ffffff' : tema.corEscuro);
    raiz.setProperty('--lima', tema.corDestaque);
    raiz.setProperty('--carvao', tema.corEscuro);

    // Na tela, a logo escolhida é exibida como está (GIF animado continua tocando). O quadro completo e sem fundo
    // (logoPoster) só é usado onde precisa de imagem parada: imagem dos Stories e vídeo.
    const logo = tema.logo || EMBLEMA;
    ['logoMarca', 'logoBilhete', 'logoVertical'].forEach((id) => {
      if ($(id).getAttribute('src') !== logo) $(id).src = logo; // não reinicia o GIF a cada ajuste de cor ou de texto
      $(id).classList.toggle('logo-personalizada', !!tema.logo);
    });

    const nome = $('nomeSorteio');
    nome.textContent = tema.nome;
    nome.hidden = !tema.nome.trim();
    $('rotuloBilhete').textContent = tema.rotulo.trim() || PADRAO.rotulo;
    if (window.fundoAnimado) window.fundoAnimado.definir(tema.fundo, tema.celebrar);
  }

  let temporizador = null;
  function guardar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => window.api.temaSalvar(tema).catch(() => {}), 350);
  }

  function preencherControles() {
    $('temaNome').value = tema.nome;
    $('temaRotulo').value = tema.rotulo;
    $('corBotao').value = tema.corBotao;
    $('corDestaque').value = tema.corDestaque;
    $('corEscuro').value = tema.corEscuro;
    $('temaAbertura').checked = tema.abertura;
    $('temaFundo').value = tema.fundo;
    $('temaCelebrar').checked = tema.celebrar;
  }

  function alterar(parte) { tema = { ...tema, ...parte }; aplicar(); guardar(); }

  // ---------- Animação de abertura ----------
  function mostrarAbertura() {
    const el = $('abertura');
    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!tema.abertura || reduzir) { el.hidden = true; return; }
    const img = $('aberturaImg');
    const animada = !tema.logo || logoAnimada.ehGif(tema.logo);
    img.src = tema.logo ? tema.logo : 'assets/abertura.webp'; // a animação toca e some
    let fechado = false;
    const fechar = () => {
      if (fechado) return;
      fechado = true;
      el.classList.add('saindo');
      setTimeout(() => { el.hidden = true; }, 550);
    };
    el.addEventListener('click', fechar);
    document.addEventListener('keydown', fechar, { once: true });
    setTimeout(() => el.classList.add('com-frase'), animada ? 1500 : 500);
    setTimeout(fechar, animada ? 4700 : 2400);
  }

  async function iniciar() {
    try { tema = { ...PADRAO, ...(await window.api.temaObter()) }; } catch { /* usa o padrão */ }
    aplicar();
    preencherControles();
    mostrarAbertura();
    // Logo GIF salva por uma versão anterior, ainda sem o quadro completo: gera agora.
    if (tema.logo && logoAnimada.ehGif(tema.logo) && !tema.logoPoster) {
      const info = await logoAnimada.deDataUrl(tema.logo);
      if (info) alterar({ logoPoster: info.poster });
    }
  }

  $('temaRotulo').addEventListener('input', (e) => alterar({ rotulo: e.target.value.slice(0, 40) }));
  $('temaNome').addEventListener('input', (e) => alterar({ nome: e.target.value.slice(0, 60) }));
  $('corBotao').addEventListener('input', (e) => alterar({ corBotao: e.target.value }));
  $('corDestaque').addEventListener('input', (e) => alterar({ corDestaque: e.target.value }));
  $('corEscuro').addEventListener('input', (e) => alterar({ corEscuro: e.target.value }));
  $('temaAbertura').addEventListener('change', (e) => alterar({ abertura: e.target.checked }));
  $('temaFundo').addEventListener('change', (e) => alterar({ fundo: e.target.value }));
  $('temaCelebrar').addEventListener('change', (e) => alterar({ celebrar: e.target.checked }));
  $('btnCoresMarca').addEventListener('click', () => {
    alterar({ corBotao: PADRAO.corBotao, corDestaque: PADRAO.corDestaque, corEscuro: PADRAO.corEscuro });
    preencherControles();
  });
  $('btnLogo').addEventListener('click', async () => {
    const r = await window.api.temaEscolherLogo();
    if (!r) return;
    if (r.erro) { mostrarErro(r.erro); return; }
    const info = await logoAnimada.deDataUrl(r.dataUrl); // só para GIF: gera o quadro completo sem fundo
    alterar({ logo: r.dataUrl, logoPoster: info ? info.poster : null });
  });
  $('btnLogoPadrao').addEventListener('click', () => alterar({ logo: null, logoPoster: null }));

  window.temaAtual = () => tema;
  window.logoEstatica = () => tema.logoPoster || tema.logo || EMBLEMA;
  iniciar();
})();
