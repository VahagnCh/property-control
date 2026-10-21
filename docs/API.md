# API

The v0 HTTP contract, and what the scaffold in `apps/api` actually does today. Source: [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit). Payment, period, reminder, timezone, and invite behavior for the public product, [DueRecord](EDGE_CASES.md), overrides this contract where they disagree.

The Nest stub maps **57** routes, counting each method and path Nest registers, including `GET /health`.

## Base

- Routes are under `/v1`. `GET /health` is the one route outside the prefix.
- Property-scoped routes will require `Authorization: Bearer <access_jwt>`. Trust mints that token; this API only validates it.
- JSON in, JSON out. Money amounts (`amount`, `expectedAmount`, `overpaidAmount`) are decimal strings such as `"1234.50"` plus a currency code. They are never JSON numbers and never floats. The database stores the same amounts as integer centavos. `"18450.00"` with currency `MXN` is stored as `1845000` centavos.
- Currency is `MXN` only. Any other currency returns 422.

## What the stub does

| Behavior | Routes |
| :---- | :---- |
| Real response | `GET /health`. OCR routes answer in memory only when `OCR_STUB_ENABLED` is `1`, `true`, `yes`, or `on` |
| `{ items: [], stub: true, module }` | Collection reads: properties, memberships, invites, obligations, period outcomes, payments, evidence, maintenance tasks, documents, reminders, audit events, home action items |
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

Adding a person is an email invite, not an immediate membership. Only an owner can invite, by email, as `member` or `viewer`. The raw `token` is returned once. The row stores `tokenHash` (lowercase hex SHA-256) and does not store the raw token. Tokens are single-use. `expiresAt = sentAt + 7 days`, and a resend restarts those 7 days by revoking the previous token and issuing a new one. Acceptance requires the invited email.

Accept checks run in this order, and the first match is the response. An earlier check does not reveal token state:

1. An unknown token, or acceptance from the wrong account, returns 404.
2. A used, revoked, superseded-by-resend, or expired token returns 410.
3. An invitee who is already a member returns 409.

A non-owner invite action (create, resend, or revoke) returns 403. A caller with no membership, and an unknown property, returns 404. Role `owner`, a blank email, or a missing role returns 422. See [EDGE_CASES.md](EDGE_CASES.md) section 8.

Every Property response includes `timezone`, an IANA string. The response type is `PropertyResponse` and the write body is `PropertyWriteDto` in `apps/api/src/properties/property.response.ts`. Omitted on create, `timezone` is `America/Mexico_City`. A name that is not in the tz database returns 422. The field is present on `POST` 201, `GET` one, `PATCH`, and each item of `GET /v1/properties`. Overdue and Home ranking use each property's timezone for "today". The one-year `paidAt` back-date limit is checked in that timezone, not in UTC.

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
                                              // expectedAmount is a decimal string such as "1234.50"
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

`nextDueDate` has two layers. The API accepts a property-timezone calendar date from today minus one year through today plus five years, inclusive. February 29 clamps when the target year is not a leap year. Outside that window the response is 422 with error `next_due_date_out_of_range`. The default timezone is `America/Mexico_City`. The database CHECK, and a defensive check, also reject a date before `1990-01-01` or after `2100-12-31`.

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

There is no `DELETE` for a payment. A correction is the void route. It sets `voidedAt`, `voidedBy`, and `voidReason`. A second void returns 409 and changes nothing. A void cannot be undone. The same Idempotency-Key returns the original void response. A viewer receives 403. A caller with no membership, including when the payment id is unknown, receives 404.

This records a payment the person already made somewhere else. The API does not charge a card, debit an account, or hold a balance. `method` and `reference` are descriptive text — "SPEI", a folio — not instructions to a payment processor.

