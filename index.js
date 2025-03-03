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

// Listar Plantas (ajustado para a estrutura do Firestore)
bot.action('listar', async (ctx) => {
  try {
    const snapshot = await db.collection('plants').get();
    if (snapshot.empty) {
      ctx.reply('Nenhuma planta cadastrada ainda! 🌵');
      return;
    }

    // Log dos dados brutos para depuração
    console.log('Dados do Firestore:', snapshot.docs.map(doc => doc.data()));

    const plantas = snapshot.docs.flatMap(doc => {
      const data = doc.data();
      const items = data.items || []; // Acessa o campo "items"
      return items.map(item => {
        const apelido = item.apelido || 'Sem apelido';
        const nomeCientifico = item.nomeCientifico || 'Sem nome científico';
        const intervalo = item.intervalo || 'N/A';
        return `- ${apelido} (${nomeCientifico}) - Regar a cada ${intervalo} dias`;
      });
    }).join('\n');

    ctx.reply(`🌿 *Suas Plantas:*\n${plantas || 'Nenhuma planta cadastrada ainda! 🌵'}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Erro ao listar plantas:', err);
    ctx.reply('Ocorreu um erro ao buscar suas plantas. 😢');
  }
});

// Cadastrar Planta (ajustado para a estrutura do Firestore)
bot.action('cadastrar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('Digite o *apelido* da planta:', { parse_mode: 'Markdown' });

  // Fluxo de cadastro
  bot.on('text', async (ctx) => {
    const apelido = ctx.message.text;

    ctx.reply('Digite o *nome científico* da planta:', { parse_mode: 'Markdown' });
    bot.on('text', async (ctx) => {
      const nomeCientifico = ctx.message.text;

      ctx.reply('Digite o *intervalo de rega* (em dias):', { parse_mode: 'Markdown' });
      bot.on('text', async (ctx) => {
        const intervalo = parseInt(ctx.message.text, 10);

        if (isNaN(intervalo)) {
          ctx.reply('❌ O intervalo deve ser um número. Tente novamente!');
          return;
        }

        try {
          // Adiciona a nova planta ao array "items"
          const plantasRef = db.collection('plants').doc('lista'); // Use um ID fixo ou ajuste conforme necessário
          await plantasRef.set({
            items: admin.firestore.FieldValue.arrayUnion({
              apelido,
              nomeCientifico,
              intervalo,
              ultimaRega: new Date().toISOString()
            })
          }, { merge: true });

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

// Iniciar o bot com tratamento de conflitos
bot.launch({
  polling: {
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true // Ignora atualizações pendentes ao reiniciar
  }
}).then(() => {
  console.log('Bot iniciado com sucesso!');
}).catch(err => {
  console.error('Erro ao iniciar o bot:', err);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🟢 Servidor rodando!');
});
