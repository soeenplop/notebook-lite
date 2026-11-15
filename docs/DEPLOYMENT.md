# Deployment

Production runs on the Dokploy server `dokploy.soeenplop.dev` (project **notebook-lite**,
environment **production**). The database, auth and storage live in Supabase Cloud (project
`notebook-lite`, ref `tmwmklntjantjchkhmrg`).

| App | Dokploy application (ID) | Dockerfile | Public URL | Port |
|---|---|---|---|---|
| web | `notebook-web` (`UbY0EfBSNnHrwfZQi9oi2`) | `docker/web.Dockerfile` | https://notebook.soeenplop.dev | 3000 |
| api | `notebook-api` (`0hPb0bUYW_8hgc_sPcCSd`) | `docker/api.Dockerfile` | https://notebook-api.soeenplop.dev | 4000 |
| worker | `notebook-worker` (`r6Y6MDzTVfbmZbAKvjdzu`) | `docker/worker.Dockerfile` | — (internal `/healthz` only) | 4001 |

All three build from this public repository (`git` source, branch `main`, Docker context `.`).
Traefik (managed by Dokploy) terminates TLS with Let's Encrypt certificates.

## Release flow

Every push to `main` deploys, but only after CI passed (`.github/workflows/deploy.yml`):

1. **CI** (`ci.yml`): lint, typecheck, unit tests, build, Playwright smoke test against a local
   production build, and Docker image builds for all three apps.
2. **Migrations**: `supabase db push --remote` applies new files from `supabase/migrations/`,
   then the pgTAP RLS tests run against the live project (each in a rolled-back transaction).
3. **Deploy**: the workflow triggers a Dokploy deployment for api, worker and web.
   Dokploy auto-deploy is not used, so the apps never run ahead of the schema.
4. **Smoke**: waits for `https://notebook-api.soeenplop.dev/healthz` and the web login page,
   then runs the Playwright smoke tests against production.

Deployments are queued by Dokploy and build on the server; step 4 can still see the previous
version for a few minutes. Watch progress in the Dokploy UI. A failed deploy keeps the previous
container running.

Manual run: *Actions → Deploy → Run workflow* (same steps, current `main`).

**Migrations must be backwards compatible** with the currently running app version (add columns
and tables first, remove them in a later release), because the schema changes before the new
containers are live.

## Configuration

### GitHub (repository settings → Environments → `production`)

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token (Dashboard → Account → Access Tokens) |
| Secret | `DOKPLOY_AUTH_TOKEN` | Dokploy API key (Dokploy → Settings → Profile → API/CLI) |
| Variable | `SUPABASE_PROJECT_REF` | `tmwmklntjantjchkhmrg` |
| Variable | `DOKPLOY_URL` | `https://dokploy.soeenplop.dev` |
| Variable | `DOKPLOY_APP_ID_API` / `_WORKER` / `_WEB` | Dokploy application IDs (table above) |
| Variable | `WEB_URL` | `https://notebook.soeenplop.dev` |
| Variable | `API_URL` | `https://notebook-api.soeenplop.dev` |

### Dokploy application environment

Set per application (*Environment* tab). Never put the Supabase secret key into `web`.

- **api**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGIN=https://notebook.soeenplop.dev`,
  `LOG_LEVEL=info`, optional `RATE_LIMIT_PER_MINUTE`.
- **worker**: `LOG_LEVEL=info`. Later milestones add `DATABASE_URL`, `SUPABASE_SECRET_KEY`,
  OpenAI and ElevenLabs keys.
- **web**: build arguments (inlined into the browser bundle at build time)
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_API_URL=https://notebook-api.soeenplop.dev`. Changing them requires a rebuild.

The full list of variables with explanations is in [`.env.example`](../.env.example).

### Supabase Auth

`supabase/config.toml` holds the auth settings (site URL, redirect allow-list, OTP length and
expiry). Apply changes with `npm run db:config`. Sign-in emails use Supabase's default link
template until a custom SMTP provider is configured (see [CORRECTIONS](CORRECTIONS.md)).

## Operating

- **Logs**: Dokploy → application → *Logs*. api and worker log JSON (pino) with `service`,
  request id (`reqId`, also returned as `X-Request-Id`) and level.
- **Health**: `GET /healthz` on api and worker (also used as Docker `HEALTHCHECK`); web is checked
  via `/login`.
- **Rollback**: redeploy a previous deployment in Dokploy. Schema changes are not rolled back
  automatically: write a new forward migration instead.
- **Rate limit**: the API answers `429` above `RATE_LIMIT_PER_MINUTE` requests per client IP
  (default 300), `/healthz` excluded.

## Building images locally

```bash
docker build -f docker/api.Dockerfile -t notebook-lite-api .
```

```bash
docker build -f docker/worker.Dockerfile -t notebook-lite-worker .
```

```bash
docker build -f docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://tmwmklntjantjchkhmrg.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  --build-arg NEXT_PUBLIC_API_URL=https://notebook-api.soeenplop.dev \
  -t notebook-lite-web .
```
