
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

async function scrapeWebsite() {
  console.log('Extrayendo web...');
  let allContent = '';

  for (const url of RSCE_URLS) {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      const title = $('title').text();
      const body = $('body').text();

      allContent += `\n--- ${title} ---\n`;
      allContent += body.substring(0, 1500);

    } catch (err) {
      console.log('Error scraping:', url);
    }
  }

  websiteContent = allContent;
  console.log('Contenido cargado ✅');
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

    const prompt = `
Eres un asistente de la RSCE.
Responde SIEMPRE en español.
Sé natural, útil y breve.

Historial:
${history}

Contenido:
${websiteContent}

Usuario: ${message}
`;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    sessions[sessionId].push({ role: "bot", content: reply });

    res.json({ reply });

  } catch (err) {
    res.json({ reply: "Error, inténtalo otra vez." });
  }
});

// limpiar memoria automática
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
  console.log(`Servidor activo en ${PORT}`);
});
