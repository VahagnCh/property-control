# Roadmap

Near-term board. Dates are the committed delivery dates from the DueRecord channel as of 2 Oct 2026.

## Now

| Item | Owner | Due |
| :---- | :---- | :---- |
| Mobile React Native write-up | Mobile | **3 Oct** |
| UX record payment (Pay3 and Pay4) | UX | **7 Oct** |
| Trust MVP architecture | Trust | **6 Oct** |
| OCR architecture, extract and suggest plus retention | Trust | **8 Oct** |

This scaffold is the repository those land in. The Mobile write-up should say how the five-tab shell in `apps/mobile` grows into real screens, which navigation library survives, and how the outbox works. The Trust items settle two questions this repo has open: who signs object URLs, and who owns the OCR worker.

## Then

In the product's priority order:

1. **Home feed.** `GET /v1/home/action-items` against real data, then H1 and H2. This is the remind-to-record launcher, so it is the first screen worth building.
2. **Property detail and obligations.** P3 and P4, with the three distinct controls for no aplica, pausar, and archivar.
3. **Record payment and evidence.** Pay3 and Pay4, with the optional-comprobante behavior and `Idempotency-Key` on the create.
4. **Reminder affordances.** Reminder rows from `reminder_offsets`, unique on (parent, scheduled time, channel), delivery idempotency on `(reminder_id, scheduled_for, user_id, channel)`, and the snooze control.
5. **Document upload and the OCR confirm sheet.** D2 and D-OCR, mortgages first.
6. **Maintenance.** Lighter than the rest, on purpose.

## Backend work this scaffold leaves open

| Work | Notes |
| :---- | :---- |
| First migration | Prisma migrate plus the SQL checks listed at the end of [DATA-MODEL.md](DATA-MODEL.md) |
| Access token validation | JWKS from Trust, then attach the guard that currently fails closed |
| Membership enforcement | The 404-not-403 policy on every property-scoped route |
| Persistence per module | Replace the 501 placeholders, module by module |
| Period outcome engine | Reconcile paid, partial, and overpaidAmount from non-voided payments. Advance one period from the dueDay anchor, move nextDueDate back on void, and skip dates inside a pause. Rules: [EDGE_CASES.md](EDGE_CASES.md). |
| Idempotency | `(property_id, recorded_by_user_id, idempotency_key)` on payment creates and `(property_id, idempotency_key)` on evidence creates, with replay returning the stored 201 |
| Storage module | Signed PUT and GET after authorization, and object deletion on hard delete |
| Retention module | The daily 30-day soft-to-hard delete job |
| Audit writer | Append-only, on every sensitive change including OCR confirmations |
| OCR worker | Replace the in-memory stub, keeping confirm as the only apply path |
| OpenAPI | Generate from the Nest decorators rather than hand-writing it |

## Not on this roadmap

Payment processing, wallets, payouts, bank aggregation, and Open Banking are out of the MVP and are not sequenced here. Neither is applying an OCR suggestion without a confirmation. Those are [ADR 0001](adr/0001-tracking-not-money-movement.md) and [ADR 0002](adr/0002-ocr-suggest-then-confirm.md), not backlog items.

Also later: calendar, reports, settings as a tab, condo administration, accounting and tax filing, municipal portal integrations, and tenant-facing surfaces.

## Open questions to close

From the product brief: owner-only or owner plus tenant on day one; how many properties a person has in their first week; which three obligation categories must ship if scope is cut again.

From Backend formal v0: the role set (`owner | member | viewer` or just owner and viewer); who signs object URLs; who owns the OCR extract worker; and who delivers push and email. Membership invites are decided: email, single-use, 7 days, specified in [EDGE_CASES.md](EDGE_CASES.md). Offset 0 is in-app only.

Monetization shape is direction only and does not block the build. The one decision already made: saving a payment without evidence is never gated.
