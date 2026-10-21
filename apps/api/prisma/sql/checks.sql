-- Checks and partial unique indexes Prisma cannot express.
-- The first migration runs this file after the Prisma tables exist.
-- Names and predicates are the contract in docs/EDGE_CASES.md.

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_currency_mxn;
ALTER TABLE payments
  ADD CONSTRAINT payments_currency_mxn CHECK (currency = 'MXN');

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_void_fields_match_status;
ALTER TABLE payments
  ADD CONSTRAINT payments_void_fields_match_status CHECK (
    (
      status = 'voided'
      AND voided_at IS NOT NULL
      AND voided_by IS NOT NULL
      AND void_reason IS NOT NULL
    )
    OR (
      status = 'recorded'
      AND voided_at IS NULL
      AND voided_by IS NULL
      AND void_reason IS NULL
    )
  );

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_void_reason_length;
ALTER TABLE payments
  ADD CONSTRAINT payments_void_reason_length CHECK (
    void_reason IS NULL
    OR char_length(btrim(void_reason)) BETWEEN 1 AND 500
  );

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_currency_mxn;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_currency_mxn CHECK (currency = 'MXN');

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_due_day_range;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_due_day_range CHECK (
    due_day IS NULL OR (due_day >= 1 AND due_day <= 31)
  );

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_anchor_requires_due_day;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_anchor_requires_due_day CHECK (
    (due_day IS NULL AND schedule_anchor IS NULL)
    OR (due_day IS NOT NULL AND schedule_anchor IS NOT NULL)
  );

ALTER TABLE obligation_period_outcomes
  DROP CONSTRAINT IF EXISTS obligation_period_outcomes_overpaid_nonnegative;
ALTER TABLE obligation_period_outcomes
  ADD CONSTRAINT obligation_period_outcomes_overpaid_nonnegative CHECK (overpaid_amount >= 0);

ALTER TABLE obligation_period_outcomes
  DROP CONSTRAINT IF EXISTS obligation_period_outcomes_not_applicable_has_no_payment;
ALTER TABLE obligation_period_outcomes
  ADD CONSTRAINT obligation_period_outcomes_not_applicable_has_no_payment CHECK (
    outcome <> 'not_applicable' OR payment_id IS NULL
  );

ALTER TABLE obligation_pause_intervals
  DROP CONSTRAINT IF EXISTS obligation_pause_intervals_resume_on_or_after_pause;
ALTER TABLE obligation_pause_intervals
  ADD CONSTRAINT obligation_pause_intervals_resume_on_or_after_pause CHECK (
    resumed_on IS NULL OR resumed_on >= paused_on
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_one_parent;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_one_parent CHECK (
    (payment_id IS NOT NULL AND maintenance_task_id IS NULL)
    OR (payment_id IS NULL AND maintenance_task_id IS NOT NULL)
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_content_type_allowlist;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_content_type_allowlist CHECK (
    content_type IN ('image/jpeg', 'image/png', 'application/pdf')
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_content_type_allowlist;
ALTER TABLE documents
  ADD CONSTRAINT documents_content_type_allowlist CHECK (
    content_type IN ('image/jpeg', 'image/png', 'application/pdf')
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_byte_size_cap;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_byte_size_cap CHECK (
    byte_size > 0 AND byte_size <= 15728640
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_byte_size_cap;
ALTER TABLE documents
  ADD CONSTRAINT documents_byte_size_cap CHECK (
    byte_size > 0 AND byte_size <= 15728640
  );

ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS reminders_one_parent;
ALTER TABLE reminders
  ADD CONSTRAINT reminders_one_parent CHECK (
    (obligation_id IS NOT NULL AND maintenance_task_id IS NULL)
    OR (obligation_id IS NULL AND maintenance_task_id IS NOT NULL)
  );

DROP INDEX IF EXISTS reminders_obligation_id_scheduled_for_channel_key;
CREATE UNIQUE INDEX reminders_obligation_id_scheduled_for_channel_key
  ON reminders (obligation_id, scheduled_for, channel)
  WHERE obligation_id IS NOT NULL;

DROP INDEX IF EXISTS reminders_maintenance_task_id_scheduled_for_channel_key;
CREATE UNIQUE INDEX reminders_maintenance_task_id_scheduled_for_channel_key
  ON reminders (maintenance_task_id, scheduled_for, channel)
  WHERE maintenance_task_id IS NOT NULL;

ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_role_not_owner;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_role_not_owner CHECK (
    role IN ('member', 'viewer')
  );

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
