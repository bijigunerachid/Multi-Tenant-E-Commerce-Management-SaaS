# Architecture

Vendora is a multi-tenant SaaS. One deployment serves many organizations (tenants).
Each organization manages its own stores, catalog, inventory, customers and orders.

## 1. Shape of the system

```
 Browser (React SPA, Vite build)
   │  HTTPS, same-site. Session cookie (HttpOnly) + CSRF header on writes
   ▼
 API (Node.js + Express, /api/v1)            Worker (Node.js + BullMQ)
   │  request id → auth → tenant context      │  emails, low-stock scans,
   │  → permission check → validation         │  webhook processing, exports
   │  → service → tenant-scoped repository    │  (every job carries organizationId
   │                                          │   and re-checks it)
   ├──────────────► PostgreSQL ◄──────────────┤
   └──────────────► Redis ◄───────────────────┘
                    (sessions, rate limits, cache, BullMQ queues)

 Stripe (test mode) ──webhook──► API /api/v1/subscriptions/webhooks/stripe
 Mailpit (dev) / SMTP provider (prod) ◄── Worker
```

It is a **modular monolith**, not microservices. The API and the worker share one
codebase (`backend/`) and start from different entry points (`src/server.js` and
`src/worker.js`). Modules talk to each other through service functions, not over HTTP.

## 2. Key decisions

| Decision                | Choice                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy model           | Shared database, shared schema, `organizationId` column on every tenant-owned table                                                                                                                                                    | One deployment, simple migrations, and it scales to thousands of small tenants. Isolation is enforced in code and by database constraints (below).                                                                                                                                                                                              |
| Browser auth            | Server-side sessions in Redis. The cookie holds an opaque random ID (`HttpOnly`, `Secure` in prod, `SameSite=Lax`)                                                                                                                     | Instant revocation (logout, "log out everywhere", deactivated member, suspended org). No token is readable by JavaScript. A JWT would need a denylist to get the same revocation, which makes it a session store anyway.                                                                                                                        |
| CSRF                    | Synchronizer token per session, returned by `GET /auth/csrf`, required in `X-CSRF-Token` on every unsafe method. The API also checks `Origin` against an allowlist                                                                     | Cookie auth needs CSRF protection. `SameSite=Lax` alone is not enough (subdomains, older browsers). Implemented as small first-party middleware because `csurf` is deprecated.                                                                                                                                                                  |
| Password hashing        | Argon2id (`argon2` package, OWASP parameters: 19 MiB memory, 2 iterations, parallelism 1)                                                                                                                                              | Current OWASP recommendation.                                                                                                                                                                                                                                                                                                                   |
| Active tenant           | Stored in the session (`activeOrganizationId`). Switching goes through `POST /organizations/:id/switch`, which checks membership                                                                                                       | The browser never names the tenant on a normal request, so there is no tenant ID to tamper with. Membership, role and organization status are reloaded on every request (one indexed query; a short Redis cache can be added if measurements call for it), so removing a member or suspending an organization takes effect on the next request. |
| Data access             | `req.db = tenantDb(prisma, organizationId)`: a Prisma client extension that adds `organizationId` to every `where` and every `create` on tenant models, and throws if a query names another organization. Tenant handlers use `req.db` | Isolation lives in one place. Routes are declared as data with a required access rule, and the isolation suite fails if a new route parameter has no cross-tenant test fixture.                                                                                                                                                                 |
| Cross-tenant references | Composite foreign keys `(organizationId, xId) → (organizationId, id)` on child tables                                                                                                                                                  | The database itself refuses an order item that points at another tenant's variant, even if the application has a bug.                                                                                                                                                                                                                           |
| Row-Level Security      | Evaluated in Phase 6 for `orders`, `customers` and `inventory_levels`, using `set_config('app.organization_id', …, true)` inside a transaction                                                                                         | Defense in depth. It is deferred because it changes how every query runs; the layers above are the primary control.                                                                                                                                                                                                                             |
| Money                   | `Decimal(12,2)` columns, handled with Prisma's `Decimal` (decimal.js) in services, sent as strings in JSON. Every monetary record stores a 3-letter ISO currency code                                                                  | No floating-point errors.                                                                                                                                                                                                                                                                                                                       |
| Inventory concurrency   | A conditional atomic `UPDATE … SET reserved = reserved + $q WHERE id = $id AND on_hand - reserved >= $q RETURNING …` inside a transaction, plus `CHECK` constraints                                                                    | No read-then-write race. The database refuses negative stock even if a code path forgets the check.                                                                                                                                                                                                                                             |
| Background jobs         | BullMQ on Redis, with retries and exponential backoff. Failed jobs are kept and shown in notification history                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                 |
| Validation              | Zod schemas, shared in spirit (not as code) between the frontend (React Hook Form) and the backend (request middleware)                                                                                                                | The backend is the authority. Frontend validation only improves UX.                                                                                                                                                                                                                                                                             |
| Logging                 | `pino` + `pino-http`, JSON logs, a request ID on every log line and in the `X-Request-Id` response header. Passwords, cookies and tokens are redacted                                                                                  |                                                                                                                                                                                                                                                                                                                                                 |
| API docs                | OpenAPI 3.1 spec served at `/api/docs` (Swagger UI, disabled in production unless enabled explicitly)                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                 |
| Repo layout             | npm workspaces monorepo (`frontend`, `backend`)                                                                                                                                                                                        | One lockfile and one CI pipeline. npm 11 is already installed, so there is no extra tool to set up.                                                                                                                                                                                                                                             |

