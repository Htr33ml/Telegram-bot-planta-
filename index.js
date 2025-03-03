const { Telegraf, Scenes, session } = require('telegraf');
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

// ================= CENAS (WIZARD) =================

// Cena para cadastro de plantas
const cadastroPlanta = new Scenes.WizardScene(
  'cadastro_planta',
  (ctx) => {
    ctx.reply('📍 Primeiro, digite sua *cidade* para ajustes de rega baseados no clima:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.localizacao = ctx.message.text;
    ctx.reply('🌿 Digite o *apelido* da planta:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.apelido = ctx.message.text;
    ctx.reply('🔬 Digite o *nome científico*:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.nomeCientifico = ctx.message.text;
    ctx.reply('⏳ Digite o *intervalo de rega* (dias):', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  async (ctx) => {
    const intervalo = parseInt(ctx.message.text, 10);

    if (isNaN(intervalo)) {
      ctx.reply('❌ Intervalo inválido! Use números.');
      return ctx.scene.leave();
    }

    // Salvar planta
    const userId = ctx.from.id.toString();
    await db.collection('plants').doc(userId).set(
      {
        localizacao: ctx.wizard.state.localizacao,
        items: admin.firestore.FieldValue.arrayUnion({
          apelido: ctx.wizard.state.apelido,
          nomeCientifico: ctx.wizard.state.nomeCientifico,
          intervalo,
          ultimaRega: new Date().toISOString(),
          historicoRegas: [],
          fotos: []
        })
      },
      { merge: true }
    );

    ctx.reply('✅ *Planta cadastrada!* Use /menu para mais opções.', { parse_mode: 'Markdown' });
    return ctx.scene.leave();
  }
);

// Registrar cenas
const stage = new Scenes.Stage([cadastroPlanta]);
bot.use(session());
bot.use(stage.middleware());

// ================= FUNÇÕES AUXILIARES =================

// Função para calcular a próxima rega com base no clima
const calcularProximaRega = async (ultimaRega, intervalo, localizacao) => {
  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${localizacao}&appid=${OPENWEATHER_API_KEY}`
    );
    const { rain } = response.data;
    const intervaloAjustado = rain ? intervalo - 1 : intervalo;

    const dataUltimaRega = new Date(ultimaRega);
    dataUltimaRega.setDate(dataUltimaRega.getDate() + intervaloAjustado);
    return dataUltimaRega;

  } catch (err) {
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

// Cadastrar Planta
bot.action('cadastrar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('cadastro_planta');
});

// Listar Plantas
bot.action('listar', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();

  if (!userDoc.exists || !userDoc.data().items) {
    ctx.reply('Você ainda não cadastrou nenhuma planta.');
    return;
  }

  const plantas = userDoc.data().items;
  let mensagem = '🌿 *Suas Plantas:*\n\n';
  plantas.forEach((planta, index) => {
    mensagem += `${index + 1}. ${planta.apelido} (${planta.nomeCientifico})\n`;
  });

  ctx.reply(mensagem, { parse_mode: 'Markdown' });
});

// Ajuda
bot.action('ajuda', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('ℹ️ *Ajuda do PlantBot*\n\n' +
    '1. Use /menu para acessar o menu principal.\n' +
    '2. Cadastre suas plantas para receber lembretes de rega.\n' +
    '3. Envie fotos para acompanhar o crescimento das suas plantas.',
    { parse_mode: 'Markdown' }
  );
});

// Configurações
bot.action('config', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('⚙️ *Configurações*\n\n' +
    '1. Alterar localização\n' +
    '2. Configurar notificações',
    { parse_mode: 'Markdown' }
  );
});

// Enviar Fotos
bot.action('foto', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();

  if (!userDoc.exists || !userDoc.data().items) {
    ctx.reply('Você ainda não cadastrou nenhuma planta.');
    return;
  }

  const plantas = userDoc.data().items;
  const buttons = plantas.map(planta => [{ text: planta.apelido, callback_data: `foto_${planta.apelido}` }]);

  ctx.reply('📸 Escolha uma planta para adicionar uma foto:', {
    reply_markup: {
      inline_keyboard: buttons
    }
  });
});

// Registrar Foto
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id.toString();
  const fotoId = ctx.message.photo[0].file_id;

  const userDoc = await db.collection('plants').doc(userId).get();
  const plantas = userDoc.data().items;

  if (plantas.length > 0) {
    const planta = plantas[0]; // Adiciona a foto à primeira planta (pode ser ajustado)
    await db.collection('plants').doc(userId).update({
      items: admin.firestore.FieldValue.arrayUnion({
        ...planta,
        fotos: [...(planta.fotos || []), fotoId]
      })
    });

    ctx.reply('📸 Foto adicionada à linha do tempo!');
  }
});

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
