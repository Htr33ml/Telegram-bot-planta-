// telegram.js
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const { processarMensagem, atualizarRegaPorIndice } = require("./bot");
const keepAlive = require("./keepalive"); // Para manter Repl online

// Inicia o keepAlive
keepAlive();

// Seu token do BotFather
const token = "7225197725:AAGpEywCAPpLuNSYLGZCECB0muYhS4GreFk";

// Inicia o bot em modo polling
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

  if (data === "listarPlantas") {
    await bot.answerCallbackQuery(callbackQuery.id);
    return listarPlantas(chatId);
  } else if (data === "cadastrarPlanta") {
    await bot.answerCallbackQuery(callbackQuery.id);
    return bot.sendMessage(chatId,
      "Para cadastrar, digite:\n`cadastrar [nome da planta]`",
      { parse_mode: "Markdown" }
    );
  } else if (data === "sobreBot") {
    await bot.answerCallbackQuery(callbackQuery.id);
    return bot.sendMessage(chatId,
      "🤖 *Bot de Plantas*\n" +
      "Cadastre suas plantas, veja detalhes, regue, apague...\n" +
      "E receba lembretes diários! Feito com Node.js + Replit.\n",
      { parse_mode: "Markdown" }
    );
  }

  if (data.startsWith("verPlanta_")) {
    await bot.answerCallbackQuery(callbackQuery.id);
    const index = parseInt(data.split("_")[1]);
    return verPlanta(chatId, index);
  }

  if (data.startsWith("deletarPlanta_")) {
    await bot.answerCallbackQuery(callbackQuery.id);
    const index = parseInt(data.split("_")[1]);
    return confirmarDeletarPlanta(chatId, index);
  }

  if (data.startsWith("confirmDeletar_")) {
    await bot.answerCallbackQuery(callbackQuery.id);
    const index = parseInt(data.split("_")[1]);
    return deletarPlanta(chatId, index);
  }

  if (data.startsWith("regarPlanta_")) {
    await bot.answerCallbackQuery(callbackQuery.id);
    const index = parseInt(data.split("_")[1]);
    const resposta = await atualizarRegaPorIndice(chatId, index);
    await bot.sendMessage(chatId, resposta, { parse_mode: "Markdown" });
    return verPlanta(chatId, index);
  }

  if (data === "voltarMenu") {
    await bot.answerCallbackQuery(callbackQuery.id);
    return mostrarMenuPrincipal(chatId);
  }

  if (data === "voltarListar") {
    await bot.answerCallbackQuery(callbackQuery.id);
    return listarPlantas(chatId);
  }
});

// ====================
// LISTAR / VER / DELETAR PLANTA
// ====================
async function listarPlantas(chatId) {
  const key = `plants_${String(chatId)}`;
  console.log("[DEBUG] listarPlantas => chatId:", chatId, "key:", key);

  let plantas = await db.get(key);
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
  let plantas = await db.get(key);
  if (!Array.isArray(plantas) || !plantas[index]) {
    return bot.sendMessage(chatId, "🚫 Planta não encontrada!");
  }
  const p = plantas[index];

  // Calcula status
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

  if (p.foto) {
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
  let plantas = await db.get(key);
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
  let plantas = await db.get(key);
  if (!Array.isArray(plantas) || !plantas[index]) {
    return bot.sendMessage(chatId, "🚫 Planta inexistente para deletar.");
  }
  const p = plantas[index];
  plantas.splice(index, 1);
  await db.set(key, plantas);

  await bot.sendMessage(chatId, `🗑️ A planta *${p.apelido}* foi deletada!`, {
    parse_mode: "Markdown"
  });
  return listarPlantas(chatId);
}

// ====================
// MENSAGENS DE TEXTO
// ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  // Se for /start ou Menu, já tratamos acima
  if (/^\/start/i.test(text) || /Menu/i.test(text)) return;

  // Chama a lógica do bot.js
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
  const keys = await db.list();
  const plantsKeys = keys.filter(k => k.startsWith("plants_"));

  for (const key of plantsKeys) {
    const chatId = key.replace("plants_", "");
    let plantas = await db.get(key);
    if (!Array.isArray(plantas)) continue;

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
  }
}

// Roda a cada 60 segundos e, se for 06:00, chama verificarLembretes
setInterval(async () => {
  const agora = new Date();
  const hora = agora.getHours();
  const minuto = agora.getMinutes();

  if (hora === 6 && minuto === 0) {
    console.log("[DEBUG] Executando lembretes diários (06:00)...");
    await verificarLembretes();
  }
}, 60000);

console.log("Bot de Plantas no Telegram rodando com foto, status, lembretes e keepalive...");
