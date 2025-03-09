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

// ================= 🌿 PLANT.ID API =================
const PLANT_ID_API_KEY = process.env.PLANT_ID_API_KEY;

// ================= 🤖 BOT =================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Variáveis de estado
let edicaoState = {};

// ================= FUNÇÕES AUXILIARES =================
const identificarPlanta = async (fotoId) => {
  try {
    const fileLink = await bot.telegram.getFileLink(fotoId);
    const fotoUrl = fileLink.href;

    const response = await axios.get(fotoUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Configurações melhoradas da API
    const plantIdResponse = await axios.post(
      'https://api.plant.id/v3/identify', // Versão mais nova
      {
        images: [imageBuffer.toString('base64')],
        plant_details: ['common_names', 'url'],
        language: 'pt', // Idioma português
        suggestions: 3  // Traz 3 sugestões
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': PLANT_ID_API_KEY,
        },
      }
    );

    // Filtra resultados com baixa confiança
    const sugestoesValidas = plantIdResponse.data.suggestions?.filter(
      s => s.probability >= 0.3 // Só aceita acima de 30% de confiança
    );

    return sugestoesValidas?.map(s => ({
      nomeComum: s.plant_details?.common_names?.[0] || 'Desconhecido',
      nomeCientifico: s.plant_name,
      probabilidade: s.probability
    })) || null;

  } catch (err) {
    console.error('Erro na identificação:', err);
    return null;
  }
};
// Função para identificar a planta usando a API Plant.id

    // Verificar a resposta da API
    if (plantIdResponse.data.suggestions && plantIdResponse.data.suggestions.length > 0) {
      const plantaIdentificada = plantIdResponse.data.suggestions[0];
      const nomeComum = plantaIdentificada.plant_details.common_names[0] || 'Desconhecido';
      const nomeCientifico = plantaIdentificada.plant_name;
      const intervaloRega = sugerirIntervaloRega(nomeCientifico); 
      
      // Função para sugerir intervalo de rega
      return {
        nomeComum,
        nomeCientifico,
        intervaloRega,
      };
    } else {
      console.log('Nenhum resultado encontrado na API Plant.id.');
      return null;
    }
  } catch (err) {
    console.error('Erro ao identificar a planta:', err);
    return null;
  }
};

// Função para sugerir o intervalo de rega
const sugerirIntervaloRega = (nomeCientifico) => {
  const intervalos = {
    // Novas entradas para plantas comuns
    'Capsicum annuum': 2,     // Pimenteira
    'Capsicum frutescens': 2, // Pimenta malagueta
    'Ocimum basilicum': 3,    // Manjericão
    'Mentha spicata': 3,      // Hortelã
    
    // Mantenha as outras entradas...
  };

  return intervalos[nomeCientifico] || 3;
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

  snapshot.docs.forEach(async (doc) => {
    const userData = doc.data();
    const plantas = userData.items || [];
    console.log(`Usuário ${doc.id} tem ${plantas.length} plantas cadastradas.`);

    const localizacao = userData.localizacao || 'São Paulo'; // Default
    plantas.forEach(async (planta) => {
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
    });
  });
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
    ctx.reply('📸 Envie uma foto CLARA da planta (foco nas folhas):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.photo) {
      ctx.reply('❌ Preciso de uma foto válida!');
      return ctx.scene.leave();
    }

    const fotoId = ctx.message.photo[0].file_id;
    const sugestoes = await identificarPlanta(fotoId);

    if (!sugestoes) {
      ctx.reply('⚠️ Não reconheci esta planta. Tente outra foto!');
      return ctx.scene.leave();
    }

    // Armazena as sugestões
    ctx.wizard.state.sugestoes = sugestoes;

    // Cria botões com as opções
    const botoes = sugestoes.map((s, index) => [
      { 
        text: `${s.nomeComum} (${Math.round(s.probabilidade * 100}%)`, 
        callback_data: `sugestao_${index}`
      }
    ]);

    ctx.reply(
      '🔍 Encontrei estas possibilidades:\n' +
      sugestoes.map((s, i) => 
        `${i+1}. *${s.nomeComum}* (${s.nomeCientifico})`
      ).join('\n'),
      { 
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: botoes } 
      }
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    const match = ctx.callbackQuery?.data?.match(/sugestao_(\d+)/);
    if (!match) {
      ctx.reply('❌ Seleção inválida!');
      return ctx.scene.leave();
    }

    const idx = parseInt(match[1]);
    const sugestao = ctx.wizard.state.sugestoes[idx];

    // Resto do código da cena permanece igual...
    // (Confirmação e salvamento)
  }
);
    // Obter a foto enviada pelo usuário
    const fotoId = ctx.message.photo[0].file_id;

    // Identificar a planta
    const plantaIdentificada = await identificarPlanta(fotoId);
    if (!plantaIdentificada) {
      ctx.reply('❌ Não foi possível identificar a planta. Por favor, tente novamente.');
      return ctx.scene.leave();
    }

    // Armazenar os dados da planta no estado
    ctx.wizard.state.planta = {
      apelido: plantaIdentificada.nomeComum,
      nomeCientifico: plantaIdentificada.nomeCientifico,
      intervalo: plantaIdentificada.intervaloRega,
      fotoId: fotoId, // Armazenar o ID da foto para uso futuro
    };

    // Confirmar os dados com o usuário
    ctx.reply(
      `🌿 *Planta identificada!*\n\n` +
      `🔬 *Nome Científico:* ${plantaIdentificada.nomeCientifico}\n` +
      `🌱 *Nome Comum:* ${plantaIdentificada.nomeComum}\n` +
      `💧 *Intervalo de Rega Sugerido:* A cada ${plantaIdentificada.intervaloRega} dias\n\n` +
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
