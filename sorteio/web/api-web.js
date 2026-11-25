// Versão web (celular e computador): faz o papel do "main.js" do aplicativo de Windows/Mac.
// Tudo acontece neste aparelho: a planilha NÃO é enviada para nenhum servidor, e histórico, contatos e
// personalização ficam guardados no próprio navegador (IndexedDB).
(() => {
  'use strict';
  document.documentElement.classList.add('web');
  if (matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('toque');

  // ---------- Armazenamento local (IndexedDB) ----------
  const abrirBanco = () => new Promise((res, rej) => {
    const r = indexedDB.open('sorteio-urbano-norte', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  let bancoP = null;
  const banco = () => (bancoP = bancoP || abrirBanco());
  const kvObter = async (k) => {
    const db = await banco();
    return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  };
  const kvGravar = async (k, v) => {
    const db = await banco();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => rej(t.error); });
  };
  const kvApagar = async (k) => {
    const db = await banco();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(true); t.onerror = () => rej(t.error); });
  };
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ignora */ }

  // ---------- Leitura de planilhas (mesma lógica do leitor.js) ----------
  function decodificar(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
  }
  function detectarSeparador(texto) {
    const fim = texto.search(/\r?\n/);
    const primeira = texto.slice(0, fim >= 0 ? fim : texto.length);
    const cont = (c) => primeira.split(c).length - 1;
    return [';', ',', '\t', '|'].reduce((melhor, c) => (cont(c) > cont(melhor) ? c : melhor), ';');
  }
  function lerCSV(texto, sep) {
    const linhas = [];
    let linha = [], campo = '', aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
      } else if (c === '"' && campo === '') aspas = true;
      else if (c === sep) { linha.push(campo); campo = ''; }
      else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
      else if (c !== '\r') campo += c;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
  }
  function lerArquivo(nome, buf) {
    const ext = (nome.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt') {
      const texto = decodificar(buf);
      return { nomesAbas: ['Planilha'], abas: { Planilha: lerCSV(texto, detectarSeparador(texto)) } };
    }
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const abas = {};
    for (const n of wb.SheetNames) abas[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, dateNF: 'dd/mm/yyyy', defval: '' });
    return { nomesAbas: wb.SheetNames, abas };
  }

  // Escolher arquivo: o seletor precisa abrir direto do toque do usuário.
  function escolherArquivo(accept) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      const fim = (f) => { inp.remove(); resolve(f || null); };
      inp.addEventListener('change', () => fim(inp.files && inp.files[0]));
      inp.addEventListener('cancel', () => fim(null));
      inp.click();
    });
  }

  let aberto = null; // a planilha fica só na memória deste aparelho

  // ---------- Contatos: guardados cifrados (AES-GCM) com uma chave que não sai do navegador ----------
  const bytesParaB64 = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
  const b64ParaBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  async function chaveCofre() {
    let k = await kvObter('chaveCofre');
    if (!k) {
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await kvGravar('chaveCofre', k);
    }
    return k;
  }
  async function lerContatos() {
    try {
      const reg = await kvObter('contatos');
      if (!reg) return {};
      const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: reg.iv }, await chaveCofre(), reg.dados);
      return JSON.parse(new TextDecoder().decode(claro));
    } catch { return {}; }
  }
  async function gravarContatos(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveCofre(), new TextEncoder().encode(JSON.stringify(obj)));
    await kvGravar('contatos', { iv, dados });
  }

  // ---------- Acesso aos contatos: Face ID (ou digital) e/ou PIN ----------
  async function derivar(pin, sal) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: 200000, hash: 'SHA-256' }, base, 256);
    return bytesParaB64(new Uint8Array(bits));
  }
  let liberadoAte = 0;
  const el = (id) => document.getElementById(id);
  const liberar = () => { liberadoAte = Date.now() + 120000; }; // fica liberado por 2 minutos

  // Face ID / digital via WebAuthn: o próprio iPhone confirma que é o dono (a chave fica no aparelho).
  async function bioDisponivel() {
    try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
  }
  async function bioCadastrar() {
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Sorteio Urbano Norte', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'operador', displayName: 'Operador' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000, attestation: 'none',
      } });
      if (!cred) return false;
      await kvGravar('bio', { id: bytesParaB64(new Uint8Array(cred.rawId)) });
      return true;
    } catch { return false; }
  }
  async function bioVerificar() {
    try {
      const reg = await kvObter('bio');
      if (!reg) return false;
      const r = await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: b64ParaBytes(reg.id), transports: ['internal', 'hybrid'] }],
        userVerification: 'required', timeout: 60000,
      } });
      return !!r;
    } catch { return false; }
  }
  async function apagarAcesso() { // "Esqueci": apaga contatos guardados, PIN e Face ID
    await kvApagar('contatos'); await kvApagar('pin'); await kvApagar('bio');
  }

  // Mostra a janela de acesso. Resolve true se liberado, false se cancelado.
  async function pedirPin(motivo) {
    if (Date.now() < liberadoAte) return true;
    const [regPin, regBio, bioOk] = await Promise.all([kvObter('pin'), kvObter('bio'), bioDisponivel()]);
    // Já tem Face ID cadastrado: pede direto (a janela só aparece se falhar ou for cancelado)
    if (regBio && bioOk && (await bioVerificar())) { liberar(); return true; }

    const ov = el('pinOverlay'), inp = el('pinCampo'), inp2 = el('pinCampo2'), msg = el('pinMsg');
    const modo = !regPin && !regBio ? 'criar' : (regPin ? 'entrar' : 'bio');
    const mostrar = (id, v) => { el(id).hidden = !v; };

    function desenhar(m) {
      msg.textContent = ''; inp.value = ''; inp2.value = '';
      const temPin = m === 'criar' || m === 'entrar';
      mostrar('pinRotulo1', temPin);
      mostrar('pinCampo2Rotulo', m === 'criar');
      mostrar('pinBioRotulo', bioOk && !regBio && temPin);
      mostrar('pinOk', m !== 'bio');
      mostrar('pinBio', (m === 'bio') || (m === 'entrar' && regBio && bioOk) || (m === 'criar' && bioOk));
      mostrar('pinEsqueci', m === 'entrar' || m === 'bio');
      el('pinEsqueci').textContent = m === 'bio' ? 'Não consigo usar o Face ID' : 'Esqueci meu PIN';
      el('pinCampo').inputMode = 'numeric';
      if (m === 'criar') {
        el('pinTitulo').textContent = 'Proteja os contatos';
        el('pinTexto').textContent = 'Telefone e e-mail das pessoas sorteadas ficam neste aparelho. Escolha como liberar o acesso.';
        el('pinRotulo1Texto').textContent = 'Crie um PIN (4 a 8 números)';
        el('pinOk').textContent = 'Criar PIN';
        el('pinBio').textContent = 'Usar só o Face ID';
      } else if (m === 'entrar') {
        el('pinTitulo').textContent = 'Digite o PIN';
        el('pinTexto').textContent = motivo || 'Dados pessoais — uso interno.';
        el('pinRotulo1Texto').textContent = 'PIN';
        el('pinOk').textContent = 'Continuar';
        el('pinBio').textContent = 'Usar Face ID';
      } else if (m === 'bio') {
        el('pinTitulo').textContent = 'Confirme com Face ID';
        el('pinTexto').textContent = motivo || 'Dados pessoais — uso interno.';
        el('pinBio').textContent = 'Usar Face ID';
      } else if (m === 'reset') {
        el('pinTitulo').textContent = 'Redefinir o acesso';
        el('pinTexto').textContent = 'Isso apaga os telefones e e-mails guardados neste aparelho e o acesso atual (PIN e Face ID). Os nomes do histórico continuam. Os contatos voltam a aparecer se você abrir de novo a planilha de corridas. Depois você cria um novo acesso.';
        mostrar('pinOk', true); mostrar('pinBio', false); mostrar('pinEsqueci', false); mostrar('pinRotulo1', false); mostrar('pinCampo2Rotulo', false); mostrar('pinBioRotulo', false);
        el('pinOk').textContent = 'Apagar e criar novo acesso';
        el('pinCancelar').textContent = 'Voltar';
      }
      if (m !== 'reset') el('pinCancelar').textContent = 'Cancelar';
    }

    return new Promise((resolve) => {
      let atual = modo;
      const limpar = () => { ov.hidden = true; inp.value = ''; inp2.value = ''; el('pinOk').onclick = el('pinCancelar').onclick = el('pinBio').onclick = el('pinEsqueci').onclick = inp.onkeydown = inp2.onkeydown = null; };
      const fechar = (ok) => { limpar(); resolve(ok); };

      const confirmar = async () => {
        if (atual === 'reset') {
          await apagarAcesso();
          limpar();
          resolve(await pedirPin(motivo)); // recomeça: agora cria um novo acesso
          return;
        }
        const v = inp.value.trim();
        if (!/^\d{4,8}$/.test(v)) { msg.textContent = 'Use de 4 a 8 números.'; return; }
        const querBio = bioOk && !regBio && !el('pinBioRotulo').hidden && el('pinBioCheck').checked;
        if (atual === 'criar') {
          if (inp2.value.trim() !== v) { msg.textContent = 'Os dois PINs precisam ser iguais.'; return; }
          const sal = crypto.getRandomValues(new Uint8Array(16));
          await kvGravar('pin', { sal: bytesParaB64(sal), hash: await derivar(v, sal), falhas: 0 });
          if (querBio) await bioCadastrar();
          liberar(); fechar(true);
          return;
        }
        const r = await kvObter('pin');
        if (r.bloqueadoAte && Date.now() < r.bloqueadoAte) { msg.textContent = 'Muitas tentativas. Aguarde um instante e tente de novo.'; return; }
        if ((await derivar(v, b64ParaBytes(r.sal))) === r.hash) {
          await kvGravar('pin', { ...r, falhas: 0, bloqueadoAte: 0 });
          if (querBio) await bioCadastrar();
          liberar(); fechar(true);
        } else {
          const falhas = (r.falhas || 0) + 1;
          await kvGravar('pin', { ...r, falhas, bloqueadoAte: falhas >= 5 ? Date.now() + 60000 * Math.min(30, falhas - 4) : 0 });
          msg.textContent = 'PIN incorreto.';
          inp.value = ''; inp.focus();
        }
      };

      el('pinOk').onclick = confirmar;
      el('pinCancelar').onclick = () => { if (atual === 'reset') { atual = modo === 'criar' ? 'entrar' : modo; desenhar(atual); } else fechar(false); };
      el('pinEsqueci').onclick = () => { atual = 'reset'; desenhar('reset'); };
      el('pinBio').onclick = async () => {
        if (atual === 'criar') { // só Face ID, sem PIN
          if (await bioCadastrar()) { liberar(); fechar(true); } else msg.textContent = 'Não foi possível ativar o Face ID. Crie um PIN ou tente de novo.';
        } else if (await bioVerificar()) { liberar(); fechar(true); } else msg.textContent = 'Não foi possível confirmar. Tente de novo' + (regPin ? ' ou digite o PIN.' : '.');
      };
      inp.onkeydown = inp2.onkeydown = (e) => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') fechar(false); };

      desenhar(atual);
      ov.hidden = false;
      if (!matchMedia('(pointer: coarse)').matches && atual !== 'bio') inp.focus();
    });
  }
  window.travarContatos = () => { liberadoAte = 0; };

  // ---------- Entrega de arquivos: compartilhar (celular) ou baixar ----------
  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function entregar(blob, nome, mime, titulo) {
    const arquivo = new File([blob], nome, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], title: titulo });
        return { ok: true, caminho: 'enviado pelo menu Compartilhar' };
      } catch (e) {
        // Cancelou, ou o navegador exige um toque novo (acontece depois de um vídeo demorado).
        if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return { ok: false, cancelado: true, semToque: e.name === 'NotAllowedError' };
        // outro erro: cai para o download
      }
    }
    baixar(blob, nome);
    return { ok: true, caminho: 'pasta de downloads do aparelho' };
  }

  // ---------- Janela "Vídeo pronto" ----------
  let urlPrevia = null;
  function mostrarVideoPronto(blob) {
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
    urlPrevia = URL.createObjectURL(blob);
    const v = el('videoPreview');
    v.src = urlPrevia;
    el('videoPronto').hidden = false;
    v.play().catch(() => {});
  }
  function fecharVideoPronto() {
    const ov = el('videoPronto');
    if (!ov) return;
    ov.hidden = true;
    const v = el('videoPreview');
    v.pause(); v.removeAttribute('src'); v.load();
    if (urlPrevia) { URL.revokeObjectURL(urlPrevia); urlPrevia = null; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    // O toque neste botão repete o salvamento do vídeo guardado (o menu Compartilhar abre porque há um toque novo).
    el('btnSalvarVideoAgora').addEventListener('click', () => el('btnSalvarVideoDeNovo').click());
    el('btnFecharVideo').addEventListener('click', fecharVideoPronto);
    // Atualizar o app à força: apaga o que está guardado e recarrega (histórico e contatos NÃO são apagados)
    el('btnAtualizarApp').addEventListener('click', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        const ks = await caches.keys();
        await Promise.all(ks.map((k) => caches.delete(k)));
      } catch { /* segue */ }
      location.reload();
    });
  });

  const txt = (v, n) => String(v ?? '').slice(0, n);
  const COR = /^#[0-9a-fA-F]{6}$/;
  const lerHist = async () => { const a = await kvObter('historico'); return Array.isArray(a) ? a : []; };

  function contatosDaPlanilha(c) {
    const mapa = new Map();
    const dados = (aberto && c && aberto[c.aba]) || [];
    if (c && c.colOS >= 0 && (c.colTel >= 0 || c.colEmail >= 0)) {
      const v = (l, i) => (i >= 0 ? String(l[i] ?? '').trim() : '');
      for (let i = c.linha; i < dados.length; i++) mapa.set(String(dados[i][c.colOS] ?? '').trim(), { t: v(dados[i], c.colTel), e: v(dados[i], c.colEmail) });
    }
    return mapa;
  }
  const contatoDe = (guardados, h, daPlanilha) => {
    const g = guardados[h.id];
    const gc = typeof g === 'string' ? { t: g, e: '' } : (g || {});
    const p = daPlanilha.get(h.os) || {};
    return { t: gc.t || p.t || '', e: gc.e || p.e || '' };
  };

  window.api = {
    // --- planilha ---
    async abrirPlanilha() {
      const f = await escolherArquivo('.csv,.xlsx,.xls,.xlsm,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (!f) return null;
      try {
        const buf = await f.arrayBuffer();
        await new Promise((r) => setTimeout(r, 30)); // deixa a tela mostrar "lendo"
        const { nomesAbas, abas } = lerArquivo(f.name, buf);
        aberto = abas;
        const topo = {}, totais = {};
        nomesAbas.forEach((n) => { topo[n] = abas[n].slice(0, 40); totais[n] = abas[n].length; });
        return { ok: true, arquivo: f.name, nomesAbas, topo, totais };
      } catch (e) {
        return { ok: false, erro: 'Não foi possível ler a planilha: ' + e.message };
      }
    },
    async obterTitulos(aba, linha) {
      const l = (aberto && aberto[aba] && aberto[aba][linha - 1]) || [];
      return l.map((c) => String(c ?? '').trim());
    },
    async extrairColunas(aba, linha, colunas) {
      const linhas = (aberto && aberto[aba]) || [];
      const saida = [];
      for (let i = linha; i < linhas.length; i++) {
        const l = linhas[i];
        saida.push(colunas.map((c) => (c >= 0 ? String(l[c] ?? '').trim() : '')));
      }
      return saida;
    },

    // --- histórico e contatos ---
    async historicoObter() { return { itens: await lerHist(), contatosProtegidos: true }; },
    async historicoAdicionar(item, contexto) {
      const h = await lerHist();
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
      await kvGravar('historico', h.slice(-5000));
      const c = contatosDaPlanilha(contexto).get(limpo.os);
      let guardado = false;
      if (c && (c.t || c.e)) {
        const todos = await lerContatos();
        todos[limpo.id] = c;
        await gravarContatos(todos);
        guardado = true;
      }
      return { ok: true, contatoGuardado: guardado };
    },
    async contatoObter(id, contexto) {
      const h = (await lerHist()).find((x) => x.id === id);
      if (!h) return { telefone: '', email: '' };
      if (!(await pedirPin('Dados pessoais — uso interno.'))) return { telefone: '', email: '', bloqueado: true };
      const c = contatoDe(await lerContatos(), h, contatosDaPlanilha(contexto));
      return { telefone: c.t, email: c.e };
    },
    async copiar(valor) {
      const t = String(valor ?? '').slice(0, 200);
      if (!t) return false;
      try { await navigator.clipboard.writeText(t); } catch { return false; }
      setTimeout(async () => { try { if ((await navigator.clipboard.readText()) === t) await navigator.clipboard.writeText(' '); } catch { /* ignora */ } }, 60000);
      return true;
    },
    async historicoLimpar() {
      await kvGravar('historico', []);
      await kvApagar('contatos');
      return true;
    },
    async exportarHistorico(contexto) {
      if (!(await pedirPin('Para salvar o Excel com telefone e e-mail.'))) return { ok: false, cancelado: true };
      const historico = (await lerHist()).sort((a, b) => a.n - b.n);
      const guardados = await lerContatos();
      const daPlanilha = contatosDaPlanilha(contexto);
      const linhas = [['Sorteio', 'Data e hora do sorteio', 'Nome do sorteio', 'Passageiro(a)', 'Telefone', 'E-mail', 'Dia da corrida', 'Motorista', 'O.S', 'Planilha']];
      historico.forEach((h) => {
        const c = contatoDe(guardados, h, daPlanilha);
        linhas.push([h.n, new Date(h.quando).toLocaleString('pt-BR'), h.nomeSorteio || '', h.passageira, c.t, c.e, h.dia, h.motorista, h.os, h.arquivo || '']);
      });
      try {
        const ws = XLSX.utils.aoa_to_sheet(linhas);
        ws['!cols'] = [{ wch: 9 }, { wch: 20 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 32 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 36 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sorteios');
        const saida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([saida], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const r = await entregar(blob, 'sorteios-urbano-norte.xlsx', blob.type, 'Sorteios Urbano Norte');
        return r.ok ? { ok: true, caminho: r.caminho } : { ok: false, cancelado: true };
      } catch (e) {
        return { ok: false, erro: e.message };
      }
    },

    // --- personalização ---
    async temaObter() { return (await kvObter('tema')) || {}; },
    async temaSalvar(t) {
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
      await kvGravar('tema', limpo);
      return true;
    },
    async temaEscolherLogo() {
      const f = await escolherArquivo('image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.svg');
      if (!f) return null;
      if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.type)) return { erro: 'Formato de imagem não suportado.' };
      if (f.size > 4 * 1024 * 1024) return { erro: 'A imagem é grande demais (máximo 4 MB).' };
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
      return { dataUrl };
    },

    // --- tela vertical e arquivos ---
    async janelaVertical(ativo) {
      // No celular o app já é em pé; no modo vertical pedimos tela cheia quando o navegador deixa.
      try {
        if (ativo && document.documentElement.requestFullscreen && !document.fullscreenElement && matchMedia('(pointer: coarse)').matches) await document.documentElement.requestFullscreen();
        else if (!ativo && document.fullscreenElement) await document.exitFullscreen();
      } catch { /* sem tela cheia, segue normal */ }
      return true;
    },
    async pastaObter() { return { pasta: '', padrao: '', direto: false }; },
    async pastaEscolher() { return null; },
    async pastaDireto() { return true; },
    async pastaAbrir() { return true; },
    async mostrarNoExplorador() { return true; },
    async assetAbertura() { return new Uint8Array(await (await fetch('assets/abertura.webp')).arrayBuffer()); },
    async salvarVideo(bytes, sugestao, ext) {
      const formato = ext === 'webm' ? 'webm' : 'mp4';
      if (!bytes || !bytes.byteLength) return { ok: false, erro: 'Vídeo inválido.' };
      const nome = String(sugestao || `sorteio.${formato}`).replace(/[^\w.-]/g, '-').slice(0, 80);
      const blob = new Blob([bytes], { type: 'video/' + formato });
      const mime = 'video/' + formato;
      const ativo = navigator.userActivation ? navigator.userActivation.isActive : true;
      const compartilha = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], nome, { type: mime })] }));
      // Depois de um vídeo demorado o celular não deixa abrir o menu Compartilhar sem um toque novo:
      // mostramos "Vídeo pronto" com um botão grande para esse toque.
      if (compartilha && !ativo) { mostrarVideoPronto(blob); return { ok: false, cancelado: true }; }
      const r = await entregar(blob, nome, mime, 'Sorteio Urbano Norte');
      if (r.ok) fecharVideoPronto();
      else if (r.semToque) mostrarVideoPronto(blob);
      return r;
    },
    async salvarImagem(dataUrl, sugestao) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) return { ok: false, erro: 'Imagem inválida.' };
      const nome = String(sugestao || 'sorteio.png').replace(/[^\w.-]/g, '-').slice(0, 80);
      return entregar(new Blob([b64ParaBytes(m[1])], { type: 'image/png' }), nome, 'image/png', 'Sorteio Urbano Norte');
    },
  };

  // Ao fechar/esconder o app, trava de novo o acesso aos contatos.
  document.addEventListener('visibilitychange', () => { if (document.hidden) liberadoAte = 0; });

  // Service worker (funciona offline depois da primeira abertura)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
    // Quando uma versão nova assume o controle, recarrega uma vez para já mostrá-la.
    let recarregou = false;
    const tinha = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !recarregou) { recarregou = true; location.reload(); } });
  }

  // Convite para instalar (Android/Chrome) e dica para iPhone
  let convite = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); convite = e; const b = el('btnInstalar'); if (b) b.hidden = false; });
  window.addEventListener('appinstalled', () => { const b = el('btnInstalar'); if (b) b.hidden = true; });
  window.addEventListener('DOMContentLoaded', () => {
    const ir = el('btnIrSorteio');
    if (ir) ir.addEventListener('click', () => { el('app').classList.add('sem-lateral'); });
    const q = el('videoQualidade');
    if (q && matchMedia('(pointer: coarse)').matches) q.value = 'alta30'; // celular: 30 fps é mais seguro
    const b = el('btnInstalar');
    if (b) b.addEventListener('click', async () => { if (convite) { convite.prompt(); await convite.userChoice; convite = null; b.hidden = true; } });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const dica = el('dicaIOS');
    if (dica && ios && !instalado) dica.hidden = false;
  });
})();
