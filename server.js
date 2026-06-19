const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Copilot Studio (Direct Line) setup ──────────────────────────────────────
const DIRECTLINE_SECRET = process.env.DIRECTLINE_SECRET;
const DIRECTLINE_BASE = 'https://directline.botframework.com/v3/directline';

if (!DIRECTLINE_SECRET) {
  console.warn('⚠️  Falta DIRECTLINE_SECRET en las variables de entorno.');
}

// ─── State ───────────────────────────────────────────────────────────────────
// sessionId → { conversationId, watermark, lastActive }
const sessions = new Map();

const SESSION_TTL_MS   = 30 * 60 * 1000;  // 30 min inactividad → evict
const MAX_SESSIONS     = 500;
const MAX_INPUT_LENGTH = 500;

// ─── Session helpers ─────────────────────────────────────────────────────────
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
      sessions.delete(oldest[0]);
    }
    sessions.set(sessionId, { conversationId: null, watermark: null, lastActive: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  return session;
}

// Evict sesiones inactivas cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000);

// ─── Direct Line helpers ─────────────────────────────────────────────────────
async function createConversation() {
  const res = await fetch(`${DIRECTLINE_BASE}/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DIRECTLINE_SECRET}` }
  });
  if (!res.ok) throw new Error(`Direct Line conversation error: ${res.status}`);
  return res.json(); // { conversationId, token, ... }
}

async function sendActivity(conversationId, text, sessionId) {
  const res = await fetch(`${DIRECTLINE_BASE}/conversations/${conversationId}/activities`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DIRECTLINE_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'message',
      from: { id: sessionId },
      text
    })
  });
  if (!res.ok) throw new Error(`Direct Line send error: ${res.status}`);
  const data = await res.json();
  return data.id; // id de la actividad enviada por el usuario
}

async function getBotReply(conversationId, watermark, afterActivityId, timeoutMs = 10000) {
  const start = Date.now();
  let currentWatermark = watermark;

  while (Date.now() - start < timeoutMs) {
    const url = `${DIRECTLINE_BASE}/conversations/${conversationId}/activities${currentWatermark ? `?watermark=${currentWatermark}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${DIRECTLINE_SECRET}` } });
    if (!res.ok) throw new Error(`Direct Line poll error: ${res.status}`);
    const data = await res.json();
    currentWatermark = data.watermark;

    const botMessages = data.activities.filter(
      (a) => a.type === 'message' && a.from.id !== 'user' && a.id !== afterActivityId
    );

    if (botMessages.length > 0) {
      const lastMsg = botMessages[botMessages.length - 1];
      const followUps = lastMsg.suggestedActions
        ? lastMsg.suggestedActions.actions.map((a) => a.title).slice(0, 3)
        : [];

      return { reply: lastMsg.text, followUps, watermark: currentWatermark };
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  throw new Error('Timeout esperando respuesta del agente');
}

async function getOrCreateConversation(session) {
  if (session.conversationId) return session.conversationId;
  const { conversationId } = await createConversation();
  session.conversationId = conversationId;
  session.watermark = null;
  return conversationId;
}

// ─── Chat endpoint ───────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.json({ reply: 'Escribe algo primero 😊', followUps: [] });
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId requerido' });
  }

  const sanitized = message.trim().substring(0, MAX_INPUT_LENGTH);
  const session = getSession(sessionId);

  try {
    const conversationId = await getOrCreateConversation(session);
    const activityId = await sendActivity(conversationId, sanitized, sessionId);
    const { reply, followUps, watermark } = await getBotReply(conversationId, session.watermark, activityId);

    session.watermark = watermark;

    return res.json({ reply, followUps });

  } catch (err) {
    console.error('Error Copilot Studio:', err.message);

    // Si la conversación de Direct Line caducó o falló, la reseteamos
    // para que el siguiente mensaje empiece una nueva.
    session.conversationId = null;
    session.watermark = null;

    return res.json({
      reply: 'Lo siento, ha ocurrido un error. Por favor, inténtalo de nuevo.',
      followUps: [],
    });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    directLineConfigured: Boolean(DIRECTLINE_SECRET),
  });
});

// ─── Catch-all → index.html ───────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
});