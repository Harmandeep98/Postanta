import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
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
