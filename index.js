const { Telegraf, Scenes, session } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios'); // Para integração com clima e Trefle
const { utcToZonedTime, format } = require('date-fns-tz'); // Para ajuste de fuso horário

// ================= 🔥 FIREBASE =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ================= 🌦️ OPENWEATHERMAP =================
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

// ================= 🌿 TREFFLE API =================
const TREFFLE_API_KEY = process.env.TREFFLE_API_KEY;

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Variáveis de estado
let edicaoState = {};

// ================= FUNÇÕES AUXILIARES =================

// Função para buscar o nome científico da planta
const buscarNomeCientifico = async (nomeComum) => {
  try {
    const response = await axios.get(
      `https://trefle.io/api/v1/plants/search?token=${TREFFLE_API_KEY}&q=${nomeComum}`
    );

    if (response.data && response.data.data.length > 0) {
      return response.data.data[0].scientific_name; // Retorna o primeiro resultado
    } else {
      return null; // Nenhum resultado encontrado
    }
  } catch (err) {
    console.error('Erro ao buscar nome científico:', err);
    return null;
  }
};

// Função para ajustar o fuso horário para o Rio de Janeiro (America/Sao_Paulo)
const formatarData = (data) => {
  const timeZone = 'America/Sao_Paulo'; // Fuso horário do Rio de Janeiro
  const zonedDate = utcToZonedTime(new Date(data), timeZone);
  return format(zonedDate, 'dd/MM/yyyy HH:mm', { timeZone });
};

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
        const mensagemLembrete = `🌧️ *Hora de regar a ${planta.apelido}!*\n` +
          `📅 *Próxima Rega:* ${formatarData(proximaRega)}\n` +
          `💧 *Dica:* ${rain ? 'Está chovendo, então você pode reduzir a rega.' : 'Não está chovendo, então regue normalmente.'}`;

        await bot.telegram.sendMessage(doc.id, mensagemLembrete, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Regar Agora", callback_data: `regar_${planta.apelido}` }],
              [{ text: "🔔 Lembrar mais tarde", callback_data: 'ignorar' }]
            ]
          }
        });

        console.log(`Lembrete enviado para o usuário ${doc.id} sobre a planta ${planta.apelido}`);
      }
    });
  });
};

// Agendar lembretes a cada hora
cron.schedule('0 * * * *', enviarLembretes);

// ================= CENAS (WIZARD) =================

