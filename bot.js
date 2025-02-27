// bot.js
const db = require("./db");

// Estado do fluxo em memória (para cadastro interativo)
const conversations = {};

/**
 * Adiciona uma planta à coleção "plants"
 * O documento tem id igual ao chatId e o campo "items" é um array de plantas.
 */
async function adicionarPlanta(chatId, planta) {
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let items = [];
  if (doc.exists) {
    items = doc.data().items || [];
  }
  items.push(planta);
  await docRef.set({ items });
  console.log(`[DEBUG] Planta adicionada para chat ${chatId}. Total: ${items.length}`);
  return items;
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
 * Limpa a conversa (estado em memória)
 */
function limparConversa(chatId) {
  delete conversations[chatId];
}

/**
 * Fluxo principal: processa mensagens de texto para cadastro
 */
async function processarMensagem(chatId, texto, fotoUrl = null) {
  console.log("[DEBUG] processarMensagem => chatId:", chatId, "texto:", texto);
  const msg = texto.trim();
  const msgLower = msg.toLowerCase();

  // Se a mensagem indicar "regada", atualiza a rega via texto
  if (msgLower.endsWith("regada") || msgLower.endsWith("regada!")) {
    return await atualizarRegaTexto(chatId, msg);
  }

  let conv = conversations[chatId] || null;

  // Inicia o fluxo de cadastro
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
    return `👋 Vamos cadastrar sua planta *${defaultNome}*!\nEla terá algum apelido? (Se não, responda "não")`;
  }

  // Processa o fluxo interativo
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
        await deleteConversation(chatId);
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
        await deleteConversation(chatId);
        limparConversa(chatId);
        return "⚠️ Erro na conversa. Tente novamente.";
      }
    }
  }
  return null;
}

/**
 * Atualiza a última rega se o usuário digitar "[apelido] regada"
 */
async function atualizarRegaTexto(chatId, mensagem) {
  const docRef = db.collection('plants').doc(String(chatId));
  const doc = await docRef.get();
  let plantas = doc.exists ? doc.data().items || [] : [];
  const apelido = mensagem.replace(/regada!?/i, "").trim().toLowerCase();
  const index = plantas.findIndex(p => p.apelido.toLowerCase() === apelido);
  if (index === -1) {
    return `❌ Não encontrei planta com apelido "${apelido}".`;
  }
  plantas[index].ultimaRega = new Date().toISOString();
  await docRef.set({ items: plantas });
  const dias = calcularProximaRega(plantas[index].ultimaRega, plantas[index].intervalo);
  return `✅ Planta *${plantas[index].apelido}* atualizada! Regada agora.\n🔄 Próxima rega em: ${dias} dia(s)`;
}

/**
 * Exclui o documento de conversa do Firestore (se você quiser persistir o estado, adapte conforme necessário)
 */
async function deleteConversation(chatId) {
  const docRef = db.collection('conversations').doc(String(chatId));
  await docRef.delete();
}

module.exports = {
  processarMensagem,
  atualizarRegaPorIndice: async function(chatId, index) {
    const docRef = db.collection('plants').doc(String(chatId));
    const doc = await docRef.get();
    let plantas = doc.exists ? doc.data().items || [] : [];
    if (!Array.isArray(plantas) || !plantas[index]) {
      return "Planta não encontrada ou inexistente!";
    }
    plantas[index].ultimaRega = new Date().toISOString();
    await docRef.set({ items: plantas });
    const dias = calcularProximaRega(plantas[index].ultimaRega, plantas[index].intervalo);
    return `✅ Planta *${plantas[index].apelido}* regada agora.\n🔄 Próxima rega em: ${dias} dia(s)`;
  }
};
