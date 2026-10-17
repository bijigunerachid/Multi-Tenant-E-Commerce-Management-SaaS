# Vendora

A multi-tenant e-commerce management SaaS: independent businesses manage their stores,
products, inventory, orders, employees, customers and analytics on one shared platform,
with strict tenant isolation and role-based access.

> **Status:** Phase 5 steps done (CSV exports as background jobs deferred); Phase 6 (billing
> and production) is next. Accounts, organizations, team invitations, roles, tenant
> isolation, the product catalog, inventory, customers and orders (draft to delivery, with stock
> reservations) work end to end. The dashboard shows revenue, orders and stock alerts, and
> sales, product and store reports export as CSV. Emails go through a queue with retries and a
> delivery log. Members are notified of new orders and low stock in the app, and by email if
> they choose. See
> [docs/roadmap.md](docs/roadmap.md).

## Design documents

- [Architecture](docs/architecture.md): system shape, key decisions, request pipeline, roles and permissions, order state machine, trust boundaries
- [Data model](docs/data-model.md): entities, relationships, constraints and invariants
- [Security](docs/security.md): risk register and controls
- [Roadmap](docs/roadmap.md): phases and acceptance criteria

## Stack

| Layer    | Technology                                                                           |
| -------- | ------------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, Axios, Heroicons |
| Backend  | Node.js 22, Express 5, Prisma 6, Zod 4, BullMQ 6, pino                               |
| Data     | PostgreSQL 17, Redis 7.4                                                             |
| Tests    | Jest 30 + Supertest (API), Vitest 4 + React Testing Library (UI), Playwright (E2E)   |
| Tooling  | npm workspaces, ESLint 9, Prettier, Docker Compose, GitHub Actions                   |

Versions are pinned exactly. Some packages are deliberately one major version behind the
newest release (for example Prisma 6, ioredis 5, ESLint 9). Each one is either a
compatibility requirement (BullMQ needs ioredis 5) or a major version whose API is
established, chosen over a very recent one.

## Running locally

Requirements: Node.js 22.9 or newer, Docker Desktop.

```powershell
# 1. Configuration. Choose your own passwords, and use the same ones in both files.
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env

# 2. PostgreSQL, Redis and Mailpit (all bound to 127.0.0.1)
docker compose up -d --wait

# 3. Dependencies and database
npm ci
npm run db:deploy -w backend        # applies migrations to the dev database

# 4. API on http://localhost:4100, the worker (emails, notifications), and the web app on http://localhost:5173
npm run dev
```

| Service                           | Address                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Web app                           | http://localhost:5173                                                                  |
| API                               | http://localhost:4100/api/v1 (the web app reaches it through the Vite proxy at `/api`) |
| Mailpit (development email inbox) | http://localhost:8025                                                                  |
| PostgreSQL                        | localhost:5434                                                                         |
| Redis                             | localhost:6380                                                                         |

## Checks

```powershell
npm run lint            # ESLint across both workspaces
npm run format:check    # Prettier
npm test                # backend (needs Docker services running) then frontend
npm run build           # production build of the web app

npx playwright install chromium   # once, before the first E2E run
npm run test:e2e        # starts its own API (4101) and web app (5174), uses Mailpit
```

Tests never touch development data: backend tests use the `vendora_test` database and
Redis database 1; E2E tests use `vendora_e2e` and Redis database 2. Both databases are
created the first time the Postgres container starts. On an existing volume, create the E2E
database once:

```powershell
docker compose exec postgres psql -U vendora -d vendora -c "CREATE DATABASE vendora_e2e"
```

## Trying it out

1. Open http://localhost:5173 and create an account.
2. Open Mailpit at http://localhost:8025 and click the confirmation link.
3. Create your organization, then invite an employee from **Employees**. The invitation
   email also arrives in Mailpit; open its link in a private window to join as that person.