// Cena para cadastro de plantas
const cadastroPlanta = new Scenes.WizardScene(
  'cadastro_planta',
  (ctx) => {
    ctx.reply('📍 Primeiro, digite sua *cidade* para ajustes de rega baseados no clima:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      ctx.reply('❌ Por favor, digite uma cidade válida.');
      return;
    }

    ctx.wizard.state.localizacao = ctx.message.text;
    ctx.reply('🌿 Digite o *apelido* da planta:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      ctx.reply('❌ Por favor, digite um apelido válido.');
      return;
    }

    ctx.wizard.state.apelido = ctx.message.text;

    // Busca o nome científico automaticamente
    const nomeCientifico = await buscarNomeCientifico(ctx.wizard.state.apelido);
    if (nomeCientifico) {
      ctx.wizard.state.nomeCientifico = nomeCientifico;
      ctx.reply(`🔬 O nome científico da planta é: *${nomeCientifico}*.`, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('🔬 Não foi possível encontrar o nome científico. Por favor, digite o nome científico:', { parse_mode: 'Markdown' });
    }

    return ctx.wizard.next();
  },
  (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      ctx.reply('❌ Por favor, digite um nome científico válido.');
      return;
    }

    // Se o nome científico não foi encontrado automaticamente, use o que o usuário digitou
    if (!ctx.wizard.state.nomeCientifico) {
      ctx.wizard.state.nomeCientifico = ctx.message.text;
    }

    ctx.reply('⏳ Digite o *intervalo de rega* (dias):', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      ctx.reply('❌ Por favor, digite um intervalo válido.');
      return;
    }

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
          historicoRegas: [], // Garantir que historicoRegas seja um array vazio
          fotos: [] // Garantir que fotos seja um array vazio
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
        [{ text: "🌦️ Clima", callback_data: "clima" }],
        [{ text: "📊 Evolução", callback_data: "evolucao" }],
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
  const buttons = plantas.map(planta => [{ text: planta.apelido, callback_data: `detalhes_${planta.apelido}` }]);

  ctx.reply('🌿 *Suas Plantas:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Detalhes da Planta
bot.action(/detalhes_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const plantas = userDoc.data().items;
  const planta = plantas.find(p => p.apelido === apelido);

  if (!planta) {
    ctx.reply('❌ Planta não encontrada.');
    return;
  }

  // Verifica se a planta está com sede
  const hoje = new Date();
  const proximaRega = await calcularProximaRega(planta.ultimaRega, planta.intervalo, userDoc.data().localizacao);
  const status = hoje >= proximaRega ? '❌ Sua planta está com sede!' : '✅ Sua planta está saudável!';

  // Monta a mensagem do relatório
  let mensagem = `🌿 *Relatório da ${planta.apelido}:*\n\n` +
    `🔬 *Nome Científico:* ${planta.nomeCientifico}\n` +
    `📅 *Última Rega:* ${formatarData(planta.ultimaRega)}\n` +
    `⏳ *Próxima Rega:* ${formatarData(proximaRega)}\n` +
    `📸 *Fotos:* ${planta.fotos?.length || 0}\n` +
    `🟢 *Status:* ${status}`;

  // Adiciona a última foto, se existir
  if (planta.fotos?.length > 0) {
    const ultimaFoto = planta.fotos[planta.fotos.length - 1];
    await ctx.replyWithPhoto(ultimaFoto, { caption: mensagem, parse_mode: 'Markdown' });
  } else {
    ctx.reply(mensagem, { parse_mode: 'Markdown' });
  }

  // Botões de ação
  const botoes = [
    [{ text: "💧 Regar Agora", callback_data: `regar_${planta.apelido}` }],
    [{ text: "🗑️ Excluir Planta", callback_data: `excluir_${planta.apelido}` }],
    [{ text: "🔙 Voltar", callback_data: "listar" }]
  ];

  ctx.reply('Escolha uma ação:', {
    reply_markup: { inline_keyboard: botoes }
  });
});

// Evolução da Planta
bot.action('evolucao', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();

  if (!userDoc.exists || !userDoc.data().items) {
    ctx.reply('Você ainda não cadastrou nenhuma planta.');
    return;
  }

  const plantas = userDoc.data().items;
  const buttons = plantas.map(planta => [{ text: planta.apelido, callback_data: `evolucao_${planta.apelido}` }]);

  ctx.reply('📊 Escolha uma planta para ver a evolução:', {
    reply_markup: { inline_keyboard: buttons }
  });
});

// Mostrar Fotos da Evolução
bot.action(/evolucao_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const plantas = userDoc.data().items;
  const planta = plantas.find(p => p.apelido === apelido);

  if (!planta) {
    ctx.reply('❌ Planta não encontrada.');
    return;
  }

  if (planta.fotos?.length === 0) {
    ctx.reply(`❌ A planta "${apelido}" ainda não tem fotos registradas.`);
    return;
  }

  // Envia todas as fotos da planta
  for (const foto of planta.fotos) {
    await ctx.replyWithPhoto(foto);
  }
});

// Regar Planta
bot.action(/regar_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const plantas = userDoc.data().items;

  const plantaIndex = plantas.findIndex(p => p.apelido === apelido);
  if (plantaIndex !== -1) {
    // Garantir que historicoRegas seja um array
    if (!plantas[plantaIndex].historicoRegas) {
      plantas[plantaIndex].historicoRegas = [];
    }

    plantas[plantaIndex].ultimaRega = new Date().toISOString();
    plantas[plantaIndex].historicoRegas.push(new Date().toISOString());
    await db.collection('plants').doc(userId).update({ items: plantas });
    ctx.reply(`💧 ${apelido} foi regada com sucesso!`);
  } else {
    ctx.reply('❌ Planta não encontrada.');
  }
});

