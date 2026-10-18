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

| Decision                | Choice                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy model           | Shared database, shared schema, `organizationId` column on every tenant-owned table                                                                                                                                                                         | One deployment, simple migrations, and it scales to thousands of small tenants. Isolation is enforced in code and by database constraints (below).                                                                                                                                                                                              |
| Browser auth            | Server-side sessions in Redis. The cookie holds an opaque random ID (`HttpOnly`, `Secure` in prod, `SameSite=Lax`)                                                                                                                                          | Instant revocation (logout, "log out everywhere", deactivated member, suspended org). No token is readable by JavaScript. A JWT would need a denylist to get the same revocation, which makes it a session store anyway.                                                                                                                        |
| CSRF                    | Synchronizer token per session, returned by `GET /auth/csrf`, required in `X-CSRF-Token` on every unsafe method. The API also checks `Origin` against an allowlist                                                                                          | Cookie auth needs CSRF protection. `SameSite=Lax` alone is not enough (subdomains, older browsers). Implemented as small first-party middleware because `csurf` is deprecated.                                                                                                                                                                  |
| Password hashing        | Argon2id (`argon2` package, OWASP parameters: 19 MiB memory, 2 iterations, parallelism 1)                                                                                                                                                                   | Current OWASP recommendation.                                                                                                                                                                                                                                                                                                                   |
| Active tenant           | Stored in the session (`activeOrganizationId`). Switching goes through `POST /organizations/:id/switch`, which checks membership                                                                                                                            | The browser never names the tenant on a normal request, so there is no tenant ID to tamper with. Membership, role and organization status are reloaded on every request (one indexed query; a short Redis cache can be added if measurements call for it), so removing a member or suspending an organization takes effect on the next request. |
| Data access             | `req.db = tenantDb(prisma, organizationId)`: a Prisma client extension that adds `organizationId` to every `where` and every `create` on tenant models, and throws if a query names another organization. Tenant handlers use `req.db`                      | Isolation lives in one place. Routes are declared as data with a required access rule, and the isolation suite fails if a new route parameter has no cross-tenant test fixture.                                                                                                                                                                 |
| Cross-tenant references | Composite foreign keys `(organizationId, xId) → (organizationId, id)` on child tables                                                                                                                                                                       | The database itself refuses an order item that points at another tenant's variant, even if the application has a bug.                                                                                                                                                                                                                           |
| Row-Level Security      | Evaluated in Phase 6 for `orders`, `customers` and `inventory_levels`, using `set_config('app.organization_id', …, true)` inside a transaction                                                                                                              | Defense in depth. It is deferred because it changes how every query runs; the layers above are the primary control.                                                                                                                                                                                                                             |
| Money                   | `Decimal(12,2)` columns, handled with Prisma's `Decimal` (decimal.js) in services, sent as strings in JSON. Every monetary record stores a 3-letter ISO currency code                                                                                       | No floating-point errors.                                                                                                                                                                                                                                                                                                                       |
| Inventory concurrency   | A conditional atomic `UPDATE … SET reserved = reserved + $q WHERE id = $id AND on_hand - reserved >= $q RETURNING …` inside a transaction, plus `CHECK` constraints                                                                                         | No read-then-write race. The database refuses negative stock even if a code path forgets the check.                                                                                                                                                                                                                                             |
| Background jobs         | BullMQ on Redis for email, with retries and exponential backoff. Each email has an `EmailDelivery` row (status, attempts, last error); finished jobs are removed so one-time links are not kept. Notifications use a PostgreSQL outbox polled by the worker |                                                                                                                                                                                                                                                                                                                                                 |
| Validation              | Zod schemas, shared in spirit (not as code) between the frontend (React Hook Form) and the backend (request middleware)                                                                                                                                     | The backend is the authority. Frontend validation only improves UX.                                                                                                                                                                                                                                                                             |
| Logging                 | `pino` + `pino-http`, JSON logs, a request ID on every log line and in the `X-Request-Id` response header. Passwords, cookies and tokens are redacted                                                                                                       |                                                                                                                                                                                                                                                                                                                                                 |
| API docs                | OpenAPI 3.1 spec served at `/api/docs` (Swagger UI, disabled in production unless enabled explicitly)                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                 |
| Repo layout             | npm workspaces monorepo (`frontend`, `backend`)                                                                                                                                                                                                             | One lockfile and one CI pipeline. npm 11 is already installed, so there is no extra tool to set up.                                                                                                                                                                                                                                             |

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

