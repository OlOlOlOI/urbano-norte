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
  fs.writeFileSync(path.join(saida, `${nome}-tela.png`), (await visivel[1].webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  try {
    await espera(3000);
    const t = principal.telas();
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
    const ta = t.atendimento.webContents;
    const cfgOk = await ta.executeJavaScript(`window.api.config.salvar({ url: 'http://127.0.0.1:${PORTA_AT}', chave: 'teste', operador: 'Rayan' })`);
    conferir('atendimento: conecta ao servidor', cfgOk.ok === true, JSON.stringify(cfgOk));
    const cfgErrado = await ta.executeJavaScript(`window.api.config.salvar({ url: 'http://127.0.0.1:${PORTA_AT}', chave: 'errada', operador: 'Rayan' })`);
    conferir('atendimento: chave errada é recusada', cfgErrado.ok === false && /chave/i.test(cfgErrado.erro), cfgErrado.erro);
    const urlHttp = await ta.executeJavaScript(`window.api.config.salvar({ url: 'http://exemplo.com', chave: 'x', operador: 'Rayan' })`);
    conferir('atendimento: exige https', urlHttp.ok === false && /https/.test(urlHttp.erro));
    await ta.executeJavaScript('iniciar()');
    principal.mostrarAba('atendimento');
    await espera(2500);
    const contador = await principal.janela().webContents.executeJavaScript("document.getElementById('contador-atendimento').textContent");
    conferir('atendimento: contador de não lidas na aba', contador === '4', `contador=${contador}`);
    const nomes = await ta.executeJavaScript("[...document.querySelectorAll('.item-nome')].map(e => e.textContent)");
    conferir('atendimento: lista conversas abertas, mais recente primeiro', JSON.stringify(nomes) === JSON.stringify(['João Victor', 'Ana Paula', 'Carla']), JSON.stringify(nomes));
    await capturar('4-atendimento-lista');
    await ta.executeJavaScript("document.querySelectorAll('.lista li button')[1].click()");
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
    await espera(5500);
    const chegou = await ta.executeJavaScript("[...document.querySelectorAll('.bolha.entrada')].some(b => b.textContent.includes('Muito obrigada'))");
    conferir('atendimento: mensagem nova do cliente aparece sozinha na conversa aberta', chegou);
    await capturar('5-atendimento-conversa');
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
  } catch (e) {
    conferir('execução', false, e.stack);
  }
  const texto = relatorio.join('\n');
  fs.writeFileSync(path.join(saida, 'relatorio.txt'), texto + '\n');
  console.log(texto);
  app.exit(relatorio.some((l) => l.startsWith('FALHOU')) ? 1 : 0);
});
