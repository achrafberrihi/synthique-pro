/* ============================================================
   Synthique — Express Backend
   ============================================================ */
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: process.env.SITE_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Gmail transporter ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS   // Gmail App Password (16 chars)
  }
});

// Verify SMTP connection on startup (non-blocking)
transporter.verify().then(() => {
  console.log('  ✓ Gmail SMTP ready');
}).catch(() => {
  console.warn('  ⚠  Gmail SMTP not configured — emails will be skipped (check .env)');
});

// ── Leads storage (JSON file fallback) ───────────────────────
const LEADS_FILE = path.join(__dirname, 'leads.json');
function saveLeadToFile(data) {
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch {}
  }
  leads.push(data);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ── Rate limiter — 8 submissions / IP / 15 min ───────────────
const contactLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 8,
  message  : { success: false, error: 'Too many requests. Please try again in 15 minutes.' }
});

// ── POST /api/contact ─────────────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  const { name, email, company, interest, budget, timeline, message } = req.body;

  // Validation
  if (!name?.trim() || !email?.trim() || !interest?.trim() || !message?.trim()) {
    return res.status(400).json({ success: false, error: 'name, email, interest and message are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  const lead = {
    id        : `SYN-${Date.now()}`,
    timestamp : new Date().toISOString(),
    name      : name.trim(),
    email     : email.trim().toLowerCase(),
    company   : company?.trim() || '—',
    interest  : interest.trim(),
    budget    : budget || '—',
    timeline  : timeline || '—',
    message   : message.trim(),
    ip        : req.ip
  };

  // 1) Save to leads.json
  try { saveLeadToFile(lead); } catch (e) { console.error('leads.json write error:', e.message); }

  // 2) Send email notification
  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;background:#06060E;color:#EEEEF8;padding:32px;border-radius:12px;">
      <h2 style="color:#9D5CFF;margin-bottom:4px;">New Synthique Lead</h2>
      <p style="color:#8886A8;margin-top:0;">Ref: ${lead.id}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        ${Object.entries({ Name: lead.name, Email: lead.email, Company: lead.company,
            Interest: lead.interest, Budget: lead.budget, Timeline: lead.timeline })
          .map(([k,v]) => `
            <tr style="border-bottom:1px solid #18183A;">
              <td style="padding:10px 0;color:#8886A8;width:120px;">${k}</td>
              <td style="padding:10px 0;font-weight:600;">${v}</td>
            </tr>`).join('')}
      </table>
      <div style="margin-top:20px;padding:16px;background:#0F0F1E;border-radius:8px;border-left:3px solid #7C3AED;">
        <p style="color:#8886A8;margin:0 0 6px;">Message</p>
        <p style="margin:0;">${lead.message.replace(/\n/g,'<br>')}</p>
      </div>
      <p style="color:#3A3860;font-size:12px;margin-top:24px;">synthique.ai · Casablanca, Morocco</p>
    </div>`;

  try {
    await transporter.sendMail({
      from    : `"Synthique Website" <${process.env.EMAIL_USER}>`,
      to      : process.env.EMAIL_TO || 'achraf-berrihi@hotmail.com',
      subject : `[Synthique] New inquiry: ${lead.interest} — ${lead.name}`,
      html    : htmlBody
    });
    console.log(`✓ Email sent for lead ${lead.id}`);
  } catch (e) {
    console.warn(`⚠  Email not sent (${e.message}) — lead saved to leads.json`);
  }

  console.log(`✓ Lead saved: ${lead.id} | ${lead.name} | ${lead.interest}`);
  res.json({ success: true, message: "Thank you! We'll respond within 24 hours.", ref: lead.id });
});

// ── GET /api/stats ─────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json({
    units_per_month   : 20300,
    specialists       : 107,
    dialects          : 52,
    quality_rate      : 96.4,
    enterprise_clients: 5,
    projects_delivered: 143,
    avg_delivery_days : 13.2,
    iaa_score         : 0.87
  });
});

// ── GET /api/health ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
});

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  🚀 Synthique running → http://localhost:${PORT}\n`);
});