## 8. Background jobs

Emails are not sent during the request. `emails.enqueue()` (in `jobs/emailQueue.js`)
writes an `EmailDelivery` row and adds a BullMQ job; a worker (`jobs/emailWorker.js`) sends
it and records the result.

```
request ──► EmailDelivery (QUEUED) + job ──► worker ──► SMTP
                                               │ ok          → SENT, sent_at
                                               │ temporary   → still QUEUED, attempts + 1,
                                               │               last_error, retried later
                                               │ 5xx / bad address, or 5th attempt
                                               └─────────────→ FAILED, failed_at
```

- **Retries.** 5 attempts with exponential backoff (30 s, 1 min, 2 min, 4 min by default,
  `EMAIL_RETRY_DELAY_MS`). SMTP 5xx replies and rejected addresses are permanent and are not
  retried.
- **No secrets at rest.** Verification, reset and invitation emails contain one-time links,
  and those tokens are stored only as hashes. So the message body is never written to the
  database: it lives only in the job, and jobs are removed as soon as they are sent or have
  failed for good.
- **At least once.** The worker skips a delivery that is no longer `QUEUED`. A crash between
  sending and recording can still send an email twice; it can never silently drop one.
- **Requests never fail because of email.** If the job cannot be queued (Redis down), the
  delivery is recorded as `FAILED` with the reason and the request still succeeds, as before.
  The producer connection does not queue commands offline, so requests do not hang.
- **Where the worker runs.** In production, as its own process: `npm run worker -w backend`,
  with the same environment as the API. `npm run dev` starts it next to the API. With
  `JOB_WORKER=in-process` the API runs it itself (the end-to-end tests do this). The same
  worker delivers notifications (section 9).
- **History.** Owners see their organization's deliveries (invitations, ownership transfers,
  notification emails)
  under Settings → Email log (`GET /email-deliveries`, `audit:read`). Account emails
  (verification, password reset) belong to no organization and are not listed there.
- **Constraints.** The database requires `sent_at` exactly for `SENT`, `failed_at` exactly
  for `FAILED`, and `attempts >= 0`.

## 9. Notifications

Two events notify people, in the app and optionally by email:

| Type                  | When                                                                      | Who receives it (active members, active users)    |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `order.placed`        | An order is placed (DRAFT → PENDING)                                      | `order:transition` roles, except who placed it    |
| `inventory.low_stock` | A level's status gets worse: in stock → low (available ≤ threshold) → out | `inventory:adjust` roles, including who caused it |

```
business transaction ──► NotificationEvent (outbox row, same transaction)
worker, every NOTIFICATION_POLL_MS ──► claim one event (FOR UPDATE SKIP LOCKED)
   ──► Notification per recipient (unique per event and member) ──► mark processed ──► commit
   ──► email copies queued for members who turned them on (section 8)
```

- **Outbox.** The event is written in the transaction that makes the change, so a rolled-back
  change (an order refused for lack of stock on its third line) notifies nobody, and a
  committed one is never lost. It is delivered after the commit by the worker.
- **Crossings, not levels.** Low stock fires when the status gets worse, so a level that stays
  low does not alert on every sale; it alerts again only after going back above the threshold.
  Reservations count (they lower available stock); shipping does not alert twice, since it
  leaves available stock unchanged. Changing a threshold does not alert. An archived product
  never alerts.
- **Polling, not a Redis scheduler.** The worker polls PostgreSQL every 5 s by default. A BullMQ
  job scheduler was tried first; it lives in Redis, and emptying Redis (as the E2E setup does,
  or a restart without persistence) stopped delivery silently. In-app notifications now do not
  depend on Redis at all.
- **Several workers.** Each event is claimed and delivered in its own transaction with
  `FOR UPDATE SKIP LOCKED`, and `(event_id, membership_id)` is unique, so parallel workers
  never deliver twice. An event that fails is retried on later polls, up to 5 times, without
  holding up the others; its last error is kept on the row.
- **Visibility follows the current role.** A member sees, counts and marks read only the types
  their current role receives, so someone moved from manager to analyst stops seeing order
  notifications. Notifications belong to a membership; another member's are 404.
- **Email copies.** Off by default, chosen per type on the notifications page
  (`PUT /notifications/preferences`), sent only to verified addresses, and listed in the
  Email log. They carry no customer data. A crash between delivering an event and queueing
  its emails loses the email copy, never the in-app notification.
