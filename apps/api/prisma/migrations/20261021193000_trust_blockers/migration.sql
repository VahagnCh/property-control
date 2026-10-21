-- Trust blockers. The app role is created outside this file: CREATE ROLE
-- cannot run inside Prisma's migration transaction. See
-- apps/api/prisma/bootstrap-app-role.sh. The password there is a test-database
-- secret. Production sets the role password outside this repository.

-- Money columns are BIGINT centavos. The API wire format stays a decimal
-- peso string. expected_amount stays nullable and, when set, must be > 0.
ALTER TABLE obligations
  ALTER COLUMN expected_amount TYPE BIGINT;

ALTER TABLE payments
  ALTER COLUMN amount TYPE BIGINT;

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_expected_amount_positive;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_expected_amount_positive CHECK (
    expected_amount IS NULL OR expected_amount > 0
  );

-- Aviso text is stored in full. Existing rows get an empty placeholder so
-- the column can be NOT NULL. A later seed that disagrees with that text
-- fails instead of overwriting it.
ALTER TABLE aviso_versions
  ADD COLUMN text TEXT NOT NULL DEFAULT '';
ALTER TABLE aviso_versions
  ALTER COLUMN text DROP DEFAULT;

-- Invites store an HMAC, never the plain email, and a superseded state.
-- expires_at cannot be more than 7 days after created_at.
DROP INDEX IF EXISTS membership_invites_property_id_email_idx;
ALTER TABLE membership_invites
  RENAME COLUMN email TO email_hmac;
CREATE INDEX membership_invites_property_id_email_hmac_idx
  ON membership_invites (property_id, email_hmac);
ALTER TABLE membership_invites
  ADD COLUMN superseded_at TIMESTAMPTZ(6);
ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_expires_within_7_days;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_expires_within_7_days CHECK (
    expires_at <= created_at + interval '7 days'
  );

-- Idempotency is scoped by user or email HMAC, plus method and route.
-- Partial unique indexes because either subject column is nullable.
ALTER TABLE idempotency_keys
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE idempotency_keys
  ADD COLUMN method TEXT NOT NULL DEFAULT 'POST';
ALTER TABLE idempotency_keys
  ALTER COLUMN method DROP DEFAULT;
ALTER TABLE idempotency_keys
  ADD COLUMN email_hmac TEXT;
DROP INDEX IF EXISTS idempotency_keys_user_id_key_key;
ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_one_subject;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_one_subject CHECK (
    (user_id IS NOT NULL AND email_hmac IS NULL)
    OR (user_id IS NULL AND email_hmac IS NOT NULL)
  );
CREATE UNIQUE INDEX idempotency_keys_user_scope
  ON idempotency_keys (user_id, method, route, key)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idempotency_keys_email_scope
  ON idempotency_keys (email_hmac, method, route, key)
  WHERE email_hmac IS NOT NULL;

-- Append-only for consents, audit_events, and aviso_versions.
-- The message stays "<table> are append-only", so consents still say
-- "consents are append-only".
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

-- Least privilege for the non-owner app role. Migrations keep using the owner.
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO property_control_app',
    current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA public TO property_control_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO property_control_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO property_control_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO property_control_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO property_control_app;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE consents, audit_events, aviso_versions
  FROM property_control_app;
GRANT SELECT, INSERT ON TABLE consents, audit_events, aviso_versions
  TO property_control_app;
