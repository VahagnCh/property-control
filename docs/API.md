# API

The v0 HTTP contract, and what the scaffold in `apps/api` actually does today. Source: [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit). Payment, period, reminder, timezone, and invite behavior for the public product, [DueRecord](EDGE_CASES.md), overrides this contract where they disagree.

The Nest stub maps **57** routes, counting each method and path Nest registers, including `GET /health`.

## Base

- Routes are under `/v1`. `GET /health` is the one route outside the prefix.
- Property-scoped routes will require `Authorization: Bearer <access_jwt>`. Trust mints that token; this API only validates it.
- JSON in, JSON out. Money amounts (`amount`, `expectedAmount`, `overpaidAmount`) are JSON integers in centavos. `1845000` means 18,450.00 MXN.
- Currency is `MXN` only. Any other currency returns 422.

## What the stub does

| Behavior | Routes |
| :---- | :---- |
| Real response | `GET /health`. OCR routes answer in memory only when `OCR_STUB_ENABLED` is `1`, `true`, `yes`, or `on` |
| `{ items: [], stub: true, module }` | Collection reads: properties, memberships, obligations, period outcomes, payments, evidence, maintenance tasks, documents, reminders, audit events, home action items |
| **501** with the module name | Every create, update, delete, single-resource read, both `content-url` routes, and every OCR route while the flag is off |

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
PATCH  /v1/properties/:propertyId/memberships/:id      → 200 Membership
DELETE /v1/properties/:propertyId/memberships/:id      → 204   // revoke an active membership

GET    /v1/properties/:propertyId/invites              → 200 { items: Invite[] }
POST   /v1/properties/:propertyId/invites              → 201 { invite, token }   // owner only
         Body: { email, role: "member" | "viewer" }
POST   /v1/properties/:propertyId/invites/:inviteId/resend   → 200 { invite, token }
DELETE /v1/properties/:propertyId/invites/:inviteId    → 204   // revoke the token
POST   /v1/invites/accept
         Body: { token }
         → 200 Membership
```

Adding a person is an email invite, not an immediate membership. The raw `token` is returned once. The row stores `tokenHash` (lowercase hex SHA-256) and `expiresAt = sentAt + 7 days`. Accepting requires a signed-in user whose email matches the invite. Expired, revoked, and already-used tokens return 410. An email that already has an active membership returns 409. Role `owner` returns 422. See [EDGE_CASES.md](EDGE_CASES.md) section 8.

`timezone` on a property is an IANA name. Omitted, it is `America/Mexico_City`. A name that is not in the tz database returns 422. Overdue and Home ranking use each property's timezone for "today".

`GET /v1/home/action-items` sorts overdue first (oldest due date), then due today, then due within 7 days. "Today" is evaluated per property timezone. `missingEvidence: true` means a recorded, non-voided payment in the last 30 days has no evidence; the client renders that as "Sin comprobante". Paused and archived obligations are not listed as overdue.

## Obligations

```text
GET    /v1/properties/:propertyId/obligations?category=&isActive=
         → 200 { items: Obligation[] }
POST   /v1/properties/:propertyId/obligations
         Body: { category, title, providerName?, recurrence?, dueDay?, scheduleAnchor?,
                 nextDueDate?, expectedAmount?, reminderOffsets?, preferredMethod?,
                 notes?, isActive? }
         → 201 Obligation                   // reminderOffsets defaults to [7, 1]
                                              // expectedAmount is integer centavos
GET    /v1/properties/:propertyId/obligations/:obligationId    → 200 | 404
PATCH  /v1/properties/:propertyId/obligations/:obligationId    → 200 Obligation
         Body: { isActive: false, ... }             // pause. isActive true is 422
DELETE /v1/properties/:propertyId/obligations/:obligationId    → 204   // archive, also pauses
POST   /v1/properties/:propertyId/obligations/:obligationId/resume      → 200 Obligation
POST   /v1/properties/:propertyId/obligations/:obligationId/unarchive   → 200 Obligation

GET    /v1/properties/:propertyId/obligations/:obligationId/period-outcomes?from=&to=
         → 200 { items: PeriodOutcome[] }
