# Product

Summarized from the [confirmed product brief v1.1](https://docs.google.com/document/d/1F_DSJG5Fo6G3WXyGXJWyqscMp8LC9SbEqgGj-c68ric/edit) (amended 30 Sep 2026, when OCR moved into the MVP). The brief is the source of truth. This page exists so someone reading the repo does not have to open Drive to understand what is being built.

## Mission

A personal property OS for people who own several properties in Mexico. See what is owed, when it is due, what was paid, and the proof, across the whole portfolio.

The MVP **tracks** money. It does not **move** money.

## Market and language

Mexico first. Spanish-first UI copy on the core screens: predial, CFE, agua, folio, comprobante. The API keeps English `snake_case` enum values and the client renders the Spanish labels.

Default client: Expo React Native with TypeScript.

## Core loop

**Configure → Remind → Record → Prove → Repeat**

1. Add properties and obligations.
2. Get a reminder before the due date.
3. Record a payment.
4. Optionally attach evidence.
5. The next period is scheduled.
6. On a document upload, OCR extracts and suggests. The person confirms before anything applies.

## In scope

### Entities

User, PropertyMembership, Property, Obligation, Payment, Evidence, MaintenanceTask, Document, Reminder, OcrJob, OcrSuggestion. Field detail in [DATA-MODEL.md](DATA-MODEL.md).

### Obligation categories

predial · water (agua) · electricity (CFE) · gas · internet · mantenimiento/HOA · mortgage (hipoteca) · insurance (seguro) · security (seguridad) · other

### Recurrence

monthly · bimonthly · quarterly · semiannual · annual · custom · irregular (approximately one-time)

### Five-tab IA

**Inicio · Propiedades · Pagos · Mantenimiento · Documentos**

Calendar, reports, and settings are later or reached from the profile. There is no sixth "Más" tab in the MVP.

## Locks

These are confirmed. Changing one requires Product, not a pull request.

| Lock | Spec |
| :---- | :---- |
| Tracking only | No payment processing, no custody of funds, no bank link, no payout. |
| Evidence optional | A payment saves without a comprobante. The UI encourages one ("Sin comprobante") and warns once per session. |
| Default reminders | `[7, 1]` days before due. Editable per obligation. |
| Marcar no aplica | Skips **this period only**: outcome `not_applicable`, `nextDueDate` advances, `isActive` stays true. No undo in the MVP; the audit trail is the record. |
| Pausar vs Archivar | Pause is `isActive = false` with no advancement. Archive is a soft-hide. Both differ from a not-applicable period. |
| Pago parcial | Status `partial`. Does **not** advance `nextDueDate` until the period is paid in full or marked not applicable. |
| Authorization | Every property-scoped read and write passes a `PropertyMembership` check. |
| File storage | Private `storage_key` plus short-lived signed URLs. No public URLs. |
| Client sync | Online-first with an outbox. `Idempotency-Key` on payment and evidence creates. The server wins a conflict. |
| OCR | On upload: extract, then **suggest**, then the person **confirms**. No silent auto-fill, ever. |

## OCR in the MVP

| Rule | Spec |
| :---- | :---- |
| Trigger | After a document uploads to private storage. Priority: mortgage, deed, and related property documents. Evidence OCR may opt in later. |
| Output | A set of suggested fields (amounts, dates, counterparty, folio, property identifiers) with confidence where the vendor provides it. |
| Apply | Only after an explicit confirm. The person may edit a suggestion first. |
| Reject | The person can dismiss everything. The file stays stored. No partial write. |
| Privacy | The raw file and the OCR artifacts stay in private storage. Retention follows Trust. No public URLs. |
| Not in scope | Silent overwrite of an existing obligation or payment field. A complete legal OCR suite for every municipio. |

## Out of scope

- Payment processing, wallets, payouts, moving funds
- Bank aggregation and Open Banking
- Condo administration suites
- Full accounting and tax filing
- Every municipal portal integration
- Marketplaces, listings, tenant screening
- Legal lease workflows
- Deleting a payment, unless Product reopens it
- Applying OCR output without confirmation

## Primary user

A multi-property owner or co-owner in Mexico. Their jobs:

- See overdue and due-soon across the portfolio at a glance
- Record a payment in two taps or fewer
- Attach proof later
- Upload a mortgage or other document and accept or edit the suggestions
- Read Spanish on the core screens

Open research questions from the brief: owner-only or owner plus tenant on day one; how many properties a person has in week one; which three obligation types must ship if scope is cut again.

## Success metrics

| KPI | Definition |
| :---- | :---- |
| Time-to-first-obligation | Signup to first active obligation |
| Core-loop completion | Share of due periods with a payment recorded within 7 days of the due date |
| Evidence attach rate | Share of payments with at least one evidence file within 30 days |
| Reminder to record | Share of reminder opens that reach the record-payment screen within 24 hours |
| Weekly active properties | Properties with a Home action or a payment in 7 days |
| OCR confirm rate | Share of OCR jobs where the person confirms at least one suggested field |

Analytics events include `ocr_suggested`, `ocr_confirmed`, and `ocr_dismissed` alongside the UX events.

## Monetization direction

Not build-blocking. Freemium is the likely shape: a free tier with caps on properties and obligations, paid for more properties and document storage. **Saving a payment without evidence is never put behind a paywall** — that friction would break the core loop. Prices and tiers are undecided.

## UX priority order

1. Home: due, overdue, next actions — specified
2. Property detail and obligations — specified
3. Record payment and evidence — specified
4. Reminder affordances
5. Document upload and the OCR confirm sheet, mortgages first
6. Maintenance, lighter

## Change control

Material scope changes go through Product and are announced in the Property Control channel. Field and enum flexibility inside this boundary is fine.
