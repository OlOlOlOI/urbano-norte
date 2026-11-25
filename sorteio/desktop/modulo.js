// Sorteio Urbano Norte — parte do processo principal (planilha, histórico, tema, vídeo...).
// Usado pelo app próprio do sorteio (main.js) e pelo app unificado da Urbano Norte (pasta app/ do monorepo).
const { app, BrowserWindow, ipcMain, dialog, safeStorage, clipboard, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { lerArquivo } = require('./leitor');

// A planilha fica guardada aqui; só as colunas necessárias seguem para a tela.
let aberto = null;

/**
 * Registra os canais IPC do sorteio.
 * @param {object} [op]
 * @param {() => string} [op.pastaDados] onde gravar histórico, contatos, tema e preferências (padrão: userData)
 * @param {(wc: Electron.WebContents) => Electron.BrowserWindow|null} [op.janelaDe] janela dona da tela do sorteio
 * @param {(ativo: boolean, win: Electron.BrowserWindow) => void} [op.aoVertical] avisado antes de entrar/sair do modo vertical
 */
function registrar(op = {}) {
  const pastaDados = op.pastaDados || (() => app.getPath('userData'));
  const janelaDe = op.janelaDe || ((wc) => BrowserWindow.fromWebContents(wc));
  const aoVertical = op.aoVertical || null;

  ipcMain.handle('abrir-planilha', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Selecione a planilha de corridas',
      filters: [{ name: 'Planilhas', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;

    try {
      const { nomesAbas, abas } = lerArquivo(r.filePaths[0]);
      aberto = abas;
      const topo = {};
      const totais = {};
      nomesAbas.forEach((n) => { topo[n] = abas[n].slice(0, 40); totais[n] = abas[n].length; });
      return { ok: true, arquivo: path.basename(r.filePaths[0]), nomesAbas, topo, totais };
    } catch (e) {
      return { ok: false, erro: 'Não foi possível ler a planilha: ' + e.message };
    }
  });

  // Títulos (cabeçalho) de uma linha da aba.
  ipcMain.handle('obter-titulos', (_e, { aba, linha }) => {
    const l = (aberto && aberto[aba] && aberto[aba][linha - 1]) || [];
    return l.map((c) => String(c ?? '').trim());
  });

  // Valores de algumas colunas, para todas as linhas abaixo da linha de títulos.
  ipcMain.handle('extrair-colunas', (_e, { aba, linha, colunas }) => {
    const linhas = (aberto && aberto[aba]) || [];
    const saida = [];
    for (let i = linha; i < linhas.length; i++) {
      const l = linhas[i];
      saida.push(colunas.map((c) => (c >= 0 ? String(l[c] ?? '').trim() : '')));
    }
    return saida;
  });

  // ---------- Histórico de sorteios (salvo no computador) ----------
  // O histórico guarda só nome, dia, motorista e O.S. O telefone nunca vai para a tela: quando o sistema operacional
  // oferece proteção (Windows/Mac), ele é guardado criptografado em arquivo separado, para sair apenas no Excel.
  const arquivoHist = () => path.join(pastaDados(), 'historico.json');
  const arquivoContatos = () => path.join(pastaDados(), 'contatos.dat');
  const protecao = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
  const lerHist = () => { try { const a = JSON.parse(fs.readFileSync(arquivoHist(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  const gravarArquivo = (alvo, dados) => {
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo + '.tmp', dados);
    fs.renameSync(alvo + '.tmp', alvo);
  };
  const gravarHist = (a) => gravarArquivo(arquivoHist(), JSON.stringify(a));
  const lerContatos = () => {
    if (!protecao() || !fs.existsSync(arquivoContatos())) return {};
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(arquivoContatos()))); } catch { return {}; }
  };
  const gravarContatos = (o) => { if (protecao()) gravarArquivo(arquivoContatos(), safeStorage.encryptString(JSON.stringify(o))); };

  // Contatos (telefone e e-mail) da planilha aberta, buscados pela O.S.
  function contatosDaPlanilha(c) {
    const mapa = new Map();
    const dados = (aberto && c && aberto[c.aba]) || [];
    if (c && c.colOS >= 0 && (c.colTel >= 0 || c.colEmail >= 0)) {
      const v = (l, i) => (i >= 0 ? String(l[i] ?? '').trim() : '');
      for (let i = c.linha; i < dados.length; i++) {
        mapa.set(String(dados[i][c.colOS] ?? '').trim(), { t: v(dados[i], c.colTel), e: v(dados[i], c.colEmail) });
      }
    }
    return mapa;
  }
  const contatoDe = (guardados, h, daPlanilha) => {
    const g = guardados[h.id];
    const gc = typeof g === 'string' ? { t: g, e: '' } : (g || {});
    const p = daPlanilha.get(h.os) || {};
    return { t: gc.t || p.t || '', e: gc.e || p.e || '' };
  };

  const txt = (v, n) => String(v ?? '').slice(0, n);

  ipcMain.handle('historico-obter', () => ({ itens: lerHist(), contatosProtegidos: protecao() }));

  ipcMain.handle('historico-adicionar', (_e, { item, contexto }) => {
    const h = lerHist();
    const quando = Number.isNaN(Date.parse(item?.quando)) ? new Date().toISOString() : new Date(item.quando).toISOString();
    const limpo = {
      id: txt(item?.id, 40).replace(/[^A-Za-z0-9-]/g, '') || Date.now().toString(36),
      n: Number(item?.n) || h.length + 1,
      quando,
      nomeSorteio: txt(item?.nomeSorteio, 60),
      arquivo: txt(item?.arquivo, 200),
      os: txt(item?.os, 60), dia: txt(item?.dia, 40), passageira: txt(item?.passageira, 120), motorista: txt(item?.motorista, 120),
    };
    h.push(limpo);
    gravarHist(h.slice(-5000));
    const c = contatosDaPlanilha(contexto).get(limpo.os);
    let guardado = false;
    if (c && (c.t || c.e) && protecao()) {
      const todos = lerContatos();
      todos[limpo.id] = c;
      gravarContatos(todos);
      guardado = true;
    }
    return { ok: true, contatoGuardado: guardado };
  });

  // Dados de contato da passageira sorteada: só saem quando a aba "Contato" é aberta.
  ipcMain.handle('contato-obter', (_e, { id, contexto }) => {
    const h = lerHist().find((x) => x.id === id);
    if (!h) return { telefone: '', email: '' };
    const c = contatoDe(lerContatos(), h, contatosDaPlanilha(contexto));
    return { telefone: c.t, email: c.e };
  });

  ipcMain.handle('copiar', (_e, valor) => {
    const t = String(valor ?? '').slice(0, 200);
    if (!t) return false;
    clipboard.writeText(t);
    setTimeout(() => { try { if (clipboard.readText() === t) clipboard.clear(); } catch { /* ignora */ } }, 60000); // limpa depois de 1 min
    return true;
  });

  ipcMain.handle('historico-limpar', () => {
    gravarHist([]);
    try { fs.rmSync(arquivoContatos(), { force: true }); } catch { /* ignora */ }
    return true;
  });

  ipcMain.handle('exportar-historico', async (_e, { contexto }) => {
    const historico = lerHist().sort((a, b) => a.n - b.n);
    const r = await dialog.showSaveDialog({
      title: 'Salvar histórico dos sorteios',
      defaultPath: 'sorteios-urbano-norte.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true };

    // Contato: do cofre protegido; se não houver, da planilha aberta agora (busca pela O.S).
    const guardados = lerContatos();
    const daPlanilha = contatosDaPlanilha(contexto);
    const linhas = [['Sorteio', 'Data e hora do sorteio', 'Nome do sorteio', 'Passageiro(a)', 'Telefone', 'E-mail', 'Dia da corrida', 'Motorista', 'O.S', 'Planilha']];
    historico.forEach((h) => {
      const c = contatoDe(guardados, h, daPlanilha);
      linhas.push([h.n, new Date(h.quando).toLocaleString('pt-BR'), h.nomeSorteio || '', h.passageira, c.t, c.e, h.dia, h.motorista, h.os, h.arquivo || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    ws['!cols'] = [{ wch: 9 }, { wch: 20 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 32 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 36 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sorteios');
    try {
      XLSX.writeFile(wb, r.filePath);
      return { ok: true, caminho: r.filePath };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  });

  // ---------- Personalização (nome do sorteio, logo, cores) ----------
  const arquivoTema = () => path.join(pastaDados(), 'tema.json');
  const COR = /^#[0-9a-fA-F]{6}$/;

  ipcMain.handle('tema-obter', () => {
    try { return JSON.parse(fs.readFileSync(arquivoTema(), 'utf8')); } catch { return {}; }
  });

  ipcMain.handle('tema-salvar', (_e, t) => {
    const limpo = {
      rotulo: String(t?.rotulo ?? 'Pessoa sorteada').slice(0, 40),
      nome: String(t?.nome ?? '').slice(0, 60),
      corBotao: COR.test(t?.corBotao) ? t.corBotao : '#00a651',
      corDestaque: COR.test(t?.corDestaque) ? t.corDestaque : '#68c52f',
      corEscuro: COR.test(t?.corEscuro) ? t.corEscuro : '#2b2a2c',
      abertura: t?.abertura !== false,
      fundo: ['hexagonos', 'confete', 'nenhum'].includes(t?.fundo) ? t.fundo : 'hexagonos',
      celebrar: t?.celebrar !== false,
      logoPoster: typeof t?.logoPoster === 'string' && /^data:image\/png;base64,/.test(t.logoPoster) && t.logoPoster.length < 3_000_000 ? t.logoPoster : null,
      logo: typeof t?.logo === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(t.logo) && t.logo.length < 6_000_000 ? t.logo : null,
    };
    fs.mkdirSync(path.dirname(arquivoTema()), { recursive: true });
    fs.writeFileSync(arquivoTema(), JSON.stringify(limpo));
    return true;
  });

  ipcMain.handle('tema-escolher-logo', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Escolha a logo (PNG, JPG, GIF, WebP ou SVG)',
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const arq = r.filePaths[0];
    const ext = path.extname(arq).slice(1).toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
    if (!mime) return { erro: 'Formato de imagem não suportado.' };
    const buf = fs.readFileSync(arq);
    if (buf.length > 4 * 1024 * 1024) return { erro: 'A imagem é grande demais (máximo 4 MB).' };
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  });

  // ---------- Modo vertical (9:16): janela em pé para gravar Reels e Stories ----------
  let janelaAntes = null;
  ipcMain.handle('janela-vertical', (e, { ativo }) => {
    const win = janelaDe(e.sender);
    if (!win) return false;
    if (aoVertical) aoVertical(ativo, win);
    if (ativo) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      if (!janelaAntes) janelaAntes = win.getBounds();
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      const [ww, wh] = win.getSize();
      const [cw, ch] = win.getContentSize();
      const moldura = { width: ww - cw, height: wh - ch };
      const altura = Math.max(560, Math.min(area.height - moldura.height - 20, 1000));
      const largura = Math.round((altura * 9) / 16);
      win.setMinimumSize(300, 520);
      win.setAspectRatio(9 / 16, moldura);
      win.setContentSize(largura, altura);
      win.center();
    } else {
      win.setAspectRatio(0);
      win.setMinimumSize(980, 680);
      if (janelaAntes) win.setBounds(janelaAntes);
      janelaAntes = null;
    }
    return true;
  });

  // ---------- Pasta de saída (vídeos e imagens) ----------
  const arquivoPrefs = () => path.join(pastaDados(), 'preferencias.json');
  const lerPrefs = () => { try { return JSON.parse(fs.readFileSync(arquivoPrefs(), 'utf8')); } catch { return {}; } };
  const gravarPrefs = (p) => gravarArquivo(arquivoPrefs(), JSON.stringify(p));
  const pastaExiste = (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };

  // Nome livre na pasta: acrescenta (2), (3)... se já existir.
  function nomeLivre(pasta, nome) {
    const ext = path.extname(nome), base = path.basename(nome, ext);
    let alvo = path.join(pasta, nome), n = 2;
    while (fs.existsSync(alvo)) alvo = path.join(pasta, `${base} (${n++})${ext}`);
    return alvo;
  }

  // Decide onde gravar: direto na pasta escolhida (se o usuário preferiu assim) ou pergunta, já abrindo na última pasta usada.
  async function caminhoParaSalvar(win, titulo, nome, filtros, pastaPadrao) {
    const prefs = lerPrefs();
    const pasta = pastaExiste(prefs.pastaSaida) ? prefs.pastaSaida : '';
    if (prefs.salvarDireto && pasta) return nomeLivre(pasta, nome);
    const r = await dialog.showSaveDialog(win || undefined, {
      title: titulo,
      defaultPath: path.join(pasta || pastaPadrao, nome),
      buttonLabel: 'Salvar',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      filters: filtros,
    });
    if (r.canceled || !r.filePath) return null;
    gravarPrefs({ ...prefs, pastaSaida: path.dirname(r.filePath) }); // lembra a última pasta usada
    return r.filePath;
  }

  ipcMain.handle('pasta-obter', () => {
    const p = lerPrefs();
    const pasta = pastaExiste(p.pastaSaida) ? p.pastaSaida : '';
    return { pasta, padrao: app.getPath('videos'), direto: !!p.salvarDireto && !!pasta };
  });
  ipcMain.handle('pasta-escolher', async (e) => {
    const win = janelaDe(e.sender);
    const prefs = lerPrefs();
    const r = await dialog.showOpenDialog(win || undefined, {
      title: 'Escolha a pasta onde salvar vídeos e imagens',
      defaultPath: pastaExiste(prefs.pastaSaida) ? prefs.pastaSaida : app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    gravarPrefs({ ...prefs, pastaSaida: r.filePaths[0] });
    return { pasta: r.filePaths[0] };
  });
  ipcMain.handle('pasta-direto', (_e, { valor }) => { gravarPrefs({ ...lerPrefs(), salvarDireto: !!valor }); return true; });
  ipcMain.handle('pasta-abrir', () => {
    const p = lerPrefs();
    return shell.openPath(pastaExiste(p.pastaSaida) ? p.pastaSaida : app.getPath('videos'));
  });
  ipcMain.handle('mostrar-no-explorador', (_e, caminho) => { if (typeof caminho === 'string' && fs.existsSync(caminho)) shell.showItemInFolder(caminho); return true; });

  // ---------- Imagem do resultado para Stories ----------
  ipcMain.handle('salvar-imagem', async (e, { dataUrl, sugestao }) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || m[1].length > 20_000_000) return { ok: false, erro: 'Imagem inválida.' };
    const nome = String(sugestao || 'sorteio.png').replace(/[^\w.-]/g, '-').slice(0, 80);
    const alvo = await caminhoParaSalvar(janelaDe(e.sender), 'Salvar imagem do resultado', nome, [{ name: 'Imagem PNG', extensions: ['png'] }], app.getPath('pictures'));
    if (!alvo) return { ok: false, cancelado: true };
    fs.writeFileSync(alvo, Buffer.from(m[1], 'base64'));
    return { ok: true, caminho: alvo };
  });

  // ---------- Vídeo do sorteio (10 s) ----------
  ipcMain.handle('salvar-video', async (e, { bytes, sugestao, ext }) => {
    const formato = ext === 'webm' ? 'webm' : 'mp4';
    if (!bytes || !bytes.byteLength || bytes.byteLength > 300 * 1024 * 1024) return { ok: false, erro: 'Vídeo inválido.' };
    const nome = String(sugestao || `sorteio.${formato}`).replace(/[^\w.-]/g, '-').slice(0, 80);
    const alvo = await caminhoParaSalvar(janelaDe(e.sender), 'Salvar vídeo do sorteio', nome, [{ name: formato === 'mp4' ? 'Vídeo MP4' : 'Vídeo WebM', extensions: [formato] }], app.getPath('videos'));
    if (!alvo) return { ok: false, cancelado: true };
    fs.writeFileSync(alvo, Buffer.from(bytes));
    return { ok: true, caminho: alvo };
  });

  // Animação de abertura (WebP animado com fundo transparente), lida aqui para o vídeo poder usá-la quadro a quadro.
  ipcMain.handle('asset-abertura', () => fs.readFileSync(path.join(__dirname, 'renderer', 'assets', 'abertura.webp')));
}

module.exports = { registrar };
