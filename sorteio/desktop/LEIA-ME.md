# Sorteio Urbano Norte

Aplicativo de desktop (Windows e Mac) que lê uma planilha de Excel e sorteia uma corrida,
mostrando **O.S**, **dia da corrida**, **passageira** e **motorista**.

## Como usar o app

1. Clique em **Escolher planilha** e abra o arquivo (.xlsx, .xls ou .csv).
2. Confira as colunas. O app tenta reconhecer pelos títulos (O.S, Dia/Data, Passageira, Motorista).
   Se os títulos não estiverem na primeira linha, ajuste **Linha dos títulos**.
3. Marque as regras: por padrão, a mesma O.S não é sorteada duas vezes. Também dá para impedir
   repetição de passageira e de motorista.
4. Clique em **Sortear**. Cada resultado entra na lista de sorteios realizados.
5. **Salvar em Excel** exporta a lista (com data e hora de cada sorteio) como comprovante.

O app lê o CSV exportado pelo sistema de corridas (separado por ponto e vírgula, com acentos
em Windows-1252) e também planilhas .xlsx. Ao abrir, ele reconhece sozinho as colunas
`Nº OS`, `Momento da solicitação`, `Nome do passageiro` e `Motorista`. Em **Sortear só entre as
corridas com**, escolha por exemplo `Categoria` e depois `Urbano Delas` para restringir o sorteio.

Para testar, use o arquivo `planilha-exemplo.xlsx`.

## Ícone do aplicativo

O ícone (cartão de sorteio com a grade de hexágonos) está em `build/icon.png` (Mac, 1024×1024) e `build/icon-win.png` (Windows e janela do app, 512×512), ambos com fundo transparente. Para trocar, substitua esses dois arquivos e gere o app de novo. O ícone aparece no arquivo `.exe`, na janela, na barra de tarefas e, no Mac, no `.dmg` e no aplicativo.

## Sorteio, histórico e contato

- Ao clicar em **Sortear**, um carro anda pela rua enquanto o sistema escolhe. Os nomes não ficam trocando na tela, e o bilhete mantém sempre o mesmo tamanho. Nomes muito longos diminuem a letra para caber em duas linhas.
- O histórico **não aparece na tela principal**. Ele fica salvo no computador (mesmo depois de fechar o app) e é aberto pela barra lateral, em **Histórico > Ver histórico**, com busca. Clicar em um sorteio da lista mostra o bilhete dele de novo e seleciona o contato dele.
- O botão **Contato** (canto superior direito) abre a aba com o **telefone e o e-mail** da pessoa sorteada, com botões para copiar. Ele só abre quando você clica. Feche a aba antes de compartilhar a tela.
- Telefone e e-mail são buscados pelo sistema na planilha e guardados fora do histórico, criptografados pelo Windows/Mac. Se o computador não oferecer essa proteção, o contato só aparece com a planilha daquele sorteio aberta.
- **Salvar em Excel (com contato)** exporta o histórico inteiro, com telefone e e-mail.
- A regra de não repetir (O.S, passageiro, motorista) vale dentro da mesma planilha. Para começar do zero, use **Limpar histórico** (apaga tudo, inclusive os contatos guardados).

## Reels e Stories (formato vertical)

Na barra lateral, em **Reels e Stories**:

- **Modo vertical (9:16):** a janela vira uma tela em pé, no formato dos Reels e Stories, com a logo no topo, o bilhete, a animação do carro e o botão **Sortear**. Os elementos ficam dentro das áreas seguras do Instagram (longe do topo e da base, onde o app cobre a tela). Comece a gravar a tela, clique em **Sortear** (ou aperte Espaço/Enter) e pronto.
  - Windows: grave com a Barra de Jogos (Win + G) ou com o OBS. Mac: Cmd + Shift + 5.
  - Ao mexer o mouse aparece, no topo, a barra com **Salvar imagem** e **Sair do modo vertical**. Ela some sozinha depois de alguns segundos, para não aparecer na gravação. A tecla Esc também sai.
  - Telefone e e-mail nunca aparecem neste modo.
