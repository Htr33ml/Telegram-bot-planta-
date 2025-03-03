const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');

// ================= 🔥 FIREBASE (FIRESTORE) =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // 👈 Isso já aponta para seu Firestore automaticamente

// Teste de conexão
admin.firestore().listCollections()
  .then(collections => {
    console.log('✅ Firebase conectado! Coleções:', collections.map(c => c.id));
  })
  .catch(err => {
    console.error('🔥 ERRO NO FIREBASE:', err);
  });

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Menu
bot.command('menu', (ctx) => {
  ctx.reply('🌱 *Menu PlantBot*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "Cadastrar Planta 🌿", callback_data: "cadastrar" }],
        [{ text: "Ver Plantas 📋", callback_data: "listar" }]
      ]
    }
  });
});

// Listar Plantas
bot.action('listar', async (ctx) => {
  try {
    const plantas = await admin.firestore().collection('plantas').get();
    const lista = plantas.docs.map(doc => `- ${doc.data().nome}`).join('\n');
    ctx.reply(lista || 'Nenhuma planta cadastrada! 🌵');
  } catch (err) {
    console.error('Erro ao listar:', err);
    ctx.reply('Erro no banco de dados! 😢');
  }
});

// Saúde do Servidor
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bot vivo! 🌟' });
});

// Iniciar
bot.launch();
app.listen(process.env.PORT || 3000, () => {
  console.log('🟢 Servidor rodando!');
});
