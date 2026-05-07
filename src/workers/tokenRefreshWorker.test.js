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
