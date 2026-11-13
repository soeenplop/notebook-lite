# Corrections

Log of corrections to proposals or decisions. Newest entries first.

Format: **Scope** (what part of the system / which document) · **Original decision** · **Correction** · **Rationale**.

---

## 2026-11-13 — Podcast status: live over SSE instead of polling

- **Scope:** Podcast list and detail page (`apps/web`), `podcasts.onChange` tRPC subscription (`apps/api`), trigger on `public.podcasts` (`docs/IMPLEMENTATION_PLAN.md` §M5 "progress status (polling)").
- **Original decision:** The web polls `podcasts.list`/`podcasts.get` every 4 s while a podcast is in production.
- **Correction:** Status changes are pushed over **SSE** through a tRPC subscription (`httpSubscriptionLink`). A trigger on `public.podcasts` sends `pg_notify('podcast_changes', …)` when the status or title changes. The API holds one `LISTEN` connection per process and fans out notifications by `user_id`. Events carry only ids and the status, and the web refetches `list`/`get` through RLS when one arrives. It also refetches on every (re)connect, and when the server's listener reconnects it sends a `resync` event. The browser sends the access token as an `Authorization` header through the `eventsource` package, not in the URL.
- **Rationale:** The project owner asked for live updates without polling. Postgres NOTIFY needs no new infrastructure: it comes from the database's own commit, so the worker stays unchanged, and it works on the direct connection the API already uses for pg-boss. Supabase Realtime would have needed a publication, RLS-aware realtime auth in the API and a second client library.

## 2026-11-13 — Podcast scripts: podcast-style opening and closing

- **Scope:** Podcast script prompts (`packages/ai/src/podcast-prompts.ts`).
- **Original decision:** Open directly with a hook from the excerpts and explicitly no greeting; close with takeaways or an open question.
- **Correction:** Episodes open in three beats: a cold open (hook from the excerpts), a short welcome (in dialogue mode the hosts also greet each other) and a preview of the episode. They close in two beats: takeaways or an open question, ideally calling back to the hook, then a short farewell (hosts thank each other and the listener). The opening takes about 10 percent of the episode. The model must not invent a show name or host names, ask listeners to subscribe or rate, or announce future episodes. Outlined episodes put the opening only in the first section and the farewell only in the last.
- **Rationale:** Feedback from the project owner: start and end felt abrupt. A welcome and a farewell make episodes sound like a real podcast. Hosts and show stay nameless because voices are fixed per language and nothing in the product defines names.

## 2026-11-13 — Podcast speakers: 10 % faster

- **Scope:** Podcast audio (`apps/worker` ffmpeg step) and script length (`podcastWordTarget` in `packages/shared`).
- **Original decision:** The episode plays at the voices' natural ElevenLabs pace; the word target is the language's speaking rate (de 130, en 150 wpm) times the length in minutes.
- **Correction:** The worker speeds up the joined episode by `PODCAST_SPEECH_TEMPO` (1.1) with ffmpeg `atempo`, which keeps the pitch. The word target scales by the same factor, so episodes keep their ~2/6/15-minute length.
- **Rationale:** Request from the project owner: the speakers sounded too slow. The text-to-dialogue endpoint has no speed setting (`settings` only offers `stability`, `similarity`, `clone_strength`), so the tempo is changed after synthesis. The cached batch MP3s stay at natural pace, so resumed jobs are sped up exactly once.

## 2026-11-13 — Chunking: structured PDFs, embedding context, smaller chunks

- **Scope:** Ingestion (`apps/worker` PDF extractor, `packages/ai` chunker and embedding input) and chat retrieval (`RETRIEVAL_MATCH_COUNT`).
- **Original decision:**
  - PDFs were extracted as flat text via `unpdf` `extractText`.
  - Chunks were ~800 tokens (max 1000, overlap 120). Only the chunk content was embedded.
  - The chat retrieved 12 candidates.
  - When this was planned, the sentence splitter was also supposed to get the notebook language.
