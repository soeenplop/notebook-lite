# Briefing

## Goal

A slimmed-down Gemini Notebook clone: users upload sources and chat with an AI that answers exclusively based on the selected sources. Every statement is backed by a citation. In addition, podcast-style audio content can be generated.

**Sources:** PDF, DOCX, MD, and web pages via URL. Strict separation of user data; sources are selectable per chat.

**Podcast:** Monologue or dialogue (two speakers), approx. 2, 6, or 15 minutes. Select sources, then either specify a topic or choose from three LLM-generated suggestions. The LLM writes a script, and ElevenLabs generates the MP3.

## Tech Stack

- **Monorepo:** npm workspaces
- **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** NestJS, TypeScript, tRPC, SSE
- **LLM:** OpenAI `gpt-6.1-terra` via Vercel AI SDK
- **Embeddings:** `text-embedding-3-large`
- **Database:** Supabase Postgres + pgvector, RLS wherever possible
- **Storage:** Supabase Storage
- **Auth:** Supabase Auth, email OTP
- **Worker:** Separate NestJS worker for longer-running tasks (e.g. podcast generation), queue-based, at most one concurrent job
- **Deployment:** New Dokploy project at `dokploy.soeenplop.dev`, deployed on push to `main`. The Dokploy CLI is available.

## Working Approach

- Document all corrections to proposals or decisions in `docs/CORRECTIONS.md`: scope, original decision, correction, and rationale.
- Keep commits as small as possible, but self-contained and coherent both functionally and technically.
- Lint, build, and relevant tests must pass before every commit.
