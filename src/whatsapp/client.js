import express from 'express';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { faturamentoPorMes } from '../services/financeiro.js';
import getLembretes from '../services/lembrete.js';
import Custo from '../services/custo.js';
import listarServicos  from '../services/servicos.js';
import { 
  criarAgendamento, 
  interpretarMensagemAgendamento, 
  converterData, 
  buscarTodosAgendamentos,
} from '../services/agendamento.js';

dotenv.config();

const GRUPO_AGENDA_ID = process.env.ID_GP;

// ---------- Servidor Express ----------
const app = express();
app.use(express.json());

app.post('/agendamentos', async (req, res) => {
  const resultado = await criarAgendamento(req.body);
  if (resultado.erro) return res.status(400).json({ error: resultado.erro });
  res.json({ message: 'Agendamento criado com sucesso!', ...resultado });
});

app.get('/agendamentos', async (req, res) => {
  try {
    const agendamentos = await buscarTodosAgendamentos();
    res.json(agendamentos);
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// ---------- Bot do WhatsApp (Baileys) ----------
function isMensagemGatilho(texto) {
  if (typeof texto !== 'string' || !texto.trim())return false;
  const partes = texto.split(/[---]/);
  return partes.length >=4;
}

function isMensagemFinanceiro(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return false;
  return /^(financeiro|faturamento)$/i.test(texto.trim());
}

function isMensagemCusto(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return false;
  return /^(custo|despesa)\s*-/i.test(texto.trim());
}

  function isMensagemListaServicos (texto){
    if (typeof texto !== 'string' || !texto.trim())
       return false
    
    return /^(lista de servi[cç]os|servi[cç]os agendados)/i.test(texto.trim());
  }

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  function enviarLembretes(sock) {
    getLembretes().then(lembretes => {
      if (lembretes && lembretes.length > 0) {
        const listaFormatada = lembretes.map(l =>
          `👤 *Cliente:* ${l.cliente}\n` +
          `🛠️ *Serviço:* ${l.servico}\n` +
          `📅 *Data:* ${l.data}\n` +
          `⏰ *Hora:* ${l.hora}`
        ).join('\n\n');

        return sock.sendMessage(GRUPO_AGENDA_ID, {
          text: `📅 *Lembretes para amanhã:*\n\n${listaFormatada}`,
        });
      }
    });
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Escaneie o QR Code abaixo:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const deveReconectar = motivo !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectar?', deveReconectar);
      if (deveReconectar) iniciarBot();
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');
      enviarLembretes(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const remetenteGrupo = msg.key.remoteJid;
    if (remetenteGrupo?.endsWith('@g.us')) {
      console.log('MENSAGEM DE GRUPO:', remetenteGrupo);
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (
      texto.startsWith('⚠️') || 
      texto.startsWith('✅') || 
      texto.startsWith('💰') || 
      texto.startsWith('📅') ||
      texto.startsWith('📋') 
    ) {
      return;
    }

    console.log('Mensagem recebida de:', remetenteGrupo, '->', texto);

    if (remetenteGrupo !== GRUPO_AGENDA_ID) return;

    // Comando Financeiro
    if (isMensagemFinanceiro(texto)) {
      const agora = new Date();
      const ano = agora.getFullYear();
      const mes = agora.getMonth() + 1;

      const resultado = await faturamentoPorMes(ano, mes);

      if (!resultado) {
        await sock.sendMessage(remetenteGrupo, {
          text: '⚠️ Não foi possível obter o faturamento para o mês selecionado.',
        });
        return;
      }

      await sock.sendMessage(remetenteGrupo, {
        text: `💰 Faturamento de ${mes}/${ano}:\n\n` +
              `Mês: ${mes}/${ano}\n` +
              `Faturamento: R$ ${resultado.faturamento.toFixed(2)}\n` +
              `Serviços realizados: ${resultado.quantidade}`
      });
      return;
    }

    // Comando Custo
    if (isMensagemCusto(texto)) {
      const partes = texto.split('-').map(item => item.trim());
      const id = partes[1]?.trim();
      const valorCusto = partes[2]?.trim();

      if (!id || !valorCusto) {
        await sock.sendMessage(remetenteGrupo, {
          text: '⚠️ Formato inválido. Envie no formato: "custo - ID - Valor"',
        });
        return;
      }

      const resultado = await Custo({ id: parseInt(id), custo: parseFloat(valorCusto) });

      if (resultado.erro) {
        await sock.sendMessage(remetenteGrupo, {
          text: `⚠️ Erro ao atualizar o custo: ${resultado.erro}`,
        });
        return;
      }

      await sock.sendMessage(remetenteGrupo, {
        text: `✅ Custo atualizado com sucesso!`,
      });
      return;
    }

    // Fluxo de Lista de Serviços
    if (isMensagemListaServicos(texto)) {
      const partes = texto.split('-').map(item => item.trim());
      const mes = partes[1]?.trim();

      if (!mes) {
        await sock.sendMessage(remetenteGrupo, {
          text: '⚠️ Por favor, informe o mês no formato: "lista de serviços - mês"',
        });
        return;
      }
        try {
        const lista = await listarServicos(mes);

        if (!lista || lista.length === 0) {
          await sock.sendMessage(remetenteGrupo, {
            text: `⚠️ Não há serviços agendados para o mês ${mes}.`,
          });
          return;
        }
      
        const formatarData = (dataStr) => {
          const d = new Date(dataStr);
          return d.toLocaleDateString('pt-BR')
        };

        const resposta = lista.map(item =>
          `👤 *Cliente:* ${item.cliente}\n` +
          `🛠️ *Serviço:* ${item.servico}\n` +
          `📅 *Data:* ${formatarData(item.data)}\n` +
          `⏰ *Hora:* ${item.hora}`
        ).join('\n\n---------------------\n\n');
        await sock.sendMessage(remetenteGrupo,{
          text: `📋 *Serviços agendados para ${mes}:*\n\n${resposta}`
        })
      } catch (error) {
        await sock.sendMessage(remetenteGrupo, {
          text: `⚠️ Erro ao buscar serviços para o mês ${mes}: ${error.message}`,
        });
        return;
      }
    }

    // Fluxo de Agendamento
    if (!isMensagemGatilho(texto)){return;}
    const dados = interpretarMensagemAgendamento(texto);

    if (!dados) {
      await sock.sendMessage(remetenteGrupo, {
        text:
          '⚠️ Não entendi o formato. Envie separado por hífens como nestes exemplos:\n\n' +
          '📝 **Sem o Preço:**\n' +
          'Virginia - Instalação de coifa - 27/09 - 14:00\n\n' +
          '💰 **Com o Preço (opcional):**\n' +
          'Virginia - Instalação de coifa - 27/09 - 14:00 - 300.00R$',
      });
      return;
    }

    const dataFormatada = converterData(dados.data);

    if (!dataFormatada) {
      await sock.sendMessage(remetenteGrupo, {
        text: '⚠️ Data inválida. Por favor, envie no formato DD/MM (ex: 02/10) ou apenas o dia DD.',
      });
      return;
    }
    try {
    const resultado = await criarAgendamento({
      cliente: dados.nome,
      servico: dados.servico,
      data: dataFormatada,
      hora: dados.hora,
      preco: dados.preco,
    });

    if (resultado.erro) {
      await sock.sendMessage(remetenteGrupo, {
        text: `⚠️ Erro ao salvar: ${resultado.erro}`,
      });
      return;
    }

    await sock.sendMessage(remetenteGrupo, {
      text:
        `✅ Agendamento registrado!\n\n` +
        `👤 Cliente: ${dados.nome}\n` +
        `🛠️ Serviço: ${dados.servico}\n` +
        `📅 Data: ${dados.data}\n` +
        `⏰ Hora: ${dados.hora || 'Não especificada'}\n` +
        `💰 Valor: ${dados.preco || 'Não especificado'}\n` +
        `🆔 ID: ${resultado.agendamento.id}`,
    });
    } catch (error) {
      console.error('Erro ao criar agendamento:', error);
      await sock.sendMessage(remetenteGrupo, {
        text: '⚠️ Ocorreu um erro ao processar o agendamento. Por favor, tente novamente.',
      });
    }
  })
}


iniciarBot();

app.listen(process.env.PORT, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT}`);
});