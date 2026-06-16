# Deploying Networky (Vercel)

Networky is a Next.js + Prisma app hosted on **Vercel** with a hosted Postgres
(`DATABASE_URL` pooled, `DIRECT_URL` direct).

## One-time setup

1. **Create a Vercel access token** — Vercel dashboard → Settings → Tokens.
2. **Make it available to the shell** (do not commit it):

   ```powershell
   # PowerShell (current session)
   $env:VERCEL_TOKEN = "<your-token>"
   ```

   ```bash
   # bash
   export VERCEL_TOKEN="<your-token>"
   ```

3. **Link the local repo to the Vercel project** (one time, interactive — opens a browser):

   ```bash
   npx vercel link
   ```

   This writes `.vercel/project.json` locally (already git-ignored).

4. **Set the production environment variables in Vercel** (Project → Settings →
   Environment Variables), matching `.env.example`:
   `DATABASE_URL`, `DIRECT_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

## Deploy

The Vercel CLI reads `VERCEL_TOKEN` from the environment automatically.

```bash
npm run deploy           # build + deploy to PRODUCTION
npm run deploy:preview   # build + deploy a preview URL
```

## Database migrations

The Vercel build runs `prisma generate && next build` — it does **not** apply
migrations. After changing the schema, apply migrations against the production
database before/with the deploy:

```bash
# DATABASE_URL / DIRECT_URL must point at the production DB
npm run db:migrate:deploy
```

## Recommended flow (matches the team branch rules)

`feat/* → develop → main`. If the Vercel project is connected via the GitHub
integration, merging to `main` auto-deploys to production and every PR gets a
preview URL — in that case the `npm run deploy` commands above are only needed
for manual/out-of-band deploys.
