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
