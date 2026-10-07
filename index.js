import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import pino from 'pino';
import express from 'express';
import Groq, { toFile } from 'groq-sdk';
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';


// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 10000;

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || '';

const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  'openai/gpt-oss-120b';

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  'whisper-large-v3-turbo';

const WHISPER_LANGUAGE =
  process.env.WHISPER_LANGUAGE || 'fr';


// ---------------- ELEVENLABS ----------------

const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY || '';

const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || '';

const ELEVENLABS_MODEL =
  process.env.ELEVENLABS_MODEL ||
  'eleven_multilingual_v2';

const ELEVENLABS_OUTPUT_FORMAT =
  process.env.ELEVENLABS_OUTPUT_FORMAT ||
  'mp3_22050_32';

const VOICE_REPLY_ENABLED =
  String(
    process.env.VOICE_REPLY_ENABLED ?? 'true'
  ).toLowerCase() === 'true';


// ---------------- RECHERCHE WEB ----------------

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY || '';


// ============================================================
// ETAT
// ============================================================

let sockInstance = null;

let isConnected = false;

let currentQrImage = null;

let reconnecting = false;

let db = null;

let groq = null;


// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(express.json());

app.get('/', (req, res) => {

  res.send(`
<!DOCTYPE html>
<html lang="fr">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>Hbot2</title>

<style>

body {
    margin: 0;
    background: #101010;
    color: white;
    font-family: Arial, sans-serif;
    text-align: center;
}

.container {
    max-width: 650px;
    margin: 40px auto;
    padding: 30px;
    background: #1c1c1c;
    border-radius: 20px;
}

h1 {
    color: #25D366;
}

.status {
    font-size: 20px;
    margin: 20px;
}

img {
    max-width: 300px;
    background: white;
    padding: 10px;
    border-radius: 15px;
}

.info {
    text-align: left;
    line-height: 1.8;
    margin-top: 25px;
}

.ok {
    color: #25D366;
}

.no {
    color: #ff5555;
}

</style>

</head>

<body>

<div class="container">

<h1>🤖 HBOT2</h1>

<div class="status">

${
  isConnected
    ? '🟢 Connecté à WhatsApp'
    : '🟡 En attente de connexion'
}

</div>

${
  currentQrImage
    ? `<img src="${currentQrImage}" alt="QR WhatsApp">`
    : ''
}

<div class="info">

<p>
👤 Créateur :
<strong>Assamoi Yapi Hyppolite</strong>
</p>

<p>
🎙️ Reconnaissance vocale :
<span class="${groq ? 'ok' : 'no'}">
${groq ? 'ACTIVE' : 'INACTIVE'}
</span>
</p>

<p>
🔊 Réponse vocale :
<span class="${
  ELEVENLABS_API_KEY &&
  ELEVENLABS_VOICE_ID
    ? 'ok'
    : 'no'
}">
${
  ELEVENLABS_API_KEY &&
  ELEVENLABS_VOICE_ID
    ? 'ACTIVE'
    : 'INACTIVE'
}
</span>
</p>

<p>
🌐 Recherche Internet :
<span class="${
  TAVILY_API_KEY
    ? 'ok'
    : 'no'
}">
${
  TAVILY_API_KEY
    ? 'ACTIVE'
    : 'INACTIVE'
}
</span>
</p>

<p>
🧠 IA :
${GROQ_MODEL}
</p>

</div>

</div>

</body>
</html>
`);

});


app.get('/health', (req, res) => {

  res.json({

    ok: true,

    bot: 'Hbot2',

    whatsapp: isConnected,

    groq: Boolean(GROQ_API_KEY),

    whisper: Boolean(GROQ_API_KEY),

    elevenlabs:
      Boolean(
        ELEVENLABS_API_KEY &&
        ELEVENLABS_VOICE_ID
      ),

    webSearch:
      Boolean(TAVILY_API_KEY),

    groupMemory:
      Boolean(db),

    creator:
      'Assamoi Yapi Hyppolite'

  });

});


app.listen(PORT, () => {

  console.log(
    `🌐 Serveur Hbot2 sur le port ${PORT}`
  );

});


// ============================================================
// GROQ
// ============================================================

