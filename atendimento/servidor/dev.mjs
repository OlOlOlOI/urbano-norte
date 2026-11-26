// Servidor do Atendimento rodando no próprio computador — só para desenvolver e testar.
// Usa o MESMO código da nuvem (src/index.js), com SQLite local no lugar do D1.
//
//   node dev.mjs [--porta 8787] [--banco arquivo.sqlite] [--meta-falsa] [--chave CHAVE]
//
// --meta-falsa: respostas e mídias não vão para a Meta de verdade (tudo é aceito na hora).
// Rota extra só daqui: POST /dev/simular {de, nome, texto, tipo, canal} — finge que um cliente mandou mensagem.
// canal: 'whatsapp' (padrão) ou 'instagram' (de = id do Instagram, usuario = @). tipo: text | image | audio | document.
import http from 'node:http';
import { createRequire } from 'node:module';
import servidor, { processarWebhook } from './src/index.js';

const { D1Local } = createRequire(import.meta.url)('./d1-local.cjs');
const arg = (nome, padrao) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : padrao; };
const porta = Number(arg('--porta', 8787));
const env = {
  DB: new D1Local(arg('--banco', ':memory:')),
  CHAVE_APP: arg('--chave', 'dev'),
  APP_SECRET: 'dev', VERIFY_TOKEN: 'dev', WHATSAPP_TOKEN: 'dev', PHONE_NUMBER_ID: '0', IG_TOKEN: 'dev',
};

if (process.argv.includes('--meta-falsa')) {
  let n = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    const u = String(url);
    if (!/graph\.facebook\.com|graph\.instagram\.com|lookaside|cdn\.exemplo/.test(u)) return real(url, op);
    if (u.includes('graph.instagram.com') && u.includes('/messages')) return Response.json({ recipient_id: '1', message_id: `ig.mid.DEV${++n}` });
    if (u.includes('graph.instagram.com') && u.includes('fields=name,username')) return Response.json({ name: perfisIg.get(u.split('/').pop().split('?')[0])?.nome || 'Cliente Instagram', username: perfisIg.get(u.split('/').pop().split('?')[0])?.usuario || 'cliente' });
    if (u.includes('/messages')) return Response.json({ messages: [{ id: `wamid.DEV${++n}` }] });
    if (u.endsWith('/media') && op && op.method === 'POST') { const id = `MIDDEV${++n}`; tiposMidia.set(id, 'image'); return Response.json({ id }); }
    const tipo = tiposMidia.get(u.split('id=').pop()) || (u.includes('audio') ? 'audio' : 'image');
    // o CDN do Instagram (cdn.exemplo) entrega como "octet-stream", igual ao de verdade: o app precisa reconhecer pelo arquivo
    if (u.includes('cdn.exemplo')) return new Response(tipo === 'audio' ? WAV : PNG, { headers: { 'Content-Type': 'application/octet-stream' } });
    if (u.includes('lookaside')) return tipo === 'audio' ? new Response(WAV, { headers: { 'Content-Type': 'audio/wav' } }) : new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    const id = u.split('/').pop().split('?')[0];
    return Response.json({ url: `https://lookaside.exemplo/arquivo?id=${id}`, mime_type: tiposMidia.get(id) === 'audio' ? 'audio/wav' : 'image/png' });
  };
}
// imagem 1x1 verde para simular fotos
const tiposMidia = new Map(); // id da mídia -> tipo (para a Meta falsa devolver o arquivo certo)
const perfisIg = new Map();   // id do Instagram -> { nome, usuario }
// 1 segundo de silêncio em WAV, para simular áudios
const WAV = (() => { const n = 8000, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b; })();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let seq = 0;
async function simular({ de = '556499990000', nome = 'Cliente', usuario, texto = 'Oi!', tipo = 'text', minutosAtras = 0, canal = 'whatsapp' }) {
  if (canal === 'instagram') {
    perfisIg.set(String(de), { nome, usuario });
    const mid = `ig.mid.SIM${Date.now()}${++seq}`;
    const message = { mid };
    if (tipo === 'text') message.text = texto;
    else message.attachments = [{ type: tipo, payload: { url: `https://cdn.exemplo/${tipo}/${mid}` } }];
    await processarWebhook(env.DB, { object: 'instagram', entry: [{ id: '17841400000000000', messaging: [{ sender: { id: String(de) }, recipient: { id: '17841400000000000' }, timestamp: Date.now() - minutosAtras * 60000, message }] }] }, env);
    return mid;
  }
  const id = `wamid.SIM${Date.now()}${++seq}`;
  const m = { id, from: de, timestamp: String(Math.floor((Date.now() - minutosAtras * 60000) / 1000)), type: tipo };
  if (tipo === 'text') m.text = { body: texto };
  else {
    tiposMidia.set(`MIDIA${seq}`, tipo);
    m[tipo] = { id: `MIDIA${seq}`, mime_type: { image: 'image/png', audio: 'audio/ogg; codecs=opus', document: 'application/pdf' }[tipo] || 'application/octet-stream', caption: tipo === 'audio' ? undefined : texto || undefined, filename: tipo === 'document' ? 'comprovante.pdf' : undefined };
  }
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
