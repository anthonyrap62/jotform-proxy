const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { runWeeklyLunchAutomation } = require('./lunchAutomation');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ---------- Existing JotForm proxy endpoints (kept for the chat-based app) ----------
app.get('/jotform/questions', async (req, res) => {
  const { apiKey, formId } = req.query;
  if (!apiKey || !formId) return res.status(400).json({ error: 'apiKey and formId required' });
  try {
    const r = await fetch(`https://api.jotform.com/form/${formId}/questions?apiKey=${apiKey}`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/jotform/submissions', async (req, res) => {
  const { apiKey, formId } = req.query;
  if (!apiKey || !formId) return res.status(400).json({ error: 'apiKey and formId required' });
  try {
    const r = await fetch(`https://api.jotform.com/form/${formId}/submissions?apiKey=${apiKey}&limit=500&orderby=created_at,DESC`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Config from
