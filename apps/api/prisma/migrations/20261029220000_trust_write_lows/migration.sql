-- Trust write lows: payment markPartial, invite expiry against the server clock,
-- and aviso text that is not whitespace.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS mark_partial BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_expires_within_7_days;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_expires_within_7_days CHECK (
    expires_at <= now() + interval '7 days'
  );

ALTER TABLE aviso_versions
  DROP CONSTRAINT IF EXISTS aviso_versions_text_not_blank;
ALTER TABLE aviso_versions
  ADD CONSTRAINT aviso_versions_text_not_blank CHECK ("text" !~ '^[[:space:]]*$');
