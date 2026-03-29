# Personal AI Journal

A Phase 1+ build of the personal AI journal spec: React + Vite frontend, Express API layer, Supabase-ready schema, and an Anthropic-powered memory loop with a built-in demo mode.

## What is included

- Entry capture for typed, pasted, and photo-backed entries
- Flexible entry analysis with variable sections and deeper exploration options
- Persistent conversation thread per entry
- Rolling memory document, durable pattern continuity, and synthesized patterns view
- Resurfacing card on app open
- Supabase SQL schema and storage integration hooks
- Demo mode when real Supabase or Anthropic credentials are not configured
- Entry edit, delete, and re-analyze actions

## Run locally

1. Copy `.env.example` to `.env`
2. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY` for live mode
3. Start the app:

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:8787`

## Database setup

Apply the migrations in:

- [`supabase/migrations/20260328140000_personal_ai_journal.sql`](/Users/arifine/Documents/New%20project/supabase/migrations/20260328140000_personal_ai_journal.sql)
- [`supabase/migrations/20260328183000_pattern_threads.sql`](/Users/arifine/Documents/New%20project/supabase/migrations/20260328183000_pattern_threads.sql)

Create a private storage bucket named `journal-photos` or change `SUPABASE_STORAGE_BUCKET`.

## Notes

- The current build assumes a single-user/demo default via `DEMO_USER_ID`.
- Photo upload is wired, and in live mode the file is pushed to Supabase Storage. The app now supports OCR review before submission, but transcription quality still benefits from manual cleanup and clear source images.
- Memory and token-management strategy notes live in [`MEMORY_STRATEGY.md`](/Users/arifine/Documents/New%20project/MEMORY_STRATEGY.md).
- If the `pattern_threads` table has not been migrated yet, the app will still work, but pattern continuity will fall back to in-memory / generated behavior instead of durable storage.
- Deployment notes live in [`DEPLOYMENT.md`](/Users/arifine/Documents/New%20project/DEPLOYMENT.md).
- In production on a single host, leave `VITE_API_BASE_URL` unset so the frontend talks to the same-origin API automatically.
