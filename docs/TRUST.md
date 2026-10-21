# Trust

Authentication, authorization, private files, retention, and OCR privacy. Aligned to Trust MVP architecture v0.1 and [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit). The Trust architecture draft is [here](https://docs.google.com/document/d/1zbIoIroBNVOhfsX48RmP2Gac2ggZnjbsJBWgxxo6F9E/edit). Reminder keys, quiet hours, and invites follow [EDGE_CASES.md](EDGE_CASES.md) where that spec is more specific. The public product name in that spec is DueRecord.

Most of this is specified and not implemented. The placeholder guard in `apps/api/src/auth/access-token.guard.ts` throws on every request so it can never accidentally pass traffic; it is not attached to routes, which is why the stub routes are reachable.

## Sessions and tokens

| Concern | Owner |
| :---- | :---- |
| Mint access and rotating refresh tokens | **Trust** |
| Validate the Bearer access JWT: signature, `exp`, `iss`, `aud`, `sub` | **This API** |
| Enforce `PropertyMembership` | **This API** |
| Token lifetime | Access 15–30 minutes, configured by Trust |

The API never mints or refreshes a token. It fetches JWKS from Trust and validates. There is no password, password hash, or session secret in this repository, and `users` holds only `trust_sub` plus denormalized display fields.

## The guard

```ts
interface GuardInputs {
  authorizationHeader: string;      // "Bearer <access_jwt>"
  propertyId?: string;              // from the :propertyId route param
  requiredRoles?: MembershipRole[]; // default: any active membership
  action?: string;                  // e.g. 'payment.create', for audit
}
```

`decideAccess` in `apps/api/src/auth/access-order.ts` is the order below. It is not attached to controllers. Live OCR still checks the token, then the path and body, then membership, and a viewer write there still says `Insufficient role.`

Resolution order:

1. A stubbed route is **501** before the token is read. A missing token on a stub is still 501.
2. Verify the access JWT against Trust's JWKS. A missing, invalid, or expired token is **401**.
3. A bad request is **400**. A payload over the limit is **413**. Those beat membership and consent.
4. Resolve the local `User` by `trust_sub = jwt.sub`. Upsert on first sight is fine. Load the membership where `property_id = :propertyId AND user_id = :userId AND status = 'active' AND deleted_at IS NULL`, and the property is not soft-deleted. No membership, or a missing or soft-deleted property, is **404** `not_found`, even when that caller also lacks consent. The API does not reveal which properties exist.
5. A viewer write is **403** `viewer`. A viewer without consent who writes is `viewer`, not `consent_required`.
6. A write without the current consent is **403** `consent_required`. Reads skip steps 5 and 6. A non-member read is still 404.

`POST /v1/properties` has no membership check. While it is stubbed the response is 501. When it is live the order is 401, then 400 or 413, then 403 `consent_required`. `POST /v1/invites/accept` stays on the invite checks in [EDGE_CASES.md](EDGE_CASES.md) section 8 after the token: an unknown token, or acceptance from the wrong account, is 404 before any used, revoked, superseded, or expired state is revealed.

TODO: Retirar consentimiento leads into account deletion before public launch. Withdrawal is not implemented.

Refresh rows, user-scoped idempotency keys, and auth-code rate limits are stored in Postgres and have no HTTP routes yet. Refresh reuse is one transaction (`UPDATE ... WHERE used_at IS NULL RETURNING` plus the successor insert). A second use within 30 seconds returns the same rotated pair, unless that successor has already been used. The column stores AES-256-GCM ciphertext of the successor, never the raw token, and the ciphertext is cleared when the window ends. Later reuse revokes the family. An expired or revoked token does not. The sliding lifetime is 30 days and the absolute cap is 90 days, copied and never extended. There is no Redis. Auth-code subjects are a keyed HMAC, never the plain email. The membership role stays `member`.

## 403 against 404

| Condition | Status |
| :---- | :---- |
| Missing, invalid, or expired JWT | 401 |
| Valid JWT, no active membership, or the property is unknown or soft-deleted | **404** |
| Active membership, role too low, including a viewer void | 403 |
| Soft-deleted child resource under a property the caller belongs to | 404 |

Returning 403 for a property the caller cannot see would confirm that it exists. 404 does not.

## Property boundary

Every list is membership-scoped. `GET /v1/properties` returns only properties the caller is an active member of. Nested lists require a membership on the `:propertyId` in the path and never return a row from another property. There is no administrative or global list in the MVP.

Roles are `owner`, `member`, and `viewer`; the matrix is in [API.md](API.md#role-matrix). Product may cut `member`.

## Private object storage

No public ACL, no permanent public URL, no CDN-public bucket. The database stores a private `source_key` and metadata, never bytes. The column is never named `storage_key` and is never returned.

Key conventions:

```text
{env}/evidence/{uuid}
{env}/documents/{uuid}
```

`env` is `staging` or `prod`, from `OBJECT_STORAGE_ENV`. The key has no property id, user id, name, or filename. The property id stays on the database row.

Content-type allowlist: `image/jpeg`, `image/png`, `application/pdf`. Maximum size is 10 MiB, exactly 10,485,760 bytes (`MAX_EVIDENCE_BYTES`). The same cap applies to documents.

Upload, in either of two accepted shapes:

- **Proxied multipart.** The client posts the file to the API, which validates the JWT, the membership, the write role, the content type, and the size, then streams the object to the private bucket, inserts the row, and appends an audit event.
- **Pre-signed PUT.** The client asks for an upload URL. The API runs the same checks, builds the private source key, gets a short-lived PUT URL, and returns the upload-url shape below. The signed PUT headers include `Cache-Control: no-store`. That signing lands with the evidence upload route; this version does not sign it yet. The client PUTs the bytes and then calls the complete route, where the API verifies the object and marks it ready. This is the only upload-url request and response shape. Document uploads in this version are proxied multipart, not a second shape.

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

Read: the client calls the `content-url` route, the API checks the JWT and the membership and that the row is not soft-deleted, and issues a short-lived signed GET URL, 60 to 300 seconds. A permanent or public URL is never returned. The grant may be audited.

In this scaffold both `content-url` routes return 501, so no object URL can be produced at all.

Who owns what: the API owns authorization, metadata, key generation, the allowlist, size enforcement, audit, and idempotency. Trust owns access and refresh tokens. Storage owns the bytes and verifies the signatures. Whether the API or Trust signs object URLs is an open question; either way authorization happens before signing.

## Audit

Append-only `audit_events` for sensitive changes: membership changes, obligation and payment mutations, soft and hard deletes, OCR confirmations, and optionally signed-URL grants. Rows carry the actor, the action, the entity, and before and after JSON. Audit rows are never deleted in the MVP.

The audit trail matters more than usual here because some actions have no undo. Marking a period not applicable is one of them. Voiding a payment is another: the row stays, the evidence stays, and the fix is a new payment.

## Retention

| Phase | Behavior |
| :---- | :---- |
| Soft delete | `deleted_at = now()`, excluded from default queries, treated as absent by membership checks. Payments have no `deleted_at`. A void is not a soft delete and the retention job does not remove the payment or its evidence. |
| Hard delete | A daily job removes rows whose `deleted_at` is older than 30 days |
| Storage | A hard delete of evidence or a document deletes the object at `source_key` |
| Audit | Both deletes append an audit event |

Users do not get a hard-delete control in the MVP. The retention job is the only path.

## OCR privacy

- The raw file and any OCR artifact stay in private storage. Access needs a valid JWT and an active membership, same as any other file.
- The job may build a private source key `{env}/documents/{uuid}`, never a URL and never a property id. That key, and any object path, is not returned on any OCR or upload response, including errors. An opaque `fileId` from `crypto.randomUUID` is allowed. It is not derived from the source key or the path. It resolves only through a property-scoped route behind the membership guard, and a foreign id is 404. Tests walk those bodies for `storageKey`, `storage_key`, and a raw bucket path, and they do not treat an id as a leak.
- The vendor identifier is opaque. The vendor never writes an obligation or a payment row; it returns suggestions and the API persists them as suggestions.
- Extracted values live in `ocr_suggestions.suggested_value`. Until someone confirms, they are proposals attached to the job, not fields on a property's records.
- Retention for OCR artifacts follows the policy above.
- A confirmation appends an audit event naming the applied fields.

## No payment custody

There is no bank connection, no payment instrument, no card token, no account or routing number, no clearing state, and no balance anywhere in this system. `overpaidAmount` is the excess recorded on one period so the client can show "Pagado de más". It is not spent and it is not carried into the next period. `payments.method` and `obligations.preferred_method` are descriptive strings a person typed, not instructions to a processor. This removes a whole category of obligation — PCI scope, money transmission, chargebacks — from the MVP. See [ADR 0001](adr/0001-tracking-not-money-movement.md).

## Quiet hours and delivery idempotency

Quiet hours are 21:00–08:00 in the recipient device timezone: a device-local time at or after 21:00, or before 08:00, is quiet. A reminder that lands there is deferred to the next 09:00 in that device timezone. At most 3 push deliveries go to one user on one device-local day. Email and in-app do not count toward the cap.

`notification_deliveries` is unique on `(reminder_id, scheduled_for, user_id, channel)`. Reminder rows themselves are unique on (parent, `scheduled_for`, `channel`) by the two partial indexes in [DATA-MODEL.md](DATA-MODEL.md). That replaces a unique key of `(id, scheduled_for)`, which a primary key already makes vacuous.

## Invites

Only an owner invites, by email, as `member` or `viewer`. The API stores a single-use token hash that expires 7 days after `sentAt`. A resend restarts those 7 days. Accepting requires the invited email. An unknown token or the wrong account is 404 first; a used, revoked, superseded, or expired token is 410; an invitee who is already a member is 409; a non-owner invite action is 403. This API owns the invite row and the accept route. Trust still mints the session the invitee uses to sign in. The behavior is [EDGE_CASES.md](EDGE_CASES.md) section 8.

## Open questions

1. Roles: keep `owner | member | viewer` or cut to `owner | viewer`?
2. Does the API sign storage URLs directly, or call a Trust signing RPC after authorizing?
3. Does Trust own the OCR worker and call the API with results, or does the API call an OCR RPC after creating the job?
4. Who sends push and email, and who owns retries? The edge spec fixes the row keys, the 09:00 property-local fire time, quiet hours, the push cap, and that offset 0 is in-app only.
