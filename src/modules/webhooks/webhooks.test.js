import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  })),
}))

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

const mockEvaluate = vi.fn().mockResolvedValue(undefined)
vi.mock('../../services/ruleEngineService.js', () => ({
  createRuleEngineService: vi.fn(() => ({ evaluate: mockEvaluate })),
}))

const prismaSocialAccountFindFirst = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: { findUnique: vi.fn() },
    socialAccount: { findFirst: prismaSocialAccountFindFirst },
    scheduledPost: {
      create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn(),
    },
    automationRule: {
      create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
  })),
}))

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: 'clerk-user-123', sid: 'sess-123' }),
}))

vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: vi.fn() })),
}))

vi.mock('../../services/mediaService.js', () => ({ getUploadUrl: vi.fn() }))

const { build } = await import('../../server.js')

// META_WEBHOOK_SECRET is 'test_webhook_secret' (set in vitest.setup.js)
function sign(body) {
  return 'sha256=' + crypto.createHmac('sha256', 'test_webhook_secret').update(body).digest('hex')
}

describe('GET /webhooks/meta', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())

  it('returns challenge text when mode and token match', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=test_webhook_secret&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('abc123')
  })

  it('returns 403 when verify_token does not match', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when hub.mode is not subscribe', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=unsubscribe&hub.verify_token=test_webhook_secret&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /webhooks/meta', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    mockEvaluate.mockReset().mockResolvedValue(undefined)
  })

  it('returns 403 when signature header is invalid', async () => {
    const body = JSON.stringify({ entry: [] })
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': 'sha256=invalid', 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(403)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('calls evaluate with normalized COMMENT event payload', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', instagramAccountId: 'ig-123' })
    const payload = {
      entry: [{
        id: 'ig-123',
        changes: [{
          field: 'comments',
          value: { id: 'comment-abc', from: { id: 'commenter-1' }, text: 'love it!', media: { id: 'post-999' } },
        }],
      }],
    }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).toHaveBeenCalledWith({
      type: 'COMMENT',
      socialAccountId: 'acc-1',
      commenterId: 'commenter-1',
      text: 'love it!',
      postId: 'post-999',
      commentId: 'comment-abc',
    })
  })

  it('calls evaluate with normalized DM event payload', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', instagramAccountId: 'ig-123' })
    const payload = {
      entry: [{
        id: 'ig-123',
        messaging: [{ sender: { id: 'sender-1' }, message: { text: 'info' } }],
      }],
    }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).toHaveBeenCalledWith({
      type: 'DM',
      socialAccountId: 'acc-1',
      senderId: 'sender-1',
      text: 'info',
      threadId: 'sender-1',
    })
  })

  it('returns 200 and silently skips when instagramAccountId is not in DB', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const payload = { entry: [{ id: 'unknown-ig', changes: [] }] }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('returns 400 when body passes HMAC but is not valid JSON', async () => {
    const body = 'not-json'
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })
})
