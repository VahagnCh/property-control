#!/usr/bin/env bash
# Creates or updates the non-owner role used by the API and by tests.
# CREATE ROLE and ALTER ROLE cannot run inside Prisma's migration transaction,
# so this script runs before `prisma migrate deploy`.
#
# APP_ROLE_PASSWORD is required. There is no default, and the password is
# never printed. Production sets the role password outside this repository.
set -euo pipefail

url="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "DIRECT_URL or DATABASE_URL is required" >&2
  exit 1
fi

password="${APP_ROLE_PASSWORD:-}"
if [[ -z "${password//[[:space:]]/}" ]]; then
  echo "APP_ROLE_PASSWORD is required" >&2
  exit 1
fi

statement=$(
  psql "$url" -qAt -v ON_ERROR_STOP=1 -v app_password="$password" <<'SQL'
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'property_control_app')
  THEN format('ALTER ROLE property_control_app WITH PASSWORD %L', :'app_password')
  ELSE format(
    'CREATE ROLE property_control_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
    :'app_password'
  )
END;
SQL
)

psql "$url" -q -v ON_ERROR_STOP=1 -c "$statement" >/dev/null
