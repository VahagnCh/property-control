# Staging on Render Free

This is the Oct 26 staging build, before a custom domain. The service URL is the `onrender.com` hostname Render assigns. Nobody in this repository creates Neon or Render accounts. Vahagn does the sign-ups and pastes the secret values into the Render dashboard.

`render.yaml` is the blueprint. Every secret is `sync: false` and has no value in git.

## Day-one checklist

- [ ] `SERVER_SECRET` is generated with `openssl rand -base64 32` and stored only in Render env vars. The repo never contains a value.
- [ ] The API connects as `property_control_app`, never as the Neon owner. The staging password is generated (`openssl rand -hex 24`), not the role name. Boot fails if `current_user` is the database owner, a superuser, has `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`, or is a member (direct or inherited) of the database owner, any table owner, `neon_superuser`, `pg_write_all_data`, or `pg_read_all_data`.
- [ ] The web service does not have `DIRECT_URL`, `APP_ROLE_PASSWORD`, or `RESEND_API_KEY`. Production boot fails when `DIRECT_URL` is set. Health uses `DATABASE_URL` only.
- [ ] HTTPS only, with HSTS. `trust proxy` is 1. Production requires the rightmost `X-Forwarded-Proto` to be `https` (case-insensitive). `HTTP`, `ws`, and `https, http` are **403** `https_required` with no HSTS. A missing header is allowed only for exact `GET /v1/health`, and that response is `{status}` with no HSTS. `HSTS_INCLUDE_SUBDOMAINS` stays `false` on `onrender.com`.
- [ ] Demo data only. `SEED_DEMO_DATA=true` inserts one demo user, one demo property, and one demo obligation. The aviso row is a separate `PUBLISH_AVISO=true` step. Do not set the demo flag once real rows exist. Do not restore a production dump.
- [ ] Logs do not contain tokens, codes, emails, cookies, refresh tokens, Basic credentials, idempotency keys, or signed URLs. Nest's logger and Prisma error events go through `redactForLog`. A 6-digit number is redacted only in a code field, so money amounts stay.

## HSTS when the hostname is duerecord.mx

Leave `HSTS_INCLUDE_SUBDOMAINS` and `HSTS_PRELOAD` at `false` while the service is `onrender.com`. After every `duerecord.mx` subdomain is HTTPS-only, set `HSTS_INCLUDE_SUBDOMAINS=true`. Set `HSTS_PRELOAD=true` only after that is verified. Preload is ignored unless includeSubDomains is also on. `HSTS_MAX_AGE` below one year is raised to `31536000`.

## Neon in us-east-1

Create the Neon project in **us-east-1**. Render's blueprint region is `ohio`, the US East region, so the database and the service sit in the same part of the country.

Use two connection strings:

- **Owner role** for migrations. Keep this URL off the web service. Run migrate from a shell, with `DATABASE_URL` set to the non-pooled owner connection for that command only.
- **App role** `property_control_app` for the running API. This is the web service's `DATABASE_URL`, the pooled Neon host. The password in that URL is the generated staging password.

Generate the app-role password and keep it only in the shell that creates the role. It is not a Render env var on the web service.

```bash
openssl rand -hex 24
```

`psql` 16 or newer is required because the script uses `\getenv`. Node hashes the password as `SCRAM-SHA-256` before `psql` sees it. The statement contains the hash, not the password, so the script does not turn statement logging off (a Neon owner cannot). Put the owner password in `PGPASSWORD` or pass it on stdin. Do not put it on the `psql` command line or in `psql -c`.

```bash
PGPASSWORD='owner-password' \
  DIRECT_URL='postgresql://OWNER@HOST/DB' \
  APP_ROLE_PASSWORD='generated' \
  bash apps/api/prisma/bootstrap-app-role.sh
```

`DIRECT_URL` in that command has no password. `PGPASSWORD` is the owner password. `APP_ROLE_PASSWORD` stays in the environment of the script.

## SERVER_SECRET

Generate it on the machine that will paste it into Render, and do not commit it:

```bash
openssl rand -base64 32
```

Boot refuses to listen unless that value decodes to at least 32 bytes. Store it only as the `SERVER_SECRET` env var on the Render service.

## Publish the aviso as the owner

The demo seed does not publish the aviso. Insert the current aviso row with the **owner** connection, not as `property_control_app`. Set `PUBLISH_AVISO=true`, `AVISO_VERSION`, and `AVISO_URL`, and point `DATABASE_URL` at the owner for that one command. The text is the demo aviso in `apps/api/src/consent/aviso-text.ts`. Do not publish a version that names a real person.

```bash
PGPASSWORD='owner-password' \
  DATABASE_URL='postgresql://OWNER@HOST/DB' \
  PUBLISH_AVISO=true \
  AVISO_VERSION='2026-10-21' \
  AVISO_URL='https://example.com/aviso' \
  pnpm --filter @property-control/api exec prisma db seed
```

Demo rows, only while the database is still empty of real data:

```bash
SEED_DEMO_DATA=true DATABASE_URL='postgresql://property_control_app@HOST/DB' \
  pnpm --filter @property-control/api exec prisma db seed
```

Do not set `SEED_DEMO_DATA` on the web service, and do not set it again after real rows exist.

Boot then checks that the configured `AVISO_VERSION` has a row. A missing row refuses to listen, and a consent write against a missing current version is **503** `aviso_unavailable`.

## First deploy

1. Create the role and publish the aviso from a shell, as above. Then migrate as the owner. This is not a Render pre-deploy command, and the web service does not receive the owner URL:

```bash
PGPASSWORD='owner-password' \
  DATABASE_URL='postgresql://OWNER@HOST/DB' \
  pnpm --filter @property-control/api exec prisma migrate deploy
```

2. In Render, create the blueprint service from `render.yaml`. Leave every `sync: false` variable empty in git and paste the values in the dashboard. Do not add `DIRECT_URL`, `APP_ROLE_PASSWORD`, or `RESEND_API_KEY` to the web service.
3. `DATABASE_URL` on the web service is the pooled app-role URL. `HSTS_INCLUDE_SUBDOMAINS` stays `false`.
4. Deploy. The build installs dependencies, generates the Prisma client, and compiles the API. The process then listens as `property_control_app`. Boot refuses to listen if `DIRECT_URL` is set.
5. The first response after idle can take about 60 seconds while the free instance wakes.

Smoke check, after that wake:

```bash
curl -sD - "https://SERVICE.onrender.com/v1/health"
```

The body is exactly `{"status":"ok"}` and the response includes `Cache-Control: no-store`.

An unknown route is **404**:

```bash
curl -s -o /dev/null -w "%{http_code}" "https://SERVICE.onrender.com/v1/does-not-exist"
```

That code is `404`.
