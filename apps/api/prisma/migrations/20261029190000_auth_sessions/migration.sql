-- Session revocation for access tokens. The id is the JWT sid.

CREATE TABLE auth_sessions (
  id UUID NOT NULL,
  user_id UUID NOT NULL,
  revoked_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_sessions_pkey PRIMARY KEY (id)
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO property_control_app;
