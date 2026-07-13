# Build Progress

## Done

### Phase 1 — Project Scaffold
Fastify + pino, Prisma + PostgreSQL, Redis/BullMQ, Clerk auth plugin, health route, `.env.example`.

### Phase 2 — Instagram Auth
Meta OAuth flow, token storage in `SocialAccount`, token refresh worker (BullMQ cron), `GET /accounts`.

### Phase 3 — Scheduled Posts
`ScheduledPost` schema, `POST /posts` schedule endpoint, BullMQ delayed jobs, `postWorker` publishes via Meta Graph API.

### Phase 4 — Rule Engine
`AutomationRule` schema, `POST /webhooks/meta` (HMAC-SHA256 verified, fire-and-forget), `ruleEngineService` (keyword match + cooldown + once-per-user), `automationWorker` (concurrency: 10), automations CRUD endpoints.

---

## Up Next

### Phase 5 — Dashboard API
Analytics endpoints, queue status, rule execution logs.
