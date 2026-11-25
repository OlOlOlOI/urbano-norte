// Gravação do sorteio em vídeo vertical (MP4, 1080x1920, 10 segundos) para Reels e Stories.
// O vídeo é desenhado em um canvas próprio: não depende do tamanho da janela, não grava a tela do computador
// (não pede permissão) e nunca leva telefone nem e-mail.
// Linha do tempo: 0-5 s o carro anda; 5 s o carro para e o resultado é revelado com confete; até 10 s o resultado fica na tela.
const cacheAnim = {};
const GRAV = { duracao: 10, revela: 5.0, fps: 30 };
let gravacao = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const suave = (x) => 1 - Math.pow(1 - clamp01(x), 3);

const CARRO = {
  corpo: new Path2D('M8 46 V37 Q8 32 14 30 L36 26 L52 11 Q55 8 60 8 H100 Q106 8 110 12 L126 27 L146 31 Q152 32 152 39 V46 Q152 50 148 50 H12 Q8 50 8 46 Z'),
  janela: new Path2D('M54 26 L63 14 H97 L111 26 Z'),
  hex: new Path2D('M80 32 L85 35 V41 L80 44 L75 41 V35 Z'),
};
const PREDIOS = [[6, 28, 30, 42], [40, 14, 26, 56], [70, 34, 34, 36], [148, 22, 28, 48], [180, 38, 30, 32], [214, 18, 34, 52]];
const JANELAS = [[46, 22], [56, 34], [14, 38], [120, 42], [156, 30], [222, 28], [232, 44], [188, 48]];

// Velocidade do carro (0 a 1,25): acelera, mantém e freia até parar na hora da revelação.
function velocidade(t) {
  if (t < 0.5) return suave(t / 0.5);
  if (t < 4.0) return 1 + 0.25 * clamp01((t - 0.5) / 3.5);
  if (t < GRAV.revela) return 1.25 * (1 - suave((t - 4.0) / (GRAV.revela - 4.0)));
  return 0;
}

function ajustarTextoVideo(g, texto, fonteFn, maxPx, minPx, larguraMax, maxLinhas) {
  let px = maxPx, linhas = [texto];
  for (; px >= minPx; px -= 4) { g.font = fonteFn(px); linhas = quebrarLinhas(g, texto, larguraMax); if (linhas.length <= maxLinhas) break; }
  return { px, linhas };
}

function criarGravacao(qualidade) {
  const W = 1080, H = 1920;
  const S = qualidade === 'leve' ? 2 / 3 : 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * S); cv.height = Math.round(H * S);
  const g = cv.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const cor = (n, pad) => cs.getPropertyValue(n).trim() || pad;
  const C = { verde: cor('--verde', '#00a651'), lima: cor('--lima', '#68c52f'), carvao: cor('--carvao', '#2b2a2c'), fundo: '#f1f4f1' };
  const fam = getComputedStyle(document.body).fontFamily;
  const fonte = (peso, px) => `${peso} ${px}px ${fam}`;
  return { W, H, S, cv, g, C, fam, fonte };
}