POST   /v1/properties/:propertyId/obligations/:obligationId/period-outcomes
         Body: { periodDueDate, outcome: "not_applicable" }
         → 201 PeriodOutcome | 409
```

A client may only create a `not_applicable` outcome. `paid` and `partial` are reconciled from payments; a client never posts them. Creating `not_applicable` advances `nextDueDate` one period and leaves `isActive` true. It returns 409 when the period has a non-voided payment, or when the outcome is already `paid` or `not_applicable`.

Pausing is `PATCH { isActive: false }`. It does not set `deletedAt` and it does not write `not_applicable`. Resume is `POST .../resume`: `nextDueDate` becomes the first scheduled due date on or after today in the property timezone, and dates inside the pause are not created. `PATCH { isActive: true }` returns 422 so resume cannot skip that rule.

Archiving is `DELETE`. It sets `deletedAt` and also pauses. Payments and N/A then return 409. Unarchive clears `deletedAt` and leaves `isActive` false until resume. Those are three mechanisms. Archive is the one that also pauses. The schedule rules are in [EDGE_CASES.md](EDGE_CASES.md) sections 3 and 6.

`dueDay` (1–31) and `scheduleAnchor` are required for monthly, bimonthly, quarterly, semiannual, and annual. The due date clamps to the month's last day and the anchor does not drift.

## Payments

```text
GET    /v1/properties/:propertyId/payments?obligationId=&from=&to=
         → 200 { items: Payment[] }          // includes voided payments
POST   /v1/properties/:propertyId/payments
         Headers: Idempotency-Key: <string>          // required
         Body: { obligationId, amount, currency?, paidAt, periodDueDate?,
                 markPartial?, method?, reference?, notes? }
         → 201 { payment, warnings } | 200 same body on replay
GET    /v1/properties/:propertyId/payments/:paymentId          → 200 | 404
PATCH  /v1/properties/:propertyId/payments/:paymentId          → 200 Payment
         Body: { notes?, method?, reference? }       // cannot void or unvoid
POST   /v1/properties/:propertyId/payments/:paymentId/void
         Headers: Idempotency-Key: <string>          // required
         Body: { voidReason }                        // trimmed length 1–500
         → 200 Payment
```

There is no `DELETE` for a payment. A correction is the void route. It sets `voidedAt`, `voidedBy`, and `voidReason`. A second void returns 409 and changes nothing. A void cannot be undone. The same Idempotency-Key returns the original void response. A caller without write access, including a viewer, receives 404 and never 403.

This records a payment the person already made somewhere else. The API does not charge a card, debit an account, or hold a balance. `method` and `reference` are descriptive text — "SPEI", a folio — not instructions to a payment processor.

`amount` is integer centavos and must be greater than 0. `paidAt` later than now plus 24 hours, or earlier than now minus one calendar year, returns 422. A non-voided payment with the same obligation, the same amount, and a property-timezone date within 3 days adds a `possible_duplicate` warning and still returns 201. Voided payments, different amounts, and idempotency replays do not run that check again.

Creating or voiding a payment recomputes the period from recorded, non-voided payments. A sum below the expected amount is `partial` and does not move `nextDueDate`. A sum that reaches the expected amount is `paid` and moves `nextDueDate` forward exactly one period. A larger sum stores the excess as `overpaidAmount` on that period and still moves forward only one period. A void can move `nextDueDate` back to the earliest candidate that is not settled. The rules are in [EDGE_CASES.md](EDGE_CASES.md) sections 1, 2, and 7.

## Evidence

```text
POST   /v1/properties/:propertyId/evidence
         Headers: Idempotency-Key                     // required
         Content-Type: multipart/form-data
         Body: file + (paymentId | maintenanceTaskId) + type + notes?
         → 201 Evidence

POST   /v1/properties/:propertyId/evidence/upload-url
         Headers and body: the upload-url shape below. Exactly one of
         paymentId and maintenanceTaskId is set.
         → 201, the upload-url shape below
POST   /v1/properties/:propertyId/evidence/:evidenceId/complete   → 200 Evidence

GET    /v1/properties/:propertyId/evidence?paymentId=&maintenanceTaskId=
         → 200 { items: Evidence[] }
