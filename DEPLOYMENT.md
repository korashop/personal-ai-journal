# Deployment

## Recommended path

For now, the simplest deployment path is a single Railway service using the included Dockerfile:

- backend: Express API
- frontend: built Vite assets served by the same Express server
- database/storage: Supabase

That means one public URL can handle both the app UI and the API.

## What is already prepared

- The server now serves the built frontend from `dist/` in production.
- Railway is configured to deploy from the included [`Dockerfile`](/Users/arifine/Documents/New%20project/Dockerfile), which pins a Vite-compatible Node version directly.
- A Railway config exists in [`railway.json`](/Users/arifine/Documents/New%20project/railway.json).

## Railway steps

1. Push this project to GitHub.
2. Create a new Railway project from that GitHub repo.
3. In Railway, add these environment variables:
   - `PORT=3000`
   - `SUPABASE_URL=...`
   - `SUPABASE_ANON_KEY=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...`
   - `SUPABASE_STORAGE_BUCKET=journal-photos`
   - `ANTHROPIC_API_KEY=...`
   - `ANTHROPIC_MODEL=claude-sonnet-4-5`
   - `DEMO_USER_ID=demo-user`
   - Do not set `VITE_API_BASE_URL` unless you are deliberately hosting the API on a different domain. The app now defaults to same-origin API calls in production.
4. Deploy.
5. Open the Railway URL on desktop and phone.

## Notes

- If you deploy this way, you do not need a separate frontend host right now.
- Once deployed, photo capture from phone browser becomes much more natural.
- If you later want stronger auth/multi-user support, we can revisit hosting shape.
- Railway can use `GET /api/health` as a basic health check.
- If Railway was previously using an older failed Nixpacks build, redeploy after pushing the Dockerfile changes so it rebuilds with the new strategy.
