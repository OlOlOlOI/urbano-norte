'use strict';
// Teste visual: `npx electron test/captura.js <pasta-de-saida>`.
// Abre o app com dados temporários, confere que cada aba tem o seu window.api, troca de aba,
// entra e sai do modo vertical e salva capturas de tela. Não toca nos dados reais.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const saida = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'un-captura'));
fs.mkdirSync(saida, { recursive: true });
// dados e "apps antigos" temporários: o teste nunca lê nem migra os dados reais deste computador
app.setPath('appData', fs.mkdtempSync(path.join(os.tmpdir(), 'un-apps-')));
process.env.URBANO_PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'un-dados-'));

// servidor do Atendimento local (mesmo código da nuvem), com clientes simulados e Meta falsa
const { spawn } = require('child_process');
const PORTA_AT = 8797;
const servidorAt = spawn('node', [path.join(__dirname, '..', '..', 'atendimento', 'servidor', 'dev.mjs'), '--porta', String(PORTA_AT), '--meta-falsa', '--chave', 'teste'], { stdio: 'ignore' });
process.on('exit', () => servidorAt.kill());
process.env.URBANO_SERVIDOR = `http://127.0.0.1:${PORTA_AT}`; // login e Atendimento usam o servidor local
const simular = (dados) => fetch(`http://127.0.0.1:${PORTA_AT}/dev/simular`, { method: 'POST', body: JSON.stringify(dados) }).then((r) => r.json());

const principal = require('../main.js');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const relatorio = [];
const conferir = (nome, ok, extra = '') => { relatorio.push(`${ok ? 'OK  ' : 'FALHOU'} ${nome}${extra ? ' — ' + extra : ''}`); };

async function capturar(nome) {
  const win = principal.janela();
  const img = await win.webContents.capturePage();
  const telas = principal.telas();
  // compõe a barra + a tela visível numa imagem só
  const visivel = [principal.aba(), telas[principal.aba()]];
  fs.writeFileSync(path.join(saida, `${nome}-barra.png`), img.toPNG());
  if (principal.painel()) return; // login/equipe: o painel é a própria janela, as abas estão escondidas
  fs.writeFileSync(path.join(saida, `${nome}-tela.png`), (await visivel[1].webContents.capturePage()).toPNG());
}

const shellJs = (js) => principal.janela().webContents.executeJavaScript(js);
const visivelNoShell = (sel) => shellJs(`!document.querySelector(${JSON.stringify(sel)}).classList.contains('oculto')`);
async function preencherEnviar(form, campos) {
  return shellJs(`(() => { ${Object.entries(campos).map(([id, v]) => `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)};`).join(' ')}
    document.getElementById(${JSON.stringify(form)}).requestSubmit(); return true; })()`);
}