- **Correction:**
  - PDF structure (headings by font size, paragraphs, lists, de-hyphenation, running headers/footers dropped) is rebuilt from pdf.js text positions (`pdf-layout.ts`).
  - The embedding input carries a header with the source title and heading path.
  - Chunks are ~450 tokens (max 600, overlap 70), and a tiny final chunk merges into the previous one. The chat retrieves 20 candidates, and the per-source cap grows to 9000 chunks.
  - **Not** passing the notebook language to `Intl.Segmenter`: sentences cut at abbreviations ("Dr.", "z. B.", "e.g.") are joined again instead.
- **Rationale:**
  - Flat PDF text gave one block per page, no heading paths, and hyphenated words that hurt embeddings and FTS.
  - Smaller chunks with a context header keep each vector on one topic.
  - The locale was a no-op: V8's ICU sentence segmenter splits identically for `de`, `en` and no locale, and it has no abbreviation handling. The actual defect was the abbreviation splits.
  - Docling or a hosted parser would give better layout and tables (and OCR), but that is a separate architectural decision.

## 2026-11-13 — Job queues: heartbeats, settings applied on every start

- **Scope:** Job queue (`packages/queue` `QUEUE_SETTINGS`, `JobQueue.start`), both queues.
- **Original decision:** Abandoned jobs are bounded only by `expireInSeconds` (15 min for `ingest-source`, 60 min for `generate-podcast`). `QUEUE_SETTINGS` were applied only when a queue was created.
- **Correction:** Every queue sets `heartbeatSeconds: 30`. pg-boss refreshes the heartbeat while the handler runs, and the worker's supervisor retries jobs whose heartbeat went stale. `JobQueue.start` now also applies `QUEUE_SETTINGS` to existing queues (`updateQueue`), so policy changes reach production.
- **Rationale:** A deploy replaced the worker while it was rendering a 2-minute podcast. The job stayed `active` with no worker, and the podcast showed "Recording audio" until the 60-minute expiry. With heartbeats an abandoned job is retried within about two minutes. The pipeline resumes from the saved script and cached batches, so the retry costs little.

## 2026-11-13 — Podcast topic suggestions: smaller sample, low reasoning effort, streamed

