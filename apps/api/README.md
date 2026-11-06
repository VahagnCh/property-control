# @property-control/api

NestJS + TypeScript API for DueRecord. It records obligations, payments a person already made, files, reminders, and OCR suggestions. It does not move money.

Route shapes follow [Backend formal v0](../../docs/API.md). Most of them are placeholders.

Nest 12 ships as ESM, so this package is a native ES module: `"type": "module"`, `nodenext` resolution, and `.js` extensions on relative imports. The build is plain `tsc`, the dev server is `node --import tsx`, and the tests run on Vitest, which is what Nest 12 generates for a new ESM project.

## Run

From the repository root:

```bash
pnpm install
pnpm api:dev        # watch mode
pnpm api:start      # once
pnpm api:build      # tsc → dist/
pnpm api:test       # unit + HTTP tests
pnpm api:typecheck  # tsc --noEmit, includes the tests
```

Or from this directory with `pnpm start:dev`, `pnpm test`, and so on. `pnpm start:prod` runs the compiled `dist/main.js`.

Listens on port 3000 unless `PORT` is set. No database is needed to boot.

```bash
curl -s http://localhost:3000/v1/health
# {"status":"unavailable"} without a database, {"status":"ok"} when SELECT 1 succeeds
```

## What works

| Behavior | Routes |
| :---- | :---- |
| Real | `GET /v1/health` (database). OCR routes, only when `OCR_STUB_ENABLED` is `1`, `true`, `yes`, or `on` |
| `{ items: [], stub: true, module }` | Collection reads |
| **501** | Creates, updates, voids, deletes of other resources, single-resource reads, both `content-url` routes, and every OCR route while the flag is off |

The stub maps **62** routes. There is no payment DELETE. `POST .../payments/:paymentId/void` is one of the 501s. A viewer write, such as void, is 403 once the route is live. A non-member and an unknown resource are 404. Email invites live under `/v1/properties/:propertyId/invites` and `POST /v1/invites/accept`. Accept checks an unknown token or the wrong account as 404 before revealing token state. Money on the wire is a decimal string such as `"1234.50"` plus `MXN`. The database stores `amount` and `expected_amount` as BIGINT centavos. Every Property response includes `timezone`, default `America/Mexico_City`. The one-year `paidAt` back-date limit uses that timezone, not UTC.

`501` is on purpose: a route that cannot yet enforce a membership check should not look like it succeeded. The `content-url` routes stay unimplemented so this scaffold cannot hand out an object URL.

## Layout

```text
src/
├── main.ts                 bootstrap
├── configure-app.ts        /v1 prefix, v1/health not doubled, trust proxy 1, CORS allow-list, shutdown hooks
├── app.module.ts           module wiring
├── common/
│   └── scaffold.response.ts  the empty-list and 501 helpers
├── auth/                   access-token and membership guards, attached to OCR, fail closed
├── users/ home/ properties/ memberships/
├── obligations/ payments/ evidence/ maintenance/
├── documents/ reminders/ audit/
└── ocr/                    in-memory job and suggestion lifecycle + tests
prisma/schema.prisma        PostgreSQL schema and init migration
test/app.e2e.spec.ts        HTTP tests over the whole app
vitest.config.ts            node environment, src and test specs
```

Each entity module is a controller with the v0 route shape and no persistence. `StorageModule` and `RetentionModule` from the formal doc do not exist yet.

Vitest transforms TypeScript with oxc, which supports Nest's legacy decorators but does not emit decorator metadata. Providers are injected with an explicit `@Inject(Token)` rather than by constructor type, so the same source runs under Vitest and under the `tsc` build. Keep that pattern when you add a provider.

## OCR

The one rule: a job reaching `suggested` writes nothing. `POST .../ocr-jobs/:id/confirm` is the only path that accepts or rejects a suggestion.

```bash
# OCR_STUB_ENABLED=true
JOB=$(curl -s -X POST http://localhost:3000/v1/properties/$PROPERTY_ID/documents/$DOCUMENT_ID/ocr-jobs \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "$JOB"      # status "suggested", vendor "stub", no storageKey
```

