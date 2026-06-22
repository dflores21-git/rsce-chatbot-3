const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Configuración Copilot Studio (sin autenticación) ────────────────────────
const COPILOT_BASE_URL = 'https://defaulte92af6beadc748a1965e60e102a5f0.5d.environment.api.powerplatform.com';
const BOT_IDENTIFIER  = 'cref3_asistenteRsce3MZRN1';
const API_VERSION     = '2022-03-01-preview';

const CONVERSATIONS_URL = `${COPILOT_BASE_URL}/copilotstudio/dataverse-backed/unauthenticated/bots/${BOT_IDENTIFIER}/conversations?api-version=${API_VERSION}`;

// ─── Helpers REST ─────────────────────────────────────────────────────────────
async function startConversation() {
  const res = await fetch(CONVERSATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`startConversation ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.conversationId || data.id;
}

async function sendMessage(conversationId, text) {
  const url = `${COPILOT_BASE_URL}/copilotstudio/dataverse-backed/unauthenticated/bots/${BOT_IDENTIFIER}/conversations/${conversationId}/activities?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'message', text }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`sendMessage ${res.status}: ${errText}`);
  }
  return res.json();
}

async function getActivities(conversationId, watermark) {
  let url = `${COPILOT_BASE_URL}/copilotstudio/dataverse-backed/unauthenticated/bots/${BOT_IDENTIFIER}/conversations/${conversationId}/activities?api-version=${API_VERSION}`;
  if (watermark) url += `&watermark=${watermark}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`getActivities ${res.status}: ${errText}`);
  }
  return res.json();
}

// Polling: espera la respuesta del bot (máx 15 s)
async function waitForBotReply(conversationId, watermark) {
  const MAX_ATTEMPTS = 15;
  const DELAY_MS     = 1000;
  let lastWatermark  = watermark;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    const data       = await getActivities(conversationId, lastWatermark);
    const activities = data.activities || [];
    const botMessages = activities.filter(
      (a) => a.type === 'message' && a.from?.role === 'bot'
    );

    if (botMessages.length > 0) {
      const reply = botMessages.map((a) => a.text).filter(Boolean).join('\n\n')
        || 'No obtuve una respuesta del agente.';

      const withSuggestions = botMessages.find(
        (a) => a.suggestedActions?.actions?.length
      );
      const followUps = withSuggestions
        ? withSuggestions.suggestedActions.actions.map((a) => a.title).slice(0, 3)
        : [];

      return { reply, followUps, watermark: data.watermark };
    }

    if (data.watermark) lastWatermark = data.watermark;
  }

  return {
    reply: 'El agente tardó demasiado en responder. Inténtalo de nuevo.',
    followUps: [],
    watermark: lastWatermark,
  };
}

// ─── State ────────────────────────────────────────────────────────────────────
const sessions = new Map();

const SESSION_TTL_MS   = 30 * 60 * 1000;
const MAX_SESSIONS     = 500;
const MAX_INPUT_LENGTH = 500;

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()]
        .sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
      sessions.delete(oldest[0]);
    }
    sessions.set(sessionId, { conversationId: null, watermark: null, lastActive: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  return session;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000);

// ─── Chat endpoint ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.json({ reply: 'Escribe algo primero 😊', followUps: [] });
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId requerido' });
  }

  const sanitized = message.trim().substring(0, MAX_INPUT_LENGTH);
  const session   = getSession(sessionId);

  try {
    if (!session.conversationId) {
      session.conversationId = await startConversation();
      session.watermark      = null;
    }

    await sendMessage(session.conversationId, sanitized);

    const { reply, followUps, watermark } = await waitForBotReply(
      session.conversationId,
      session.watermark
    );
    session.watermark = watermark;

    return res.json({ reply, followUps });

  } catch (err) {
    console.error('Error Copilot Studio:', err.message);
    session.conversationId = null;
    session.watermark      = null;

    return res.json({
      reply: 'Lo siento, ha ocurrido un error. Por favor, inténtalo de nuevo.',
      followUps: [],
    });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// ─── Catch-all → index.html ───────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
});