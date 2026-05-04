# Phase 2: Instagram OAuth & Token Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Instagram Business account connectivity via Meta OAuth, Clerk-webhook-based user provisioning, long-lived token storage, and proactive token refresh via BullMQ.

**Architecture:** Two Fastify route modules (`auth` and `accounts`) split by responsibility. `metaService.js` owns all Graph API calls. Token refresh runs as a BullMQ repeating job started in `start()` only (not in `build()`), keeping tests clean.

**Tech Stack:** Node.js, Fastify, Prisma, BullMQ, Redis (ioredis), `svix` (Clerk webhook verification), native `fetch` (Graph API calls)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/services/metaService.js` | All Meta Graph API calls: token exchange, refresh, IG account lookup, `getValidToken` |
| Create | `src/services/metaService.test.js` | Unit tests for metaService (fetch mocked globally) |
| Create | `src/modules/auth/routes.js` | Exports `authPublicRoutes` (webhook + callback) and `authProtectedRoutes` (OAuth initiate) |
| Create | `src/modules/auth/auth.test.js` | Integration tests for auth routes (Prisma + Redis + svix + fetch mocked) |
| Create | `src/modules/accounts/routes.js` | `GET /accounts` and `DELETE /accounts/:id` |
| Create | `src/modules/accounts/accounts.test.js` | Integration tests for accounts routes |
| Create | `src/queues/tokenRefreshQueue.js` | BullMQ Queue factory for `token.refresh` queue |
| Create | `src/workers/tokenRefreshWorker.js` | BullMQ Worker + `runSweep` (exported for testing) + `scheduleTokenRefreshJob` |
| Modify | `src/config.js` | Add `CLERK_WEBHOOK_SECRET`, `META_REDIRECT_URI`, `FRONTEND_URL` to required list |
| Modify | `vitest.setup.js` | Add fake values for the three new env vars |
| Modify | `.env.example` | Document new vars |
| Modify | `src/server.js` | Register auth + account modules in `build()`; start worker in `start()` |

---

## Task 1: Create branch and install svix

**Files:** none (setup only)

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feature/phase-2-instagram-auth
```

Expected: `Switched to a new branch 'feature/phase-2-instagram-auth'`

- [ ] **Step 2: Install svix**

```bash
npm install svix
```

Expected: `svix` appears in `package.json` dependencies.

---

## Task 2: Update config, test setup, and env example

**Files:**
- Modify: `src/config.js`
- Modify: `vitest.setup.js`
- Modify: `.env.example`

- [ ] **Step 1: Update `src/config.js`**

Replace the entire file:

```js
const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'CLERK_SECRET_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_SECRET',
  'CLERK_WEBHOOK_SECRET',
  'META_REDIRECT_URI',
  'FRONTEND_URL',
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
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,
  META_REDIRECT_URI: process.env.META_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
})
```

- [ ] **Step 2: Update `vitest.setup.js`**

```js
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key_for_tests'
process.env.META_APP_ID = 'test_app_id'
process.env.META_APP_SECRET = 'test_app_secret'
process.env.META_WEBHOOK_SECRET = 'test_webhook_secret'
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_webhook_secret'
process.env.META_REDIRECT_URI = 'http://localhost:3000/auth/instagram/callback'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
```

- [ ] **Step 3: Update `.env.example`**

```
# Required — app will not start without these
DATABASE_URL=postgresql://user:password@localhost:5432/social_manager
REDIS_URL=redis://localhost:6379
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_APP_ID=1234567890
META_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_WEBHOOK_SECRET=your_webhook_verify_token
CLERK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_REDIRECT_URI=https://api.yourdomain.com/auth/instagram/callback
FRONTEND_URL=https://app.yourdomain.com

# Optional — these have defaults
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all health tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js vitest.setup.js .env.example
git commit -m "feat: add CLERK_WEBHOOK_SECRET, META_REDIRECT_URI, FRONTEND_URL to config"
```

---

## Task 3: Implement metaService (TDD)

**Files:**
- Create: `src/services/metaService.test.js`
- Create: `src/services/metaService.js`

