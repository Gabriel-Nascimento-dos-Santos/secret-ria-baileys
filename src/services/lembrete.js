import db from '../config/db.js'

function formatarHora(hora){
    return hora.slice(0, 5);
}

function formatarData(data){
    const partes = data.toISOString().split('-');
    return `${partes[2].slice(0, 2)}/${partes[1]}/${partes[0]}`;
}


async function getLembretes() {

    let lembretes = await db`
SELECT cliente, servico, data, hora
FROM db_secretaria
WHERE data = CURRENT_DATE + 1 `;

 if (lembretes.length > 0){
   lembretes = lembretes.map(l=> ({
      ...l,
      hora: formatarHora(l.hora),
      data: formatarData(l.data)
   }))

    return lembretes
 } else {
    return 
 }
}

export default getLembretes