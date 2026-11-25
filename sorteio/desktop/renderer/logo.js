// Logos animadas (GIF ou WebP animado): decodifica os quadros, tira o fundo claro dos GIFs e escolhe um quadro
// "completo" para usar onde só cabe imagem parada (barra lateral, bilhete, imagem dos Stories).
// O vídeo usa os quadros para animar a logo no topo.
const logoAnimada = (() => {
  const temDecoder = typeof ImageDecoder !== 'undefined';

  function base64ParaBytes(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Remove o fundo claro ligado às bordas (e a moldura cinza que alguns GIFs têm).
  function removerFundoClaro(img) {
    const { data: d, width: w, height: h } = img;
    const anel = 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < anel || y < anel || x >= w - anel || y >= h - anel) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 250; d[i + 3] = 255; }
    }
    const claro = (i) => Math.min(d[i], d[i + 1], d[i + 2]) >= 228;
    const fundo = new Uint8Array(w * h);
    const pilha = [];
    const empilhar = (x, y) => { const k = y * w + x; if (!fundo[k] && claro(k * 4)) { fundo[k] = 1; pilha.push(k); } };
    for (let x = 0; x < w; x++) { empilhar(x, 0); empilhar(x, h - 1); }
    for (let y = 0; y < h; y++) { empilhar(0, y); empilhar(w - 1, y); }
    while (pilha.length) {
      const k = pilha.pop(), x = k % w, y = (k / w) | 0;
      if (x > 0) empilhar(x - 1, y); if (x < w - 1) empilhar(x + 1, y);
      if (y > 0) empilhar(x, y - 1); if (y < h - 1) empilhar(x, y + 1);
    }
    let opacos = 0;
    for (let k = 0; k < w * h; k++) {
      if (fundo[k]) { d[k * 4 + 3] = 0; continue; }
      opacos++;
      const x = k % w, y = (k / w) | 0;
      const viz = (x > 0 && fundo[k - 1]) || (x < w - 1 && fundo[k + 1]) || (y > 0 && fundo[k - w]) || (y < h - 1 && fundo[k + w]);
      if (viz) d[k * 4 + 3] = 150;
    }
    return opacos;
  }

  async function decodificar(bytes, tipo, tirarFundo) {
    if (!temDecoder) return null;
    const dec = new ImageDecoder({ data: bytes, type: tipo });
    await dec.tracks.ready;
    await dec.completed;
    const n = dec.tracks.selectedTrack.frameCount;
    const quadros = [];
    let tempo = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const w = image.displayWidth, h = image.displayHeight;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(image, 0, 0);
      const dur = Math.max(0.01, (image.duration || 30000) / 1e6);
      image.close();
      const dados = g.getImageData(0, 0, w, h);
      let opacos = 0;
      if (tirarFundo) opacos = removerFundoClaro(dados);
      else for (let k = 3; k < dados.data.length; k += 4) if (dados.data[k] > 0) opacos++;
      // "Detalhe" do quadro: pixels claros dentro da logo (letras e anel). Cresce até a logo ficar completa.
      let brancos = 0;
      for (let k = 0; k < dados.data.length; k += 4) if (dados.data[k + 3] > 200 && Math.min(dados.data[k], dados.data[k + 1], dados.data[k + 2]) >= 200) brancos++;
      g.putImageData(dados, 0, 0);
      quadros.push({ canvas: cv, dur, inicio: tempo, opacos, brancos });
      tempo += dur;
    }
    dec.close();
    if (!quadros.length) return null;
    // "Fim da construção": primeiro quadro em que a logo já está completa (letras incluídas), antes de ela se desmontar.
    const maxBrancos = Math.max(...quadros.map((q) => q.brancos));
    const maxOpacos = Math.max(...quadros.map((q) => q.opacos));
    const completo = maxBrancos > 40
      ? (q) => q.brancos >= maxBrancos * 0.97
      : (q) => q.opacos >= maxOpacos * 0.98;
    const ate = Math.max(0, quadros.findIndex(completo));
    const poster = quadros[ate].canvas.toDataURL('image/png');
    return { quadros, ate, poster, larg: quadros[0].canvas.width, alt: quadros[0].canvas.height, duracaoConstrucao: quadros[ate].inicio };
  }

  async function padrao() {
    try {
      const bytes = await window.api.assetAbertura();
      return await decodificar(new Uint8Array(bytes), 'image/webp', false);
    } catch { return null; }
  }
  async function deDataUrl(dataUrl) {
    try {
      if (!/^data:image\/gif;base64,/.test(dataUrl)) return null;
      return await decodificar(base64ParaBytes(dataUrl), 'image/gif', true);
    } catch { return null; }
  }
  // Quadro que deve aparecer no instante t (segundos): a animação toca até a logo ficar completa e para ali.
  function quadroEm(anim, t) {
    if (!anim) return null;
    let alvo = 0;
    for (let i = 0; i <= anim.ate; i++) { if (anim.quadros[i].inicio <= t) alvo = i; else break; }
    return anim.quadros[alvo].canvas;
  }
  return { padrao, deDataUrl, quadroEm, ehGif: (u) => typeof u === 'string' && /^data:image\/gif;base64,/.test(u) };
})();
