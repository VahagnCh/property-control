#!/usr/bin/env bash
# Creates or updates the non-owner role used by the API and by tests.
# CREATE ROLE and ALTER ROLE cannot run inside Prisma's migration transaction,
# so this script runs before `prisma migrate deploy`.
#
# APP_ROLE_PASSWORD is required. There is no default. Node hashes it as
# SCRAM-SHA-256 in this process. psql 16+ reads that hash with \getenv.
# The plaintext password is never a psql argument, and this script does not
# change statement logging (a Neon owner is not a superuser).
# Connect with PGPASSWORD or a passwordless URL. Do not put a password on
# the psql command line.
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

psql_major=$(psql --version | awk '{print $3}' | cut -d. -f1)
if [[ "${psql_major}" -lt 16 ]]; then
  echo "psql 16 or newer is required for \\getenv" >&2
  exit 1
fi

dir=$(cd "$(dirname "$0")" && pwd)
scram=$(APP_ROLE_PASSWORD="$APP_ROLE_PASSWORD" node --input-type=module --eval "import { scramSha256Password } from '${dir}/scram-password.mjs'; process.stdout.write(scramSha256Password(process.env.APP_ROLE_PASSWORD ?? ''));")

case "$scram" in
  SCRAM-SHA-256\$*) ;;
  *)
    echo "SCRAM hash was not produced" >&2
    exit 1
    ;;
esac

# stdin only. Do not add -v, -c, or --set with the password or the hash.
SCRAM_PASSWORD="$scram" psql "$url" -q -v ON_ERROR_STOP=1 --no-psqlrc >/dev/null <<'SQL'
\getenv scram_password SCRAM_PASSWORD
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'property_control_app')
  THEN format('ALTER ROLE property_control_app WITH PASSWORD %L', :'scram_password')
  ELSE format(
    'CREATE ROLE property_control_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    :'scram_password'
  )
END
\gexec
ALTER ROLE property_control_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
unset scram
unset SCRAM_PASSWORD