if (GROQ_API_KEY) {

  groq = new Groq({
    apiKey: GROQ_API_KEY
  });

  console.log('✅ Groq activé');

} else {

  console.log(
    '⚠️ GROQ_API_KEY manquante'
  );

}


// ============================================================
// FIREBASE
// ============================================================

try {

  const renderPath =
    '/etc/secrets/serviceAccountKey.json';

  const localPath =
    './serviceAccountKey.json';

  let serviceAccount = null;


  if (existsSync(renderPath)) {

    serviceAccount =
      JSON.parse(
        readFileSync(
          renderPath,
          'utf8'
        )
      );

  } else if (existsSync(localPath)) {

    serviceAccount =
      JSON.parse(
        readFileSync(
          localPath,
          'utf8'
        )
      );

  }


  if (serviceAccount) {

    admin.initializeApp({

      credential:
        admin.credential.cert(
          serviceAccount
        )

    });

    db = admin.firestore();

    console.log(
      '✅ Firebase / Firestore activé'
    );

  } else {

    console.log(
      '⚠️ Firebase non configuré'
    );

  }

} catch (error) {

  console.error(
    '❌ Firebase :',
    error.message
  );

}


// ============================================================
// IDENTITE PERMANENTE DE HBOT2
// ============================================================

const CREATOR_NAME =
  'Assamoi Yapi Hyppolite';


// ============================================================
// MEMOIRE COURTE
// ============================================================

const conversations =
  new Map();

const MAX_HISTORY = 12;


// ============================================================
// PROMPT SYSTEME
// ============================================================

const SYSTEM_PROMPT = `

Tu es Hbot2, un assistant intelligent fonctionnant
sur WhatsApp.

Ton créateur est ${CREATOR_NAME}.

IDENTITE :

Si quelqu'un demande :

- Qui es-tu ?
- Qui est Hbot2 ?
- Qui t'a créé ?
- Qui est ton créateur ?
- Qui est ton concepteur ?

Tu dois répondre clairement que tu đã été conçu
par ${CREATOR_NAME}.

Tu ne dois jamais inventer un autre créateur.

LANGUE :

Tu réponds principalement en français,
mais tu peux comprendre et répondre dans
d'autres langues.

CAPACITES :

Tu peux répondre aux questions générales.

Tu peux expliquer :

- sciences
- histoire
- géographie
- informatique
- mathématiques
- technologie
- culture
- sport
- actualité
- vie quotidienne
- programmation
- rédaction
- traduction
- etc.

ACTUALITE :

Lorsqu'une recherche Internet t'est fournie,
utilise les informations trouvées pour répondre.

Ne présente jamais une information récente
comme certaine si elle n'est pas confirmée.

MEMOIRE DE GROUPE :

Lorsque des informations provenant de la mémoire
du groupe sont fournies, utilise-les pour répondre.

Ne mélange jamais les informations provenant
de groupes différents.

Si aucune information pertinente n'est présente
dans la mémoire du groupe, dis-le honnêtement.

Ne fabrique jamais une information manquante.

STYLE :

Sois naturel, clair, utile et respectueux.

Ne prétends pas être humain.

`;


// ============================================================
// MEMOIRE GROUPE — FIRESTORE
// ============================================================

function getMemoryCollectionId(jid) {

  return jid
    .replace(/[^a-zA-Z0-9_-]/g, '_');

}


// ============================================================
// ENREGISTRER UNE INFORMATION DU GROUPE
// ============================================================

async function memoriserGroupe(
  jid,
  information,
  auteur = ''
) {

  if (!db) {

    return;

  }

  if (!jid.endsWith('@g.us')) {

    return;

  }

  try {

    const collectionId =
      getMemoryCollectionId(jid);

    const ref =
      db
        .collection('hbot2_group_memory')
        .doc(collectionId);

    const snapshot =
      await ref.get();

    let data =
      snapshot.exists
        ? snapshot.data()
        : {
            groupId: jid,
            informations: []
          };


    if (!data.informations) {

      data.informations = [];

    }


    data.informations.push({

      texte: information,

      auteur: auteur || 'membre',

      date:
        new Date().toISOString()

    });


    if (
      data.informations.length > 500
    ) {

      data.informations =
        data.informations.slice(-500);

    }


    await ref.set(
      data,
      {
        merge: true
      }
    );


    console.log(
      `🧠 Information mémorisée pour ${jid}`
    );

  } catch (error) {

    console.error(
      '❌ Erreur mémoire groupe :',
      error.message
    );

  }

}


