const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');

// ================= 🔥 FIREBASE =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Menu Principal
bot.command('menu', (ctx) => {
  ctx.reply('🌱 *Menu do PlantBot*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "Cadastrar Planta 🌿", callback_data: "cadastrar" }],
        [{ text: "Minhas Plantas 📋", callback_data: "listar" }]
      ]
    }
  });
});

// Listar Plantas (CAMPOS CORRETOS)
bot.action('listar', async (ctx) => {
  try {
    const snapshot = await db.collection('plants').get();
    if (snapshot.empty) {
      ctx.reply('Nenhuma planta cadastrada ainda! 🌵');
      return;
    }

    const plantas = snapshot.docs.map(doc => {
      const data = doc.data();
      const apelido = data.apelido || 'Sem apelido';
      const nomeCientifico = data.nomeCientifico || 'Sem nome científico'; // Campo sem acento!
      const intervalo = data.intervalo || 'N/A';
      return `- ${apelido} (${nomeCientifico}) - Regar a cada ${intervalo} dias`;
    }).join('\n');

    ctx.reply(`🌿 *Suas Plantas:*\n${plantas}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Erro ao listar plantas:', err);
    ctx.reply('Ocorreu um erro ao buscar suas plantas. 😢');
  }
});

// Cadastrar Planta (CAMPOS CORRETOS)
bot.action('cadastrar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('Digite o *apelido* da planta:', { parse_mode: 'Markdown' });

  // Fluxo de cadastro
  bot.on('text', async (ctx) => {
    const apelido = ctx.message.text;

    ctx.reply('Digite o *nome científico* da planta:', { parse_mode: 'Markdown' });
    bot.on('text', async (ctx) => {
      const nomeCientifico = ctx.message.text; // Variável sem acento!

      ctx.reply('Digite o *intervalo de rega* (em dias):', { parse_mode: 'Markdown' });
      bot.on('text', async (ctx) => {
        const intervalo = parseInt(ctx.message.text, 10);

        try {
          await db.collection('plants').add({
            apelido,
            nomeCientifico, // Campo sem acento!
            intervalo,
            ultimaRega: new Date().toISOString()
          });
          ctx.reply('✅ Planta cadastrada com sucesso!');
        } catch (err) {
          console.error('Erro ao cadastrar:', err);
          ctx.reply('❌ Erro ao salvar a planta. Tente novamente!');
        }
      });
    });
  });
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bot operante! 🌟' });
});

// Iniciar
bot.launch();
app.listen(process.env.PORT || 3000, () => {
  console.log('🟢 Servidor rodando!');
});