GET    /v1/properties/:propertyId/evidence/:evidenceId            → 200 | 404
GET    /v1/properties/:propertyId/evidence/:evidenceId/content-url
         → 200 { url, expiresAt }                     // short-lived GET, never permanent
DELETE /v1/properties/:propertyId/evidence/:evidenceId            → 204
```

Evidence is optional on a payment. Content types allowed: `image/jpeg`, `image/png`, `application/pdf`. Maximum size about 15 MB (15,728,640 bytes). Exactly one parent: a payment or a maintenance task.

This is the only upload-url request and response shape. `docs/TRUST.md` uses this same JSON.

```json
{
  "request": {
    "headers": {
      "Idempotency-Key": "<string, required>"
    },
    "body": {
      "paymentId": "<uuid or null>",
      "maintenanceTaskId": "<uuid or null>",
      "type": "photo | screenshot | pdf",
      "notes": "<string or null>",
      "contentType": "image/jpeg | image/png | application/pdf",
      "byteSize": 1048576,
      "originalFilename": "<string or null>"
    }
  },
  "response": {
    "status": 201,
    "body": {
      "evidence": {
        "id": "<uuid>",
        "propertyId": "<uuid>",
        "paymentId": "<uuid or null>",
        "maintenanceTaskId": "<uuid or null>",
        "storageKey": "properties/<propertyId>/evidence/<evidenceId>/<uuid>",
        "type": "photo | screenshot | pdf",
        "contentType": "image/jpeg | image/png | application/pdf",
        "byteSize": 1048576,
        "originalFilename": "<string or null>",
        "notes": "<string or null>"
      },
      "uploadUrl": "<absolute https URL, short-lived PUT>",
      "expiresAt": "<ISO-8601>"
    }
  }
}
```

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

OCR is off unless `OCR_STUB_ENABLED` is exactly `1`, `true`, `yes`, or `on` (any case, surrounding space ignored). A missing, empty, or any other value is off, in every environment. While it is off, every OCR route returns **501** before path or body parsing.

When the flag is on, the gates run in this order:

1. A missing, invalid, or expired access token is **401**. The default verifier rejects every token. This API never mints one.
2. An unknown property, an unknown document, a missing membership, or another account is **404**. A viewer may read a job and receives **403** on enqueue and confirm.
3. Path ids that are not UUIDs, and traversal in the path, are **400**. `targetEntityId` must be a UUID for the suggestion's entity type in the same property, or the response is **404**. `document_meta` cannot be retargeted off the job's own document.
4. `editedValue` is checked against `fieldPath`. Amounts are canonical peso strings (`19000.00` or `1234`), dates are ISO `YYYY-MM-DD`, and text is NFC. A type mismatch, an unknown `fieldPath`, or a prototype key is **400**.

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

Path ids are UUIDs. A non-UUID id on any matched route is **400**. The in-memory map has a cap (`OCR_JOBS_MAX`, default 50) and a TTL (`OCR_JOB_TTL_MS`, default 15 minutes). Expired jobs can be dropped. An unexpired suggested job is never evicted; a full map returns **429**. Confirming an expired job returns **410**. Confirming a job that is not `suggested`, including a second confirm, returns **409**.

Job statuses: `pending` → `processing` → `suggested` → `confirmed` | `rejected` | `failed`.
Suggestion apply statuses: `pending` → `accepted` | `rejected`.

**Confirm is the only route that applies a suggestion.** A job reaching `suggested` writes nothing to an obligation, a payment, a property, or a document. If every decision is a reject, the job ends `rejected` and no entity field changes. Accepted and edited values are written together; a partial failure returns 409 or 422 rather than applying some of them.

Responses never include `storageKey`, `storage_key`, or a raw bucket path. The stub may build a private key from the validated UUIDs and then leave it off the payload.

What the stub does differently: it finishes the extract synchronously with four fixed suggestions and `vendor: "stub"`, keeps everything in memory, requires a decision for every suggestion, and returns `persisted: false`. There is no model call. Details in [OCR.md](OCR.md).

CORS is an allow-list from `CORS_ORIGINS` (comma-separated origins). The default is no cross-origin access. `*` is ignored and is never reflected.

### Example

```bash
# OCR_STUB_ENABLED=true and a Bearer token are required. Ids are UUIDs.
# Create a job. Returns 201 the first time, 200 while that job is still open.
curl -s -X POST http://localhost:3000/v1/properties/$PROPERTY_ID/documents/$DOCUMENT_ID/ocr-jobs \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Read the job and its pending suggestions. The body has no storageKey.
curl -s http://localhost:3000/v1/properties/$PROPERTY_ID/ocr-jobs/$JOB_ID \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Accept one field, edit another, reject the rest.
# Amounts are canonical peso strings. Dates are ISO dates.
curl -s -X POST http://localhost:3000/v1/properties/$PROPERTY_ID/ocr-jobs/$JOB_ID/confirm \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[
        {"suggestionId":"'$S1'","action":"edit","editedValue":"19000.00","targetEntityId":"'$OBLIGATION_ID'"},
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

