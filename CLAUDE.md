# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack social media manager for Instagram (YouTube/TikTok planned). Core feature is a ManyChat-style rule engine that triggers automated DMs and replies based on keyword matching in comments or incoming DMs. Also handles scheduled posts.

**Stack:** Node.js + Fastify, JavaScript, Prisma, BullMQ, Redis, Clerk (auth), Meta Graph API

**Meta permissions required:** `instagram_manage_comments`, `pages_messaging`, `instagram_manage_messages`

## Git Workflow

**Never commit directly to `main` or `staging`.** All changes go through PRs.

### Branch naming
```
feature/<short-description>    # new functionality
fix/<short-description>        # bug fixes
chore/<short-description>      # tooling, deps, config
```

### PR rules
- One PR per feature/fix — keep scope tight
- PRs merge into `develop` first, then `develop` → `staging` → `main`
- `main` is protected: requires PR + passing CI before merge
- Squash merge into `main` to keep history clean

## Environments

| Environment | Branch    | Coolify Service  | Purpose                        |
|-------------|-----------|------------------|--------------------------------|
| local       | any       | —                | Local dev with `.env`          |
| staging     | `staging` | Coolify staging  | Pre-production QA              |
| production  | `main`    | Coolify prod     | Live traffic                   |

- Each Coolify service has its own PostgreSQL and Redis instances
- Staging uses a separate Meta app (different `META_APP_ID`) to avoid touching production data
- `.env.example` is committed; actual `.env` files are never committed

## Deployment