- [ ] **Step 1: Write `src/services/metaService.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    META_APP_ID: 'test-app-id',
    META_APP_SECRET: 'test-secret',
    META_REDIRECT_URI: 'http://localhost:3000/auth/instagram/callback',
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  getInstagramAccounts,
  getValidToken,
} = await import('./metaService.js')

describe('exchangeCodeForShortLivedToken', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns accessToken from Meta response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'short-token' }),
    })
    const result = await exchangeCodeForShortLivedToken('auth-code')
    expect(result).toEqual({ accessToken: 'short-token' })
    const calledUrl = fetchMock.mock.calls[0][0].toString()
    expect(calledUrl).toContain('code=auth-code')
    expect(calledUrl).toContain('client_id=test-app-id')
  })

  it('throws when Meta returns an error object', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Invalid code' } }),
    })
    await expect(exchangeCodeForShortLivedToken('bad-code')).rejects.toThrow('Invalid code')
  })
})

describe('exchangeForLongLivedToken', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns accessToken and expiresIn from Meta response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'long-token', expires_in: 5184000 }),
    })
    const result = await exchangeForLongLivedToken('short-token')
    expect(result).toEqual({ accessToken: 'long-token', expiresIn: 5184000 })
    const calledUrl = fetchMock.mock.calls[0][0].toString()
    expect(calledUrl).toContain('grant_type=fb_exchange_token')
    expect(calledUrl).toContain('fb_exchange_token=short-token')
  })
})

describe('refreshLongLivedToken', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns refreshed accessToken and expiresIn', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'refreshed-token', expires_in: 5184000 }),
    })
    const result = await refreshLongLivedToken('old-token')
    expect(result).toEqual({ accessToken: 'refreshed-token', expiresIn: 5184000 })
  })

  it('throws when refresh fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Token expired' } }),
    })
    await expect(refreshLongLivedToken('bad-token')).rejects.toThrow('Token expired')
  })
})

describe('getInstagramAccounts', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns IG accounts from pages that have them', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: 'page-1', instagram_business_account: { id: 'ig-123' } },
              { id: 'page-2' }, // no IG account — skipped
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ username: 'mybrand' }),
      })

    const result = await getInstagramAccounts('user-token')
    expect(result).toEqual([{ instagramAccountId: 'ig-123', username: 'mybrand' }])
  })

  it('returns empty array when no pages have IG accounts', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    })
    const result = await getInstagramAccounts('user-token')
    expect(result).toEqual([])
  })
})

describe('getValidToken', () => {
  beforeEach(() => fetchMock.mockReset())

  const prismaMock = { socialAccount: { update: vi.fn() } }

  it('returns current token when not expiring within 7 days', async () => {
    const account = {
      id: 'acc-1',
      accessToken: 'valid-token',
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
    const token = await getValidToken(account, prismaMock)
    expect(token).toBe('valid-token')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled()
  })

  it('refreshes and persists token when expiring within 7 days', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-token', expires_in: 5184000 }),
    })
    prismaMock.socialAccount.update = vi.fn().mockResolvedValueOnce({})

    const account = {
      id: 'acc-1',
      accessToken: 'old-token',
      tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    }
    const token = await getValidToken(account, prismaMock)
    expect(token).toBe('new-token')
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ accessToken: 'new-token' }),
    })
  })
})
```

- [ ] **Step 2: Run tests — expect failure (module not found)**

```bash
npx vitest run src/services/metaService.test.js
```

Expected: `Error: Cannot find module './metaService.js'`

- [ ] **Step 3: Create `src/services/metaService.js`**

