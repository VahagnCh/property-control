# API

The v0 HTTP contract, and what the scaffold in `apps/api` actually does today. Source: [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit).

## Base

- Routes are under `/v1`. `GET /health` is the one route outside the prefix.
- Property-scoped routes will require `Authorization: Bearer <access_jwt>`. Trust mints that token; this API only validates it.
- JSON in, JSON out. Decimals cross the wire as strings (`"18450.00"`).
- Default currency is `MXN`.

## What the stub does

| Behavior | Routes |
| :---- | :---- |
| Real response | `GET /health`, and every OCR route (in memory, per process) |
| `{ items: [], stub: true, module }` | Collection reads: properties, memberships, obligations, period outcomes, payments, evidence, maintenance tasks, documents, reminders, audit events, home action items |
| **501** with the module name | Every create, update, delete, single-resource read, and both `content-url` routes |

`501` is deliberate. A route that cannot enforce a membership check should not pretend to succeed. The two `content-url` routes stay unimplemented so this scaffold cannot hand out an object URL.

There is no OpenAPI document yet. When one is added, generate it from the Nest decorators with `@nestjs/swagger` rather than writing it by hand, and keep it under `apps/api`.

## Me, properties, memberships

```text
GET    /v1/me
         → 200 { id, trustSub, email, displayName }

GET    /v1/properties
         → 200 { items: Property[] }        // only properties the caller is a member of
POST   /v1/properties
         Body: { name, propertyType?, occupancyStatus?, addressLine?, city?,
                 state?, country?, postalCode?, timezone? }
         → 201 Property                     // the caller becomes the owner member
GET    /v1/properties/:propertyId           → 200 Property | 404
PATCH  /v1/properties/:propertyId           → 200 Property
DELETE /v1/properties/:propertyId           → 204   // soft delete, owner only

GET    /v1/home/action-items
         → 200 ActionItem[]                 // across memberships, capped at 50

GET    /v1/properties/:propertyId/memberships          → 200 { items: Membership[] }
POST   /v1/properties/:propertyId/memberships          → 201 Membership   // owner only
         Body: { email | trustSub, role }
PATCH  /v1/properties/:propertyId/memberships/:id      → 200 Membership
DELETE /v1/properties/:propertyId/memberships/:id      → 204
```

`GET /v1/home/action-items` sorts overdue first (oldest due date), then due today, then due within 7 days. `missingEvidence: true` means a recorded, non-voided payment in the last 30 days has no evidence; the client renders that as "Sin comprobante".

## Obligations

```text
GET    /v1/properties/:propertyId/obligations?category=&isActive=
         → 200 { items: Obligation[] }
POST   /v1/properties/:propertyId/obligations
         Body: { category, title, providerName?, recurrence?, nextDueDate?,
                 expectedAmount?, reminderOffsets?, preferredMethod?, notes?, isActive? }
         → 201 Obligation                   // reminderOffsets defaults to [7, 1]
GET    /v1/properties/:propertyId/obligations/:obligationId    → 200 | 404
PATCH  /v1/properties/:propertyId/obligations/:obligationId    → 200 Obligation
DELETE /v1/properties/:propertyId/obligations/:obligationId    → 204   // archive

GET    /v1/properties/:propertyId/obligations/:obligationId/period-outcomes?from=&to=
         → 200 { items: PeriodOutcome[] }
POST   /v1/properties/:propertyId/obligations/:obligationId/period-outcomes
         Body: { periodDueDate, outcome: "not_applicable" }
         → 201 PeriodOutcome
```

A client may only create a `not_applicable` outcome. `paid` and `partial` are reconciled from payments; a client never posts them. Creating `not_applicable` advances `nextDueDate` and leaves `isActive` true. Pausing is `PATCH { isActive: false }`. Archiving is `DELETE`. Those are three different calls.

## Payments

