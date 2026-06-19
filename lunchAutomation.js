const fetch = require('node-fetch');
const PDFDocument = require('pdfkit');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

async function fetchSubmissions(apiKey, formId) {
  const url = `https://api.jotform.com/form/${formId}/submissions?apiKey=${apiKey}&limit=1000&orderby=created_at,DESC`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.responseCode !== 200) throw new Error('JotForm error: ' + d.message);
  return d.content || [];
}

function parseOrders(submissions) {
  const orders = [];

  for (const sub of submissions) {
    const answers = sub.answers || {};
    let child = '', division = '';
    const meals = {};

    for (const key in answers) {
      const a = answers[key];
      const label = (a.text || a.name || '').toLowerCase().trim();
      const value = a.answer || a.prettyFormat || '';

      function toText(v) {
        if (typeof v === 'string') return v.trim();
        if (v && typeof v === 'object') {
          if (v.first || v.last) return `${v.first || ''} ${v.last || ''}`.trim();
          return Object.values(v).filter(Boolean).join(' ').trim();
        }
        return '';
      }

      if (label === "camper's name" || (label.includes("camper") && label.includes("name"))) {
        child = toText(value);
      } else if (label.includes("division")) {
        division = toText(value);
      } else {
for (const day of DAYS) {
          if (label.startsWith(day.toLowerCase())) {
            let mealText = toText(value);
            // Strip trailing price like "$3.12" or "($3.12)" from the meal text
            mealText = mealText.replace(/\s*\(?\$\d+(\.\d{1,2})?\)?\s*$/, '').trim();
            if (mealText && mealText.toLowerCase() !== 'no meal' && mealText !== '-') {
              meals[day] = mealText;
            }
          }
        }

    if (child && Object.keys(meals).length > 0) {
      orders.push({ child: child.trim(), division: division.trim(), meals });
    }
  }

  return orders;
}

function filterThisWeek(submissions) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);

  return submissions.filter(s => {
    const created = new Date(s.created_at);
    return created >= start;
  });
}

function buildCatererPDF(orders) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text('Weekly Lunch Order - Caterer Summary', { align: 'center' });
    doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('black');

    const byDay = {};
    DAYS.forEach(d => byDay[d] = {});
    orders.forEach(o => {
      DAYS.forEach(d => {
        if (o.meals[d]) byDay[d][o.meals[d]] = (byDay[d][o.meals[d]] || 0) + 1;
      });
    });

    DAYS.forEach(day => {
      const items = Object.entries(byDay[day]);
      if (!items.length) return;
      doc.fontSize(14).fillColor('#1d4ed8').text(day);
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('black');
      items.sort((a, b) => b[1] - a[1]).forEach(([item, qty]) => {
        doc.text(`${item}`, { continued: true });
        doc.text(`  x${qty}`, { align: 'right' });
      });
      doc.moveDown(0.8);
    });

    if (orders.length === 0) {
      doc.fontSize(12).fillColor('gray').text('No orders found for this week.');
    }

    doc.end();
  });
}

function buildLabelsPDF(orders) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const labels = [];
    [...orders].sort((a, b) => (a.division + a.child).localeCompare(b.division + b.child))
      .forEach(o => {
        DAYS.forEach(d => {
          if (o.meals[d]) labels.push({ child: o.child, division: o.division, day: d, meal: o.meals[d] });
        });
      });

    const colWidth = 2.625 * 72;
    const rowHeight = 1 * 72;
    const marginLeft = 0.1875 * 72;
    const marginTop = 0.5 * 72;
    const colGap = 0.125 * 72;

    let i = 0;
    while (i < labels.length) {
      if (i > 0 && i % 30 === 0) doc.addPage();
      const posOnPage = i % 30;
      const col = posOnPage % 3;
      const row = Math.floor(posOnPage / 3);
      const x = marginLeft + col * (colWidth + colGap);
      const y = marginTop + row * rowHeight;

      const l = labels[i];
      doc.fontSize(10).fillColor('black').text(l.child, x + 8, y + 10, { width: colWidth - 16 });
      doc.fontSize(8).fillColor('gray').text(l.division, x + 8, y + 26, { width: colWidth - 16 });
      doc.fontSize(9).fillColor('#1d4ed8').text(`${l.day}: ${l.meal}`, x + 8, y + 40, { width: colWidth - 16 });

      i++;
    }

    if (labels.length === 0) {
      doc.fontSize(12).fillColor('black').text('No orders this week.', 50, 50);
    }

    doc.end();
  });
}

async function sendEmail({ resendApiKey, fromEmail, recipients, catererPdf, labelsPdf, orderCount }) {
  const weekStr = new Date().toLocaleDateString();

  const payload = {
    from: fromEmail,
    to: recipients,
    subject: `Lunch Orders - Week of ${weekStr}`,
    text: `This week's lunch orders are attached.\n\nTotal orders: ${orderCount}\n\n- Caterer summary PDF: meal counts by day\n- Labels PDF: printable Avery 5160 labels`,
    attachments: [
      {
        filename: `caterer-summary-${weekStr.replace(/\//g, '-')}.pdf`,
        content: catererPdf.toString('base64')
      },
      {
        filename: `food-labels-${weekStr.replace(/\//g, '-')}.pdf`,
        content: labelsPdf.toString('base64')
      }
    ]
  };

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await r.json();
  if (!r.ok) {
    throw new Error('Resend error: ' + JSON.stringify(result));
  }
  return result;
}

async function runWeeklyLunchAutomation(config) {
  const { jotformApiKey, jotformFormId, resendApiKey, fromEmail, recipients } = config;

  console.log('Fetching submissions...');
  const allSubs = await fetchSubmissions(jotformApiKey, jotformFormId);

  console.log('Filtering to this week...');
  const thisWeek = filterThisWeek(allSubs);

  console.log('Parsing orders...');
  const orders = parseOrders(thisWeek);
  console.log(`Found ${orders.length} orders`);

  console.log('Building PDFs...');
  const [catererPdf, labelsPdf] = await Promise.all([
    buildCatererPDF(orders),
    buildLabelsPDF(orders)
  ]);

  console.log('Sending email via Resend...');
  await sendEmail({ resendApiKey, fromEmail, recipients, catererPdf, labelsPdf, orderCount: orders.length });

  console.log('Done!');
  return { orderCount: orders.length };
}

module.exports = { runWeeklyLunchAutomation, fetchSubmissions, parseOrders, filterThisWeek, buildCatererPDF, buildLabelsPDF };
