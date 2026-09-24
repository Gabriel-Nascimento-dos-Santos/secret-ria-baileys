import express from 'express';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason,} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import db from '../config/db.js';
import dotenv from 'dotenv';
import { faturamentoPorMes } from '../services/financeiro.js'
import getLembretes from '../services/lembrete.js'
import Custo from '../services/custo.js'

dotenv.config();

const GRUPO_AGENDA_ID = process.env.ID_GP 



async function criarAgendamento ({ cliente, servico, data, hora, preco }) {
  if (!cliente || !servico || !data || !hora) {
    return { erro: 'Campos obrigatórios faltando.' }
  }
  try{
  const filtro = await db`
  SELECT * FROM db_secretaria
  WHERE data = ${data}
  AND hora = ${hora}
  `
  if (filtro.length >0){
    return { erro: 'Já existe um agendamento para esta data e hora.' }
  }
} catch (error) {
  console.error('Erro ao verificar agendamento existente:', error);
  return { erro: 'Erro ao verificar agendamento existente.' };
}
  try{
    const resultado = await db`
      INSERT INTO "db_secretaria"
      (cliente, servico, data, hora, preco)
      VALUES
      (${cliente}, ${servico}, ${data}, ${ hora }, ${preco  ?? null})
      RETURNING id;
    `;

    return {
       agendamento: resultado[0] 
      };
  
  
    } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    return { erro: 'Erro ao criar agendamento.' };
  }

}

// ---------- Servidor Express (API opcional, ex: pra consultar via navegador) ----------
const app = express()
app.use(express.json())

app.post('/agendamentos',async (req, res) => {
  const resultado = await criarAgendamento(req.body)
  if (resultado.erro) return res.status(400).json({ error: resultado.erro })
  res.json({ message: 'Agendamento criado com sucesso!', ...resultado })
}) 


app.get('/agendamentos', async (req, res) => {
  try {
    const agendamentos = await db`
      SELECT *
      FROM db_secretaria
      ORDER BY data, hora
    `

    res.json(agendamentos)

  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error)

    res.status(500).json({
      error: 'Erro ao buscar agendamentos'
    })
  }
})


// ---------- Bot do WhatsApp (Baileys) ----------
  function isMensagemFinanceiro (texto){
    if (typeof texto !== 'string' || !texto.trim())
       return false
    
    return /^(financeiro|faturamento)$/i.test(texto.trim())
  }


  function isMensagemCusto (texto){
    if (typeof texto !== 'string' || !texto.trim())
       return false
    
     return /^(custo|despesa)\s*-/i.test(texto.trim())
  }


