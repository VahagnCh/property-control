# Mobile edge-case matrix

Status is **covered now** only when a Jest test asserts the behavior. **Pending feature** means the outbox, API client, auth refresh, evidence upload, or the screen that owns the case is not in this repo yet. Those rows name the test to add when that piece lands. Pure helpers under `apps/mobile/src` are real; they are not stand-ins for a network call.

Payments stay void-only. There is no payment DELETE route and no `deletedAt` on a payment. Do not add either.

The device under test is UTC. Due labels, paid-date limits, and the nextDueDate input window take the property IANA time zone (`Property.timezone`, default `America/Mexico_City`) and do not read the device zone.

TS-D7 is not a mobile row. This client does not claim it.

## Shell and task-3 cases

| Case | Status | Test |
| :---- | :---- | :---- |
| Five tabs, order Inicio · Propiedades · Pagos · Mantenimiento · Documentos, each with an accessibility role and label | Covered now | `src/navigation/tabs.test.tsx` |
| Pagos copy says DueRecord does not move money, and the comprobante is optional | Covered now | `src/navigation/tabs.test.tsx` |
| Copy lint over tab labels, screen copy, and `app.json` name. Fails on pagar ahora, enviar pago, pagar, cobrar, transferir, depositar, cartera, wallet, banco, SAT, Hacienda, paga tu. `no mueve dinero` passes | Covered now | `src/copy/copyLint.test.ts` |
| Accents á é í ó ú ñ ü ¿ ¡ and a string longer than 4000 characters render intact | Covered now | `src/screens/longCopy.test.tsx` |
| Window 320×568 and fontScale 2: all five tab labels stay present and accessible | Covered now | `src/navigation/tabs.test.tsx` |
| Empty, loading, and error-with-retry on all five tabs. Shared Spanish copy, no money-movement wording | Covered now | `src/components/ScreenState.test.tsx` (`ScreenState`) |
| “Vence hoy” / “Vence mañana” at 23:59, 00:00, and 00:01 in the property zone, on a UTC device, and for a non-default property zone | Covered now | `src/dates/dueLabel.test.ts` |
| Idempotency key reused on retry, including a second tap while a submit is in flight | Covered now | `src/outbox/idempotency.test.ts` |
| Offline save and a slow network | Pending feature | When the outbox and API client land, add `src/outbox/outbox.test.ts`: with the client offline, recording a payment enqueues one item and shows “Pendiente de sincronizar”; the same idempotency key survives a store reload. With the client delayed, the row stays pending and a second tap does not enqueue a second key (`pressRecordSubmit` already rejects the second tap). |
| Retry mid-upload | Pending feature | When evidence upload lands, add `src/evidence/uploadRetry.test.ts`: fail the PUT after the first chunk, retry, and assert the same idempotency key and the same evidence id. Exactly one evidence row. `beginIdempotentWrite` is the key helper to call. |
| Expired session with refresh | Pending feature | When auth refresh lands, add `src/auth/sessionRefresh.test.ts`: a 401 on a payment read calls refresh once and retries once; a failed refresh leaves the payment list unchanged and shows the sign-in screen. Do not invent a refresh token in the test double; drive the client with a fixture past `exp`. |
| Denied camera or file permission | Pending feature | When the evidence picker lands, add `src/evidence/permissions.test.ts`: a denied camera result and a denied file result each show Spanish copy, do not open a picker result as a comprobante, and do not block saving the payment without one. |
| Backgrounding during upload | Pending feature | When evidence upload lands, add `src/evidence/backgroundUpload.test.ts`: `AppState` `background` mid-PUT resolves to one evidence row, reusing the key from `beginIdempotentWrite`. A second foreground resume must not create another row. |
| Wrong-account invite (decided 20 Oct: 404, same code as an unknown token, and that check runs before 410 and 409) | Covered now | `src/invites/inviteErrors.test.ts`. A known token on the wrong account is `reason: 'wrong_account'`, status 404, including when the token is also used, revoked, superseded, expired, or the person is already a member. Every 404 on accept, unknown token or wrong account, uses `invite.unavailable`: “Esta invitación no está disponible. Pide a quien te invitó que te envíe una nueva.” A 410 uses `invite.expired`: “Esta invitación ya no se puede usar. Pide una nueva.” A defensive 403 on accept uses `invite.unavailable`. A non-owner invite action stays 403 with its own message. |
| Auth tokens in expo-secure-store | Pending feature | When auth lands, add `src/auth/tokenStore.test.ts`: the token store module imports only `expo-secure-store` (Keychain on iOS, Keystore on Android) and does not import AsyncStorage. Add a lint rule that bans AsyncStorage for tokens. Tokens are never stored in AsyncStorage. |

