import { describe, it } from "vitest";

// Each title is the id and sentence from docs/EDGE_CASES.md.
// The cases stay todo until the behavior is implemented.
describe("DueRecord edge-case rules", () => {
  it.todo("EC-1.1 There is no DELETE route for a payment, and the Payment model has no deletedAt column.");

  it.todo("EC-1.2 A correction is a void through POST /v1/properties/:propertyId/payments/:paymentId/void, which sets voidedAt, voidedBy, and voidReason. voidReason is required, and its trimmed length must be from 1 to 500 characters. Missing, blank, or longer text returns 422 and changes nothing.");

  it.todo("EC-1.3 A voided payment remains in the payment list and in the audit log, the client labels its status voided as Anulado, and its Evidence rows stay attached and are not soft-deleted by the void.");

  it.todo("EC-1.4 A voided payment is excluded from the non-voided sum that decides whether the period is partial or paid.");

  it.todo("EC-1.5 Voiding a payment whose status is already voided returns 409 and leaves voidedAt, voidedBy, and voidReason unchanged.");

  it.todo("EC-1.6 A void cannot be undone. No route clears a void, and PATCH cannot set status back to recorded or change voidedAt, voidedBy, or voidReason. The correction for a mistaken void is a new payment.");

  it.todo("EC-1.7 A void recomputes that period from its non-voided sum and then sets nextDueDate to the earliest candidate that is not settled. A sum of 0 deletes the outcome row, and the period then reads as open when its due date is today or later in the property timezone, or overdue when the due date is before today. A sum greater than 0 and below expectedAmount stores outcome partial with overpaidAmount 0. A sum greater than or equal to expectedAmount stores outcome paid with overpaidAmount equal to the sum minus expectedAmount.");

  it.todo("EC-1.8 Void requires write access on that property. A viewer receives 403. A caller with no membership receives 404, including when the payment id is unknown.");

  it.todo("EC-1.9 A void requires an Idempotency-Key header. A missing key returns 400. The same key and the same body return the original response and change nothing further. The same key with a different body returns 409 idempotency_key_reused. A 5xx response is not stored, so the same key and body may be retried. The key is stored on idempotency_records with route key POST /payments/:id/void and does not reuse the payment's create key, so replaying the create key does not void the payment.");

  it.todo("EC-2.1 A payment amount on the wire is a decimal string with at most two fraction digits, such as 1234.50, together with currency MXN, and it is never a JSON number or a float. The database stores that amount as integer centavos greater than 0. An amount of 0 or less, a JSON number, a string that is not that decimal form, an amount above 2147483647 centavos, or any currency other than MXN returns 422. An obligation currency other than MXN also returns 422.");

  it.todo("EC-2.2 When the non-voided sum is greater than 0 and less than expectedAmount, the outcome is partial, overpaidAmount is 0, and nextDueDate does not change.");

  it.todo("EC-2.3 Partial payments on one period add into that period's non-voided sum. When the sum reaches or passes expectedAmount, the outcome becomes paid and nextDueDate moves forward exactly one period.");

  it.todo("EC-2.4 When the non-voided sum is greater than expectedAmount, the outcome is paid, nextDueDate moves forward exactly one period and no further, and overpaidAmount is the sum minus expectedAmount. The next period's expected amount is not reduced by that excess.");

  it.todo("EC-2.5 When expectedAmount is null, a payment with markPartial false or omitted marks the period paid, leaves overpaidAmount at 0, and moves nextDueDate forward one period. markPartial true on that payment marks the period partial and does not move nextDueDate.");

  it.todo("EC-2.6 A create may set periodDueDate to a candidate on or before the earliest unsettled candidate, or to a date that already has an outcome row. The payment changes only that period. Every other period's outcome stays as it was. Omitting periodDueDate uses the earliest unsettled candidate.");

  it.todo("EC-2.7 A payment on a period that is already paid is stored. When expectedAmount is set it increases that period's overpaidAmount by the new amount, and it does not advance nextDueDate by another period.");

  it.todo("EC-2.8 When expectedAmount is set, markPartial true returns 422 and stores nothing.");

  it.todo("EC-3.1 Marcar no aplica sets the current period's outcome to not_applicable with a null payment id, moves nextDueDate forward one period, and leaves isActive true and deletedAt null. There is no undo route. The action appends an audit event.");

  it.todo("EC-3.2 N/A on a period that still has a non-voided payment returns 409 and changes nothing. Voided payments alone do not cause this 409.");

  it.todo("EC-3.3 N/A on a period whose outcome is already paid or not_applicable returns 409 and changes nothing.");

  it.todo("EC-3.4 Pausar sets isActive to false and opens one pause interval whose pausedOn is today in the property timezone and whose lastScheduledDueDate is the current nextDueDate. While isActive is false, the obligation appears in no overdue list, no reminder for it is sent, and no new period outcome is created. A second pause while an interval is still open returns 409 and does not insert another interval.");

  it.todo("EC-3.5 Reanudar requires an open pause interval. It sets isActive to true, sets that interval's resumedOn to today in the property timezone, and sets nextDueDate to the first scheduled due date on or after that today. Dates inside the interval that are after lastScheduledDueDate never receive an outcome row. Resume with no open pause interval returns 409.");

  it.todo("EC-3.6 While an obligation is paused and deletedAt is null, a payment is allowed when its periodDueDate is on or before the open interval's lastScheduledDueDate. A periodDueDate after lastScheduledDueDate returns 422 and stores nothing while that interval is open.");

  it.todo("EC-3.7 Archivar sets deletedAt and also sets isActive to false, opening a pause interval when none is open. Archived obligations are omitted from default lists and send no reminders. Creating a payment or posting N/A while deletedAt is set returns 409. Archivar when deletedAt is already set returns 409.");

  it.todo("EC-3.8 Desarchivar is POST /v1/properties/:propertyId/obligations/:obligationId/unarchive. It clears deletedAt and leaves isActive false. It does not set resumedOn and it does not change nextDueDate. Unarchive when deletedAt is null returns 409.");

  it.todo("EC-3.9 N/A writes only the period outcome and does not change isActive or deletedAt. Pause writes isActive and a pause interval and does not write not_applicable or deletedAt. Archive is the only action that sets deletedAt, and it also pauses. No action other than archive changes another mechanism's column.");

  it.todo("EC-4.1 A reminder has exactly one parent, either an obligation or a maintenance task. Uniqueness is (parent, scheduledFor, channel), enforced by partial unique index reminders_obligation_id_scheduled_for_channel_key on (obligation_id, scheduled_for, channel) WHERE obligation_id IS NOT NULL, and partial unique index reminders_maintenance_task_id_scheduled_for_channel_key on (maintenance_task_id, scheduled_for, channel) WHERE maintenance_task_id IS NOT NULL. A row with both parents or with neither parent is rejected.");

  it.todo("EC-4.2 notification_deliveries is unique on (reminder_id, scheduled_for, user_id, channel). A second delivery insert with that same tuple does not create a second row.");

  it.todo("EC-4.3 Generating reminders upserts on the parent key. Running generation twice for the same obligation inserts no second row for the same parent, scheduledFor, and channel.");

  it.todo("EC-4.4 Duplicate values in reminderOffsets are removed before generation, keeping the first occurrence of each offset. The list [7, 7, 1] produces the same rows as [7, 1].");

  it.todo("EC-4.5 When reminderOffsets is omitted it is stored as [7, 1]. Generation also schedules offset 0. Offset 0 is created only with channel in_app, and it is not created as push or email. Each remaining offset produces one in_app row and one push row. The default generator does not create email rows.");

  it.todo("EC-4.6 Changing reminderOffsets or a due date deletes that obligation's reminders whose status is pending and generates them again. Reminders whose status is sent stay, including their scheduledFor.");

  it.todo("EC-4.7 A reminder whose scheduledFor is at or before the generation instant is not inserted and is never sent later. Offsets whose scheduledFor is still after that instant are still inserted.");

  it.todo("EC-4.8 Pausing, archiving, marking N/A, or settling a period sets pending reminders whose periodDueDate is that period to cancelled. Sent reminders for that period stay sent.");

  it.todo("EC-4.9 The same parent and the same scheduledFor with two different channels are two rows and are allowed. A push row and an email row at that same time both remain stored.");

  it.todo("EC-5.1 Every Property stores an IANA timezone name, and every Property response in the v1 contract includes timezone. The default, when the client omits it, is America/Mexico_City. A value that is not a name in the tz database returns 422. The column stores the name and does not store a numeric offset.");

  it.todo("EC-5.2 A due date is a calendar date with no time of day. The period is not overdue at 23:59:59 in the property timezone on that due date. It becomes overdue at 00:00:00 in the property timezone on the calendar day after the due date.");

  it.todo("EC-5.3 Generated obligation reminders are scheduled at 09:00:00 in the property timezone and stored as UTC instants. A delivery whose instant falls in the recipient device timezone at or after 21:00, or before 08:00, is deferred to the next 09:00 in that device timezone. At most 3 push deliveries are sent to one user on one device-local calendar day. A further push waits until 09:00 on the next device-local day. Email and in_app deliveries do not count toward that cap.");

  it.todo("EC-5.4 The offset-0 reminder uses the copy Vence hoy, uses channel in_app only, and has no push row.");

  it.todo("EC-5.5 America/Mexico_City, America/Tijuana, and America/Cancun are valid timezones and are resolved with the tz database rather than a hardcoded offset. 09:00 on 2026-06-15 in America/Cancun is 2026-06-15T14:00:00.000Z, in America/Mexico_City is 2026-06-15T15:00:00.000Z, and in America/Tijuana is 2026-06-15T16:00:00.000Z.");

  it.todo("EC-5.6 A local time that falls in a spring-forward gap is stored as the next valid instant. A local time that falls in a fall-back overlap is stored as the first occurrence, which is the earlier offset. In America/Tijuana, 02:30 on 2026-03-08 does not exist and is stored as 2026-03-08T10:00:00.000Z. 01:30 on 2026-11-01 is ambiguous and is stored as 2026-11-01T08:30:00.000Z.");

  it.todo("EC-5.7 Across a DST transition, each parent, period, offset, and channel produces one reminder row. That row is not duplicated, and an offset that is still in the future is not dropped because of the transition.");

  it.todo("EC-5.8 Changing a property timezone deletes pending reminders for that property and regenerates them at 09:00 in the new timezone. Reminders whose status is sent stay. nextDueDate and period due dates keep the same calendar dates.");

  it.todo("EC-5.9 Overdue and Home ranking compare a due date with today in that property's timezone. The comparison does not use the device timezone and does not use the server timezone.");

  it.todo("EC-6.1 An obligation whose recurrence is monthly, bimonthly, quarterly, semiannual, or annual stores dueDay as an integer from 1 to 31 and a scheduleAnchor date. A dueDay outside 1 to 31, or a missing dueDay or scheduleAnchor for one of those recurrences, returns 422. The first due date the client sends must equal the clamped period-0 date.");

  it.todo("EC-6.2 When dueDay is greater than the last day of the target month, the due date is that month's last day. For dueDay 31 the non-leap February date is 28 February, the April date is 30 April, and the June date is 30 June.");

  it.todo("EC-6.3 The anchor does not drift. A monthly dueDay of 31 whose anchor month is January is 31 March on the period after February, not 28 March.");

  it.todo("EC-6.4 An annual obligation whose dueDay is 29 and whose anchor month is February falls on 29 February in a leap year, including 2028, and on 28 February in a non-leap year, including 2100.");

  it.todo("EC-6.5 Bimonthly adds 2 months, quarterly adds 3, and semiannual adds 6, and each then uses the same clamp. From an anchor month of January 2026 with dueDay 31, the next bimonthly date is 31 March 2026 and the next quarterly date is 30 April 2026. Custom and irregular do not compute dates from dueDay. When a custom or irregular period becomes paid or not_applicable, nextDueDate is set to null.");

  it.todo("EC-6.6 Each forward move adds one step to the anchor index. It does not add the step to the previous clamped calendar date. The date after a clamped 28 February for monthly dueDay 31 is 31 March, not 28 March.");

  it.todo("EC-6.7 Monthly dueDay 31 with anchor month January 2026 produces 31 January 2026, then 28 February 2026, then 31 March 2026. Monthly dueDay 31 with anchor month January 2028 produces 31 January 2028, then 29 February 2028, then 31 March 2028. Monthly dueDay 31 with anchor month December 2026 produces 31 January 2027 next. Annual dueDay 29 with anchor month February produces 29 February 2028, then 28 February 2029, then 28 February 2100.");

  it.todo("EC-6.8 nextDueDate on input must be a property-timezone calendar date from today minus one calendar year through today plus five calendar years, inclusive. February 29 clamps to the last day of February when the target year is not a leap year. A date outside that window returns 422 with error next_due_date_out_of_range. The database CHECK, and a defensive check in front of it, also reject a date before 1990-01-01 or after 2100-12-31. The default timezone is America/Mexico_City.");

  it.todo("EC-7.1 The record-payment date picker's maximum day is today in the property timezone. The server accepts paidAt up to one calendar day after the server instant in that timezone, at the same local time of day, and returns 422 when paidAt is later than that bound. No payment status means a scheduled or planned payment.");

  it.todo("EC-7.2 paidAt earlier than one calendar year before the server instant returns 422. The bound is that instant in the property timezone with the year reduced by one, keeping the month, day, and time of day in that timezone, or the last day of that month at the same time when the day does not exist. The year is not reduced in UTC. A paidAt equal to the bound is accepted.");

  it.todo("EC-7.3 When the same obligation already has a non-voided payment for the same centavo amount whose property-timezone calendar date differs by 0, 1, 2, or 3 days from the new payment's property-timezone calendar date, create still returns 201 and includes warnings. The warning code is possible_duplicate and the message is Ya registraste un pago de $X el D. ¿Registrar otro? X is a leading $ with no space, comma thousands separators, and two decimals. D is the day number with no leading zero, the lowercase es-MX month name, and the four-digit year, as in 3 de marzo de 2026. 123450 centavos matched to 3 March 2026 produces Ya registraste un pago de $1,234.50 el 3 de marzo de 2026. ¿Registrar otro? The warning names the match with the latest paidAt, then the latest createdAt. A date difference of 4 days does not warn. warnings is an empty array when nothing matches.");

  it.todo("EC-7.4 A voided payment is not a duplicate match. A different centavo amount is not a match. Replaying the same Idempotency-Key returns the stored create response with status 200 and does not run the duplicate check again.");

  it.todo("EC-8.1 An unknown token, or acceptance from an account whose email does not equal the invited email after both are trimmed and lowercased, returns 404. This check runs first, before any token state is revealed, and it leaves usedAt null. Acceptance requires the invited email.");

  it.todo("EC-8.2 A used, revoked, superseded-by-resend, or expired token returns 410 and does not create a membership. Expired means the server instant is greater than or equal to expiresAt, and expiresAt is sentAt plus 7 periods of 24 hours. Tokens are single-use, so a second accept returns 410. A resend sets revokedAt on the previous invite, inserts a new invite for the same email and role, and sets the new expiresAt to the new sentAt plus 7 periods of 24 hours, which restarts the 7 days. The previous token then returns 410. Resend of an invite whose usedAt is set returns 409. Resend of an invite whose revokedAt is set returns 410.");

  it.todo("EC-8.3 An invitee who is already a member returns 409 and does not insert an invite or another membership. A caller with no active membership, and an unknown property, returns 404 before any 403, and that response does not reveal whether the property exists. A non-owner invite action returns 403. Only an owner can invite, by email, as member or viewer, with POST /v1/properties/:propertyId/invites and a JSON body of email plus that role. The response includes the raw token once, plus the invite id, email, role, sentAt, and expiresAt, and it does not include tokenHash. The row stores tokenHash as the lowercase hex SHA-256 of the raw token and does not store the raw token. Role owner, a blank email, or a missing role returns 422. The stored email is trimmed and lowercased. A matching email creates an active PropertyMembership with the invite role, sets usedAt, and returns that membership.");

  it.todo("EC-9.1 When a saved field already has a persisted value, replace writes an audit with the server-side previous value and the new value (for a multi-line free-text field, only {length, sha256} per EC-9.2), action replace, the suggestionId, and the actor. accept or edit returns 409 with error field_already_set and does not mark the suggestion accepted. reject leaves the value unchanged.");

  it.todo("EC-9.2 A replace is audited only when the record is saved, not before. The replace audit event (action) is ocr.replaced. On payment create, that field's create-audit source is ocr_replace with the suggestionId; ocr_replace is never used as an event name. Unsaved Reemplazar writes no audit. On save, that audit records ocr.replaced and the suggestionId, and it does not store a client-typed previous value. A request that contains clientPriorValue returns 422. A bulk accept-all returns 422. For notes, maintenance description, and any other multi-line free-text field, the audit never stores the text: metadata, previousValue, newValue, and suggestedValue omit it, and before_state and after_state are only {length, sha256}, or null when that side has no text. length is UTF-16 code units of the NFC-normalized, LF-normalized text, sha256 is the hex SHA-256 of those bytes, and the raw text is never stored.");

  it.todo("EC-10.1 The consent screen shows whenever consent.required is true. That covers first sign-in, any sign-in after Ahora no, and any sign-in after an aviso version change. The checkbox starts unchecked, and Continuar stays disabled until it is checked.");

  it.todo("EC-10.2 Ahora no shows the copy \"Sin tu consentimiento no podemos guardar pagos ni comprobantes.\" It then signs the user out and saves nothing.");

  it.todo("EC-10.3 POST /v1/me/consent body is only {avisoVersion}. appVersion comes from the app-version header. A client-sent acceptedAt is ignored, and the server stores acceptedAt. The full text of each aviso version is stored, and that table is insert-only. The current version returns 201 and appends one record of the user, the aviso version, the server acceptedAt, and the app version, in the same transaction as its audit entry. Posting that same version again returns 200 with the existing record and no new record. It does not change acceptedAt or appVersion, and it writes no second audit entry. Posting a version that is not current, including an older published version, returns 422 with error aviso_version_mismatch. Records are never overwritten.");

  it.todo("EC-10.4 The full guard order is 501, then 401, then 400 or 413, then 404 membership, then 403 viewer, then 403 consent_required. Reads are allowed before consent. A property, obligation, payment, or evidence write made before the current consent returns 403 consent_required only after those earlier gates. A route that is still a stub returns 501 before the token is read. A missing, invalid, or expired token returns 401. A bad request returns 400 and a payload that is too large returns 413. A non-member, or an unknown resource, returns 404, including when that caller also lacks consent. A viewer write returns 403 viewer, not consent_required. Once PR #24 lands, that error code becomes forbidden, replacing viewer. POST /v1/properties has no membership check, so after 501, 401, and 400 or 413, a user who has not consented receives 403 consent_required and cannot create a property.");

  it.todo("EC-10.5 Reads do not require consent, and they skip the viewer check. GET /v1/me is one of those reads. With a valid token and no current consent it returns the profile, including consent { required, avisoVersion, avisoUrl }, and it does not return consent_required. consent.required is true when the caller has no row for the configured AVISO_VERSION. A non-member read of a property resource is still 404.");

  it.todo("EC-10.6 A new aviso version sets consent.required back to true. Writes then return 403 consent_required again until the user accepts that version. The earlier consent row stays and is not overwritten.");

  it.todo("EC-10.7 In the app, a 403 consent_required goes straight back to the consent screen and shows no toast.");

  it.todo("EC-10.8 On a new account, Continuar stays blocked until the box is checked. After the user accepts and then signs out and signs back in, the consent screen does not appear again while consent.required is false and that aviso version is unchanged.");

  it.todo("EC-10.9 Retirar consentimiento and account deletion are separate MVP backlog items. Both are required before public launch, and neither is in the Nov 5 build.");

  it.todo("EC-11.1 GET /v1/health runs a database query, so one call wakes both the API and the database. Success returns 200 and a JSON object whose only field is status set to ok. A failed query returns 503 and a JSON object whose only field is status set to unavailable. Those two bodies include no version, no host, and no error detail. The route is rate-limited, and a request past the limit returns 429 with a Retry-After header instead of either of those bodies. Responses are never cached and send Cache-Control no-store.");

  it.todo("EC-11.2 The health check runs at launch, when the app returns to the foreground after more than 10 minutes in the background, and before a write only if more than 10 minutes have passed since the last API response. Otherwise a write sends no separate check. A write button tapped before the health check has passed shows Conectando… and sends only once the check passes. Every other request keeps the 15 s timeout. The copy keys are common.connecting at 3 s, common.connecting.slow at 8 s, and common.connecting.failed with Reintentar at 90 s.");

  it.todo("EC-11.3 Every write button stays in the Conectando state until the health check passes. A write is never sent while the API is still in a cold start.");

  it.todo("EC-11.4 On the free build, a first open that completes within 90 s behind Conectando is a pass, and reaching common.connecting.failed at 90 s is a fail.");

  it.todo("EC-11.5 The phone never retries POST /v1/auth/code automatically, and the route honors Idempotency-Key. The key is 8 to 128 characters of letters, digits, underscores, or hyphens, matching [A-Za-z0-9_-], and anything else returns 400 idempotency_key_invalid. Reintentar sends the same key. The same key for the same email within 10 minutes returns the original 202, creates no new code, sends no second email, and does not consume another rate-limit hit. A new key comes from Reenviar (\"Enviar otro código\"), returns a fresh code, invalidates the earlier code, and counts toward the rate limit. The key is stored against a keyed HMAC of the normalized email, and the raw email is never stored. The same key with a different email is a new request: it returns 202, and the response reveals nothing about whether the key was already used or whether either account exists. A 429 response includes Retry-After. The success response is 202 whether or not the account exists. Codes, tokens, and emails never appear in logs.");

  it.todo("EC-11.6 The line auth.code.latest (Si pediste más de un código, usa el del correo más reciente.) is shown under auth.code.body only after Reenviar (auth.code.resend). It is not shown on the first visit and it is not shown after Reintentar. An older code is rejected with auth.code.wrong.");

  it.todo("EC-11.7 A safe GET auto-retries once, and only after a timeout or a network error. It never retries a 4xx, including 401, 403, 404, and 429. A 401 goes through the single-flight refresh. A safe GET never retries a signed file URL request; it asks for a fresh URL instead. Writes never auto-retry, except once: after a 401 the client does the single-flight refresh and resends that write once with the same Idempotency-Key and body (EC-15.3). Any other write retry needs the user to tap Reintentar, which resends the same body and key (AC-PAY-22).");

  it.todo("EC-11.8 The legacy /health route is removed. No health response, including a 429, carries a version, a host, or an error detail.");

  it.todo("EC-12.1 Reemplazar saves the field's current value as the undo, keyed by suggestion id and field. It saves that value again only when the field does not already hold the OCR value, so tapping Reemplazar two or three times keeps the value from before the first tap.");

  it.todo("EC-12.2 Mantener restores the saved undo value, or the saved value when the field was already saved, sends reject, and then clears the undo.");

  it.todo("EC-12.3 Typing 5.00, then Reemplazar, then Mantener, then typing 6.00, then Reemplazar, then Mantener ends on 6.00. Typing a new value between two Reemplazar taps saves that newly typed value as the undo.");

  it.todo("EC-12.4 Reemplazar, then editing the same field, then Mantener restores the value from before the Reemplazar tap and sends reject.");

  it.todo("EC-12.5 Copying the form object or editing another field never changes the stored undo for a field.");

  it.todo("EC-12.6 Remount persistence is deferred to the record-payment screen PR, which stores the undo with the decisions, keyed by suggestion id + field, and adds a remount test. Until then the undo lives in row state and is never sent.");

  it.todo("EC-12.7 Confirm and reject request bodies never carry typed or saved text, previousValue, or clientPriorValue.");

  it.todo("EC-12.8 Only Reemplazar sends replace, and the latest choice wins. The undo is held in screen or row state, never in module state. Mantener restores the value from before the first tap, or savedValue, sends reject, and clears the undo. Known low: typing the OCR value by hand after Reemplazar looks like a repeat tap.");

  it.todo("EC-13.1 The server fails at boot when the configured AVISO_VERSION has no published row, and it does not start listening. At runtime a missing current aviso returns 503 with error aviso_unavailable and logs an alert that contains no PII. POST /v1/me/consent returns that 503 now. GET /v1/me returning 503 is a tracked follow-up. That missing-aviso response is never 422.");

  it.todo("EC-13.2 On the phone, a 503 shows consent.unavailable (No pudimos cargar el Aviso de privacidad. Inténtalo de nuevo en unos minutos.) with Reintentar and Ahora no. The checkbox never unchecks in a loop, nothing is saved, and Ahora no signs the user out.");

  it.todo("EC-13.3 Only a 422 aviso_version_mismatch shows consent.updated. A 503 never shows consent.updated.");

  it.todo("EC-14.1 A pending notification link is kept in memory only and is never persisted (brief §11.4). The held nid is AppShell state only. It is never written to SecureStore or AsyncStorage. The held nid is cleared when the stub opens and when Ahora no or Cancelar drops the link. The held nid is never rendered, including on the sign-in step.");

  it.todo("EC-14.2 Production, store, and TestFlight builds register and accept only duerecord://. A duerecord://notificaciones/<uuid> link opens a stub screen. The nid is an 8-4-4-4-12 hex id. The path is exactly those two segments. A dot-dot segment, an empty segment, a trailing slash, or a host or port opens Inicio. exp:// and exps:// are accepted only while running in Expo Go or a dev build. The dev-prefix gate covers both exp:// and exps://. The navigation map does not register notificaciones/:nid. Routing stays in AppShell. The dev-prefix gate is apps/mobile/src/navigation/devPrefix.ts: __DEV__ or an Expo Go (StoreClient) execution environment. getStateFromPath does not route notificaciones/Llama-al-5555, or a uuid followed by %3Ftoken%3Dabc, and a valid uuid still does not become a web route.");

  it.todo("EC-14.3 The stub shows the same not-found copy for every nid. notif.notFound.title is Esta notificación ya no está disponible. notif.notFound.body is Puede que se haya eliminado o que no tengas acceso. notif.notFound.cta is Ir a Inicio. The call to action opens Inicio. The screen does not render the nid or any other text taken from the URL.");

  it.todo("EC-14.4 Without a session the link stops on sign-in. Ahora no and Cancelar drop it and open Inicio. The session flag is read once per mount. There is no session subscription until the sign-in PR merges. Tokens are stored by apps/mobile/src/auth/tokenStore.ts in expo-secure-store with WHEN_UNLOCKED_THIS_DEVICE_ONLY, and never in AsyncStorage. Query and fragment are removed before a route receives params. property-control:// is not handled.");

  it.todo("EC-15.1 The same idempotency key with a different body returns 409 idempotency_key_reused. The server replays a stored 2xx and a stored 4xx other than 401. It never stores a 5xx or a 401, so the same key and body may be sent again. The payment-row key is unique per (property_id, recorded_by_user_id, idempotency_key). A different member may use the same key and gets a separate payment. The same member reusing a key after the 24h store row expired returns 409 idempotency_key_reused, never 500.");

  it.todo("EC-15.2 An unchanged body reuses its original idempotency key after a timeout, a network error, or a 5xx, regardless of the button label. A new key is issued only when the body changes or after a definite 2xx or a 4xx other than 401 and other than 409 idempotency_in_progress. On 409 idempotency_in_progress the client treats it like a 5xx: it keeps the key and body, shows common.connecting.failed with Reintentar, never says the save failed or asks to re-enter the form, and Reintentar resends the same key and body. Applies to writes and the sign-in code request.");

  it.todo("EC-15.3 A GET retries once automatically, and only after a timeout or a network error. It never retries a 4xx or a signed-URL request. A write never auto-retries, except that after a 401 the client does a single refresh and then resends the write once with the same Idempotency-Key and the same body. If that refresh or resend fails, there is no further automatic retry, and the user sees the normal error or Reintentar.");

  it.todo("EC-15.4 A voided payment is read-only. Any PATCH returns 409 payment_voided, that response is stored under the idempotency key, and the PATCH writes no audit. The UI shows no Editar. Editing a voided payment shows pay.void.noEdit with pay.void.noEdit.cta (\"Ver pago\"). To fix a mistake the user records a new payment.");

  it.todo("EC-15.5 voidReason stays readable on the payment. The audit log stores only {length, sha256} via sealAuditText.");

  it.todo("EC-15.6 The notes audit stores {length, sha256} of the NFC-normalized and LF-normalized text, and length counts UTF-16 code units. Notes reject bidi control characters and zero-width characters. CRLF and CR are normalized to LF.");

  it.todo("EC-15.7 A non-member receives 404 before any 403, and that response does not reveal whether the property exists.");

  it.todo("EC-15.8 The refresh lifetime is 30 days idle and 90 days absolute, with a 30 second rotation grace. The client uses a single-flight refresh. A refresh ends the session only on a 401, or on a 400 or 401 carrying auth.refresh_invalid, auth.refresh_reused, token_invalid, or token_expired.");

  it.todo("EC-15.9 A verify attempt is reserved atomically before the code is compared, at a maximum of 5 per email, and at most 3 wrong verifies per (email, IP) within the 5 per email. A freshly delivered code resets only the per-email verify count, not the per-(email, IP) count. One IP can never lock out an account. Send limits are checked in order: 20 per hour per IP, then auth.code.email_ip at 3 per hour per (email, IP), then 5 per hour per email. From the same IP, the 4th send to one email returns 429, while a send from another IP still returns 202 and the code is delivered. A failed send is undone across all three buckets. A failed Resend send does not start the 60 second cooldown and does not consume quota. An unset or unknown APP_ENV means production. In production, auth never uses in-memory stores even when NODE_ENV=test, it throws if DATABASE_URL is missing, a missing Resend key gives the 503 sender and never the fake one, and any @resend.dev From address is treated as the sandbox sender and refused at boot. When the From address is a @resend.dev sandbox sender (staging only), a recipient allow-list is required, and both sides are compared after NFC normalization, trim and lowercase. Moving staging to a verified domain needs Trust sign-off first, because the list stops being enforced.");

  it.todo("EC-15.10 Requests must arrive over HTTPS. Behind the proxy, X-Forwarded-Proto is trusted only from the configured proxy (§12.1 carve-out).");

  it.todo("EC-15.11 Logout and session routes check the bearer token first, including the trailing-slash path /v1/auth/logout/, so a missing token is 401 before any 400 or 413.");

  it.todo("EC-15.12 A second void, including two people voiding at the same time, returns 409 already_voided. The client shows pay.void.alreadyVoided (\"Este pago ya estaba anulado.\"), then the receipt refreshes as anulado (AC-PAY-21).");


  it.todo("EC-15.13 The client treats a token-storage read failure as unavailable, showing connecting or retry copy, and never as signed out. It never clears tokens because of that failure.");

  it.todo("EC-15.14 If an edit and a void on the same payment arrive at once, the edit either finishes before the void or returns 409 payment_voided. It never returns 200 on a voided payment. The check is atomic, with a row lock or a conditional update.");

  it.todo("EC-15.15 A trailing slash on write routes (POST and PATCH on properties, obligations, and payments, and .../void/) is still checked for the bearer token first, so a missing token gets 401 before any 400 or 413. The idempotency scope is normalized the same way, so /x and /x/ share a scope.");

  it.todo("EC-15.16 Property address and property name are stored in the audit only as {length, sha256}, on both create and update. Obligation titles may stay plaintext. The current name and address on the property itself stay readable.");

  it.todo("EC-15.17 A key whose reservation has no stored response (still in progress, or left by a crash) never replays as 202 or as a stored success. It returns 409 idempotency_in_progress, and an expired reservation may be taken over with the same key and body. The client rule for that 409 is EC-15.2.");
});