```js
import { config } from '../config.js'

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

async function graphFetch(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'Meta API error')
  return data
}

export async function exchangeCodeForShortLivedToken(code) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('redirect_uri', config.META_REDIRECT_URI)
  url.searchParams.set('code', code)
  const data = await graphFetch(url)
  return { accessToken: data.access_token }
}

export async function exchangeForLongLivedToken(shortLivedToken) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('fb_exchange_token', shortLivedToken)
  const data = await graphFetch(url)
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function refreshLongLivedToken(accessToken) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('fb_exchange_token', accessToken)
  const data = await graphFetch(url)
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function getInstagramAccounts(userToken) {
  const pagesUrl = new URL(`${GRAPH_URL}/me/accounts`)
  pagesUrl.searchParams.set('access_token', userToken)
  pagesUrl.searchParams.set('fields', 'id,instagram_business_account')
  const pagesData = await graphFetch(pagesUrl)

  const pages = (pagesData.data ?? []).filter((p) => p.instagram_business_account?.id)

  const results = await Promise.allSettled(
    pages.map(async (page) => {
      const igId = page.instagram_business_account.id
      const igUrl = new URL(`${GRAPH_URL}/${igId}`)
      igUrl.searchParams.set('fields', 'username')
      igUrl.searchParams.set('access_token', userToken)
      const igData = await graphFetch(igUrl)
      return { instagramAccountId: igId, username: igData.username }
    }),
  )

  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
}

export async function getValidToken(socialAccount, prisma) {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  if (socialAccount.tokenExpiresAt > sevenDaysFromNow) {
    return socialAccount.accessToken
  }
  const { accessToken, expiresIn } = await refreshLongLivedToken(socialAccount.accessToken)
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)
  await prisma.socialAccount.update({
    where: { id: socialAccount.id },
    data: { accessToken, tokenExpiresAt },
  })
  return accessToken
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run src/services/metaService.test.js
```

Expected: `9 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/services/metaService.js src/services/metaService.test.js
git commit -m "feat: add metaService with token exchange, refresh, and getValidToken"
```

---

## Task 4: Auth routes — Clerk webhook + OAuth initiate + OAuth callback (TDD)

**Files:**
- Create: `src/modules/auth/routes.js`
- Create: `src/modules/auth/auth.test.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write `src/modules/auth/auth.test.js`**

```js
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

// Mutable mock state accessible across tests
const redisMockSet = vi.fn().mockResolvedValue('OK')
const redisMockGet = vi.fn().mockResolvedValue(null)
const redisMockDel = vi.fn().mockResolvedValue(1)

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    set: redisMockSet,
    get: redisMockGet,
    del: redisMockDel,
  })),
}))

const prismaUserCreate = vi.fn().mockResolvedValue({ id: 'user-1' })
const prismaUserDelete = vi.fn().mockResolvedValue({})
const prismaUserUpsert = vi.fn().mockResolvedValue({ id: 'user-1' })
const prismaSocialAccountUpsert = vi.fn().mockResolvedValue({ id: 'account-1' })

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: {
      create: prismaUserCreate,
      delete: prismaUserDelete,
      upsert: prismaUserUpsert,
    },
    socialAccount: {
      upsert: prismaSocialAccountUpsert,
    },
  })),
}))

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: 'clerk-user-123', sid: 'sess-123' }),
}))

const svixVerifyMock = vi.fn()
vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: svixVerifyMock })),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { build } = await import('../../server.js')

// ─── Clerk Webhook ────────────────────────────────────────────────────────────

describe('POST /webhooks/clerk', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(() => fastify.close())

  beforeEach(() => {
    svixVerifyMock.mockReset()
    prismaUserCreate.mockReset().mockResolvedValue({ id: 'user-1' })
    prismaUserDelete.mockReset().mockResolvedValue({})
  })

  const webhookHeaders = {
    'content-type': 'application/json',
    'svix-id': 'msg_123',
    'svix-timestamp': '1234567890',
    'svix-signature': 'v1,sig',
  }

  it('returns 400 when svix signature is invalid', async () => {
    svixVerifyMock.mockImplementation(() => {
      throw new Error('bad signature')
    })

    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: webhookHeaders,
      body: JSON.stringify({ type: 'user.created', data: {} }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid webhook signature')
  })

  it('creates User row on user.created event', async () => {
    svixVerifyMock.mockReturnValue({
      type: 'user.created',
      data: {
        id: 'clerk-abc',
        email_addresses: [{ email_address: 'test@example.com' }],
      },
    })

    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: webhookHeaders,
      body: JSON.stringify({}),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(prismaUserCreate).toHaveBeenCalledWith({
      data: { clerkId: 'clerk-abc', email: 'test@example.com' },
    })
  })

  it('deletes User row on user.deleted event', async () => {
    svixVerifyMock.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-abc' },
    })

    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: webhookHeaders,
      body: JSON.stringify({}),
    })

    expect(res.statusCode).toBe(200)
    expect(prismaUserDelete).toHaveBeenCalledWith({ where: { clerkId: 'clerk-abc' } })
  })
})

// ─── OAuth Initiate ───────────────────────────────────────────────────────────