// ============================================================
// RECUPERER MEMOIRE DU GROUPE
// ============================================================

async function recupererMemoireGroupe(
  jid
) {

  if (!db) {

    return [];

  }

  if (!jid.endsWith('@g.us')) {

    return [];

  }

  try {

    const collectionId =
      getMemoryCollectionId(jid);

    const snapshot =
      await db
        .collection('hbot2_group_memory')
        .doc(collectionId)
        .get();

    if (!snapshot.exists) {

      return [];

    }

    const data =
      snapshot.data();

    return data.informations || [];

  } catch (error) {

    console.error(
      '❌ Lecture mémoire :',
      error.message
    );

    return [];

  }

}


// ============================================================
// DECIDER SI UNE INFORMATION EST IMPORTANTE
// ============================================================

async function analyserInformation(
  text
) {

  if (!groq) {

    return false;

  }

  try {

    const result =
      await groq.chat.completions.create({

        model: GROQ_MODEL,

        messages: [

          {
            role: 'system',

            content: `

Tu analyses les messages d'un groupe WhatsApp.

Réponds uniquement par :

OUI

ou

NON

Réponds OUI si le message contient
une information potentiellement utile
à retenir pour le groupe.

Exemples à retenir :

- dates
- heures
- lieux
- rendez-vous
- sorties
- voyages
- cotisations
- montants
- programmes
- réunions
- événements
- décisions
- annonces importantes
- changements importants
- informations pratiques

Réponds NON pour :

- salutations
- plaisanteries
- discussions sans information utile
- messages insignifiants

`
          },

          {
            role: 'user',
            content: text
          }

        ],

        temperature: 0,

        max_tokens: 5

      });


    const answer =
      result.choices?.[0]
        ?.message?.content
        ?.trim()
        .toUpperCase();

    return answer === 'OUI';

  } catch {

    return false;

  }

}


// ============================================================
// RECHERCHE WEB — TAVILY
// ============================================================

