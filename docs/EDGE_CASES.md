# DueRecord: edge-case behavior spec

Locked by Product on 20 Oct 2026. DueRecord is the public product name. Packages, the Expo slug, and code identifiers stay property-control. The Expo URL scheme is `duerecord`. The app display name and UI copy say DueRecord.

Each rule below is one checkable statement. A test in `apps/api/test/edge-cases.spec.ts` carries the same id and sentence. "Period" means one due instance of an Obligation, keyed by the obligation and a calendar due date. "Settled" means the period outcome is `paid` or `not_applicable`. "Non-voided sum" means the sum of `amount` over payments for that period whose status is `recorded`. "Write access" means an active PropertyMembership with role `owner` or `member`. "Today" means the current calendar date in the property's IANA timezone. A "candidate" due date is a date produced by the schedule in section 6 that is not a skipped pause date. A skipped pause date lies inside a pause interval and is after that interval's `lastScheduledDueDate`.

The database stores money amounts on Obligation, Payment, and ObligationPeriodOutcome as integer centavos. The API wire format for those amounts is a decimal string such as "1234.50" plus a currency code. The currency is MXN only, and the wire value is never a float. `overpaidAmount` is the excess on that one period. It is not a balance, a credit, or an amount the next period can draw.

## 1. Payments are void-only

- **EC-1.1** There is no DELETE route for a payment, and the Payment model has no deletedAt column.
- **EC-1.2** A correction is a void through POST /v1/properties/:propertyId/payments/:paymentId/void, which sets voidedAt, voidedBy, and voidReason. voidReason is required, and its trimmed length must be from 1 to 500 characters. Missing, blank, or longer text returns 422 and changes nothing.
- **EC-1.3** A voided payment remains in the payment list and in the audit log, the client labels its status voided as Anulado, and its Evidence rows stay attached and are not soft-deleted by the void.
- **EC-1.4** A voided payment is excluded from the non-voided sum that decides whether the period is partial or paid.
- **EC-1.5** Voiding a payment whose status is already voided returns 409 and leaves voidedAt, voidedBy, and voidReason unchanged.
- **EC-1.6** A void cannot be undone. No route clears a void, and PATCH cannot set status back to recorded or change voidedAt, voidedBy, or voidReason. The correction for a mistaken void is a new payment.
- **EC-1.7** A void recomputes that period from its non-voided sum and then sets nextDueDate to the earliest candidate that is not settled. A sum of 0 deletes the outcome row, and the period then reads as open when its due date is today or later in the property timezone, or overdue when the due date is before today. A sum greater than 0 and below expectedAmount stores outcome partial with overpaidAmount 0. A sum greater than or equal to expectedAmount stores outcome paid with overpaidAmount equal to the sum minus expectedAmount.
- **EC-1.8** Void requires write access on that property. A viewer receives 403. A caller with no membership receives 404, including when the payment id is unknown.
- **EC-1.9** A void requires an Idempotency-Key header. A missing key returns 400. The same key and the same body return the original response and change nothing further. The same key with a different body returns 409. The key is stored on idempotency_records with route key POST /payments/:id/void and does not reuse the payment's create key, so replaying the create key does not void the payment.

## 2. Partial and over payments

- **EC-2.1** A payment amount on the wire is a decimal string with at most two fraction digits, such as 1234.50, together with currency MXN, and it is never a JSON number or a float. The database stores that amount as integer centavos greater than 0. An amount of 0 or less, a JSON number, a string that is not that decimal form, an amount above 2147483647 centavos, or any currency other than MXN returns 422. An obligation currency other than MXN also returns 422.
- **EC-2.2** When the non-voided sum is greater than 0 and less than expectedAmount, the outcome is partial, overpaidAmount is 0, and nextDueDate does not change.
- **EC-2.3** Partial payments on one period add into that period's non-voided sum. When the sum reaches or passes expectedAmount, the outcome becomes paid and nextDueDate moves forward exactly one period.
- **EC-2.4** When the non-voided sum is greater than expectedAmount, the outcome is paid, nextDueDate moves forward exactly one period and no further, and overpaidAmount is the sum minus expectedAmount. The next period's expected amount is not reduced by that excess.
- **EC-2.5** When expectedAmount is null, a payment with markPartial false or omitted marks the period paid, leaves overpaidAmount at 0, and moves nextDueDate forward one period. markPartial true on that payment marks the period partial and does not move nextDueDate.
- **EC-2.6** A create may set periodDueDate to a candidate on or before the earliest unsettled candidate, or to a date that already has an outcome row. The payment changes only that period. Every other period's outcome stays as it was. Omitting periodDueDate uses the earliest unsettled candidate.
- **EC-2.7** A payment on a period that is already paid is stored. When expectedAmount is set it increases that period's overpaidAmount by the new amount, and it does not advance nextDueDate by another period.
- **EC-2.8** When expectedAmount is set, markPartial true returns 422 and stores nothing.