describe('GET /auth/instagram', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(() => fastify.close())

  beforeEach(() => {
    redisMockSet.mockReset().mockResolvedValue('OK')
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/auth/instagram' })
    expect(res.statusCode).toBe(401)
  })

  it('redirects to Meta OAuth URL with correct query params and stores state in Redis', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/auth/instagram',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(302)
    const location = res.headers.location
    expect(location).toContain('client_id=test_app_id')
    expect(location).toContain('response_type=code')
    expect(location).toContain('state=')
    expect(location).toContain('scope=')
    expect(redisMockSet).toHaveBeenCalledOnce()
    const [key, , , ttl] = redisMockSet.mock.calls[0]
    expect(key).toMatch(/^oauth:state:/)
    expect(ttl).toBe(600)
  })
})

// ─── OAuth Callback ───────────────────────────────────────────────────────────

describe('GET /auth/instagram/callback', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(() => fastify.close())

  beforeEach(() => {
    redisMockGet.mockReset().mockResolvedValue(null)
    redisMockDel.mockReset().mockResolvedValue(1)
    fetchMock.mockReset()
    prismaUserUpsert.mockReset().mockResolvedValue({ id: 'user-1' })
    prismaSocialAccountUpsert.mockReset().mockResolvedValue({ id: 'account-1' })
  })

  it('redirects to frontend error page when Meta sends an error param', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/auth/instagram/callback?error=access_denied&state=s',
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/connect/error')
    expect(res.headers.location).toContain('access_denied')
  })

  it('returns 400 when state is missing or expired in Redis', async () => {
    redisMockGet.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'GET',
      url: '/auth/instagram/callback?code=abc&state=bad-state',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid or expired state')
  })

  it('upserts SocialAccount and redirects to success on valid OAuth', async () => {
    redisMockGet.mockResolvedValueOnce('clerk-user-123')

    fetchMock
      // exchangeCodeForShortLivedToken
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'short' }) })
      // exchangeForLongLivedToken
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'long-token', expires_in: 5184000 }),
      })
      // getInstagramAccounts → /me/accounts
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: 'page-1', instagram_business_account: { id: 'ig-123' } }],
          }),
      })
      // getInstagramAccounts → /{igId}?fields=username
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ username: 'mybrand' }),
      })

    const res = await fastify.inject({
      method: 'GET',
      url: '/auth/instagram/callback?code=auth-code&state=valid-state',
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/connect/success')
    expect(res.headers.location).toContain('accountId=account-1')
    expect(prismaSocialAccountUpsert).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests — expect failure (module not found)**

```bash
npx vitest run src/modules/auth/auth.test.js
```

Expected: `Error: Cannot find module '../../server.js'` or route-not-found errors after server imports.

- [ ] **Step 3: Create `src/modules/auth/routes.js`**

```js
import { Webhook } from 'svix'
import { config } from '../../config.js'
import * as metaService from '../../services/metaService.js'

export async function authPublicRoutes(fastify) {
  // Nested scope so the raw-body parser only applies to the webhook route
  fastify.register(async function webhookScope(instance) {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    )

    instance.post('/webhooks/clerk', async (request, reply) => {
      const svixId = request.headers['svix-id']
      const svixTimestamp = request.headers['svix-timestamp']
      const svixSignature = request.headers['svix-signature']

      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.code(400).send({ error: 'Invalid webhook signature' })
      }

      const wh = new Webhook(config.CLERK_WEBHOOK_SECRET)
      let event
      try {
        event = wh.verify(request.body, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        })
      } catch {
        return reply.code(400).send({ error: 'Invalid webhook signature' })
      }

      const { type, data } = event

      if (type === 'user.created') {
        await instance.prisma.user.create({
          data: {
            clerkId: data.id,
            email: data.email_addresses?.[0]?.email_address ?? '',
          },
        })
      } else if (type === 'user.deleted') {
        await instance.prisma.user.delete({ where: { clerkId: data.id } })
      }

      return { received: true }
    })
  })

  fastify.get('/auth/instagram/callback', async (request, reply) => {
    const { code, state, error } = request.query

    if (error) {
      return reply.redirect(
        `${config.FRONTEND_URL}/connect/error?reason=${encodeURIComponent(error)}`,
      )
    }

    const clerkUserId = await fastify.redis.get(`oauth:state:${state}`)
    if (!clerkUserId) {
      return reply.code(400).send({ error: 'Invalid or expired state' })
    }
    await fastify.redis.del(`oauth:state:${state}`)

    try {
      const user = await fastify.prisma.user.upsert({
        where: { clerkId: clerkUserId },
        create: { clerkId: clerkUserId, email: '' },
        update: {},
      })

      const { accessToken: shortToken } = await metaService.exchangeCodeForShortLivedToken(code)
      const { accessToken: longToken, expiresIn } =
        await metaService.exchangeForLongLivedToken(shortToken)
      const accounts = await metaService.getInstagramAccounts(longToken)
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

      if (accounts.length === 0) {
        return reply.redirect(`${config.FRONTEND_URL}/connect/error?reason=no_instagram_account`)
      }

      const upserted = await Promise.all(
        accounts.map((acc) =>
          fastify.prisma.socialAccount.upsert({
            where: {
              userId_instagramAccountId: {
                userId: user.id,
                instagramAccountId: acc.instagramAccountId,
              },
            },
            create: {
              userId: user.id,
              instagramAccountId: acc.instagramAccountId,
              instagramUsername: acc.username,
              accessToken: longToken,
              tokenExpiresAt,
            },
            update: {
              instagramUsername: acc.username,
              accessToken: longToken,
              tokenExpiresAt,
            },
          }),
        ),
      )

      return reply.redirect(
        `${config.FRONTEND_URL}/connect/success?accountId=${upserted[0].id}`,
      )
    } catch (err) {
      request.log.error({ err: err.message }, 'OAuth callback failed')
      return reply.redirect(`${config.FRONTEND_URL}/connect/error?reason=token_exchange_failed`)
    }
  })
}

export async function authProtectedRoutes(fastify) {
  fastify.get('/auth/instagram', async (request, reply) => {
    const state = crypto.randomUUID()
    await fastify.redis.set(`oauth:state:${state}`, request.auth.userId, 'EX', 600)

    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    url.searchParams.set('client_id', config.META_APP_ID)
    url.searchParams.set('redirect_uri', config.META_REDIRECT_URI)
    url.searchParams.set(
      'scope',
      'instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_messaging,pages_show_list',
    )
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)

    return reply.redirect(url.toString())
  })
}
```

- [ ] **Step 4: Update `src/server.js` to register auth routes**

```js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import prismaPlugin from './plugins/prisma.js'
import redisPlugin from './plugins/redis.js'
import clerkPlugin from './plugins/clerk.js'
import healthRoutes from './modules/health/routes.js'
import { authPublicRoutes, authProtectedRoutes } from './modules/auth/routes.js'

export async function build({ logger: loggerOpt, ...rest } = {}) {
  const fastify = Fastify({
    logger: loggerOpt ?? {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    ...rest,
  })

  await fastify.register(cors)
  await fastify.register(prismaPlugin)
  await fastify.register(redisPlugin)

  // Unprotected routes
  await fastify.register(healthRoutes)
  await fastify.register(authPublicRoutes)

  // Protected scope — clerk onRequest hook applies only inside this child scope
  await fastify.register(async (protectedApp) => {
    await protectedApp.register(clerkPlugin)
    await protectedApp.register(authProtectedRoutes)
    // accounts module added in Task 5
  })

  return fastify
}

export async function start() {
  const fastify = await build()
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
```

- [ ] **Step 5: Run auth tests — expect all pass**

```bash
npx vitest run src/modules/auth/auth.test.js
```

Expected: `8 tests passed`

- [ ] **Step 6: Run full test suite — ensure health tests still pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/routes.js src/modules/auth/auth.test.js src/server.js
git commit -m "feat: add Clerk webhook, Instagram OAuth initiate and callback routes"
```

---

## Task 5: Accounts routes (TDD)

**Files:**
- Create: `src/modules/accounts/routes.js`
- Create: `src/modules/accounts/accounts.test.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write `src/modules/accounts/accounts.test.js`**

```js
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  })),
}))

const prismaUserFindUnique = vi.fn()
const prismaSocialAccountFindMany = vi.fn()
const prismaSocialAccountFindFirst = vi.fn()
const prismaSocialAccountDelete = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: { findUnique: prismaUserFindUnique },
    socialAccount: {
      findMany: prismaSocialAccountFindMany,
      findFirst: prismaSocialAccountFindFirst,
      delete: prismaSocialAccountDelete,
    },
  })),
}))

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: 'clerk-user-123', sid: 'sess-123' }),
}))

vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: vi.fn() })),
}))

const { build } = await import('../../server.js')

describe('GET /accounts', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(() => fastify.close())

  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaSocialAccountFindMany.mockReset()
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/accounts' })
    expect(res.statusCode).toBe(401)
  })

  it('returns accounts list without accessToken field', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindMany.mockResolvedValueOnce([
      {
        id: 'acc-1',
        instagramAccountId: '17841000',
        instagramUsername: 'mybrand',
        tokenExpiresAt: new Date('2025-07-01'),
        createdAt: new Date('2025-05-01'),
      },
    ])

    const res = await fastify.inject({
      method: 'GET',
      url: '/accounts',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].instagramUsername).toBe('mybrand')
    expect(body[0]).not.toHaveProperty('accessToken')
  })
})

describe('DELETE /accounts/:id', () => {
  let fastify

  beforeAll(async () => {
    fastify = await build({ logger: false })
    await fastify.ready()
  })

  afterAll(() => fastify.close())

  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaSocialAccountFindFirst.mockReset()
    prismaSocialAccountDelete.mockReset()
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fastify.inject({ method: 'DELETE', url: '/accounts/acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when account belongs to another user', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/accounts/acc-other',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('deletes account and returns 204', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1' })
    prismaSocialAccountDelete.mockResolvedValueOnce({})

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/accounts/acc-1',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(204)
    expect(prismaSocialAccountDelete).toHaveBeenCalledWith({ where: { id: 'acc-1' } })
  })
})
```

- [ ] **Step 2: Run tests — expect failure (module not found)**

```bash
npx vitest run src/modules/accounts/accounts.test.js
```

Expected: `Error: Cannot find module` or route-not-found for `/accounts`.

- [ ] **Step 3: Create `src/modules/accounts/routes.js`**

```js
export default async function accountRoutes(fastify) {
  fastify.get('/accounts', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { clerkId: request.auth.userId },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const accounts = await fastify.prisma.socialAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        instagramAccountId: true,
        instagramUsername: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    })

    return accounts
  })

  fastify.delete('/accounts/:id', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { clerkId: request.auth.userId },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: request.params.id, userId: user.id },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    await fastify.prisma.socialAccount.delete({ where: { id: request.params.id } })
    return reply.code(204).send()
  })
}
```

- [ ] **Step 4: Add `accountRoutes` to `src/server.js`**

Add the import at the top:
```js
import accountRoutes from './modules/accounts/routes.js'
```

Register inside the protected scope (replace the comment):
```js
await fastify.register(async (protectedApp) => {
  await protectedApp.register(clerkPlugin)
  await protectedApp.register(authProtectedRoutes)
  await protectedApp.register(accountRoutes)
})
```

- [ ] **Step 5: Run accounts tests — expect all pass**

```bash
npx vitest run src/modules/accounts/accounts.test.js
```

Expected: `5 tests passed`

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounts/routes.js src/modules/accounts/accounts.test.js src/server.js
git commit -m "feat: add GET /accounts and DELETE /accounts/:id routes"
```

---

## Task 6: Token refresh queue, worker, and start() wiring

**Files:**
- Create: `src/queues/tokenRefreshQueue.js`
- Create: `src/workers/tokenRefreshWorker.js`
- Modify: `src/server.js`

- [ ] **Step 1: Create `src/queues/tokenRefreshQueue.js`**

```js
import { Queue } from 'bullmq'

export function createTokenRefreshQueue(connection) {
  return new Queue('token.refresh', { connection })
}
```

- [ ] **Step 2: Create `src/workers/tokenRefreshWorker.js`**

```js
import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

export async function runSweep(prisma, log) {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const accounts = await prisma.socialAccount.findMany({
    where: { tokenExpiresAt: { lt: sevenDaysFromNow } },
  })

  log.info({ count: accounts.length }, 'token refresh sweep started')

  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      const { accessToken, expiresIn } = await metaService.refreshLongLivedToken(
        account.accessToken,
      )
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        },
      })
    }),
  )

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      log.error(
        { accountId: accounts[i].id, err: result.reason?.message },
        'token refresh failed for account',
      )
    }
  })

  const succeeded = results.filter((r) => r.status === 'fulfilled').length
  log.info({ succeeded, failed: results.length - succeeded }, 'token refresh sweep complete')
}

