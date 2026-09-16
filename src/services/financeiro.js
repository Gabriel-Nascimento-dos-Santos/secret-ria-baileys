import db from '../config/db.js';

export async function faturamentoPorMes(ano, mes) {
  try {

    const resultado = await db`
      SELECT
        COALESCE(SUM(preco), 0) AS faturamento,
        COUNT(*) AS quantidade
      FROM db_secretaria
      WHERE EXTRACT(YEAR FROM data) = ${ano}
        AND EXTRACT(MONTH FROM data) = ${mes}
    `;

    const linha = resultado[0];

    return {
      faturamento: Number(linha.faturamento) || 0,
      quantidade: Number(linha.quantidade) || 0,
    };

  } catch (error) {

    console.error('Erro ao consultar faturamento:', error);

    return null;
  }
}