app.whenReady().then(async () => {
  try {
    await espera(3000);
    const t = principal.telas();

    // ---------- login ----------
    conferir('login: sem conta, abre no primeiro acesso e esconde as abas', await visivelNoShell('#form-admin') && !(await visivelNoShell('#form-entrar'))
      && principal.painel() !== null);
    await capturar('0-login-primeiro-acesso');
    await preencherEnviar('form-admin', { 'admin-chave': 'errada', 'admin-nome': 'Rayan Luiz', 'admin-usuario': 'rayan', 'admin-senha': 'senha-do-rayan', 'admin-senha2': 'senha-do-rayan' });
    await espera(800);
    const erroChave = await shellJs("document.getElementById('admin-erro').textContent");
    conferir('login: chave de instalação errada é recusada', /inválida/.test(erroChave), erroChave);
    await preencherEnviar('form-admin', { 'admin-chave': 'teste', 'admin-nome': 'Rayan Luiz', 'admin-usuario': 'rayan', 'admin-senha': 'senha-do-rayan', 'admin-senha2': 'senha-do-rayan' });
    await espera(1500);
    conferir('login: criou o administrador e mostrou as abas', !(await visivelNoShell('#painel-login')) && principal.painel() === null
      && (await shellJs("document.getElementById('conta-nome').textContent")) === 'Rayan');

    const apiSorteio = await t.sorteio.webContents.executeJavaScript('Object.keys(window.api).sort().join(",")');
    const apiDisparo = await t.disparo.webContents.executeJavaScript('Object.keys(window.api).sort().join(",")');
    conferir('sorteio tem o seu window.api', apiSorteio.includes('janelaVertical') && !apiSorteio.includes('envio'), apiSorteio.slice(0, 60) + '...');
    conferir('disparo tem o seu window.api', apiDisparo.includes('envio') && !apiDisparo.includes('janelaVertical'), apiDisparo);
    const hist = await t.sorteio.webContents.executeJavaScript('window.api.historicoObter()');
    conferir('IPC do sorteio responde (histórico)', Array.isArray(hist.itens), JSON.stringify(hist).slice(0, 80));
    const aj = await t.disparo.webContents.executeJavaScript('window.api.ajustes.ler()');
    conferir('IPC do disparo responde (ajustes)', aj.ok === true, JSON.stringify(aj).slice(0, 120));
    const tituloS = await t.sorteio.webContents.executeJavaScript('document.title');
    const tituloD = await t.disparo.webContents.executeJavaScript('document.title');
    conferir('páginas carregadas', /Sorteio/.test(tituloS) && /Disparo/.test(tituloD), `${tituloS} | ${tituloD}`);

    await capturar('1-sorteio');
    principal.mostrarAba('disparo');
    await espera(600);
    conferir('trocou para o disparo', principal.aba() === 'disparo');
    await capturar('2-disparo');
    await t.disparo.webContents.executeJavaScript("ir('config').then(() => { const h = [...document.querySelectorAll('h2')].find((e) => /WhatsApp/.test(e.textContent)); h.scrollIntoView(); return !!h; })");
    await espera(500);
    const temWhats = await t.disparo.webContents.executeJavaScript("typeof window.api.whatsapp.salvar === 'function' && !!document.querySelector('input[type=password]')");
    conferir('disparo: seção WhatsApp nas Configurações', temWhats);
    await capturar('2b-disparo-whatsapp');
    principal.mostrarAba('sorteio');
    await espera(400);

    // ---------- Atendimento ----------
    await simular({ de: '556492937604', nome: 'Ana Paula', texto: 'Boa tarde! Esqueci minha bolsa no carro ontem à noite 😥', minutosAtras: 12 });
    await simular({ de: '556492937604', nome: 'Ana Paula', tipo: 'image', texto: 'Foto da bolsa', minutosAtras: 11 });
    await simular({ de: '556299990000', nome: 'João Victor', texto: 'Qual o valor da corrida até o aeroporto?', minutosAtras: 3 });
    await simular({ de: '556481110000', nome: 'Carla', texto: 'Obrigada pelo atendimento!', minutosAtras: 60 * 30 });
    await simular({ canal: 'instagram', de: '9001', nome: 'Bia Souza', usuario: 'bia.souza', texto: 'Oi! Vocês fazem corrida pra Montividiu?', minutosAtras: 1 });
    await simular({ de: '556299990000', nome: 'João Victor', tipo: 'audio', minutosAtras: 2 });
    const ta = t.atendimento.webContents;
    const cfgConta = await ta.executeJavaScript('window.api.config.ler()');
    conferir('atendimento: usa a conta logada', cfgConta.ok && cfgConta.dados.porConta && cfgConta.dados.configurado && cfgConta.dados.operador === 'Rayan Luiz', JSON.stringify(cfgConta));
    await ta.executeJavaScript('iniciar()');
    principal.mostrarAba('atendimento');
    // o contador da aba vem da vigia, que confere o servidor a cada 20 s
    let contador = '';
    for (let i = 0; i < 25 && contador !== '6'; i++) { await espera(1000); contador = await shellJs("document.getElementById('contador-atendimento').textContent"); }
    conferir('atendimento: contador de não lidas na aba', contador === '6', `contador=${contador}`);
    const nomes = await ta.executeJavaScript("[...document.querySelectorAll('.item-nome')].map(e => e.textContent)");
    conferir('atendimento: lista WhatsApp e Instagram juntos, mais recente primeiro', JSON.stringify(nomes) === JSON.stringify(['Bia Souza', 'João Victor', 'Ana Paula', 'Carla']), JSON.stringify(nomes));
    const selos = await ta.executeJavaScript("[...document.querySelectorAll('.lista .canal')].map(e => e.textContent).join(',')");
    conferir('atendimento: selo do canal em cada conversa', selos === 'IG,WA,WA,WA', selos);
    await ta.executeJavaScript("[...document.querySelectorAll('.filtros.canais button')].find(b => b.textContent === 'Instagram').click()");
    await espera(1200);
    const soIg = await ta.executeJavaScript("[...document.querySelectorAll('.item-nome')].map(e => e.textContent).join(',')");
    conferir('atendimento: filtro só Instagram', soIg === 'Bia Souza', soIg);
    await ta.executeJavaScript("document.querySelector('.lista li button').click()");
    await espera(1200);
    const ident = await ta.executeJavaScript("document.querySelector('.conversa-topo .numero').textContent");
    conferir('atendimento: conversa do Instagram mostra o @', ident === 'Instagram · @bia.souza', ident);
    await ta.executeJavaScript("(() => { const t = document.getElementById('texto'); t.value = 'Fazemos sim, Bia! Chama pelo app Urbano Norte 🚗'; document.getElementById('btn-enviar').click(); })()");
    await espera(1500);
    const respIg = await ta.executeJavaScript("(() => { const b = [...document.querySelectorAll('.bolha.saida')].pop(); return b ? b.textContent : ''; })()");
    conferir('atendimento: responde no Instagram', /Fazemos sim, Bia/.test(respIg), respIg.slice(0, 60));
    await capturar('4b-atendimento-instagram');
    await ta.executeJavaScript("[...document.querySelectorAll('.filtros.canais button')].find(b => b.textContent === 'Todos').click()");
    await espera(1200);
    await ta.executeJavaScript("[...document.querySelectorAll('.lista li button')].find(b => b.textContent.includes('João')).click()");
    await espera(1200);
    await ta.executeJavaScript("[...document.querySelectorAll('.midia .btn')].find(b => b.textContent.includes('Ouvir')).click()");
    await espera(1500);
    const player = await ta.executeJavaScript("!!document.querySelector('.midia audio[src^=\"data:audio\"]')");
    conferir('atendimento: áudio toca dentro da conversa', player);
    await capturar('4c-atendimento-audio');
    await capturar('4-atendimento-lista');
    await ta.executeJavaScript("[...document.querySelectorAll('.lista li button')].find(b => b.textContent.includes('Ana Paula')).click()");
    await espera(1200);
    await ta.executeJavaScript("document.querySelector('.midia .btn').click()");
    await espera(1200);
    const temFoto = await ta.executeJavaScript("!!document.querySelector('.midia img')");
    conferir('atendimento: foto do cliente aparece na conversa', temFoto);
    await ta.executeJavaScript("(() => { const t = document.getElementById('texto'); t.value = 'Oi Ana! Já falamos com o motorista, ele guardou sua bolsa. Pode buscar hoje às 18h.'; document.getElementById('btn-enviar').click(); })()");
    await espera(1500);
    const ultima = await ta.executeJavaScript("(() => { const b = [...document.querySelectorAll('.bolha.saida')].pop(); return b ? b.textContent : ''; })()");
    conferir('atendimento: resposta enviada aparece com o nome de quem respondeu', /Rayan/.test(ultima) && /guardou sua bolsa/.test(ultima), ultima.slice(0, 80));
    await simular({ de: '556492937604', nome: 'Ana Paula', texto: 'Muito obrigada!! 🙏' });
    let chegou = false; // a tela confere o servidor a cada 4 s: espera até 10 s
    for (let i = 0; i < 20 && !chegou; i++) { await espera(500); chegou = await ta.executeJavaScript("[...document.querySelectorAll('.bolha.entrada')].some(b => b.textContent.includes('Muito obrigada'))"); }
    conferir('atendimento: mensagem nova do cliente aparece sozinha na conversa aberta', chegou);
    await capturar('5-atendimento-conversa');
    await ta.executeJavaScript("document.querySelector('.conversa-topo .btn-icone').click()");
    await espera(300);
    await ta.executeJavaScript("(() => { const c = document.querySelector('.conversa-topo input.apelido'); c.value = 'Passageira Ana (bolsa)'; c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
    await espera(1500);
    const apelido = await ta.executeJavaScript("[document.querySelector('.conversa-topo .nome').textContent, document.querySelector('.conversa-topo .numero').textContent, [...document.querySelectorAll('.lista .item-nome')].map(e => e.textContent).join('|')]");
    conferir('atendimento: renomear contato muda o topo e a lista e mostra o nome do perfil', apelido[0] === 'Passageira Ana (bolsa)' && /no perfil: Ana Paula/.test(apelido[1]) && apelido[2].includes('Passageira Ana (bolsa)'), JSON.stringify(apelido));
    await capturar('5b-atendimento-apelido');
    await ta.executeJavaScript("document.querySelectorAll('.lista li button')[2] && [...document.querySelectorAll('.lista li button')].find(b => b.textContent.includes('Carla')).click()");
    await espera(1200);
    const fechada = await ta.executeJavaScript("!!document.querySelector('.fechada-aviso') && !document.getElementById('texto')");
    conferir('atendimento: conversa com mais de 24 h não deixa escrever e explica o motivo', fechada);
    await capturar('6-atendimento-janela-fechada');
    principal.mostrarAba('sorteio');
    await espera(300);

    const antes = principal.janela().getContentSize();
    await t.sorteio.webContents.executeJavaScript('alternarVertical(true)');
    await espera(1200);
    const [lv, av] = principal.janela().getContentSize();
    const b = t.sorteio.getBounds();
    conferir('modo vertical: janela 9:16 e tela cobre a barra', Math.abs(lv / av - 9 / 16) < 0.02 && b.y === 0 && b.height === av, `${lv}x${av}, tela y=${b.y} h=${b.height}`);
    principal.mostrarAba('disparo');
    conferir('no modo vertical não troca de aba', principal.aba() === 'sorteio');
    fs.writeFileSync(path.join(saida, '3-vertical-tela.png'), (await t.sorteio.webContents.capturePage()).toPNG());
    await t.sorteio.webContents.executeJavaScript('alternarVertical(false)');
    await espera(1200);
    const depois = principal.janela().getContentSize();
    const b2 = t.sorteio.getBounds();
    conferir('saiu do vertical: tamanho e barra voltaram', depois[0] === antes[0] && depois[1] === antes[1] && b2.y === 48, `${antes} -> ${depois}, y=${b2.y}`);

    // ---------- equipe ----------
    await shellJs("window.shell.conta.painel('equipe')");
    await espera(800);
    conferir('equipe: o painel cobre as abas', await visivelNoShell('#painel-equipe') && principal.painel() !== null);
    await preencherEnviar('form-novo', { 'novo-nome': 'Maria Silva', 'novo-usuario': 'maria.silva', 'novo-senha': 'senha-da-maria' });
    await espera(1000);
    const linhas = await shellJs("[...document.querySelectorAll('#equipe-lista tr')].map((tr) => tr.cells[0].textContent + '|' + tr.cells[2].textContent).join(';')");
    conferir('equipe: adicionou a atendente', /Maria Silva\|Atendente/.test(linhas) && /Rayan Luiz/.test(linhas), linhas);
    const aviso = await shellJs("document.getElementById('equipe-aviso').textContent");
    conferir('equipe: mostra usuário e senha para passar à pessoa', /maria\.silva/.test(aviso) && /senha-da-maria/.test(aviso), aviso.slice(0, 90));
    await capturar('7-equipe');
    await shellJs("document.querySelector('#painel-equipe .btn-voltar').click()");
    await espera(500);
    conferir('equipe: voltar mostra as abas de novo', !(await visivelNoShell('#painel-equipe')) && principal.painel() === null);

    // ---------- sair e entrar como outra pessoa ----------
    await shellJs('window.shell.conta.sair()');
    await espera(1200);
    conferir('sair: volta para a tela de entrar', await visivelNoShell('#form-entrar') && principal.painel() !== null);
    await preencherEnviar('form-entrar', { 'entrar-usuario': 'maria.silva', 'entrar-senha': 'errada' });
    await espera(1000);
    const erroSenha = await shellJs("document.getElementById('entrar-erro').textContent");
    conferir('entrar: senha errada mostra o aviso', /incorretos/.test(erroSenha), erroSenha);
    await capturar('8-login');
    await preencherEnviar('form-entrar', { 'entrar-usuario': 'maria.silva', 'entrar-senha': 'senha-da-maria' });
    await espera(2000);
    const cfgMaria = await ta.executeJavaScript('window.api.config.ler()');
    conferir('entrar: Maria entra e o Atendimento passa a usar o nome dela', !(await visivelNoShell('#painel-login')) && cfgMaria.dados.operador === 'Maria Silva' && cfgMaria.dados.admin === false,
      JSON.stringify(cfgMaria.dados));
    const ajM = await t.disparo.webContents.executeJavaScript('window.api.ajustes.ler()');
    conferir('disparo: o nome vem da conta', ajM.dados.operador === 'Maria Silva' && ajM.dados.operadorPelaConta === true, JSON.stringify(ajM.dados).slice(0, 120));
    const eq = await shellJs('window.shell.conta.equipe.listar()');
    conferir('atendente não vê a equipe', eq.ok === false && /administrador/.test(eq.erro), eq.erro);
  } catch (e) {
    conferir('execução', false, e.stack);
  }
  const texto = relatorio.join('\n');
  fs.writeFileSync(path.join(saida, 'relatorio.txt'), texto + '\n');
  console.log(texto);
  app.exit(relatorio.some((l) => l.startsWith('FALHOU')) ? 1 : 0);
});
