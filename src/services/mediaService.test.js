import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSignedUrl = vi.fn().mockResolvedValue('https://signed.url/upload')

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((opts) => opts),
}))

vi.mock('../config.js', () => ({
  config: {
    AWS_S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  },
}))

const { getUploadUrl } = await import('./mediaService.js')

describe('getUploadUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a presigned uploadUrl and a public mediaUrl', async () => {
    const { uploadUrl, mediaUrl } = await getUploadUrl('image/jpeg')

    expect(uploadUrl).toBe('https://signed.url/upload')
    expect(mediaUrl).toMatch(/^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\//)
  })

  it('passes ContentType and Bucket to PutObjectCommand', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await getUploadUrl('video/mp4')
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: 'video/mp4', Bucket: 'test-bucket' }),
    )
  })

  it('generates a unique key for each call', async () => {
    const a = await getUploadUrl('image/jpeg')
    const b = await getUploadUrl('image/jpeg')
    expect(a.mediaUrl).not.toBe(b.mediaUrl)
  })

  it('propagates errors from getSignedUrl', async () => {
    mockGetSignedUrl.mockRejectedValueOnce(new Error('SDK failure'))
    await expect(getUploadUrl('image/jpeg')).rejects.toThrow('SDK failure')
  })
})