async function rechercherInternet(
  query
) {

  if (!TAVILY_API_KEY) {

    return [];

  }

  try {

    const response =
      await fetch(
        'https://api.tavily.com/search',
        {

          method: 'POST',

          headers: {

            'Content-Type':
              'application/json'

          },

          body: JSON.stringify({

            api_key:
              TAVILY_API_KEY,

            query,

            search_depth:
              'advanced',

            topic:
              'general',

            max_results:
              5,

            include_answer:
              true,

            include_raw_content:
              false

          })

        }
      );


    if (!response.ok) {

      throw new Error(
        `Tavily HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    return {

      answer:
        data.answer || '',

      results:
        (data.results || [])
          .map(item => ({

            title:
              item.title,

            url:
              item.url,

            content:
              item.content

          }))

    };

  } catch (error) {

    console.error(
      '❌ Recherche Web :',
      error.message
    );

    return [];

  }

}


// ============================================================
// DETERMINER SI UNE QUESTION NECESSITE INTERNET
// ============================================================

async function questionNecessiteWeb(
  text
) {

  if (!groq) {

    return false;

  }

  try {

    const result =
      await groq.chat.completions.create({

        model: GROQ_MODEL,

        messages: [

          {

            role: 'system',

            content: `

Tu dois décider si une question nécessite
une recherche Internet actuelle.

Réponds uniquement :

OUI

ou

NON

Réponds OUI pour :

- actualités
- nouvelles récentes
- résultats sportifs récents
- météo
- prix actuels
- événements récents
- informations publiées récemment
- personnes actuellement en fonction
- horaires actuels
- informations qui peuvent avoir changé
- "aujourd'hui"
- "maintenant"
- "cette semaine"
- "dernièrement"
- "dernières nouvelles"

Réponds NON pour une connaissance générale
qui ne nécessite pas d'information récente.

`

          },

          {

            role: 'user',

            content: text

          }

        ],

        temperature: 0,

        max_tokens: 5

      });


    return (
      result
        .choices?.[0]
        ?.message?.content
        ?.trim()
        ?.toUpperCase() === 'OUI'
    );

  } catch {

    return false;

  }

}


// ============================================================
// TRANSCRIPTION VOCALE
// ============================================================

async function transcrireAudio(
  audioBuffer,
  mimetype = 'audio/ogg'
) {

  if (!groq) {

    return '';

  }

  try {

    let extension = 'ogg';


    if (
      mimetype.includes('mp3') ||
      mimetype.includes('mpeg')
    ) {

      extension = 'mp3';

    } else if (
      mimetype.includes('m4a') ||
      mimetype.includes('mp4')
    ) {

      extension = 'm4a';

    } else if (
      mimetype.includes('webm')
    ) {

      extension = 'webm';

    }


    const file =
      await toFile(
        audioBuffer,
        `hbot2_voice.${extension}`
      );


    const transcription =
      await groq.audio.transcriptions.create({

        file,

        model:
          WHISPER_MODEL,

        language:
          WHISPER_LANGUAGE,

        response_format:
          'json',

        temperature:
          0

      });


    return (
      transcription.text?.trim() || ''
    );

  } catch (error) {

    console.error(
      '❌ Whisper :',
      error.message
    );

    return '';

  }

}


// ============================================================
// ELEVENLABS
// ============================================================

function nettoyerTexteVocal(
  text
) {

  return text

    .replace(
      /\[(.*?)\]\(.*?\)/g,
      '$1'
    )

    .replace(
      /[*_~`#]/g,
      ''
    )

    .replace(
      /[\u{1F300}-\u{1FAFF}]/gu,
      ''
    )

    .trim();

}


async function genererVocal(
  text
) {

  if (
    !VOICE_REPLY_ENABLED ||
    !ELEVENLABS_API_KEY ||
    !ELEVENLABS_VOICE_ID
  ) {

    return null;

  }


  const cleanText =
    nettoyerTexteVocal(text)
      .slice(0, 1800);


  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/` +
    `${encodeURIComponent(
      ELEVENLABS_VOICE_ID
    )}` +
    `?output_format=${encodeURIComponent(
      ELEVENLABS_OUTPUT_FORMAT
    )}`;


  const response =
    await fetch(
      url,
      {

        method: 'POST',

        headers: {

          'xi-api-key':
            ELEVENLABS_API_KEY,

          'Content-Type':
            'application/json',

          'Accept':
            'audio/mpeg'

        },

        body: JSON.stringify({

          text:
            cleanText,

          model_id:
            ELEVENLABS_MODEL

        })

      }
    );


  if (!response.ok) {

    const error =
      await response.text();

    throw new Error(
      `ElevenLabs ${response.status}: ` +
      error.slice(0, 300)
    );

  }


  return Buffer.from(
    await response.arrayBuffer()
  );

}


// ============================================================
// ENVOYER VOCAL
// ============================================================

async function envoyerVocal(
  jid,
  text,
  quoted
) {

  try {

    const audio =
      await genererVocal(text);

    if (!audio) {

      return false;

    }


    const isMp3 =
      ELEVENLABS_OUTPUT_FORMAT
        .startsWith('mp3_');


    await sockInstance.sendMessage(

      jid,

      {

        audio,

        mimetype:
          isMp3
            ? 'audio/mpeg'
            : 'audio/ogg; codecs=opus',

        ptt: true

      },

      {
        quoted
      }

    );


    return true;

  } catch (error) {

    console.error(
      '❌ ElevenLabs :',
      error.message
    );

    return false;

  }

}


// ============================================================
// IA PRINCIPALE
// ============================================================

async function genererIA(
  jid,
  question,
  groupMemory = [],
  webData = null
) {

  if (!groq) {

    return '⚠️ Le service IA Groq n’est pas configuré.';

  }


  if (!conversations.has(jid)) {

    conversations.set(
      jid,
      []
    );

  }


  const history =
    conversations.get(jid);


  let memoryText =
    'Aucune mémoire de groupe pertinente.';


  if (groupMemory.length) {

    memoryText =
      groupMemory
        .slice(-80)
        .map(item =>
          `- ${item.texte} ` +
          `(source : ${item.auteur || 'membre'}, ` +
          `${item.date || ''})`
        )
        .join('\n');

  }


  let webText =
    'Aucune recherche Internet effectuée.';


  if (
    webData &&
    webData.results
  ) {

    webText = '';

    if (webData.answer) {

      webText +=
        `Résumé du moteur :\n` +
        `${webData.answer}\n\n`;

    }


    webData.results.forEach(
      (item, index) => {

        webText +=
          `Source ${index + 1}:\n` +
          `Titre: ${item.title}\n` +
          `URL: ${item.url}\n` +
          `Contenu: ${item.content}\n\n`;

      }
    );

  }


  const context = `

MEMOIRE DU GROUPE :

${memoryText}


RECHERCHE INTERNET :

${webText}

`;


  history.push({

    role: 'user',

    content:
      `${context}\n\nQUESTION : ${question}`

  });


  while (
    history.length > MAX_HISTORY
  ) {

    history.shift();

  }


  try {

    const completion =
      await groq.chat.completions.create({

        model:
          GROQ_MODEL,

        messages: [

          {

            role: 'system',

            content:
              SYSTEM_PROMPT

          },

          ...history

        ],

        temperature:
          0.6,

        max_tokens:
          1200

      });


    const answer =
      completion
        .choices?.[0]
        ?.message?.content
        ?.trim();


    if (!answer) {

      return 'Je n’ai pas réussi à formuler une réponse.';

    }


    history.push({

      role: 'assistant',

      content:
        answer

    });


    while (
      history.length > MAX_HISTORY
    ) {

      history.shift();

    }


    return answer;

  } catch (error) {

    console.error(
      '❌ Groq IA :',
      error.message
    );

    return (
      '⚠️ Je rencontre actuellement ' +
      'un problème avec mon intelligence artificielle.'
    );

  }

}


// ============================================================
// NORMALISATION MESSAGE
// ============================================================

function normaliserMessage(msg) {
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';
  return text.trim();
}


// ============================================================
// LANCEMENT DE WHATSAPP (BAILEYS)
// ============================================================

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' })
  });

  sockInstance = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQrImage = await QRCode.toDataURL(qr);
      console.log('📱 Nouveau QR Code généré (flashe-le depuis la page web).');
    }

    if (connection === 'open') {
      isConnected = true;
      currentQrImage = null;
      reconnecting = false;
      console.log('✅ Hbot2 est connecté à WhatsApp !');
    }

    if (connection === 'close') {
      isConnected = false;
      sockInstance = null;

      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`⚠️ Connexion fermée (Code: ${statusCode}). Reconnexion : ${shouldReconnect}`);

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        setTimeout(() => startBot(), 5000);
      } else {
        console.log('❌ Déconnecté définitivement de WhatsApp. Supprime le dossier de session pour relancer.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const pushName = msg.pushName || 'Utilisateur';
      const text = normaliserMessage(msg);
      const isGroup = jid.endsWith('@g.us');

      let userQuery = text;
      const audioMessage = msg.message.audioMessage;

      if (audioMessage) {
        try {
          console.log(`🎙️ Réception d'un message audio de ${pushName}...`);
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }) }
          );
          const transcribedText = await transcrireAudio(buffer, audioMessage.mimetype);
          if (transcribedText) {
            userQuery = transcribedText;
            console.log(`📝 Transcription : "${userQuery}"`);
          }
        } catch (err) {
          console.error('❌ Erreur téléchargement/transcription audio :', err.message);
        }
      }

      if (!userQuery) continue;

      if (isGroup) {
        const estImportant = await analyserInformation(userQuery);
        if (estImportant) {
          await memoriserGroupe(jid, userQuery, pushName);
        }
      }

      let webData = null;
      const besoinWeb = await questionNecessiteWeb(userQuery);
      if (besoinWeb && TAVILY_API_KEY) {
        console.log(`🌐 Recherche Web pour : "${userQuery}"`);
        webData = await rechercherInternet(userQuery);
      }

      const groupMemory = isGroup ? await recupererMemoireGroupe(jid) : [];

      const replyText = await genererIA(jid, userQuery, groupMemory, webData);

      if (audioMessage && VOICE_REPLY_ENABLED) {
        const sentVoice = await envoyerVocal(jid, replyText, msg);
        if (sentVoice) continue;
      }

      await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
    }
  });
}

startBot().catch((err) => console.error('❌ Erreur démarrage bot :', err));
