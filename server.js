const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { runWeeklyLunchAutomation } = require('./lunchAutomation');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

function getConfig() {
  const {
    JOTFORM_API_KEY,
    JOTFORM_FORM_ID,
    RESEND_API_KEY,
    FROM_EMAIL,
    RECIPIENT_EMAILS
  } = process.env;

  if (!JOTFORM_API_KEY || !JOTFORM_FORM_ID || !RESEND_API_KEY || !FROM_EMAIL || !RECIPIENT_EMAILS) {
    throw new Error('Missing required environment variables. Check Railway Variables tab.');
  }

  return {
    jotformApiKey: JOTFORM_API_KEY,
    jotformFormId: JOTFORM_FORM_ID,
    resendApiKey: RESEND_API_KEY,
    fromEmail: FROM_EMAIL,
    recipients: RECIPIENT_EMAILS.split(',').map(e => e.trim())
  };
}

app.get('/run-lunch-automation', async (req, res) => {
  try {
    const config = getConfig();
    const result = await runWeeklyLunchAutomation(config);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

cron.schedule('0 19 * * 5', async () => {
  console.log('Running scheduled Friday 7pm lunch automation...');
  try {
    const config = getConfig();
    const result = await runWeeklyLunchAutomation(config);
    console.log('Scheduled run complete:', result);
  } catch (e) {
    console.error('Scheduled run failed:', e.message);
  }
}, {
  timezone: 'America/New_York'
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}. Scheduled job set for Fridays 7pm America/New_York.`));
