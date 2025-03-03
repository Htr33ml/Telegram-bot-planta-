const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios'); // Para integração com clima

// ================= 🔥 FIREBASE =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ================= 🌦️ OPENWEATHERMAP =================
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Variáveis de estado
let cadastroState = {};
let edicaoState = {};

// ================= FUNÇÕES AUXILIARES =================

// Função para calcular a próxima rega com base no clima
const calcularProximaRega = async (ultimaRega, intervalo, localizacao) => {
  try {
    // Obter previsão do tempo
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${localizacao}&appid=${OPENWEATHER_API_KEY}`
    );
    const { rain } = response.data;

    // Ajustar intervalo se chover nos próximos dias
    const intervaloAjustado = rain ? intervalo - 1 : intervalo;

    const dataUltimaRega = new Date(ultimaRega);
    dataUltimaRega.setDate(dataUltimaRega.getDate() + intervaloAjustado);
    return dataUltimaRega;

  } catch (err) {
    // Se falhar, usar intervalo padrão
    const dataUltimaRega = new Date(ultimaRega);
    dataUltimaRega.setDate(dataUltimaRega.getDate() + intervalo);
    return dataUltimaRega;
  }
};

// Função para enviar lembretes de rega
const enviarLembretes = async () => {
  const snapshot = await db.collection('plants').get();
  snapshot.docs.forEach(async (doc) => {
    const userData = doc.data();
    const plantas = userData.items || [];
    const localizacao = userData.localizacao || 'São Paulo'; // Default

    plantas.forEach(async (planta) => {
      const hoje = new Date();
      const proximaRega = await calcularProximaRega(planta.ultimaRega, planta.intervalo, localizacao);

      if (hoje >= proximaRega) {
        await bot.telegram.sendMessage(
          doc.id,
          `🌧️ *Hora de regar a ${planta.apelido}!*\n` +
          `_Previsão de chuva: ${proximaRega.getDate() === hoje.getDate() ? 'Sim' : 'Não'}_\n` +
          'Clique em "Regar" abaixo:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Regar Agora", callback_data: `regar_${planta.apelido}` }],
                [{ text: "🔔 Lembrar mais tarde", callback_data: 'ignorar' }]
              ]
            }
          }
        );
      }
    });
  });
};

// Agendar lembretes a cada hora
cron.schedule('0 * * * *', enviarLembretes);

// ================= COMANDOS PRINCIPAIS =================

// Menu Principal
bot.command('menu', (ctx) => {
  ctx.reply('🌱 *Menu do PlantBot*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌿 Cadastrar Planta", callback_data: "cadastrar" }],
        [{ text: "📋 Minhas Plantas", callback_data: "listar" }],
        [{ text: "📸 Enviar Foto", callback_data: "foto" }],
        [{ text: "⚙️ Configurações", callback_data: "config" }],
        [{ text: "❓ Ajuda", callback_data: "ajuda" }]
      ]
    }
  });
});

// Cadastrar Planta (com localização e clima)
bot.action('cadastrar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('📍 Primeiro, digite sua *cidade* para ajustes de rega baseados no clima:', { parse_mode: 'Markdown' });

  bot.on('text', async (ctx) => {
    const localizacao = ctx.message.text;
    const userId = ctx.from.id.toString();

    // Salvar localização
    await db.collection('plants').doc(userId).set({ localizacao }, { merge: true });

    // Fluxo de cadastro da planta
    ctx.reply('🌿 Digite o *apelido* da planta:', { parse_mode: 'Markdown' });
    cadastroState[userId] = { step: 'apelido' };

    bot.on('text', (ctx, next) => {
      if (cadastroState[userId]?.step === 'apelido') {
        cadastroState[userId].apelido = ctx.message.text;
        cadastroState[userId].step = 'nomeCientifico';
        ctx.reply('🔬 Digite o *nome científico*:', { parse_mode: 'Markdown' });
      } else {
        next();
      }
    });

    bot.on('text', (ctx, next) => {
      if (cadastroState[userId]?.step === 'nomeCientifico') {
        cadastroState[userId].nomeCientifico = ctx.message.text;
        cadastroState[userId].step = 'intervalo';
        ctx.reply('⏳ Digite o *intervalo de rega* (dias):', { parse_mode: 'Markdown' });
      } else {
        next();
      }
    });

    bot.on('text', async (ctx) => {
      if (cadastroState[userId]?.step === 'intervalo') {
        const intervalo = parseInt(ctx.message.text, 10);

        if (isNaN(intervalo)) {
          ctx.reply('❌ Intervalo inválido! Use números.');
          return;
        }

        // Salvar planta
        await db.collection('plants').doc(userId).update({
          items: admin.firestore.FieldValue.arrayUnion({
            apelido: cadastroState[userId].apelido,
            nomeCientifico: cadastroState[userId].nomeCientifico,
            intervalo,
            ultimaRega: new Date().toISOString(),
            historicoRegas: [],
            fotos: []
          })
        });

        ctx.reply('✅ *Planta cadastrada!* Use /menu para mais opções.', { parse_mode: 'Markdown' });
        delete cadastroState[userId];
      }
    });
  });
});

// Enviar Fotos
bot.action('foto', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('📸 Escolha uma planta para adicionar uma foto:', {
    reply_markup: {
      inline_keyboard: (await getPlantasButtons(ctx.from.id)).concat([[{ text: "🚫 Cancelar", callback_data: "cancelar" }]])
    }
  });
});

// Registrar Foto
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id.toString();
  const fotoId = ctx.message.photo[0].file_id;

  if (edicaoState[userId]?.plantaParaFoto) {
    await db.collection('plants').doc(userId).update({
      items: admin.firestore.FieldValue.arrayUnion({
        apelido: edicaoState[userId].plantaParaFoto,
        fotos: admin.firestore.FieldValue.arrayUnion(fotoId)
      })
    });

    ctx.reply('📸 Foto adicionada à linha do tempo!');
    delete edicaoState[userId];
  }
});

// Editar/Remover Plantas
bot.action(/editar_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  edicaoState[userId] = { planta: apelido, step: 'editar' };

  ctx.reply(`✏️ Editar *${apelido}*:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "✏️ Renomear", callback_data: `renomear_${apelido}` }],
        [{ text: "⏳ Alterar Intervalo", callback_data: `alterar_intervalo_${apelido}` }],
        [{ text: "🗑️ Remover", callback_data: `remover_${apelido}` }],
        [{ text: "🚫 Cancelar", callback_data: "cancelar" }]
      ]
    }
  });
});

// Histórico de Regas
bot.action(/historico_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const planta = userDoc.data().items.find(p => p.apelido === apelido);

  ctx.reply(`📅 Histórico de regas de *${apelido}:*\n${planta.historicoRegas.map(d => `- ${new Date(d).toLocaleString()}`).join('\n') || 'Nenhuma rega registrada.'}`, 
    { parse_mode: 'Markdown' }
  );
});

// ================= FUNÇÕES AUXILIARES =================

// Gerar botões das plantas
const getPlantasButtons = async (userId) => {
  const userDoc = await db.collection('plants').doc(userId.toString()).get();
  return userDoc.data()?.items?.map(planta => [
    { 
      text: planta.apelido, 
      callback_data: `detalhes_${planta.apelido}` 
    }
  ]) || [];
};

// ================= INICIALIZAÇÃO =================

bot.launch({
  polling: {
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
  }
}).then(() => console.log('Bot iniciado! 🚀'));

app.listen(process.env.PORT || 3000, () => {
  console.log('🟢 Servidor rodando!');
});
