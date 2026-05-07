import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/metaService.js', () => ({
  getValidToken: vi.fn(),
  publishImage: vi.fn(),
  createVideoContainer: vi.fn(),
  getContainerStatus: vi.fn(),
  publishContainer: vi.fn(),
}))

const metaService = await import('../services/metaService.js')
const { publishPost } = await import('./postWorker.js')

const mockPrismaUpdate = vi.fn().mockResolvedValue({})
const mockPrismaFindUnique = vi.fn()

const prisma = {
  scheduledPost: {
    findUnique: mockPrismaFindUnique,
    update: mockPrismaUpdate,
  },
}
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const mockAccount = {
  id: 'acc-1',
  instagramAccountId: '17841000',
  accessToken: 'token-abc',
  tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
}

beforeEach(() => {
  vi.clearAllMocks()
  metaService.getValidToken.mockResolvedValue('valid-token')
  mockPrismaUpdate.mockResolvedValue({})
})

describe('publishPost', () => {
  it('publishes an image post and sets status to PUBLISHED', async () => {
    const post = {
      id: 'post-1',
      caption: 'Hello!',
      mediaUrl: 'https://cdn.example.com/img.jpg',
      status: 'SCHEDULED',
      socialAccount: mockAccount,
    }
    mockPrismaFindUnique.mockResolvedValueOnce(post)
    metaService.publishImage.mockResolvedValueOnce('container-1')
    metaService.publishContainer.mockResolvedValueOnce('media-id-1')

    await publishPost({ data: { postId: 'post-1' } }, prisma, log, { pollIntervalMs: 0 })

    expect(metaService.publishImage).toHaveBeenCalledWith('17841000', 'valid-token', {
      imageUrl: 'https://cdn.example.com/img.jpg',
      caption: 'Hello!',
    })
    expect(metaService.publishContainer).toHaveBeenCalledWith('17841000', 'valid-token', 'container-1')
    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { status: 'PUBLISHED' },
    })
  })

  it('publishes a video post, polling until FINISHED', async () => {
    const post = {
      id: 'post-2',
      caption: 'Video!',
      mediaUrl: 'https://cdn.example.com/clip.mp4',
      status: 'SCHEDULED',
      socialAccount: mockAccount,
    }
    mockPrismaFindUnique.mockResolvedValueOnce(post)
    metaService.createVideoContainer.mockResolvedValueOnce('container-2')
    metaService.getContainerStatus
      .mockResolvedValueOnce('IN_PROGRESS')
      .mockResolvedValueOnce('FINISHED')
    metaService.publishContainer.mockResolvedValueOnce('media-id-2')

    await publishPost({ data: { postId: 'post-2' } }, prisma, log, { pollIntervalMs: 0 })

    expect(metaService.getContainerStatus).toHaveBeenCalledTimes(2)
    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-2' },
      data: { status: 'PUBLISHED' },
    })
  })

  it('sets FAILED and rethrows when video polling times out', async () => {
    const post = {
      id: 'post-3',
      caption: 'Slow',
      mediaUrl: 'https://cdn.example.com/slow.mov',
      status: 'SCHEDULED',
      socialAccount: mockAccount,
    }
    mockPrismaFindUnique.mockResolvedValueOnce(post)
    metaService.createVideoContainer.mockResolvedValueOnce('container-3')
    metaService.getContainerStatus.mockResolvedValue('IN_PROGRESS')

    await expect(
      publishPost({ id: 'job-3', attemptsMade: 0, data: { postId: 'post-3' } }, prisma, log, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Video processing timed out')

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-3' },
      data: { status: 'FAILED', errorMessage: 'Video processing timed out' },
    })
    expect(metaService.getContainerStatus).toHaveBeenCalledTimes(10)
    expect(log.error).toHaveBeenCalledWith(
      { postId: 'post-3', jobId: 'job-3', err: 'Video processing timed out', attempt: 0 },
      'post publish failed',
    )
  })

  it('skips silently when post not found', async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(null)
    await publishPost({ data: { postId: 'missing' } }, prisma, log, { pollIntervalMs: 0 })
    expect(metaService.publishImage).not.toHaveBeenCalled()
    expect(mockPrismaUpdate).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith({ postId: 'missing' }, 'scheduledPost not found, skipping')
  })

  it('skips silently when post status is not SCHEDULED', async () => {
    mockPrismaFindUnique.mockResolvedValueOnce({
      id: 'post-5',
      status: 'PUBLISHED',
      socialAccount: mockAccount,
    })
    await publishPost({ data: { postId: 'post-5' } }, prisma, log, { pollIntervalMs: 0 })
    expect(metaService.publishImage).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith({ postId: 'post-5', status: 'PUBLISHED' }, 'scheduledPost not in SCHEDULED state, skipping')
  })

  it('sets FAILED and rethrows on Meta API error', async () => {
    const post = {
      id: 'post-6',
      caption: 'Oops',
      mediaUrl: 'https://cdn.example.com/img.jpg',
      status: 'SCHEDULED',
      socialAccount: mockAccount,
    }
    mockPrismaFindUnique.mockResolvedValueOnce(post)
    metaService.publishImage.mockRejectedValueOnce(new Error('Meta API error'))

    await expect(
      publishPost({ id: 'job-6', attemptsMade: 1, data: { postId: 'post-6' } }, prisma, log, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Meta API error')

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-6' },
      data: { status: 'FAILED', errorMessage: 'Meta API error' },
    })
    expect(log.error).toHaveBeenCalledWith(
      { postId: 'post-6', jobId: 'job-6', err: 'Meta API error', attempt: 1 },
      'post publish failed',
    )
  })

  it('sets FAILED and rethrows when video container enters ERROR state', async () => {
    const post = {
      id: 'post-7',
      caption: 'Error video',
      mediaUrl: 'https://cdn.example.com/err.mp4',
      status: 'SCHEDULED',
      socialAccount: mockAccount,
    }
    mockPrismaFindUnique.mockResolvedValueOnce(post)
    metaService.createVideoContainer.mockResolvedValueOnce('container-7')
    metaService.getContainerStatus.mockResolvedValue('ERROR')

    await expect(
      publishPost({ id: 'job-7', attemptsMade: 2, data: { postId: 'post-7' } }, prisma, log, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Video container processing failed')

    expect(metaService.getContainerStatus).toHaveBeenCalledTimes(1)
    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-7' },
      data: { status: 'FAILED', errorMessage: 'Video container processing failed' },
    })
    expect(log.error).toHaveBeenCalledWith(
      { postId: 'post-7', jobId: 'job-7', err: 'Video container processing failed', attempt: 2 },
      'post publish failed',
    )
  })
})