- **Host:** Hetzner VPS managed by [Coolify](https://coolify.io)
- **PostgreSQL & Redis:** Coolify-managed services (not self-managed containers)
- **App:** Single Docker service — Fastify server and BullMQ workers start in the same process
- **CI/CD:** Push to `staging` or `main` → Coolify auto-builds and redeploys
- `prisma migrate deploy` runs as a Coolify release command before the app starts

## Commands

```bash
# Development
npm run dev          # Start Fastify server + BullMQ workers (same process)

# Database
npx prisma migrate dev       # Apply migrations in development
npx prisma migrate deploy    # Apply migrations in production/staging
npx prisma generate          # Regenerate Prisma client after schema changes
npx prisma studio            # Open Prisma Studio GUI

# Code quality
npm run lint         # ESLint
npm test             # Run tests

# Redis (local dev)
redis-server         # Start Redis (required for BullMQ)
```

## Architecture

### Server (`src/server.js`)
Fastify entry point. Registers plugins (Clerk auth, CORS, pino logger), mounts route modules, starts HTTP server, and initialises BullMQ workers in the same process.

### Routes (`src/routes/`)
Fastify route plugins, one file per domain:
- `posts.js` — CRUD + schedule post endpoints
- `automations.js` — CRUD for AutomationRule (rule engine config)
- `webhooks.js` — Meta webhook receiver (signature verification required, no Clerk auth)

### Workers (`src/workers/`)
BullMQ worker files, instantiated at startup inside `src/server.js`:
- `postWorker.js` — publishes scheduled posts via Meta Graph API
- `automationWorker.js` — executes automation rules (send DM, reply to comment, reply in DM thread)

### Queues (`src/queues/`)
BullMQ queue definitions and job producers. Queue names match their worker.

### Services (`src/services/`)
Business logic, called by routes and workers:
- `metaService.js` — all Meta Graph API calls (posts, send DM, reply to comment, reply in DM thread, token refresh)
- `scheduleService.js` — creates/cancels BullMQ delayed jobs for scheduled posts
- `ruleEngineService.js` — loads active rules for a `socialAccountId`, evaluates keyword match + matchType, checks once-per-user and cooldown, enqueues jobs

### Prisma (`prisma/`)
`schema.prisma` is the source of truth for data models. Run `prisma generate` after any schema change.

## Async, Parallelism & Concurrency

Run independent async operations in parallel — never await them sequentially.

```js
// good — fire both DB queries at once
const [rules, account] = await Promise.all([
  prisma.automationRule.findMany({ where: { socialAccountId } }),
  prisma.socialAccount.findUnique({ where: { id: socialAccountId } }),
]);

// bad — sequential for no reason
const rules = await prisma.automationRule.findMany(...);
const account = await prisma.socialAccount.findUnique(...);
```

Key parallelism points:
- **Rule evaluation:** evaluate multiple matched rules concurrently with `Promise.all` — each rule's checks (RuleExecution lookup, cooldown query) are independent
- **Webhook fan-out:** if one webhook event matches N rules, enqueue all N jobs in a single `Promise.all` — don't loop with `await`
- **BullMQ workers:** set `concurrency` on each worker (e.g. `new Worker('automation.queue', processor, { concurrency: 10 })`) so one slow Meta API call doesn't block others
- **Meta API calls:** when an operation requires multiple independent Graph API requests (e.g. fetch user info + fetch post details), run them with `Promise.all`
- Use `Promise.allSettled` instead of `Promise.all` when partial failure is acceptable and you need all results

## Observability & Logging

**Logger:** Fastify's built-in [pino](https://getpino.io) — already included, zero config needed. Use `req.log` inside route handlers and pass the logger into services/workers.

### Log levels
| Level   | When to use |
|---------|-------------|
| `error` | Unhandled exceptions, Meta API errors, worker job failures |
| `warn`  | Skipped rule executions (cooldown, once-per-user), retryable errors |
| `info`  | Job enqueued, job completed, webhook received, server started |
| `debug` | Rule evaluation steps, keyword match results (dev only) |

### What to log
- **Webhook received** — `info`: event type, `socialAccountId`, raw payload size
- **Rule evaluation** — `debug`: which rules matched, which were skipped and why
- **Job enqueued** — `info`: `ruleId`, `actionType`, `instagramUserId`, BullMQ job ID
- **Job completed** — `info`: job ID, duration, Meta API response status
- **Job failed** — `error`: job ID, error message, stack, retry count
- **Meta API call** — `debug`: method, endpoint, response status (never log tokens or message content)

### Structured log shape
Always log as a plain object so fields are queryable in log aggregators:
```js
log.info({ ruleId, instagramUserId, actionType, jobId }, 'automation job enqueued');
log.error({ jobId, ruleId, err: error.message, attempt }, 'automation job failed');
```

### Health check
`GET /health` returns `{ status: 'ok', uptime, queues: { pending, active, failed } }` — used by Coolify for liveness probes.

## Rule Engine

Three automation types:

| Trigger | Action | Description |
|---|---|---|
| `COMMENT_KEYWORD` | `SEND_DM` | Comment with keyword → send private DM to commenter |
| `COMMENT_KEYWORD` | `REPLY_COMMENT` | Comment with keyword → reply publicly under the comment |
| `DM_KEYWORD` | `REPLY_DM` | Incoming DM matches keyword → reply in the same thread |

**Rule fields:**
- `triggerType`: `COMMENT_KEYWORD` | `DM_KEYWORD`
- `triggerKeyword`: word/phrase to match
- `matchType`: `CONTAINS` | `EXACT` | `STARTS_WITH`
- `postId`: `null` = apply to all posts; set = specific post only
- `actionType`: `SEND_DM` | `REPLY_COMMENT` | `REPLY_DM`
- `messageTemplate`: response text, supports `{{first_name}}`
- `replyOncePerUser`: boolean, default `true` — enforced via unique constraint on `RuleExecution[ruleId, instagramUserId]`
- `cooldownMinutes`: default `60` — skip if same user triggered same rule within window

**Evaluation order in `ruleEngineService.js`:**
1. Load all active `AutomationRule` rows matching `socialAccountId` (and `postId` if comment event)
2. For each rule: test keyword against `matchType`
3. Run steps 3–4 concurrently per rule via `Promise.all`:
   - If `replyOncePerUser`: check `RuleExecution` — skip if row exists
   - Check cooldown: query latest `RuleExecutionLog` for `[ruleId, instagramUserId]` — skip if within window
4. Enqueue all passing rules in a single `Promise.all` to `automation.queue`
5. Worker executes and writes `RuleExecution` (upsert) + `RuleExecutionLog`

### Webhooks
Meta sends events (comments, DMs, mentions) to `POST /webhooks/meta`. This route must:
1. Verify the `X-Hub-Signature-256` header before any processing
2. Identify event type (comment or DM), extract `instagramUserId`, text, and `socialAccountId`
3. Call `ruleEngineService.evaluate()` which enqueues matched jobs
4. Return `200` immediately — never do slow work inline

### Auth
Clerk handles authentication. Every API route (except `/webhooks/*` and `/health`) must validate the Clerk session token via the Fastify Clerk plugin.

## Build Phases

- **Phase 1** — Project scaffold: Fastify + pino, Prisma setup, Redis/BullMQ connection, Clerk plugin, health route, `.env.example`
- **Phase 2** — Instagram auth: Meta OAuth flow, token storage, token refresh logic
- **Phase 3** — Scheduled posts: ScheduledPost schema, schedule endpoint, BullMQ delayed jobs, postWorker
- **Phase 4** — Rule engine: AutomationRule schema, webhook receiver, ruleEngineService (parallel evaluation), automationWorker (concurrency: 10)
- **Phase 5** — Dashboard API: analytics endpoints, queue status, rule execution logs

## Key Conventions

- **Never commit directly to `main` or `staging`** — always use a feature branch and open a PR.
- Workers and the API server run in the **same process** — `src/server.js` starts both the Fastify server and BullMQ workers on boot.
- All Meta Graph API calls go through `metaService.js` — no direct `fetch` to `graph.facebook.com` elsewhere.
- Job payloads must be serializable plain objects (no class instances).
- Webhook endpoint skips Clerk auth but must enforce Meta signature verification before any logic runs.
- `RuleExecution` enforces once-per-user at the database level via unique constraint — the service layer check is a fast-path optimization only.
- `RuleExecutionLog` is append-only — never update or delete rows.
- Never log access tokens, message content, or personal user data.
- Environment variables are validated at startup — fail fast if required vars are missing.

## Environment Variables

```
DATABASE_URL          # PostgreSQL connection string for Prisma
REDIS_URL             # Redis connection string for BullMQ
CLERK_SECRET_KEY      # Clerk backend secret
CLERK_PUBLISHABLE_KEY # Clerk frontend key
META_APP_ID           # Meta app ID
META_APP_SECRET       # Meta app secret
META_WEBHOOK_SECRET   # Meta webhook verify token / signature secret
NODE_ENV              # development | staging | production
PORT                  # Fastify listen port (default 3000)
LOG_LEVEL             # pino log level: debug | info | warn | error (default: info)
```
