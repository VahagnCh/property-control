# Staging on Render Free

This is the Oct 26 staging build, before a custom domain. The service URL is the `onrender.com` hostname Render assigns. Nobody in this repository creates Neon or Render accounts. Vahagn does the sign-ups and pastes the secret values into the Render dashboard.

`render.yaml` is the blueprint. Every secret is `sync: false` and has no value in git.

## Day-one checklist

- [ ] `SERVER_SECRET` is generated with `openssl rand -base64 32` and stored only in Render env vars. The repo never contains a value.
- [ ] The API connects as `property_control_app`, never as the Neon owner. The staging password is generated (`openssl rand -hex 24`), not the role name. Boot fails if `current_user` is the database owner or a superuser.
- [ ] HTTPS only, with HSTS. `trust proxy` is 1, matching Render's single hop. In production, a trusted hop whose protocol is `http` is rejected with **403** `https_required`. An HTTPS response sends `Strict-Transport-Security: max-age=31536000`.
- [ ] Demo data only. The seed is one demo user, one demo property, and one demo obligation. Do not restore a production dump.
- [ ] Logs do not contain tokens, codes, emails, or signed URLs. Error lines go through `redactForLog`.

## Neon in us-east-1

Create the Neon project in **us-east-1**. Render's blueprint region is `ohio`, the US East region, so the database and the service sit in the same part of the country.

Use two connection strings:

- **Owner role** for migrations. This is `DIRECT_URL`, the non-pooled Neon host. `preDeployCommand` runs `prisma migrate deploy` with this URL.
- **App role** `property_control_app` for the running API. This is `DATABASE_URL`, the pooled Neon host. The password in that URL is the generated staging password.

Generate the app-role password and keep it only in the Render env:

```bash
openssl rand -hex 24
```

Create the role with the owner URL. The script reads `APP_ROLE_PASSWORD` inside `psql` via `\getenv`. It is not a `psql` argument. Before that value is sent, the session sets `log_statement` to `none` and `log_min_duration_statement` to `-1`, so the `CREATE ROLE` / `ALTER ROLE` statement is not logged.

```bash
DIRECT_URL='postgresql://OWNER@HOST/DB' APP_ROLE_PASSWORD='generated' bash apps/api/prisma/bootstrap-app-role.sh
```

The owner connection must be allowed to change `log_statement`. The Neon owner used for migrations is that connection.

## SERVER_SECRET

Generate it on the machine that will paste it into Render, and do not commit it:

```bash
openssl rand -base64 32
```

Boot refuses to listen unless that value decodes to at least 32 bytes. Store it only as the `SERVER_SECRET` env var on the Render service.

## Publish the aviso as the owner

Insert the current aviso row with the **owner** connection (`DIRECT_URL`), not as `property_control_app`. Set `AVISO_VERSION` and `AVISO_URL` in the environment for that one command, then run the seed from `apps/api` with `DIRECT_URL` as the datasource the seed uses. The text is the demo aviso in `apps/api/src/consent/aviso-text.ts`. Do not publish a version that names a real person.

Boot then checks that the configured `AVISO_VERSION` has a row. A missing row refuses to listen, and a consent write against a missing current version is **503** `aviso_unavailable`.

## First deploy

1. In Render, create the blueprint service from `render.yaml`. Leave every `sync: false` variable empty in git and paste the values in the dashboard.
2. `DATABASE_URL` is the pooled app-role URL. `DIRECT_URL` is the non-pooled owner URL.
3. Deploy. The build installs dependencies, generates the Prisma client, and compiles the API. The pre-deploy command migrates as the owner through `DIRECT_URL`. The process then listens as `property_control_app`.
4. The first response after idle can take about 60 seconds while the free instance wakes.

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
