const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { ConfidentialClientApplication } = require('@azure/msal-node');
const { CopilotStudioClient } = require('@microsoft/agents-copilotstudio-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Copilot Studio (M365 Agents SDK) setup ──────────────────────────────────
const REQUIRED_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'COPILOT_ENVIRONMENT_ID',
  'COPILOT_AGENT_IDENTIFIER',   // ← corregido: antes era COPILOT_SCHEMA_NAME
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.warn(`⚠️  Faltan variables de entorno: ${missingEnv.join(', ')}`);
}

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
});

const copilotSettings = {
  environmentId: process.env.COPILOT_ENVIRONMENT_ID,
  agentIdentifier: process.env.COPILOT_AGENT_IDENTIFIER,  // ← corregido: antes era schemaName
  tenantId: process.env.AZURE_TENANT_ID,                   // ← añadido: necesario para entornos Default-
};

// MSAL cachea el token internamente y lo renueva solo cuando hace falta,
// así que podemos llamar esto en cada request sin preocuparnos por expiración.
async function acquireAppToken() {
  const scope = CopilotStudioClient.scopeFromSettings(copilotSettings);
  const result = await msalClient.acquireTokenByClientCredential({ scopes: [scope] });
  if (!result || !result.accessToken) {
    throw new Error('No se pudo obtener el token de acceso de Azure AD');
  }
  return result.accessToken;
}

async function getCopilotClient() {
  const token = await acquireAppToken();
  return new CopilotStudioClient(copilotSettings, token);
}

// ─── State ───────────────────────────────────────────────────────────────────
// sessionId → { conversationId, lastActive }
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
    sessions.set(sessionId, { conversationId: null, lastActive: Date.now() });
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

// ─── Copilot Studio helpers ───────────────────────────────────────────────────
async function getOrCreateConversationId(client, session) {
  if (session.conversationId) return session.conversationId;
  await client.startConversationAsync(true);
  const conversationId = client.conversationId;
  session.conversationId = conversationId;
  return conversationId;
}

async function askAgent(sanitizedMessage, session) {
  const client = await getCopilotClient();
  const conversationId = await getOrCreateConversationId(client, session);

  const replies = await client.askQuestionAsync(sanitizedMessage, conversationId);

  const textParts = replies
    .filter((a) => a.type === 'message' && a.text)
    .map((a) => a.text);
  const reply = textParts.join('\n\n') || 'No obtuve una respuesta del agente.';

  const withSuggestions = replies.find(
    (a) => a.suggestedActions && a.suggestedActions.actions?.length
  );
  const followUps = withSuggestions
    ? withSuggestions.suggestedActions.actions.map((a) => a.title).slice(0, 3)
    : [];

  return { reply, followUps };
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
    const { reply, followUps } = await askAgent(sanitized, session);
    return res.json({ reply, followUps });

  } catch (err) {
    console.error('Error Copilot Studio:', err.message);

    // Si la conversación falló (p. ej. expiró del lado del agente),
    // la reseteamos para que el siguiente mensaje empiece una nueva.
    session.conversationId = null;

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
    copilotConfigured: missingEnv.length === 0,
  });
});

// ─── Catch-all → index.html ───────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
});