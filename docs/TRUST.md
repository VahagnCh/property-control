# Trust

Authentication, authorization, private files, retention, and OCR privacy. Aligned to Trust MVP architecture v0.1 and [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit). The Trust architecture draft is [here](https://docs.google.com/document/d/1zbIoIroBNVOhfsX48RmP2Gac2ggZnjbsJBWgxxo6F9E/edit).

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

Resolution order:

1. Verify the access JWT against Trust's JWKS. Failure is **401**.
2. Resolve the local `User` by `trust_sub = jwt.sub`. Upsert on first sight is fine.
3. If the route is not property-scoped (`GET /v1/me`, `POST /v1/properties`), stop here.
4. Otherwise load the membership where `property_id = :propertyId AND user_id = :userId AND status = 'active' AND deleted_at IS NULL`, and the property is not soft-deleted.
5. No membership, or a missing or soft-deleted property, is **404** — not 403. The API does not reveal which properties exist.
6. A membership whose role is not in `requiredRoles` is **403**.
7. Attach `{ user, membership, propertyId }` to the request for the handler.

## 403 against 404

| Condition | Status |
| :---- | :---- |
| Missing, invalid, or expired JWT | 401 |
| Valid JWT, no active membership, or the property is unknown or soft-deleted | **404** |
| Active membership, role too low | 403 |
| Soft-deleted child resource under a property the caller belongs to | 404 |

Returning 403 for a property the caller cannot see would confirm that it exists. 404 does not.

## Property boundary

Every list is membership-scoped. `GET /v1/properties` returns only properties the caller is an active member of. Nested lists require a membership on the `:propertyId` in the path and never return a row from another property. There is no administrative or global list in the MVP.

Roles are `owner`, `member`, and `viewer`; the matrix is in [API.md](API.md#role-matrix). Product may cut `member`.

## Private object storage

No public ACL, no permanent public URL, no CDN-public bucket. The database stores a `storage_key` and metadata, never bytes.

Key conventions:

```text
properties/{propertyId}/evidence/{evidenceId}/{uuid}
properties/{propertyId}/documents/{documentId}/{uuid}
```

Content-type allowlist: `image/jpeg`, `image/png`, `application/pdf`. Maximum size about 15 MB (15,728,640 bytes).

Upload, in either of two accepted shapes:

- **Proxied multipart.** The client posts the file to the API, which validates the JWT, the membership, the write role, the content type, and the size, then streams the object to the private bucket, inserts the row, and appends an audit event.
- **Pre-signed PUT.** The client asks for an upload URL. The API runs the same checks, builds the `storage_key`, gets a short-lived PUT URL, and returns `{ evidenceId, storageKey, uploadUrl, expiresAt }`. The client PUTs the bytes and then optionally calls the complete route, where the API verifies the object and marks it ready.

Read: the client calls the `content-url` route, the API checks the JWT and the membership and that the row is not soft-deleted, and issues a short-lived signed GET URL, 60 to 300 seconds. A permanent or public URL is never returned. The grant may be audited.

In this scaffold both `content-url` routes return 501, so no object URL can be produced at all.

Who owns what: the API owns authorization, metadata, key generation, the allowlist, size enforcement, audit, and idempotency. Trust owns access and refresh tokens. Storage owns the bytes and verifies the signatures. Whether the API or Trust signs object URLs is an open question; either way authorization happens before signing.

## Audit

Append-only `audit_events` for sensitive changes: membership changes, obligation and payment mutations, soft and hard deletes, OCR confirmations, and optionally signed-URL grants. Rows carry the actor, the action, the entity, and before and after JSON. Audit rows are never deleted in the MVP.

The audit trail matters more than usual here because some actions have no undo. Marking a period not applicable is one of them.

## Retention

| Phase | Behavior |
| :---- | :---- |
| Soft delete | `deleted_at = now()`, excluded from default queries, treated as absent by membership checks |
| Hard delete | A daily job removes rows whose `deleted_at` is older than 30 days |
| Storage | A hard delete of evidence or a document deletes the object at `storage_key` |
| Audit | Both deletes append an audit event |

Users do not get a hard-delete control in the MVP. The retention job is the only path.

## OCR privacy

- The raw file and any OCR artifact stay in private storage. Access needs a valid JWT and an active membership, same as any other file.
- The job stores the private `storage_key`, never a URL. The in-memory stub builds a key like `properties/{propertyId}/documents/{documentId}/ocr-stub` and the tests assert it is not a URL.
- The vendor identifier is opaque. The vendor never writes an obligation or a payment row; it returns suggestions and the API persists them as suggestions.
- Extracted values live in `ocr_suggestions.suggested_value`. Until someone confirms, they are proposals attached to the job, not fields on a property's records.
- Retention for OCR artifacts follows the policy above.
- A confirmation appends an audit event naming the applied fields.

## No payment custody

There is no bank connection, no payment instrument, no card token, no account or routing number, no clearing state, and no balance anywhere in this system. `payments.method` and `obligations.preferred_method` are descriptive strings a person typed, not instructions to a processor. This removes a whole category of obligation — PCI scope, money transmission, chargebacks — from the MVP. See [ADR 0001](adr/0001-tracking-not-money-movement.md).

## Open questions

1. Roles: keep `owner | member | viewer` or cut to `owner | viewer`?
2. Does the API sign storage URLs directly, or call a Trust signing RPC after authorizing?
3. Does Trust own the OCR worker and call the API with results, or does the API call an OCR RPC after creating the job?
4. Reminder delivery: in-app only for the MVP, or email through a notification service? Who owns retries?
5. Membership invites: an email invite and accept flow in Trust, or add-by-subject with immediate active status?