async function prepararGravacao(gr, d) {
  const { W, H, S, g, C, fonte } = gr;
  await document.fonts.ready;
  const copia = (fn) => { const c = document.createElement('canvas'); c.width = gr.cv.width; c.height = gr.cv.height; const x = c.getContext('2d'); x.setTransform(S, 0, 0, S, 0, 0); fn(x); return c; };

  gr.logo = await carregarImagem(window.logoEstatica ? window.logoEstatica() : $('logoMarca').src);
  // Respeita o que está escolhido em Personalização
  gr.modoFundo = $('temaFundo').value;
  gr.celebrar = $('temaCelebrar').checked;
  // Logo animada no topo: GIF do usuário ou a animação padrão da marca. Se não houver, usa a imagem parada.
  const tm = window.temaAtual ? window.temaAtual() : {};
  const chave = tm.logo ? 'custom:' + tm.logo.length : 'padrao';
  if (!cacheAnim[chave]) cacheAnim[chave] = { v: tm.logo ? await logoAnimada.deDataUrl(tm.logo) : await logoAnimada.padrao() };
  gr.anim = cacheAnim[chave].v;
  gr.nome = $('nomeSorteio').hidden ? '' : $('nomeSorteio').textContent.trim();
  gr.rotulo = $('rotuloBilhete').textContent;
  gr.cx = 60; gr.cw = 960; gr.hTopo = 400; gr.hPerf = 44; gr.hRodape = 96; gr.hCorpo = 380;
  gr.cy = gr.nome ? 640 : 560;
  gr.ch = gr.hTopo + gr.hPerf + gr.hCorpo + gr.hRodape;

  gr.fundoCache = copia((x) => desenharFundoStory(x, W, H));

  // Nome em até duas linhas e valores do bilhete
  const nomeAj = ajustarTextoVideo(g, d.passageira, (px) => fonte(800, px), 104, 50, gr.cw - 128, 2);
  gr.nomeLinhas = nomeAj.linhas; gr.nomePx = nomeAj.px;
  gr.info = [['Dia da corrida', d.dia], ['Motorista', d.motorista], ['Ordem de serviço', d.os]].map(([rot, val]) => {
    const largura = gr.cw - 400 - 64;
    let f = 56; g.font = fonte(700, f);
    while (g.measureText(val).width > largura && f > 40) { f -= 2; g.font = fonte(700, f); }
    const linhas = g.measureText(val).width <= largura ? [val] : quebrarLinhas(g, val, largura).slice(0, 2);
    return { rot, linhas, f };
  });

  // Camada fixa do bilhete (sombra, corpo branco, perfuração, rótulos e rodapé)
  gr.cartaBase = copia((x) => {
    const { cx, cy, cw, ch, hTopo, hPerf, hRodape } = gr;
    x.save();
    x.shadowColor = 'rgba(43,42,44,0.22)'; x.shadowBlur = 50 * S; x.shadowOffsetY = 18 * S;
    retanguloArredondado(x, cx, cy, cw, ch, 40); x.fillStyle = '#ffffff'; x.fill();
    x.restore();
    x.save();
    retanguloArredondado(x, cx, cy, cw, ch, 40); x.clip();
    const yp = cy + hTopo + hPerf / 2;
    x.strokeStyle = '#d6ddd7'; x.lineWidth = 4; x.setLineDash([16, 14]);
    x.beginPath(); x.moveTo(cx + 30, yp); x.lineTo(cx + cw - 30, yp); x.stroke(); x.setLineDash([]);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    gr.info.forEach((it, i) => { x.fillStyle = '#6a726c'; x.font = fonte(600, 34); x.fillText(it.rot, cx + 64, cy + hTopo + hPerf + 80 + i * 110); });
    x.fillStyle = '#eceeea'; x.fillRect(cx, cy + ch - hRodape, cw, 3);
    x.fillStyle = C.verde; x.font = fonte(700, 38); x.fillText('Orgulho de estar aqui.', cx + 64, cy + ch - hRodape / 2 + 14);
    x.restore();
    x.fillStyle = C.fundo;
    [cx, cx + cw].forEach((px) => { x.beginPath(); x.arc(px, yp, 22, 0, Math.PI * 2); x.fill(); });
  });

  // Estado da animação
  gr.hexes = Array.from({ length: 26 }, () => {
    const r = 40 + Math.random() * 150;
    return { x: Math.random() * W, y: Math.random() * H, r, vy: -(14 + Math.random() * 40) * (1 + (190 - r) / 220), balanco: 10 + Math.random() * 50, fase: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, cheio: Math.random() < 0.45, alfa: 0.07 + Math.random() * 0.13, lw: 2 + Math.random() * 3, cor: [C.verde, C.lima, C.verde, '#007a43'][Math.floor(Math.random() * 4)] };
  });
  gr.ambiente = Array.from({ length: 80 }, () => ({
    x: Math.random() * W, y: Math.random() * H, w: 16 + Math.random() * 16, h: 10 + Math.random() * 9, vy: 70 + Math.random() * 110,
    balanco: 20 + Math.random() * 60, fase: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 4,
    cor: [C.verde, C.lima, '#007a43', C.carvao][Math.floor(Math.random() * 4)], hex: Math.random() < 0.35, alfa: 0.35 + Math.random() * 0.35,
  }));
  gr.confete = [];
  gr.distCidade = 0; gr.distFaixa = 0; gr.rodaAng = 0; gr.ultimoT = 0; gr.rajada = false; gr.revelou = false;
}

