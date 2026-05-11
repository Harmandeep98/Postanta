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

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../services/ruleEngineService.js', () => ({
  createRuleEngineService: vi.fn(() => ({ evaluate: vi.fn() })),
}))

const prismaSocialAccountFindFirst = vi.fn()
const prismaAutomationRuleCreate = vi.fn()
const prismaAutomationRuleFindMany = vi.fn()
const prismaAutomationRuleFindFirst = vi.fn()
const prismaAutomationRuleUpdate = vi.fn()
const prismaAutomationRuleDelete = vi.fn()

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
      create: prismaAutomationRuleCreate,
      findMany: prismaAutomationRuleFindMany,
      findFirst: prismaAutomationRuleFindFirst,
      update: prismaAutomationRuleUpdate,
      delete: prismaAutomationRuleDelete,
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

const AUTH_HEADER = { authorization: 'Bearer test-token' }

const validBody = {
  socialAccountId: 'acc-1',
  triggerType: 'COMMENT_KEYWORD',
  triggerKeyword: 'promo',
  matchType: 'CONTAINS',
  actionType: 'SEND_DM',
  messageTemplate: 'Hey {{first_name}}!',
}

const mockRule = {
  id: 'rule-1',
  socialAccountId: 'acc-1',
  triggerType: 'COMMENT_KEYWORD',
  triggerKeyword: 'promo',
  matchType: 'CONTAINS',
  actionType: 'SEND_DM',
  messageTemplate: 'Hey {{first_name}}!',
  postId: null,
  replyOncePerUser: true,
  cooldownMinutes: 60,
  isActive: true,
}

describe('POST /automations', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaAutomationRuleCreate.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/automations', body: validBody })
    expect(res.statusCode).toBe(401)
  })

  it('creates a rule and returns 201', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleCreate.mockResolvedValueOnce(mockRule)
    const res = await fastify.inject({ method: 'POST', url: '/automations', headers: AUTH_HEADER, body: validBody })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('rule-1')
    expect(prismaAutomationRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggerKeyword: 'promo' }) }),
    )
  })

  it('returns 404 when socialAccount belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'POST', url: '/automations', headers: AUTH_HEADER, body: validBody })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when REPLY_COMMENT is paired with DM_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, triggerType: 'DM_KEYWORD', actionType: 'REPLY_COMMENT' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/REPLY_COMMENT/)
  })

  it('returns 400 when REPLY_DM is paired with COMMENT_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, actionType: 'REPLY_DM' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/REPLY_DM/)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { socialAccountId: 'acc-1' }, // missing triggerType, triggerKeyword, etc.
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Missing required fields/)
  })

  it('sets postId to null when triggerType is DM_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleCreate.mockResolvedValueOnce({ ...mockRule, triggerType: 'DM_KEYWORD', actionType: 'SEND_DM' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, triggerType: 'DM_KEYWORD', actionType: 'SEND_DM', postId: 'some-post' },
    })
    expect(res.statusCode).toBe(201)
    expect(prismaAutomationRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ postId: null }) }),
    )
  })
})

describe('GET /automations', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaAutomationRuleFindMany.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/automations?socialAccountId=acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when socialAccountId is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/automations', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(400)
  })

  it('returns list of rules for own account', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleFindMany.mockResolvedValueOnce([mockRule])
    const res = await fastify.inject({
      method: 'GET',
      url: '/automations?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('returns 404 when account belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'GET',
      url: '/automations?socialAccountId=acc-other',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => { prismaAutomationRuleFindFirst.mockReset() })

  it('returns rule when owned by auth user', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    const res = await fastify.inject({ method: 'GET', url: '/automations/rule-1', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('rule-1')
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'GET', url: '/automations/rule-other', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaAutomationRuleFindFirst.mockReset()
    prismaAutomationRuleUpdate.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'PATCH', url: '/automations/rule-1', body: {} })
    expect(res.statusCode).toBe(401)
  })

  it('updates allowed fields and returns updated rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    prismaAutomationRuleUpdate.mockResolvedValueOnce({ ...mockRule, triggerKeyword: 'discount' })
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-1',
      headers: AUTH_HEADER,
      body: { triggerKeyword: 'discount' },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaAutomationRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggerKeyword: 'discount' }) }),
    )
  })

  it('returns 400 when update creates invalid trigger/action combo', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule) // actionType: SEND_DM, triggerType: COMMENT_KEYWORD
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-1',
      headers: AUTH_HEADER,
      body: { actionType: 'REPLY_DM' }, // REPLY_DM requires DM_KEYWORD but existing is COMMENT_KEYWORD
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-other',
      headers: AUTH_HEADER,
      body: { isActive: false },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaAutomationRuleFindFirst.mockReset()
    prismaAutomationRuleDelete.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-1' })
    expect(res.statusCode).toBe(401)
  })

  it('deletes own rule and returns 204', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    prismaAutomationRuleDelete.mockResolvedValueOnce({})
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-1', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(204)
    expect(prismaAutomationRuleDelete).toHaveBeenCalledWith({ where: { id: 'rule-1' } })
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-other', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(404)
  })
})
