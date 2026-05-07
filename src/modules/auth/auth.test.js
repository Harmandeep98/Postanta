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
