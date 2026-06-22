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
  const { JOTFORM_API_KEY, JOTFORM_FORM_ID, RESEND_API_KEY, FROM_EMAIL, RECIPIENT_EMAILS } = process.env;
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

async function setFormAvailability(apiKey, formId, available) {
  const baseUrl = `https://api.jotform.com/form/${formId}/properties?apiKey=${apiKey}`;

  if (!available) {
    // Step 1: Set the custom closed message first
    const msgParams = new URLSearchParams();
    msgParams.append('properties[messageOfLimitedForm]', 'Ordering for next week is now closed. Our form will reopen Monday so orders can be placed for the following week.');
    await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: msgParams.toString()
    });

    // Step 2: Disable the form
    const statusParams = new URLSearchParams();
    statusParams.append('properties[status]', 'DISABLED');
    const r = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: statusParams.toString()
    });
    const data = await r.json();
    if (data.responseCode !== 200) throw new Error('Failed to disable form: ' + JSON.stringify(data));
    return data;
  } else {
    // Enable the form
    const params = new URLSearchParams();
    params.append('properties[status]', 'ENABLED');
    const r = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await r.json();
    if (data.responseCode !== 200) throw new Error('Failed to enable form: ' + JSON.stringify(data));
    return data;
  }
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

app.get('/disable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, false);
    res.json({ success: true, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/enable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, true);
    res.json({ success: true, result });
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
}, { timezone: 'America/New_York' });

cron.schedule('0 18 * * 5', async () => {
  console.log('Disabling form (Friday 6pm cutoff)...');
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, false);
    console.log('Form disabled successfully.');
  } catch (e) {
    console.error('Failed to disable form:', e.message);
  }
}, { timezone: 'America/New_York' });

cron.schedule('0 7 * * 1', async () => {
  console.log('Enabling form (Monday 7am reopen)...');
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, true);
    console.log('Form enabled successfully.');
  } catch (e) {
    console.error('Failed to enable form:', e.message);
  }
}, { timezone: 'America/New_York' });

app.listen(PORT, () => console.log(`Server running on port ${PORT}. Scheduled jobs: Fri 6pm disable form, Fri 7pm send PDFs, Mon 7am enable form (America/New_York).`));
