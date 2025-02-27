// telegram.js
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const { processarMensagem, atualizarRegaPorIndice } = require("./bot");
const keepAlive = require("./keepalive");

keepAlive();

const token = "7225197725:AAGpEywCAPpLuNSYLGZCECB0muYhS4GreFk";
const bot = new TelegramBot(token, { polling: true });

// ====================
// MENU PRINCIPAL
// ====================
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log("[DEBUG] /start no chatId:", chatId);
  await mostrarMenuPrincipal(chatId);
});

bot.onText(/Menu/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log("[DEBUG] Menu digitado no chatId:", chatId);
  await mostrarMenuPrincipal(chatId);
});

async function mostrarMenuPrincipal(chatId) {
  console.log("[DEBUG] mostrarMenuPrincipal => chatId:", chatId);
  const inlineKeyboard = [
    [
      { text: "🌱 Plantas Cadastradas", callback_data: "listarPlantas" },
      { text: "➕ Cadastrar Planta", callback_data: "cadastrarPlanta" }
    ],
    [
      { text: "ℹ️ Sobre o Bot", callback_data: "sobreBot" }
    ]
  ];
  await bot.sendMessage(chatId, "👇 Escolha uma opção:", {
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

// ====================
// TRATAMENTO DOS BOTÕES
// ====================
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  console.log("[DEBUG] callback_query =>", { chatId, data });

  await bot.answerCallbackQuery(callbackQuery.id); // Responde imediatamente

  if (data === "listarPlantas") {
    return listarPlantas(chatId);
  } else if (data === "cadastrarPlanta") {
    return bot.sendMessage(chatId, "Para cadastrar, digite:\n`cadastrar [nome da planta]`", {
      parse_mode: "Markdown"
    });
  } else if (data === "sobreBot") {
    return bot.sendMessage(chatId,
      "🤖 *Bot de Plantas*\n" +
      "Cadastre suas plantas, veja detalhes, regue, delete e receba lembretes diários às 06:00!\n" +
      "Feito com Node.js, Telegram Bot API e Firebase Firestore.\n",
      { parse_mode: "Markdown" }
    );
  }

  if (data.startsWith("verPlanta_")) {
    const index = parseInt(data.split("_")[1]);
    return verPlanta(chatId, index);
  }

  if (data.startsWith("deletarPlanta_")) {
    const index = parseInt(data.split("_")[1]);
    return confirmarDeletarPlanta(chatId, index);
  }

  if (data.startsWith("confirmDeletar_")) {
    const index = parseInt(data.split("_")[1]);
    return deletarPlanta(chatId, index);
  }

  if (data.startsWith("regarPlanta_")) {
    const index = parseInt(data.split("_")[1]);
    const resposta = await atualizarRegaPorIndice(chatId, index);
    await bot.sendMessage(chatId, resposta, { parse_mode: "Markdown" });
    return verPlanta(chatId, index);
  }

  if (data === "voltarMenu") {
    return mostrarMenuPrincipal(chatId);
  }

  if (data === "voltarListar") {
    return listarPlantas(chatId);
  }
});

// ====================
// FUNÇÕES DE LISTAR / VER / DELETAR
// ====================
async function listarPlantas(chatId) {
  const key = `plants_${String(chatId)}`;
  console.log("[DEBUG] listarPlantas => chatId:", chatId, "key:", key);
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let plantas = doc.exists ? doc.data().items || [] : [];
  if (!Array.isArray(plantas) || plantas.length === 0) {
    return bot.sendMessage(chatId, "🚫 Você não tem plantas cadastradas ainda!");
  }
  const inlineKeyboard = plantas.map((p, i) => {
    return [
      { text: `👀 ${p.apelido}`, callback_data: `verPlanta_${i}` },
      { text: "🗑️", callback_data: `deletarPlanta_${i}` }
    ];
  });
  inlineKeyboard.push([{ text: "⬅️ Voltar ao Menu", callback_data: "voltarMenu" }]);
  return bot.sendMessage(chatId, "🌱 *Suas Plantas Cadastradas:*", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

async function verPlanta(chatId, index) {
  const key = `plants_${String(chatId)}`;
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let plantas = doc.exists ? doc.data().items || [] : [];
  if (!Array.isArray(plantas) || !plantas[index]) {
    return bot.sendMessage(chatId, "🚫 Planta não encontrada!");
  }
  const p = plantas[index];

  const agora = new Date();
  const ultimaRega = new Date(p.ultimaRega);
  const proxima = new Date(ultimaRega.getTime() + p.intervalo * 24 * 3600000);
  let statusEmoji = "✅ Em dia";
  if (agora > proxima) {
    statusEmoji = "❌ Atrasada";
  }

  let msg = `*${p.apelido}*\n`;
  msg += `🔬 Nome científico: ${p.nomeCientifico}\n`;
  msg += `⏰ Intervalo de rega: ${p.intervalo} dia(s)\n`;
  msg += `🕒 Última rega: ${ultimaRega.toLocaleString()}\n`;
  msg += `📅 Próxima rega: ${proxima.toLocaleDateString()} (Status: ${statusEmoji})\n`;

  const inlineKeyboard = [
    [
      { text: "💧 Regar", callback_data: `regarPlanta_${index}` },
      { text: "⬅️ Voltar", callback_data: "voltarListar" }
    ]
  ];

  if (p.foto && p.foto.startsWith("http")) {
    try {
      await bot.sendPhoto(chatId, p.foto, {
        caption: msg,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    } catch (err) {
      console.log("[DEBUG] Erro ao enviar foto:", err.message);
    }
  }

  return bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

async function confirmarDeletarPlanta(chatId, index) {
  const key = `plants_${String(chatId)}`;
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let plantas = doc.exists ? doc.data().items || [] : [];
  if (!Array.isArray(plantas) || !plantas[index]) {
    return bot.sendMessage(chatId, "🚫 Planta inexistente para deletar.");
  }
  const p = plantas[index];
  const msg = `Deseja realmente apagar a planta *${p.apelido}*?`;
  const inlineKeyboard = [
    [
      { text: "Sim", callback_data: `confirmDeletar_${index}` },
      { text: "Não", callback_data: "voltarListar" }
    ]
  ];
  return bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

async function deletarPlanta(chatId, index) {
  const key = `plants_${String(chatId)}`;
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let plantas = doc.exists ? doc.data().items || [] : [];
  if (!Array.isArray(plantas) || !plantas[index]) {
    return bot.sendMessage(chatId, "🚫 Planta inexistente para deletar.");
  }
  const p = plantas[index];
  plantas.splice(index, 1);
  await docRef.set({ items: plantas });
  await bot.sendMessage(chatId, `🗑️ A planta *${p.apelido}* foi deletada!`, { parse_mode: "Markdown" });
  return listarPlantas(chatId);
}

// ====================
// MENSAGENS DE TEXTO (fluxo antigo, se necessário)
// ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (/^\/start/i.test(text) || /Menu/i.test(text)) return;
  const resposta = await processarMensagem(String(chatId), text);
  if (resposta) {
    bot.sendMessage(chatId, resposta, { parse_mode: "Markdown" });
  }
});

// ====================
// LEMBRETES DIÁRIOS ÀS 06:00
// ====================
async function verificarLembretes() {
  console.log("[DEBUG] Rodando verificarLembretes()...");
  const snapshot = await db.collection('plants').get();
  snapshot.forEach(async (doc) => {
    const chatId = doc.id;
    let plantas = doc.data().items || [];
    if (!Array.isArray(plantas)) return;
    for (const p of plantas) {
      const ultimaRega = new Date(p.ultimaRega);
      const proxima = new Date(ultimaRega.getTime() + p.intervalo * 24 * 3600000);
      const agora = new Date();
      if (agora >= proxima) {
        let msg = `🔔 *Lembrete de Rega*\nSua planta *${p.apelido}* precisa de água hoje!\n`;
        msg += `Última rega: ${ultimaRega.toLocaleDateString()}\n`;
        msg += `Intervalo: ${p.intervalo} dia(s)\n`;
        msg += `Status: ❌ Atrasada ou no prazo de hoje.`;
        await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
      }
    }
  });
}

// Verifica a cada 60 segundos; se for 06:00, executa os lembretes
setInterval(async () => {
  const agora = new Date();
  const hora = agora.getHours();
  const minuto = agora.getMinutes();
  if (hora === 6 && minuto === 0) {
    console.log("[DEBUG] Executando lembretes diários (06:00)...");
    await verificarLembretes();
  }
}, 60000);

console.log("Bot de Plantas no Telegram rodando com menu avançado, lembretes e keepalive...");
