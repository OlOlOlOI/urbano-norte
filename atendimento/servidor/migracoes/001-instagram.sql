-- Instagram no Atendimento: canal da conversa, @ do perfil e link direto das mídias.
ALTER TABLE conversas ADD COLUMN canal TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE conversas ADD COLUMN usuario TEXT;
ALTER TABLE mensagens ADD COLUMN midia_url TEXT;
