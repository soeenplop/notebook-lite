# Corrections

Log of corrections to proposals or decisions. Newest entries first.

Format: **Scope** (what part of the system / which document) · **Original decision** · **Correction** · **Rationale**.

---

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
