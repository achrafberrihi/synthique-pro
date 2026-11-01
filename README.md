# Synthique, AI Data Engine website

Marketing site and lead-capture backend for **Synthique**, an AI training-data studio based in Casablanca (LLM evaluation, Arabic-dialect datasets, speech and driving-scene annotation).

- **Front end:** a single static page (`public/index.html`) in vanilla HTML/CSS/JS, light/dark theme, interactive demos.
- **Back end:** a small Express server (`server.js`) that serves the page and handles the contact form.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in your values
npm run dev            # http://localhost:3000
```

Without email credentials the server still runs: leads are saved to `leads.json` and email sending is skipped.

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/contact` | Contact form → saves the lead and emails a notification |
| `GET` | `/api/stats` | Headline figures shown on the site |
| `GET` | `/api/health` | Health check (`status`, `uptime`, whether mail is configured) |

`POST /api/contact` body (JSON): `name`, `email`, `interest`, `message` (required); `company`, `budget`, `timeline` (optional).

## Security and robustness

- User input is HTML-escaped before it goes into the notification email, and header fields are stripped of line breaks.
- Field length limits, 20 KB body limit, and clean JSON errors for malformed requests.
- Rate limit of 8 submissions per IP per 15 minutes; hidden honeypot field to drop bots.
- Basic security headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`); CORS closed unless `SITE_URL` is set.
- Leads file writes are serialized and atomic, so concurrent submissions can't corrupt it.
- Set `TRUST_PROXY=1` when deployed behind a proxy so rate limiting sees real client IPs.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `EMAIL_USER`, `EMAIL_PASS` | Gmail address and **App Password** used to send notifications |
| `EMAIL_TO` | Where lead notifications go |
| `PORT` | Server port (default 3000) |
| `SITE_URL` | Optional origin allowed to call `/api` cross-origin |
| `TRUST_PROXY` | `1` behind Render/Railway/Nginx |

> `leads.json` contains personal data and is git-ignored. On hosts with an ephemeral filesystem, rely on the email notifications or move storage to a database.
