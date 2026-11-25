# Sorteio Urbano Norte — contexto do projeto

Empresa: Urbano Norte (transporte por aplicativo, Rio Verde-GO). Idioma do app: português do Brasil.
O app lê a planilha de corridas (CSV/XLSX), sorteia uma corrida e mostra **O.S, dia da corrida, pessoa sorteada, motorista**.
Os resultados são divulgados no Instagram (Reels e Stories), por isso há uma versão vertical e gravação de vídeo.

## Estrutura

Esta pasta fica dentro do monorepo `urbano-norte`; os caminhos abaixo são relativos a `sorteio/`.


- `web/` — versão para celular (PWA instalável), publicada no GitHub Pages: https://olololoi.github.io/sorteio-urbano-norte/
  - `api-web.js` substitui o que no desktop é Electron/IPC (`window.api`): leitura de planilha, histórico, contatos, Face ID/PIN, salvar vídeo.
  - `mobile.js` / `mobile.css` — modo mobile (barra de abas, janela de Ajustes, janelas centralizadas acima do teclado).
  - `sw.js` — service worker (rede primeiro). Ao mudar arquivos, aumente `VERSAO` em `sw.js` e o rótulo "Versão web" no `index.html`.
- `desktop/` — app Electron (Windows .exe e Mac .dmg), versão 1.12.0. Código da interface em `desktop/renderer/`.
- `.github/workflows/sorteio-web.yml` (na raiz do monorepo) — publica `sorteio/web/` no GitHub Pages (dois jobs: montar e publicar).
- `.github/workflows/sorteio-desktop.yml` (na raiz do monorepo) — gera .exe/.dmg ao criar uma tag `sorteio-v*` ou manualmente.

## Regras que não podem ser quebradas

1. **Telefone e e-mail de passageiros nunca aparecem em tela compartilhada/pública** (resultado, vídeo, imagem). Só na janela "Contato", aberta por clique, e no Excel exportado.
2. Na web, contatos ficam **cifrados** no aparelho (AES-GCM, chave não exportável no IndexedDB). O acesso é por **Face ID/digital (WebAuthn)** e/ou **PIN**. "Esqueci meu PIN" apaga contatos, PIN e Face ID (os nomes do histórico ficam).
3. A planilha nunca sai do aparelho; não há servidor.
4. Rótulo neutro "Pessoa sorteada" (há homens e mulheres).
5. O vídeo do sorteio dura sempre 10 s, 1080x1920, fluido (30 ou 60 fps), com a logo animada e corte seco do carro para o nome.
6. No desktop, o dono prefere correções dentro da mesma versão (1.12.0) em vez de subir o número.

## Notas técnicas

- `web/` e `desktop/renderer/` compartilham quase toda a interface (cópias; uma correção costuma valer nas duas).
- Vídeo: WebCodecs + mp4-muxer; reserva com MediaRecorder. No iPhone não há `ImageDecoder`: a logo animada usa `vendor/omggif.js` e o sprite `assets/abertura-quadros.png`.
- Compartilhar vídeo no iPhone exige um toque novo depois de gravar (janela "Vídeo pronto!").
- Cores: grafite #414042, verde-escuro #007a43, verde #00a651, lima #68c52f, carvão #2b2a2c, fundo claro #f1f4f1. Fonte: Outfit.
- Teste local da web: `python3 -m http.server 8765 -d sorteio/web` (a partir da raiz do monorepo).

## Ainda não verificado em iPhone de verdade

Faixa branca no app da Tela de Início, teclado com janelas, logo animada no vídeo gravado, fluxo de salvar vídeo.

## Projeto relacionado

O sistema de disparo de mensagens (WhatsApp) fica em `../disparo/`, no mesmo monorepo. A intenção é juntar os dois em um app só, em abas, com "(beta)" na aba do disparo. Ainda não decidido como se ligam.