`amount` is a decimal string such as `"1234.50"` plus currency `MXN`. It is never a float. The database stores integer centavos, and the stored amount must be greater than 0. The wire type is `WireMoney` in `apps/api/src/payments/wire-money.ts`. The client date picker caps `paidAt` at today in the property timezone. The server allows one calendar day of clock skew after the server instant in that timezone, at the same local time of day, and returns 422 past that bound. The lower bound is the existing one-year back-date in the property timezone, not UTC. A non-voided payment with the same obligation, the same amount, and a property-timezone date within 3 days adds a `possible_duplicate` warning and still returns 201. Voided payments, different amounts, and idempotency replays do not run that check again. A viewer write, such as void, returns 403. A non-member, and an unknown payment, returns 404.

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
        "fileId": "<uuid>",
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

1. A missing, invalid, or expired access token is **401**, before path checks and before the JSON body is read. A non-UUID path or an oversized body with no token is still **401**. The default verifier rejects every token. This API never mints one.
2. Path ids that are not UUIDs, and traversal in the path, are **400**. Malformed JSON is **400**. A body over 32kb is **413**.
3. An unknown property, an unknown document, a missing membership, or another account is **404**. A viewer may read a job and receives **403** on enqueue and confirm.
4. `targetEntityId` must be a UUID for the suggestion's entity type in the same property. An unbound accept, replace, or edit with no target is **422**. A non-UUID target is **400**. A missing, wrong-type, foreign, forged, or soft-deleted target is **404**. A voided payment target is **422**. Confirm does not create an entity. An already-bound target is immutable: retargeting it is **422** when the new id is in the same property, and **404** when that id is foreign or forged. `editedValue`, and an accepted suggested value, are checked against `fieldPath`. Amounts are canonical peso strings (`19000.00` or `1234`), dates are ISO `YYYY-MM-DD`, and text is NFC. A bad value is **422**, and that body includes `suggestionId` and `field`. An unknown `fieldPath` or a prototype key is **400**. Text rejects C0 and C1 controls, bidi overrides, and zero-width characters instead of stripping them. A title longer than 300 characters is **422**. The JSON body limit is 32 KB.

`OCR_JOBS_MAX` (default 50) is the cap for one property. `OCR_JOBS_GLOBAL_MAX` (default 1000) is the ceiling across properties. Either limit returns **429** and does not evict an unexpired suggested job. A suggested job with no suggestions does not take a slot.

```text
POST /v1/properties/:propertyId/documents/:documentId/ocr-jobs
       → 201 OcrJob          // 200 with the existing job if one is still open
GET  /v1/properties/:propertyId/documents/:documentId/ocr-jobs
       → 200 { items: OcrJob[] }                      // newest first
GET  /v1/properties/:propertyId/ocr-jobs/:ocrJobId
       → 200 { job, suggestions }
POST /v1/properties/:propertyId/ocr-jobs/:ocrJobId/confirm
       Body: { decisions: [{ suggestionId, action: accept|reject|edit|replace, editedValue?, targetEntityId? }] }
       → 200 { job, suggestions, applied, audits, persisted }
```

Path ids are UUIDs. A non-UUID id on any matched route is **400**. The in-memory map has a cap (`OCR_JOBS_MAX`, default 50) and a TTL (`OCR_JOB_TTL_MS`, default 15 minutes). Expired jobs can be dropped. An unexpired suggested job is never evicted; a full map returns **429**. Confirming an expired job returns **410**. Confirming a job that is not `suggested`, including a second confirm, returns **409**.

Confirm requires one decision for every suggestion. The body is exactly `{ decisions: [{ suggestionId, action: accept|reject|edit|replace, editedValue?, targetEntityId? }] }`. A missing decision is **422** `missing_decision` and the body names that `suggestionId`.

Each suggestion carries `band`: `alta` at or above the configured alta cutoff, `media` from the media cutoff up to alta, and `revisa` below the media cutoff. The defaults are 0.90 and 0.80, read from `OCR_CONFIDENCE_ALTA` and `OCR_CONFIDENCE_MEDIA`. A low-confidence flag forces `revisa` whatever the score, including an ambiguous amount such as `1,234`. A score above 1, below 0, NaN, or non-numeric is also `revisa`. The job returns the configured `confidenceBands`.

