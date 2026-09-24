import db from '../config/db.js'


 async function Custo ({ id, custo }) {
  const subtracao = await db`
    UPDATE db_secretaria 
    SET preco = preco - ${custo} 
    WHERE id = ${id}
    RETURNING id,preco
  `
  
  return subtracao
}


export default Custo