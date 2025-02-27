// bot.js
const db = require("./db");

// Armazena o fluxo de cadastro em memória
const conversations = {};

/**
 * Salva a planta finalizada no DB
 */
async function adicionarPlanta(chatId, planta) {
  const key = `plants_${String(chatId)}`;
  console.log("[DEBUG] adicionarPlanta => key:", key, "planta:", planta);

  let plantas = await db.get(key);
  if (!Array.isArray(plantas)) {
    plantas = [];
  }
  plantas.push(planta);
  await db.set(key, plantas);

  console.log(`[DEBUG] Planta adicionada. Total agora: ${plantas.length}`);
  return plantas;
}

/**
 * Calcula quantos dias faltam para a próxima rega
 */
function calcularProximaRega(ultimaRegaISO, intervaloDias) {
  const ultimaRega = new Date(ultimaRegaISO);
  const proxima = new Date(ultimaRega.getTime() + intervaloDias * 24 * 3600000);
  const agora = new Date();
  const diffMs = proxima.getTime() - agora.getTime();
  return Math.ceil(diffMs / (24 * 3600000));
}

/**
 * Limpa a conversa do usuário (em memória)
 */
function limparConversa(chatId) {
  console.log(`[DEBUG] limpando conversa do chatId: ${chatId}`);
  delete conversations[chatId];
}

/**
 * Fluxo principal: processa mensagens de texto (ex.: "cadastrar pimenteira")
 */
async function processarMensagem(chatId, texto, fotoUrl = null) {
  console.log("[DEBUG] processarMensagem => chatId:", chatId, "texto:", texto);

  const msg = texto.trim();
  const msgLower = msg.toLowerCase();

  // Se terminar com "regada", atualiza a rega via texto
  if (msgLower.endsWith("regada") || msgLower.endsWith("regada!")) {
    return await atualizarRegaTexto(chatId, msg);
  }

  // Verifica se há uma conversa em andamento
  let conv = conversations[chatId] || null;

  // Se não há conversa e a mensagem começa com "cadastrar"
  if (!conv && msgLower.startsWith("cadastrar")) {
    const parts = msg.split(" ");
    if (parts.length < 2) {
      return "Formato inválido! Use: cadastrar [nome da planta]";
    }
    const defaultNome = parts.slice(1).join(" ");
    conv = {
      defaultNome,
      step: "ask_apelido",
      plantData: {
        apelido: null,
        nomeCientifico: null,
        intervalo: null,
        ultimaRega: null,
        foto: null
      }
    };
    conversations[chatId] = conv;
    return `👋 Vamos cadastrar a planta *${defaultNome}*!\nEla terá algum apelido? (Se não, responda "não")`;
  }

  // Se já há conversa, processa o step
  if (conv) {
    switch (conv.step) {
      case "ask_apelido": {
        const resposta = (msgLower === "não" || msgLower === "nao") ? conv.defaultNome : msg;
        conv.plantData.apelido = resposta;
        conv.step = "ask_nome_cientifico";
        conversations[chatId] = conv;
        return `👍 Qual o nome científico de *${resposta}*?`;
      }
      case "ask_nome_cientifico": {
        conv.plantData.nomeCientifico = msg;
        conv.step = "ask_intervalo";
        conversations[chatId] = conv;
        return `📏 Qual o intervalo de rega (em dias) para *${conv.plantData.apelido}*? (Ex: 2)`;
      }
      case "ask_intervalo": {
        const intervalo = parseFloat(msg);
        if (isNaN(intervalo) || intervalo <= 0) {
          return "⚠️ Informe um número válido para o intervalo em dias.";
        }
        conv.plantData.intervalo = intervalo;
        conv.step = "ask_ultima_rega";
        conversations[chatId] = conv;
        return `🕒 Quando foi a última rega de *${conv.plantData.apelido}*?\nResponda "hoje" ou no formato DD/MM/YYYY.`;
      }
      case "ask_ultima_rega": {
        let dataISO;
        if (msgLower === "hoje") {
          dataISO = new Date().toISOString();
        } else {
          const parts = msg.split("/");
          if (parts.length !== 3) {
            return "⚠️ Formato inválido! Use 'hoje' ou DD/MM/YYYY.";
          }
          const [dia, mes, ano] = parts.map(Number);
          const data = new Date(ano, mes - 1, dia);
          if (isNaN(data.getTime())) {
            return "⚠️ Data inválida! Tente novamente.";
          }
          dataISO = data.toISOString();
        }
        conv.plantData.ultimaRega = dataISO;
        conv.step = "ask_foto";
        conversations[chatId] = conv;
        return `📸 Você tem uma foto de *${conv.plantData.apelido}*? Envie o link ou digite "não".`;
      }
      case "ask_foto": {
        if (msgLower === "não" || msgLower === "nao") {
          conv.plantData.foto = null;
        } else if (fotoUrl) {
          conv.plantData.foto = fotoUrl;
        } else {
          conv.plantData.foto = msg;
        }
        const planta = {
          apelido: conv.plantData.apelido,
          nomeCientifico: conv.plantData.nomeCientifico,
          intervalo: conv.plantData.intervalo,
          ultimaRega: conv.plantData.ultimaRega,
          foto: conv.plantData.foto
        };
        await adicionarPlanta(chatId, planta);
        limparConversa(chatId);

        const dias = calcularProximaRega(planta.ultimaRega, planta.intervalo);
        let msgFinal = `🎉 *${planta.apelido}* cadastrada com sucesso!\n`;
        msgFinal += `🔬 Nome científico: ${planta.nomeCientifico}\n`;
        msgFinal += `⏰ Intervalo de rega: ${planta.intervalo} dia(s)\n`;
        msgFinal += `🕒 Última rega: ${new Date(planta.ultimaRega).toLocaleString()}\n`;
        if (planta.foto) {
          msgFinal += `📸 Foto: ${planta.foto}\n`;
        }
        msgFinal += `➡️ Próxima rega em: ${dias} dia(s)`;
        return msgFinal;
      }
      default: {
        limparConversa(chatId);
        return "⚠️ Erro na conversa. Tente novamente.";
      }
    }
  }

  // Se não for cadastro nem "regada", retornamos null para não spammar
  return null;
}

