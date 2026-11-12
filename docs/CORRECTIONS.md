# Corrections

Log of corrections to proposals or decisions. Newest entries first.

Format: **Scope** (what part of the system / which document) · **Original decision** · **Correction** · **Rationale**.

---

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
