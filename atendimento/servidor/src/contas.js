// Contas da equipe: cada pessoa entra com usuário e senha; o app guarda uma sessão (token) por 30 dias.
//
// - Senhas: PBKDF2-SHA256 com sal próprio (nunca em texto). 100 mil voltas é o máximo que o Worker aceita.
// - Sessão: o app recebe um token aleatório; o banco guarda só o hash dele (vazou o banco, não vazam sessões).
// - Erros seguidos: 5 senhas erradas bloqueiam a conta por 15 minutos.
// - Papéis: "admin" (cria e desativa contas) e "atendente".
// - A primeira conta (administrador) só pode ser criada com a CHAVE_APP, e só enquanto não existe nenhuma conta.

export const SESSAO_MS = 30 * 24 * 60 * 60 * 1000;
const RENOVAR_MS = 60 * 60 * 1000;          // grava "último uso" no máximo 1x por hora (o app consulta a cada 20 s)
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const VOLTAS = 100000;
const PAPEIS = ['admin', 'atendente'];

const agora = () => Date.now();
const bytesB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const b64Bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function pbkdf2(senha, sal, voltas) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: voltas }, chave, 256);
}

export async function cifrarSenha(senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${VOLTAS}$${bytesB64(sal)}$${bytesB64(await pbkdf2(senha, sal, VOLTAS))}`;
}

export async function senhaConfere(senha, guardada) {
  const [tipo, voltas, sal, hash] = String(guardada || '').split('$');
  if (tipo !== 'pbkdf2' || !sal || !hash) return false;
  const calc = new Uint8Array(await pbkdf2(senha, b64Bytes(sal), Number(voltas)));
  const esperado = b64Bytes(hash);
  let dif = calc.length ^ esperado.length;
  for (let i = 0; i < Math.max(calc.length, esperado.length); i++) dif |= (calc[i] ?? 0) ^ (esperado[i] ?? 0);
  return dif === 0;
}

const hashToken = async (token) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

// ---------- validações ----------
export function validarUsuario(bruto) {
  const u = String(bruto || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Erro400('Usuário: de 3 a 40 letras minúsculas, números, ponto, traço ou _ (sem espaço nem acento). Ex.: maria.silva');
  return u;
}
export function validarSenha(bruto) {
  const s = String(bruto || '');
  if (s.length < 8) throw new Erro400('A senha precisa ter pelo menos 8 caracteres.');
  if (s.length > 200) throw new Erro400('Senha longa demais.');
  return s;
}
function validarNome(bruto) {
  const n = String(bruto || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n) throw new Erro400('Informe o nome da pessoa (aparece nas respostas para a equipe).');
  return n;
}
export class Erro400 extends Error {}

const publico = (u) => u && ({ id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel, ativo: Boolean(u.ativo), criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso ?? null });

// ---------- sessões ----------
async function abrirSessao(db, usuario, dispositivo) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const t = agora();
  await db.batch([
    db.prepare('INSERT INTO sessoes (token_hash, usuario_id, dispositivo, criada_em, ultimo_uso, expira_em) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hashToken(token), usuario.id, String(dispositivo || '').slice(0, 80) || null, t, t, t + SESSAO_MS),
    db.prepare('UPDATE usuarios SET falhas = 0, bloqueado_ate = NULL, ultimo_acesso = ? WHERE id = ?').bind(t, usuario.id),
    db.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(t), // faxina
  ]);
  return { token, usuario: publico({ ...usuario, ultimo_acesso: t }), expira_em: t + SESSAO_MS };
}

/** Confere o "Authorization: Bearer <token>". Devolve a conta (ativa) ou null. Renova a sessão (30 dias desde o último uso). */
export async function contaDaSessao(db, request) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const th = await hashToken(m[1].toLowerCase());
  const s = await db.prepare(`SELECT s.token_hash, s.ultimo_uso, s.expira_em, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                              WHERE s.token_hash = ?`).bind(th).first();
  const t = agora();
  if (!s || s.expira_em < t || !s.ativo) return null;
  if (t - s.ultimo_uso > RENOVAR_MS) {
    await db.batch([
      db.prepare('UPDATE sessoes SET ultimo_uso = ?, expira_em = ? WHERE token_hash = ?').bind(t, t + SESSAO_MS, th),
      db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').bind(t, s.id),
    ]);
  }
  return { ...publico(s), token_hash: th };
}

// ---------- rotas sem sessão ----------
export async function estado(db) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM usuarios').first();
  return { temContas: Number(r && r.n) > 0 };
}

export async function primeiroAdmin(db, env, corpo, igualSeguro) {
  if (!env.CHAVE_APP || !igualSeguro(String(corpo.chave || ''), env.CHAVE_APP)) return { status: 401, erro: 'Chave de instalação inválida.' };
  if ((await estado(db)).temContas) return { status: 409, erro: 'O administrador já foi criado. Entre com o seu usuário e senha.' };
  const u = { usuario: validarUsuario(corpo.usuario), nome: validarNome(corpo.nome), senha: validarSenha(corpo.senha) };
  const t = agora();
  const r = await db.prepare(`INSERT INTO usuarios (usuario, nome, senha_hash, papel, ativo, falhas, criado_em, atualizado_em)
                              VALUES (?, ?, ?, 'admin', 1, 0, ?, ?) RETURNING *`).bind(u.usuario, u.nome, await cifrarSenha(u.senha), t, t).first();
  return { status: 200, dados: await abrirSessao(db, r, corpo.dispositivo) };
}

export async function entrar(db, corpo) {
  const usuario = String(corpo.usuario || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  const u = usuario ? await db.prepare('SELECT * FROM usuarios WHERE usuario = ?').bind(usuario).first() : null;
  const t = agora();
  const recusa = { status: 401, erro: 'Usuário ou senha incorretos.' };
  if (!u) { await cifrarSenha(senha || 'x'); return recusa; } // mesmo tempo de resposta: não entrega quem existe
  if (u.bloqueado_ate && u.bloqueado_ate > t) {
    return { status: 429, erro: `Muitas tentativas erradas. Tente de novo em ${Math.ceil((u.bloqueado_ate - t) / 60000)} min ou peça ao administrador para trocar a senha.` };
  }
  if (!(await senhaConfere(senha, u.senha_hash))) {
    const falhas = (u.falhas || 0) + 1;
    await db.prepare('UPDATE usuarios SET falhas = ?, bloqueado_ate = ? WHERE id = ?')
      .bind(falhas >= MAX_FALHAS ? 0 : falhas, falhas >= MAX_FALHAS ? t + BLOQUEIO_MS : null, u.id).run();
    return recusa;
  }
  if (!u.ativo) return { status: 403, erro: 'Esta conta foi desativada. Fale com o administrador.' };
  return { status: 200, dados: await abrirSessao(db, u, corpo.dispositivo) };
}

// ---------- rotas com sessão ----------
export async function sair(db, conta) {
  await db.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(conta.token_hash).run();
}

export async function trocarMinhaSenha(db, conta, corpo) {
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').bind(conta.id).first();
  if (!(await senhaConfere(String(corpo.atual || ''), u.senha_hash))) return { status: 400, erro: 'A senha atual não confere.' };
  const nova = validarSenha(corpo.nova);
  await db.batch([
    db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?').bind(await cifrarSenha(nova), agora(), u.id),
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?').bind(u.id, conta.token_hash), // sai dos outros computadores
  ]);
  return { status: 200, dados: true };
}

export async function listarEquipe(db) {
  const { results } = await db.prepare('SELECT * FROM usuarios ORDER BY ativo DESC, nome COLLATE NOCASE').all();
  return results.map(publico);
}

export async function criarConta(db, corpo) {
  const u = { usuario: validarUsuario(corpo.usuario), nome: validarNome(corpo.nome), senha: validarSenha(corpo.senha), papel: PAPEIS.includes(corpo.papel) ? corpo.papel : 'atendente' };
  if (await db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').bind(u.usuario).first()) return { status: 409, erro: `Já existe uma conta com o usuário "${u.usuario}".` };
  const t = agora();
  const r = await db.prepare(`INSERT INTO usuarios (usuario, nome, senha_hash, papel, ativo, falhas, criado_em, atualizado_em)
                              VALUES (?, ?, ?, ?, 1, 0, ?, ?) RETURNING *`).bind(u.usuario, u.nome, await cifrarSenha(u.senha), u.papel, t, t).first();
  return { status: 200, dados: publico(r) };
}

/** Admin muda nome, papel, ativo ou senha de alguém. Desativar ou trocar a senha derruba as sessões dessa pessoa. */
export async function alterarConta(db, conta, id, corpo) {
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').bind(Number(id)).first();
  if (!u) return { status: 404, erro: 'Conta não encontrada.' };
  const novo = { nome: u.nome, papel: u.papel, ativo: u.ativo, senha_hash: u.senha_hash };
  if (corpo.nome !== undefined) novo.nome = validarNome(corpo.nome);
  if (corpo.papel !== undefined) { if (!PAPEIS.includes(corpo.papel)) return { status: 400, erro: 'Papel inválido.' }; novo.papel = corpo.papel; }
  if (corpo.ativo !== undefined) novo.ativo = corpo.ativo ? 1 : 0;
  const trocaSenha = corpo.senha !== undefined && corpo.senha !== '';
  if (trocaSenha) novo.senha_hash = await cifrarSenha(validarSenha(corpo.senha));

  if (u.id === conta.id && (novo.papel !== 'admin' || !novo.ativo)) return { status: 400, erro: 'Você não pode tirar o seu próprio acesso de administrador nem desativar a sua conta.' };
  const derruba = trocaSenha || (u.ativo && !novo.ativo);
  const ops = [db.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ?, senha_hash = ?, falhas = ?, bloqueado_ate = ?, atualizado_em = ? WHERE id = ?')
    .bind(novo.nome, novo.papel, novo.ativo, novo.senha_hash, trocaSenha ? 0 : u.falhas, trocaSenha ? null : u.bloqueado_ate, agora(), u.id)];
  if (derruba) ops.push(db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(u.id));
  await db.batch(ops);
  return { status: 200, dados: publico({ ...u, ...novo }) };
}
