# Urbano Norte — monorepo de sistemas

Empresa: Urbano Norte (transporte por aplicativo, Rio Verde-GO). Idioma de todos os apps e da documentação: português do Brasil.
Marca: grafite #414042, verde-escuro #007a43, verde #00a651, lima #68c52f, carvão #2b2a2c, fundo claro #f1f4f1. Fonte: Outfit.

## Sistemas

- `sorteio/` — sorteio de corridas (web PWA + desktop Electron). Contexto e regras em `sorteio/CLAUDE.md`.
- `disparo/` — disparo de campanhas por WhatsApp (desktop Electron, modo simulação). Contexto em `disparo/README.md`.

Cada sistema é independente (seu próprio `package.json`); comandos `npm` rodam dentro da pasta do sistema.
Workflows ficam em `.github/workflows/`, com o nome do sistema como prefixo; tags de versão usam o prefixo (`sorteio-v*`, `disparo-v*`).

## Unificação (planejada)

Objetivo: um app desktop só, com abas "Sorteio" e "Disparo (beta)". A versão web continua só com o sorteio.
Pontos de atenção já identificados:
- Os dois preloads expõem `window.api` e ambos têm "histórico" — separar por módulo (ex.: `api.sorteio`, `api.disparo`).
- O sorteio guarda histórico e contatos cifrados (`safeStorage`) em `userData`, que depende do nome do app; no Mac a chave fica no Keychain com o nome do app. Mudar o nome/appId exige migração, senão os dados somem.
- Sorteio usa `xlsx`; disparo usa `exceljs`. Escolher um só.

## Origem

Criado em 2026-11-25 a partir dos repositórios `OlOlOlOI/sorteio-urbano-norte` e `OlOlOlOI/disparo-de-mensagem` (histórico antigo não foi trazido; consulte os repositórios originais).