function hexPath(g, x, y, r, rot) {
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = rot + (Math.PI / 3) * i; const px = x + r * Math.cos(a), py = y + r * Math.sin(a); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.closePath();
}
function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

function lancarConfete(gr) {
  const { W, H, C, cx, cy, cw, hTopo } = gr;
  const cores = [C.verde, C.lima, '#007a43', C.carvao, '#ffffff'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const criar = (x, y, ang, esp, n) => {
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-0.55, 0.55), v = rnd(esp * 0.45, esp);
      gr.confete.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(14, 28), h: rnd(9, 16), rot: rnd(0, 6.28), vr: rnd(-9, 9), vida: rnd(2.4, 4.2), cor: cores[Math.floor(Math.random() * cores.length)], hex: Math.random() < 0.4 });
    }
  };
  criar(cx + cw / 2, cy + hTopo * 0.6, -Math.PI / 2, 1500, 110);
  criar(0, H * 0.82, -Math.PI / 3, 1700, 60);
  criar(W, H * 0.82, (-2 * Math.PI) / 3, 1700, 60);
}

function desenharCenaCarro(gr, g, t, dt) {
  const { C, cw, hTopo } = gr;
  const m = velocidade(t);
  gr.distCidade += 130 * m * dt; gr.distFaixa += 560 * m * dt; gr.rodaAng += Math.PI * 2 * 1.0 * m * dt;
  const k = 2.2;
  g.save();
  const fundo = g.createLinearGradient(0, 0, 0, hTopo); fundo.addColorStop(0, C.carvao); fundo.addColorStop(1, '#38373b');
  g.fillStyle = fundo; g.fillRect(0, 0, cw, hTopo);
  // prédios (rolam devagar)
  const larguraTile = 260 * k, base = hTopo - 34 * k, ox0 = -(gr.distCidade % larguraTile);
  for (let ox = ox0 - larguraTile; ox < cw + larguraTile; ox += larguraTile) {
    g.fillStyle = '#3d3c40';
    PREDIOS.forEach(([x, y, w, h]) => g.fillRect(ox + x * k, base - 70 * k + y * k, w * k, h * k));
    g.beginPath(); [[112, 70], [112, 30], [126, 20], [140, 30], [140, 70]].forEach(([x, y], i) => { const px = ox + x * k, py = base - 70 * k + y * k; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill();
    g.fillStyle = rgba(C.lima, 0.55);
    JANELAS.forEach(([x, y]) => g.fillRect(ox + x * k, base - 70 * k + y * k, 4 * k, 4 * k));
  }
  // rua
  g.fillStyle = '#19191b'; g.fillRect(0, base, cw, hTopo - base);
  g.fillStyle = '#4a494d'; g.fillRect(0, base, cw, 3 * k);
  g.fillStyle = C.lima;
  const periodo = 56 * k, dash = 28 * k, oxF = -(gr.distFaixa % periodo);
  for (let x = oxF - periodo; x < cw + periodo; x += periodo) g.fillRect(x, base + 13 * k, dash, 4 * k);
  // carro
  const kc = 2.0625, carW = 160 * kc, carH = 66 * kc;
  const balanco = m > 0.05 ? Math.sin(t * 16) * 2.2 * m : 0;
  g.translate(cw / 2 - carW / 2, hTopo - 22 * k - carH + balanco);
  g.scale(kc, kc);
  g.fillStyle = C.verde; g.fill(CARRO.corpo);
  g.fillStyle = '#1d2630'; g.fill(CARRO.janela);
  g.strokeStyle = C.carvao; g.lineWidth = 3; g.beginPath(); g.moveTo(81, 14); g.lineTo(81, 26); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke(CARRO.hex);
  g.fillStyle = '#fff'; g.fillRect(144, 34, 8, 6); g.fillStyle = '#ffc400'; g.fillRect(8, 34, 6, 6);
  [38, 122].forEach((x) => {
    g.fillStyle = '#141416'; g.beginPath(); g.arc(x, 50, 11, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(x, 50); g.rotate(gr.rodaAng);
    g.fillStyle = '#d7ddd8'; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8d948f'; g.fillRect(-1.5, -9, 3, 18); g.fillRect(-9, -1.5, 18, 3);
    g.restore();
  });
  g.restore();
}

function desenharQuadro(gr, t) {
  const { W, H, S, g, C, fonte, cx, cy, cw, ch, hTopo, hPerf } = gr;
  const dt = Math.min(0.1, Math.max(0, t - gr.ultimoT)); gr.ultimoT = t;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(gr.fundoCache, 0, 0);
  g.setTransform(S, 0, 0, S, 0, 0);

  // animação de fundo escolhida em Personalização
  if (gr.modoFundo === 'confete') {
    for (const c of gr.ambiente) {
      c.y += c.vy * dt; c.rot += c.vr * dt;
      if (c.y > H + 40) { c.y = -30; c.x = Math.random() * W; }
      g.save(); g.translate(c.x + Math.sin(t * 0.8 + c.fase) * c.balanco, c.y); g.rotate(c.rot); g.globalAlpha = c.alfa; g.fillStyle = c.cor;
      if (c.hex) { hexPath(g, 0, 0, c.w * 0.6, 0); g.fill(); } else g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      g.restore();
    }
  }
  for (const p of (gr.modoFundo === 'hexagonos' ? gr.hexes : [])) {
    p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.y < -p.r * 1.3) { p.y = H + p.r * 1.3; p.x = Math.random() * W; }
    hexPath(g, p.x + Math.sin(t * 0.7 + p.fase) * p.balanco, p.y, p.r, p.rot);
    if (p.cheio) { g.fillStyle = rgba(p.cor, p.alfa * 0.8); g.fill(); }
    g.lineWidth = p.lw; g.strokeStyle = rgba(p.cor, Math.min(0.5, p.alfa * 1.9)); g.stroke();
  }

  // emblema e etiqueta
  if (gr.anim) {
    const q = logoAnimada.quadroEm(gr.anim, Math.max(0, t - 0.1));
    const h = 210, w = h * (q.width / q.height);
    g.drawImage(q, (W - w) / 2, 270, w, h);
  } else if (gr.logo) { const h = 210, w = h * (gr.logo.naturalWidth / gr.logo.naturalHeight); g.drawImage(gr.logo, (W - w) / 2, 270, w, h); }
  if (gr.nome) {
    g.font = fonte(800, 40);
    const bw = Math.min(g.measureText(gr.nome).width, 800) + 80, bx = (W - bw) / 2, y = 540;
    g.fillStyle = C.lima; g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw - 28, y); g.lineTo(bx + bw, y + 31); g.lineTo(bx + bw - 28, y + 62); g.lineTo(bx, y + 62); g.closePath(); g.fill();
    g.fillStyle = C.carvao; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(gr.nome, bx + 30, y + 33, 800);
  }

  // bilhete: camada fixa + cabeçalho animado
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(gr.cartaBase, 0, 0); g.setTransform(S, 0, 0, S, 0, 0);
  const p = t >= GRAV.revela ? 1 : 0; // corte seco: o carro some e o nome aparece, sem transição
  g.save();
  retanguloArredondado(g, cx, cy, cw, ch, 40); g.clip();
  g.fillStyle = C.carvao; g.fillRect(cx, cy, cw, hTopo);
  g.fillStyle = C.verde; g.fillRect(cx, cy, cw, 14);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  if (p > 0) {
    g.globalAlpha = p;
    g.fillStyle = C.lima; g.font = fonte(700, 40); g.fillText(gr.rotulo, cx + 64, cy + 100);
    const bloco = gr.nomeLinhas.length * gr.nomePx * 1.08;
    const topo = cy + 120 + (hTopo - 140 - bloco) / 2 + (1 - p) * 50;
    g.fillStyle = '#fff'; g.font = fonte(800, gr.nomePx);
    gr.nomeLinhas.forEach((l, i) => g.fillText(l, cx + 64, topo + gr.nomePx * 0.92 + i * gr.nomePx * 1.08));
    g.globalAlpha = 1;
  }
  if (p < 1) {
    g.save();
    g.translate(cx, cy + p * (hTopo + 20));
    g.beginPath(); g.rect(0, 0, cw, hTopo); g.clip();
    desenharCenaCarro(gr, g, t, dt);
    g.fillStyle = C.lima; g.font = fonte(800, 42); g.textBaseline = 'alphabetic';
    g.fillText('Sorteando' + '.'.repeat(1 + (Math.floor(t * 2.5) % 3)), 64, 74);
    g.restore();
  }
  g.restore();

  // valores do bilhete (aparecem um a um depois da revelação)
  gr.info.forEach((it, i) => {
    const yy = cy + hTopo + hPerf + 80 + i * 110;
    const a = t >= GRAV.revela ? 1 : 0;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    if (a < 1) { g.globalAlpha = 1 - a; g.fillStyle = '#b3bbb4'; g.font = fonte(700, 56); g.fillText('—', cx + 400, yy + 2); }
    if (a > 0) {
      g.globalAlpha = a; g.fillStyle = C.carvao; g.font = fonte(700, it.f);
      it.linhas.forEach((l, k) => g.fillText(l, cx + 400, yy + 2 - (it.linhas.length - 1) * 22 + k * 46 + (1 - a) * 18));
    }
    g.globalAlpha = 1;
  });

  // confete: rajada na revelação e garoa leve depois
  if (gr.celebrar && !gr.rajada && t >= GRAV.revela) { gr.rajada = true; lancarConfete(gr); }
  if (gr.celebrar && t > GRAV.revela + 0.8 && t < 8.6 && Math.random() < 0.6 * Math.min(1, dt * 30)) {
    gr.confete.push({ x: Math.random() * W, y: -30, vx: (Math.random() - 0.5) * 80, vy: 220 + Math.random() * 200, w: 14 + Math.random() * 12, h: 9 + Math.random() * 7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8, vida: 5, cor: [C.verde, C.lima, '#007a43', C.carvao][Math.floor(Math.random() * 4)], hex: Math.random() < 0.35 });
  }
  for (const c of gr.confete) {
    c.vy += 900 * dt; c.vx *= 1 - 0.9 * dt; c.vy *= 1 - 0.35 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.vida -= dt;
    g.save(); g.translate(c.x, c.y); g.rotate(c.rot); g.globalAlpha = Math.min(1, c.vida * 1.2); g.fillStyle = c.cor;
    if (c.hex) { hexPath(g, 0, 0, c.w * 0.6, 0); g.fill(); } else g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    g.restore();
  }
  gr.confete = gr.confete.filter((c) => c.vida > 0 && c.y < H + 60).slice(-600);
}

// Qualidades: o modo principal renderiza quadro a quadro (cada quadro no instante exato), então 60 fps saem cravados
// em qualquer computador; só demora mais para ficar pronto. O modo de reserva grava em tempo real (30 fps).
const QUALIDADES = {
  max60: { fps: 60, bitrate: 20_000_000 },
  alta30: { fps: 30, bitrate: 12_000_000 },
  leve: { fps: 30, bitrate: 6_000_000 },
};

function tipoDeVideo() {
  const opcoes = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opcoes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// Procura uma configuração de H.264 que este computador consiga codificar (do perfil mais alto para o mais simples).
async function escolherCodec(largura, altura, cfg) {
  if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  for (const codec of ['avc1.64002A', 'avc1.4D402A', 'avc1.42E034', 'avc1.42E02A']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: largura, height: altura, bitrate: cfg.bitrate, framerate: cfg.fps, latencyMode: 'quality', avc: { format: 'avc' } });
      if (s.supported) return s.config;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

const pausa = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Espera o relógio chegar ao instante do próximo quadro. Assim a prévia anda na velocidade real (10 s de verdade) e o
// codificador recebe os quadros num ritmo normal, em vez de uma enxurrada. O vídeo em si é sempre exato, qualquer que
// seja a velocidade do computador: o tempo de cada quadro vem do número dele, não do relógio.
async function aguardarRelogio(alvoMs, cancelado) {
  while (performance.now() < alvoMs - 1) {
    if (cancelado()) return;
    await (document.hidden ? pausa(4) : new Promise((r) => requestAnimationFrame(r)));
  }
}

async function renderizarOffline(gr, cfg, config, cancelado, ritmoReal) {
  const largura = gr.cv.width, altura = gr.cv.height;
  const alvo = new Mp4Muxer.ArrayBufferTarget();
  // Sem "frameRate" no montador: os tempos gravados são exatamente os de cada quadro.
  const muxer = new Mp4Muxer.Muxer({ target: alvo, video: { codec: 'avc', width: largura, height: altura }, fastStart: 'in-memory' });
  let erroEnc = null, saidas = 0;
  const enc = new VideoEncoder({ output: (chunk, meta) => { saidas++; muxer.addVideoChunk(chunk, meta); }, error: (e) => { erroEnc = e; } });
  enc.configure(config);
  const total = GRAV.duracao * cfg.fps;
  const dur = Math.round(1e6 / cfg.fps);
  const inicio = performance.now();
  for (let i = 0; i < total; i++) {
    if (ritmoReal) await aguardarRelogio(inicio + (i * 1000) / cfg.fps, cancelado);
    if (cancelado()) { try { enc.close(); } catch { /* ignora */ } return null; }
    if (erroEnc) throw erroEnc;
    desenharQuadro(gr, i / cfg.fps);
    const quadro = new VideoFrame(gr.cv, { timestamp: Math.round((i * 1e6) / cfg.fps), duration: dur });
    enc.encode(quadro, { keyFrame: i % (cfg.fps * 2) === 0 });
    quadro.close();
    while (enc.encodeQueueSize > 8) { if (erroEnc) throw erroEnc; await pausa(2); }
    if (i % 6 === 0) {
      $('gravStatus').textContent = `Gravando… ${Math.min(GRAV.duracao, Math.floor(i / cfg.fps) + 1)} de ${GRAV.duracao} s (${cfg.fps} fps)`;
      $('gravProgresso').style.width = Math.round((i / total) * 100) + '%';
      if (!ritmoReal) await pausa(0);
    }
  }
  $('gravStatus').textContent = 'Finalizando o vídeo…';
  await enc.flush();
  if (erroEnc) throw erroEnc;
  enc.close();
  muxer.finalize();
  const segundos = (performance.now() - inicio) / 1000;
  console.log(`Vídeo ${cfg.fps} fps: ${saidas}/${total} quadros codificados em ${segundos.toFixed(1)} s (${config.hardwareAcceleration || 'padrão'})`);
  return { bytes: new Uint8Array(alvo.buffer), saidas, total };
}

// Confere o arquivo pronto: todos os quadros presentes e duração de 10 s (lida do próprio MP4).
function duracaoDoMp4(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const el = document.createElement('video');
    const fim = (d) => { URL.revokeObjectURL(url); el.removeAttribute('src'); el.load(); resolve(d); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => fim(el.duration);
    el.onerror = () => fim(NaN);
    setTimeout(() => fim(NaN), 5000);
    el.src = url;
  });
}
async function videoConfere(res) {
  const d = await duracaoDoMp4(res.bytes);
  console.log(`Conferência: ${res.saidas}/${res.total} quadros, duração lida do arquivo: ${Number.isFinite(d) ? d.toFixed(2) : 'n/d'} s`);
  const duracaoOk = !Number.isFinite(d) || Math.abs(d - GRAV.duracao) <= 0.25; // se o player não informar, confia na contagem
  return res.saidas === res.total && duracaoOk;
}

// Reserva: grava em tempo real (30 fps) com o gravador do navegador.
async function gravarTempoReal(gr, mime, vencedora, cancelado) {
  const stream = gr.cv.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: gr.S === 1 ? 8_000_000 : 4_500_000 });
  const partes = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
  const parou = new Promise((res) => { rec.onstop = res; });
  desenharQuadro(gr, 0);
  rec.start(1000);
  const t0 = performance.now();
  await new Promise((fim) => {
    const laco = () => {
      const t = Math.min(GRAV.duracao, (performance.now() - t0) / 1000);
      if (cancelado()) { fim(); return; }
      desenharQuadro(gr, t);
      if (!gravacao.revelou && t >= GRAV.revela) { gravacao.revelou = true; finalizar(vencedora); }
      $('gravStatus').textContent = `Gravando… ${Math.min(GRAV.duracao, Math.ceil(t))} de ${GRAV.duracao} s`;
      $('gravProgresso').style.width = (t / GRAV.duracao) * 100 + '%';
      if (t >= GRAV.duracao) { fim(); return; }
      gravacao.raf = requestAnimationFrame(laco);
    };
    laco();
  });
  await pausa(160); // garante o último quadro
  rec.stop();
  await parou;
  stream.getTracks().forEach((tr) => tr.stop());
  if (cancelado()) return null;
  return new Uint8Array(await new Blob(partes, { type: mime }).arrayBuffer());
}

