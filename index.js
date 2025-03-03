const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');

// ================= 🔥 FIREBASE =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Conexão com o Firestore

// Teste de conexão
db.listCollections()
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

// Listar Plantas
bot.action('listar', async (ctx) => {
  try {
    const snapshot = await db.collection('plantas').get();
    const plantas = snapshot.docs.map(doc => `- ${doc.data().nome}`).join('\n');
    ctx.reply(plantas || 'Nenhuma planta cadastrada ainda! 🌵', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Erro ao listar plantas:', err);
    ctx.reply('Erro ao acessar o banco de dados! 😢');
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bot operante! 🌟' });
});

// Iniciar
bot.launch();
app.listen(process.env.PORT || 3000, () => {
  console.log(`🟢 Servidor rodando na porta ${process.env.PORT || 3000}`);
});
