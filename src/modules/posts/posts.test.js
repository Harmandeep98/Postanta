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

const mockJobId = 'bullmq-job-123'
const mockJobRemove = vi.fn().mockResolvedValue(undefined)
const mockQueueAdd = vi.fn().mockResolvedValue({ id: mockJobId })
const mockQueueGetJob = vi.fn()

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getJob: mockQueueGetJob,
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

const mockGetUploadUrl = vi.fn()
vi.mock('../../services/mediaService.js', () => ({
  getUploadUrl: mockGetUploadUrl,
}))

const prismaUserFindUnique = vi.fn()
const prismaSocialAccountFindFirst = vi.fn()
const prismaScheduledPostCreate = vi.fn()
const prismaScheduledPostUpdate = vi.fn()
const prismaScheduledPostFindMany = vi.fn()
const prismaScheduledPostFindFirst = vi.fn()
const prismaScheduledPostDelete = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: { findUnique: prismaUserFindUnique },
    socialAccount: { findFirst: prismaSocialAccountFindFirst },
    scheduledPost: {
      create: prismaScheduledPostCreate,
      update: prismaScheduledPostUpdate,
      findMany: prismaScheduledPostFindMany,
      findFirst: prismaScheduledPostFindFirst,
      delete: prismaScheduledPostDelete,
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
const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString()

describe('GET /media/upload-url', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => { mockGetUploadUrl.mockReset() })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/media/upload-url?contentType=image/jpeg' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when contentType is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/media/upload-url', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(400)
  })

  it('returns uploadUrl and mediaUrl', async () => {
    mockGetUploadUrl.mockResolvedValueOnce({
      uploadUrl: 'https://s3.amazonaws.com/upload',
      mediaUrl: 'https://test-bucket.s3.us-east-1.amazonaws.com/uuid-123',
    })
    const res = await fastify.inject({
      method: 'GET',
      url: '/media/upload-url?contentType=image/jpeg',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.uploadUrl).toBeDefined()
    expect(body.mediaUrl).toBeDefined()
  })
})

describe('POST /posts', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaSocialAccountFindFirst.mockReset()
    prismaScheduledPostCreate.mockReset()
    prismaScheduledPostUpdate.mockReset()
    mockQueueAdd.mockClear()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/posts', body: {} })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when scheduledAt is in the past', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: AUTH_HEADER,
      body: { socialAccountId: 'acc-1', caption: 'Hi', scheduledAt: '2020-01-01T00:00:00Z' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('future')
  })

  it('creates post, enqueues job, stores bullJobId, returns 201', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1' })
    const createdPost = { id: 'post-1', socialAccountId: 'acc-1', caption: 'Hi', status: 'SCHEDULED', bullJobId: null }
    prismaScheduledPostCreate.mockResolvedValueOnce(createdPost)
    const updatedPost = { ...createdPost, bullJobId: mockJobId }
    prismaScheduledPostUpdate.mockResolvedValueOnce(updatedPost)

    const res = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: AUTH_HEADER,
      body: { socialAccountId: 'acc-1', caption: 'Hi', scheduledAt: futureDate },
    })

    expect(res.statusCode).toBe(201)
    expect(mockQueueAdd).toHaveBeenCalledWith('publish', { postId: 'post-1' }, expect.any(Object))
    expect(prismaScheduledPostUpdate).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { bullJobId: mockJobId },
    })
    expect(res.json().bullJobId).toBe(mockJobId)
  })

  it('returns 404 when socialAccount belongs to another user', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: AUTH_HEADER,
      body: { socialAccountId: 'acc-other', caption: 'Hi', scheduledAt: futureDate },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /posts', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaSocialAccountFindFirst.mockReset()
    prismaScheduledPostFindMany.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/posts?socialAccountId=acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns posts list for own account', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaScheduledPostFindMany.mockResolvedValueOnce([
      { id: 'post-1', caption: 'Hello', status: 'SCHEDULED' },
    ])

    const res = await fastify.inject({
      method: 'GET',
      url: '/posts?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('returns 404 for another user\'s account', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'GET',
      url: '/posts?socialAccountId=acc-other',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /posts/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaScheduledPostFindFirst.mockReset()
    prismaScheduledPostUpdate.mockReset()
    mockQueueGetJob.mockReset()
    mockQueueAdd.mockClear()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'PATCH', url: '/posts/post-1', body: {} })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for another user\'s post', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/posts/post-other',
      headers: AUTH_HEADER,
      body: { caption: 'New' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when editing a published post', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce({ id: 'post-1', status: 'PUBLISHED', bullJobId: 'job-1' })

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/posts/post-1',
      headers: AUTH_HEADER,
      body: { caption: 'New' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('published')
  })

  it('updates caption without touching the BullMQ job', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce({ id: 'post-1', status: 'SCHEDULED', bullJobId: 'job-1' })
    prismaScheduledPostUpdate.mockResolvedValueOnce({ id: 'post-1', caption: 'Updated' })

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/posts/post-1',
      headers: AUTH_HEADER,
      body: { caption: 'Updated' },
    })
    expect(res.statusCode).toBe(200)
    expect(mockQueueGetJob).not.toHaveBeenCalled()
    expect(prismaScheduledPostUpdate).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { caption: 'Updated' },
    })
  })

  it('reschedules BullMQ job when scheduledAt changes', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce({ id: 'post-1', status: 'SCHEDULED', bullJobId: 'old-job' })
    const existingJob = { id: 'old-job', data: { postId: 'post-1' }, remove: mockJobRemove }
    mockQueueGetJob.mockResolvedValueOnce(existingJob)
    mockQueueAdd.mockResolvedValueOnce({ id: 'new-job-id' })
    prismaScheduledPostUpdate.mockResolvedValueOnce({ id: 'post-1', bullJobId: 'new-job-id' })

    const newDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/posts/post-1',
      headers: AUTH_HEADER,
      body: { scheduledAt: newDate },
    })
    expect(res.statusCode).toBe(200)
    expect(mockJobRemove).toHaveBeenCalled()
    expect(mockQueueAdd).toHaveBeenCalled()
    expect(prismaScheduledPostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bullJobId: 'new-job-id' }) }),
    )
  })
})

describe('DELETE /posts/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaUserFindUnique.mockReset()
    prismaScheduledPostFindFirst.mockReset()
    prismaScheduledPostDelete.mockReset()
    mockQueueGetJob.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'DELETE', url: '/posts/post-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for another user\'s post', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce(null)

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/posts/post-other',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })

  it('cancels BullMQ job, deletes post, returns 204', async () => {
    prismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
    prismaScheduledPostFindFirst.mockResolvedValueOnce({ id: 'post-1', bullJobId: 'job-1' })
    const job = { remove: mockJobRemove }
    mockQueueGetJob.mockResolvedValueOnce(job)
    prismaScheduledPostDelete.mockResolvedValueOnce({})

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/posts/post-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(204)
    expect(mockJobRemove).toHaveBeenCalled()
    expect(prismaScheduledPostDelete).toHaveBeenCalledWith({ where: { id: 'post-1' } })
  })
})
