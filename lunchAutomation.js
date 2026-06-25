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
    let child = '', division = '', age = '', allergy = '';
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
      } else if (label.includes("camper") && label.includes("age")) {
        age = toText(value);
      } else if (label.includes("allerg") && !label.includes("list") && !label.includes("please")) {
        const v = toText(value).toLowerCase();
        if (v === 'no' || v === '') allergy = '';
      } else if ((label.includes("list") || label.includes("please list")) && label.includes("allerg")) {
        const v = toText(value);
        if (v) allergy = v;
      } else {
        for (const day of DAYS) {
          if (label.startsWith(day.toLowerCase()) ||
              (day === 'Thursday' && label.includes('thursday'))) {
            let mealText = toText(value);
            mealText = mealText.replace(/\s*\(?\$\d+(\.\d{1,2})?\)?\s*$/, '').trim();
            if (mealText && mealText.toLowerCase() !== 'no meal' && mealText !== '-') {
              meals[day] = mealText;
            }
          }
        }
      }
    }

    if (child && Object.keys(meals).length > 0) {
      orders.push({ child: child.trim(), division: division.trim(), age: age.trim(), allergy: allergy.trim(), meals });
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

function buildCatererPDF(orders, campName) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text(`${campName || 'Weekly'} Lunch Order - Caterer Summary`, { align: 'center' });
    doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('black');

    const allergies = orders.filter(o => o.allergy);
    if (allergies.length > 0) {
      doc.fontSize(13).fillColor('#dc2626').text('⚠ ALLERGY ALERTS', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('black');
      allergies.forEach(o => {
        doc.text(`${o.child}${o.age ? ' (Age ' + o.age + ')' : ''}: ${o.allergy}`);
      });
      doc.moveDown(1);
      doc.fillColor('black');
    }

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
          if (o.meals[d]) labels.push({ child: o.child, division: o.division, age: o.age, allergy: o.allergy, day: d, meal: o.meals[d] });
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
      doc.fontSize(10).fillColor('black').text(l.child, x + 8, y + 8, { width: colWidth - 16 });
      const subLine = [l.division, l.age ? 'Age ' + l.age : ''].filter(Boolean).join(' · ');
      if (subLine) doc.fontSize(8).fillColor('gray').text(subLine, x + 8, y + 22, { width: colWidth - 16 });
      doc.fontSize(9).fillColor('#1d4ed8').text(`${l.day}: ${l.meal}`, x + 8, y + 35, { width: colWidth - 16 });
      if (l.allergy) doc.fontSize(8).fillColor('#dc2626').text(`⚠ ${l.allergy}`, x + 8, y + 48, { width: colWidth - 16 });

      i++;
    }

    if (labels.length === 0) {
      doc.fontSize(12).fillColor('black').text('No orders this week.', 50, 50);
    }

    doc.end();
  });
}

function buildDailyDistributionPDF(orders, campName) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text(`${campName || ''} Daily Lunch Distribution List`, { align: 'center' });
    doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.fillColor('black');

    let firstDay = true;
    DAYS.forEach(day => {
      const dayOrders = orders.filter(o => o.meals[day]);
      if (!dayOrders.length) return;

      if (!firstDay) doc.addPage();
      firstDay = false;

      doc.fontSize(20).fillColor('#1d4ed8').text(day);
      doc.moveDown(0.5);
      doc.fillColor('black');

      const byDivision = {};
      dayOrders.forEach(o => {
        const div = o.division || 'General';
        if (!byDivision[div]) byDivision[div] = [];
        byDivision[div].push(o);
      });

      Object.keys(byDivision).sort().forEach(div => {
        doc.fontSize(13).fillColor('#444').text(div, { underline: true });
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor('black');

        byDivision[div]
          .sort((a, b) => a.child.localeCompare(b.child))
          .forEach(o => {
            const details = [o.age ? 'Age ' + o.age : '', o.allergy ? '⚠ ' + o.allergy : ''].filter(Boolean).join(' | ');
            doc.text(`☐  ${o.child}`, { continued: true, indent: 15 });
            doc.text(`   —   ${o.meals[day]}${details ? '   (' + details + ')' : ''}`, { align: 'left' });
          });

        doc.moveDown(0.6);
      });
    });

    if (orders.length === 0) {
      doc.fontSize(12).fillColor('gray').text('No orders found for this week.');
    }

    doc.end();
  });
}

async function sendEmail({ resendApiKey, fromEmail, recipients, catererPdf, labelsPdf, distributionPdf, orderCount, campName }) {
  const weekStr = new Date().toLocaleDateString();

  const payload = {
    from: fromEmail,
    to: recipients,
    subject: `${campName || 'Lunch'} Orders - Week of ${weekStr}`,
    text: `${campName || 'Lunch'} orders for the week of ${weekStr} are attached.\n\nTotal orders: ${orderCount}\n\n- Caterer summary PDF: meal counts by day + allergy alerts\n- Labels PDF: printable Avery 5160 labels\n- Daily Distribution List PDF: per-day, per-camper meal list for counselors`,
    attachments: [
      {
        filename: `caterer-summary-${weekStr.replace(/\//g, '-')}.pdf`,
        content: catererPdf.toString('base64')
      },
      {
        filename: `food-labels-${weekStr.replace(/\//g, '-')}.pdf`,
        content: labelsPdf.toString('base64')
      },
      {
        filename: `daily-distribution-list-${weekStr.replace(/\//g, '-')}.pdf`,
        content: distributionPdf.toString('base64')
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
  if (!r.ok) throw new Error('Resend error: ' + JSON.stringify(result));
  return result;
}

async function runWeeklyLunchAutomation(config) {
  const { jotformApiKey, jotformFormId, resendApiKey, fromEmail, recipients, campName } = config;

  console.log(`[${campName || 'Camp'}] Fetching submissions...`);
  const allSubs = await fetchSubmissions(jotformApiKey, jotformFormId);

  console.log(`[${campName || 'Camp'}] Filtering to this week...`);
  const thisWeek = filterThisWeek(allSubs);

  console.log(`[${campName || 'Camp'}] Parsing orders...`);
  const orders = parseOrders(thisWeek);
  console.log(`[${campName || 'Camp'}] Found ${orders.length} orders`);

  console.log(`[${campName || 'Camp'}] Building PDFs...`);
  const [catererPdf, labelsPdf, distributionPdf] = await Promise.all([
    buildCatererPDF(orders, campName),
    buildLabelsPDF(orders),
    buildDailyDistributionPDF(orders, campName)
  ]);

  console.log(`[${campName || 'Camp'}] Sending email via Resend...`);
  await sendEmail({ resendApiKey, fromEmail, recipients, catererPdf, labelsPdf, distributionPdf, orderCount: orders.length, campName });

  console.log(`[${campName || 'Camp'}] Done!`);
  return { orderCount: orders.length };
}

module.exports = { runWeeklyLunchAutomation, fetchSubmissions, parseOrders, filterThisWeek, buildCatererPDF, buildLabelsPDF, buildDailyDistributionPDF };