export function createTokenRefreshWorker(connection, prisma, log) {
  return new Worker('token.refresh', () => runSweep(prisma, log), {
    connection,
    concurrency: 1,
  })
}

export async function scheduleTokenRefreshJob(queue) {
  await queue.add('token.refresh.sweep', {}, {
    repeat: { cron: '0 3 * * *' },
    jobId: 'token.refresh.sweep',
  })
}
```

- [ ] **Step 3: Write a test for `runSweep` in `src/workers/tokenRefreshWorker.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    META_APP_ID: 'test-app-id',
    META_APP_SECRET: 'test-secret',
    META_REDIRECT_URI: 'http://localhost:3000/auth/instagram/callback',
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { runSweep } = await import('./tokenRefreshWorker.js')

const logMock = { info: vi.fn(), error: vi.fn() }

describe('runSweep', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    logMock.info.mockReset()
    logMock.error.mockReset()
  })

  it('refreshes tokens for accounts expiring within 7 days', async () => {
    const prismaMock = {
      socialAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc-1', accessToken: 'old-token', tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-token', expires_in: 5184000 }),
    })

    await runSweep(prismaMock, logMock)

    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ accessToken: 'new-token' }),
    })
    expect(logMock.error).not.toHaveBeenCalled()
  })

  it('logs error per failed account without aborting sweep', async () => {
    const prismaMock = {
      socialAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc-1', accessToken: 'bad-token', tokenExpiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000) },
        ]),
        update: vi.fn(),
      },
    }

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Token expired' } }),
    })

    await runSweep(prismaMock, logMock)

    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1' }),
      'token refresh failed for account',
    )
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled()
  })

  it('does nothing when no accounts need refresh', async () => {
    const prismaMock = {
      socialAccount: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    }

    await runSweep(prismaMock, logMock)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run worker test — expect all pass**

```bash
npx vitest run src/workers/tokenRefreshWorker.test.js
```

Expected: `3 tests passed`

- [ ] **Step 5: Update `src/server.js` — add worker startup to `start()`**

Add imports at top of `src/server.js`:
```js
import { createTokenRefreshQueue } from './queues/tokenRefreshQueue.js'
import { createTokenRefreshWorker, scheduleTokenRefreshJob } from './workers/tokenRefreshWorker.js'
```

Replace the existing `start()` function:
```js
export async function start() {
  const fastify = await build()

  const tokenRefreshQueue = createTokenRefreshQueue(fastify.redis)
  const tokenRefreshWorker = createTokenRefreshWorker(
    fastify.redisWorker,
    fastify.prisma,
    fastify.log,
  )
  await scheduleTokenRefreshJob(tokenRefreshQueue)

  fastify.addHook('onClose', async () => {
    await tokenRefreshWorker.close()
    await tokenRefreshQueue.close()
  })

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
```

- [ ] **Step 6: Run full test suite — all tests pass**

```bash
npm test
```

Expected: all tests pass. Worker starts only via `start()`, so tests using `build()` are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/queues/tokenRefreshQueue.js src/workers/tokenRefreshWorker.js src/workers/tokenRefreshWorker.test.js src/server.js
git commit -m "feat: add token refresh BullMQ worker with daily sweep and on-demand fallback"
```

---

## Task 7: Final check and PR prep

- [ ] **Step 1: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --base develop \
  --title "feat: Phase 2 — Instagram OAuth, token storage, and refresh" \
  --body "Implements Phase 2 per spec in docs/superpowers/specs/2026-05-04-instagram-oauth-design.md

## What's included
- Clerk webhook for user provisioning (POST /webhooks/clerk)
- Instagram OAuth flow with Redis-backed CSRF state (GET /auth/instagram + callback)
- Long-lived token storage in SocialAccount via Prisma upsert
- On-demand token refresh in metaService.getValidToken
- Proactive daily refresh via BullMQ repeating job (runs in start() only)
- GET /accounts and DELETE /accounts/:id for account management"
```
