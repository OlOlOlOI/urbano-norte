// Formato vertical (9:16) para Reels e Stories: tela própria para gravar + imagem do resultado em 1080x1920.
// Telefone e e-mail nunca entram nesta tela nem na imagem.
const verticalAtivo = () => $('app').classList.contains('vertical');

function atualizarBotaoImagem() {
  $('btnImagem').disabled = !estado.exibido;
  $('btnImagemBarra').disabled = !estado.exibido;
}

async function alternarVertical(ativo) {
  $('app').classList.toggle('vertical', ativo);
  if (ativo) fecharContato();
  try { await window.api.janelaVertical(ativo); } catch { /* segue sem redimensionar */ }
  if (ativo) mostrarBarraVertical();
}

let relogioBarra = null;
function mostrarBarraVertical() {
  const b = $('barraVertical');
  b.classList.add('ativa');
  clearTimeout(relogioBarra);
  relogioBarra = setTimeout(() => b.classList.remove('ativa'), 2600);
}

// ---------- Imagem do resultado (PNG 1080x1920) ----------
function quebrarLinhas(g, texto, larguraMax) {
  const palavras = texto.split(' ');
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const teste = atual ? atual + ' ' + p : p;
    if (g.measureText(teste).width <= larguraMax || !atual) atual = teste; else { linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function carregarImagem(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

function retanguloArredondado(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function desenharFundoStory(g, W, H) {
  const fundo = '#f1f4f1';
  // Fundo claro com hexágonos e brilho suave
  g.fillStyle = fundo; g.fillRect(0, 0, W, H);
  const s = 1.7, tw = 60 * s, th = 103.92 * s;
  g.strokeStyle = 'rgba(0,166,81,0.11)'; g.lineWidth = 2;
  for (let ty = -1; ty * th < H + th; ty++) {
    for (let tx = -1; tx * tw < W + tw; tx++) {
      const ox = tx * tw, oy = ty * th;
      g.beginPath();
      [[30, 0], [60, 17.32], [60, 51.96], [30, 69.28], [0, 51.96], [0, 17.32]].forEach(([x, y], i) => { const px = ox + x * s, py = oy + y * s; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.closePath(); g.moveTo(ox + 30 * s, oy + 69.28 * s); g.lineTo(ox + 30 * s, oy + 103.92 * s); g.stroke();
    }
  }
  const brilho = g.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.45, 900);
  brilho.addColorStop(0, 'rgba(104,197,47,0.16)'); brilho.addColorStop(1, 'rgba(104,197,47,0)');
  g.fillStyle = brilho; g.fillRect(0, 0, W, H);
}

async function gerarImagemStory() {
  const d = estado.exibido;
  if (!d) return null;
  await document.fonts.ready;
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const cor = (n, pad) => cs.getPropertyValue(n).trim() || pad;
  const verde = cor('--verde', '#00a651'), lima = cor('--lima', '#68c52f'), carvao = cor('--carvao', '#2b2a2c'), fundo = '#f1f4f1';
  const fam = getComputedStyle(document.body).fontFamily;
  const fonte = (peso, px) => `${peso} ${px}px ${fam}`;

  desenharFundoStory(g, W, H);

  // Emblema da marca (zona segura: fora dos 250 px do topo e dos 340 px da base)
  const logo = await carregarImagem(window.logoEstatica ? window.logoEstatica() : $('logoMarca').src); // imagem parada, nunca o 1º quadro do GIF
  if (logo) {
    const h = 210, w = h * (logo.naturalWidth / logo.naturalHeight);
    g.drawImage(logo, (W - w) / 2, 270, w, h);
  }

  // Etiqueta com o nome do sorteio
  let y = 540;
  const nome = $('nomeSorteio').hidden ? '' : $('nomeSorteio').textContent.trim();
  if (nome) {
    g.font = fonte(800, 40);
    const tw2 = Math.min(g.measureText(nome).width, 800);
    const bw = tw2 + 80, bx = (W - bw) / 2;
    g.fillStyle = lima;
    g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw - 28, y); g.lineTo(bx + bw, y + 31); g.lineTo(bx + bw - 28, y + 62); g.lineTo(bx, y + 62); g.closePath(); g.fill();
    g.fillStyle = carvao; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(nome, bx + 30, y + 33, 800);
    y += 100;
  } else { y += 20; }

  // Bilhete
  const cx = 60, cw = 960, hTopo = 400, hPerf = 44, hCorpo = 380, hRodape = 96;
  const ch = hTopo + hPerf + hCorpo + hRodape;
  g.save();
  g.shadowColor = 'rgba(43,42,44,0.22)'; g.shadowBlur = 50; g.shadowOffsetY = 18;
  retanguloArredondado(g, cx, y, cw, ch, 40); g.fillStyle = '#ffffff'; g.fill();
  g.restore();
  g.save();
  retanguloArredondado(g, cx, y, cw, ch, 40); g.clip();
  g.fillStyle = carvao; g.fillRect(cx, y, cw, hTopo);
  g.fillStyle = verde; g.fillRect(cx, y, cw, 14);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = lima; g.font = fonte(700, 40);
  g.fillText($('rotuloBilhete').textContent, cx + 64, y + 100);
  // Nome: até duas linhas, a letra diminui se for preciso
  let px = 104, linhas;
  for (; px >= 50; px -= 4) { g.font = fonte(800, px); linhas = quebrarLinhas(g, d.passageira, cw - 128); if (linhas.length <= 2) break; }
  g.fillStyle = '#ffffff'; g.font = fonte(800, px);
  const bloco = linhas.length * px * 1.08;
  const topoNome = y + 120 + (hTopo - 140 - bloco) / 2;
  linhas.forEach((l, i) => g.fillText(l, cx + 64, topoNome + px * 0.92 + i * px * 1.08));
  // Perfuração
  const yp = y + hTopo + hPerf / 2;
  g.strokeStyle = '#d6ddd7'; g.lineWidth = 4; g.setLineDash([16, 14]);
  g.beginPath(); g.moveTo(cx + 30, yp); g.lineTo(cx + cw - 30, yp); g.stroke(); g.setLineDash([]);
  g.fillStyle = fundo;
  [cx, cx + cw].forEach((px2) => { g.beginPath(); g.arc(px2, yp, 22, 0, Math.PI * 2); g.fill(); });
  // Linhas de informação
  const linhasInfo = [['Dia da corrida', d.dia], ['Motorista', d.motorista], ['Ordem de serviço', d.os]];
  linhasInfo.forEach(([rot, val], i) => {
    const yy = y + hTopo + hPerf + 80 + i * 110;
    g.fillStyle = '#6a726c'; g.font = fonte(600, 34); g.fillText(rot, cx + 64, yy);
    const largura = cw - 400 - 64; // espaço da coluna de valores
    let f = 56; g.font = fonte(700, f);
    while (g.measureText(val).width > largura && f > 40) { f -= 2; g.font = fonte(700, f); }
    g.fillStyle = carvao;
    if (g.measureText(val).width <= largura) g.fillText(val, cx + 400, yy + 2);
    else quebrarLinhas(g, val, largura).slice(0, 2).forEach((l, k, arr) => g.fillText(l, cx + 400, yy + 2 - (arr.length - 1) * 22 + k * 46));
  });
  // Rodapé
  g.fillStyle = '#eceeea'; g.fillRect(cx, y + ch - hRodape, cw, 3);
  g.fillStyle = verde; g.font = fonte(700, 38); g.fillText('Orgulho de estar aqui.', cx + 64, y + ch - hRodape / 2 + 14);
  g.restore();
  return cv.toDataURL('image/png');
}

let ultimoSalvo = '';
function avisarSalvo(rotulo, caminho) {
  ultimoSalvo = caminho;
  $('resumoImagem').textContent = `${rotulo} salvo em: ${caminho}`;
  $('btnMostrarSalvo').hidden = false;
}

async function atualizarPasta() {
  try {
    const r = await window.api.pastaObter();
    $('pastaAtual').textContent = r.pasta ? `Pasta de salvamento: ${r.pasta}` : 'Pasta de salvamento: o app pergunta cada vez.';
    $('pastaDireto').disabled = !r.pasta;
    $('pastaDireto').checked = r.direto;
  } catch { /* ignora */ }
}

async function salvarImagem() {
  try {
    const url = await gerarImagemStory();
    if (!url) return;
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nome = `sorteio-urbano-norte-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.png`;
    const r = await window.api.salvarImagem(url, nome);
    if (r && r.ok) { avisarSalvo('Imagem', r.caminho); atualizarPasta(); }
    else if (r && r.erro) mostrarErro(r.erro);
  } catch (e) { mostrarErro('Não foi possível gerar a imagem: ' + e.message); }
}

$('btnPasta').addEventListener('click', async () => { const r = await window.api.pastaEscolher(); if (r) atualizarPasta(); });
$('btnAbrirPasta').addEventListener('click', () => window.api.pastaAbrir());
$('pastaDireto').addEventListener('change', (e) => window.api.pastaDireto(e.target.checked));
$('btnMostrarSalvo').addEventListener('click', () => window.api.mostrarNoExplorador(ultimoSalvo));
atualizarPasta();
$('btnVertical').addEventListener('click', () => alternarVertical(true));
$('btnSairVertical').addEventListener('click', () => alternarVertical(false));
$('btnImagem').addEventListener('click', salvarImagem);
$('btnImagemBarra').addEventListener('click', salvarImagem);
document.addEventListener('mousemove', () => { if (verticalAtivo()) mostrarBarraVertical(); });
document.addEventListener('keydown', (e) => {
  if (!verticalAtivo()) return;
  if (e.key === 'Escape') { alternarVertical(false); return; }
  if ((e.key === ' ' || e.key === 'Enter') && !$('btnSortear').disabled) { e.preventDefault(); $('btnSortear').click(); }
});
atualizarBotaoImagem();
