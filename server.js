const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const REQUIRED_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.warn(`⚠️  Faltan variables de entorno: ${missingEnv.join(', ')}`);
}

const COPILOT_BASE_URL  = 'https://defaulte92af6beadc748a1965e60e102a5f0.5d.environment.api.powerplatform.com';
const BOT_IDENTIFIER    = 'cref3_asistenteRsce3MZRN1';
const API_VERSION       = '2022-03-01-preview';
const TOKEN_SCOPE       = 'https://api.powerplatform.com/.default';

const DIRECTLINE_TOKEN_URL = `${COPILOT_BASE_URL}/powervirtualagents/botsbyschema/${BOT_IDENTIFIER}/directline/token?api-version=${API_VERSION}`;

// ─── MSAL ─────────────────────────────────────────────────────────────────────
const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId:     process.env.AZURE_CLIENT_ID,
    authority:    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
});

async function acquireAppToken() {
  const result = await msalClient.acquireTokenByClientCredential({ scopes: [TOKEN_SCOPE] });
  if (!result || !result.accessToken) throw new Error('No se pudo obtener el token de Azure AD');
  return result.accessToken;
}

// ─── Endpoint: token Direct Line ──────────────────────────────────────────────
// El frontend lo llama una vez al abrir el chat y usa el token con el SDK
app.get('/api/directline-token', async (_req, res) => {
  try {
    const appToken = await acquireAppToken();

    const response = await fetch(DIRECTLINE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'Content-Type':  'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Copilot Studio ${response.status}: ${text}`);
    }

    const data = await response.json();
    return res.json({ token: data.token });

  } catch (err) {
    console.error('Error obteniendo token Direct Line:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', copilotConfigured: missingEnv.length === 0 });
});

// ─── Catch-all → index.html ───────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
});
