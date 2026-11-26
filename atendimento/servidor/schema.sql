-- Banco do Atendimento (Cloudflare D1 / SQLite).
-- Datas em milissegundos desde 1970 (Date.now()).

CREATE TABLE IF NOT EXISTS conversas (
  wa_id TEXT PRIMARY KEY,            -- contato: número do WhatsApp (só dígitos) ou "ig_<id>" no Instagram
  canal TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | instagram
  nome TEXT,                         -- nome do perfil
  usuario TEXT,                      -- @ do Instagram
  apelido TEXT,                      -- nome dado pela equipe no Atendimento (vale mais que o do perfil)
  previa TEXT,                       -- texto curto da última mensagem
  ultima_msg_em INTEGER NOT NULL,    -- última mensagem (entrada ou saída)
  ultima_entrada_em INTEGER,         -- última mensagem DO CLIENTE: abre a janela de 24 h
  nao_lidas INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'aberta', -- aberta | resolvida
  atualizada_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mensagens (
  id TEXT PRIMARY KEY,               -- wamid da Meta
  wa_id TEXT NOT NULL,
  direcao TEXT NOT NULL,             -- entrada | saida
  tipo TEXT NOT NULL,                -- text | image | audio | video | document | sticker | location | contacts | ...
  texto TEXT,
  midia_id TEXT,
  midia_mime TEXT,
  midia_nome TEXT,
  midia_url TEXT,                    -- Instagram: link direto do arquivo (no WhatsApp a mídia é buscada pelo midia_id)
  status TEXT NOT NULL,              -- recebida | enviada | entregue | lida | falhou
  erro TEXT,
  operador TEXT,                     -- quem respondeu (saídas)
  criada_em INTEGER NOT NULL,
  atualizada_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens (wa_id, criada_em);
CREATE INDEX IF NOT EXISTS idx_mensagens_atualizada ON mensagens (wa_id, atualizada_em);
CREATE INDEX IF NOT EXISTS idx_conversas_ultima ON conversas (ultima_msg_em);

-- Contas da equipe (ver src/contas.js). Senhas só como hash PBKDF2; sessões só como hash do token.
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,      -- login, minúsculo (ex.: maria.silva)
  nome TEXT NOT NULL,                -- aparece nas respostas para a equipe
  senha_hash TEXT NOT NULL,          -- pbkdf2$voltas$sal$hash
  papel TEXT NOT NULL DEFAULT 'atendente', -- admin | atendente
  ativo INTEGER NOT NULL DEFAULT 1,
  falhas INTEGER NOT NULL DEFAULT 0, -- senhas erradas seguidas
  bloqueado_ate INTEGER,
  ultimo_acesso INTEGER,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,       -- SHA-256 do token que fica no computador
  usuario_id INTEGER NOT NULL,
  dispositivo TEXT,                  -- nome do computador, para a equipe reconhecer
  criada_em INTEGER NOT NULL,
  ultimo_uso INTEGER NOT NULL,
  expira_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes (usuario_id);

-- Quem clicou em "Não quero receber" numa campanha do Disparo.
CREATE TABLE IF NOT EXISTS descadastros (
  wa_id TEXT PRIMARY KEY,            -- número do WhatsApp (só dígitos, como a Meta manda)
  criado_em INTEGER NOT NULL,
  origem TEXT                        -- ex.: botao
);
