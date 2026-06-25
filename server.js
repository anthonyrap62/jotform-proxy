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

function getRCDCConfig() {
  const { JOTFORM_API_KEY, JOTFORM_FORM_ID, RESEND_API_KEY, FROM_EMAIL, RECIPIENT_EMAILS } = process.env;
  if (!JOTFORM_API_KEY || !JOTFORM_FORM_ID || !RESEND_API_KEY || !FROM_EMAIL || !RECIPIENT_EMAILS) {
    throw new Error('Missing RCDC environment variables.');
  }
  return {
    campName: 'RCDC',
    jotformApiKey: JOTFORM_API_KEY,
    jotformFormId: JOTFORM_FORM_ID,
    resendApiKey: RESEND_API_KEY,
    fromEmail: FROM_EMAIL,
    recipients: RECIPIENT_EMAILS.split(',').map(e => e.trim())
  };
}

function getCSIConfig() {
  const { JOTFORM_API_KEY, CSI_FORM_ID, RESEND_API_KEY, FROM_EMAIL, CSI_RECIPIENT_EMAILS } = process.env;
  if (!JOTFORM_API_KEY || !CSI_FORM_ID || !RESEND_API_KEY || !FROM_EMAIL || !CSI_RECIPIENT_EMAILS) {
    throw new Error('Missing CSI environment variables.');
  }
  return {
    campName: 'CSI',
    jotformApiKey: JOTFORM_API_KEY,
    jotformFormId: CSI_FORM_ID,
    resendApiKey: RESEND_API_KEY,
    fromEmail: FROM_EMAIL,
    recipients: CSI_RECIPIENT_EMAILS.split(',').map(e => e.trim())
  };
}

async function setFormAvailability(apiKey, formId, available) {
  const baseUrl = `https://api.jotform.com/form/${formId}/properties?apiKey=${apiKey}`;

  if (!available) {
    const msgParams = new URLSearchParams();
    msgParams.append('properties[messageOfLimitedForm]', 'Ordering for next week is now closed. Our form will reopen Monday so orders can be placed for the following week.');
    await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: msgParams.toString()
    });

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

// ---------- RCDC endpoints ----------
app.get('/run-lunch-automation', async (req, res) => {
  try {
    const result = await runWeeklyLunchAutomation(getRCDCConfig());
    res.json({ success: true, camp: 'RCDC', ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/disable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, false);
    res.json({ success: true, camp: 'RCDC', result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/enable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, true);
    res.json({ success: true, camp: 'RCDC', result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- CSI endpoints ----------
app.get('/csi/run-lunch-automation', async (req, res) => {
  try {
    const result = await runWeeklyLunchAutomation(getCSIConfig());
    res.json({ success: true, camp: 'CSI', ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/csi/disable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, CSI_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, CSI_FORM_ID, false);
    res.json({ success: true, camp: 'CSI', result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/csi/enable-form', async (req, res) => {
  try {
    const { JOTFORM_API_KEY, CSI_FORM_ID } = process.env;
    const result = await setFormAvailability(JOTFORM_API_KEY, CSI_FORM_ID, true);
    res.json({ success: true, camp: 'CSI', result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- RCDC scheduled jobs ----------
cron.schedule('0 19 * * 5', async () => {
  console.log('[RCDC] Running Friday 7pm lunch automation...');
  try {
    const result = await runWeeklyLunchAutomation(getRCDCConfig());
    console.log('[RCDC] Done:', result);
  } catch (e) {
    console.error('[RCDC] Failed:', e.message);
  }
}, { timezone: 'America/New_York' });

cron.schedule('0 18 * * 5', async () => {
  console.log('[RCDC] Disabling form (Friday 6pm)...');
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, false);
    console.log('[RCDC] Form disabled.');
  } catch (e) {
    console.error('[RCDC] Disable failed:', e.message);
  }
}, { timezone: 'America/New_York' });

cron.schedule('0 7 * * 1', async () => {
  console.log('[RCDC] Enabling form (Monday 7am)...');
  try {
    const { JOTFORM_API_KEY, JOTFORM_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, JOTFORM_FORM_ID, true);
    console.log('[RCDC] Form enabled.');
  } catch (e) {
    console.error('[RCDC] Enable failed:', e.message);
  }
}, { timezone: 'America/New_York' });

// ---------- CSI scheduled jobs ----------
cron.schedule('0 19 * * 5', async () => {
  console.log('[CSI] Running Friday 7pm lunch automation...');
  try {
    const result = await runWeeklyLunchAutomation(getCSIConfig());
    console.log('[CSI] Done:', result);
  } catch (e) {
    console.error('[CSI] Failed:', e.message);
  }
}, { timezone: 'America/New_York' });

cron.schedule('0 18 * * 5', async () => {
  console.log('[CSI] Disabling form (Friday 6pm)...');
  try {
    const { JOTFORM_API_KEY, CSI_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, CSI_FORM_ID, false);
    console.log('[CSI] Form disabled.');
  } catch (e) {
    console.error('[CSI] Disable failed:', e.message);
  }
}, { timezone: 'America/New_York' });

cron.schedule('0 7 * * 1', async () => {
  console.log('[CSI] Enabling form (Monday 7am)...');
  try {
    const { JOTFORM_API_KEY, CSI_FORM_ID } = process.env;
    await setFormAvailability(JOTFORM_API_KEY, CSI_FORM_ID, true);
    console.log('[CSI] Form enabled.');
  } catch (e) {
    console.error('[CSI] Enable failed:', e.message);
  }
}, { timezone: 'America/New_York' });

app.listen(PORT, () => console.log(`Server running on port ${PORT}. RCDC + CSI scheduled: Fri 6pm disable, Fri 7pm PDFs, Mon 7am enable (America/New_York).`));
