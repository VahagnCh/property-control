# ADR 0002 — OCR suggests, a person confirms

- **Status:** Accepted
- **Date:** 2 Oct 2026
- **Source:** [Product brief v1.1](https://docs.google.com/document/d/1F_DSJG5Fo6G3WXyGXJWyqscMp8LC9SbEqgGj-c68ric/edit) (OCR moved into the MVP on 30 Sep 2026), principle 2 and section 5b of [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit)

## Context

Typing a mortgage into a phone is miserable: the amount, the day of the month, the lender, the folio. The document already contains all of it, so extraction is the obvious feature, and the obvious implementation is to fill the form automatically when confidence looks high.

That implementation is wrong for this product. The extracted values are exactly the fields the user relies on: what is owed and when. A wrong amount or a wrong date, written quietly, produces a reminder on the wrong day or a period that reconciles wrong, and the person has no reason to suspect the number they never typed. The failure is silent and it is discovered late, which is the worst shape for an error in a product whose entire value is "you can trust this list".

Mexican municipal and lender documents vary enough that confidence scores are not a reliable proxy for correctness, and a plausible-looking wrong number is the common failure, not an obvious one.

## Decision

OCR extracts and **suggests**. A person reviews, optionally edits, and **confirms**. Only then is anything written.

The rule in one line: **nothing applies to an Obligation, Payment, Property, or Document except inside the handler for `POST /v1/properties/:propertyId/ocr-jobs/:ocrJobId/confirm`.**

That means:

- A job reaching `suggested` writes nothing. `suggested` is a waiting state.
- There is no confidence threshold above which a field applies by itself. Confidence is shown to the person and is not an authorization.
- There is no "apply if the field is empty" shortcut.
- A vendor callback cannot apply a value. The vendor returns suggestions; the API persists them as suggestions.
- Rejecting every suggestion ends the job `rejected`, writes no field, and leaves the document stored.
- The accepted set applies in one transaction. A partial failure is a 409 or 422, not a half-applied form.
- Every applied field appends an audit event, and the confirm response lists exactly what was written.

Spanish microcopy on the review sheet states the rule to the user: "Revisa y confirma antes de guardar. Nada se aplica solo."

## Consequences

Good:

- A wrong extraction costs a glance, not a silently wrong due date
- The person sees the document's values next to the fields, which is a better review than an already-filled form they are invited to trust
- The audit trail answers "what did OCR change" exactly, because the confirm handler is the only writer
- The vendor boundary is narrow: the worst a bad extract can do is waste the person's time

Accepted costs:

- One extra screen in the upload flow, so it is not the one-tap magic a demo would want
- The review sheet is real work for the client, including per-field editing
- A person who trusts the output still taps through it, which is why `ocr_confirm_rate` is a tracked KPI rather than an assumption

## Enforcement

The in-memory stub in `apps/api/src/ocr/ocr.service.ts` finishes the extract and stops at `suggested` with every suggestion `pending`. `confirm` is the only method that changes `applyStatus`, and the stub returns `persisted: false` because it writes nothing at all.

`apps/api/src/ocr/ocr.service.spec.ts` asserts that a finished job leaves every suggestion pending, that rejecting everything applies nothing, that accepting without a target fails rather than guessing, and that the service exposes no obligation or payment writer. Breaking this rule should break a test.

When persistence replaces the stub, the confirm handler is the only place entity writes belong. A pull request that applies a suggestion anywhere else contradicts this ADR.