`accept` and `edit` of a saved non-null field return **409** `field_already_set` and do not mark the suggestion accepted. `replace` is the only overwrite, and it writes the replace audit. `reject` leaves the value. There is no silent prefill. Confirm validates every decision, then writes the accepted set together. If one write fails, the earlier writes in that confirm are restored and no suggestion changes status. `persisted` is true only when those writes commit. A body with `acceptAll: true`, or a decision whose action is `accept-all`, returns **422** `bulk_accept_rejected`. `clientPriorValue` on the body or on a decision returns **422** `client_prior_value_rejected`. The API does not accept or store unsaved typed text.

Every OCR 4xx body includes a stable `error` string next to `message`. Clients match `error`, never the English text. A 404 is always `not_found` with message `Not found.`, whether the missing id is a job, a suggestion, a property, a document, a membership, or a target. That keeps the response from revealing which id was unknown.

| `error` | Status | When | Extra fields |
| :---- | :---- | :---- | :---- |
| `token_missing` | 401 | No `Authorization: Bearer` token | |
| `token_invalid` | 401 | Token is present and not accepted | |
| `token_expired` | 401 | Verifier reports the token expired | |
| `invalid_path` | 400 | Path id is not a UUID, or the path contains traversal | |
| `invalid_json` | 400 | JSON body does not parse | |
| `payload_too_large` | 413 | JSON body is over 32 KB | |
| `not_found` | 404 | Unknown job, suggestion, property, document, membership, or target. One code for every 404 | |
| `forbidden` | 403 | Viewer enqueue or confirm | |
| `ocr_disabled` | 501 | `OCR_STUB_ENABLED` is off. Body also has `module: "ocr"` | |
| `ocr_capacity` | 429 | Property or global job cap is full | |
| `job_expired` | 410 | Confirm or read of a job past its TTL | |
| `job_not_confirmable` | 409 | Job is not `suggested`, including a second confirm | |
| `decisions_invalid` | 400 | Body is not an object, `decisions` is missing or empty, or the payload is too deep | |
| `unknown_field` | 400 | Unknown key, or `__proto__` / `constructor` / `prototype` | |
| `suggestion_invalid` | 400 | A decision is not an object, or `suggestionId` is not a UUID | |
| `duplicate_decision` | 400 | The same `suggestionId` is listed twice | |
| `action_invalid` | 400 | `action` is not `accept`, `reject`, `edit`, or `replace` | |
| `edited_value_required` | 400 | `edit` without `editedValue` | |
| `target_invalid` | 400 | `targetEntityId` is not a UUID | |
| `field_path_unknown` | 400 | Suggestion `fieldPath` is not a known field | |
| `invalid_storage_key` | 400 | Storage key inputs are not UUIDs. Not returned on a normal confirm | |
| `missing_decision` | 422 | A suggestion has no decision | `suggestionId` |
| `client_prior_value_rejected` | 422 | `clientPriorValue` on the body or on a decision | |
| `bulk_accept_rejected` | 422 | `acceptAll`, `accept_all`, or action `accept-all` / `accept_all` | |
| `edited_value_invalid` | 422 | `editedValue` or an accepted suggestion does not match `fieldPath` | `suggestionId`, `field` |
| `next_due_date_out_of_range` | 422 | `nextDueDate` is outside the property-timezone window or the 1990–2100 bound | `suggestionId`, `field` |
| `bound_target_immutable` | 422 | Same-property retarget of an already-bound suggestion | |
| `target_required` | 422 | Unbound accept, edit, or replace with no target | |
| `target_voided` | 422 | Payment target status is `voided` | |
| `target_status_unknown` | 422 | Payment target has no status check, or a status other than `recorded` or `voided` | |
| `field_already_set` | 409 | Accept or edit of a saved non-null value | `suggestionId`, `field` |

