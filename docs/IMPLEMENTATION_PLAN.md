# Implementation Plan

Derived from [BRIEFING.md](BRIEFING.md). Deviations from this plan are logged in [CORRECTIONS.md](CORRECTIONS.md).

## 1. Scope

**In scope (MVP)**

- Email-OTP sign-in (Supabase Auth), strict per-user data isolation.
- **Notebooks**: create, edit, delete. A notebook has a name, an optional description, and a **language**. Each notebook has exactly one user, its owner. Ownership chain: user → notebook → sources / chats / podcasts.
- **Notebook language** applies to every operation inside the notebook: chat answers, chat titles, query rewriting, topic suggestions, podcast scripts, TTS, and the full-text search configuration.
- Sources per notebook: upload PDF, DOCX, MD; add web pages by URL. Background ingestion (extract → chunk → embed).
- Chats per notebook: each chat selects from its notebook's sources. Answers are grounded only in the selected sources, and every statement carries a citation that links back to the source passage.
- Podcasts per notebook: select sources → choose mode (monologue / dialogue) and length (~2 / 6 / 15 min) → enter a topic or pick one of three LLM suggestions → LLM writes the script → ElevenLabs produces the MP3 → playback and download.
- Deployment to Dokploy on push to `main`.

**Out of scope (MVP)**

Sharing/collaboration and multiple members per notebook, moving or copying sources between notebooks, OCR for scanned PDFs, YouTube/audio sources, editing scripts before TTS, billing/quotas beyond basic rate limits, UI localization (the app UI stays in one language; the notebook language only controls generated content).

## 2. Architecture

