import db from '../config/db.js'

async function getLembretes() {

    let lembretes = await db`
SELECT cliente, servico, data, hora
FROM db_secretaria
WHERE data = CURRENT_DATE + 1;`
 if (lembretes.length > 0){
    return lembretes
 } else {
    return 
 }
}

export default getLembretes