function encerrarGravacao(texto) {
  const r = gravacao;
  if (!r) return;
  gravacao = null;
  if (r.raf) cancelAnimationFrame(r.raf);
  $('gravacao').hidden = true;
  $('gravPalco').innerHTML = '';
  if (!r.revelou && estado.girando) { estado.girando = false; $('btnAbrir').disabled = false; atualizarElegiveis(); }
  if (texto) { $('resumoImagem').textContent = texto; setTimeout(() => { if ($('resumoImagem').textContent === texto) $('resumoImagem').textContent = ''; }, 6000); }
}

// Salva o vídeo pronto; se a janela de salvar for fechada, o vídeo fica guardado para tentar de novo.
let ultimoVideo = null;
async function salvarVideoPronto(video) {
  try {
    const r = await window.api.salvarVideo(video.bytes, video.nome, video.ext);
    if (r && r.ok) { ultimoVideo = null; $('btnSalvarVideoDeNovo').hidden = true; avisarSalvo('Vídeo', r.caminho); atualizarPasta(); return; }
    if (r && r.erro) mostrarErro(r.erro);
  } catch (e) { mostrarErro('Não foi possível salvar o vídeo: ' + e.message); }
  ultimoVideo = video;
  $('btnSalvarVideoDeNovo').hidden = false;
  $('resumoImagem').textContent = 'O vídeo está pronto, mas ainda não foi salvo.';
}