- **Snapshot.** Each notification stores the text data (order number, total, SKU, store)
  when delivered, so renaming a product later does not rewrite old notifications.
- **Retention.** Notifications are deleted after 90 days and delivered events after 7 days
  (daily, by the worker). Pending events are kept whatever their age.
- **API.** `GET /notifications` (with `?unread=true`), `GET /notifications/unread-count`,
  `POST /notifications/:id/read`, `POST /notifications/read-all`,
  `GET|PUT /notifications/preferences`. All need `org:read` (every member) and act only on
  the caller's own notifications. The bell checks the unread count every 30 s.

## 10. Plans, trial and limits

Every organization has one `Subscription` on a `SubscriptionPlan`. Plans are reference data
created by a migration, so every environment has the same ones:

| Plan    | Price (USD/month) | Active stores | Members | Products | CSV exports |
| ------- | ----------------: | ------------: | ------: | -------: | :---------: |
| Starter |             29.00 |             1 |       3 |      100 |             |
| Growth  |             79.00 |             3 |      10 |    1,000 |      ✓      |
| Scale   |            199.00 |            10 |      50 |   10,000 |      ✓      |

- **Trial.** Onboarding starts a 14-day trial of Growth in the same transaction that creates
  the organization. Organizations that existed before plans got the same trial, starting on
  the day of the migration.
- **States.** `TRIALING` and `ACTIVE` work normally. `PAST_DUE` (a failed payment, once billing
  is connected) keeps working while the provider retries. `CANCELED` and `EXPIRED` make the
  organization read-only.
- **Expiry needs no job.** A trial past its end date is treated as `EXPIRED` on the next
  request (`effectiveStatus`). The worker also writes `EXPIRED` every hour and audits it
  (`subscription.trial_expired`), so the stored state and the audit log agree.
- **Read-only mode.** The route builder refuses every non-GET tenant route with
  `402 SUBSCRIPTION_INACTIVE`, unless the route declares `whenInactive: 'allow'`. Allowed:
  routes that reduce usage or concern access (deactivate a member, revoke an invitation,
  archive a store, ownership transfer, organization settings, notification read state).
  Reads and exports keep working, so an organization can always get its data out. Joining
  through an invitation is refused too. A generated test checks every route.
- **Usage limits.** Active stores, members (active members plus pending invitations, so
  accepting one never goes over) and non-archived products. Each check runs in the
  transaction that adds the row, after a transaction-level advisory lock per organization and
  resource, so concurrent requests cannot both take the last slot (tested with 6 at once).
  Restoring an archived store or product counts as adding one. Going over gives
  `402 PLAN_LIMIT_REACHED` with the limit, the current count and the plan.
- **Features.** A route declares `feature: 'csvExport'`, and plans without it get
  `402 PLAN_FEATURE_UNAVAILABLE`. A generated test checks every export route on Starter and
  Growth.
- **Who sees what.** The session tells every member the status (for the read-only banner).
  The plan, usage and plan list are on the Billing page (`GET /subscriptions/current`,
  `GET /subscriptions/plans`, `billing:read`, owners only).
- **Not yet.** Changing plan and paying come with the payment provider (next step). Until
  then the subscription changes only through the trial expiry.

## 11. Trust boundaries

1. **Browser → API.** Nothing from the browser is trusted: body, params, query and headers
   are all validated. The tenant comes from the session, never from the request.
2. **API → database.** Tenant scope is applied by `tenantDb`, and composite foreign keys
   and `CHECK` constraints back it up.
3. **Queue → worker.** A job payload is data, not authority. An email job carries only
   the delivery id and the rendered message; the worker re-reads the delivery row and sends
   nothing for a delivery that is no longer queued. The notification worker takes nothing
   from Redis: it reads outbox rows that tenant-scoped code wrote in PostgreSQL, and every
   query it makes filters on that row's `organization_id` (it uses the unscoped client, so
   the filter is written out in each query, as in raw SQL).
4. **Stripe → webhook.** The signature is verified against the raw body, the event ID is
   stored with a unique constraint (idempotency), and subscription state changes only from
   verified events, never from a browser redirect.
5. **Uploads.** The type is checked by magic bytes (not the extension or the client's MIME
   type), the size is capped, the file is stored under a random key outside the web root,
   and it is served with `Content-Type` set and `X-Content-Type-Options: nosniff`.
