// Servidor do Atendimento rodando no próprio computador — só para desenvolver e testar.
// Usa o MESMO código da nuvem (src/index.js), com SQLite local no lugar do D1.
//
//   node dev.mjs [--porta 8787] [--banco arquivo.sqlite] [--meta-falsa] [--chave CHAVE]
//
// --meta-falsa: respostas e mídias não vão para a Meta de verdade (tudo é aceito na hora).
// Rota extra só daqui: POST /dev/simular {de, nome, texto} — finge que um cliente mandou mensagem.
import http from 'node:http';
import { createRequire } from 'node:module';
import servidor, { processarWebhook } from './src/index.js';

const { D1Local } = createRequire(import.meta.url)('./d1-local.cjs');
const arg = (nome, padrao) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : padrao; };
const porta = Number(arg('--porta', 8787));
const env = {
  DB: new D1Local(arg('--banco', ':memory:')),
  CHAVE_APP: arg('--chave', 'dev'),
  APP_SECRET: 'dev', VERIFY_TOKEN: 'dev', WHATSAPP_TOKEN: 'dev', PHONE_NUMBER_ID: '0',
};

if (process.argv.includes('--meta-falsa')) {
  let n = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    if (!String(url).includes('graph.facebook.com') && !String(url).includes('lookaside')) return real(url, op);
    if (String(url).includes('/messages')) return Response.json({ messages: [{ id: `wamid.DEV${++n}` }] });
    if (String(url).includes('lookaside')) return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    return Response.json({ url: 'https://lookaside.exemplo/arquivo', mime_type: 'image/png' });
  };
}
// imagem 1x1 verde para simular fotos
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let seq = 0;
async function simular({ de = '556499990000', nome = 'Cliente', texto = 'Oi!', tipo = 'text', minutosAtras = 0 }) {
  const id = `wamid.SIM${Date.now()}${++seq}`;
  const m = { id, from: de, timestamp: String(Math.floor((Date.now() - minutosAtras * 60000) / 1000)), type: tipo };
  if (tipo === 'text') m.text = { body: texto }; else m[tipo] = { id: `MIDIA${seq}`, mime_type: tipo === 'image' ? 'image/png' : 'application/pdf', caption: texto || undefined, filename: tipo === 'document' ? 'comprovante.pdf' : undefined };
  await processarWebhook(env.DB, { entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: nome } }], messages: [m] } }] }] });
  return id;
}

const srv = http.createServer(async (req, res) => {
  const pedacos = [];
  for await (const p of req) pedacos.push(p);
  const corpo = Buffer.concat(pedacos);
  if (req.method === 'POST' && req.url === '/dev/simular') {
    const id = await simular(JSON.parse(corpo.toString() || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, id }));
    return;
  }
  const r = await servidor.fetch(new Request(`http://localhost:${porta}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corpo }), env, null);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
srv.listen(porta, '127.0.0.1', () => console.log(`[atendimento-dev] http://127.0.0.1:${porta}  chave: ${env.CHAVE_APP}`));
