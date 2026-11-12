# Implementation Plan

Derived from [BRIEFING.md](BRIEFING.md). Deviations from this plan are logged in [CORRECTIONS.md](CORRECTIONS.md).

## 1. Scope

**In scope (MVP)**

- Email-OTP sign-in (Supabase Auth), strict per-user data isolation.
- Source library: upload PDF, DOCX, MD; add web pages by URL. Background ingestion (extract → chunk → embed).
- Chats: each chat has its own selection of sources; answers are grounded exclusively in the selected sources and every statement carries a citation that links back to the source passage.
- Podcasts: select sources → choose mode (monologue / dialogue), length (~2 / 6 / 15 min) → enter a topic or pick one of three LLM suggestions → script by LLM → MP3 via ElevenLabs → playback and download.
- Deployment to Dokploy on push to `main`.

**Out of scope (MVP)**

Sharing/collaboration, notebooks/folders beyond chats, OCR for scanned PDFs, YouTube/audio sources, editing scripts before TTS, billing/quotas beyond basic rate limits, i18n.

## 2. Architecture

```
┌──────────────┐  tRPC (HTTP)  ┌──────────────┐  enqueue   ┌──────────────┐
│  apps/web    │──────────────▶│  apps/api    │──────────▶│ apps/worker  │
│  Next.js     │  SSE (chat)   │  NestJS      │  (pg-boss) │ NestJS       │
│  shadcn/ui   │◀──────────────│  tRPC + SSE  │            │ concurrency 1│
└──────┬───────┘               └──────┬───────┘            └──────┬───────┘
       │ Auth (OTP), direct            │ user-JWT client (RLS)      │ service role,
       │ uploads to Storage (RLS)      │                            │ explicit user_id
       ▼                               ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Supabase: Auth · Postgres + pgvector (RLS) · Storage (private buckets)   │
└──────────────────────────────────────────────────────────────────────────┘
        External: OpenAI (gpt-6.1-terra, text-embedding-3-large) · ElevenLabs
```

**Key decisions**

| Topic | Decision | Rationale |
|---|---|---|
| tRPC in NestJS | Mount tRPC's Express adapter at `/trpc` inside the Nest app; routers call Nest services via a context built per request. | Nest DI for services, end-to-end types for the web app. |
| Chat streaming | Dedicated Nest controller `POST /chat/:chatId/stream` returning an AI SDK UI-message stream (SSE). Web uses AI SDK `useChat`. | Native AI SDK streaming incl. custom data parts for citations; tRPC stays for CRUD. |
| Auth in API | Web sends Supabase access token as `Authorization: Bearer`. API verifies it (JWKS / `auth.getClaims`) and creates a **per-request Supabase client with the user's JWT**, so RLS applies to every API query. | RLS is the primary isolation boundary, not app code. |
| Service role | Only in the worker (and in narrowly scoped API code paths that RLS cannot express, e.g. enqueueing). Every service-role query filters by `user_id` explicitly. Never exposed to the web app. | Defense in depth. |
| Queue | **pg-boss** on the Supabase Postgres (direct connection, not the transaction pooler). Worker runs with concurrency 1. | No extra infra (no Redis); transactional, retries, scheduling built in. |
| Ingestion location | Ingestion jobs run in the worker too (queue `ingest-source`), podcast jobs in queue `generate-podcast`. See open question Q1 on concurrency. | Keeps API stateless and fast. |
| Embeddings | `text-embedding-3-large`, full 3072 dims stored as `halfvec(3072)` with an HNSW index (`halfvec_cosine_ops`). | pgvector HNSW on `vector` is capped at 2000 dims; `halfvec` supports up to 4000 with negligible quality loss. |
| Retrieval | Hybrid: vector top-k + Postgres full-text (`tsvector`) merged via Reciprocal Rank Fusion, filtered by `user_id` and selected `source_id`s. | Better recall on names, numbers, and exact terms. |
| Shared contracts | `packages/shared` holds zod schemas, enums, constants and the citation format; the API's `AppRouter` type is imported by the web app as a type-only import. | Single source of truth, no runtime coupling. |
| Testing | Vitest everywhere (Nest via `unplugin-swc`), Playwright for a few E2E smoke flows, RLS tests against local Supabase. | One runner, fast. |