```
┌──────────────┐  tRPC (HTTP)  ┌──────────────┐  enqueue   ┌──────────────┐
│  apps/web    │──────────────▶│  apps/api    │──────────▶│ apps/worker  │
│  Next.js     │  SSE (chat)   │  NestJS      │  (pg-boss) │ NestJS       │
│  shadcn/ui   │◀──────────────│  tRPC + SSE  │            │ 1 job/queue  │
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
| Queue | **pg-boss** on the Supabase Postgres (direct connection, not the transaction pooler). The worker runs **at most one concurrent job per queue** (`localConcurrency: 1`). | No extra infra (no Redis). Transactions, retries, and scheduling are built in. |
| Ingestion location | Ingestion runs in the worker on queue `ingest-source`, and podcasts on queue `generate-podcast`. Both queues run in parallel, one job each. | Keeps the API stateless and fast. A long podcast job never blocks ingestion. |
| Hosting | **Supabase Cloud** for Postgres, Auth, and Storage. Dokploy hosts web, api, and worker. | Managed backups and Auth emails with less operational work. |
| Embeddings | `text-embedding-3-large`, full 3072 dims stored as `halfvec(3072)` with an HNSW index (`halfvec_cosine_ops`). | pgvector HNSW on `vector` is capped at 2000 dims; `halfvec` supports up to 4000 with negligible quality loss. |
| Retrieval | Hybrid: vector top-k + Postgres full-text (`tsvector`) merged via Reciprocal Rank Fusion, filtered by `user_id` and selected `source_id`s. | Better recall on names, numbers, and exact terms. |
| Notebook ownership | Every child table also stores `user_id`, and a composite FK `(notebook_id, user_id) → notebooks(id, user_id)` keeps it consistent with the notebook owner. RLS stays a simple `user_id = auth.uid()`. | Cheap RLS checks with no joins. The DB cannot hold a child row whose owner differs from the notebook owner. A future sharing model can replace the policies without moving data. |
| Notebook language | A fixed list of supported languages in `packages/shared` (`SUPPORTED_LANGUAGES`: code, display name, Postgres FTS `regconfig`, ElevenLabs language code, words per minute). The initial set is **`de` and `en`**. Prompts take the language as an explicit parameter. | One place to add a language. The language is never inferred from the question or the sources. |
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

All tables live in `public`. Each has `user_id uuid not null references auth.users on delete cascade`, RLS enabled, and policies `user_id = (select auth.uid())` for select/insert/update/delete unless noted. Every table below `notebooks` has `notebook_id` with the composite FK `(notebook_id, user_id) → notebooks(id, user_id) on delete cascade`.

| Table | Columns (abridged) | Notes |
|---|---|---|
| `notebooks` | `id, user_id (owner), name (1–120 chars), description (nullable, ≤ 2000), language (check against supported codes), created_at, updated_at` | Unique `(id, user_id)` as the target of the composite FKs. A language change re-computes `source_chunks.fts` for the notebook (trigger). Existing messages and podcasts stay unchanged. |
| `sources` | `id, user_id, notebook_id, kind ('pdf'\|'docx'\|'md'\|'url'), title, original_url, storage_path, mime_type, size_bytes, status ('pending'\|'processing'\|'ready'\|'failed'), error, page_count, token_count, created_at` | Status updated only by worker (insert by user, update of `status` via service role). |
| `source_chunks` | `id, source_id, notebook_id, user_id, ordinal, content, page_start, page_end, heading_path text[], char_start, char_end, token_count, embedding halfvec(3072), fts tsvector` | `fts = to_tsvector(language_regconfig(notebook.language), content)`, set on insert (a generated column cannot read the notebook). HNSW index on `embedding`, GIN on `fts`, btree on `(notebook_id, source_id)`. Read-only for users. |
| `chats` | `id, user_id, notebook_id, title, created_at, updated_at` | |
| `chat_sources` | `chat_id, source_id, notebook_id, user_id` (PK chat_id+source_id) | Composite FKs `(chat_id, notebook_id)` and `(source_id, notebook_id)` ensure that chat and source belong to the same notebook. |
| `messages` | `id, chat_id, user_id, role ('user'\|'assistant'), content, parts jsonb, citations jsonb, model, usage jsonb, created_at` | `citations`: `[{ marker, chunkId, sourceId, page, quote }]` — a snapshot so citations survive source deletion. |
| `podcasts` | `id, user_id, notebook_id, language (snapshot of notebook language at creation), title, topic, mode ('monologue'\|'dialogue'), target_minutes (2\|6\|15), status ('queued'\|'scripting'\|'synthesizing'\|'ready'\|'failed'), error, script jsonb, storage_path, duration_seconds, created_at` | |
| `podcast_sources` | `podcast_id, source_id, notebook_id, user_id` | Same-notebook composite FKs as `chat_sources`. |

Exception: `messages` reach their notebook through `chat_id` and have no `notebook_id` column.

**DB functions**

- `language_regconfig(code text) returns regconfig` — immutable mapping from supported language code to FTS config (e.g. `de → german`, `en → english`, fallback `simple`).
- `match_chunks(notebook_id uuid, query_embedding halfvec, query_text text, source_ids uuid[], match_count int)` — `security invoker` so RLS applies. Filters by notebook and selected sources, and parses `query_text` with the notebook's regconfig. Uses hybrid RRF ranking.
- Trigger on `notebooks.language` update: recompute `fts` for the notebook's chunks.

**Storage**

- Private buckets `sources` and `podcasts`.
- Object path convention `{user_id}/{notebook_id}/{entity_id}/{filename}`; storage policies on `storage.objects` require `(storage.foldername(name))[1] = auth.uid()::text`.
- Upload size limit (e.g. 25 MB) and allowed MIME types configured on the bucket.

## 5. Feature Design

### 5.1 Auth

- `/login`: email field → `signInWithOtp` → 6-digit code input → `verifyOtp`. Session via `@supabase/ssr` cookies; Next.js middleware protects app routes.
- API `AuthGuard` (Nest) and tRPC `protectedProcedure` both reuse one `AuthService.verify(token)`.
- Supabase email template switched to show the OTP code (`{{ .Token }}`), not a magic link.

### 5.2 Notebooks

- tRPC `notebooks.list/get/create/update/delete`. Inputs are validated with zod: name 1–120 chars, optional description ≤ 2000 chars, and `language` from `SUPPORTED_LANGUAGES`. The default language for a new notebook is the browser language if supported, otherwise `en`.
- Each notebook has exactly one user, its owner (`notebooks.user_id`). All child entities are reachable only through a notebook the user owns.
- **Language** is resolved once per request or job from the notebook and passed explicitly to every AI call: query rewriting, chat answers, chat titles, topic suggestions, podcast script, and TTS. It also selects the FTS config. A podcast stores its own `language` snapshot so a queued job is not affected by later edits.
- **Edit**: name and description can change freely. A language change applies to future answers and podcasts, and a DB trigger recomputes `fts` for existing chunks. Embeddings are language-agnostic and need no recomputation. Existing messages and podcasts are not regenerated.
- **Delete** (confirmation dialog showing counts of sources, chats, and podcasts):
  1. The API deletes the Storage prefixes `sources/{uid}/{notebookId}/` and `podcasts/{uid}/{notebookId}/` with the user client (RLS).
  2. It deletes the notebook row. Sources, chunks, chats, messages, and podcasts cascade.
  3. pending pg-boss jobs for the notebook are cancelled. Worker jobs also re-check that the notebook exists before each step and abort quietly if it doesn't.

### 5.3 Source ingestion

1. Web uploads the file directly to Storage (`sources/{uid}/{notebookId}/{sourceId}/{name}`) with supabase-js (RLS-protected), then calls `sources.create({ notebookId, … })` (tRPC) → row with `status = 'pending'` → API enqueues `ingest-source`.
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

### 5.4 Grounded chat with citations

1. `POST /chat/:chatId/stream` with the new user message. The API loads the chat, its notebook (including the language), and the selected sources, all through RLS. If no sources are selected, it returns 400 with a clear UI hint. New chats preselect all ready sources of the notebook.
2. **Query rewriting**: for follow-ups, a cheap LLM call condenses the history and question into a standalone search query. The query is written in the notebook language so full-text search matches the indexed content. Cross-language matches rely on the vector search.
3. **Retrieval**: embed the query → `match_chunks(notebookId, …)` (top 12 after RRF, max ~8k context tokens) → number the chunks `[1]..[n]`.
4. **Generation** (`streamText`, `gpt-6.1-terra`): system prompt enforces:
   - answer only from the provided excerpts; no outside knowledge;
   - every sentence/claim ends with one or more markers `[n]`;
   - if the excerpts don't contain the answer, say so explicitly (no marker needed for that statement);
   - answer in the **notebook language**, whatever language the question or the sources use (quotes in the citation hover stay in the original).
5. **Citation transport**: before streaming text, send a custom data part `data-citations` with the marker → `{chunkId, sourceId, sourceTitle, page, quote}` map. Web renders markers as clickable chips; hover shows the quote, click opens a side panel with the source passage highlighted.
6. **Post-processing** (`onFinish`): parse markers, drop invalid ones, persist assistant message with `citations` snapshot and `usage`. Log a warning metric for sentences without markers (grounding check); an optional strict mode can append a disclaimer.
7. The chat title is generated in the notebook language after the first exchange.

### 5.5 Podcast generation

1. **Wizard (web, inside a notebook)**: pick sources from the notebook → mode → length → topic (free text) or "Suggest topics".
2. **Suggestions** (`podcasts.suggestTopics({ notebookId, sourceIds })`, synchronous in the API): sample representative chunks per source (the first chunks plus a diverse vector sample) → `generateObject` with the zod schema `{ topics: [{ title, angle }] }`, exactly 3 topics, written in the notebook language.
3. **Create** (`podcasts.create`): row with `status = 'queued'` and `language` copied from the notebook → enqueue `generate-podcast`.
4. **Worker**:
   - **Context**: retrieve chunks relevant to the topic (higher k, ~20–40k tokens budget depending on length).
   - **Script** (`status = 'scripting'`): target word counts at ~150 wpm → 2 min ≈ 300, 6 min ≈ 900, 15 min ≈ 2,250 words. For 15 min: outline first, then generate per section to stay within output limits. Output via `generateObject`: `{ title, segments: [{ speaker: 'A'|'B', text }] }`. Monologue uses only `A`. Prompt: grounded in sources only, written in `podcast.language`, conversational, no markdown, no citations read aloud. The words-per-minute rate is configurable per language in `SUPPORTED_LANGUAGES`.
   - **TTS** (`status = 'synthesizing'`) uses the **ElevenLabs text-to-dialogue endpoint** for both modes:
     - Dialogue maps speaker A/B to `ELEVENLABS_VOICE_A`/`_B`. Monologue sends a single-voice input list.
     - The language comes from `podcast.language`, passed as the endpoint's language parameter if it supports one. Otherwise the language of the script text drives it.
     - The script is split at segment boundaries into batches below the endpoint's per-request character limit. A 15-minute script needs several requests.
     - Each batch is synthesized with retries, and the resulting MP3s are concatenated with `ffmpeg` (concat demuxer, re-encoded to a uniform 128 kbps).
     - Each batch's audio is cached in Storage so a failed job resumes instead of starting over.
     - The exact character limit, the language parameter, and the model ID are confirmed in a short spike at the start of M5.
   - **Store**: upload `podcasts/{uid}/{notebookId}/{podcastId}.mp3`, set `duration_seconds`, `status = 'ready'`.
   - Persist the script in `podcasts.script` so TTS can be retried without regenerating text.
5. **Web**: podcast list with progress status (polling), audio player via short-lived signed URL, download button, script transcript view.

### 5.6 Cross-cutting

- **Validation**: all tRPC inputs via zod schemas from `packages/shared`.
- **Rate limiting**: per-user limits for chat messages, podcast creation (e.g. 1 queued/active per user) and suggestions (Nest throttler).
- **Observability**: structured JSON logs (pino) with request/job ids; health endpoints `/healthz` for api and worker.
- **Config**: env validated at boot with zod; fail fast.
- **Error UX**: toasts for user errors, inline status for jobs.

## 6. UI Structure (apps/web)

- `/login` — OTP flow.
- `/` — notebook overview: cards with name, description, language badge, and source count. Includes "New notebook" (dialog: name, description, language select). Edit and delete are in each card's menu, and delete asks for confirmation.
- `/notebooks/[nid]` — notebook shell. The left sidebar holds the notebook name and language, the sources list (upload dropzone, URL input, status, delete), the chats list with "New chat", and a Podcasts link. A settings dialog edits the name, description, and language.
- `/notebooks/[nid]/chats/[cid]` — source selector (checkboxes over the notebook's sources), message thread with citation chips, and a collapsible source viewer panel.
- `/notebooks/[nid]/podcasts` — list and the "New podcast" wizard (dialog/stepper). `/notebooks/[nid]/podcasts/[pid]` shows the player and the script.
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
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID` (dialogue-capable model), `ELEVENLABS_VOICE_A`, `ELEVENLABS_VOICE_B` (voice IDs pending) | | | ✓ |
| `CORS_ORIGIN` | | ✓ | |

