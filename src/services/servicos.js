import db from '../config/db.js';

const meses = {
  "janeiro": 1,
  "fevereiro": 2,
  "março": 3,
  "abril": 4,
  "maio": 5,
  "junho": 6,
  "julho": 7,
  "agosto": 8,
  "setembro": 9,
  "outubro": 10,
  "novembro": 11,
  "dezembro": 12
};

async function listarServicos(mes) {

  const numeroDoMes = meses[mes.toLowerCase()]; 
    if (!numeroDoMes) {
      throw new Error('Mês inválido');
    }
  
  const lista = await db`
    SELECT cliente,servico, data, hora 
    FROM db_secretaria
    WHERE EXTRACT(MONTH FROM data) = ${numeroDoMes}
      AND data >= CURRENT_DATE
    ORDER BY data ASC, hora ASC
  `
  return lista
}

export default listarServicos

