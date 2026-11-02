/* ============================================================
   Synthique — Express Backend
   ============================================================ */
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs/promises');

const app  = express();
const PORT = process.env.PORT || 3000;
const LEADS_FILE = process.env.LEADS_FILE || path.join(__dirname, 'leads.json');

// Behind a reverse proxy (Render, Railway, Nginx…) set TRUST_PROXY=1 so
// rate limiting sees the real client IP instead of the proxy's.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable('x-powered-by');

// ── Field limits ──────────────────────────────────────────────
const LIMITS = { name: 100, email: 254, company: 120, interest: 80, budget: 40, timeline: 40, message: 5000 };

// ── Helpers ───────────────────────────────────────────────────
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── Middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
});
// Same-origin requests don't need CORS; only allow the configured site otherwise.
app.use('/api', cors({ origin: process.env.SITE_URL || false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ── Mail transporter (only if configured) ─────────────────────
const mailEnabled = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const transporter = mailEnabled
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

if (transporter) {
  transporter.verify()
    .then(() => console.log('  ✓ Gmail SMTP ready'))
    .catch((e) => console.warn(`  ⚠  Gmail SMTP check failed: ${e.message}`));
} else {
  console.warn('  ⚠  EMAIL_USER / EMAIL_PASS not set — emails disabled, leads saved to file only');
}

// ── Leads storage (JSON file, writes serialized to avoid races) ─
let writeQueue = Promise.resolve();
function saveLead(lead) {
  writeQueue = writeQueue.then(async () => {
    let leads = [];
    try { leads = JSON.parse(await fs.readFile(LEADS_FILE, 'utf8')); } catch { /* first lead or unreadable file */ }
    leads.push(lead);
    const tmp = `${LEADS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(leads, null, 2));
    await fs.rename(tmp, LEADS_FILE); // atomic replace
  });
  return writeQueue;
}

// ── Rate limiter — 8 submissions / IP / 15 min ───────────────
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again in 15 minutes.' }
});

// ── POST /api/contact ─────────────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  const body = req.body || {};

  // Honeypot: real users never fill the hidden "website" field.
  if (body.website) return res.json({ success: true, message: "Thank you! We'll respond within 24 hours.", ref: 'SYN-0' });

  const f = Object.fromEntries(Object.entries(LIMITS).map(([k, max]) => [k, clean(body[k], max)]));

  if (!f.name || !f.email || !f.interest || !f.message) {
    return res.status(400).json({ success: false, error: 'Name, email, interest and message are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  const lead = {
    id: `SYN-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    name: oneLine(f.name),
    email: f.email.toLowerCase(),
    company: oneLine(f.company) || '—',
    interest: oneLine(f.interest),
    budget: oneLine(f.budget) || '—',
    timeline: oneLine(f.timeline) || '—',
    message: f.message
  };

  try { await saveLead(lead); } catch (e) { console.error('Lead file write error:', e.message); }

  if (transporter) {
    const rows = { Name: lead.name, Email: lead.email, Company: lead.company, Interest: lead.interest, Budget: lead.budget, Timeline: lead.timeline };
    const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;background:#06060E;color:#EEEEF8;padding:32px;border-radius:12px;">
      <h2 style="color:#9D5CFF;margin-bottom:4px;">New Synthique Lead</h2>
      <p style="color:#8886A8;margin-top:0;">Ref: ${lead.id}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        ${Object.entries(rows).map(([k, v]) => `
          <tr style="border-bottom:1px solid #18183A;">
            <td style="padding:10px 0;color:#8886A8;width:120px;">${k}</td>
            <td style="padding:10px 0;font-weight:600;">${escapeHtml(v)}</td>
          </tr>`).join('')}
      </table>
      <div style="margin-top:20px;padding:16px;background:#0F0F1E;border-radius:8px;border-left:3px solid #7C3AED;">
        <p style="color:#8886A8;margin:0 0 6px;">Message</p>
        <p style="margin:0;">${escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>
      </div>
    </div>`;

    try {
      await transporter.sendMail({
        from: `"Synthique Website" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_TO || process.env.EMAIL_USER,
        replyTo: lead.email,
        subject: `[Synthique] New inquiry: ${lead.interest} — ${lead.name}`,
        text: Object.entries(rows).map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${lead.message}`,
        html
      });
    } catch (e) {
      console.warn(`⚠  Email not sent for ${lead.id}: ${e.message}`);
    }
  }

  console.log(`✓ Lead ${lead.id} | ${lead.interest}`);
  res.json({ success: true, message: "Thank you! We'll respond within 24 hours.", ref: lead.id });
});

// ── GET /api/stats ─────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
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
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), mail: mailEnabled });
});

// Unknown API routes → JSON 404 (not the HTML page)
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// Malformed JSON / oversized body → clean JSON error
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ success: false, error: 'Invalid request body.' });
  }
  console.error(err);
  res.status(500).json({ success: false, error: 'Server error.' });
});

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  🚀 Synthique running → http://localhost:${PORT}\n`));
}
module.exports = app;
