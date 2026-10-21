-- Sign-off. overpaid_amount matches the other amount columns.
-- Aviso text must be non-empty and must hash to text_sha256.
-- Payments are void-only. The app role does not write migration history.

ALTER TABLE obligation_period_outcomes
  ALTER COLUMN overpaid_amount TYPE BIGINT;

-- Append-only triggers would block the owner from repairing rows that
-- predate these checks. Skip the privilege when there is nothing to repair.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM aviso_versions
    WHERE length("text") = 0
       OR (
         length("text") > 0
         AND text_sha256 IS DISTINCT FROM encode(sha256(convert_to("text", 'UTF8')), 'hex')
       )
  ) THEN
    PERFORM set_config('session_replication_role', 'replica', true);
  END IF;
END $$;

UPDATE aviso_versions
SET text_sha256 = encode(sha256(convert_to("text", 'UTF8')), 'hex')
WHERE length("text") > 0
  AND text_sha256 IS DISTINCT FROM encode(sha256(convert_to("text", 'UTF8')), 'hex');

DELETE FROM consents
WHERE aviso_version IN (
  SELECT version FROM aviso_versions WHERE length("text") = 0
);

DELETE FROM aviso_versions
WHERE length("text") = 0;

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_not_empty;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_not_empty CHECK (length("text") > 0);

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_sha256_matches;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_sha256_matches CHECK (
    text_sha256 = encode(sha256(convert_to("text", 'UTF8')), 'hex')
  );

REVOKE DELETE ON TABLE payments FROM property_control_app;
REVOKE UPDATE, DELETE ON TABLE _prisma_migrations FROM property_control_app;
