# Deploying Vendora

Vendora runs on one Linux server with Docker: a web server (Caddy) in front, the API, a
background worker, PostgreSQL and Redis. Everything is in `docker-compose.prod.yml`. This guide
takes a fresh server to a running site; the whole setup has been tested end to end on a local
machine (see [Testing the production setup locally](#testing-the-production-setup-locally)).

```
Internet ──443/80──► web (Caddy: HTTPS, security headers, the web app)
                       │ /api/*
                       ▼
                     api (Node) ──► postgres (data)     worker (emails, notifications,
                                └─► redis (sessions,     trial expiry) ──► postgres, redis,
                                     queues, limits)                        SMTP provider
```

Only ports 80 and 443 are open. The API, worker, database and Redis are on a private network.

## What you need

- A Linux server with Docker Engine 24+ and the Compose plugin: 2 vCPU and 4 GB RAM is plenty to
  start. Any provider works (Hetzner, DigitalOcean, OVH, AWS Lightsail...).
- A domain name, with an `A` (and `AAAA`) record pointing at the server, for example
  `app.example.com`.
- An SMTP account for transactional email (Postmark, Amazon SES, Mailgun, Brevo...), with the
  sending domain verified (SPF and DKIM), so emails are not marked as spam.
- Optional, to sell plans: a Stripe account activated for live payments.

## First deployment

1. **Get the code** on the server:

   ```bash
   git clone https://github.com/<you>/Multi-Tenant-E-Commerce-Management-SaaS.git vendora
   cd vendora
   ```

2. **Settings.** Copy the example and fill in every value:

   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   openssl rand -base64 32 | tr -d '/+='   # run twice: database and Redis passwords
   openssl rand -base64 32                 # MFA_ENCRYPTION_KEY, kept as printed
   ```

   `MFA_ENCRYPTION_KEY` encrypts two-factor secrets. Keep a copy with the backups, apart from
   the database dumps: without it, restored accounts cannot pass two-factor sign-in and need a
   reset. Changing it has the same effect.

   `SITE_ADDRESS` is the domain, `APP_URL` and `CORS_ORIGINS` are `https://` + the domain. The API
   refuses to start with unsafe settings and says which ones: http instead of https, an origin
   that does not match, email left on the test inbox, a live Stripe key outside production, a
   missing `MFA_ENCRYPTION_KEY`.

3. **Start:**

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```

   The images build on the server (about 5 minutes the first time). Then migrations run once
   (`migrate` exits with 0), the API and worker start, and Caddy obtains the HTTPS certificate.

4. **Check it:**

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production ps
   # from any machine with the repository and Node installed:
   SMOKE_URL=https://app.example.com npm run smoke
   ```

   `npm run smoke` is read-only: it checks readiness, security headers, public plans and that
   the main pages render without browser errors.

5. **The first platform administrator** (optional, for `/admin`): register on the site, confirm
   the email, then on the server:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production \
     exec api npm run admin -- grant you@example.com
   ```

   Then sign in, turn on two-factor sign-in under Your profile, and keep the recovery codes:
   the admin area requires it. If an admin loses both their phone and their codes, reset it
   from the server with `npm run admin -- reset-mfa <email>` the same way.

## Payments (Stripe, live)

1. In Stripe, create a **restricted key** with: Customers write, Checkout Sessions write,
   Customer portal write, Subscriptions read, Invoices read, Products write, Prices write.
2. Create the products, prices and customer portal configuration in the live account:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production \
     run --rm -e STRIPE_SECRET_KEY=rk_live_... api npm run stripe:setup
   ```

3. In the Stripe Dashboard, add a webhook endpoint `https://<domain>/api/v1/subscriptions/webhooks/stripe`
   for the events listed in `backend/package.json` (`stripe:listen`), and copy its signing
   secret.
4. In `.env.production`: `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
   Restart: `docker compose ... up -d`.
5. Go through Stripe's go-live checklist (business details, tax settings, statement descriptor).

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run before the new API and worker start. If one fails, `migrate` exits with an
error, the new API and worker are not started, and `docker compose logs migrate` says why. Take
a backup before updating (see below), so a failed upgrade can always be undone. To pin a version, check out its tag and set
`VENDORA_VERSION` so the images are labelled with it.

## Backups

The database holds everything except uploaded product images (the `uploads` volume).

```bash
# Database: a compressed dump (run daily from cron, keep 14 days, copy off the server).
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U vendora -d vendora --format=custom > backup-$(date +%F).dump

# Uploaded images.
docker run --rm -v vendora-prod_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

**Restore** (to an empty database, for example on a new server):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_restore -U vendora -d vendora --clean --if-exists < backup-YYYY-MM-DD.dump
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Test a restore at least once before relying on the backups. Redis holds sessions, queues and
rate limits only: losing it signs everyone out and nothing else (queued emails are recorded in
the database, and notifications are delivered from the database).

## Monitoring

- **Uptime:** point an uptime checker (UptimeRobot, Better Stack...) at
  `https://<domain>/api/v1/health/ready`. It answers 503 when the database or Redis is down.
- **Containers:** each service has a health check (the API's liveness, the worker's heartbeat
  file, PostgreSQL, Redis) and restarts when it fails.
- **Logs:** every service logs JSON lines to Docker (rotated: 5 × 10 MB per service). API lines
  carry the request id that is also returned in `X-Request-Id`, so a user's error report leads
  to the exact log line. `docker compose ... logs -f api worker`, or ship them to a log service.
- **Email and payments:** owners see failed emails in Settings → Email log; platform admins see
  failed Stripe events on `/admin`. Stripe also shows webhook delivery failures.

## Security checklist

- `.env.production` is readable by its owner only (`chmod 600`) and never committed.
- Only ports 22, 80 and 443 are open; SSH uses keys, not passwords.
- The OS gets security updates (`unattended-upgrades` on Debian and Ubuntu).
- Rebuild the images regularly (`up -d --build --pull always`) for base image fixes;
  CI runs `npm audit` and a secret scan on every push.
- The Stripe key is a restricted key, and the webhook secret matches the live endpoint.
- Every platform admin has two-factor sign-in on (required), and `MFA_ENCRYPTION_KEY` is
  backed up apart from the database.

## Testing the production setup locally

The same stack runs on a developer machine with a local certificate for `localhost`:

```bash
cp .env.production.example .env.production
# SITE_ADDRESS=localhost, APP_URL and CORS_ORIGINS=https://localhost:8443,
# HTTP_PORT=8080, HTTPS_PORT=8443, SMTP_URL=smtp://host.docker.internal:1025 (Mailpit)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
SMOKE_URL=https://localhost:8443 SMOKE_INSECURE=1 npm run smoke
docker compose -f docker-compose.prod.yml --env-file .env.production down -v   # remove it all
```

CI does exactly this on every push (job `production-stack`).
