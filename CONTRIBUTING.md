# Contributing

Property Control is a tracking product. Pull requests that charge money, connect a bank, or write OCR fields without an explicit confirm request will be rejected. Those boundaries are [ADR 0001](docs/adr/0001-tracking-not-money-movement.md) and [ADR 0002](docs/adr/0002-ocr-suggest-then-confirm.md).

## Setup

Node 20.19+ (see `.nvmrc`) and pnpm 10. From a clean checkout:

```bash
pnpm install
pnpm api:test
pnpm api:build
pnpm mobile:typecheck
```

`apps/api` is a native ES module because Nest 12 ships as ESM: relative imports need a `.js` extension, and providers take an explicit `@Inject(Token)` so the source works under both the `tsc` build and Vitest's oxc transform.

## Branches and pull requests

1. Branch from `main`. Use a short, lowercase name, for example `api/ocr-confirm-persist`.
2. Keep the change focused. A PR that adds a screen should not also redesign the schema.
3. Open the PR against `main`. Describe what changed, how you checked it, and which Drive doc it follows if behavior changed.
4. Update the matching file under `docs/` when the contract changes. The Drive documents stay the source of truth until Product amends them.

Commit messages should say what the change does in the imperative mood: `Add in-memory OCR confirm stub`.

## What to run

| Change | Check |
| :---- | :---- |
| `apps/api` | `pnpm api:test`, `pnpm api:typecheck`, and `pnpm api:build` |
| Prisma schema | `pnpm api:prisma:validate` with `apps/api/.env` present |
| `apps/mobile` | `pnpm mobile:typecheck` |
| Docs only | Read the linked Drive doc and keep the non-goals accurate |

The API test suite covers health, the 501 payment placeholder, and the OCR rule that suggestions stay pending until confirm.

## Review expectations

- Property-scoped behavior must assume a `PropertyMembership` check, even while the guard is still unwired. The placeholder guard fails closed on purpose.
- File routes return a private `storageKey`, never a permanent public URL.
- `Idempotency-Key` will be required on payment and evidence creates. Do not drop it when those routes become real.
- Default reminder offsets stay `[7, 1]` when the client omits them.
- `not_applicable`, pause (`isActive = false`), and archive (`deletedAt`) stay three different operations.