## 3. Repository Layout

```
notebook-lite/
├─ apps/
│  ├─ web/            Next.js (App Router), Tailwind, shadcn/ui
│  ├─ api/            NestJS: tRPC router, chat SSE, auth guard
│  └─ worker/         NestJS standalone app: pg-boss consumers
├─ packages/
│  ├─ shared/         zod schemas, types, constants, citation utils
│  ├─ db/             generated Supabase types, typed query helpers, retrieval SQL
│  ├─ ai/             prompts, model config, chunking, embedding, script generation
│  └─ config/         shared tsconfig, ESLint, Prettier, Vitest presets
├─ supabase/
│  ├─ migrations/     SQL migrations (schema, RLS, storage policies, functions)
│  ├─ tests/          pgTAP / SQL tests for RLS
│  └─ config.toml
├─ docker/            Dockerfiles for web, api, worker
├─ docs/              BRIEFING, IMPLEMENTATION_PLAN, CORRECTIONS
├─ AGENTS.md
└─ package.json       npm workspaces, root scripts
```

Root scripts: `lint`, `typecheck`, `test`, `build`, `dev` (all apps in parallel), `db:start`, `db:reset`, `db:types`.

## 4. Data Model

All tables in `public`, all with `user_id uuid not null references auth.users on delete cascade`, RLS enabled, policies `user_id = (select auth.uid())` for select/insert/update/delete unless noted.

| Table | Columns (abridged) | Notes |
|---|---|---|
| `sources` | `id, user_id, kind ('pdf'\|'docx'\|'md'\|'url'), title, original_url, storage_path, mime_type, size_bytes, status ('pending'\|'processing'\|'ready'\|'failed'), error, page_count, token_count, created_at` | Status updated only by worker (insert by user, update of `status` via service role). |
| `source_chunks` | `id, source_id, user_id, ordinal, content, page_start, page_end, heading_path text[], char_start, char_end, token_count, embedding halfvec(3072), fts tsvector generated` | HNSW index on `embedding`, GIN on `fts`, btree on `(user_id, source_id)`. Read-only for users. |
| `chats` | `id, user_id, title, created_at, updated_at` | |
| `chat_sources` | `chat_id, source_id, user_id` (PK chat_id+source_id) | Policy additionally checks both chat and source belong to `auth.uid()`. |
| `messages` | `id, chat_id, user_id, role ('user'\|'assistant'), content, parts jsonb, citations jsonb, model, usage jsonb, created_at` | `citations`: `[{ marker, chunkId, sourceId, page, quote }]` — a snapshot so citations survive source deletion. |
| `podcasts` | `id, user_id, title, topic, mode ('monologue'\|'dialogue'), target_minutes (2\|6\|15), status ('queued'\|'scripting'\|'synthesizing'\|'ready'\|'failed'), error, script jsonb, storage_path, duration_seconds, created_at` | |
| `podcast_sources` | `podcast_id, source_id, user_id` | |

**DB functions**

- `match_chunks(query_embedding halfvec, query_text text, source_ids uuid[], match_count int)` — `security invoker` so RLS applies; hybrid RRF ranking.
- Trigger: `chat_sources`/`podcast_sources` insert guard verifying ownership of both sides (belt and braces with RLS).

**Storage**

- Private buckets `sources` and `podcasts`.
- Object path convention `{user_id}/{entity_id}/{filename}`; storage policies on `storage.objects` require `(storage.foldername(name))[1] = auth.uid()::text`.
- Upload size limit (e.g. 25 MB) and allowed MIME types configured on the bucket.

## 5. Feature Design

### 5.1 Auth

- `/login`: email field → `signInWithOtp` → 6-digit code input → `verifyOtp`. Session via `@supabase/ssr` cookies; Next.js middleware protects app routes.
- API `AuthGuard` (Nest) and tRPC `protectedProcedure` both reuse one `AuthService.verify(token)`.
- Supabase email template switched to show the OTP code (`{{ .Token }}`), not a magic link.

### 5.2 Source ingestion

1. Web uploads file directly to Storage (`sources/{uid}/{sourceId}/{name}`) with supabase-js (RLS-protected), then calls `sources.create` (tRPC) → row with `status = 'pending'` → API enqueues `ingest-source`.
   URL sources: `sources.createFromUrl` validates the URL and enqueues; the worker fetches.
