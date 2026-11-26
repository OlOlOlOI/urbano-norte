-- Contas da equipe e sessões (login no app).
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