`.env.example` per app; real secrets only in Dokploy.

## 8. Deployment

- **Dokploy** project `notebook-lite` on `dokploy.soeenplop.dev` with three applications: `web`, `api`, `worker`, each built from `docker/<app>.Dockerfile` (multi-stage, `npm ci` with workspaces, prune to production deps). Worker image includes `ffmpeg`.
- GitHub integration with **auto-deploy on push to `main`**; set up via the Dokploy CLI and documented in `docs/DEPLOYMENT.md`.
- Domains: **`notebook.soeenplop.dev`** → web, **`notebook-api.soeenplop.dev`** → api (Traefik/HTTPS through Dokploy). The worker has no public domain. API `CORS_ORIGIN=https://notebook.soeenplop.dev`. The Supabase Auth site URL and redirect allow-list point to the web domain.
- **Supabase Cloud**: one project for production and the local Supabase CLI stack for development. pg-boss uses the direct (session) connection string. Migrations are applied with `supabase db push` from a GitHub Action on `main` *before* Dokploy deploys (or as a gated manual step initially).
- **CI (GitHub Actions)** on PRs and `main`: `npm ci` → lint → typecheck → test → build; RLS tests against `supabase start`.

## 9. Testing Strategy

| Layer | What | Tool |
|---|---|---|
| Unit | chunker, citation parser/validator, prompt builders, word-count targets, URL/SSRF guard, extractors (fixture PDF/DOCX/MD/HTML) | Vitest |
| Integration | tRPC routers & chat controller with mocked AI SDK provider (`MockLanguageModelV2`) and local Supabase | Vitest + Supabase CLI |
| RLS | user A cannot read/write user B's notebooks, sources, chunks, chats, messages, podcasts, storage objects; cross-user and cross-notebook `chat_sources`/`podcast_sources` inserts rejected; notebook delete cascades; FTS recomputed on language change | pgTAP or Vitest with two JWTs |
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
8. `SUPPORTED_LANGUAGES` in `packages/shared` + migration: `notebooks` (with `language_regconfig`) + RLS + RLS tests.
9. Migration: `sources`, `chats`, `chat_sources`, `messages`, `podcasts`, `podcast_sources` with composite notebook FKs + RLS; generated types in `packages/db`.
10. RLS tests incl. cross-user and cross-notebook rejection.
11. Web: Supabase SSR client, middleware, `/login` OTP flow.
12. API: auth guard, per-request user Supabase client, tRPC mount with `protectedProcedure`; web tRPC client + React Query.