- **Scope:** Podcast topic suggestions (`podcasts.suggestTopics`, `packages/ai` `streamPodcastTopics`, the wizard's topic step).
- **Original decision:** Sample up to 16 chunks / ~14k tokens, ask the chat model with its default reasoning effort for an object with exactly three topics, and return all three at once from a tRPC mutation (see the M5 entry below).
- **Correction:**
  - The sample is at most 8 chunks / ~6k tokens (still the first two chunks per source plus an even spread).
  - The call sets `reasoningEffort: 'low'` (`TOPIC_REASONING_EFFORT`).
  - The topics are streamed: `streamText` with `Output.array` yields each topic as soon as it is complete, the procedure returns an async iterable, and the web client sends this procedure through `httpBatchStreamLink` (all others keep `httpBatchLink`). Checks (sources, rate limit, empty sample) still run before the stream starts and fail as ordinary errors; failures mid-stream become a generic `INTERNAL_SERVER_ERROR`. Aborting on the client aborts the LLM call.
- **Rationale:** Suggestions took long enough to feel broken. Prompt length and default reasoning dominated the time to the first token, and three topics need only an overview of the sources and little reasoning. Streaming shows the first topic after roughly a third of the generation time.

## 2026-11-13 — Podcast scripts: personalities, hook, audio tags

- **Scope:** Podcast script prompts and cleanup (`packages/ai/src/podcast-prompts.ts`, `podcasts.ts`), transcript (`apps/web`).
- **Original decision:** Plain, neutral scripts: host A asks, host B explains; open with a short hook, close with a wrap-up; no stage directions of any kind in the text.
- **Correction:** The hosts get distinct personalities (A curious and skeptical, speaking for the listener; B the enthusiastic expert) and real conversation mechanics (follow-ups, reactions, friendly disagreement). The hook comes from the excerpts (surprising fact, contradiction or question), the ending gives concrete takeaways, long episodes follow an arc, and contradictions between sources are highlighted. Sparse fillers per language are allowed. Scripts may contain one audio tag per turn from `PODCAST_AUDIO_TAGS` (`packages/shared`); all other bracketed text is removed, titles never keep tags, and the transcript hides them.
- **Rationale:** Decision by the project owner: the episodes were correct but flat. Eleven v4 (like v3) reads bracketed audio tags as delivery cues; a fixed list keeps the output predictable. Grounding is unchanged: analogies may explain, but must not add facts.

## 2026-11-13 — Podcast TTS model: eleven_v4

- **Scope:** Podcast TTS (`ELEVENLABS_MODEL_ID` in `apps/worker`, `.env.example`, Dokploy worker environment).
- **Original decision:** `eleven_v3` (the text-to-dialogue endpoint's default) as the default model.
- **Correction:** The default is `eleven_v4`, and production sets `ELEVENLABS_MODEL_ID=eleven_v4` explicitly on the worker. Request format, batching (≤ 2,000 characters) and voices are unchanged.
- **Rationale:** Decision by the project owner. Local development already used `eleven_v4`; production was still on the `eleven_v3` default because the variable was not set in Dokploy.

## 2026-11-13 — Chat answers: Markdown via Streamdown

- **Scope:** Chat answer rendering (`apps/web/src/components/chats/citation-text.tsx`).
- **Original decision:** Render answers with `react-markdown` + `remark-gfm` and a remark plugin that turns `[n]` markers into citation chips; the whole answer is re-parsed on every streamed chunk.
- **Correction:** Follow the AI SDK cookbook recipe "Markdown Chatbot with Memoization" and render answers with **Streamdown**, which splits the Markdown into blocks and memoizes them while streaming. Citation chips come from a rehype plugin that runs after Streamdown's sanitizer. Streamdown's `raw` rehype plugin is left out (no raw HTML), images are disallowed, and links open through Streamdown's confirmation dialog.
- **Rationale:** Decision by the project owner. Block memoization keeps long streamed answers cheap to re-render, and Streamdown also handles incomplete Markdown during streaming (unclosed emphasis, lists, code fences).

## 2026-11-13 — Podcast voices: back to the voice-library voices

- **Scope:** Podcast TTS voices (`SUPPORTED_LANGUAGES` in `packages/shared`).
- **Original decision:** ElevenLabs default voices (see the next entry), because the free plan rejected library voices.
- **Correction:** The voice-library voices are used again: German `gSZiss4v1BGsE1cTgoWF` (A) / `cwXXmRbp4lGQdqLfbcKH` (B), English `T2sZgOl8ol4kf4u6yM2z` (A) / `BAdH0bMfq6VleQGLXj38` (B). Both pairs were tested against text-to-dialogue with `eleven_v3`.
- **Rationale:** Decision by the project owner after the ElevenLabs account was changed so the library voices work via the API. They were chosen for the podcasts originally.

## 2026-11-13 — Podcast voices: ElevenLabs default voices

- **Scope:** Podcast TTS voices (`SUPPORTED_LANGUAGES` in `packages/shared`).
- **Original decision:** Voice-library voices per language (German `gSZiss4v1BGsE1cTgoWF`/`cwXXmRbp4lGQdqLfbcKH`, English `T2sZgOl8ol4kf4u6yM2z`/`BAdH0bMfq6VleQGLXj38`).
- **Correction:** ElevenLabs default voices: German Laura (A, `FGY2WhTYpPnrIDTdsKH5`) and Brian (B, `nPczCjzI2devNBz1zQrb`); English Jessica (A, `cgSgspJ2msm6clMCkdW9`) and George (B, `JBFqnCBsd6RMkjVDRZzb`). Both pairs were tested against the text-to-dialogue endpoint with `eleven_v3`.
- **Rationale:** The account is on the ElevenLabs free plan, which returns 402 `paid_plan_required` for voice-library voices via the API, so every podcast failed at the audio step. Decision by the project owner. The library voices can come back after an upgrade.

## 2026-11-13 — Podcast voices per notebook language

- **Scope:** Podcast TTS (`docs/IMPLEMENTATION_PLAN.md` §5.5, §7, Q4b; `packages/shared` languages; worker env).
- **Original decision:** One voice pair for all languages, set via `ELEVENLABS_VOICE_A`/`ELEVENLABS_VOICE_B` in the worker environment.
- **Correction:** Each supported language has its own voice pair (`podcastVoices: { A, B }` in `SUPPORTED_LANGUAGES`), chosen by the podcast language. German: A `gSZiss4v1BGsE1cTgoWF`, B `cwXXmRbp4lGQdqLfbcKH`. English: A `T2sZgOl8ol4kf4u6yM2z`, B `BAdH0bMfq6VleQGLXj38`. The two voice env vars are removed; only `ELEVENLABS_API_KEY` is needed for podcast audio. Resolves Q4b.
- **Rationale:** Voice IDs provided by the project owner, separately for German and English. Native voices per language sound better than one pair for both. Voice IDs are not secrets, and keeping them next to the other per-language settings means adding a language is one entry in one place.

## 2026-11-13 — M5 podcasts: ElevenLabs spike results and implementation details

- **Scope:** Podcast generation (`docs/IMPLEMENTATION_PLAN.md` §4 Storage, §5.5, §5.6, §7, §10 M5).
- **Original decision:**
  - The text-to-dialogue character limit, language parameter and model ID were to be confirmed in a spike.
  - The final MP3 lives at `podcasts/{uid}/{notebookId}/{podcastId}.mp3`.
  - Topic suggestions sample "the first chunks plus a diverse vector sample" per source.
  - Podcast rate limit: "1 queued/active per user" (Nest throttler).
- **Correction:**
  - **Spike (ElevenLabs docs, 2026-11-13):** `POST /v1/text-to-dialogue` with
    `{ inputs: [{ text, voice_id }], model_id, language_code }`; `model_id` defaults to `eleven_v3`
    (the model behind text-to-dialogue; German is supported); `language_code` is ISO 639-1 and is
    ignored by models that don't support it; `output_format` query parameter, default
    `mp3_44100_128`; auth header `xi-api-key`; at most 10 distinct voices. The endpoint documents
    **2,000 characters across all inputs per request** for reliable output (plain TTS with
    `eleven_v3` allows 5,000). Batches therefore stay at or below 2,000 characters and break at
    segment boundaries (sentence or word boundaries only for a single overlong segment). A
    15-minute English script (~13,500 characters) needs about 7 requests. No blocking limits, so
    the per-segment TTS fallback is not needed. Request stitching (`previous_request_ids`) is not
    used yet.
  - Audio lives in a folder per podcast, following the general `{user_id}/{notebook_id}/{entity_id}/{filename}`
    convention: `{uid}/{notebookId}/{podcastId}/podcast.mp3` plus `batch-{n}.mp3` while the job
    runs (deleted after success). Deleting a podcast removes the whole folder.
  - Topic suggestions sample the first two chunks of each source plus chunks evenly spread over the
    rest (by ordinal), up to 16 chunks and ~14k tokens, instead of a vector-diversity sample. It
    needs no embedding call and no new SQL function, and covers the whole document.
  - Limits: one podcast in production per user, checked in the API **and** enforced by a partial
    unique index (migration `20261113300000`); plus `PODCASTS_PER_DAY` (default 10, counted in the
    database) and `PODCAST_SUGGESTIONS_PER_HOUR` (default 20, in memory per API instance). A
    stuck podcast can always be deleted by its owner.
  - The worker's ElevenLabs variables are optional at boot (voice IDs are still open, Q4b): the
    worker keeps running ingestion, and podcast jobs fail with "Podcast audio is not configured
    yet". The API and the worker now require `OPENAI_API_KEY`.
- **Rationale:** Spike results from the official API reference; the remaining points keep M5
  within its scope (no new SQL beyond the index) and make the limits hold under concurrent
  requests.

## 2026-11-13 — Chat (M4): per-user limit, request body, source viewer

- **Scope:** Grounded chat (`docs/IMPLEMENTATION_PLAN.md` §5.4, §5.6, §6; `apps/api/src/chat`, `apps/web/src/components/chats`).
- **Original decision:**
  - Per-user rate limits use the Nest throttler (§5.6).
  - `useChat` posts the conversation to `POST /chat/:chatId/stream` (AI SDK default body).
  - Clicking a citation opens a side panel with "the source passage highlighted".
- **Correction:**
  - The per-user chat limit is a small in-memory fixed-window limiter (`UserRateLimiter`, `CHAT_MESSAGES_PER_MINUTE`, default 10 per minute), checked in the chat controller after `AuthGuard`. It sits on top of the global per-IP `express-rate-limit`.
  - The web sends only the new question (`{ text }`). The API loads the history from `messages` through RLS, so clients cannot inject fake assistant turns or citations.
  - `data-citations` carries every excerpt given to the model ([1]..[n]). The stored `messages.citations` snapshot keeps only the markers the answer uses, and unknown markers are removed from the stored text.
  - The source viewer shows the cited chunk as one highlighted passage (with page and heading path), not the chunk inside the full document. Once the source is deleted, it shows the stored quote and "Source deleted".
  - `OPENAI_API_KEY` is now required for the API to boot.
- **Rationale:**
  - The limiter needs the authenticated user id. The Nest throttler would add a dependency and a guard order problem for a single endpoint, and one API container does not need a shared store.
  - Server-side history is the source of truth for grounding and persistence.
  - The cited chunk is exactly what the model saw, so it is the passage to verify. A full-document view with in-place highlighting can follow later without schema changes.

## 2026-11-13 — M3 ingestion details: chunk writes, URL snapshots, job cancellation

- **Scope:** Source ingestion and notebook delete (`docs/IMPLEMENTATION_PLAN.md` §5.2, §5.3; M3 steps 22–23).
- **Original decision:**
  - The worker inserts all chunks of a source in one transaction.
  - URL sources store "a snapshot" in Storage (format unspecified).
  - Deleting a notebook cancels its pending pg-boss jobs, and jobs also re-check that the notebook exists.
- **Correction:**
  - Chunks are written through PostgREST in batches of 100 rows. A 3072-dim vector makes every row large, and one request per source could exceed request size limits. The source only becomes `ready` after the last batch, and every attempt first deletes the source's earlier chunks, so a failed or retried job never leaves a mix that is visible as ready.
  - The URL snapshot is the extracted Markdown (`sources/{uid}/{nid}/{sid}/snapshot.md`), not the raw HTML. Chunk offsets refer to exactly this text, and the `sources` bucket only accepts document types.
  - Notebook delete does not cancel queued jobs. The API removes the Storage folders and the notebook row; the job re-checks its source (which cascades with the notebook) before each step and stops quietly. A snapshot written after the cleanup is removed again.
- **Rationale:**
  - Request size limits and the existing idempotent retry path make batching safe.
  - The Markdown snapshot reproduces what was indexed; the raw page is not needed.
  - pg-boss jobs carry no notebook index, so cancelling would require scanning the queue; the existence check covers the same cases with less coupling (agreed for M3).

## 2026-11-12 — Shared groundwork before M3, M4 and M5 run in parallel

- **Scope:** Milestone order and sequencing (`docs/IMPLEMENTATION_PLAN.md` §10).
- **Original decision:** M3 (sources), M4 (chat) and M5 (podcasts) run strictly one after another. The `source_chunks` table and `match_chunks` (step 18), pg-boss (step 17) and the chunker and embedder (step 21) are built inside M3.
- **Correction:**
  - A **groundwork** milestone (G) lands on `main` first. It contains:
    - the `source_chunks` migration, the FTS triggers and `match_chunks`, with RLS tests;
    - `packages/ai` with model config, the chunker and the embedder;
    - `packages/queue` (pg-boss) wired into api and worker, with the job contracts for `ingest-source` and `generate-podcast` in `packages/shared`.
  - After that, M3, M4 and M5 run in parallel on separate branches. They merge in the order M3 → M4 → M5.
  - Steps that need ingested data end to end (the authenticated Playwright journey) run after the M3 merge. Before then, M4 and M5 test against seeded chunks or mocks.
- **Rationale:** Decision by the project owner. M4's retrieval and M5's worker only depend on these contracts, not on the rest of M3. Landing them once on `main` avoids three branches each creating `packages/ai`, the chunk schema and the queue setup.

## 2026-11-12 — Domains renamed to notebook-lite.*

- **Scope:** Deployment and configuration (`docs/DEPLOYMENT.md`, `docs/IMPLEMENTATION_PLAN.md` §8 and Q3, `AGENTS.md`, `supabase/config.toml`, Dokploy domains, app env, GitHub variables).
- **Original decision:** web on `notebook.soeenplop.dev`, api on `notebook-api.soeenplop.dev` (Q3).
- **Correction:** web moves to **`notebook-lite.soeenplop.dev`** and api to **`notebook-lite-api.soeenplop.dev`**. The old hostnames are removed from Dokploy. The following follow the new hostnames:
  - the api `CORS_ORIGIN` and the web `NEXT_PUBLIC_API_URL`, which requires a rebuild
  - the Supabase Auth site URL and redirect allow-list
  - the GitHub `WEB_URL` / `API_URL` variables
- **Rationale:** Decision by the project owner: the hostnames match the project name.

## 2026-11-12 — Deploys triggered by GitHub Actions; M6 pulled forward

- **Scope:** Deployment (`docs/IMPLEMENTATION_PLAN.md` §8 and §10 M6, `docs/DEPLOYMENT.md`).
- **Original decision:**
  - Dokploy's GitHub integration auto-deploys on push to `main`.
  - A separate GitHub Action applies migrations "before Dokploy deploys".
  - M6 (deployment and hardening) comes after M5.
- **Correction:**
  - Dokploy apps use the public repository as a plain `git` source, with no auto-deploy webhook.
  - `.github/workflows/deploy.yml` runs after CI passes on `main`: it applies migrations, runs the RLS tests, triggers the three Dokploy deployments, and smoke-tests production.
  - M6 is implemented right after M1, as the plan recommended, so a walking skeleton goes live early.
  - Hardening that depends on later features moves into those milestones: per-user limits for chat and podcasts, empty states for notebooks, sources and chats, and the authenticated Playwright journey (notebook → upload → ask → citation).
- **Rationale:**
  - With two independent triggers, migrations and deploys could race. One workflow guarantees schema → apps → verification.
  - Deploying early surfaces infrastructure problems while the app is still small.
  - The deferred items cannot be built or tested before their features exist.

## 2026-11-12 — Interim: magic-link emails until custom SMTP

- **Scope:** Auth / sign-in (`docs/IMPLEMENTATION_PLAN.md` §5.1, `supabase/config.toml`).
- **Original decision:** Email OTP sign-in. A custom Supabase email template shows the 6-digit code (`{{ .Token }}`), and the user types it in.
- **Correction:**
  - For now, sign-in emails use Supabase's default **link** templates. Supabase rejected the custom template: template changes on the free tier require a custom SMTP provider.
  - The login supports both flows: entering a code (`verifyOtp`) and clicking the link (PKCE callback `/auth/callback`).
  - The code template stays in `supabase/templates/otp.html`, commented out in `config.toml`.
  - Once a custom SMTP provider is configured, re-enable the template and push it with `npm run db:config`.
- **Rationale:** Decision by the project owner: unblock M1 now and add SMTP later. The built-in mailer is also limited to a few emails per hour, so custom SMTP is needed before going live anyway.

## 2026-11-12 — Remote Supabase only, no local stack

- **Scope:** Development setup, testing, configuration (`docs/IMPLEMENTATION_PLAN.md` §2, §7–9, `AGENTS.md`, `.env.example`).
- **Original decision:** Develop against a local Supabase CLI stack (`supabase start`, Docker), use Supabase Cloud only for production, run RLS tests against the local stack in CI, and use local Mailpit for OTP in E2E tests.
- **Correction:**
  - No local Supabase. Development uses the remote project `notebook-lite` (ref `tmwmklntjantjchkhmrg`), which the CLI is linked to.
  - Migrations are applied with `supabase db push --remote`.
  - RLS tests are pgTAP files run with `supabase test db --remote`. Each file runs in a rolled-back transaction.
  - Auth config and email templates are applied with `supabase config push`.
  - The env vars now follow the new key types: `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` replace `*_ANON_KEY` and `*_SERVICE_ROLE_KEY`.
- **Rationale:** Decision by the project owner: simpler setup with no Docker stack to maintain. Trade-off: development and tests touch the same project as production, so migrations must be reviewed before `db:push`, and tests must never commit data. A separate dev project can be added later if needed.

## 2026-11-12 — One root `.env.example`

- **Scope:** Configuration (`docs/IMPLEMENTATION_PLAN.md` §7, `AGENTS.md`).
- **Original decision:** One `.env.example` per app.
- **Correction:** A single `.env.example` in the repo root lists every key, grouped and commented by app. In local development every app loads the root `.env`. In production, Dokploy sets the variables per app.
- **Rationale:** Requested by the project owner. One place to see every required key, and api and worker share most of them.

## 2026-11-12 — oxlint instead of ESLint

- **Scope:** Tooling (M0, `packages/config`, CI, `AGENTS.md`).
- **Original decision:** ESLint flat config in `packages/config`.
- **Correction:** Lint with **oxlint**, with type-aware rules through `oxlint-tsgolint`, configured in a root `.oxlintrc.json`. Prettier stays the formatter.
- **Rationale:** ESLint and typescript-eslint are not fully compatible with TypeScript 7, the native compiler. oxlint's type-aware mode builds on the TypeScript 7 toolchain and is much faster.

## 2026-11-12 — Podcast TTS via ElevenLabs text-to-dialogue

- **Scope:** Podcast generation, TTS step (`docs/IMPLEMENTATION_PLAN.md` §5.5, M5).
- **Original decision:** Synthesize each script segment separately with ElevenLabs TTS, using request stitching (`previous_text`/`next_text`), then concatenate with ffmpeg. The text-to-dialogue endpoint was only an alternative to evaluate in a spike (Q4).
- **Correction:** Use the **ElevenLabs text-to-dialogue endpoint** for podcast audio, in both dialogue and monologue mode. The script is sent in batches below the per-request character limit, and the batch MP3s are concatenated with ffmpeg. Voice IDs will be provided later.
- **Rationale:** Decision by the project owner. The dialogue endpoint renders turn-taking and prosody between speakers natively, so we don't need to stitch per-segment requests. Per-segment TTS remains the fallback if the spike shows blocking limits.

## 2026-11-12 — Notebook layer between user and sources

- **Scope:** Domain model, data model, UI, all AI operations (`docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md`).
- **Original decision:** Sources form one flat library per user. Chats and podcasts select from that library. Notebooks were out of scope (open question Q5). Chat answers use the language of the question.
- **Correction:** A **notebook** sits between the user and their documents.
  - A notebook has a name, an optional description, and a language.
  - Notebooks can be created, edited, and deleted.
  - Sources, chats, and podcasts belong to exactly one notebook. Chats and podcasts select only from that notebook's sources.
  - The notebook language applies to every operation inside it: chat answers, chat titles, topic suggestions, podcast scripts and TTS, and full-text search configuration.
  - For now each notebook has exactly one user, its owner. No sharing.
- **Rationale:** Product requirement from the project owner. Grouping sources by topic matches the Gemini Notebook model the product is based on. A fixed language per notebook gives consistent output no matter what language a question or source is in. Keeping a single owner per notebook preserves the simple `user_id`-based RLS model and leaves room for sharing later.
