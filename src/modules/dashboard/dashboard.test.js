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

const queueGetJobCounts = vi.fn()

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    getJobCounts: queueGetJobCounts,
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../services/ruleEngineService.js', () => ({
  createRuleEngineService: vi.fn(() => ({ evaluate: vi.fn() })),
}))

vi.mock('../../services/mediaService.js', () => ({ getUploadUrl: vi.fn() }))

const prismaSocialAccountFindFirst = vi.fn()
const prismaAutomationRuleFindMany = vi.fn()
const prismaRuleExecutionLogGroupBy = vi.fn()
const prismaRuleExecutionLogFindMany = vi.fn()
const prismaRuleExecutionLogCount = vi.fn()

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
      create: vi.fn(), findMany: prismaAutomationRuleFindMany, findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    ruleExecutionLog: {
      groupBy: prismaRuleExecutionLogGroupBy,
      findMany: prismaRuleExecutionLogFindMany,
      count: prismaRuleExecutionLogCount,
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

const AUTH_HEADER = { authorization: 'Bearer test-token' }

describe('GET /dashboard/analytics/rules', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaAutomationRuleFindMany.mockReset()
    prismaRuleExecutionLogGroupBy.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/dashboard/analytics/rules?socialAccountId=acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when socialAccountId is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/dashboard/analytics/rules', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when account belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/analytics/rules?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })

  it('merges groupBy counts into rules and zero-fills missing outcomes', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleFindMany.mockResolvedValueOnce([
      { id: 'rule-1', triggerType: 'COMMENT_KEYWORD', triggerKeyword: 'promo', actionType: 'SEND_DM', isActive: true },
      { id: 'rule-2', triggerType: 'DM_KEYWORD', triggerKeyword: 'help', actionType: 'REPLY_DM', isActive: true },
    ])
    prismaRuleExecutionLogGroupBy.mockResolvedValueOnce([
      { ruleId: 'rule-1', outcome: 'EXECUTED', _count: 12 },
      { ruleId: 'rule-1', outcome: 'SKIPPED_COOLDOWN', _count: 3 },
    ])

    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/analytics/rules?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rules).toHaveLength(2)

    const rule1 = body.rules.find((r) => r.ruleId === 'rule-1')
    expect(rule1.counts).toEqual({ EXECUTED: 12, SKIPPED_ONCE_PER_USER: 0, SKIPPED_COOLDOWN: 3, FAILED: 0 })
    expect(rule1.total).toBe(15)

    const rule2 = body.rules.find((r) => r.ruleId === 'rule-2')
    expect(rule2.counts).toEqual({ EXECUTED: 0, SKIPPED_ONCE_PER_USER: 0, SKIPPED_COOLDOWN: 0, FAILED: 0 })
    expect(rule2.total).toBe(0)
  })

  it('passes ruleId and date range filters into the groupBy where clause', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleFindMany.mockResolvedValueOnce([])
    prismaRuleExecutionLogGroupBy.mockResolvedValueOnce([])

    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/analytics/rules?socialAccountId=acc-1&ruleId=rule-1&from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z',
      headers: AUTH_HEADER,
    })

    expect(res.statusCode).toBe(200)
    expect(prismaRuleExecutionLogGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rule: { socialAccountId: 'acc-1' },
          ruleId: 'rule-1',
          createdAt: { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-02-01T00:00:00.000Z') },
        }),
      }),
    )
  })
})

describe('GET /dashboard/queues', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => { queueGetJobCounts.mockReset() })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/dashboard/queues' })
    expect(res.statusCode).toBe(401)
  })

  it('merges job counts from all three queues', async () => {
    queueGetJobCounts
      .mockResolvedValueOnce({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 })
      .mockResolvedValueOnce({ waiting: 6, active: 7, completed: 8, failed: 9, delayed: 10 })
      .mockResolvedValueOnce({ waiting: 11, active: 12, completed: 13, failed: 14, delayed: 15 })

    const res = await fastify.inject({ method: 'GET', url: '/dashboard/queues', headers: AUTH_HEADER })

    expect(res.statusCode).toBe(200)
    expect(queueGetJobCounts).toHaveBeenCalledTimes(3)
    const body = res.json()
    expect(body.automation).toEqual({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 })
    expect(body.posts).toEqual({ waiting: 6, active: 7, completed: 8, failed: 9, delayed: 10 })
    expect(body.tokenRefresh).toEqual({ waiting: 11, active: 12, completed: 13, failed: 14, delayed: 15 })
  })
})

describe('GET /dashboard/rule-logs', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaRuleExecutionLogFindMany.mockReset()
    prismaRuleExecutionLogCount.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/dashboard/rule-logs?socialAccountId=acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when socialAccountId is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/dashboard/rule-logs', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when outcome is not a valid enum value', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1&outcome=NOT_REAL',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(['0', 'abc'])('returns 400 when page is invalid (%s)', async (page) => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/dashboard/rule-logs?socialAccountId=acc-1&page=${page}`,
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(['0', '101'])('returns 400 when limit is invalid (%s)', async (limit) => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/dashboard/rule-logs?socialAccountId=acc-1&limit=${limit}`,
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when account belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })

  it('applies default pagination and computes totalPages', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaRuleExecutionLogFindMany.mockResolvedValueOnce([
      { id: 'log-1', ruleId: 'rule-1', instagramUserId: 'ig-1', outcome: 'EXECUTED', errorMessage: null, createdAt: new Date().toISOString() },
    ])
    prismaRuleExecutionLogCount.mockResolvedValueOnce(57)

    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 57, totalPages: 3 })
    expect(prismaRuleExecutionLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    )
  })

  it('returns empty data for a page beyond available results', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaRuleExecutionLogFindMany.mockResolvedValueOnce([])
    prismaRuleExecutionLogCount.mockResolvedValueOnce(5)

    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1&page=99&limit=20',
      headers: AUTH_HEADER,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(body.pagination).toEqual({ page: 99, limit: 20, total: 5, totalPages: 1 })
  })

  it('passes ruleId and outcome filters into the where clause', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaRuleExecutionLogFindMany.mockResolvedValueOnce([])
    prismaRuleExecutionLogCount.mockResolvedValueOnce(0)

    await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1&ruleId=rule-1&outcome=FAILED',
      headers: AUTH_HEADER,
    })

    expect(prismaRuleExecutionLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rule: { socialAccountId: 'acc-1' }, ruleId: 'rule-1', outcome: 'FAILED' },
      }),
    )
  })

  it('never returns triggerPayload', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaRuleExecutionLogFindMany.mockResolvedValueOnce([
      { id: 'log-1', ruleId: 'rule-1', instagramUserId: 'ig-1', outcome: 'EXECUTED', errorMessage: null, createdAt: new Date().toISOString() },
    ])
    prismaRuleExecutionLogCount.mockResolvedValueOnce(1)

    const res = await fastify.inject({
      method: 'GET',
      url: '/dashboard/rule-logs?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })

    expect(res.json().data[0]).not.toHaveProperty('triggerPayload')
    expect(prismaRuleExecutionLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.not.objectContaining({ triggerPayload: true }) }),
    )
  })
})