Single-line text rejects every C0 character, including tab, CR, and LF. A title that contains LF or CR is 422. The `notes` field is the multi-line exception: it allows LF, and CR or CRLF is stored as LF before the 2000-character limit is applied. A notes value that is only CR becomes a line feed and is 422 because it is whitespace. C1, bidi overrides, zero-width characters, and a tab in notes are still rejected. An invalid property `timezone` is **422** on write. A stored invalid timezone falls back to `America/Mexico_City` and does not raise 500.

When the field is already saved, the replace audit is `{ suggestionId, field, action: "replace", actorUserId, previousValue, newValue }`. `previousValue` is the persisted server value. Before the record is saved, the audit is `{ suggestionId, field, decision: "replaced", suggestedValue }` and has no previous value. On payment create, that field's audit source is `ocr_replace` with the `suggestionId`.

Job statuses: `pending` → `processing` → `suggested` → `confirmed` | `rejected` | `failed`.
Suggestion apply statuses: `pending` → `accepted` | `rejected`.

**Confirm is the only route that applies a suggestion.** A job reaching `suggested` writes nothing to an obligation, a payment, a property, or a document. If every decision is a reject, the job ends `rejected` and no entity field changes. Accepted and edited values are written together; a partial failure returns 409 or 422 rather than applying some of them.

Responses never include `storageKey`, `storage_key`, or a raw bucket path. The stub may build a private key from the validated UUIDs and then leave it off the payload.

What the stub does differently: it finishes the extract synchronously with four fixed suggestions and `vendor: "stub"`, keeps the job in memory, and requires one decision per suggestion. `persisted` is true only when the confirm's saves commit. There is no model call. Details in [OCR.md](OCR.md).

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
| Non-UUID path id, path traversal, or unknown `fieldPath` | 400 |
| Bad `editedValue` (`edited_value_invalid`, body includes `suggestionId` and `field`), date window (`next_due_date_out_of_range`), missing decision (`missing_decision`, body includes `suggestionId`), same-property retarget (`bound_target_immutable`), unbound target (`target_required`), voided payment (`target_voided`), unchecked payment (`target_status_unknown`), `clientPriorValue` (`client_prior_value_rejected`), bulk accept-all (`bulk_accept_rejected`), or invalid property timezone on write (`invalid_timezone`) | 422 |
| Accept or edit of a field that already has a saved value | 409 `field_already_set` |
| Valid JWT, no active membership for `:propertyId`, or the property is unknown or soft-deleted | 404 |
| Viewer write, such as void, OCR enqueue, or OCR confirm | 403 |
| Unknown invite token, or accept from the wrong account | 404 |
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
| Used, revoked, superseded-by-resend, or expired invite token | 410 |
| Amount, currency, `paidAt`, `dueDay`, or `voidReason` rejected | 422 |

## Idempotency

Required on `POST .../payments`, `POST .../payments/:paymentId/void`, `POST .../evidence`, and `POST .../evidence/upload-url`. Create uniqueness for a payment or an evidence row is `(property_id, idempotency_key)` on that table. Void uniqueness is `(property_id, route_key, idempotency_key)` on `idempotency_records`, with route key `POST /payments/:id/void`. First call creates and returns 201 for a create, or 200 for a void. A replay with the same body returns 200 and the original response, including the original `warnings` array, and does not run the duplicate check again. The same key with a different body is a 409. Use a UUID or another high-entropy string.

## Role matrix

| Action | owner | member | viewer |
| :---- | :---- | :---- | :---- |
| Read the property and its lists | yes | yes | yes |
| Create or update an obligation, payment, task, or document | yes | yes | 403 |
| Void a payment | yes | yes | 403 |
| Pause, resume, archive, unarchive, or mark N/A | yes | yes | 403 |
| Invite, resend, or revoke an invite | yes | 403 | 403 |
| Upload evidence | yes | yes | 403 |
| Trigger OCR, confirm suggestions | yes | yes | 403 |
| Read OCR jobs and suggestions | yes | yes | yes |
| Manage memberships | yes | 403 | 403 |
| Soft-delete the property | yes | 403 | 403 |

Product may cut `member`, leaving owner and viewer. If that happens, every write maps to owner.
