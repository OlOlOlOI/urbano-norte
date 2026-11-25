# Urbano Norte — sistemas

Repositório único com todos os sistemas desenvolvidos para a Urbano Norte (transporte por aplicativo, Rio Verde-GO).

| Pasta | Sistema | Plataforma |
|---|---|---|
| [`sorteio/web/`](sorteio/web) | Sorteio de corridas — versão celular (PWA) | Navegador / GitHub Pages |
| [`sorteio/desktop/`](sorteio/desktop) | Sorteio de corridas — versão computador | Electron (Windows .exe, Mac .dmg) |
| [`disparo/`](disparo) | Disparo de campanhas por WhatsApp (modo simulação) | Electron (Windows .exe, Mac .dmg) |
| [`app/`](app) | **App unificado**: Sorteio + Disparo (beta) em abas | Electron (Windows .exe, Mac .dmg) |

## Automações (aba Actions)

| Workflow | Quando roda |
|---|---|
| `Sorteio (web) - publicar site` | A cada push em `main` que altere `sorteio/web/` |
| `Sorteio (desktop) - gerar instaladores` | Manualmente ou com uma tag `sorteio-v*` (ex.: `sorteio-v1.12.0`) |
| `Disparo (desktop) - gerar instaladores` | Manualmente ou com uma tag `disparo-v*` (ex.: `disparo-v0.1.0`) |
| `App unificado (desktop) - gerar instaladores` | Manualmente ou com uma tag `app-v*` (ex.: `app-v1.0.0`) |

## App unificado

`app/` junta o sorteio e o disparo em um app só, reaproveitando o código das pastas `sorteio/desktop` e `disparo/src`. Veja `app/LEIA-ME.md`.

## Novo sistema

Crie uma pasta nova na raiz (ex.: `nome-do-sistema/`), com seu próprio `package.json`, e um workflow em `.github/workflows/` com o prefixo do sistema.
