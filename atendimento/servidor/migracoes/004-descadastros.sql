-- Quem clicou em "Não quero receber" numa campanha do Disparo (o Disparo busca esta lista antes de enviar).
CREATE TABLE IF NOT EXISTS descadastros (
  wa_id TEXT PRIMARY KEY,            -- número do WhatsApp (só dígitos, como a Meta manda)
  criado_em INTEGER NOT NULL,
  origem TEXT                        -- ex.: botao
);
