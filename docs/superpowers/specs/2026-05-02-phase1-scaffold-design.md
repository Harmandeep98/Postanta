# Phase 1 Scaffold — Design Spec

**Date:** 2026-05-02
**Scope:** Project bootstrap only — no business logic, no Instagram API, no automation rules.

---

## Stack Decisions

| Concern | Choice | Reason |
|---|---|---|
| Module system | ESM (`"type": "module"`) | Modern Node.js, no transform config |
| Package manager | pnpm | Fast installs, strict dep resolution |
| Testing | Vitest | ESM-native, zero config with ESM |
| Validation | Fastify JSON Schema (Ajv) | Zero deps, doubles as OpenAPI schema |
| Architecture | Modular monolith, Approach A | Explicit folder boundaries, easy to navigate |
| Dev reload | `node --watch` | Built-in, no nodemon |

---

## Project Structure

```
social-medial-manager/
├── src/
│   ├── config.js
│   ├── server.js
│   ├── plugins/
│   │   ├── prisma.js
│   │   ├── redis.js
│   │   └── clerk.js
│   └── modules/
│       └── health/
│           └── routes.js
├── prisma/
│   └── schema.prisma
├── docs/
│   └── superpowers/specs/
├── .env.example
├── .eslintrc.js
├── vitest.config.js
├── Dockerfile
├── .dockerignore
└── package.json
```

---

## `src/config.js`

- Reads `process.env` at import time
- Throws with a descriptive error on any missing required var
- Exports a single frozen object — no other file reads `process.env` directly

Required vars: `DATABASE_URL`, `REDIS_URL`, `CLERK_SECRET_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_SECRET`

Optional with defaults: `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=info`

---

## `src/server.js`

Exports two named exports:

**`build(opts = {})`**
- Creates Fastify instance with pino logger (`LOG_LEVEL`, pretty-print in development)
- Registers plugins in order: `prisma` → `redis` → module routes (unprotected scope) → `clerk` → protected module routes
- Returns the configured `fastify` instance (not yet listening)
- Accepts `opts` passed to Fastify constructor so tests can pass `{ logger: false }`

**`start()`**
- Calls `build()`
- Calls `fastify.listen({ port: config.PORT, host: '0.0.0.0' })`
- Process entry point — only called when running directly, not in tests

---

## Plugins

### `src/plugins/prisma.js`
- Instantiates `PrismaClient` once
- Decorates Fastify with `fastify.prisma`
- Registers `onClose` hook to call `prisma.$disconnect()`

### `src/plugins/redis.js`
- Creates two `ioredis` connections from `config.REDIS_URL`:
  - `fastify.redis` — standard client for queues and general use
  - `fastify.redisWorker` — dedicated blocking connection for BullMQ workers
- Registers `onClose` hook to quit both connections

### `src/plugins/clerk.js`
- Registers a Fastify `onRequest` hook using `@clerk/backend` `verifyToken()`
- On valid token: sets `req.auth = { userId, sessionId }`
- On missing/invalid token: replies `401`
- Routes registered before this plugin (or with `{ onRequest: [] }`) are unprotected

---

## Modules

### `src/modules/health/routes.js`

**`GET /health`** — no auth, used as Coolify liveness probe

Response:
```json
{
  "status": "ok",
  "uptime": 123.45,
  "queues": { "pending": 0, "active": 0, "failed": 0 }
}
```

Queue counts fetched via BullMQ `Queue.getJobCounts('waiting', 'active', 'failed')`.
Registered outside the Clerk plugin scope.

---

## Plugin & Route Registration Order

```
Fastify instance created
  └── plugins/prisma.js          (fastify.prisma decorated)
  └── plugins/redis.js           (fastify.redis + fastify.redisWorker decorated)
  └── modules/health/routes.js   (unprotected scope)
  └── plugins/clerk.js           (auth hook applied to all routes below)
      └── (future modules registered here)
```

---

## Tooling

### `package.json` scripts
```json
"dev":          "node --watch src/server.js",
"start":        "node src/server.js",
"lint":         "eslint src",
"test":         "vitest run",
"test:watch":   "vitest",
"db:migrate":   "prisma migrate dev",
"db:deploy":    "prisma migrate deploy",
"db:generate":  "prisma generate",
"db:studio":    "prisma studio"
```

### Key dependencies
**Production:** `fastify`, `@fastify/cors`, `@clerk/backend`, `@prisma/client`, `ioredis`, `bullmq`

**Development:** `prisma`, `vitest`, `eslint`, `pino-pretty`

### ESLint (`.eslintrc.js`)
- ES2022+, Node globals, ESM
- `no-await-in-loop` — enforced to catch sequential-instead-of-parallel bugs
- No semicolons

### Vitest (`vitest.config.js`)
- `environment: 'node'`
- Test files: `src/**/*.test.js`

### Phase 1 test
```
src/modules/health/health.test.js
  - imports build() from server.js
  - fastify.inject GET /health
  - asserts 200, status: 'ok'
```

### Dockerfile (multi-stage)
```
Stage 1 (deps):  pnpm install --frozen-lockfile --prod
Stage 2 (app):   copy source, prisma generate, CMD node src/server.js
```

### `.dockerignore`
`node_modules`, `.env*`, `docs/`, `*.test.js`

---

## Environment Variables

```
# Required
DATABASE_URL=
REDIS_URL=
CLERK_SECRET_KEY=
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_SECRET=

# Optional
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

---

## What Phase 1 Does NOT Include

- Instagram OAuth or Meta API calls
- Any automation rules or webhook handling
- Frontend
- CI/CD pipeline config (Coolify handles this via GitHub integration)
- Database migrations (schema exists; migrations run in Phase 2 when models stabilise)
