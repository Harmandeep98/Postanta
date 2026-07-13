# Phase 1 Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Node.js + Fastify project with Prisma, Redis/BullMQ, Clerk auth, pino logging, and a working `/health` endpoint — no business logic.

**Architecture:** Modular monolith (Approach A) — each domain is a folder under `src/modules/`, shared infrastructure lives in `src/plugins/`. Server and workers run in the same process. `src/server.js` exports `build()` for tests and `start()` for runtime. `src/index.js` is the process entry point.

**Tech Stack:** Node.js 20, Fastify 5, ESM, pnpm, Prisma 6, ioredis, BullMQ, @clerk/backend, Vitest, pino

---

## File Map

| File | Purpose |
|---|---|
| `package.json` | Project manifest, scripts, dependencies |
| `.gitignore` | Ignore node_modules, .env, dist |
| `.env.example` | All required env vars with placeholder values |
| `.eslintrc.cjs` | ESLint config — no-await-in-loop, no semis |
| `vitest.config.js` | Vitest — node env, setupFiles |
| `vitest.setup.js` | Sets test env vars before any module imports |
| `src/config.js` | Reads + validates env vars, exports frozen config object |
| `src/index.js` | Process entry point — calls start() |
| `src/server.js` | Exports build() and start() |
| `src/plugins/prisma.js` | PrismaClient plugin → fastify.prisma |
| `src/plugins/redis.js` | ioredis plugin → fastify.redis + fastify.redisWorker |
| `src/plugins/clerk.js` | Clerk JWT verification onRequest hook |
| `src/modules/health/routes.js` | GET /health — no auth |
| `src/modules/health/health.test.js` | Integration test for /health |
| `Dockerfile` | Two-stage Docker build |
| `.dockerignore` | Exclude dev artifacts from image |

---

## Task 1: Git init + feature branch

**Files:** none (git only)

- [ ] **Step 1: Initialise git repo**

```bash
cd D:/code/social-medial-manager
git init
git checkout -b feature/phase-1-scaffold
```

Expected: `Switched to a new branch 'feature/phase-1-scaffold'`

---

## Task 2: package.json + install dependencies

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "social-medial-manager",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "lint": "eslint src",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@clerk/backend": "^1.25.4",
    "@fastify/cors": "^10.0.1",
    "@prisma/client": "^6.6.0",
    "bullmq": "^5.53.0",
    "fastify": "^5.3.2",
    "fastify-plugin": "^5.0.1",
    "ioredis": "^5.6.0"
  },
  "devDependencies": {
    "eslint": "^9.25.1",
    "pino-pretty": "^13.0.0",
    "prisma": "^6.6.0",
    "vitest": "^3.1.2"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules` created, `pnpm-lock.yaml` generated. No errors.

---

## Task 3: .gitignore + .env.example

**Files:**
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Write .gitignore**

```
node_modules/
.env
.env.*
!.env.example
*.log
```

- [ ] **Step 2: Write .env.example**

```bash
# Required — app will not start without these
DATABASE_URL=postgresql://user:password@localhost:5432/social_manager
REDIS_URL=redis://localhost:6379
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_APP_ID=1234567890
META_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_WEBHOOK_SECRET=your_webhook_verify_token

# Optional — these have defaults
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore .env.example prisma/schema.prisma
git commit -m "chore: initialise project with dependencies and schema"
```

---

## Task 4: Tooling — ESLint + Vitest

**Files:**
- Create: `.eslintrc.cjs`
- Create: `vitest.config.js`
- Create: `vitest.setup.js`

- [ ] **Step 1: Write .eslintrc.cjs**

Note: must be `.cjs` because the package has `"type": "module"`.

```js
module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'no-await-in-loop': 'error',
    semi: ['error', 'never'],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
}
```

- [ ] **Step 2: Write vitest.setup.js**

This file sets all required env vars before any test module is imported. Must run before `config.js` is first loaded.

```js
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key_for_tests'
process.env.META_APP_ID = 'test_app_id'
process.env.META_APP_SECRET = 'test_app_secret'
process.env.META_WEBHOOK_SECRET = 'test_webhook_secret'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
```

- [ ] **Step 3: Write vitest.config.js**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.js'],
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add .eslintrc.cjs vitest.config.js vitest.setup.js
git commit -m "chore: add ESLint and Vitest config"
```

