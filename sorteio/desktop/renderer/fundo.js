// Animação de fundo: hexágonos flutuantes (padrão) ou confete, e uma chuva de confete ao sortear.
(function () {
  const canvas = $('fundoAnimado');
  const ctx = canvas.getContext('2d');
  const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let L = 0, A = 0, modo = 'hexagonos', celebrarAtivo = true;
  let particulas = [], rajada = [], paleta = { verde: '#00a651', lima: '#68c52f', escuro: '#007a43', carvao: '#2b2a2c' };
  let ultimo = 0;

  const aleat = (a, b) => a + Math.random() * (b - a);
  const escolher = (v) => v[Math.floor(Math.random() * v.length)];

  function lerPaleta() {
    const cs = getComputedStyle(document.documentElement);
    paleta = {
      verde: cs.getPropertyValue('--verde').trim() || '#00a651',
      lima: cs.getPropertyValue('--lima').trim() || '#68c52f',
      escuro: '#007a43',
      carvao: cs.getPropertyValue('--carvao').trim() || '#2b2a2c',
    };
  }

  function hexagono(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (Math.PI / 3) * i;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function novaParticula(aleatorioY) {
    if (modo === 'confete') {
      return {
        tipo: 'confete', x: aleat(0, L), y: aleatorioY ? aleat(0, A) : aleat(-40, -5), w: aleat(7, 14), h: aleat(4, 8),
        rot: aleat(0, 6.28), vr: aleat(-2.2, 2.2), vy: aleat(26, 62), balanco: aleat(10, 34), fase: aleat(0, 6.28),
        cor: escolher([paleta.verde, paleta.lima, paleta.escuro, paleta.carvao]), forma: Math.random() < 0.35 ? 'hex' : 'ret', alfa: aleat(0.35, 0.7),
      };
    }
    const r = aleat(16, 72);
    return {
      tipo: 'hex', x: aleat(0, L), y: aleatorioY ? aleat(0, A) : A + r + aleat(0, 60), r, vy: -aleat(7, 22) * (1 + (72 - r) / 90),
      balanco: aleat(6, 26), fase: aleat(0, 6.28), rot: aleat(0, 6.28), vr: aleat(-0.25, 0.25),
      cor: escolher([paleta.verde, paleta.lima, paleta.verde, paleta.escuro]), cheio: Math.random() < 0.45, alfa: aleat(0.07, 0.2), lw: aleat(1.4, 3),
    };
  }

  function popular() {
    particulas = [];
    if (modo === 'nenhum' || reduzir) return;
    const n = modo === 'confete' ? Math.round(Math.min(70, Math.max(24, (L * A) / 26000))) : Math.round(Math.min(34, Math.max(14, (L * A) / 40000)));
    for (let i = 0; i < n; i++) particulas.push(novaParticula(true));
  }

  function redimensionar() {
    const r = canvas.parentElement.getBoundingClientRect();
    L = r.width; A = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(L * dpr); canvas.height = Math.round(A * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    popular();
  }

  function atualizar(dt, t) {
    for (const p of particulas) {
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.xDes = Math.sin(t * 0.0006 + p.fase) * p.balanco;
      if (p.tipo === 'hex' && p.y < -p.r * 1.2) Object.assign(p, novaParticula(false));
      if (p.tipo === 'confete' && p.y > A + 20) Object.assign(p, novaParticula(false));
    }
    for (const p of rajada) {
      p.vy += 520 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.vida -= dt;
    }
    rajada = rajada.filter((p) => p.vida > 0 && p.y < A + 40);
  }

  function desenhar(t) {
    ctx.clearRect(0, 0, L, A);
    if (modo === 'hexagonos' && !reduzir) {
      const brilho = 0.07 + 0.03 * Math.sin(t * 0.0009);
      const g = ctx.createRadialGradient(L / 2, A * 0.45, 20, L / 2, A * 0.45, Math.max(L, A) * 0.55);
      g.addColorStop(0, hexAlfa(paleta.lima, brilho)); g.addColorStop(1, hexAlfa(paleta.lima, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, L, A);
    }
    for (const p of particulas) {
      const x = p.x + (p.xDes || 0);
      if (p.tipo === 'hex') {
        hexagono(x, p.y, p.r, p.rot);
        if (p.cheio) { ctx.fillStyle = hexAlfa(p.cor, p.alfa * 0.8); ctx.fill(); }
        ctx.lineWidth = p.lw; ctx.strokeStyle = hexAlfa(p.cor, Math.min(0.5, p.alfa * 1.9)); ctx.stroke();
      } else {
        desenharPeca(x, p.y, p.w, p.h, p.rot, p.cor, p.alfa, p.forma);
      }
    }
    for (const p of rajada) desenharPeca(p.x, p.y, p.w, p.h, p.rot, p.cor, Math.min(1, p.vida * 1.2), p.forma);
  }

  function desenharPeca(x, y, w, h, rot, cor, alfa, forma) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alfa; ctx.fillStyle = cor;
    if (forma === 'hex') { hexagono(0, 0, w * 0.6, 0); ctx.fill(); } else { ctx.fillRect(-w / 2, -h / 2, w, h); }
    ctx.restore();
  }

  function hexAlfa(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function quadro(t) {
    requestAnimationFrame(quadro);
    if (document.hidden) { ultimo = t; return; }
    const dt = Math.min(0.05, (t - ultimo) / 1000 || 0);
    ultimo = t;
    if (!particulas.length && !rajada.length) { if (canvas.dataset.limpo !== '1') { ctx.clearRect(0, 0, L, A); canvas.dataset.limpo = '1'; } return; }
    canvas.dataset.limpo = '0';
    atualizar(dt, t);
    desenhar(t);
  }

  function celebrar() {
    if (!celebrarAtivo || reduzir) return;
    const cr = canvas.getBoundingClientRect();
    const tk = $('ticket').getBoundingClientRect();
    const cx = tk.left + tk.width / 2 - cr.left, cy = tk.top + tk.height * 0.3 - cr.top;
    const cores = [paleta.verde, paleta.lima, paleta.escuro, paleta.carvao, '#ffffff'];
    const criar = (x, y, ang, esp, n) => {
      for (let i = 0; i < n; i++) {
        const a = ang + aleat(-0.55, 0.55), v = aleat(esp * 0.45, esp);
        rajada.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: aleat(8, 15), h: aleat(5, 9), rot: aleat(0, 6.28), vr: aleat(-9, 9), vida: aleat(1.8, 3.2), cor: escolher(cores), forma: Math.random() < 0.4 ? 'hex' : 'ret' });
      }
    };
    criar(cx, cy, -Math.PI / 2, 760, 90);
    criar(0, A * 0.85, -Math.PI / 3, 900, 50);
    criar(L, A * 0.85, (-2 * Math.PI) / 3, 900, 50);
  }

  window.fundoAnimado = {
    definir(novoModo, celebrarOn) {
      lerPaleta();
      const mudou = novoModo !== modo;
      modo = ['hexagonos', 'confete', 'nenhum'].includes(novoModo) ? novoModo : 'hexagonos';
      celebrarAtivo = celebrarOn !== false;
      if (mudou || !particulas.length) popular();
    },
    celebrar,
  };

  window.addEventListener('resize', redimensionar);
  new ResizeObserver(redimensionar).observe(canvas.parentElement);
  lerPaleta();
  redimensionar();
  requestAnimationFrame(quadro);
})();