2. Worker pipeline:
   - **Extract**
     - PDF: `unpdf` (pdf.js) page by page → keep page numbers.
     - DOCX: `mammoth` → HTML → Markdown (`turndown`) to retain headings.
     - MD: read as-is.
     - URL: fetch with SSRF protection (http/https only, block private/link-local IPs after DNS resolution, redirect limit, timeout, max size, HTML only) → `@mozilla/readability` + `jsdom` → Markdown. Store snapshot in Storage for reproducibility.
   - **Chunk**: structure-aware splitter (headings/paragraphs), ~800 tokens target, ~120 overlap, never cross page boundaries for PDFs without recording `page_start/page_end`.
   - **Embed**: AI SDK `embedMany` in batches (≤ 2048 inputs, token-aware), retry with backoff.
   - **Persist**: insert chunks in one transaction; set `status = 'ready'`, `title` (PDF metadata / first heading / `<title>`).
   - Failures → `status = 'failed'` with a user-readable `error`; pg-boss retries transient errors (3×, exponential).
3. Web shows status badges; list refreshes via polling while any source is non-terminal (Supabase Realtime is a later optimization).
4. Delete source: deletes row (chunks cascade) and Storage objects; existing message citations keep their snapshot and render as "source deleted".

### 5.3 Grounded chat with citations

1. `POST /chat/:chatId/stream` with the new user message. API loads the chat's selected sources (RLS). No sources selected → 400 with a clear UI hint.
2. **Query rewriting**: for follow-ups, a cheap LLM call condenses history + question into a standalone search query.
3. **Retrieval**: embed query → `match_chunks` (top 12 after RRF, max ~8k context tokens) → number chunks `[1]..[n]`.
4. **Generation** (`streamText`, `gpt-6.1-terra`): system prompt enforces:
   - answer only from the provided excerpts; no outside knowledge;
   - every sentence/claim ends with one or more markers `[n]`;
   - if the excerpts don't contain the answer, say so explicitly (no marker needed for that statement);
   - answer in the language of the question.
5. **Citation transport**: before streaming text, send a custom data part `data-citations` with the marker → `{chunkId, sourceId, sourceTitle, page, quote}` map. Web renders markers as clickable chips; hover shows the quote, click opens a side panel with the source passage highlighted.
6. **Post-processing** (`onFinish`): parse markers, drop invalid ones, persist assistant message with `citations` snapshot and `usage`. Log a warning metric for sentences without markers (grounding check); an optional strict mode can append a disclaimer.
7. Chat title auto-generated after the first exchange.

### 5.4 Podcast generation

1. **Wizard (web)**: pick sources → mode → length → topic (free text) or "Suggest topics".
2. **Suggestions** (`podcasts.suggestTopics`, synchronous in API): sample representative chunks per source (first chunks + diverse vector sample) → `generateObject` with zod schema `{ topics: [{ title, angle }] }` length 3.
3. **Create** (`podcasts.create`): row `status = 'queued'` → enqueue `generate-podcast`.
4. **Worker**:
   - **Context**: retrieve chunks relevant to the topic (higher k, ~20–40k tokens budget depending on length).
   - **Script** (`status = 'scripting'`): target word counts at ~150 wpm → 2 min ≈ 300, 6 min ≈ 900, 15 min ≈ 2,250 words. For 15 min: outline first, then generate per section to stay within output limits. Output via `generateObject`: `{ title, segments: [{ speaker: 'A'|'B', text }] }`. Monologue uses only `A`. Prompt: grounded in sources only, conversational, no markdown, no citations read aloud.
   - **TTS** (`status = 'synthesizing'`): ElevenLabs, one configured voice per speaker (env vars). Per-segment TTS with `previous_text`/`next_text` (request stitching) for natural prosody; segments longer than the model limit are split at sentence boundaries. Concatenate MP3s with `ffmpeg` (concat demuxer, re-encode to a uniform 128 kbps) and add short pauses between speakers. (Alternative: ElevenLabs text-to-dialogue endpoint — evaluate in a spike, see Q4.)
   - **Store**: upload `podcasts/{uid}/{podcastId}.mp3`, set `duration_seconds`, `status = 'ready'`.
   - Persist the script in `podcasts.script` so TTS can be retried without regenerating text.