---

## Task 5: src/config.js

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Create src/ directory and write config.js**

```js
const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'CLERK_SECRET_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_SECRET',
]

const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

export const config = Object.freeze({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_WEBHOOK_SECRET: process.env.META_WEBHOOK_SECRET,
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
})
```

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat: add config module with env validation"
```

---

## Task 6: src/plugins/prisma.js

**Files:**
- Create: `src/plugins/prisma.js`

- [ ] **Step 1: Write the plugin**

`fastify-plugin` removes Fastify's plugin encapsulation so the `fastify.prisma` decorator is visible to all routes registered after this plugin.

```js
import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

async function prismaPlugin(fastify) {
  const prisma = new PrismaClient()
  await prisma.$connect()

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(prismaPlugin, { name: 'prisma' })
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/prisma.js
git commit -m "feat: add Prisma plugin"
```

---

## Task 7: src/plugins/redis.js

**Files:**
- Create: `src/plugins/redis.js`

- [ ] **Step 1: Write the plugin**

BullMQ requires a dedicated `ioredis` connection with `maxRetriesPerRequest: null` for its blocking commands. The standard `redis` client is for general use (queue producers, health checks).

```js
import fp from 'fastify-plugin'
import Redis from 'ioredis'
import { config } from '../config.js'

async function redisPlugin(fastify) {
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
  })

  const redisWorker = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  })

  await redis.connect()
  await redisWorker.connect()

  fastify.decorate('redis', redis)
  fastify.decorate('redisWorker', redisWorker)

  fastify.addHook('onClose', async () => {
    await redis.quit()
    await redisWorker.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/redis.js
git commit -m "feat: add Redis plugin with dual connections for BullMQ"
```

---

## Task 8: src/plugins/clerk.js

**Files:**
- Create: `src/plugins/clerk.js`

- [ ] **Step 1: Write the plugin**

This plugin registers an `onRequest` hook that gates every route registered in its scope. Routes registered before this plugin (like `/health`) are unaffected.

```js
import fp from 'fastify-plugin'
import { verifyToken } from '@clerk/backend'
import { config } from '../config.js'

async function clerkPlugin(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const token = authHeader.slice(7)

    try {
      const payload = await verifyToken(token, {
        secretKey: config.CLERK_SECRET_KEY,
      })
      request.auth = { userId: payload.sub, sessionId: payload.sid }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}

export default fp(clerkPlugin, { name: 'clerk' })
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/clerk.js
git commit -m "feat: add Clerk JWT verification plugin"
```

---

## Task 9: src/modules/health/routes.js

**Files:**
- Create: `src/modules/health/routes.js`

- [ ] **Step 1: Write the health route**

Queue counts are placeholder zeros in Phase 1 — real counts are wired up in Phase 3/4 when queues are defined.

```js
export default async function healthRoutes(fastify) {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status', 'uptime', 'queues'],
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              queues: {
                type: 'object',
                properties: {
                  pending: { type: 'number' },
                  active: { type: 'number' },
                  failed: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        uptime: process.uptime(),
        queues: { pending: 0, active: 0, failed: 0 },
      }
    },
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/health/routes.js
git commit -m "feat: add health check route"
```

---

## Task 10: Write the failing health test

**Files:**
- Create: `src/modules/health/health.test.js`

- [ ] **Step 1: Write the test**

`vi.mock()` is hoisted by Vitest before any imports, so `@prisma/client` and `ioredis` are mocked before `server.js` imports them. `vitest.setup.js` ensures env vars are set before `config.js` is evaluated.

```js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
  })),
}))

