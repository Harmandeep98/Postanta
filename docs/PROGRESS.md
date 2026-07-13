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

### Phase 5 — Dashboard API
`GET /dashboard/analytics/rules` (per-rule trigger outcome breakdown), `GET /dashboard/queues` (live BullMQ job counts via `queueStatusService`), `GET /dashboard/rule-logs` (paginated, filterable `RuleExecutionLog` viewer, never exposes `triggerPayload`). `/health` also wired to real queue counts via the same service.

---

## Up Next

- YouTube / TikTok support (deferred — Instagram-only for now).
