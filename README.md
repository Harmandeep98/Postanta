# Postanta

A full-stack social media manager for Instagram (YouTube/TikTok planned). Its core feature is a
ManyChat-style rule engine that triggers automated DMs and replies based on keyword matching in
comments or incoming DMs. It also handles scheduled posts and gives you a real dashboard —
engagement metrics, automation performance, queue health — pulled from Meta's Graph API.

## Features

- **Instagram OAuth connect** — link one or more Instagram Business accounts via Meta's Graph API
- **Scheduled posts** — schedule image/video posts with captions, published automatically via a background worker
- **Automation rule engine**
  | Trigger | Action | Effect |
  |---|---|---|
  | Comment contains keyword | Send DM | DM the commenter privately |
  | Comment contains keyword | Reply to comment | Reply publicly under the comment |
  | DM contains keyword | Reply in DM | Reply in the same DM thread |

  Rules support `CONTAINS` / `EXACT` / `STARTS_WITH` matching, per-post or account-wide scope,
  once-per-user dedup, and configurable cooldowns.
- **Dashboard** — post engagement (impressions, reach, likes, comments), automation KPIs, a
  human-readable activity feed, per-rule analytics, and a filterable execution log
- **Auth** — Clerk-backed, both API and frontend

## Tech Stack

| Layer | Choice |
|---|---|
| API server | Node.js + Fastify |
| Background jobs | BullMQ + Redis |
| Database | PostgreSQL + Prisma |
| Auth | Clerk |
| External API | Meta Graph API (Instagram) |
| Frontend | React + Vite, TanStack Query, React Router |
| Deployment | Docker, Coolify (Hetzner VPS) |

The API server and BullMQ workers run in the same Node process (`src/server.js`) — there's no
separate worker deployment to manage.

## Project Structure

```
src/
  server.js          Fastify entry point — registers plugins, mounts routes, starts workers
  modules/            One folder per domain: routes + tests (accounts, posts, automations, dashboard, webhooks, auth)
  workers/            BullMQ workers (postWorker, automationWorker, tokenRefreshWorker)
  queues/             BullMQ queue definitions
  services/           Business logic (metaService, ruleEngineService, scheduleService, ...)
  plugins/             Fastify plugins (Prisma, Redis, Clerk)
prisma/               schema.prisma + migrations
frontend/             React + Vite SPA
scripts/              Local dev tooling (see below)
docs/                 DEV.md (setup + API reference), PROGRESS.md (build log)
```

## Getting Started

See **[docs/DEV.md](docs/DEV.md)** for full local setup: prerequisites, environment variables,
running the server, and the complete API reference.

Quick version:

```bash
docker compose up
```

This starts Postgres, Redis, and the app (migrations run automatically on boot). The API is at
`http://localhost:3000`, the frontend dev server separately via `cd frontend && npm run dev`.

### Testing the automation rule engine without a real Meta account

Meta App Review takes time to get approved. In the meantime, `scripts/seed-fake-account.js` and
`scripts/simulate-webhook.js` let you exercise the entire rule engine pipeline — signature
verification, keyword matching, cooldowns, job execution, logging — end-to-end with a fake
account and a properly signed fake webhook event. Details in `docs/DEV.md`.

## Git Workflow

- **`main`** and **`staging`** are protected — never commit directly to either.
- Branch off `develop` for every change:
  ```
  feature/<short-description>    new functionality
  fix/<short-description>        bug fixes
  chore/<short-description>      tooling, deps, config
  ```
- One PR per feature/fix, scope kept tight.
- Promotion path: `feature/* → develop → staging → main`. `main` requires a passing CI run
  before merge and is squash-merged to keep history clean.

## Environments

| Environment | Branch | Notes |
|---|---|---|
| Local | any | `.env.local`, Docker Compose for Postgres/Redis |
| Staging | `staging` | Separate Meta app (own `META_APP_ID`), own Coolify Postgres/Redis |
| Production | `main` | Live traffic |

Each environment is a distinct Coolify service with its own database and Redis instance. Pushing
to `staging` or `main` triggers Coolify to auto-build and redeploy; `prisma migrate deploy` runs
as a release step before the app starts.

## Documentation

- **[docs/DEV.md](docs/DEV.md)** — local setup, environment variables, full API reference
- **[docs/PROGRESS.md](docs/PROGRESS.md)** — build log, what's done, what's next
- **`/docs`** (running server) — interactive API reference served by the app itself