**M2 — Notebooks**
13. tRPC `notebooks.*` (list, get, create, update, delete) with tests.
14. Web notebook overview, create/edit dialog, delete confirmation, notebook shell route.

**M3 — Sources**
15. Storage buckets + policies (migration) + tests.
16. tRPC `sources.*` (list, create, createFromUrl, delete; all scoped by `notebookId`) and sources panel with upload.
17. pg-boss setup (shared queue module, job type contracts in `shared`).
18. Migration: `source_chunks`, `match_chunks`, FTS language trigger, indexes.
19. Extractors (MD, PDF, DOCX) with fixtures.
20. URL fetcher with SSRF guard + readability.
21. Chunker + embedder in `packages/ai`.
22. Worker `ingest-source` job; status polling in web.
23. Notebook delete: Storage cleanup + job cancellation.

**M4 — Chat**
24. tRPC `chats.*` (CRUD, set sources) + chats sidebar & source selector.
25. Retrieval service (query rewrite in notebook language, hybrid search) with tests.
26. Grounded prompt (language-parameterized) + citation parser in `packages/ai`.
27. Chat SSE controller with `data-citations` part + persistence.
28. Web chat thread with `useChat`, citation chips, source viewer panel.
29. Auto chat titles.

**M5 — Podcasts**
30. tRPC `podcasts.suggestTopics`, `podcasts.create/list/get/delete`.
31. Script generation (outline + sections, per-language word targets) with tests.
32. ElevenLabs text-to-dialogue client (spike findings: limits, language parameter, model) + batch splitting.
33. Batch caching, ffmpeg concatenation + Storage upload; worker `generate-podcast` job.
34. Web podcast wizard, list, player, transcript.

