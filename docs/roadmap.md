# Roadmap

Each phase ends with its acceptance criteria verified by running the checks. A phase is not
complete because its code exists.

## Phase 1: Discovery and planning ✅

- Workspace inspected: no existing Vendora code. `b2b-management-platform` and
  `ecommerce-analytics-platform` are separate projects and are left untouched.
- Local toolchain: Node 22.14, npm 11.21, git 2.47, Docker 27.5 with Compose v2.32.
- Port conflict found: 5432 is used by `ecommerce-postgres`. Vendora uses host ports
  **Postgres 5434, Redis 6380, Mailpit 1025/8025, API 4100, web 5173**.
- Design documents: `architecture.md`, `data-model.md`, `security.md`, this file.

**Acceptance:** the documents exist and are reviewed; the repo is initialized with
`.gitignore` and `.gitattributes`; there is no secret in the tree.

## Phase 2: Foundation ✅ (locally verified; CI runs on first push)

1. npm workspaces root; ESLint (flat config) and Prettier; `.editorconfig`.
2. `docker-compose.yml`: postgres 17, redis 7.4, mailpit, with health checks, named volumes
   and ports bound to 127.0.0.1. The test database is created by `docker/postgres/init`.
3. Backend skeleton: Express 5, Zod environment validation, pino logging with request IDs,
   helmet, CORS, error handler, `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready`
   (checks the database and Redis).
4. Prisma initialized; a first migration with `User` and `Organization` plus CHECK
   constraints (lower-case email, slug format, currency code, suspension consistency).
5. Jest + Supertest wired for ESM; 11 tests (env validation, health, error shape, body
   limits, security headers, CORS allowlist).
6. Frontend skeleton: Vite, React, Tailwind, React Router, TanStack Query, an Axios client
   with credentials; a system status page with loading, error and degraded states, a
   not-found page and a route error page; 4 Vitest + RTL tests. CSRF handling and the app
   shell (sidebar, org switcher) move to Phase 3, where there are real routes for them to
   link to.
7. GitHub Actions: lint, format check, backend tests (with postgres and redis service
   containers), frontend tests, build, `npm audit`.

Notes from verification:

- npm 11 blocks install scripts by default. Only the three Prisma packages are allowed
  (`allowScripts` in the root `package.json`). esbuild, unrs-resolver and @parcel/watcher
  are denied; they work through their prebuilt platform packages.
- On Windows, `localhost` resolves to IPv6 first and added ~2 s to every database connection
  because Docker publishes on IPv4. Connection URLs use `127.0.0.1`.

**Acceptance:** `docker compose up -d` brings all services to healthy; `npm run dev` serves
the API and the web app; `/health/ready` returns 200; lint and tests pass locally (CI is
verified once you push).

## Phase 3: Authentication and multi-tenancy ✅ (locally verified; CI runs on push)

Sessions, CSRF, register, login, logout, email verification, password reset, onboarding
(organization + first store), memberships, organization switching,
`requireTenant`, `authorize`, `tenantDb`, invitations, member management, the last-owner
rule, ownership transfer, audit log. Frontend: auth pages, onboarding, app shell
(collapsible sidebar, org switcher, user menu, breadcrumbs), overview, employees,
organization settings, profile.

**Acceptance:** auth and isolation suites pass; the role matrix test covers every route;
the Playwright flows "register and onboard" and "invite an employee" pass.

Verification results:

- Backend: 81 Jest tests (auth, CSRF, tokens, onboarding, switching, members, invitations,
  ownership transfer, `tenantDb`, cross-tenant isolation generated from the route table,
  role × route authorization matrix generated from the route table).
- Each key control was deliberately disabled once (CSRF token, Origin check, tenant filter,
  permission check, membership status check, switch membership check, atomic invitation
  claim, session revocation on password change) to confirm a test fails. All eight were
  caught; the invitation-claim test was strengthened after the first run missed it.
- Frontend: 25 Vitest + RTL tests (route guards, form validation, server field errors,
  double-submit prevention, open-redirect protection, permission-based UI, loading,
  empty and error states).
- E2E: 4 Playwright tests against the real stack and Mailpit (register → verify →
  onboard; sign out/in with return path; invite → accept → role-limited access with
  direct API refusals → deactivation; cross-organization access attempts).

Decisions and deferrals:

- The trial subscription created at onboarding moves to Phase 6 with the rest of billing.
- Membership is checked with one database query per request, with no cache yet.
- Owners cannot be demoted, deactivated or created through member management; ownership
  changes only through the two-step transfer, which keeps exactly one active owner.
- Email is sent directly (no queue yet). A delivery failure is logged and does not fail the
  request. Phase 5 moves delivery to BullMQ with retries and history.
- Platform super-admin routes are Phase 6.

## Phase 4: Core business modules ✅

1. Categories and products (variants, images, SKU uniqueness, archiving). ✅
2. Inventory (levels, receipts, adjustments, movements, low-stock thresholds, valuation). ✅
3. Customers (profiles, addresses, history, export). ✅
4. Orders (draft, placing with reservation, state machine, cancellation and release,
   shipping and consumption, totals, history, search, CSV export). ✅ Built on three stacked
   branches: `feature/orders-api`, `feature/orders-ui`, `feature/customer-order-history`.

Each module goes through: criteria → schema and migration → service → API → UI → tests →
run → verify. (The OpenAPI document is written in Phase 6 for the whole API; it does not
exist yet.)

**Acceptance:** module tests, isolation tests extended to the new routes, the concurrency
test, the order lifecycle tests, and the Playwright flows "create a product", "adjust stock"
and "process an order" all pass.

Step 1 (catalog) verification:

- Backend: 100 Jest tests in total (19 catalog: categories, nesting and cycle checks,
  per-row SKU errors, case-insensitive SKU uniqueness per organization, variant sync with SKU
  swaps, archiving, search/filter/sort/pagination, deletion, image type spoofing, size and
  count limits, image access). Isolation fixtures cover `productId`, `categoryId` and
  `imageId`. Five catalog controls were disabled one at a time; all were caught, after one
  test was added for images reached through the wrong product.
- Frontend: 36 Vitest tests (product list with URL filters and empty states, product editor
  validation and server SKU errors on the right row, read-only roles, form model round-trip).
- E2E: 7 Playwright tests, including the catalog flow (category → product with variants →
  image → SKU search) and an analyst refused by the API, plus a phone-width check of every
  page. A visual review at 1366 px and 390 px found two layout bugs the other tests missed
  (page-wide horizontal scrolling caused by a `<fieldset>` and by screen-reader-only table
  labels); both are fixed and the phone-width test fails if either returns.
- App pages load per route (2–13 kB each) and third-party libraries sit in separate
  vendor chunks that browsers can keep across deployments. The first visit still downloads
  about 185 kB of gzipped JavaScript, mostly React, React Router, Zod and React Hook Form.
- Dependencies: production `npm audit` is clean. nodemailer was upgraded to 10.1.1 for
  several SMTP header-injection advisories; `deepmerge-ts` (used by the Prisma CLI) is pinned
  to 8.0.2 with an npm override. 19 moderate advisories remain in Jest's test-only
  dependencies; npm's only "fix" is downgrading to Jest 25, so they are accepted for now.

Deletion policy: a product (or a variant removed from it) can be hard-deleted until it has
stock or order history. After that, the database's restrictive foreign keys refuse the
delete and the API answers 409 with a suggestion to archive.

Step 2 (inventory) verification:

- Every quantity change is one conditional SQL statement (`UPDATE … WHERE on_hand + Δ >= 0
AND reserved + Δr <= on_hand + Δ RETURNING …`) plus a movement row in the same
  transaction. Receipts use `INSERT … ON CONFLICT DO UPDATE`. A stock count locks the row
  with `SELECT … FOR UPDATE` before computing the difference.
- Concurrency tests: 20 simultaneous removals against 5 units (exactly 5 succeed, stock ends
  at 0), and 20 simultaneous reservations against 5 units (exactly 5 granted). Reserved units
  cannot be removed by an adjustment or a count.
- The database refuses negative stock and edits or deletes of movement history even when
  the application is bypassed (tested with raw SQL).
- Backend: 115 Jest tests in total (14 inventory). Isolation fixtures cover `variantId`, and
  stock cannot be moved across organizations through request bodies. Five inventory controls
  were disabled one at a time; all were caught after one test was strengthened to check the
  "units are reserved" message.
- Frontend: 43 Vitest tests. E2E: 8 Playwright tests, including receive → damage adjustment
  → low-stock status → refused over-removal → movement history, and the inventory pages in
  the phone-width check. A visual review found a blank moment between sign-in and the first
  lazily loaded page; the redirect now keeps a spinner on screen.