## 3. Request pipeline (backend)

```
requestId → pino-http → helmet → cors(allowlist) → body limit (100 kB JSON)
→ cookie parser → session loader (Redis) → csrf (unsafe methods)
→ rate limit (Redis store; stricter on /auth)
→ router
     → requireAuth
     → requireTenant        // loads membership for session.activeOrganizationId,
                            // rejects if membership inactive or org suspended,
                            // builds req.ctx = { userId, organizationId, role, permissions }
     → authorize('product:write')
     → validate({ params, query, body })
     → controller → service(ctx, input) → tenantDb(ctx)
→ errorHandler              // maps AppError → { error: { code, message, details, requestId } }
```

Platform admin routes (`/admin`) use `requirePlatformRole('SUPER_ADMIN')` and never go
through `tenantDb`. Every admin action is written to the audit log.

## 4. Roles and permissions

Roles are attached to a **membership** (user × organization), so the same user can be an
owner in one organization and an analyst in another. `SUPER_ADMIN` is a separate,
platform-level flag on `User`. It cannot be obtained through registration and is granted
only by a CLI script that runs on the server.

| Permission                                          | Owner | Manager |       Inventory        |       Orders       | Analyst |
| --------------------------------------------------- | :---: | :-----: | :--------------------: | :----------------: | :-----: |
| `org:read`                                          |   ✓   |    ✓    |           ✓            |         ✓          |    ✓    |
| `org:update` (settings, stores)                     |   ✓   |         |                        |                    |         |
| `org:transfer_ownership`                            |   ✓   |         |                        |                    |         |
| `member:read`                                       |   ✓   |    ✓    |                        |                    |         |
| `member:manage` (invite, role, deactivate)          |   ✓   |         |                        |                    |         |
| `product:read`                                      |   ✓   |    ✓    |           ✓            |         ✓          |    ✓    |
| `product:write` (incl. categories, images)          |   ✓   |    ✓    |                        |                    |         |
| `inventory:read`                                    |   ✓   |    ✓    |           ✓            |         ✓          |    ✓    |
| `inventory:adjust`                                  |   ✓   |    ✓    |           ✓            |                    |         |
| `customer:read`                                     |   ✓   |    ✓    |                        |         ✓          |         |
| `customer:write`                                    |   ✓   |    ✓    |                        |         ✓          |         |
| `customer:export`                                   |   ✓   |    ✓    |                        |                    |         |
| `order:read`                                        |   ✓   |    ✓    |                        |         ✓          |         |
| `order:write` (create, edit draft)                  |   ✓   |    ✓    |                        |         ✓          |         |
| `order:transition` (confirm, fulfil, ship, deliver) |   ✓   |    ✓    |                        |         ✓          |         |
| `order:cancel`                                      |   ✓   |    ✓    |                        |         ✓          |         |
| `report:read`                                       |   ✓   |    ✓    | inventory reports only | order reports only |    ✓    |
| `report:export`                                     |   ✓   |    ✓    |                        |                    |    ✓    |
| `billing:read`                                      |   ✓   |         |                        |                    |         |
| `billing:manage`                                    |   ✓   |         |                        |                    |         |
| `audit:read`                                        |   ✓   |         |                        |                    |         |

Role rules enforced in the backend:

- Only an owner can grant or revoke `OWNER`. There must always be at least one active
  owner, and the API refuses any change that would leave zero.
- Ownership transfer is an explicit two-step flow: the current owner initiates it with
  password re-confirmation, the target accepts, and then the old owner becomes a `MANAGER`.
- Nobody can change their own role.

Analysts get aggregated customer figures in reports but not customer contact details.

## 5. Order state machine

```
 DRAFT ──place──► PENDING ──confirm──► CONFIRMED ──start──► PROCESSING ──ship──► SHIPPED ──deliver──► DELIVERED
   │                 │                    │                     │
   └──discard        └──────cancel────────┴────────cancel───────┘──► CANCELLED
```

