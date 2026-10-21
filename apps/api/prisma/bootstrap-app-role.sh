#!/usr/bin/env bash
# Creates the non-owner role used by the API and by tests.
# CREATE ROLE cannot run inside Prisma's migration transaction, so this
# statement runs on its own before `prisma migrate deploy`.
#
# The password below is a test-database secret for CI and local Postgres.
# Production sets the role password outside this repository and does not
# reuse this value.
set -euo pipefail

url="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "DIRECT_URL or DATABASE_URL is required" >&2
  exit 1
fi

psql "$url" -v ON_ERROR_STOP=1 <<'SQL'
SELECT format(
  'CREATE ROLE property_control_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
  'property_control_app'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'property_control_app')
\gexec
SQL