## Record-payment helpers

| Case | Status | Test |
| :---- | :---- | :---- |
| OCR `applyOcrSuggestion` fills only an existing empty field, never adds a field, never overwrites a user value, and writes only after confirm. High confidence does not skip confirm. `acceptAll: true` writes nothing. AC-OCR-11 overwrite is `replaceField` only, one field at a time | Covered now | `src/ocr/applyOcrSuggestion.test.ts` |
| AC-OCR-11 Reemplazar. A confirmed per-field replace may overwrite a typed value and returns `previousValue` for a local undo. The confirm request is `{ decisions: [{ suggestionId, action, editedValue?, targetEntityId? }] }`. `action` is `accept` for an empty field, `replace` for Reemplazar, `edit` with `editedValue` when the person corrects the suggestion (the same text rules), and `reject` for Rechazar, Mantener, and every unreviewed row. Every suggestion id appears once. `decision`, `field`, `suggestedValue`, and `clientPriorValue` are not sent. `targetEntityId` is sent only for an unbound row. A typed value is refused before send. For a record that is already saved, the server logs the persisted previous value itself, so the client sends nothing extra. Row copy is `Reemplazar «{actual}» por «{sugerido}»`, with “Mantener lo que escribí” default and highlighted, and toast “Valor reemplazado. Puedes editarlo antes de registrar.” Empty fields still fill only after confirm. No bulk replace | Covered now | `src/ocr/applyOcrSuggestion.test.ts`, `src/ocr/OcrReplaceRow.test.tsx` |
| AC-OCR-09. No “Aceptar todas” or similar accept-all label in user-facing copy or a rendered OCR row. On Registrar, every unreviewed suggestion is serialized as `action: 'reject'`, each suggestion id appears once, and those suggestions never change the form. Copy: “Las sugerencias sin revisar se descartarán al registrar.” | Covered now | `src/ocr/noAcceptAll.test.tsx`, `src/ocr/applyOcrSuggestion.test.ts` |
| Confidence word prefers the server `band` (`alta` / `media` / `revisa`). If the band is missing, the score fallback is Revisa below 0.80 or when there is no score; 0.80–0.90 is Media and at or above 0.90 is Alta. Does not write the field | Covered now | `src/ocr/confidenceBand.test.ts` |
| OCR confirm errors are mapped by error code, not by HTTP status. `edited_value_invalid` and `retarget` use `ocr.edit.invalid`: “Este valor no es válido. Revisa el formato e inténtalo de nuevo.” `field_already_set` (accept or edit on a field that is already saved, HTTP 409) uses `ocr.field.alreadySet`: “Este campo ya estaba guardado. Usa Reemplazar si quieres cambiarlo.” and refresh. `missing_decision` is logged and shows the generic error. A 422 or 409 with no matching code does not use these messages | Covered now | `src/ocr/ocrEditError.test.ts` |
| Text input rejects, and does not strip, C1 controls (U+0080–U+009F), bidi overrides (U+202A–U+202E, U+2066–U+2069), and zero-width characters (U+200B–U+200D, U+FEFF, U+2060) on every field. A single-line field also rejects every C0 character, including tab, LF, and CR. A multi-line note may contain LF and still rejects tab, CR, and the other C0 characters. Key `form.text.invalidChars`. Accents, ñ, ¿, and ¡ pass. Title max 300 characters. Body and note max 32 KB | Covered now | `src/forms/textInput.test.ts` |
| Comprobante optional: validation passes with evidence omitted, null, or blank. A missing comprobante is not an issue | Covered now | `src/payments/recordPayment.test.ts` |
| Paid date in the property zone (AC-DATE-01, EC-7.1): back one calendar year (365 or 366 days, 29 Feb clamped). Maximum is today. Today is accepted and today+1 is rejected. The server’s +1 day is clock-skew tolerance and the client never offers it. 23:59, 00:00, 00:01, UTC device, America/Tijuana and America/Cancun. Default zone America/Mexico_City | Covered now | `src/payments/paidDate.test.ts` |
| nextDueDate client window (AC-OBL-01, AC-OBL-02): today−1y through today+5y in the property zone, including the exact edges, 29 Feb, midnight, a UTC device, and a non-default zone. The database bound 1990–2100 is not a client rule | Covered now | `src/dates/nextDueDate.test.ts` |
| AC-OBL-03. A 422 on nextDueDate maps to the Spanish field error `obligation.nextDueDate.invalid`. Other statuses do not | Covered now | `src/dates/nextDueDate.test.ts` |
| Wire money is `{ amount, currency: 'MXN' }`. Decimal string ↔ integer centavos, no JS floats. `0.00`, `1234.5` → `1234.50`, reject >2 decimals, negative, empty, and any currency other than `MXN`. Display `$1,234.50` is not the wire value | Covered now | `src/payments/money.test.ts` |
| Viewer and non-member hide Anular. Viewer denial is 403 and the message is exactly “No tienes permiso para anular este pago”; the payment object is unchanged. Non-member denial is 404 with a different message, payment unchanged. Neither asks for a refresh | Covered now | `src/payments/voidPayment.test.tsx` |
| Void is `POST /v1/properties/:propertyId/payments/:paymentId/void` with body `{ voidReason }` only (trimmed, 1–500). It is not a PATCH and the body has no `status` | Covered now | `src/payments/voidPayment.test.tsx` (`buildVoidPaymentRequest`) |
| AC-PAY-21. A 409 on a second void shows exactly “Este pago ya estaba anulado.” and `refresh: true`. The payment object is unchanged | Covered now | `src/payments/voidPayment.test.tsx` |
| Invite statuses: unknown token 404, wrong account 404 (decided; check runs first), used/revoked/superseded/expired 410, already member 409, non-owner 403. Every accept-route 404 uses `invite.unavailable`. Every 410 uses `invite.expired`. A defensive 403 on accept also uses `invite.unavailable`. Expiry is sentAt + 7×24h, including the exact instant | Covered now | `src/invites/inviteErrors.test.ts` |