/**
 * Atualiza a última rega se o usuário digitar "[apelido] regada"
 */
async function atualizarRegaTexto(chatId, mensagem) {
  const key = `plants_${String(chatId)}`;
  const apelido = mensagem.replace(/regada!?/i, "").trim().toLowerCase();

  let plantas = await db.get(key);
  if (!Array.isArray(plantas) || plantas.length === 0) {
    return "⚠️ Nenhuma planta cadastrada ainda!";
  }

  const index = plantas.findIndex(p => p.apelido.toLowerCase() === apelido);
  if (index === -1) {
    return `❌ Não encontrei planta com apelido "${apelido}".`;
  }
  plantas[index].ultimaRega = new Date().toISOString();
  await db.set(key, plantas);

  const dias = calcularProximaRega(plantas[index].ultimaRega, plantas[index].intervalo);
  return `✅ Planta *${plantas[index].apelido}* atualizada! Regada agora.\n` +
         `🔄 Próxima rega em: ${dias} dia(s)`;
}

/**
 * Atualiza a última rega pelo índice (usado no menu "Ver Planta" → "Regar")
 */
async function atualizarRegaPorIndice(chatId, index) {
  const key = `plants_${String(chatId)}`;
  let plantas = await db.get(key);
  if (!Array.isArray(plantas) || !plantas[index]) {
    return "Planta não encontrada ou inexistente!";
  }
  plantas[index].ultimaRega = new Date().toISOString();
  await db.set(key, plantas);

  const dias = calcularProximaRega(plantas[index].ultimaRega, plantas[index].intervalo);
  return `✅ Planta *${plantas[index].apelido}* regada agora.\n` +
         `🔄 Próxima rega em: ${dias} dia(s)`;
}

module.exports = {
  processarMensagem,
  atualizarRegaPorIndice
};