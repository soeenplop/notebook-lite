# AGENTS.md

Notebook-lite is a slim Gemini-Notebook clone. Users create **notebooks**. Each notebook has a name, an optional description, a language, and exactly one owner. Inside a notebook, users upload sources (PDF, DOCX, MD, URL), chat with an AI that answers **only** from the selected sources and cites every statement, and generate podcast MP3s (monologue/dialogue, ~2/6/15 min).

Domain: user → notebook → sources / chats (→ messages) / podcasts.

Docs: [BRIEFING](docs/BRIEFING.md) · [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) · [CORRECTIONS](docs/CORRECTIONS.md)

## Layout (npm workspaces)

- `apps/web` — Next.js (App Router), TypeScript, Tailwind, shadcn/ui
- `apps/api` — NestJS; tRPC at `/trpc`, chat streaming via SSE (`POST /chat/:chatId/stream`, AI SDK UI-message stream)
- `apps/worker` — NestJS standalone; pg-boss consumers (`ingest-source`, `generate-podcast`), at most one concurrent job per queue
- `packages/shared` — zod schemas, types, constants (source of truth for contracts)
- `packages/db` — generated Supabase types, query helpers
- `packages/ai` — prompts, model config, chunking, embeddings, script generation
- `packages/config` — shared tsconfig presets (base, node, nest, next); oxlint (`.oxlintrc.json`) and Prettier configs live in the repo root
- `supabase/` — migrations, RLS tests, config

## Commands

```bash
npm install
cp .env.example .env # local config, shared by all apps
npm run dev          # shared watcher + api :4000 + worker :4001 + web :3000
npm run lint         # oxlint (type-aware) + prettier --check
npm run format       # oxlint --fix + prettier --write
npm run typecheck
npm run test
npm run build
npm run db:new -- <name>  # new migration file
npm run db:push      # apply migrations to the remote project
npm run db:test      # pgTAP RLS tests against the remote project (rolled back)
npm run db:config    # push auth config + email templates (supabase/config.toml)
npm run db:types     # regenerate packages/db types after schema changes
npm run test:e2e     # Playwright smoke tests (needs `npm run build -w @notebook-lite/web` first)
```

## Stack facts

- Node 26, TypeScript 7 (native `tsc`, no JS compiler API). ESM everywhere.
- NestJS 12 apps are built with plain `tsc`, not the Nest CLI (which pins TypeScript 6). Next.js type-checks via the `tsc` CLI.
- `packages/shared` is consumed from its `dist/`. Root `typecheck`/`test`/`dev` build it first (`npm run build:packages`).
- Web scripts run Next through `apps/web/scripts/next.mjs`, which loads the root `.env` (Next forwards Node flags to workers, so `--env-file` can't be used).
- shadcn/ui uses the `base-nova` style (Base UI primitives). Add components with `npx shadcn@latest add <name> -c apps/web`.

- LLM: OpenAI `gpt-6.1-terra` via Vercel AI SDK; embeddings `text-embedding-3-large` stored as `halfvec(3072)`.
- Supabase: Postgres + pgvector, Storage (private buckets `sources`, `podcasts`, path `{user_id}/{notebook_id}/…`), Auth via email OTP.
- Supabase Cloud only, no local stack: project `notebook-lite` (ref `tmwmklntjantjchkhmrg`) serves dev and prod. The CLI is linked; `db:push` changes the live database, so test migrations carefully. JWTs are ES256, verified via JWKS.
- Notebook languages: `de`, `en`.
- TTS: ElevenLabs text-to-dialogue endpoint (also for monologues), batched; ffmpeg joins the batches in the worker.
- Deploy: Dokploy project `notebook-lite` at `dokploy.soeenplop.dev`; images from `docker/*.Dockerfile`. Every push to `main` deploys via `.github/workflows/deploy.yml` after CI: migrations + RLS tests → Dokploy deploy → production smoke test (see `docs/DEPLOYMENT.md`). Dokploy CLI reads `DOKPLOY_URL`/`DOKPLOY_AUTH_TOKEN`. Web: `notebook.soeenplop.dev`, API: `notebook-api.soeenplop.dev`.

## Rules

- **Data isolation is non-negotiable.** Every user table has `user_id` and RLS. The API queries Supabase with the *user's JWT*, never the service role, unless unavoidable. The service-role key lives only in api/worker, never in `apps/web` or `NEXT_PUBLIC_*`; every service-role query filters by `user_id` explicitly. New tables/buckets ship with RLS policies **and** RLS tests in the same commit.
- **Notebook scoping:** every child table has `notebook_id` and `user_id`, with a composite FK `(notebook_id, user_id) → notebooks(id, user_id)`. Chats and podcasts may only reference sources from their own notebook.
- **Notebook language:** every AI operation (answers, titles, query rewriting, topic suggestions, podcast scripts, TTS) and the FTS config use the notebook language. Pass it explicitly and never infer it from the input. Supported languages live in `SUPPORTED_LANGUAGES` (`packages/shared`).
- **Grounding:** chat answers use only retrieved chunks from the chat's selected sources, and every claim carries a `[n]` marker mapped to a chunk. Keep prompts in `packages/ai`, not inline.
- **Contracts:** input/output schemas live in `packages/shared` (zod). The web imports `AppRouter` type-only from `@notebook-lite/api/trpc` (`apps/api/src/trpc/app-router.ts`): that file and everything it imports must stay free of Nest decorators; procedures reach Nest services through the tRPC context.
- **Auth in the API:** tRPC procedures that touch user data use `protectedProcedure` and `ctx.supabase` (RLS-scoped to the caller). Plain Nest controllers use `AuthGuard`.
- **Schema changes:** only via new files in `supabase/migrations/`; never edit an applied migration. Regenerate types afterwards.
- **Tests:** Vitest; mock OpenAI/ElevenLabs (no real external calls in tests/CI).
- **Secrets:** never commit them; document every new env var in the root `.env.example`.
- **URL fetching:** always through the SSRF-guarded fetcher.
- **Migrations are deployed before the apps:** keep them backwards compatible with the running version (expand first, contract in a later release).
- **Logging:** use Nest's `Logger` (backed by pino, JSON in production); never log tokens, cookies or secrets. Expensive procedures (chat, podcasts) get per-user rate limits on top of the global per-IP limit.

## Working approach

- Record every correction to a proposal or decision in `docs/CORRECTIONS.md`: scope, original decision, correction, rationale.
- Commits: as small as possible, but functionally and technically self-contained. Conventional Commit style (`feat(api): …`, `fix(web): …`, `docs: …`).
- Lint, build, and relevant tests must pass before every commit.