## Mobile-owned rows (42)

Owner is UX/Mobile on Tally’s matrix (40 UX acceptance checks plus TS-11.7 and TO-6.1-NOPREFILL). Shared rows are not in this list.

| Id | Priority | Status | Test now, or the test to add |
| :---- | :---- | :---- | :---- |
| AC-GEN-01 | P0 | Covered now | `src/copy/copyLint.test.ts` walks the strings. `src/navigation/tabs.test.tsx` asserts the Pagos disclaimer. The Pay3 screen is not built; the disclaimer string is the Pagos placeholder until that screen replaces it, and the lint keeps covering it. |
| AC-PAY-02 | P1 | Pending feature | When Pay3 lands, add `src/payments/recordPaymentScreen.test.tsx`: opening Pay3 from a partial row with 40000 centavos remaining prefills the amount `400.00` only when the amount field is empty, and the row action reads “Registrar otro pago”. |
| AC-PAY-06 | P2 | Pending feature | When Pay3 lands, add to that file: amount above the expected amount shows the overage sentence and the save control stays enabled. |
| AC-PAY-10 | P1 | Pending feature | When Pay3 lands, add `src/payments/duplicateWarning.test.ts`: a recorded payment of the same centavos within 0–3 property-zone days returns the warning before any client call; 4 days does not. |
| AC-PAY-11 | P1 | Pending feature | Same file: “Registrar de todos modos” sends a new idempotency key, “Cancelar” sends nothing, “Ver pago existente” opens the payment detail. |
| AC-PAY-12 | P2 | Pending feature | Same file: a voided payment with the same amount and date does not warn. |
| AC-PAY-19 | P1 | Pending feature | Same file: a different centavo amount does not warn, and a replay of the same key does not warn again. |
| AC-PAY-13 | P0 | Pending feature | `src/outbox/idempotency.test.ts` already keeps a single key across a double tap. When the API client lands, extend it: the second tap does not call the client, and one POST is sent. |
| AC-PAY-17 | P1 | Pending feature | When the payment list lands, add `src/payments/voidedRow.test.tsx`: a voided row is struck through, labeled “Anulado”, and omitted from the period total. |
| AC-PAY-18 | P2 | Covered now | `src/payments/voidPayment.test.tsx` (`validateVoidReason`). The void sheet’s confirm control stays disabled while that helper returns `{ ok: false }`. The request built from a valid reason is POST `…/payments/:paymentId/void` with `{ voidReason }` only. |
| AC-PAY-21 | — | Covered now | UX spec v1.2 rev d, outside the original 42. `src/payments/voidPayment.test.tsx`: a 409 shows exactly “Este pago ya estaba anulado.”, returns `refresh: true`, and leaves the payment object unchanged. |
| AC-EV-02 | P1 | Pending feature | When evidence upload lands, add `src/evidence/nudge.test.ts`: the first save without a file shows the nudge once; the second save in the same session does not; a new session shows it again. |
| AC-EV-06 | P1 | Pending feature | When evidence upload lands, add `src/evidence/damagedFile.test.tsx`: a corrupt PDF and a 0-byte image show copy, offer another file or saving without a comprobante, and the payment still validates with no evidence id. |
| AC-OCR-01 | P0 | Covered now | `src/ocr/applyOcrSuggestion.test.ts`: confidence 0.55 and 0.97 leave the existing amount in place until confirm. No silent prefill at any confidence. |
| AC-OCR-03 | P0 | Covered now | Same file: `applyOcrSuggestion` keeps a user-entered amount when a confirmed suggestion names that field. Overwrite is only the explicit AC-OCR-11 `replaceField` path. |
| AC-OCR-06 | P0 | Pending feature | When the OCR review sheet lands, add `src/ocr/reviewSheet.test.tsx`: a failed job shows “No pudimos leer el documento. Llena los datos a mano.”, fields stay editable, and save succeeds with the file kept. |
| AC-OCR-07 | P2 | Pending feature | Same file, offline: attaching a document does not call the job route and shows offline copy. |
| AC-OCR-09 | P0 | Covered now | No accept-all control anywhere. `src/ocr/noAcceptAll.test.tsx` asserts user-facing copy and the rendered OCR row contain no “Aceptar todas” or a similar accept-all label. On Registrar, `confirmOnRegistrar` serializes each unreviewed suggestion as `action: 'reject'`, covers every suggestion id once, and leaves the form unchanged. Copy: “Las sugerencias sin revisar se descartarán al registrar.” |
| AC-OCR-10 | P1 | Covered now | `src/ocr/confidenceBand.test.ts`: a server band wins over the score (`alta` at 0.10 is Alta, `revisa` at 1 is Revisa). A missing band with no score is Revisa. |
| AC-OFF-01 | P0 | Pending feature | See “Offline save” above. |
| AC-OFF-02 | P0 | Pending feature | See “Offline save” above (reload keeps the same key). |
| AC-OFF-07 | P2 | Pending feature | When the outbox lands, add `src/outbox/partialEstimate.test.ts`: an offline partial shows a local estimate labeled as not yet synced, and the server body replaces that estimate. |
| AC-DATE-01 | P0 | Covered now | Picker max is today in the property zone (`paidDateWindow.max === today` in `src/payments/paidDate.test.ts`). Today is allowed and today+1 is rejected. The server’s +1 day is clock-skew tolerance only. Due labels stay in `src/dates/dueLabel.test.ts`. |
| AC-DATE-03 | P2 | Pending feature | When Pay3 lands, add `src/payments/periodPrompt.test.tsx`: a paid date inside the open period does not ask which period; the helper already accepts that past date inside the one-year window. |
| AC-DATE-06 | P0 gap | Covered now | `src/payments/paidDate.test.ts`: 21 Oct 2025 is in range on 21 Oct 2026, 20 Oct 2025 is `too_old`. Today+1 is `too_future`. The date picker disables days the helper rejects. |
| AC-DATE-05 | P2 | Pending feature | When Pay3 has the obligation start date, add to `paidDate.test.ts` a warning (not a block) when paidDate is before that start, and assert `validateRecordPayment` still returns ok. |
| AC-CTX-01 | P1 | Pending feature | When Pay3 lands, add `src/payments/context.test.tsx`: three properties render a property selector first, then only active obligations. |
| AC-CTX-02 | P1 | Pending feature | Same file: Pay3 opened from an obligation shows a fixed header and no selectors. |
| AC-CTX-03 | P1 | Pending feature | Same file: zero properties shows empty copy and “Agregar propiedad”, and does not show Pay3. |
| AC-CTX-04 | P1 | Pending feature | Same file: only paused or archived obligations show “no tiene obligaciones activas” and “Agregar obligación”. |
| AC-CTX-05 | P2 | Pending feature | Same file: one property skips the property selector. |
| AC-EMPTY-01 | P1 | Pending feature | The shared empty state is not this screen. When the Pagos list lands, add `src/payments/emptyList.test.tsx`: zero payments shows the empty copy and “Registrar pago” opens Pay3. |
| AC-EMPTY-02 | P2 | Pending feature | When Inicio has no properties, add `src/home/emptyHome.test.tsx`: the call to action is “Agregar propiedad”. |
| AC-EMPTY-03 | P2 | Pending feature | When payment history is empty, add to `emptyList.test.tsx` the history copy and a prefilled “Registrar pago”. |
| AC-EMPTY-04 | P2 | Pending feature | When the Sin comprobante filter is empty, add to that file: “Todos tus pagos tienen comprobante.” |
| AC-PUSH-03 | P1 | Pending feature | When deep links and auth land, add `src/navigation/deepLink.test.tsx`: `duerecord://notificaciones/<nid>` with a session opens Pay3 prefilled; without a session it opens sign-in and then Pay3. The link carries no token. This is also TS-11.7. |
| AC-SRC-02 | P1 | Covered now | `src/ocr/confidenceBand.test.ts` score fallback when `band` is missing: 0.95 Alta, 0.85 Media, 0.79 Revisa, null Revisa. A server band still wins. |
| AC-SRC-03 | P1 | Pending feature | When the review sheet and crop URL land, add `src/ocr/snippet.test.ts`: under 30 days, a crop-url 404 shows the quoted snippet, otherwise “Pág. n”; at 30 days or more, only “Pág. n” and crop-url is not requested. |
| AC-SRC-04 | P1 | Pending feature | Same file: the crop accessibility label reads the masked snippet or the value plus the page. |
| AC-SRC-06 | P1 | Pending feature | When the page image lands, add `src/ocr/bbox.test.ts`: page 2 bbox `[0.10, 0.20, 0.30, 0.05]` on a 1000×1400 image requests `pages/2/image-url` and draws x=100, y=280, w=300, h=70. |
| AC-SRC-07 | P2 | Pending feature | Same file: at 30 days or more, image-url 404 opens the original without a highlight. |
| TS-11.7 | P0 | Pending feature | Same deep-link test as AC-PUSH-03. Assert the URL has no access token, refresh token, or OTP. |
| TO-6.1-NOPREFILL | P0 | Covered now | `src/ocr/applyOcrSuggestion.test.ts`: no prefill at any confidence, no accept-all, nothing written before confirm. Empty fields still fill only after confirm. |