// Excluir Planta
bot.action(/excluir_(.+)/, async (ctx) => {
  const apelido = ctx.match[1];
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const plantas = userDoc.data().items;

  const plantaIndex = plantas.findIndex(p => p.apelido === apelido);
  if (plantaIndex !== -1) {
    plantas.splice(plantaIndex, 1); // Remove a planta
    await db.collection('plants').doc(userId).update({ items: plantas });
    ctx.reply(`🗑️ ${apelido} foi excluída com sucesso!`);
  } else {
    ctx.reply('❌ Planta não encontrada.');
  }
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
    reply_markup: { inline_keyboard: buttons }
  });
});

// Escolha da Planta para Foto
bot.action(/foto_(.+)/, async (ctx) => {
  const apelido = ctx.match[1]; // Obtém o apelido da planta a partir do callback_data
  const userId = ctx.from.id.toString();

  // Armazena a planta escolhida no estado
  edicaoState[userId] = { plantaParaFoto: apelido };

  await ctx.answerCbQuery(); // Responde ao callback_query para evitar que o bot "trave"
  ctx.reply(`📸 Agora, envie a foto para a planta "${apelido}".`);
});

// Recebimento de Fotos
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id.toString();
  const fotoId = ctx.message.photo[0].file_id;

  if (edicaoState[userId]?.plantaParaFoto) {
    const apelido = edicaoState[userId].plantaParaFoto;
    const userDoc = await db.collection('plants').doc(userId).get();
    const plantas = userDoc.data().items;

    const plantaIndex = plantas.findIndex(p => p.apelido === apelido);
    if (plantaIndex !== -1) {
      // Garantir que o campo "fotos" seja um array
      if (!plantas[plantaIndex].fotos) {
        plantas[plantaIndex].fotos = [];
      }

      // Adiciona a foto ao array de fotos da planta
      plantas[plantaIndex].fotos.push(fotoId);

      // Atualiza o documento no Firestore
      await db.collection('plants').doc(userId).update({ items: plantas });

      ctx.reply('📸 Foto adicionada à linha do tempo!');
    } else {
      ctx.reply('❌ Planta não encontrada.');
    }

    // Limpa o estado após o processamento
    delete edicaoState[userId];
  } else {
    ctx.reply('❌ Por favor, escolha uma planta antes de enviar a foto.');
  }
});

// Cancelar envio de foto
bot.action('cancelar_foto', async (ctx) => {
  const userId = ctx.from.id.toString();
  delete edicaoState[userId]; // Limpa o estado
  await ctx.answerCbQuery();
  ctx.reply('❌ Envio de foto cancelado.');
});

// Ajuda
bot.action('ajuda', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    'ℹ️ *PlantBot - Ajuda*\n\n' +
    '1. Use /menu para navegar\n' +
    '2. Cadastre plantas para receber lembretes\n' +
    '3. Envie fotos para acompanhar o crescimento\n\n' +
    'Desenvolvido por **Hugo Tremmel** 🌱\n' +
    'Contato: @h.trmml',
    { parse_mode: 'Markdown' }
  );
});

// Clima
bot.action('clima', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const userDoc = await db.collection('plants').doc(userId).get();
  const localizacao = userDoc.data().localizacao || 'São Paulo'; // Default

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${localizacao}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=pt_br`
    );
    const { weather, main, rain } = response.data;

    const mensagem = `🌦️ *Previsão do Tempo para ${localizacao}:*\n\n` +
      `☁️ *Condição:* ${weather[0].description}\n` +
      `🌡️ *Temperatura:* ${main.temp}°C\n` +
      `💧 *Umidade:* ${main.humidity}%\n` +
      `🌧️ *Chuva:* ${rain ? `${rain['1h']}mm` : '0mm'}\n\n` +
      `*Dicas para rega:*\n` +
      `- Se estiver chovendo, você pode reduzir a rega.\n` +
      `- Em dias quentes e secos, aumente a frequência de rega.`;

    ctx.reply(mensagem, { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.reply('❌ Não foi possível obter a previsão do tempo. Tente novamente mais tarde.');
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