const { build } = await import('../../server.js')

describe('GET /health', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(async () => {
    await fastify.close()
  })

  it('returns 200 with status ok', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.queues).toEqual({ pending: 0, active: 0, failed: 0 })
  })

  it('does not require an Authorization header', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    })
    expect(response.statusCode).not.toBe(401)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module '../../server.js'`

---

## Task 11: src/server.js + src/index.js

**Files:**
- Create: `src/server.js`
- Create: `src/index.js`

- [ ] **Step 1: Write src/server.js**

```js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import prismaPlugin from './plugins/prisma.js'
import redisPlugin from './plugins/redis.js'
import clerkPlugin from './plugins/clerk.js'
import healthRoutes from './modules/health/routes.js'

export async function build(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger ?? {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    ...opts,
  })

  await fastify.register(cors)
  await fastify.register(prismaPlugin)
  await fastify.register(redisPlugin)

  // Unprotected routes — registered before Clerk plugin
  await fastify.register(healthRoutes)

  // Clerk plugin gates all routes registered after this point
  await fastify.register(clerkPlugin)

  // Future authenticated modules register here

  return fastify
}

export async function start() {
  const fastify = await build()
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
```

- [ ] **Step 2: Write src/index.js**

```js
import { start } from './server.js'

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Run the test — verify it passes**

```bash
pnpm test
```

Expected:
```
✓ src/modules/health/health.test.js (2)
  ✓ GET /health > returns 200 with status ok
  ✓ GET /health > does not require an Authorization header

Test Files  1 passed (1)
Tests       2 passed (2)
```

- [ ] **Step 4: Run the linter**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/index.js src/modules/health/health.test.js
git commit -m "feat: wire server bootstrap and make health test pass"
```

---

## Task 12: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write Dockerfile**

Stage 1 installs all deps (including dev) and generates the Prisma client. Stage 2 installs prod-only deps and copies the generated client from Stage 1.

```dockerfile
# Stage 1: install all deps + generate Prisma client
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN pnpm db:generate

# Stage 2: production image
FROM node:20-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
# Copy Prisma generated client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY src ./src
COPY prisma ./prisma
EXPOSE 3000
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Write .dockerignore**

```
node_modules/
.env
.env.*
!.env.example
docs/
*.test.js
.git/
*.log
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "chore: add multi-stage Dockerfile"
```

---

## Task 13: CLAUDE.md update + open PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the dev script in CLAUDE.md to match package.json**

In `CLAUDE.md`, under Commands, the `dev` script already says `npm run dev`. No change needed — the script name is the same, only the entry file changed internally.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feature/phase-1-scaffold
```

Then open a PR on GitHub:
- **Title:** `feat: Phase 1 — project scaffold`
- **Base branch:** `main`
- **Description:** Bootstraps the Fastify server, Prisma + Redis plugins, Clerk auth, pino logging, `/health` endpoint, Vitest test suite, and Docker build. No business logic — foundation only.

---

## Spec Coverage Check

| Spec requirement | Covered by task |
|---|---|
| `src/config.js` — env validation, frozen export | Task 5 |
| `src/plugins/prisma.js` — PrismaClient, onClose | Task 6 |
| `src/plugins/redis.js` — dual ioredis connections | Task 7 |
| `src/plugins/clerk.js` — onRequest hook, 401 | Task 8 |
| `src/modules/health/routes.js` — GET /health | Task 9 |
| `build()` + `start()` exports, pino logger | Task 11 |
| Plugin registration order | Task 11 |
| Health route outside Clerk scope | Task 11 |
| `.env.example` with all vars | Task 3 |
| ESLint with `no-await-in-loop` | Task 4 |
| Vitest, `environment: node` | Task 4 |
| Phase 1 test — inject /health, assert 200 | Tasks 10–11 |
| Dockerfile two-stage | Task 12 |
| `.dockerignore` | Task 12 |
| Feature branch + PR workflow | Tasks 1, 13 |
