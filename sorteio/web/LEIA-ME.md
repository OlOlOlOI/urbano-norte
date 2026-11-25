# Sorteio Urbano Norte — versão web instalável (celular)

Mesma tela do aplicativo de computador, em um site que se instala no celular (Android e iPhone).
Tudo funciona **dentro do aparelho**: a planilha não é enviada para a internet; histórico, contatos e
personalização ficam guardados no navegador do celular.

## Como colocar no ar (precisa de HTTPS)
**GitHub Pages (grátis):**
1. Crie um repositório (pode ser privado só se o plano permitir Pages; senão, público — o site não contém dados, só o app).
2. A publicação é feita pelo workflow `.github/workflows/sorteio-web.yml`, na raiz do monorepo `urbano-norte`.
3. Em *Settings → Pages → Source*, escolha **GitHub Actions**. O endereço sai como `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

Alternativas: Netlify Drop (arraste a pasta), Cloudflare Pages ou qualquer hospedagem com HTTPS.

## Como instalar no celular
- **Android (Chrome):** abra o endereço → botão **Instalar o aplicativo** (ou menu ⋮ → *Instalar app*).
- **iPhone (Safari):** abra o endereço → **Compartilhar** → **Adicionar à Tela de Início**.
Depois de aberto uma vez, funciona sem internet.

## Diferenças em relação ao computador
- **Contato** e **Excel com contato** pedem um **PIN** (4 a 8 números, criado no primeiro uso). Trava de novo ao sair do app ou após 2 minutos.
- Vídeo e imagem saem pelo menu **Compartilhar** do celular (dá para mandar direto ao Instagram ou salvar na galeria). Se o celular pedir, toque em **Salvar o vídeo pronto**.
- Vídeo no celular vem em 30 fps por padrão (1080×1920).
- Não existe "escolher pasta": quem decide onde salvar é o celular.
- **Limpar histórico** apaga também os contatos guardados. Limpar os dados do navegador apaga tudo (exporte o Excel antes).

## Segurança — o que o PIN protege e o que não protege
Os telefones ficam cifrados no navegador e só aparecem depois do PIN. Isso protege contra quem pegar o celular
desbloqueado e abrir o app. Não substitui a senha/biometria do celular: mantenha o bloqueio de tela ligado.
