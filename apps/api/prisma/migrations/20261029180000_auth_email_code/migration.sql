-- Email-code login. The code and the email address are not stored.
-- email_hmac is a keyed HMAC. code_hmac is HMAC-SHA256 with the server pepper.

ALTER TABLE users
  ADD COLUMN email_hmac TEXT;

CREATE UNIQUE INDEX users_email_hmac_key ON users (email_hmac);

CREATE TABLE auth_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email_hmac TEXT NOT NULL,
  code_hmac TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  used_at TIMESTAMPTZ(6),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_codes_pkey PRIMARY KEY (id)
);

CREATE INDEX auth_codes_email_hmac_created_at_idx ON auth_codes (email_hmac, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_codes TO property_control_app;