```text
GET    /v1/properties/:propertyId/payments?obligationId=&from=&to=
         → 200 { items: Payment[] }
POST   /v1/properties/:propertyId/payments
         Headers: Idempotency-Key: <string>          // required
         Body: { obligationId, propertyId, amount, currency?, paidAt,
                 method?, reference?, notes? }
         → 201 Payment | 200 Payment on replay
GET    /v1/properties/:propertyId/payments/:paymentId          → 200 | 404
PATCH  /v1/properties/:propertyId/payments/:paymentId          → 200 Payment
         Body: { notes?, method?, reference?, status? }         // status → voided
DELETE /v1/properties/:propertyId/payments/:paymentId          → 204   // soft delete
```

This records a payment the person already made somewhere else. The API does not charge a card, debit an account, or hold a balance. `method` and `reference` are descriptive text — "SPEI", a folio — not instructions to a payment processor.

Creating a payment recomputes the current period outcome from recorded, non-voided payments. A fully settled period advances `nextDueDate`. A partial one does not.

## Evidence

```text
POST   /v1/properties/:propertyId/evidence
         Headers: Idempotency-Key                     // required
         Content-Type: multipart/form-data
         Body: file + (paymentId | maintenanceTaskId) + type + notes?
         → 201 Evidence

POST   /v1/properties/:propertyId/evidence/upload-url
         Headers: Idempotency-Key                     // required
         Body: { paymentId? | maintenanceTaskId?, type, notes?,
                 contentType, byteSize, originalFilename? }
         → 201 { evidence, uploadUrl, expiresAt }     // short-lived PUT
POST   /v1/properties/:propertyId/evidence/:evidenceId/complete   → 200 Evidence

GET    /v1/properties/:propertyId/evidence?paymentId=&maintenanceTaskId=
         → 200 { items: Evidence[] }
GET    /v1/properties/:propertyId/evidence/:evidenceId            → 200 | 404
GET    /v1/properties/:propertyId/evidence/:evidenceId/content-url
         → 200 { url, expiresAt }                     // short-lived GET, never permanent
DELETE /v1/properties/:propertyId/evidence/:evidenceId            → 204
```

Evidence is optional on a payment. Content types allowed: `image/jpeg`, `image/png`, `application/pdf`. Maximum size about 15 MB (15,728,640 bytes). Exactly one parent: a payment or a maintenance task.

## Maintenance and documents

```text
GET    /v1/properties/:propertyId/maintenance-tasks
POST   /v1/properties/:propertyId/maintenance-tasks
         Body: { title, description?, dueOn?, status? }    → 201 MaintenanceTask
GET    /v1/properties/:propertyId/maintenance-tasks/:taskId
PATCH  /v1/properties/:propertyId/maintenance-tasks/:taskId
DELETE /v1/properties/:propertyId/maintenance-tasks/:taskId      → 204

GET    /v1/properties/:propertyId/documents
POST   /v1/properties/:propertyId/documents                      // same limits as evidence
GET    /v1/properties/:propertyId/documents/:documentId
GET    /v1/properties/:propertyId/documents/:documentId/content-url
         → 200 { url, expiresAt }
PATCH  /v1/properties/:propertyId/documents/:documentId          // title
DELETE /v1/properties/:propertyId/documents/:documentId          → 204
```

A successful document upload may enqueue an OCR job, mortgages and deeds first.

## OCR

```text
POST /v1/properties/:propertyId/documents/:documentId/ocr-jobs
       → 201 OcrJob          // 200 with the existing job if one is still open
GET  /v1/properties/:propertyId/documents/:documentId/ocr-jobs
       → 200 { items: OcrJob[] }                      // newest first
GET  /v1/properties/:propertyId/ocr-jobs/:ocrJobId
       → 200 { job, suggestions }
POST /v1/properties/:propertyId/ocr-jobs/:ocrJobId/confirm
       Body: { decisions: Array<{ suggestionId, action: "accept" | "reject" | "edit",
                                  editedValue?, targetEntityId? }> }
       → 200 { job, suggestions, applied: Array<{ suggestionId, entityType,
                                                  entityId, fieldPath }> }
```