- Valuation is on hand × unit cost per currency. Variants with stock but no cost are counted
  and reported, never valued at zero.
- Low-stock notifications are Phase 5 (background jobs); the threshold and status exist now.

Step 3 (customers) verification:

- Customers are visible only to owners, managers and order managers (`customer:read`);
  analysts and inventory managers get 403 and see no navigation entry. Export
  (`customer:export`) is limited to owners and managers, rate limited per organization,
  streamed in batches of 1,000 (capped at 100,000 rows), and audited with its row count
  before the response completes. Audit entries hold ids, never names or emails.
- CSV cells are quoted per RFC 4180 and cells starting with `= + - @`, tab or CR are
  prefixed with `'`, so a customer named `=HYPERLINK(...)` cannot run a formula in Excel.
- List responses carry only what the table shows (no notes, no full addresses).
- Backend: 132 Jest tests in total (14 customers, 3 CSV). Isolation fixtures cover
  `customerId` and `addressId`. Five customer controls were disabled one at a time; all were
  caught. An export audit race (audit written after the response ended) was found by the
  tests and fixed.
- Frontend: 52 Vitest tests. E2E: 9 Playwright tests, including create → two addresses →
  switch default → real CSV download checked line by line, and the customer pages in the
  phone-width check with long names, emails and addresses.
- Order history, total spending and activity summaries need orders; they are part of step 4.

Step 4 (orders) verification:

- Lifecycle: draft → place (reserves every line, assigns the next number) → confirm →
  start → ship (consumes the reservations) → deliver; cancel (with a required reason, audited)
  releases the reservations and is refused once shipped. The full status × action table is
  unit-tested. Totals use exact decimals with half-up tax rounding; product name, SKU and price
  are snapshotted per line, and the customer and address per order.
- Concurrency: every transition locks the order row (`SELECT … FOR UPDATE`). Tested: 8 orders
  racing for the last 3 units (exactly 3 placed, numbers 1001–1003), the same draft placed
  three times at once (placed once, one reservation, no wasted number), a double "confirm"
  (one history entry), and ship/ship/cancel at once (one stock movement). After every scenario
  the reservation invariant (`reserved = Σ ACTIVE reservations`) is checked in SQL.
- Sabotage checks: removing the transition check, trusting a client price, dropping orders
  from tenant scope, or not releasing stock on cancel are all caught. Removing the row lock is
  caught by the race tests (added after the first run showed the existing tests could not tell
  the layers apart). Removing only the reservation `WHERE status = 'ACTIVE'` guard is not
  caught while the lock is in place: it is a deliberate second layer, and the conditional
  inventory update is a third.
- Customers now show order count, total spent and average order per currency, first and last
  order dates and cancelled orders, in the list, on the detail page and in the CSV export.
  "Spent" counts placed orders that were not cancelled (pending through delivered).
- Backend: 166 Jest tests. Frontend: 71 Vitest tests. E2E: 10 Playwright tests, including
  placing, confirming, processing, shipping and delivering an order with stock checked at each
  step, cancelling a second order, refusing an over-order while keeping the draft, the
  customer's spending afterwards, and the order pages at phone width.
- A visual review found two bugs that the tests did not cover: choosing a customer did not
  preselect their default address, and editing a draft would have erased its stored delivery
  address. Both are fixed and tested.

## Phase 5: Analytics and background processing

Dashboard KPIs (revenue counts only `SHIPPED` and `DELIVERED` orders by default; the
definition is documented next to the query), reports with date ranges, CSV exports as
jobs, BullMQ worker, email templates through Mailpit, low-stock and new-order notifications,
notification center, short-TTL Redis cache for dashboard aggregates.

**Acceptance:** report tests compare against hand-calculated fixtures; a job retry test
passes; the Playwright check "the dashboard reflects the seeded orders" passes.

## Phase 6: Billing and production readiness

Plans, trial, plan limits, Stripe test-mode Checkout and Customer Portal, webhook handler
(signature check, idempotency), billing history, platform admin (orgs, suspension, stats),
RLS evaluation, production Dockerfiles (multi-stage, non-root), `docker-compose.prod.yml`,
idempotent seed, OpenAPI completeness, accessibility pass, README, deployment guide,
deployment, and smoke tests on the deployed instance.

**Acceptance:** the Definition of Done in the master brief, item by item.
