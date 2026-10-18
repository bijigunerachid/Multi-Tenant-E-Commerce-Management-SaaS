# Developing Vendora

How to keep building Vendora without breaking what already works. Start with
[README.md](README.md) to run it locally; the design documents in [docs/](docs) explain why
things are the way they are.

## Workflow

1. Update `main` and start a branch per piece of work:

   ```powershell
   git switch main
   git pull
   git switch -c feature/<short-name>     # or fix/<name>, docs/<name>
   ```

2. Make the change with its tests and docs (see the checklists below).
3. Run every check (next section). All of them must pass.
4. Commit, push, open a pull request. CI runs the same checks plus the production stack and a
   secret scan; merge only when it is green.
5. Add a short entry to [docs/roadmap.md](docs/roadmap.md): what changed and how it was verified.

## Checks before every pull request

```powershell
docker compose up -d --wait          # PostgreSQL, Redis, Mailpit
npm run lint
npm run format:check                 # npm run format fixes it
npm test                             # backend (Jest, real database) then frontend (Vitest)
npm run build
npm run openapi -w backend           # only if routes or their schemas changed; commit docs/openapi.json
npm run test:e2e                     # Playwright, full user journeys
npm audit --omit=dev --audit-level=high
```

Frontend tests can time out when the machine is busy; rerun the failing file alone before
investigating.

## Rules that are not optional

- **Tenant isolation.** Organization data is read and written through `req.db` (the
  `tenantDb` extension), never by passing an `organizationId` from the request. A new model
  that belongs to an organization gets an `organizationId` column, composite foreign keys, and
  an entry in `TENANT_MODELS` (`backend/src/utils/tenantDb.js`).
- **Authorization on the server.** Every route declares `access`. The frontend hides what a
  role cannot do, but that is only for convenience.
- **Validate input with Zod** in the route's `validate`; handlers read `req.valid`.
- **Audit sensitive changes** (`utils/audit.js`). Audit logs are append-only: never update or
  delete them.
- **No secrets in code** or in committed files. Settings go through `backend/src/config/env.js`
  (validated at start), with an example in `.env.example` / `.env.production.example`.
- **No fake data** in the app: empty states instead of placeholders. Demo data comes only from
  `npm run db:seed -w backend`.
- **Money** is stored in minor units (integers), never floats (`utils/money.js`).
- **Database changes are migrations** (`npm run db:migrate -w backend -- --name <name>`), never
  edits to an applied migration.
- **Versions are pinned exactly** in `package.json`.

## Checklist: a new API route

1. Add it to the module's `*.routes.js`: `method`, `path`, `access`
   (`'public'`, `'authenticated'`, `{ permission }` or `{ platform: 'SUPER_ADMIN' }`),
   `validate`, `status`, `summary`, and `feature` / `rateLimit` / `whenInactive` when needed.
   A new module is registered in `backend/src/app.js`.
2. A new permission goes into the matrix in `backend/src/modules/auth/permissions.js` and the
   table in [docs/architecture.md](docs/architecture.md).
3. Business logic goes in the module's `*.service.js`; throw errors from `utils/errors.js`, so
   the client gets a stable `code`.
4. Tests in `backend/tests/<module>.test.js`. These generated suites cover the new route on
   their own and fail until they can:
   - `authorization.test.js`: 401 for anonymous callers, 403 for each role without the
     permission;
   - `tenantIsolation.test.js`: a new `:param` needs a cross-tenant fixture there;
   - `openapi.test.js`: regenerate `docs/openapi.json`.

## Checklist: a new screen

1. API calls go in `frontend/src/services/<area>Service.js`; data is loaded with TanStack Query.
2. The page lives in `frontend/src/features/<area>/` and is routed (lazily) in
   `frontend/src/routes/router.jsx`.
3. Build it from `components/ui` (Button, Dialog, fields, layout, Pagination, Toast, Sku) and
   follow [docs/design.md](docs/design.md): design tokens only, sentence case, flat cards,
   labels on every field, loading, empty and error states.
4. Forms: react-hook-form with Zod, `useServerErrors` for API errors, and `useUnsavedChanges`
   for long forms.
5. Lists with a search box: copy an existing list page (for example `CustomersPage.jsx`). The
   debounced search must not update the URL while a navigation is pending.
6. Tests next to the page (`*.test.jsx`). If the feature is a user journey, add or extend a
   Playwright spec in `e2e/`; `e2e/responsive.spec.js` checks pages at phone width.

## Useful commands

| Command                                     | What it does                                             |
| ------------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                               | API, worker and web app with reload                      |
| `npm run db:studio -w backend`              | Browse the dev database                                  |
| `npm run db:seed -w backend`                | Demo shop (idempotent, refused in production)            |
| `npm run admin -w backend -- grant <email>` | Platform admin role (also `revoke`, `reset-mfa`, `list`) |
| `npm run stripe:listen -w backend`          | Forward Stripe test webhooks                             |
| `npm run smoke` (with `SMOKE_URL`)          | Read-only checks against a deployed site                 |

## Windows notes

- If `prisma generate` reports `EPERM`, a running Node process (often a hung test) holds the
  engine file. The client is usually generated anyway; stop the process and run it again.
- Run commands from the repository root unless a step says otherwise.
