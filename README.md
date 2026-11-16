# notebook-lite

A slim, source-grounded notebook app. Users create notebooks, add sources (PDF, DOCX, Markdown,
URLs), chat with an AI that answers **only** from the selected sources and cites every statement,
and turn their sources into podcast MP3s (monologue or dialogue, about 2, 6 or 15 minutes).

Live: [notebook-lite.soeenplop.dev](https://notebook-lite.soeenplop.dev)

## Features

- **Notebooks** with a name, optional description and a language (`de`, `en`) that every AI
  operation uses.
- **Sources:** PDF (LiteParse, Tesseract OCR for scanned pages), DOCX (mammoth), Markdown and
  URLs (SSRF-guarded fetch, stored as Markdown snapshot). Ingestion runs as a background job:
  extract → chunk → embed.
- **Chat:** hybrid retrieval (pgvector + full-text search) over the selected sources, streamed
  answers with `[n]` citations that link to the cited chunk.
- **Podcasts:** script generation from the sources, audio via the ElevenLabs text-to-dialogue
  endpoint, live status updates while the worker produces them.
- **Data isolation:** email OTP login, every table protected by row-level security, the API
  queries Supabase with the user's JWT.

## Stack

| Part              | Technology                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `apps/web`        | Next.js (App Router), Tailwind, shadcn/ui                        |
| `apps/api`        | NestJS, tRPC at `/trpc`, chat streaming via SSE                  |
| `apps/worker`     | NestJS standalone, pg-boss jobs (`ingest-source`, `generate-podcast`) |
| `packages/shared` | zod schemas, types and constants (contract source of truth)      |
| `packages/db`     | generated Supabase types, query helpers                          |
| `packages/ai`     | prompts, model config, chunking, embeddings, scripts             |
| `packages/queue`  | typed pg-boss wrapper                                            |
| `supabase/`       | migrations, RLS tests (pgTAP), auth config                       |

Node 26, TypeScript 7, ESM throughout. Supabase (Postgres + pgvector, Storage, Auth), OpenAI via
the Vercel AI SDK, ElevenLabs for speech. Deployed with Dokploy from `docker/*.Dockerfile`.

## Getting started

Requirements: Node 26, the Supabase CLI (linked to the project) and `ffmpeg`/`ffprobe` for
podcast audio. There is no local Supabase stack; development uses the remote project.

```bash
npm install
cp .env.example .env   # fill in Supabase, OpenAI and ElevenLabs keys
npm run dev            # web :3000, api :4000, worker :4001
```

All variables are documented in [`.env.example`](.env.example).

## Scripts

| Command                           | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `npm run lint` / `npm run format` | oxlint (type-aware) and Prettier                    |
| `npm run typecheck`               | TypeScript across all workspaces                    |
| `npm run test`                    | Vitest (OpenAI and ElevenLabs are mocked)           |
| `npm run build`                   | build all workspaces                                |
| `npm run test:e2e`                | Playwright smoke tests (build the web app first)    |
| `npm run db:new -- <name>`        | new migration file                                  |
| `npm run db:push`                 | apply migrations to the remote project              |
| `npm run db:test`                 | RLS tests against the remote project (rolled back)  |
| `npm run db:types`                | regenerate `packages/db` types after schema changes |

## Deployment

Every push to `main` runs CI and then the deploy workflow: migrations and RLS tests, Dokploy
deploy, production smoke test. Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [BRIEFING](docs/BRIEFING.md): product brief
- [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md): architecture and milestones
- [CORRECTIONS](docs/CORRECTIONS.md): decisions that changed during development
- [DEPLOYMENT](docs/DEPLOYMENT.md): infrastructure and release process
- [AGENTS.md](AGENTS.md): conventions and rules for contributors and coding agents