**M6 — Deployment & Hardening**
35. Dockerfiles for web/api/worker.
36. Dokploy project + apps + auto-deploy via CLI; `docs/DEPLOYMENT.md`.
37. Migration GitHub Action.
38. Rate limiting, structured logging, error states, empty states.
39. Playwright smoke test (login → create notebook → upload MD → ask → citation).

(Deployment can be pulled forward right after M1 to get a walking skeleton live early — recommended.)

## 11. Risks

| Risk | Mitigation |
|---|---|
| Model hallucinates or omits citations | Strict prompt, numbered excerpts, marker validation, grounding metric, "not in sources" fallback. |
| Long podcasts exceed output limits / drift | Outline-then-sections generation, word targets, persisted script. |
| ElevenLabs latency/cost for 15-min dialogues | Batched text-to-dialogue requests with retries, script and per-batch audio cached, one podcast job at a time. |
| Text-to-dialogue limits or language handling differ from expectations | Spike at the start of M5. Fallback: per-segment TTS + ffmpeg (logged in CORRECTIONS if needed). |
| SSRF via URL sources | Resolve DNS and block private ranges, protocol/size/time limits. |
| Service-role key misuse | Only in worker; explicit `user_id` filters; code review rule in AGENTS.md. |
| Scanned PDFs yield no text | Detect empty extraction → `failed` with clear message (OCR out of scope). |

## 12. Open Questions

**Open**

- **Q4b — Voices:** ElevenLabs voice IDs for speaker A and B (to be provided; needed before M5).
- **Q6 — Model availability:** Confirm `gpt-6.1-terra` access and limits (context/output tokens) on the account.

**Resolved (2026-11-12)**

- **Q1 — Worker concurrency:** one concurrent job **per queue** (`ingest-source`, `generate-podcast`).
- **Q2 — Supabase hosting:** Supabase Cloud.
- **Q3 — Domains:** web `notebook.soeenplop.dev`, api `notebook-api.soeenplop.dev`.
- **Q4 — Dialogue TTS:** ElevenLabs text-to-dialogue endpoint (see [CORRECTIONS](CORRECTIONS.md)).
- **Q5 — Supported languages:** `de` and `en`.