## 3. N/A versus Pause versus Archive

A pause interval stores `pausedOn` (the property-timezone date the pause started), `resumedOn` (null until resume, then the property-timezone date of resume), and `lastScheduledDueDate` (the obligation's nextDueDate at the moment the pause started). A calendar date D is inside the interval when pausedOn is on or before D and resumedOn is null or D is before resumedOn.

- **EC-3.1** Marcar no aplica sets the current period's outcome to not_applicable with a null payment id, moves nextDueDate forward one period, and leaves isActive true and deletedAt null. There is no undo route. The action appends an audit event.
- **EC-3.2** N/A on a period that still has a non-voided payment returns 409 and changes nothing. Voided payments alone do not cause this 409.
- **EC-3.3** N/A on a period whose outcome is already paid or not_applicable returns 409 and changes nothing.
- **EC-3.4** Pausar sets isActive to false and opens one pause interval whose pausedOn is today in the property timezone and whose lastScheduledDueDate is the current nextDueDate. While isActive is false, the obligation appears in no overdue list, no reminder for it is sent, and no new period outcome is created. A second pause while an interval is still open returns 409 and does not insert another interval.
- **EC-3.5** Reanudar requires an open pause interval. It sets isActive to true, sets that interval's resumedOn to today in the property timezone, and sets nextDueDate to the first scheduled due date on or after that today. Dates inside the interval that are after lastScheduledDueDate never receive an outcome row. Resume with no open pause interval returns 409.
- **EC-3.6** While an obligation is paused and deletedAt is null, a payment is allowed when its periodDueDate is on or before the open interval's lastScheduledDueDate. A periodDueDate after lastScheduledDueDate returns 422 and stores nothing while that interval is open.
- **EC-3.7** Archivar sets deletedAt and also sets isActive to false, opening a pause interval when none is open. Archived obligations are omitted from default lists and send no reminders. Creating a payment or posting N/A while deletedAt is set returns 409. Archivar when deletedAt is already set returns 409.
- **EC-3.8** Desarchivar is POST /v1/properties/:propertyId/obligations/:obligationId/unarchive. It clears deletedAt and leaves isActive false. It does not set resumedOn and it does not change nextDueDate. Unarchive when deletedAt is null returns 409.
- **EC-3.9** N/A writes only the period outcome and does not change isActive or deletedAt. Pause writes isActive and a pause interval and does not write not_applicable or deletedAt. Archive is the only action that sets deletedAt, and it also pauses. No action other than archive changes another mechanism's column.

## 4. Reminder key (parent, scheduledFor, channel)

- **EC-4.1** A reminder has exactly one parent, either an obligation or a maintenance task. Uniqueness is (parent, scheduledFor, channel), enforced by partial unique index reminders_obligation_id_scheduled_for_channel_key on (obligation_id, scheduled_for, channel) WHERE obligation_id IS NOT NULL, and partial unique index reminders_maintenance_task_id_scheduled_for_channel_key on (maintenance_task_id, scheduled_for, channel) WHERE maintenance_task_id IS NOT NULL. A row with both parents or with neither parent is rejected.
- **EC-4.2** notification_deliveries is unique on (reminder_id, scheduled_for, user_id, channel). A second delivery insert with that same tuple does not create a second row.
- **EC-4.3** Generating reminders upserts on the parent key. Running generation twice for the same obligation inserts no second row for the same parent, scheduledFor, and channel.
- **EC-4.4** Duplicate values in reminderOffsets are removed before generation, keeping the first occurrence of each offset. The list [7, 7, 1] produces the same rows as [7, 1].
- **EC-4.5** When reminderOffsets is omitted it is stored as [7, 1]. Generation also schedules offset 0. Offset 0 is created only with channel in_app, and it is not created as push or email. Each remaining offset produces one in_app row and one push row. The default generator does not create email rows.
- **EC-4.6** Changing reminderOffsets or a due date deletes that obligation's reminders whose status is pending and generates them again. Reminders whose status is sent stay, including their scheduledFor.
- **EC-4.7** A reminder whose scheduledFor is at or before the generation instant is not inserted and is never sent later. Offsets whose scheduledFor is still after that instant are still inserted.
- **EC-4.8** Pausing, archiving, marking N/A, or settling a period sets pending reminders whose periodDueDate is that period to cancelled. Sent reminders for that period stay sent.
- **EC-4.9** The same parent and the same scheduledFor with two different channels are two rows and are allowed. A push row and an email row at that same time both remain stored.

## 5. Timezone and DST

- **EC-5.1** Every Property stores an IANA timezone name, and every Property response in the v1 contract includes timezone. The default, when the client omits it, is America/Mexico_City. A value that is not a name in the tz database returns 422. The column stores the name and does not store a numeric offset.
- **EC-5.2** A due date is a calendar date with no time of day. The period is not overdue at 23:59:59 in the property timezone on that due date. It becomes overdue at 00:00:00 in the property timezone on the calendar day after the due date.
- **EC-5.3** Generated obligation reminders are scheduled at 09:00:00 in the property timezone and stored as UTC instants. A delivery whose instant falls in the recipient device timezone at or after 21:00, or before 08:00, is deferred to the next 09:00 in that device timezone. At most 3 push deliveries are sent to one user on one device-local calendar day. A further push waits until 09:00 on the next device-local day. Email and in_app deliveries do not count toward that cap.
- **EC-5.4** The offset-0 reminder uses the copy Vence hoy, uses channel in_app only, and has no push row.
- **EC-5.5** America/Mexico_City, America/Tijuana, and America/Cancun are valid timezones and are resolved with the tz database rather than a hardcoded offset. 09:00 on 2026-06-15 in America/Cancun is 2026-06-15T14:00:00.000Z, in America/Mexico_City is 2026-06-15T15:00:00.000Z, and in America/Tijuana is 2026-06-15T16:00:00.000Z.
- **EC-5.6** A local time that falls in a spring-forward gap is stored as the next valid instant. A local time that falls in a fall-back overlap is stored as the first occurrence, which is the earlier offset. In America/Tijuana, 02:30 on 2026-03-08 does not exist and is stored as 2026-03-08T10:00:00.000Z. 01:30 on 2026-11-01 is ambiguous and is stored as 2026-11-01T08:30:00.000Z.
- **EC-5.7** Across a DST transition, each parent, period, offset, and channel produces one reminder row. That row is not duplicated, and an offset that is still in the future is not dropped because of the transition.
- **EC-5.8** Changing a property timezone deletes pending reminders for that property and regenerates them at 09:00 in the new timezone. Reminders whose status is sent stay. nextDueDate and period due dates keep the same calendar dates.
- **EC-5.9** Overdue and Home ranking compare a due date with today in that property's timezone. The comparison does not use the device timezone and does not use the server timezone.

## 6. Month-end and leap day

Period index 0 is the year and month of scheduleAnchor. The day stored on scheduleAnchor is ignored. The due date of index n is the year-month n steps after that anchor month, with the day equal to dueDay or the month's last day when dueDay is greater. The step is 1 month for monthly, 2 for bimonthly, 3 for quarterly, 6 for semiannual, and 12 for annual. The step is applied to the anchor index, not to the previous clamped calendar date.

- **EC-6.1** An obligation whose recurrence is monthly, bimonthly, quarterly, semiannual, or annual stores dueDay as an integer from 1 to 31 and a scheduleAnchor date. A dueDay outside 1 to 31, or a missing dueDay or scheduleAnchor for one of those recurrences, returns 422. The first due date the client sends must equal the clamped period-0 date.
- **EC-6.2** When dueDay is greater than the last day of the target month, the due date is that month's last day. For dueDay 31 the non-leap February date is 28 February, the April date is 30 April, and the June date is 30 June.
- **EC-6.3** The anchor does not drift. A monthly dueDay of 31 whose anchor month is January is 31 March on the period after February, not 28 March.
- **EC-6.4** An annual obligation whose dueDay is 29 and whose anchor month is February falls on 29 February in a leap year, including 2028, and on 28 February in a non-leap year, including 2100.
- **EC-6.5** Bimonthly adds 2 months, quarterly adds 3, and semiannual adds 6, and each then uses the same clamp. From an anchor month of January 2026 with dueDay 31, the next bimonthly date is 31 March 2026 and the next quarterly date is 30 April 2026. Custom and irregular do not compute dates from dueDay. When a custom or irregular period becomes paid or not_applicable, nextDueDate is set to null.
- **EC-6.6** Each forward move adds one step to the anchor index. It does not add the step to the previous clamped calendar date. The date after a clamped 28 February for monthly dueDay 31 is 31 March, not 28 March.
- **EC-6.7** Monthly dueDay 31 with anchor month January 2026 produces 31 January 2026, then 28 February 2026, then 31 March 2026. Monthly dueDay 31 with anchor month January 2028 produces 31 January 2028, then 29 February 2028, then 31 March 2028. Monthly dueDay 31 with anchor month December 2026 produces 31 January 2027 next. Annual dueDay 29 with anchor month February produces 29 February 2028, then 28 February 2029, then 28 February 2100.
- **EC-6.8** nextDueDate on input must be a property-timezone calendar date from today minus one calendar year through today plus five calendar years, inclusive. February 29 clamps to the last day of February when the target year is not a leap year. A date outside that window returns 422 with error next_due_date_out_of_range. The database CHECK, and a defensive check in front of it, also reject a date before 1990-01-01 or after 2100-12-31. The default timezone is America/Mexico_City.

## 7. Record payment: future dates and duplicates

- **EC-7.1** The record-payment date picker's maximum day is today in the property timezone. The server accepts paidAt up to one calendar day after the server instant in that timezone, at the same local time of day, and returns 422 when paidAt is later than that bound. No payment status means a scheduled or planned payment.
- **EC-7.2** paidAt earlier than one calendar year before the server instant returns 422. The bound is that instant in the property timezone with the year reduced by one, keeping the month, day, and time of day in that timezone, or the last day of that month at the same time when the day does not exist. The year is not reduced in UTC. A paidAt equal to the bound is accepted.
- **EC-7.3** When the same obligation already has a non-voided payment for the same centavo amount whose property-timezone calendar date differs by 0, 1, 2, or 3 days from the new payment's property-timezone calendar date, create still returns 201 and includes warnings. The warning code is possible_duplicate and the message is Ya registraste un pago de $X el D. ¿Registrar otro? X is a leading $ with no space, comma thousands separators, and two decimals. D is the day number with no leading zero, the lowercase es-MX month name, and the four-digit year, as in 3 de marzo de 2026. 123450 centavos matched to 3 March 2026 produces Ya registraste un pago de $1,234.50 el 3 de marzo de 2026. ¿Registrar otro? The warning names the match with the latest paidAt, then the latest createdAt. A date difference of 4 days does not warn. warnings is an empty array when nothing matches.
- **EC-7.4** A voided payment is not a duplicate match. A different centavo amount is not a match. Replaying the same Idempotency-Key returns the stored create response with status 200 and does not run the duplicate check again.

## 8. Member invites

Accept checks run in this order. The first match is the response, and an earlier check does not reveal token state:

1. An unknown token, or acceptance from the wrong account, returns 404.
2. A used, revoked, superseded-by-resend, or expired token returns 410. Expiry is 7 days from sentAt. A resend restarts those 7 days.
3. An invitee who is already a member returns 409.
4. A non-owner invite action returns 403. A caller with no membership, and an unknown property, returns 404.
5. Only an owner can invite, by email, as member or viewer. Tokens are single-use. Acceptance requires the invited email.

- **EC-8.1** An unknown token, or acceptance from an account whose email does not equal the invited email after both are trimmed and lowercased, returns 404. This check runs first, before any token state is revealed, and it leaves usedAt null. Acceptance requires the invited email.
- **EC-8.2** A used, revoked, superseded-by-resend, or expired token returns 410 and does not create a membership. Expired means the server instant is greater than or equal to expiresAt, and expiresAt is sentAt plus 7 periods of 24 hours. Tokens are single-use, so a second accept returns 410. A resend sets revokedAt on the previous invite, inserts a new invite for the same email and role, and sets the new expiresAt to the new sentAt plus 7 periods of 24 hours, which restarts the 7 days. The previous token then returns 410. Resend of an invite whose usedAt is set returns 409. Resend of an invite whose revokedAt is set returns 410.
- **EC-8.3** An invitee who is already a member returns 409 and does not insert an invite or another membership. A non-owner invite action returns 403. Only an owner can invite, by email, as member or viewer, with POST /v1/properties/:propertyId/invites and a JSON body of email plus that role. A caller with no active membership, and an unknown property, returns 404. The response includes the raw token once, plus the invite id, email, role, sentAt, and expiresAt, and it does not include tokenHash. The row stores tokenHash as the lowercase hex SHA-256 of the raw token and does not store the raw token. Role owner, a blank email, or a missing role returns 422. The stored email is trimmed and lowercased. A matching email creates an active PropertyMembership with the invite role, sets usedAt, and returns that membership.

## 9. OCR replace

Confirm decisions are per field: accept, replace, reject, or edit. There is no silent prefill at any confidence. accept or edit of a saved non-null value returns 409 field_already_set. replace is the only decision that overwrites it. A bulk accept-all shape returns 422. The API rejects clientPriorValue with 422 and does not store unsaved typed text.

- **EC-9.1** When a saved field already has a persisted value, replace writes an audit with the server-side previous value, the new value, action replace, the suggestionId, and the actor. accept or edit returns 409 with error field_already_set and does not mark the suggestion accepted. reject leaves the value unchanged.
- **EC-9.2** Before a record is saved, a replace audit stores only the suggestionId, the field, decision replaced, and the suggested value. It does not store a client-typed previous value. On save, the payment create audit records source ocr_replace and the suggestionId. A request that contains clientPriorValue returns 422. A bulk accept-all returns 422.
