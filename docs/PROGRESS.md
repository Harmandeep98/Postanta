# Build Progress

## Done

### Phase 1 — Project Scaffold
Fastify + pino, Prisma + PostgreSQL, Redis/BullMQ, Clerk auth plugin, health route, `.env.example`.

### Phase 2 — Instagram Auth
Meta OAuth flow, token storage in `SocialAccount`, token refresh worker (BullMQ cron), `GET /accounts`.

### Phase 3 — Scheduled Posts
`ScheduledPost` schema, `POST /posts` schedule endpoint, BullMQ delayed jobs, `postWorker` publishes via Meta Graph API. Supports single photo, single reel (video), and carousels (2-10 mixed image/video items) — `ScheduledPost.mediaUrls` is an array; carousel children are created and (for videos) polled in parallel before the parent carousel container is published.

### Phase 4 — Rule Engine
`AutomationRule` schema, `POST /webhooks/meta` (HMAC-SHA256 verified, fire-and-forget), `ruleEngineService` (keyword match + cooldown + once-per-user), `automationWorker` (concurrency: 10), automations CRUD endpoints.

### Phase 5 — Dashboard API
`GET /dashboard/analytics/rules` (per-rule trigger outcome breakdown), `GET /dashboard/queues` (live BullMQ job counts via `queueStatusService`), `GET /dashboard/rule-logs` (paginated, filterable `RuleExecutionLog` viewer, never exposes `triggerPayload`). `/health` also wired to real queue counts via the same service. `GET /dashboard/analytics/posts` added later — post status counts + live Instagram engagement metrics (impressions/reach/likes/comments/saved) via `metaService.getMediaMetrics`.

### Frontend

`frontend/` — React + Vite + Clerk + TanStack Query (see `docs/DEV.md` → Frontend section for setup/state-management notes). All 4 pages wired to the real API:
- Clerk auth (in-app `/sign-in` + `/sign-up`, not the hosted Account Portal), dark/light theme toggle
- Slate/Navy + Blue color palette (enterprise SaaS style — replaced an earlier teal/coral pass that wasn't landing well), Fira Sans/Fira Code typography, lucide-react icons throughout (sidebar, buttons, status badges) — no emoji/text-only icons
- Accounts — list/connect/disconnect
- Posts — schedule with media upload, list with status badges, edit/reschedule inline, cancel
- Automations — create/list/edit/delete rules, activate/deactivate toggle, action dropdown constrained to valid trigger/action combos
- Dashboard — redesigned around user-meaningful stats: post status + engagement KPI cards, automation KPI cards (messages sent, active rules), a plain-English recent activity feed, detailed rule analytics table + paginated execution log below that, and raw BullMQ queue internals demoted to a collapsed "System status" debug section (previously the primary/only view — not meaningful to end users)

### Backend fixes found while building the frontend
- **`prisma/migrations/` never existed** — schema was defined but never migrated; every `migrate deploy` had nothing to apply, so tables never got created anywhere this was tried locally. Generated the initial migration (`20260714010747_init`).
- `GET /auth/instagram` changed from a server-side redirect to returning `{ url }` as JSON — a bearer-token SPA `fetch()` can't follow/read a redirect's `Location` header, so the frontend needs the URL to navigate to it itself.
- `docs.html`'s `/media/upload-url` example had the wrong response field name (`publicUrl` instead of the real `mediaUrl` from `mediaService.js`) — fixed.
- **`postWorker` computed the published Instagram media ID but never persisted it** — no way to fetch insights for a published post at all. Added `ScheduledPost.instagramMediaId` + migration, now saved on publish.

**Known local-dev gap:** Clerk's `user.created` webhook can't reach `localhost` without a tunnel, so `User` rows don't auto-create on sign-up locally yet — see `docs/DEV.md` for the manual-insert workaround. Setting up ngrok properly is still open.

---

## Up Next

- Set up ngrok for local Clerk webhook delivery
- YouTube / TikTok support (deferred — Instagram-only for now)
- Meta App Review + Business Verification (deferred — dev/tester mode for now, see conversation notes on going live as a solo dev without a registered company)
