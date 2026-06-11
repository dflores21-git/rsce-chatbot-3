const sessions = {};

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Puedes usar 'gemini-1.5-flash' o 'gemini-2.0-flash' o la versión que tengas configurada
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

let websiteContent = '';

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

// Extracción optimizada (en paralelo y limpiando el contenido innecesario)
async function scrapeWebsite() {
  console.log('Iniciando extracción de la web de RSCE...');
  const startTime = Date.now();

  try {
    const promises = RSCE_URLS.map(async (url) => {
      try {
        // Añadimos timeout de 10 segundos para evitar bloqueos
        const response = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(response.data);

        // Eliminamos elementos que ensucian el texto (scripts, estilos, navegación, menús)
        $('script, style, nav, footer, header, iframe, noscript').remove();

        const title = $('title').text().trim();
        // Colapsamos los espacios en blanco múltiples para ahorrar tokens
        const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        return `\n--- Sección: ${title} ---\n${bodyText.substring(0, 1500)}\n`;
      } catch (err) {
        console.log(`No se pudo extraer: ${url} (Error: ${err.message})`);
        return '';
      }
    });

    const results = await Promise.all(promises);
    websiteContent = results.filter(content => content !== '').join('\n');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Contenido cargado exitosamente en ${duration}s ✅`);
  } catch (error) {
    console.error('Error general en la extracción:', error);
  }
}

scrapeWebsite();
setInterval(scrapeWebsite, 24 * 60 * 60 * 1000);

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message) {
    return res.json({ reply: "Escribe algo primero 😊" });
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  sessions[sessionId].push({ role: "user", content: message });

  try {
    const history = sessions[sessionId]
      .slice(-6)
      .map(m => `${m.role === "user" ? "Usuario" : "Bot"}: ${m.content}`)
      .join("\n");

    // Hemos modificado el Prompt para forzar y guiar al bot a dar preguntas de seguimiento lógicas
    const prompt = `
Eres un asistente virtual oficial de la RSCE (Real Sociedad Canina de España).
Responde SIEMPRE en español, de manera natural, útil y concisa.

Usa la siguiente información del sitio web para fundamentar tus respuestas:
${websiteContent}

Historial de la conversación:
${history}

Pregunta del usuario: ${message}

INSTRUCCIONES DE RESPUESTA:
1. Responde a la pregunta del usuario con la información disponible.
2. Al final de tu respuesta, añade una pequeña sección llamada "**Preguntas sugeridas:**" o "**También te puede interesar:**" y propón de 2 a 3 preguntas de seguimiento muy cortas y amigables que el usuario podría querer hacer a continuación según lo que acaban de hablar.
Por ejemplo:
- ¿Quieres saber cuáles son las tarifas para tramitar un pedigree?
- ¿Te gustaría conocer el calendario de exposiciones?
`;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    sessions[sessionId].push({ role: "bot", content: reply });

    res.json({ reply });

  } catch (err) {
    console.error('Error en /api/chat:', err); // Ahora verás el detalle del fallo en tu terminal
    res.json({ reply: "Error al procesar la respuesta, por favor inténtalo de nuevo." });
  }
});

// Limpiar memoria automática
setInterval(() => {
  for (const id in sessions) {
    if (sessions[id].length > 20) {
      sessions[id] = sessions[id].slice(-10);
    }
  }
}, 60000);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
