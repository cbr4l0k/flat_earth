# Module 12 — Deployment to Production

> **What you'll see running:** Your Flat Earth app live on the internet — Convex backend in production mode, Clerk handling real user authentication, and TanStack Start served from Vercel with a custom domain.
>
> **Reference:** [docs/fizzy-analysis/07-dev-vs-production.md](../fizzy-analysis/07-dev-vs-production.md)

## Architecture in Production

```
Users → Vercel (TanStack Start frontend)
          ↓ useQuery / useMutation
       Convex Cloud (backend, database, cron jobs)
          ↓ ctx.auth
       Clerk (authentication, JWT verification)
```

Three services, each with its own production configuration:

| Service | Dev | Production |
|---------|-----|------------|
| **Convex** | `npx convex dev` (dev deployment) | `npx convex deploy` (production deployment) |
| **Clerk** | Development instance (test mode) | Production instance (real email delivery) |
| **Frontend** | `npm run dev` (localhost:3000) | Vercel (global CDN) |

## Step 1: Convex Production Deployment

### Separate Dev and Production

Convex maintains completely separate deployments for development and production. They share the same schema and functions, but have different databases and URLs.

```bash
# See your current deployments
npx convex dashboard
```

### Deploy to Production

```bash
npx convex deploy
```

This command:
1. Pushes your schema and functions to the **production** deployment
2. Runs schema validation (will fail if production data doesn't match new schema)
3. Returns your production deployment URL

The production URL looks like: `https://your-project-123.convex.cloud`

### Environment Variables

Set production environment variables separately from dev:

```bash
# Set Clerk issuer URL for production
npx convex env set CLERK_ISSUER_URL https://your-production-clerk.clerk.accounts.dev --prod

# Verify what's set
npx convex env list --prod
```

Any environment variables your actions use (API keys, etc.) must also be set for production:

```bash
npx convex env set RESEND_API_KEY re_abc123... --prod
```

### Schema Migrations

Convex schema changes in production follow these rules:

| Change | Safe? | Notes |
|--------|-------|-------|
| Add new table | Yes | No data to migrate |
| Add optional field | Yes | Existing docs don't need it |
| Add required field | No | Existing docs lack it — deploy will fail |
| Remove field | Yes | Convex ignores extra fields |
| Add index | Yes | Built asynchronously |
| Remove index | Yes | Queries using it will fall back |
| Change field type | No | Existing data won't match |

For breaking changes, use a migration strategy:
1. Add the new field as optional
2. Deploy and run a migration mutation to backfill
3. Change the field to required
4. Deploy again

## Step 2: Clerk Production Instance

### Create a Production Instance

1. Go to [clerk.com/dashboard](https://dashboard.clerk.com)
2. In your application settings, switch to **Production** mode
3. Clerk will guide you through:
   - Verifying a domain
   - Configuring email delivery (real emails, not test mode)
   - Setting up OAuth providers if needed

### Key Differences from Development

| Setting | Dev | Production |
|---------|-----|------------|
| Email delivery | Test mode (codes shown in UI) | Real SMTP (emails sent) |
| Domain | `verb-noun-00.clerk.accounts.dev` | Your verified domain |
| API keys | Development keys (prefix `pk_test_`) | Production keys (prefix `pk_live_`) |
| Sessions | Relaxed security | Strict HTTPS, secure cookies |

### Update Environment Variables

You'll need separate Clerk keys for production:

```bash
# In your Vercel project settings (Step 3)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

# In Convex production env
npx convex env set CLERK_ISSUER_URL https://your-production-domain.clerk.accounts.dev --prod
```

## Step 3: Deploy Frontend to Vercel

### Option A: Git Integration (Recommended)

1. Push your code to GitHub/GitLab/Bitbucket
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Vercel auto-detects TanStack Start and configures the build

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts. Vercel will:
- Detect the framework (Vite / TanStack Start)
- Run `npm run build`
- Deploy the output

### Environment Variables in Vercel

In the Vercel dashboard → your project → Settings → Environment Variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_CONVEX_URL` | `https://your-project-123.convex.cloud` | Production Convex URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | Production Clerk key |

These must be prefixed with `VITE_` to be available in the client bundle.

### Build Configuration

Your `package.json` should have:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Vercel runs `npm run build` automatically on each push to main.

### Custom Domain

1. Vercel dashboard → your project → Settings → Domains
2. Add your domain (e.g., `flatearth.app`)
3. Configure DNS records as instructed (CNAME or A record)
4. SSL certificate is provisioned automatically

## Step 4: Production Smoke Test

After deploying all three services, verify everything works end-to-end:

### Checklist

```
[ ] Visit your production URL — landing page loads
[ ] Sign in with Clerk — redirected to sign-in, OTP email arrives
[ ] After auth — account picker / board list loads
[ ] Create a board — board appears in real time
[ ] Create a card — card shows up in triage
[ ] Move card between columns — move persists after refresh
[ ] Open in two browser tabs — changes sync in real time
[ ] Sign out — redirected to landing page
[ ] Visit a public board URL — board renders without auth
[ ] Check Convex dashboard — no function errors in logs
```

### Common Production Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Convex client not connected" | Wrong `VITE_CONVEX_URL` | Check Vercel env vars, use production URL |
| Auth fails silently | Clerk keys mismatch | Ensure production keys everywhere |
| Queries return empty | Different database | `npx convex deploy` pushes schema, not data |
| Cron jobs not running | Not deployed | Verify crons.ts is included in deploy |
| "Unauthorized" errors | `CLERK_ISSUER_URL` wrong in Convex | `npx convex env set --prod` with correct URL |

## Monitoring

### Convex Dashboard

The Convex dashboard ([dashboard.convex.dev](https://dashboard.convex.dev)) provides:

- **Logs:** Every function execution with arguments, results, and errors
- **Function metrics:** Execution time, call frequency, error rate
- **Cron jobs:** Status of all scheduled recurring jobs
- **Data browser:** View and edit production data directly
- **Deployment history:** Roll back to previous deployments

### Key Metrics to Watch

- **Function error rate** — should be near 0% for queries, low for mutations
- **Function duration** — queries should be <100ms for good real-time UX
- **Cron job status** — entropy and notification crons should run on schedule
- **Database size** — watch for runaway growth from cleanup jobs failing

### Debugging Production Issues

```bash
# View recent logs
npx convex logs --prod

# View function metrics
npx convex dashboard
```

## Security Review Checklist

Before going live, verify:

```
[ ] All mutations check accountId ownership (no cross-tenant access)
[ ] requireAccountAccess is called in every query and mutation
[ ] Admin-only operations check isAdmin/isOwner
[ ] Public board queries don't leak private data
[ ] No sensitive data in client-visible error messages
[ ] Clerk webhook secret is set (if using webhooks)
[ ] Environment variables don't contain dev keys
[ ] CORS is handled (Convex manages this automatically)
```

## Fizzy vs Flat Earth Deployment

| Aspect | Fizzy (Rails) | Flat Earth (Convex + Vercel) |
|--------|---------------|------------------------------|
| Server | Docker + Kamal on VPS | Convex Cloud (serverless) |
| Database | MySQL + SQLite | Convex (managed) |
| Background jobs | Solid Queue + Redis | Convex crons + scheduler |
| WebSockets | Action Cable + Solid Cable | Convex (built-in) |
| Frontend | Turbo/Stimulus (server-rendered) | Vercel CDN (client-side React) |
| SSL | Thruster reverse proxy | Vercel (automatic) |
| Deploys | `bin/kamal deploy` | `git push` + `npx convex deploy` |
| Monitoring | Custom + Mission Control | Convex dashboard |
| Cost model | Fixed (VPS monthly) | Usage-based (pay per function call) |

## Exercise

1. Run `npx convex deploy` to push your backend to production
2. Set production environment variables: `CLERK_ISSUER_URL`
3. Create a Clerk production instance and get production API keys
4. Deploy the frontend to Vercel (via Git integration or CLI)
5. Set `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY` in Vercel
6. Run through the smoke test checklist
7. Add a custom domain (optional)
8. Check the Convex dashboard for function logs and cron job status

**Result:** Your app is live on the internet with a production backend, real authentication, and a CDN-served frontend.

---

Next: [Module 13 — What's Next](./13-whats-next.md)