Job statuses: `pending` → `processing` → `suggested` → `confirmed` | `rejected` | `failed`.
Suggestion apply statuses: `pending` → `accepted` | `rejected`.

**Confirm is the only route that applies a suggestion.** A job reaching `suggested` writes nothing to an obligation, a payment, a property, or a document. If every decision is a reject, the job ends `rejected` and no entity field changes. Accepted and edited values are written together; a partial failure returns 409 or 422 rather than applying some of them.

What the stub does differently: it finishes the extract synchronously with four fixed suggestions and `vendor: "stub"`, keeps everything in memory, requires a decision for every suggestion, and returns `persisted: false`. There is no model call. Details in [OCR.md](OCR.md).

### Example

```bash
# Create a job. Returns 201 the first time, 200 while that job is still open.
curl -s -X POST http://localhost:3000/v1/properties/demo/documents/deed/ocr-jobs

# Read the job and its pending suggestions.
curl -s http://localhost:3000/v1/properties/demo/ocr-jobs/$JOB_ID

# Accept one field, edit another, reject the rest.
curl -s -X POST http://localhost:3000/v1/properties/demo/ocr-jobs/$JOB_ID/confirm \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[
        {"suggestionId":"'$S1'","action":"edit","editedValue":{"amount":"19000.00","currency":"MXN"},"targetEntityId":"'$OBLIGATION_ID'"},
        {"suggestionId":"'$S2'","action":"accept","targetEntityId":"'$OBLIGATION_ID'"},
        {"suggestionId":"'$S3'","action":"reject"},
        {"suggestionId":"'$S4'","action":"reject"}
      ]}'
```

## Reminders and audit

```text
GET    /v1/properties/:propertyId/reminders?status=pending
POST   /v1/properties/:propertyId/reminders
         Body: { obligationId? | maintenanceTaskId?, scheduledFor, channel? }
         → 201 Reminder
PATCH  /v1/properties/:propertyId/reminders/:reminderId
         Body: { status?: "cancelled", scheduledFor? }
DELETE /v1/properties/:propertyId/reminders/:reminderId

GET    /v1/properties/:propertyId/audit-events?entityType=&entityId=&from=&to=&cursor=
         → 200 { items: AuditEvent[], nextCursor? }
```

Reminder channels: `email`, `push`, `in_app`. Worker idempotency is the database pair `(reminder_id, scheduled_for)`, separate from the HTTP `Idempotency-Key`. Audit events are append-only and owner-readable; clients never post them.

## Status codes

| Condition | Status |
| :---- | :---- |
| Missing, invalid, or expired JWT | 401 |
| Valid JWT, no active membership for `:propertyId`, or the property is unknown or soft-deleted | 404 |
| Active membership, role too low | 403 |
| Soft-deleted child resource under a property the caller belongs to | 404 |
| Missing `Idempotency-Key` on a payment or evidence create | 400 |
| Same idempotency key, different body | 409 |
| Replay with the same key and body | 200 |
| Scaffold placeholder | 501 |

## Idempotency

Required on `POST .../payments`, `POST .../evidence`, and `POST .../evidence/upload-url`. Uniqueness is `(property_id, idempotency_key)`. First call creates and returns 201. A replay with the same body returns 200 and the original resource. The same key with a different body is a 409. Use a UUID or another high-entropy string.

## Role matrix

| Action | owner | member | viewer |
| :---- | :---- | :---- | :---- |
| Read the property and its lists | yes | yes | yes |
| Create or update an obligation, payment, task, or document | yes | yes | no |
| Upload evidence | yes | yes | no |
| Trigger OCR, confirm suggestions | yes | yes | no |
| Read OCR jobs and suggestions | yes | yes | yes |
| Manage memberships | yes | no | no |
| Soft-delete the property | yes | no | no |

Product may cut `member`, leaving owner and viewer. If that happens, every write maps to owner.