## Rows added 20 Oct (record-payment spec rev f)

These are mobile rows beyond the original 42. TS-D7 is not one of them.

| Id | Status | Test |
| :---- | :---- | :---- |
| AC-OCR-11 | Covered now | Per-field Reemplazar in `src/ocr/applyOcrSuggestion.test.ts` and `src/ocr/OcrReplaceRow.test.tsx`. The confirm request is `{ decisions: [{ suggestionId, action: 'accept' \| 'reject' \| 'edit' \| 'replace', editedValue?, targetEntityId? }] }`. Empty-field confirm is `accept`. Reemplazar is `replace`. A correction of the suggested value is `edit` with `editedValue`, and that text must pass the same validation. Rechazar, Mantener, and every unreviewed row are `reject`. Every suggestion id appears once. `decision`, `field`, `suggestedValue`, and `clientPriorValue` are not sent. `targetEntityId` is sent for an unbound row and omitted when the row is already bound. `previousValue` is a local undo only. For a record that is already saved, the server logs the persisted previous value itself, so the client sends nothing extra. Accept or edit on a saved field maps `field_already_set` by code to `ocr.field.alreadySet` and refresh. |
| AC-OBL-01 | Covered now | `src/dates/nextDueDate.test.ts`: today−1y and today+5y are accepted in the property zone, and the days just outside are rejected. Default zone `America/Mexico_City`. |
| AC-OBL-02 | Covered now | Same file: 29 Feb (including the clamp when the target year has no 29 Feb), midnight at 23:59, 00:00, and 00:01, a UTC device, and America/Tijuana. The client does not apply the 1990–2100 database bound. |
| AC-OBL-03 | Covered now | Same file: a 422 maps to `obligation.nextDueDate.invalid`, “La próxima fecha no es válida. Revisa el valor e inténtalo de nuevo.” Other statuses do not. |

## Shared rows exercised by these helpers

These are not part of the 42. The mobile half is covered; the API half stays with Backend.

| Id | Mobile status | Test |
| :---- | :---- | :---- |
| AC-GEN-02 | Covered now for hiding Anular and the 403 message. The POST 403 and the audit assertion wait on the API | `src/payments/voidPayment.test.tsx` |
| AC-EV-01 | Covered now for “save without a comprobante is valid”. The 201 and the paywall assertion wait on the API | `src/payments/recordPayment.test.ts` |
| AC-DATE-02, MC-08, PR-P3 | Covered now for the property-zone window. The client maximum is today (AC-DATE-01, EC-7.1). The server’s +1 day is clock-skew tolerance and is not offered. The one-year minimum is covered. The HTTP 201/422 assertion waits on the API | `src/payments/paidDate.test.ts` |
| EC-7.1 | Covered now on the client: the record-payment picker maximum is today in the property timezone, and today+1 is rejected. Server acceptance of `paidAt` up to +24 hours is clock-skew tolerance only. The 422 for a later instant waits on the API | `src/payments/paidDate.test.ts` |
| PR-L6 | Covered now for the strings that exist in the shell, including the Reemplazar copy and the new field errors | `src/copy/copyLint.test.ts` |
