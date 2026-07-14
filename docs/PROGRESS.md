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

### Frontend

`frontend/` — React + Vite + Clerk + TanStack Query (see `docs/DEV.md` → Frontend section for setup/state-management notes). All 4 pages wired to the real API:
- Clerk auth (in-app `/sign-in` + `/sign-up`, not the hosted Account Portal), dark/light theme toggle, teal/coral color palette, sidebar + routing shell
- Accounts — list/connect/disconnect
- Posts — schedule with media upload, list with status badges, edit/reschedule inline, cancel
- Automations — create/list/edit/delete rules, activate/deactivate toggle, action dropdown constrained to valid trigger/action combos
- Dashboard — queue status cards (auto-refresh), per-rule analytics table, paginated/filterable execution log

### Backend fixes found while building the frontend
- **`prisma/migrations/` never existed** — schema was defined but never migrated; every `migrate deploy` had nothing to apply, so tables never got created anywhere this was tried locally. Generated the initial migration (`20260714010747_init`) — see `fix/auth-instagram-json-and-init-migration` (merge into `develop` if not already).
- `GET /auth/instagram` changed from a server-side redirect to returning `{ url }` as JSON — a bearer-token SPA `fetch()` can't follow/read a redirect's `Location` header, so the frontend needs the URL to navigate to it itself.
- `docs.html`'s `/media/upload-url` example had the wrong response field name (`publicUrl` instead of the real `mediaUrl` from `mediaService.js`) — fixed.

**Known local-dev gap:** Clerk's `user.created` webhook can't reach `localhost` without a tunnel, so `User` rows don't auto-create on sign-up locally yet — see `docs/DEV.md` for the manual-insert workaround. Setting up ngrok properly is still open.

---

## Up Next

- Set up ngrok for local Clerk webhook delivery
- YouTube / TikTok support (deferred — Instagram-only for now)
- Meta App Review + Business Verification (deferred — dev/tester mode for now, see conversation notes on going live as a solo dev without a registered company)