The stub finishes the extract synchronously with four fixed suggestions, all `applyStatus: "pending"`. There is no model call. `confirm` requires one decision per suggestion and a UUID `targetEntityId` before accepting an unbound field. `persisted` is true only when the confirm's saves commit. The in-memory map is capped and jobs expire. Full behavior: [docs/OCR.md](../../docs/OCR.md).

Set `OCR_STUB_ENABLED` to `1`, `true`, `yes`, or `on` or every OCR route stays **501**. `CORS_ORIGINS` is the browser allow-list; leave it empty to refuse cross-origin access. Do not set it to `*`.

## Auth

`src/auth/access-token.guard.ts` is attached to the OCR routes. A missing, invalid, or expired token is **401**. The default verifier rejects every token, so the routes fail closed until a verifier is supplied. The membership guard returns **404** when the property, the document, or the membership is unknown, and **403** when a viewer attempts an OCR write. Trust mints access and refresh tokens; this API only validates them and enforces `PropertyMembership`. It never mints a token. See [docs/TRUST.md](../../docs/TRUST.md).

Non-OCR routes are still open stubs. A path id that is not a UUID is **400** on those routes; a UUID still reaches the **501** placeholder. There is no payment `DELETE`.

## Prisma

`prisma/schema.prisma` covers the locked entities. The init migration includes [`prisma/sql/checks.sql`](prisma/sql/checks.sql): the reminder partial unique indexes, the money and date checks, `gen_random_uuid()` defaults, and append-only triggers. A later migration stores money as BIGINT, scopes idempotency keys by method and route, and rejects `UPDATE`, `DELETE`, and `TRUNCATE` on `consents`, `audit_events`, and `aviso_versions`. No extension is created. Nest HTTP uses Prisma for `GET /v1/health` (`SELECT 1`, 2 second timeout) and not for the other routes. Those stay in memory or **501**.

`DATABASE_URL` is the pooled connection. Tests and the API use the non-owner role `property_control_app`. `DIRECT_URL` is the owner connection used for migrations and for test cleanup of append-only tables and payments. The role is created by [`prisma/bootstrap-app-role.sh`](prisma/bootstrap-app-role.sh) before `prisma migrate deploy`, because `CREATE ROLE` cannot run inside the migration transaction. The script requires `APP_ROLE_PASSWORD` and has no default. Production sets that password outside this repository. Point both URLs at Postgres 15 or newer. Unit tests pass with neither variable set. The integration file runs when both are set. `SERVER_SECRET` must be base64 that decodes to at least 32 bytes. Boot refuses to listen without it, and without a published row for `AVISO_VERSION`. The secret is never logged. `APP_ENV` is `production`, `staging`, `development`, or `test`. A missing or unknown value is production. Production requires `DATABASE_URL` and does not use the in-memory auth stores or the fake mail sender. CI sets `APP_ENV=test`. Set `APP_ENV=production` on the production service and `APP_ENV=staging` on staging.

```bash
cp .env.example .env
docker run --rm -d --name pc-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=property_control postgres:15
pnpm --filter @property-control/api exec prisma migrate deploy
pnpm --filter @property-control/api exec prisma db seed
```

The seed upserts fixed demo ids: user `demo`, property Casa in `America/Mexico_City`, an owner membership, the CFE obligation, and the current aviso version. It does not insert a consent row. `AVISO_VERSION` and `AVISO_URL` are required for the seed and for `main.ts`. Edge-case behavior is [docs/EDGE_CASES.md](../../docs/EDGE_CASES.md).

## Tests

```bash
pnpm api:test
```

`src/ocr/ocr.service.spec.ts` holds the suggest-then-confirm rule. `test/app.e2e.spec.ts` checks health, the empty scaffold list, the 501 on a payment create, that `content-url` returns no URL, and the OCR round trip. Changing the OCR apply path should break a test.