async function iniciarGravacao() {
  if (gravacao || estado.girando || $('btnSortear').disabled) {
    if (!gravacao) mostrarErro('Abra a planilha e escolha as colunas antes de gravar.');
    return;
  }
  const eleg = corridasElegiveis();
  if (!eleg.length) return;
  mostrarErro('');

  const qual = $('videoQualidade').value;
  const cfg = QUALIDADES[qual] || QUALIDADES.alta30;
  const gr = criarGravacao(qual);
  const config = await escolherCodec(gr.cv.width, gr.cv.height, cfg);
  const mime = config ? 'video/mp4' : tipoDeVideo();
  if (!mime) { mostrarErro('Este computador não consegue gravar vídeo.'); return; }

  // A pessoa sorteada é escolhida agora, antes da animação, com o mesmo sorteio do botão Sortear.
  const vencedora = eleg[inteiroAleatorio(eleg.length)];
  estado.girando = true;
  $('btnSortear').disabled = true;
  $('btnAbrir').disabled = true;
  gravacao = { revelou: false, raf: 0 };
  let cancelado = false;
  gravacao.cancelar = () => { cancelado = true; };
  try { await prepararGravacao(gr, vencedora); } catch (e) { encerrarGravacao(); mostrarErro('Não foi possível preparar o vídeo: ' + e.message); return; }

  $('gravPalco').appendChild(gr.cv);
  $('gravacao').hidden = false;
  $('gravStatus').textContent = config ? `Criando o vídeo (${cfg.fps} fps)…` : 'Gravando…';

  let bytes = null;
  try {
    if (config) {
      let res = await renderizarOffline(gr, cfg, { ...config, hardwareAcceleration: 'no-preference' }, () => cancelado, true);
      if (res && !cancelado && !(await videoConfere(res))) {
        // Alguns codificadores de placa de vídeo pulam quadros: refaz com o codificador de software, que não pula.
        $('gravStatus').textContent = 'Ajustando o vídeo…';
        await prepararGravacao(gr, vencedora);
        res = await renderizarOffline(gr, cfg, { ...config, hardwareAcceleration: 'prefer-software' }, () => cancelado, false);
        if (res && !cancelado && !(await videoConfere(res))) mostrarErro('Atenção: a duração do vídeo pode não ter ficado em 10 segundos neste computador.');
      }
      bytes = res ? res.bytes : null;
      if (bytes) { gravacao.revelou = true; finalizar(vencedora); } // a pessoa só entra no histórico com o vídeo pronto
    } else {
      bytes = await gravarTempoReal(gr, mime, vencedora, () => cancelado);
    }
  } catch (e) {
    encerrarGravacao();
    mostrarErro('Não foi possível criar o vídeo: ' + e.message);
    return;
  }
  if (!bytes || cancelado) { encerrarGravacao('Gravação cancelada.'); return; }

  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const t = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const nome = `sorteio-urbano-norte-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}.${ext}`;
  encerrarGravacao();
  await salvarVideoPronto({ bytes, nome, ext });
}

$('btnGravar').addEventListener('click', iniciarGravacao);
$('btnGravarBarra').addEventListener('click', iniciarGravacao);
$('btnSalvarVideoDeNovo').addEventListener('click', () => { if (ultimoVideo) salvarVideoPronto(ultimoVideo); });
$('gravCancelar').addEventListener('click', () => { if (gravacao && gravacao.cancelar) gravacao.cancelar(); });
document.addEventListener('keydown', (e) => {
  if (gravacao && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (gravacao.cancelar) gravacao.cancelar(); }
}, true);
// Os botões de gravar seguem o botão Sortear (precisa de planilha, colunas e corridas disponíveis).
setInterval(() => { const off = $('btnSortear').disabled || !!gravacao; $('btnGravar').disabled = off; $('btnGravarBarra').disabled = off; }, 400);
