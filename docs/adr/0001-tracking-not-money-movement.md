# ADR 0001 — Track money, do not move it

- **Status:** Accepted
- **Date:** 2 Oct 2026
- **Source:** [Product brief confirmed v1.1](https://docs.google.com/document/d/1F_DSJG5Fo6G3WXyGXJWyqscMp8LC9SbEqgGj-c68ric/edit), principle 1 of [Backend formal v0](https://docs.google.com/document/d/1iekHZp5lOq4qTzLhglFproL2JSeI7Uw1q4I817d40dE/edit)

## Context

DueRecord helps a multi-property owner in Mexico see what is owed, when it is due, what was paid, and the proof. "Pay the predial for me" is a natural next thought, and it is a different product.

Moving money means a payment processor or a bank integration, custody of funds in some form, PCI scope, money transmission licensing in Mexico, chargeback and dispute handling, reconciliation against a ledger that must balance, and a support obligation when a payment fails at 11pm on a due date. Each of those is larger than the tracking product, and none of them is needed to answer the question the user actually has, which is "what do I owe and did I pay it".

## Decision

The MVP records obligations and payments. It never moves funds.

Specifically, not in this system:

- Payment processing, charging a card, debiting an account, wallets, payouts, escrow
- Bank aggregation or Open Banking
- Stored payment instruments: card tokens, account numbers, routing details
- Balances, ledgers that must reconcile, clearing or settlement state

A `Payment` row is a record of something the person already did somewhere else. `payments.method` and `obligations.preferred_method` are descriptive strings a person typed — "SPEI", "efectivo" — not instructions to a processor.

## Consequences

Good:

- No PCI scope, no money transmission licensing, no chargeback or dispute workflow in the MVP
- A payment can be recorded late, out of order, partially, or for an amount nobody can verify, because the row is a claim by the person and not a transaction
- Evidence can be optional. If the system moved money it would own the proof; because the person moved the money, their receipt is the proof, and demanding it would break the core loop
- The data model stays small, and the trust surface is files and memberships rather than funds

Accepted costs:

- The person still leaves the app to pay. The loop is remind, pay elsewhere, come back and record.
- Amounts are self-reported, so reports are as accurate as the person's entries
- If Product later wants real payments, that is a new architecture, a new compliance posture, and probably a separate service. It is not an extension of this one.

## Enforcement

A pull request that adds a payment processor SDK, a bank aggregation client, a stored payment instrument, or a balance field contradicts this ADR and should be rejected. Reopening this is a Product decision announced in the DueRecord channel, not a code review outcome.

In this scaffold: the Prisma schema has no instrument, balance, or clearing column; `overpaidAmount` is the excess recorded on one period and is not a credit the next period can draw; `PaymentsController` records and voids and nothing else; and the Pagos tab in `apps/mobile` says the app does not move money.
