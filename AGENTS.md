# AGENTS.md

Notebook-lite: a slim Gemini-Notebook clone. Users upload sources (PDF, DOCX, MD, URL), chat with an AI that answers **only** from the selected sources with a citation for every statement, and generate podcast MP3s (monologue/dialogue, ~2/6/15 min).

Docs: [BRIEFING](docs/BRIEFING.md) · [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) · [CORRECTIONS](docs/CORRECTIONS.md)

## Layout (npm workspaces)

- `apps/web` — Next.js (App Router), TypeScript, Tailwind, shadcn/ui
- `apps/api` — NestJS; tRPC at `/trpc`, chat streaming via SSE (`POST /chat/:chatId/stream`, AI SDK UI-message stream)
- `apps/worker` — NestJS standalone; pg-boss consumers (`ingest-source`, `generate-podcast`), concurrency 1
- `packages/shared` — zod schemas, types, constants (source of truth for contracts)
- `packages/db` — generated Supabase types, query helpers
- `packages/ai` — prompts, model config, chunking, embeddings, script generation
- `packages/config` — tsconfig / ESLint / Prettier / Vitest presets
- `supabase/` — migrations, RLS tests, config

## Commands

```bash
npm install
npm run dev          # all apps
npm run lint
npm run typecheck
npm run test
npm run build
npm run db:start     # local Supabase
npm run db:reset     # re-apply migrations + seed
npm run db:types     # regenerate packages/db types after schema changes
```

## Stack facts

- LLM: OpenAI `gpt-6.1-terra` via Vercel AI SDK; embeddings `text-embedding-3-large` stored as `halfvec(3072)`.
- Supabase: Postgres + pgvector, Storage (private buckets `sources`, `podcasts`, path `{user_id}/…`), Auth via email OTP.
- TTS: ElevenLabs. Audio concatenation via ffmpeg in the worker.
- Deploy: Dokploy project at `dokploy.soeenplop.dev`, auto-deploy on push to `main`. Dokploy CLI available.

## Rules

- **Data isolation is non-negotiable.** Every user table has `user_id` and RLS. The API queries Supabase with the *user's JWT*, never the service role, unless unavoidable. The service-role key lives only in api/worker, never in `apps/web` or `NEXT_PUBLIC_*`; every service-role query filters by `user_id` explicitly. New tables/buckets ship with RLS policies **and** RLS tests in the same commit.
- **Grounding:** chat answers use only retrieved chunks from the chat's selected sources; every claim carries a `[n]` marker mapped to a chunk. Keep prompts in `packages/ai`, not inline.
- **Contracts:** input/output schemas live in `packages/shared` (zod). The web imports the API router type type-only.
- **Schema changes:** only via new files in `supabase/migrations/`; never edit an applied migration. Regenerate types afterwards.
- **Tests:** Vitest; mock OpenAI/ElevenLabs (no real external calls in tests/CI).
- **Secrets:** never commit them; document new env vars in the app's `.env.example`.
- **URL fetching:** always through the SSRF-guarded fetcher.

## Working approach

- Record every correction to a proposal or decision in `docs/CORRECTIONS.md`: scope, original decision, correction, rationale.
- Commits: as small as possible, but functionally and technically self-contained. Conventional Commit style (`feat(api): …`, `fix(web): …`, `docs: …`).
- Lint, build, and relevant tests must pass before every commit.