Reminder channels: `email`, `push`, `in_app`. The unique key is (parent, `scheduledFor`, `channel`), implemented as two partial unique indexes: `(obligation_id, scheduled_for, channel) WHERE obligation_id IS NOT NULL` and `(maintenance_task_id, scheduled_for, channel) WHERE maintenance_task_id IS NOT NULL`. Delivery idempotency is `(reminder_id, scheduled_for, user_id, channel)` on `notification_deliveries`. Default offsets are `[7, 1]`, plus an in-app-only offset 0 ("Vence hoy") with no push. Generation is an upsert. The fire time is 09:00 in the property timezone, stored as a UTC instant. See [EDGE_CASES.md](EDGE_CASES.md) sections 4 and 5. Audit events are append-only and owner-readable; clients never post them.

## Status codes

| Condition | Status |
| :---- | :---- |
| Missing, invalid, or expired JWT | 401 |
| Non-UUID path id, path traversal, unknown `fieldPath`, or an `editedValue` that does not match its field | 400 |
| Valid JWT, no active membership for `:propertyId`, or the property is unknown or soft-deleted | 404 |
| OCR enqueue or confirm by a viewer | 403 |
| OCR target that is not in the property | 404 |
| OCR job past its TTL | 410 |
| OCR job map is full of unexpired jobs | 429 |
| OCR flag off, or any other scaffold placeholder | 501 |
| Active membership, role too low | 403 |
| Soft-deleted child resource under a property the caller belongs to | 404 |
| Missing `Idempotency-Key` on a payment create, a payment void, or an evidence create | 400 |
| Same idempotency key, different body | 409 |
| Replay with the same key and body | 200 |
| Void of an already-voided payment, N/A conflict, archive read-only, or invite of an active member | 409 |
| Expired, revoked, or used invite token | 410 |
| Amount, currency, `paidAt`, `dueDay`, or `voidReason` rejected | 422 |

## Idempotency

Required on `POST .../payments`, `POST .../payments/:paymentId/void`, `POST .../evidence`, and `POST .../evidence/upload-url`. Create uniqueness for a payment or an evidence row is `(property_id, idempotency_key)` on that table. Void uniqueness is `(property_id, route_key, idempotency_key)` on `idempotency_records`, with route key `POST /payments/:id/void`. First call creates and returns 201 for a create, or 200 for a void. A replay with the same body returns 200 and the original response, including the original `warnings` array, and does not run the duplicate check again. The same key with a different body is a 409. Use a UUID or another high-entropy string.

## Role matrix

| Action | owner | member | viewer |
| :---- | :---- | :---- | :---- |
| Read the property and its lists | yes | yes | yes |
| Create or update an obligation, payment, task, or document | yes | yes | no |
| Void a payment | yes | yes | 404, never 403 |
| Pause, resume, archive, unarchive, or mark N/A | yes | yes | no |
| Invite, resend, or revoke an invite | yes | no | no |
| Upload evidence | yes | yes | no |
| Trigger OCR, confirm suggestions | yes | yes | 403 |
| Read OCR jobs and suggestions | yes | yes | yes |
| Manage memberships | yes | no | no |
| Soft-delete the property | yes | no | no |

Product may cut `member`, leaving owner and viewer. If that happens, every write maps to owner.
