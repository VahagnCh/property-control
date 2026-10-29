-- Checks and partial unique indexes Prisma cannot express.
-- The first migration runs this file after the Prisma tables exist.
-- Names and predicates are the contract in docs/EDGE_CASES.md.

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_expected_amount_positive;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_expected_amount_positive CHECK (
    expected_amount IS NULL OR expected_amount > 0
  );

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
  DROP CONSTRAINT IF EXISTS obligations_next_due_date_sanity;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_next_due_date_sanity CHECK (
    next_due_date IS NULL
    OR (
      next_due_date >= DATE '1990-01-01'
      AND next_due_date <= DATE '2100-12-31'
    )
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
    size_bytes > 0 AND size_bytes <= 10485760
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_byte_size_cap;
ALTER TABLE documents
  ADD CONSTRAINT documents_byte_size_cap CHECK (
    byte_size > 0 AND byte_size <= 10485760
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

ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_expires_within_7_days;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_expires_within_7_days CHECK (
    expires_at <= now() + interval '7 days'
  );

ALTER TABLE refresh_tokens
  DROP CONSTRAINT IF EXISTS refresh_tokens_absolute_cap;
ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_absolute_cap CHECK (
    absolute_expires_at >= issued_at
    AND expires_at >= issued_at
    AND expires_at <= absolute_expires_at
    AND absolute_expires_at <= issued_at + interval '90 days'
  );

ALTER TABLE rate_limits
  DROP CONSTRAINT IF EXISTS rate_limits_attempt_count_nonnegative;
ALTER TABLE rate_limits
  ADD CONSTRAINT rate_limits_attempt_count_nonnegative CHECK (attempt_count >= 0);

-- plpgsql is built in. This is not an extension.
-- TG_TABLE_NAME keeps the consent message "consents are append-only".
CREATE OR REPLACE FUNCTION append_only_reject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% are append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS consents_append_only_update ON consents;
CREATE TRIGGER consents_append_only_update
  BEFORE UPDATE ON consents
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS consents_append_only_delete ON consents;
CREATE TRIGGER consents_append_only_delete
  BEFORE DELETE ON consents
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS consents_append_only_truncate ON consents;
CREATE TRIGGER consents_append_only_truncate
  BEFORE TRUNCATE ON consents
  FOR EACH STATEMENT
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS audit_events_append_only_update ON audit_events;
CREATE TRIGGER audit_events_append_only_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS audit_events_append_only_delete ON audit_events;
CREATE TRIGGER audit_events_append_only_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS audit_events_append_only_truncate ON audit_events;
CREATE TRIGGER audit_events_append_only_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS aviso_versions_append_only_update ON aviso_versions;
CREATE TRIGGER aviso_versions_append_only_update
  BEFORE UPDATE ON aviso_versions
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS aviso_versions_append_only_delete ON aviso_versions;
CREATE TRIGGER aviso_versions_append_only_delete
  BEFORE DELETE ON aviso_versions
  FOR EACH ROW
  EXECUTE FUNCTION append_only_reject();

DROP TRIGGER IF EXISTS aviso_versions_append_only_truncate ON aviso_versions;
CREATE TRIGGER aviso_versions_append_only_truncate
  BEFORE TRUNCATE ON aviso_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION append_only_reject();

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_not_empty;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_not_empty CHECK (length("text") > 0);

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_not_blank;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_not_blank CHECK ("text" !~ '^[[:space:]]*$');

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_sha256_matches;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_sha256_matches CHECK (
    text_sha256 = encode(sha256(convert_to("text", 'UTF8')), 'hex')
  );

DROP INDEX IF EXISTS idempotency_keys_user_scope;
CREATE UNIQUE INDEX idempotency_keys_user_scope
  ON idempotency_keys (user_id, method, route, key)
  WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS idempotency_keys_email_scope;
CREATE UNIQUE INDEX idempotency_keys_email_scope
  ON idempotency_keys (email_hmac, method, route, key)
  WHERE email_hmac IS NOT NULL;

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_one_subject;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_one_subject CHECK (
    (user_id IS NOT NULL AND email_hmac IS NULL)
    OR (user_id IS NULL AND email_hmac IS NOT NULL)
  );

-- UUID defaults use core gen_random_uuid() (PostgreSQL 13+). No extension.

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE properties ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE property_memberships ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligation_period_outcomes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligation_pause_intervals ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE evidence ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE maintenance_tasks ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE reminders ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE notification_deliveries ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE membership_invites ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE ocr_jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE ocr_suggestions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE idempotency_records ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE consents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE idempotency_keys ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE auth_code_attempts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE rate_limits ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Trust rev f.5. source_key is {env}/evidence/{uuid} or {env}/documents/{uuid}.
-- env is staging or prod. The key has no property id. Ownership stays on the row.
-- OCR jobs store the document key the stub builds.

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_key_shape;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/evidence/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_source_key_shape;
ALTER TABLE documents
  ADD CONSTRAINT documents_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE ocr_jobs
  DROP CONSTRAINT IF EXISTS ocr_jobs_source_key_shape;
ALTER TABLE ocr_jobs
  ADD CONSTRAINT ocr_jobs_source_key_shape CHECK (
    source_key ~ '^(staging|prod)/documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
