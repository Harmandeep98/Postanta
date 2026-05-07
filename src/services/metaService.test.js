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

describe('publishImage', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /{igId}/media and returns containerId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'container-1' }),
    })
    const { publishImage } = await import('./metaService.js')
    const containerId = await publishImage('ig-123', 'token-abc', {
      imageUrl: 'https://cdn.example.com/img.jpg',
      caption: 'Hello!',
    })
    expect(containerId).toBe('container-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts?.method).toBe('POST')
    expect(url.toString()).toContain('/ig-123/media')
    expect(url.toString()).toContain('image_url=')
    expect(url.toString()).toContain('caption=Hello')
  })
})

describe('createVideoContainer', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /{igId}/media with media_type=REELS and returns containerId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'container-2' }),
    })
    const { createVideoContainer } = await import('./metaService.js')
    const containerId = await createVideoContainer('ig-123', 'token-abc', {
      videoUrl: 'https://cdn.example.com/clip.mp4',
      caption: 'Video!',
    })
    expect(containerId).toBe('container-2')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts?.method).toBe('POST')
    expect(url.toString()).toContain('media_type=REELS')
    expect(url.toString()).toContain('video_url=')
  })
})

describe('getContainerStatus', () => {
  beforeEach(() => fetchMock.mockReset())

  it('GETs container status_code and returns it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status_code: 'FINISHED' }),
    })
    const { getContainerStatus } = await import('./metaService.js')
    const status = await getContainerStatus('container-1', 'token-abc')
    expect(status).toBe('FINISHED')
    const [url] = fetchMock.mock.calls[0]
    expect(url.toString()).toContain('/container-1')
    expect(url.toString()).toContain('fields=status_code')
  })
})

describe('publishContainer', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /{igId}/media_publish and returns mediaId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'media-id-1' }),
    })
    const { publishContainer } = await import('./metaService.js')
    const mediaId = await publishContainer('ig-123', 'token-abc', 'container-1')
    expect(mediaId).toBe('media-id-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts?.method).toBe('POST')
    expect(url.toString()).toContain('/ig-123/media_publish')
    expect(url.toString()).toContain('creation_id=container-1')
  })
})