| Transition                                          | Stock effect                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `place` (DRAFT → PENDING)                           | Reserve every line (`reserved += qty`). Fails with 409 if any line lacks available stock.   |
| `cancel` (PENDING/CONFIRMED/PROCESSING → CANCELLED) | Release the active reservations (`reserved -= qty`).                                        |
| `ship` (PROCESSING → SHIPPED)                       | Consume the reservations (`on_hand -= qty`, `reserved -= qty`).                             |
| SHIPPED / DELIVERED                                 | No cancellation. Returns and refunds are out of scope for v1 and documented as a follow-up. |

Each transition runs in one database transaction and writes `OrderStatusHistory` and
`InventoryMovement` rows. The allowed transitions are a table in
`modules/orders/orderStateMachine.js`, with unit tests for every pair of states.

## 6. Dashboard metrics

`GET /reports/dashboard` (`report:read`: owners, managers, analysts) returns the figures
below for a date range (`days`, or `from`/`to`, at most 366 days; default the last 30 days)
and the previous period of the same length. The definitions live next to the queries in
`modules/reports/dashboard.service.js`.

| Metric              | Definition                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Revenue             | Net sales (subtotal − discount) of `SHIPPED` and `DELIVERED` orders, by ship date. No tax or shipping. |
| Orders placed       | Orders placed in the period that are not cancelled.                                                    |
| Average order value | Revenue ÷ orders shipped in the period. Empty when nothing shipped.                                    |
| Open orders         | Orders in `PENDING`, `CONFIRMED` or `PROCESSING` now.                                                  |
| Revenue trend       | Revenue per day, or per week when the range is longer than 92 days.                                    |
| Top products        | The five products with the highest net line sales among shipped orders.                                |
| Inventory alerts    | Active variants whose stock available across active stores is at or below the threshold.               |

- **Days follow the organization's time zone**, and the calendar is computed in Postgres,
  including "today". Postgres and Node can ship different tz data: Postgres 17.11 moves
  Africa/Casablanca to UTC+0 from 2026-09-20 while Node's ICU 2024b keeps UTC+1, so mixing
  the two would put orders near midnight in the wrong day. Tests use Asia/Kolkata, which has
  a fixed offset.
- **One currency.** Figures are in the organization's default currency. Shipped orders in
  another currency are counted in `otherCurrencyOrders` and the UI says so.
- **Revenue needs a ship date.** The `orders_shipped_at_check` constraint requires
  `shipped_at` exactly when the status is `SHIPPED` or `DELIVERED`.
- **Cache.** Results are cached in Redis for 60 seconds. The key includes a data-version
  fingerprint (the latest `updated_at` of orders, inventory, products, variants and stores),
  so a user who ships an order sees it on their next load instead of waiting for the TTL.

## 7. Reports

`GET /reports/{sales,products,stores}` (`report:read`) and `GET /reports/{report}/export`
(`report:export`, CSV) take the same range as the dashboard and use the same definitions: a
sale is a shipped or delivered order, dated by its ship date in the organization's time
zone, in the default currency. The shared definitions live in `modules/reports/period.js`.

| Report   | One row per                    | Columns                                                                        |
| -------- | ------------------------------ | ------------------------------------------------------------------------------ |
| Sales    | day, week or month (`groupBy`) | orders shipped, units, gross sales, discounts, net sales, tax, shipping, total |
| Products | variant sold                   | units, orders, sales (line totals, before order discounts), share of sales     |
| Stores   | store, archived ones too       | orders shipped, net sales, average order value                                 |

- Every period of the range is listed, including empty ones. Weeks start on Monday, and the
  first and last periods are clipped to the range.
- The figures reconcile with each other: sales net = dashboard revenue = stores total, and
  products total = sales gross. Tests check this.
- `storeId` filters the sales and products reports. A store from another organization is a
  404, like any other foreign id.
- Reports are not cached, so an export always matches the data at the time it is made. The
  `(organization_id, shipped_at)` index keeps the range scans cheap.
- Exports are rate limited (60 per hour per organization) and audited as `report.exported`
  with the report, range, store and row count, never the figures. CSV cells are protected
  against formula injection, as for the customer export.
- There is no customer report: analysts may read reports but not customers, and a list of
  top customers would expose names and emails to them.

## 8. Trust boundaries

1. **Browser → API.** Nothing from the browser is trusted: body, params, query and headers
   are all validated. The tenant comes from the session, never from the request.
2. **API → database.** Tenant scope is applied by `tenantDb`, and composite foreign keys
   and `CHECK` constraints back it up.
3. **Queue → worker.** A job payload is data, not authority. Each job carries
   `organizationId` and the worker re-reads records through `tenantDb` for that organization.
4. **Stripe → webhook.** The signature is verified against the raw body, the event ID is
   stored with a unique constraint (idempotency), and subscription state changes only from
   verified events, never from a browser redirect.
5. **Uploads.** The type is checked by magic bytes (not the extension or the client's MIME
   type), the size is capped, the file is stored under a random key outside the web root,
   and it is served with `Content-Type` set and `X-Content-Type-Options: nosniff`.
