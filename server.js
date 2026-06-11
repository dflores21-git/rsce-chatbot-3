
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
 
const app = express();
const PORT = process.env.PORT || 3000;
 
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
 
// ─── Gemini setup ────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
 
// ─── State ───────────────────────────────────────────────────────────────────
const sessions = new Map();          // sessionId → { messages[], lastActive }
let websiteContent = '';
let isScraping = false;
 
const SESSION_TTL_MS   = 30 * 60 * 1000;  // 30 min inactivity → evict
const MAX_SESSIONS     = 500;
const MAX_INPUT_LENGTH = 500;
 
// ─── URLs ────────────────────────────────────────────────────────────────────
const RSCE_URLS = [
  'https://www.rsce.es/',
  'https://www.rsce.es/quienes-somos/',
  'https://www.rsce.es/organigrama/',
  'https://www.rsce.es/socios-abonados/',
  'https://www.rsce.es/eventos-rsce/',
  'https://www.rsce.es/razas-espanolas/',
  'https://www.rsce.es/morfologia/',
  'https://www.rsce.es/agility/',
  'https://www.rsce.es/igp/',
  'https://www.rsce.es/obediencia/',
  'https://www.rsce.es/busqueda-y-rescate/',
  'https://www.rsce.es/rally-obediencia/',
  'https://www.rsce.es/grooming/',
  'https://www.rsce.es/salud-y-bienestar-rsce/',
  'https://www.rsce.es/criadores/',
  'https://www.rsce.es/criadores-premium/',
  'https://www.rsce.es/servicios-rsce/',
  'https://www.rsce.es/tramites-rsc/',
  'https://www.rsce.es/afijos/',
  'https://www.rsce.es/displasia/',
  'https://www.rsce.es/certificados-de-pedigree/',
  'https://www.rsce.es/tarifas/',
  'https://www.rsce.es/contacto-rsce/',
  'https://www.rsce.es/reglamentos_rsce/',
  'https://www.rsce.es/area-de-formaciones/',
  'https://www.rsce.es/noticias-rsce/',
  'https://www.rsce.es/jueces-de-la-rsce/',
  'https://www.rsce.es/faq/',
];
 
// ─── Scraping ────────────────────────────────────────────────────────────────
function cleanText(raw) {
  return raw
    .replace(/\s+/g, ' ')           // colapsar espacios/saltos
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}
 
async function scrapeWebsite() {
  if (isScraping) return;
  isScraping = true;
  console.log('🔄 Extrayendo contenido web...');
 
  const parts = [];
 
  for (const url of RSCE_URLS) {
    try {
      const response = await axios.get(url, { timeout: 8000 });
      const $ = cheerio.load(response.data);
 
      // Eliminar bloques que no aportan contenido útil
      $('script, style, nav, footer, header, .menu, .cookie-banner').remove();
 
      const title = $('title').text().trim();
      const body  = cleanText($('body').text()).substring(0, 2000);
 
      parts.push(`\n=== ${title} (${url}) ===\n${body}`);
    } catch (err) {
      console.warn(`⚠️  Error scraping ${url}: ${err.message}`);
    }
  }
 
  websiteContent = parts.join('\n');
  isScraping = false;
  console.log(`✅ Contenido cargado (${Math.round(websiteContent.length / 1024)} KB)`);
}
 
scrapeWebsite();
setInterval(scrapeWebsite, 24 * 60 * 60 * 1000);
 
// ─── Session helpers ─────────────────────────────────────────────────────────
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    // Evict oldest session if at capacity
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
      sessions.delete(oldest[0]);
    }
    sessions.set(sessionId, { messages: [], lastActive: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  return session;
}
 
// Evict inactive sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000);
 
// ─── Chat endpoint ───────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
 
  // Validación básica
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.json({ reply: 'Escribe algo primero 😊', followUps: [] });
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId requerido' });
  }
 
  const sanitized = message.trim().substring(0, MAX_INPUT_LENGTH);
  const session   = getSession(sessionId);
 
  session.messages.push({ role: 'user', content: sanitized });
 
  // Últimas 6 rondas de conversación (3 usuario + 3 bot)
  const recentHistory = session.messages
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
    .join('\n');
 
  const prompt = `
Eres el asistente virtual oficial de la RSCE (Real Sociedad Canina de España).
Responde SIEMPRE en español. Sé natural, útil y conciso.
Usa el contenido de la web como fuente principal. Si no encuentras la respuesta, dilo claramente.
 
Historial reciente:
${recentHistory}
 
Contenido de la web RSCE:
${websiteContent}
 
Pregunta del usuario: ${sanitized}
 
Responde en formato JSON con esta estructura exacta (sin markdown, sin bloques de código):
{
  "reply": "<tu respuesta principal, clara y útil>",
  "followUps": ["<pregunta relacionada 1>", "<pregunta relacionada 2>", "<pregunta relacionada 3>"]
}
 
Las followUps deben ser preguntas cortas y relevantes que el usuario podría querer preguntar a continuación.
`;
 
  try {
    const result = await model.generateContent(prompt);
    const raw    = result.response.text().trim();
 
    // Parsear JSON con fallback robusto
    let reply    = raw;
    let followUps = [];
 
    try {
      // Eliminar posibles bloques ```json ... ``` que el modelo a veces incluye
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed  = JSON.parse(cleaned);
      reply    = parsed.reply    ?? raw;
      followUps = Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 3) : [];
    } catch {
      // Si el modelo no devuelve JSON válido, usar texto plano sin followUps
      reply = raw;
    }
 
    session.messages.push({ role: 'bot', content: reply });
 
    // Evitar que el historial crezca indefinidamente
    if (session.messages.length > 40) {
      session.messages = session.messages.slice(-20);
    }
 
    return res.json({ reply, followUps });
 
  } catch (err) {
    console.error('Error Gemini:', err.message);
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
    contentLoaded: websiteContent.length > 0,
  });
});
 
// ─── Catch-all → index.html ───────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
 
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
});