- **Gravar vídeo do sorteio (10 s):** um clique faz tudo. O sistema sorteia, o carro anda por 5 segundos, o resultado é revelado com confete e fica na tela até completar 10 segundos. Depois o app pede onde salvar o vídeo (MP4, vertical 1080×1920, pronto para Reels e Stories). Não precisa ligar gravador de tela.
  - No vídeo, a logo aparece no topo com a animação (a logo animada da marca ou o seu GIF) e depois fica parada, completa. A animação do fundo é a que você escolheu em **Personalização** (hexágonos, confete ou nenhuma), e o confete da revelação segue a opção **Chuva de confete ao sortear**.
  - O resultado aparece de uma vez, sem transição: o carro para (5 s) e o nome entra no lugar.
  - O vídeo é desenhado pelo próprio app, então sai sempre no mesmo tamanho, sem a barra lateral e sem telefone nem e-mail. Enquanto grava, a tela mostra uma prévia do vídeo; **Esc** cancela (nesse caso o sorteio não acontece nem entra no histórico, se ainda não tiver sido revelado).
  - A pessoa sorteada entra no histórico normalmente no momento da revelação.
  - **Qualidade do vídeo:** *Máxima* (1080×1920, 60 fps), *Alta* (1080×1920, 30 fps) ou *Leve* (720×1280, 30 fps, para computadores fracos). "60 fps" significa mais fluidez, não mais velocidade: o vídeo sempre dura 10 segundos e a gravação roda na velocidade real, com a prévia na tela. Cada quadro é desenhado no seu instante exato, então não trava mesmo em computadores mais lentos (nesses, a gravação só demora um pouco mais que 10 s). Antes de salvar, o app confere se o arquivo tem todos os quadros e 10 segundos; se não tiver, refaz com outro codificador. A pessoa sorteada só entra no histórico quando o vídeo termina.
  - Se a janela de salvar for fechada sem salvar, o vídeo pronto fica guardado e aparece o botão **Salvar o vídeo pronto**.
  - Se o computador não tiver o codificador de vídeo necessário, o app grava em tempo real (30 fps, pode travar em máquinas fracas) como alternativa.
  - O vídeo não tem som. Coloque a música direto no editor do Instagram.
- **Onde salvar:** em **Escolher pasta…** você define a pasta de vídeos e imagens (e **Abrir pasta** abre ela). Marque **Salvar direto nessa pasta, sem perguntar** para não aparecer a janela de salvar toda vez (se já existir um arquivo com o mesmo nome, o app acrescenta (2), (3)…). Sem isso, o app pergunta e já abre na última pasta usada. Depois de salvar, a barra lateral mostra o caminho e o botão **Mostrar o arquivo salvo**.
- **Salvar imagem do resultado:** gera um PNG de 1080×1920, pronto para postar nos Stories, com o resultado que está na tela. Não leva telefone nem e-mail.

## Personalização

Na barra lateral, em **Personalização**:

- **Título do bilhete:** o texto acima do nome sorteado (padrão: "Pessoa sorteada"). Pode ser trocado por "Ganhador(a)", "Contemplado(a)" etc.
- **Nome do sorteio:** aparece como uma etiqueta acima do bilhete (ex.: "Sorteio de aniversário").
- **Trocar logo…:** escolha um PNG, JPG, GIF, WebP ou SVG (até 4 MB). Se for um GIF animado, ele continua tocando na barra lateral, no bilhete e na abertura. Para a imagem dos Stories e para o vídeo, o app usa o quadro completo da logo (sem o fundo claro do GIF) e anima a logo no topo do vídeo. **Logo padrão** volta ao emblema da marca.
- **Cores:** principal (botões e detalhes), destaque e fundo escuro. **Restaurar cores da marca** volta à paleta oficial.
- **Animação do fundo:** hexágonos flutuantes, confete ou nenhuma. **Chuva de confete ao sortear** liga ou desliga a comemoração no resultado.
- **Mostrar a animação da logo ao abrir:** liga ou desliga a abertura (clique ou qualquer tecla para pular).

As escolhas ficam salvas no computador e valem nas próximas aberturas.

**Fonte da marca:** o app usa a Outfit (livre) e, se a fonte Neulis Neue estiver instalada no computador, usa ela automaticamente.

## Como gerar o .exe e o .dmg

O .dmg só pode ser criado em um Mac, e o .exe é melhor criado no Windows.
O jeito mais simples de gerar os dois sem ter os dois computadores é o GitHub (grátis):

1. Crie um repositório privado em github.com e envie todos os arquivos desta pasta.
2. No repositório, abra a aba **Actions**, escolha **Gerar instaladores** e clique em **Run workflow**.
3. Em cerca de 5 a 10 minutos, baixe os arquivos em **Artifacts**:
   - `instalador-windows-latest`: instalador `.exe` e versão portátil `.exe` (não precisa instalar)
   - `instalador-macos-latest`: um único `.dmg` universal, que roda direto em Macs Intel e Apple Silicon (M1, M2, M3...), sem precisar do Rosetta

### Gerar no seu próprio computador

Instale o Node.js (versão 20 ou mais nova) e, dentro desta pasta:

```
npm install
npm start            # abre o app para testar
npm run build:win    # gera o .exe (rode no Windows)
npm run build:mac    # gera o .dmg (rode no Mac)
```

Os arquivos ficam na pasta `dist`.

## Avisos na primeira abertura

O app não tem assinatura digital paga, então:

- **Windows:** pode aparecer "O Windows protegeu o computador". Clique em *Mais informações* e depois *Executar assim mesmo*.
- **Mac:** clique com o botão direito no app, escolha *Abrir* e confirme.

## Requisitos e problemas comuns

- **Windows:** precisa ser Windows 10 ou 11 de 64 bits. Se o `.exe` portátil não abrir, use o `.zip` da pasta: extraia tudo (clique direito, *Extrair tudo*) e abra `Sorteio Urbano Norte.exe` de dentro da pasta. Antivírus às vezes bloqueiam o `.exe` portátil porque ele se descompacta sozinho ao abrir.
- **Mac:** use o `.dmg` universal. Os `.dmg` antigos para Intel pedem o Rosetta nos Macs com chip M1 ou mais novo.
