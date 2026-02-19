# Deployment

This project can be deployed as a containerized TanStack Start app. The frontend requires a Convex endpoint at build time through `VITE_CONVEX_URL`.

## Files

- `Dockerfile`: multi-stage production image build
- `docker-compose.yml`: local/prod-style container orchestration with env-driven build args

## Environment Variables

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `VITE_CONVEX_URL` | Yes | Docker build (`npm run build`) | Convex HTTP endpoint compiled into the client bundle |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Docker build (`npm run build`) | Clerk frontend key for client auth |
| `VITE_CONVEX_SITE_URL` | No | Docker build (`npm run build`) | Optional Convex site/dashboard URL |
| `CLERK_SECRET_KEY` | Yes | Container runtime (`npm run start`) | Clerk server key for middleware/session validation |
| `APP_PORT` | No | Docker Compose | Host port mapped to container `3000` (default: `3000`) |

## Convex Endpoint Modes

### Mode 1: Convex Cloud

Set `VITE_CONVEX_URL` to your hosted Convex deployment URL.

```env
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
APP_PORT=3000
```

### Mode 2: Self-Hosted Convex

Set `VITE_CONVEX_URL` to your self-hosted Convex API origin.

```env
VITE_CONVEX_URL=https://convex.example.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
APP_PORT=3000
```

## Deploy with Docker Compose

1. Create a deployment env file (example: `.env.deploy`) with one of the mode configurations above.
2. Build and start:

```bash
docker compose --env-file .env.deploy up -d --build
```

3. Open `http://localhost:${APP_PORT:-3000}`.

## Important Build-Time Note

`VITE_CONVEX_URL` is bundled into client code during build. If you change Convex mode or endpoint, rebuild the image (`docker compose ... --build`).
