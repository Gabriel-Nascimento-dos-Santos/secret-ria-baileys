import db from '../config/db.js';

export function converterData(data) {
  if(!data || typeof data !== 'string') return null;
  const partes =data.split('/');
  const agora = new Date();
  const ano = agora.getFullYear();

  let dia='';
  let mes='';

  if(partes.length === 1){
    dia = partes[0];
    mes = String (agora.getMonth() + 1);
    } else if(partes.length === 2){
    dia = partes[0];
    mes = partes[1];
  }else{
    return null;
  }

  if(!dia || !mes) return null;
  return `${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
}

export function interpretarMensagemAgendamento(texto) {
  const linhas = texto.split('\n').map(item => item.trim()).filter(Boolean);

  if (linhas[0]?.toLowerCase().includes('novo agendamento')) {
    linhas.shift();
  }

  const textoLimpo = linhas.join(' ');
  const partes = textoLimpo.split('-').map(item => item.trim());

  const nome = partes[0]?.trim();
  const servico = partes[1]?.trim();
  const data = partes[2]?.trim();
  let preco = null;
  let hora = null;

  if (partes.length === 5) {
    hora = partes[3]?.trim();
    preco = partes[4]?.trim();
  } else if (partes.length === 4) {
    hora = partes[3]?.trim();
  } else {
    return null;
  }

  if (!nome || !servico || !data || !hora) {
    return null;
  }

  return { nome, servico, data, hora, preco };
}

export async function criarAgendamento({ cliente, servico, data, hora, preco }) {
  if (!cliente || !servico || !data || !hora) {
    return { erro: 'Campos obrigatórios faltando.' };
  }

  try {
    const filtro = await db`
      SELECT * FROM db_secretaria
      WHERE data = ${data}
      AND hora = ${hora}
    `;

    if (filtro.length > 0) {
      return { erro: 'Já existe um agendamento para esta data e hora.' };
    }
  } catch (error) {
    console.error('Erro ao verificar agendamento existente:', error);
    return { erro: 'Erro ao verificar agendamento existente.' };
  }

  try {
    const resultado = await db`
      INSERT INTO "db_secretaria"
      (cliente, servico, data, hora, preco)
      VALUES
      (${cliente}, ${servico}, ${data}, ${hora}, ${preco ?? null})
      RETURNING id;
    `;

    return { agendamento: resultado[0] };
  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    return { erro: 'Erro ao criar agendamento.' };
  }
}

export async function buscarTodosAgendamentos() {
  return await db`
    SELECT *
    FROM db_secretaria
    ORDER BY data, hora
  `;
}