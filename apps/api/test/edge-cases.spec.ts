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

  it.todo("EC-1.9 A void requires an Idempotency-Key header. A missing key returns 400. The same key and the same body return the original response and change nothing further. The same key with a different body returns 409. The key is stored on idempotency_records with route key POST /payments/:id/void and does not reuse the payment's create key, so replaying the create key does not void the payment.");

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

  it.todo("EC-8.3 An invitee who is already a member returns 409 and does not insert an invite or another membership. A non-owner invite action returns 403. Only an owner can invite, by email, as member or viewer, with POST /v1/properties/:propertyId/invites and a JSON body of email plus that role. A caller with no active membership, and an unknown property, returns 404. The response includes the raw token once, plus the invite id, email, role, sentAt, and expiresAt, and it does not include tokenHash. The row stores tokenHash as the lowercase hex SHA-256 of the raw token and does not store the raw token. Role owner, a blank email, or a missing role returns 422. The stored email is trimmed and lowercased. A matching email creates an active PropertyMembership with the invite role, sets usedAt, and returns that membership.");

  it.todo("EC-9.1 When a saved field already has a persisted value, replace writes an audit with the server-side previous value, the new value, action replace, the suggestionId, and the actor. accept or edit returns 409 with error field_already_set and does not mark the suggestion accepted. reject leaves the value unchanged.");

  it.todo("EC-9.2 Before a record is saved, a replace audit stores only the suggestionId, the field, decision replaced, and the suggested value. It does not store a client-typed previous value. On save, the payment create audit records source ocr_replace and the suggestionId. A request that contains clientPriorValue returns 422. A bulk accept-all returns 422.");

  it.todo("EC-10.1 The consent screen appears only on first sign-in, after the code is verified and before Inicio, and it appears again whenever the aviso version changes. The checkbox starts unchecked, and Continuar stays disabled until it is checked.");

  it.todo("EC-10.2 Ahora no shows Sin tu consentimiento no podemos guardar pagos ni comprobantes. It then signs the user out and saves nothing.");

  it.todo("EC-10.3 POST /v1/me/consent takes avisoVersion. appVersion comes from the client header or body. The current version returns 201 and appends one record of the user, the aviso version, the server acceptedAt, and the app version, in the same transaction as its audit entry. Posting that same version again returns 200 with the existing record and no new record. It does not change acceptedAt or appVersion, and it writes no second audit entry. Posting a version that is not current, including an older published version, returns 422 with error aviso_version_mismatch. Records are never overwritten.");

  it.todo("EC-10.4 A property, obligation, payment, or evidence write made before the current consent returns 403 with error consent_required only after the earlier gates. A route that is still a stub returns 501 before the token is read. A missing, invalid, or expired token returns 401. A bad request returns 400 and a payload that is too large returns 413, and both beat membership and consent. A non-member, or an unknown resource, returns 404, including when that caller also lacks consent. A viewer write returns 403 with error viewer, not consent_required. The consent check is next. POST /v1/properties has no membership check, so after the token check and the 400 or 413 checks a user who has not consented receives 403 consent_required and cannot create a property.");

  it.todo("EC-10.5 Reads do not require consent, and they skip the viewer check. GET /v1/me is one of those reads. With a valid token and no current consent it returns the profile, including consent.required, avisoVersion, and avisoUrl, and it does not return consent_required. consent.required is true when the caller has no row for the configured AVISO_VERSION. A non-member read of a property resource is still 404.");

  it.todo("EC-10.6 A new aviso version sets consent.required back to true. Writes then return 403 consent_required again until the user accepts that version. The earlier consent row stays and is not overwritten.");

  it.todo("EC-10.7 In the app, a 403 consent_required goes straight back to the consent screen and shows no toast.");

  it.todo("EC-10.8 On a new account, Continuar stays blocked until the box is checked. After the user signs out and signs back in, the consent screen does not appear again while that aviso version is unchanged.");

  it.todo("EC-10.9 Retirar consentimiento, which leads into account deletion, is in the MVP backlog. It must land before public launch and it is not in the Nov 5 build.");

  it.todo("EC-11.1 GET /v1/health runs a database query, so one call wakes both the API and the database. Success returns 200 and a JSON object whose only field is status set to ok. A failed query returns 503 and a JSON object whose only field is status set to unavailable. Those two bodies include no version, no host, and no error detail. The route is rate-limited, and a request past the limit returns 429 with a Retry-After header instead of either of those bodies. Responses are never cached and send Cache-Control no-store.");

  it.todo("EC-11.2 The app calls GET /v1/health at launch, when it returns to the foreground, and before any write when more than 10 minutes have passed since the last API response. The client timeout is 90 seconds. The UI shows Conectando… at 3 seconds, the slow line at 8 seconds, and common.connecting.failed with Reintentar at 90 seconds.");

  it.todo("EC-11.3 Enviar código and Guardar stay in the Conectando state until the health check passes. A write is never sent while the API is still in a cold start.");

  it.todo("EC-11.4 On the free test build, a first open that reaches a healthy response in about a minute or less passes acceptance. Reaching the 90 second failure fails acceptance.");

  it.todo("EC-11.5 POST /v1/auth/code never retries on its own and it honors Idempotency-Key. Reintentar sends the same key. The same key for the same email within 10 minutes returns the original 202, creates no new code, sends no second email, and does not consume another rate-limit hit. A new key returns a fresh code, invalidates the earlier code, and counts toward the rate limit. The key is stored against an HMAC of the email and the plain email is not stored. The same key with a different email is a new request: it returns 202, and the response reveals nothing about whether the key was already used or whether either account exists. A 429 response includes Retry-After. The success response is 202 whether or not the account exists.");

  it.todo("EC-11.6 The line auth.code.latest (Si pediste más de un código, usa el del correo más reciente.) is shown under auth.code.body only after Enviar otro código, which is auth.code.resend. It is not shown on the first visit and it is not shown after Reintentar. An older code is rejected with auth.code.wrong.");

  it.todo("EC-11.7 A safe read retries once on its own. Any other write retries only when the user taps Reintentar, and that retry reuses the same Idempotency-Key.");

  it.todo("EC-12.1 Reemplazar saves the field's current value as the undo, keyed by suggestion id and field. It saves that value again only when the field does not already hold the OCR value, so tapping Reemplazar two or three times keeps the value from before the first tap.");

  it.todo("EC-12.2 Mantener restores the saved undo value, or the saved value when the field was already saved, sends reject, and then clears the undo.");

  it.todo("EC-12.3 Typing 5.00, then Reemplazar, then Mantener, then typing 6.00, then Reemplazar, then Mantener ends on 6.00. Typing a new value between two Reemplazar taps saves that newly typed value as the undo.");

  it.todo("EC-12.4 Reemplazar, then editing the same field, then Mantener restores the value from before the Reemplazar tap and sends reject.");

  it.todo("EC-12.5 Copying the form or editing another field does not change the undo value.");

  it.todo("EC-12.6 On the record-payment screen the undo survives a remount because it is stored with the decisions for that suggestion id and field, and a remount test covers that restore. The stored undo is not sent on the request.");

  it.todo("EC-12.7 Request bodies never carry typed text, previousValue, or clientPriorValue.");

  it.todo("EC-13.1 The server fails at boot when the configured AVISO_VERSION has no published row, and it does not start listening. At runtime a missing current aviso returns 503 with error aviso_unavailable and logs an alert. That missing-aviso response is never 422.");

  it.todo("EC-13.2 On the phone, when the aviso cannot be loaded, the consent screen shows consent.unavailable (No pudimos cargar el Aviso de privacidad. Inténtalo de nuevo en unos minutos.) in place of the checkbox and Continuar, with Reintentar and Ahora no. Ahora no signs the user out. The screen does not loop and it does not uncheck the box over and over.");

});
