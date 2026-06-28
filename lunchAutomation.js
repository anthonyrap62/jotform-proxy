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
    let child = '', division = '', group = '', age = '', allergy = '';
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
      } else if (label.includes("division") && !label.includes("group")) {
        division = toText(value);
      } else if (label.includes("group")) {
        const v = toText(value);
        if (v) group = v;
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
            if (mealText && mealText.toLowerCase() !== 'no meal' && mealText !== '-' && mealText.toLowerCase() !== 'not selected') {
              meals[day] = mealText;
            }
          }
        }
      }
    }

    if (child && Object.keys(meals).length > 0) {
      orders.push({ child: child.trim(), division: division.trim(), group: group.trim(), age: age.trim(), allergy: allergy.trim(), meals });
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
        doc.text(`${o.child}${o.age ? ' (Age ' + o.age + ')' : ''}${o.division ? ' — ' + o.division : ''}${o.group ? ' / ' + o.group : ''}: ${o.allergy}`);
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
    const doc = new PDFDocument({
      size: [612, 792],
      margin: 0,
      autoFirstPage: true
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
