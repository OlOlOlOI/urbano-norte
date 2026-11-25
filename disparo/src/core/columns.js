'use strict';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Escolhe a coluna com maior pontuação (precisa ser > 0). */
function melhor(headers, pontuar) {
  let escolhida = '';
  let max = 0;
  for (const h of headers) {
    const p = pontuar(norm(h));
    if (p > max) { max = p; escolhida = h; }
  }
  return escolhida;
}

/**
 * Adivinha quais colunas da planilha são telefone, nome e autorização.
 * Exportações de corrida costumam ter dados do passageiro E do motorista:
 * colunas de motorista perdem pontos, colunas de passageiro/cliente ganham.
 */
function adivinharColunas(headers) {
  const doMotorista = /motorista|condutor|veiculo|placa/;
  const doPassageiro = /passageir|cliente|usuari/;

  const telefone = melhor(headers, (h) => {
    if (!/tel|cel|whats|zap|fone/.test(h)) return 0;
    return 1 + (doPassageiro.test(h) ? 2 : 0) - (doMotorista.test(h) ? 5 : 0);
  });

  const nome = melhor(headers, (h) => {
    if (/tel|cel|whats|fone|mail|cpf|cnpj|rg\b|id\b|data|valor/.test(h)) return 0;
    if (!/nome|passageir|cliente/.test(h)) return 0;
    return 1 + (doPassageiro.test(h) ? 2 : 0) + (/^nome\b|completo/.test(h) ? 1 : 0)
      - (doMotorista.test(h) ? 5 : 0) - (/login|usuario|empresa|fantasia|rua|mae/.test(h) ? 3 : 0);
  });

  const aceite = melhor(headers, (h) => (/aceit|opt.?in|consent|autoriz|permit|lgpd|receber/.test(h) ? 1 : 0));

  return { telefone, nome, aceite };
}

/** Colunas do mapa que não existem mais na planilha (ex.: alguém renomeou). */
function colunasFaltando(mapa, headers) {
  const set = new Set(headers);
  return ['telefone', 'nome', 'aceite'].filter((k) => mapa && mapa[k] && !set.has(mapa[k])).map((k) => mapa[k]);
}

module.exports = { adivinharColunas, colunasFaltando };
