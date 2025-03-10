const { Telegraf, Scenes, session } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { utcToZonedTime, format } = require('date-fns-tz');

// ================= 🔥 FIREBASE =================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ================= 🌦️ OPENWEATHERMAP =================
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

// ================= 🌿 PL@NTNET API =================
const PLANTNET_API_KEY = process.env.PLANTNET_API_KEY;

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Variáveis de estado
let edicaoState = {};

// ================= FUNÇÕES AUXILIARES =================

// Função para identificar a planta usando a API do Pl@ntNet
const identificarPlanta = async (fotoId) => {
  try {
    // Obter o link da foto
    const fileLink = await bot.telegram.getFileLink(fotoId);
    const fotoUrl = fileLink.href;

    // Baixar a imagem
    const response = await axios.get(fotoUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Enviar a imagem para a API do Pl@ntNet
    const plantNetResponse = await axios.post(
      `https://my-api.plantnet.org/v2/identify/all?api-key=${PLANTNET_API_KEY}`,
      {
        images: [imageBuffer.toString('base64')],
        organs: ['leaf'], // Especifica que a imagem é de uma folha
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // Verificar a resposta da API
    if (plantNetResponse.data.results?.length > 0) {
      const sugestoesValidas = plantNetResponse.data.results.filter(
        s => s.score >= 0.3 // Filtra sugestões com mais de 30% de confiança
      );

      if (sugestoesValidas.length === 0) {
        console.log('Nenhuma sugestão válida encontrada.');
        return null;
      }

      return sugestoesValidas.map(s => ({
        nomeComum: s.species.commonNames[0] || 'Desconhecido',
        nomeCientifico: s.species.scientificName,
        probabilidade: s.score,
        intervaloRega: sugerirIntervaloRega(s.species.scientificName)
      }));
    } else {
      console.log('Nenhum resultado encontrado na API do Pl@ntNet.');
      return null;
    }
  } catch (err) {
    console.error('Erro ao identificar a planta:', err.response?.data || err.message);
    return null;
  }
};

// Função para sugerir o intervalo de rega
const sugerirIntervaloRega = (nomeCientifico) => {
  const intervalos = {
    'Rosa spp.': 2, // Rosas: regar a cada 2 dias
    'Cactus spp.': 7, // Cactos: regar a cada 7 dias
    'Orchidaceae': 5, // Orquídeas: regar a cada 5 dias
    'Mentha spp.': 3, // Hortelã: regar a cada 3 dias
    'Capsicum annuum': 2, // Pimenteira: regar a cada 2 dias
    'Acacia melanoxylon': 5, // Acácia: regar a cada 5 dias
  };

  return intervalos[nomeCientifico] || 3; // Intervalo padrão: 3 dias
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
    return { proximaRega: dataUltimaRega, estaChovendo: !!rain };
  } catch (err) {
    const dataUltimaRega = new Date(ultimaRega);
    dataUltimaRega.setDate(dataUltimaRega.getDate() + intervalo);
    return { proximaRega: dataUltimaRega, estaChovendo: false };
  }
};

// Função para enviar lembretes de rega
const enviarLembretes = async () => {
  console.log('Verificando lembretes...');
  const snapshot = await db.collection('plants').get();
  if (snapshot.empty) {
    console.log('Nenhuma planta cadastrada.');
    return;
  }

  for (const doc of snapshot.docs) { // Substituir forEach por for...of
    const userData = doc.data();
    const plantas = userData.items || [];
    console.log(`Usuário ${doc.id} tem ${plantas.length} plantas cadastradas.`);

    const localizacao = userData.localizacao || 'São Paulo'; // Default
    for (const planta of plantas) { // Substituir forEach por for...of
      const hoje = new Date();
      const { proximaRega, estaChovendo } = await calcularProximaRega(planta.ultimaRega, planta.intervalo, localizacao);

      console.log(`Planta: ${planta.apelido}, Última rega: ${planta.ultimaRega}, Intervalo: ${planta.intervalo} dias`);
      console.log(`Próxima rega: ${proximaRega}, Hoje: ${hoje}`);

      // Verifica se hoje é o dia da rega e se o lembrete já foi enviado
      if (hoje.toDateString() === proximaRega.toDateString() && !planta.lembreteEnviado) {
        const horaAtual = hoje.getHours();
        const minutoAtual = hoje.getMinutes();

        // Se for depois das 6h, envia o lembrete
        if (horaAtual >= 6) {
          const mensagemLembrete = `🌧️ *Hora de regar a ${planta.apelido}!*\n` +
            `📅 *Próxima Rega:* ${formatarData(proximaRega)}\n` +
            `💧 *Dica:* ${estaChovendo ? 'Está chovendo, então você pode reduzir a rega.' : 'Não está chovendo, então regue normalmente.'}`;

          await bot.telegram.sendMessage(doc.id, mensagemLembrete, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Regar Agora", callback_data: `regar_${planta.apelido}` }],
                [{ text: "🔔 Lembrar mais tarde", callback_data: 'ignorar' }]
              ]
            }
          });

          // Marca o lembrete como enviado
          planta.lembreteEnviado = true;
          await db.collection('plants').doc(doc.id).update({ items: plantas });

          console.log(`Lembrete enviado para o usuário ${doc.id} sobre a planta ${planta.apelido}`);
        }
      }
    }
  }
};

