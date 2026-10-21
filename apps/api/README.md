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
curl -s http://localhost:3000/health
# {"status":"ok","service":"property-control-api"}
```

## What works

| Behavior | Routes |
| :---- | :---- |
| Real | `GET /health`. OCR routes, only when `OCR_STUB_ENABLED` is `1`, `true`, `yes`, or `on` |
| `{ items: [], stub: true, module }` | Collection reads |
| **501** | Creates, updates, voids, deletes of other resources, single-resource reads, both `content-url` routes, and every OCR route while the flag is off |

The stub maps **57** routes. There is no payment DELETE. `POST .../payments/:paymentId/void` is one of the 501s. A viewer write, such as void, is 403 once the route is live. A non-member and an unknown resource are 404. Email invites live under `/v1/properties/:propertyId/invites` and `POST /v1/invites/accept`. Accept checks an unknown token or the wrong account as 404 before revealing token state. Money on the wire is a decimal string such as `"1234.50"` plus `MXN`, stored as integer centavos. Every Property response includes `timezone`, default `America/Mexico_City`. The one-year `paidAt` back-date limit uses that timezone, not UTC.

`501` is on purpose: a route that cannot yet enforce a membership check should not look like it succeeded. The `content-url` routes stay unimplemented so this scaffold cannot hand out an object URL.

## Layout

```text
src/
├── main.ts                 bootstrap
├── configure-app.ts        /v1 prefix, health excluded, CORS allow-list, shutdown hooks
├── app.module.ts           module wiring
├── common/
│   └── scaffold.response.ts  the empty-list and 501 helpers
├── auth/                   access-token and membership guards, attached to OCR, fail closed
├── users/ home/ properties/ memberships/
├── obligations/ payments/ evidence/ maintenance/
├── documents/ reminders/ audit/
└── ocr/                    in-memory job and suggestion lifecycle + tests
prisma/schema.prisma        PostgreSQL schema, not migrated
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

`prisma/schema.prisma` covers the locked entities. It is not migrated and no route reads it.

```bash
cp .env.example .env
pnpm --filter @property-control/api prisma:validate
pnpm --filter @property-control/api prisma:generate   # needs network on first run
```

`prisma migrate dev` needs a reachable `DATABASE_URL`:

```bash
docker run --rm -d --name pc-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=property_control postgres:16
```

Before the first migration, run [`prisma/sql/checks.sql`](prisma/sql/checks.sql). Prisma cannot express those checks, including the two partial unique indexes on reminders. They are also listed at the end of [docs/DATA-MODEL.md](../../docs/DATA-MODEL.md). Edge-case behavior is [docs/EDGE_CASES.md](../../docs/EDGE_CASES.md).

## Tests

```bash
pnpm api:test
```

`src/ocr/ocr.service.spec.ts` holds the suggest-then-confirm rule. `test/app.e2e.spec.ts` checks health, the empty scaffold list, the 501 on a payment create, that `content-url` returns no URL, and the OCR round trip. Changing the OCR apply path should break a test.