5. **Web**: podcast list with progress status (polling), audio player via short-lived signed URL, download button, script transcript view.

### 5.5 Cross-cutting

- **Validation**: all tRPC inputs via zod schemas from `packages/shared`.
- **Rate limiting**: per-user limits for chat messages, podcast creation (e.g. 1 queued/active per user) and suggestions (Nest throttler).
- **Observability**: structured JSON logs (pino) with request/job ids; health endpoints `/healthz` for api and worker.
- **Config**: env validated at boot with zod; fail fast.
- **Error UX**: toasts for user errors, inline status for jobs.

## 6. UI Structure (apps/web)

- `/login` — OTP flow.
- `/` (app shell) — left sidebar: chats list, "New chat", Podcasts link; main area depends on route.
- `/sources` — library: upload dropzone, URL input, list with status, delete.
- `/chats/[id]` — three-pane: source selector (checkbox list from library, inline "add source"), message thread with citation chips, collapsible source viewer panel.
- `/podcasts` — list + "New podcast" wizard (dialog/stepper); `/podcasts/[id]` detail with player, script.
- shadcn components: Button, Input, Dialog, Sheet, Checkbox, Tabs, Toast (sonner), Badge, Tooltip/HoverCard, ScrollArea, Skeleton.

## 7. Environment Variables