// Agendar lembretes a cada hora
cron.schedule('0 * * * *', () => {
  console.log('Cron job executado:', new Date().toISOString());
  enviarLembretes();
});

// Função para resetar lembretes diariamente
const resetarLembretes = async () => {
  const snapshot = await db.collection('plants').get();
  snapshot.docs.forEach(async (doc) => {
    const userData = doc.data();
    const plantas = userData.items || [];

    plantas.forEach((planta) => {
      planta.lembreteEnviado = false;
    });

    await db.collection('plants').doc(doc.id).update({ items: plantas });
  });
};

// Agendar reset diário à meia-noite
cron.schedule('0 0 * * *', () => {
  console.log('Resetando lembretes...');
  resetarLembretes();
});

// ================= CENAS (WIZARD) =================

// Cena para cadastro de plantas
const cadastroPlanta = new Scenes.WizardScene(
  'cadastro_planta',
  (ctx) => {
    ctx.reply('📸 Por favor, envie uma foto da planta para identificação automática.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.photo) {
      ctx.reply('❌ Por favor, envie uma foto válida.');
      return;
    }

    // Obter a foto enviada pelo usuário
    const fotoId = ctx.message.photo[0].file_id;

    // Identificar a planta
    const sugestoes = await identificarPlanta(fotoId);
    if (!sugestoes) {
      ctx.reply('❌ Não foi possível identificar a planta. Por favor, tente novamente.');
      return ctx.scene.leave();
    }

    // Armazenar as sugestões no estado
    ctx.wizard.state.sugestoes = sugestoes;

    // Criar botões com as sugestões
    const botoes = sugestoes.map((s, i) => [
      { 
        text: `${s.nomeComum} (${Math.round(s.probabilidade * 100)}%)`, 
        callback_data: `escolher_${i}`
      }
    ]);

    ctx.reply(
      `🌿 *Planta identificada!*\n\n` +
      sugestoes.map((s, i) => 
        `${i+1}. *${s.nomeComum}* (${s.nomeCientifico}) - ${Math.round(s.probabilidade * 100)}%`
      ).join('\n') +
      `\n\nEscolha a opção correta:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: botoes }
      }
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    const match = ctx.callbackQuery?.data?.match(/escolher_(\d+)/);
    if (!match) {
      ctx.reply('❌ Seleção inválida.');
      return ctx.scene.leave();
    }

    const idx = parseInt(match[1]);
    const sugestao = ctx.wizard.state.sugestoes[idx];

    if (!sugestao) {
      ctx.reply('❌ Opção inválida.');
      return ctx.scene.leave();
    }

    // Armazenar os dados da planta no estado
    ctx.wizard.state.planta = {
      apelido: sugestao.nomeComum,
      nomeCientifico: sugestao.nomeCientifico,
      intervalo: sugestao.intervaloRega,
      fotoId: ctx.message.photo[0].file_id,
    };

    ctx.reply(
      `✅ *Planta selecionada:* ${sugestao.nomeComum}\n` +
      `🔬 *Nome Científico:* ${sugestao.nomeCientifico}\n` +
      `💧 *Intervalo de Rega Sugerido:* A cada ${sugestao.intervaloRega} dias\n\n` +
      `Deseja confirmar o cadastro?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmar", callback_data: "confirmar_cadastro" }],
            [{ text: "❌ Cancelar", callback_data: "cancelar_cadastro" }],
          ],
        },
      }
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'confirmar_cadastro') {
      // Salvar planta no Firestore
      const userId = ctx.from.id.toString();
      await db.collection('plants').doc(userId).set(
        {
          items: admin.firestore.FieldValue.arrayUnion({
            apelido: ctx.wizard.state.planta.apelido,
            nomeCientifico: ctx.wizard.state.planta.nomeCientifico,
            intervalo: ctx.wizard.state.planta.intervalo,
            ultimaRega: new Date().toISOString(),
            historicoRegas: [],
            fotos: [ctx.wizard.state.planta.fotoId], // Armazenar a foto inicial
          }),
        },
        { merge: true }
      );

      ctx.reply('✅ *Planta cadastrada com sucesso!* Use /menu para mais opções.', { parse_mode: 'Markdown' });
    } else {
      ctx.reply('❌ Cadastro cancelado.');
    }

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
  const { proximaRega, estaChovendo } = await calcularProximaRega(planta.ultimaRega, planta.intervalo, userDoc.data().localizacao);
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
