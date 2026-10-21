#!/usr/bin/env bash
# Creates or updates the non-owner role used by the API and by tests.
# CREATE ROLE and ALTER ROLE cannot run inside Prisma's migration transaction,
# so this script runs before `prisma migrate deploy`.
#
# APP_ROLE_PASSWORD is required. There is no default. The password is read
# inside psql with \getenv, never as a psql argument, and the session turns
# DDL statement logging off before the password is sent. Production sets the
# password outside this repository.
set -euo pipefail

url="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "DIRECT_URL or DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${APP_ROLE_PASSWORD:-}" || -z "${APP_ROLE_PASSWORD//[[:space:]]/}" ]]; then
  echo "APP_ROLE_PASSWORD is required" >&2
  exit 1
fi

# stdin only. Do not add -v, -c, or --set with the password.
psql "$url" -q -v ON_ERROR_STOP=1 --no-psqlrc >/dev/null <<'SQL'
SET log_statement = 'none';
SET log_min_duration_statement = -1;
\getenv app_password APP_ROLE_PASSWORD
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'property_control_app')
  THEN format('ALTER ROLE property_control_app WITH PASSWORD %L', :'app_password')
  ELSE format(
    'CREATE ROLE property_control_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
    :'app_password'
  )
END
\gexec
SQL