| Var | web | api | worker |
|---|:-:|:-:|:-:|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key) | ✓ | | |
| `NEXT_PUBLIC_API_URL` | ✓ | | |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | | ✓ | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` (secret key) | | ✓ (enqueue only, if needed) | ✓ |
| `DATABASE_URL` (direct connection, for pg-boss) | | ✓ | ✓ |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL=gpt-6.1-terra`, `OPENAI_EMBEDDING_MODEL=text-embedding-3-large` | | ✓ | ✓ |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_VOICE_A`, `ELEVENLABS_VOICE_B` | | | ✓ |
| `CORS_ORIGIN` | | ✓ | |

`.env.example` per app; real secrets only in Dokploy.

## 8. Deployment

- **Dokploy** project `notebook-lite` on `dokploy.soeenplop.dev` with three applications: `web`, `api`, `worker`, each built from `docker/<app>.Dockerfile` (multi-stage, `npm ci` with workspaces, prune to production deps). Worker image includes `ffmpeg`.
- GitHub integration with **auto-deploy on push to `main`**; set up via the Dokploy CLI and documented in `docs/DEPLOYMENT.md`.
- Domains: e.g. `notebook.<domain>` → web, `api.notebook.<domain>` → api (Traefik/HTTPS through Dokploy). Worker has no public domain.
- **Supabase**: see Q2. Migrations applied with `supabase db push` from a GitHub Action on `main` *before* Dokploy deploys (or as a gated manual step initially).
- **CI (GitHub Actions)** on PRs and `main`: `npm ci` → lint → typecheck → test → build; RLS tests against `supabase start`.

## 9. Testing Strategy

| Layer | What | Tool |
|---|---|---|
| Unit | chunker, citation parser/validator, prompt builders, word-count targets, URL/SSRF guard, extractors (fixture PDF/DOCX/MD/HTML) | Vitest |
| Integration | tRPC routers & chat controller with mocked AI SDK provider (`MockLanguageModelV2`) and local Supabase | Vitest + Supabase CLI |
| RLS | user A cannot read/write user B's sources, chunks, chats, messages, podcasts, storage objects; cross-user `chat_sources` insert rejected | pgTAP or Vitest with two JWTs |
| Worker | ingestion & podcast jobs end-to-end with mocked OpenAI/ElevenLabs | Vitest |
| E2E smoke | login (OTP via local Inbucket/Mailpit), upload MD, ask question, see citation | Playwright |

No test hits real OpenAI/ElevenLabs in CI.

## 10. Milestones & Commit Sequence

Each bullet ≈ one small, self-contained commit (lint, build, tests green).

**M0 — Foundation**
1. Root npm workspaces, `packages/config` (tsconfig, ESLint flat config, Prettier), root scripts, `.nvmrc`, `.gitignore`, `AGENTS.md`, `docs/CORRECTIONS.md`.
2. `packages/shared` skeleton with Vitest.
3. `apps/api` Nest skeleton + `/healthz` + env validation.
4. `apps/worker` Nest standalone skeleton + health.
5. `apps/web` Next.js + Tailwind + shadcn init.
6. GitHub Actions CI.

**M1 — Supabase & Auth**
7. `supabase init`, local config, OTP email template.
8. Migration: `sources`, `chats`, `chat_sources`, `messages`, `podcasts`, `podcast_sources` + RLS; generated types in `packages/db`.
9. RLS tests.
10. Web: Supabase SSR client, middleware, `/login` OTP flow.
11. API: auth guard, per-request user Supabase client, tRPC mount with `protectedProcedure`; web tRPC client + React Query.

**M2 — Sources**
12. Storage buckets + policies (migration) + tests.
13. tRPC `sources.*` (list, create, createFromUrl, delete) and web library page with upload.
14. pg-boss setup (shared queue module, job type contracts in `shared`).
15. Migration: `source_chunks`, `match_chunks`, indexes.
16. Extractors (MD, PDF, DOCX) with fixtures.
17. URL fetcher with SSRF guard + readability.
18. Chunker + embedder in `packages/ai`.
19. Worker `ingest-source` job; status polling in web.

**M3 — Chat**
20. tRPC `chats.*` (CRUD, set sources) + chats sidebar & source selector.
21. Retrieval service (query rewrite, hybrid search) with tests.
22. Grounded prompt + citation parser in `packages/ai`.
23. Chat SSE controller with `data-citations` part + persistence.
24. Web chat thread with `useChat`, citation chips, source viewer panel.
25. Auto chat titles.

**M4 — Podcasts**
26. tRPC `podcasts.suggestTopics`, `podcasts.create/list/get/delete`.
27. Script generation (outline + sections, word targets) with tests.
28. ElevenLabs TTS client + segment splitting.
29. ffmpeg concatenation + Storage upload; worker `generate-podcast` job.
30. Web podcast wizard, list, player, transcript.

**M5 — Deployment & Hardening**
31. Dockerfiles for web/api/worker.
32. Dokploy project + apps + auto-deploy via CLI; `docs/DEPLOYMENT.md`.
33. Migration GitHub Action.
34. Rate limiting, structured logging, error states, empty states.
35. Playwright smoke test.

(Deployment can be pulled forward right after M1 to get a walking skeleton live early — recommended.)

## 11. Risks

| Risk | Mitigation |
|---|---|
| Model hallucinates or omits citations | Strict prompt, numbered excerpts, marker validation, grounding metric, "not in sources" fallback. |
| Long podcasts exceed output limits / drift | Outline-then-sections generation, word targets, persisted script. |
| ElevenLabs latency/cost for 15-min dialogues | Per-segment synthesis with retries, script cached, single concurrent job. |
| Ingestion blocked behind a long podcast job | See Q1. |
| SSRF via URL sources | Resolve DNS and block private ranges, protocol/size/time limits. |
| Service-role key misuse | Only in worker; explicit `user_id` filters; code review rule in AGENTS.md. |
| Scanned PDFs yield no text | Detect empty extraction → `failed` with clear message (OCR out of scope). |

## 12. Open Questions

- **Q1 — Worker concurrency:** Does "at most one concurrent job" apply globally (ingestion waits behind a 15-min podcast) or per queue? *Recommendation:* one concurrent job per queue (`ingest-source`, `generate-podcast`), both in the single worker process.
- **Q2 — Supabase hosting:** Supabase Cloud or self-hosted on Dokploy? *Recommendation:* Supabase Cloud (managed Auth emails, backups, pgvector).
- **Q3 — Domains:** Which hostnames for web and api?
- **Q4 — Dialogue TTS:** Per-segment TTS + ffmpeg vs. ElevenLabs text-to-dialogue endpoint — decide after a short spike comparing quality and limits. Voices: which two voice IDs?
- **Q5 — Notebooks:** Sources are a per-user library selectable per chat (as in the briefing), not grouped into notebooks — confirm.
- **Q6 — Model availability:** Confirm `gpt-6.1-terra` access and limits (context/output tokens) on the account.
