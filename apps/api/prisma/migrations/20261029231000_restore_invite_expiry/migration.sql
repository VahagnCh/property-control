-- The invite expiry check stays on created_at. Comparing it to now() is a follow-up.
ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_expires_within_7_days;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_expires_within_7_days CHECK (
    expires_at <= created_at + interval '7 days'
  );