async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }), // esconde o ruído de sincronização de histórico
  })


  function enviarLembretes(sock) {
  getLembretes().then(lembretes => {
    if (lembretes && lembretes.length > 0) {
      const listaFormatada = lembretes.map(l =>
        `👤 *Cliente:* ${l.cliente}\n` +
        `🛠️ *Serviço:* ${l.servico}\n` +
        `📅 *Data:* ${l.data}\n` +
        `⏰ *Hora:* ${l.hora}`
      ).join('\n\n') 

      return sock.sendMessage(GRUPO_AGENDA_ID, {
        text: `📅 *Lembretes para amanhã:*\n\n${listaFormatada}`,
      })
    }
  })
}


  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('Escaneie o QR Code abaixo:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode
      const deveReconectar = motivo !== DisconnectReason.loggedOut
      console.log('Conexão fechada. Reconectar?', deveReconectar)
      if (deveReconectar) iniciarBot()
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!')
      
      enviarLembretes(sock)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if ( !msg.message ) return

    const remetenteGrupo = msg.key.remoteJid

  
    if (remetenteGrupo?.endsWith('@g.us')) {
      console.log('MENSAGEM DE GRUPO:', remetenteGrupo)
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''

       if (texto.startsWith('⚠️') || 
          texto.startsWith('✅') || 
          texto.startsWith('💰') ||
          texto.startsWith('📅')) {
    return
  }

    console.log('Mensagem recebida de:', remetenteGrupo, '->', texto)

    if (remetenteGrupo !== GRUPO_AGENDA_ID) return

    if (isMensagemFinanceiro(texto)) {
      const agora = new Date ()
      const ano = agora.getFullYear()
      const mes = agora.getMonth() + 1

      const resultado = await faturamentoPorMes(ano, mes)

      if (!resultado) {
        await sock.sendMessage(remetenteGrupo, {
          text: '⚠️ Não foi possível obter o faturamento para o mês selecionado.',
        })
        return
      }

      await sock.sendMessage(remetenteGrupo, {
        text: `💰 Faturamento de ${mes}/${ano}:\n\n` +
              `Mês: ${mes}/${ano}\n` +
              `Faturamento: R$ ${resultado.faturamento.toFixed(2)}\n` +
              `Serviços realizados: ${resultado.quantidade}`
          
      })
      return
    }
//Comando para subtrair custo do valor total

    if (isMensagemCusto(texto)) {
      const partes = texto.split('-').map(item => item.trim())

      const id = partes[1]?.trim();
      const valorCusto = partes[2]?.trim();

      if (!id || !valorCusto) {
        await sock.sendMessage(remetenteGrupo, {
          text: '⚠️ Formato inválido. Envie no formato: "custo - ID - Valor"',
        })
        return
      }

      const resultado = await Custo({ id: parseInt(id), custo: parseFloat(valorCusto) })
      console.log(resultado);

      if (resultado.erro) {
        await sock.sendMessage(remetenteGrupo, {
          text: `⚠️ Erro ao atualizar o custo: ${resultado.erro}`,
        })
        return
      }

      await sock.sendMessage(remetenteGrupo, {
        text: `✅ Custo atualizado com sucesso!`,
      })
      return
    }

//Comando para criar agendamento

    function isMensagemGatilho(texto) {
      if (typeof texto !== 'string' || !texto.trim()) return false
      
      const posGatilho = texto.search(/novo\s+agendamento/i)
      if (posGatilho === -1) return false

      const posNome = texto.search(/nome:/i)
      if (posNome === -1) return true

      return posGatilho < posNome

    }

    function converterData(data){
      const [dia, mes] = data.split('/');
      
      const ano = new Date().getFullYear();

      return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
    }

    function interpretarMensagem(texto) {
      const linhas = texto.split('\n').map(item => item.trim()).filter(Boolean);

        if(linhas[0].toLowerCase().includes('novo agendamento')) {
       linhas.shift(); 
      }

      const textoLimpo = linhas.join(' ')

      const partes = textoLimpo.split('-').map(item => item.trim())


      const nome = partes[0]?.trim();
      const servico = partes[1]?.trim();
      const data = partes[2]?.trim();
      let preco  = null; 
      let hora = null;
    
      if (partes.length === 5) {
        hora = partes[3]?.trim();
        preco = partes[4]?.trim();
      } else if (partes.length === 4) {
        hora = partes[3]?.trim();
      } else{
          return null;
      }
    
      if(!nome || !servico || !data || !hora){
         return null;
      }
      return { nome, servico, data, hora, preco };
    };

    const dados = interpretarMensagem(texto)

    if (!dados) {
      await sock.sendMessage(remetenteGrupo, {
        text:
         '⚠️ Não entendi o formato. Envie separado por hífens como nestes exemplos:\n\n' +
      '📝 **Sem o Preço:**\n' +
      'Virginia - Instalação de coifa - 27/09 - 14:00\n\n' +
      '💰 **Com o Preço (opcional):**\n' +
      'Virginia - Instalação de coifa - 27/09 - 14:00 - 300.00R$',
      })
      return
    }

    // Chamada direta à função, sem precisar de HTTP/fetch
    const resultado = await criarAgendamento({
      cliente: dados.nome,
      servico: dados.servico,
      data: converterData(dados.data),
      hora: dados.hora,
      preco: dados.preco,
    })

    if (resultado.erro) {
      await sock.sendMessage(remetenteGrupo, {
        text: `⚠️ Erro ao salvar: ${resultado.erro}`,
      })
      return
    }

    await sock.sendMessage(remetenteGrupo, {
      text:
        `✅ Agendamento registrado!\n\n` +
        `👤 Cliente: ${dados.nome}\n` +
        `🛠️ Serviço: ${dados.servico}\n` +
        `📅 Data: ${dados.data}\n` +
        `⏰ Hora: ${dados.hora || 'Não especificada'}\n` +
        `💰 Valor: ${dados.preco || 'Não especificado'}\n`+
        `🆔 ID: ${resultado.agendamento.id} `,
    })
  })


} 


iniciarBot()


app.listen(process.env.PORT, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT}`)
})
