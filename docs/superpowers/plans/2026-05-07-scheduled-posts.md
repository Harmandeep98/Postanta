# Phase 3: Scheduled Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled Instagram post publishing — users create posts with caption + media + a future publish time, a BullMQ delayed job fires at that time, and the postWorker publishes via Meta Graph API.

**Architecture:** `postRoutes` registers CRUD + media-upload endpoints in the protected Fastify scope; it creates a `scheduleService` (backed by a BullMQ queue) for job management. `postWorker` processes `post.publish` jobs — detecting image vs video, polling for video readiness, then publishing via four new `metaService` helpers.

**Tech Stack:** Fastify, BullMQ, Prisma (`ScheduledPost` already exists), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Meta Graph API v21.0, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/queues/postQueue.js` | BullMQ queue factory for `post.publish` |
| Create | `src/services/scheduleService.js` | `createJob`, `rescheduleJob`, `cancelJob` |
| Create | `src/services/scheduleService.test.js` | Tests for scheduleService |
| Create | `src/services/mediaService.js` | S3 presigned URL generation |
| Create | `src/services/mediaService.test.js` | Tests for mediaService |
| Modify | `src/services/metaService.js` | Add `publishImage`, `createVideoContainer`, `getContainerStatus`, `publishContainer`; update `graphFetch` to support POST |
| Modify | `src/services/metaService.test.js` | Add tests for 4 new functions |
| Create | `src/workers/postWorker.js` | Publishes posts via Meta API, polls video containers |
| Create | `src/workers/postWorker.test.js` | Tests for `publishPost` |
| Create | `src/modules/posts/routes.js` | REST endpoints: media upload, post CRUD |
| Create | `src/modules/posts/posts.test.js` | Route integration tests |
| Modify | `src/server.js` | Register postRoutes, start postWorker |
| Modify | `src/config.js` | Add AWS env vars |
| Modify | `vitest.setup.js` | Add AWS test values |
| Modify | `.env.example` | Document AWS vars |

---

## Task 1: Config, env vars, and install packages

**Files:**
- Modify: `src/config.js`
- Modify: `vitest.setup.js`
- Modify: `.env.example`

- [ ] **Step 1: Install AWS SDK packages**

Run: `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
Expected: packages added to package.json without errors

- [ ] **Step 2: Update `src/config.js`**

```js
const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'CLERK_SECRET_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_SECRET',
  'CLERK_WEBHOOK_SECRET',
  'META_REDIRECT_URI',
  'FRONTEND_URL',
  'AWS_S3_BUCKET',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
]

const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

export const config = Object.freeze({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_WEBHOOK_SECRET: process.env.META_WEBHOOK_SECRET,
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,
  META_REDIRECT_URI: process.env.META_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_REGION: process.env.AWS_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
})
```

- [ ] **Step 3: Update `vitest.setup.js`** — add 4 lines after the existing env vars:

```js
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key_for_tests'
process.env.META_APP_ID = 'test_app_id'
process.env.META_APP_SECRET = 'test_app_secret'
process.env.META_WEBHOOK_SECRET = 'test_webhook_secret'
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_webhook_secret'
process.env.META_REDIRECT_URI = 'http://localhost:3000/auth/instagram/callback'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.AWS_S3_BUCKET = 'test-bucket'
process.env.AWS_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
```

- [ ] **Step 4: Update `.env.example`** — add after existing vars:

```
AWS_S3_BUCKET=your-s3-bucket-name
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

- [ ] **Step 5: Run tests to confirm nothing broken**

Run: `npm test`
Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/config.js vitest.setup.js .env.example package.json pnpm-lock.yaml
git commit -m "chore: add AWS S3 config vars and install AWS SDK packages"
```

---

## Task 2: postQueue and scheduleService

**Files:**
- Create: `src/queues/postQueue.js`
- Create: `src/services/scheduleService.js`
- Create: `src/services/scheduleService.test.js`

- [ ] **Step 1: Write the failing tests** — create `src/services/scheduleService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createScheduleService } from './scheduleService.js'

const mockJobId = 'job-abc-123'
const mockJobRemove = vi.fn().mockResolvedValue(undefined)

const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: mockJobId }),
  getJob: vi.fn(),
}

let svc

beforeEach(() => {
  vi.clearAllMocks()
  svc = createScheduleService(mockQueue)
})

describe('createJob', () => {
  it('enqueues a delayed job and returns its id', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString()
    const id = await svc.createJob('post-1', futureDate)

    expect(mockQueue.add).toHaveBeenCalledWith(
      'publish',
      { postId: 'post-1' },
      expect.objectContaining({ delay: expect.any(Number), attempts: 3 }),
    )
    expect(id).toBe(mockJobId)
  })
})

describe('rescheduleJob', () => {
  it('removes old job and creates a new one, returning new id', async () => {
    const existingJob = { id: 'old-job', data: { postId: 'post-1' }, remove: mockJobRemove }
    mockQueue.getJob.mockResolvedValueOnce(existingJob)
    mockQueue.add.mockResolvedValueOnce({ id: 'new-job-id' })

    const futureDate = new Date(Date.now() + 120_000).toISOString()
    const newId = await svc.rescheduleJob('old-job', futureDate)

    expect(mockJobRemove).toHaveBeenCalled()
    expect(mockQueue.add).toHaveBeenCalled()
    expect(newId).toBe('new-job-id')
  })

  it('throws if old job not found', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)
    await expect(svc.rescheduleJob('missing-job', new Date().toISOString())).rejects.toThrow(
      'not found',
    )
  })
})

describe('cancelJob', () => {
  it('removes the job', async () => {
    const job = { remove: mockJobRemove }
    mockQueue.getJob.mockResolvedValueOnce(job)

    await svc.cancelJob('job-1')
    expect(mockJobRemove).toHaveBeenCalled()
  })

  it('is a no-op if job not found', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)
    await expect(svc.cancelJob('missing')).resolves.toBeUndefined()
    expect(mockJobRemove).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/services/scheduleService.test.js`
Expected: FAIL — `Cannot find module './scheduleService.js'`

- [ ] **Step 3: Create `src/queues/postQueue.js`**

```js
import { Queue } from 'bullmq'

export function createPostQueue(connection) {
  return new Queue('post.publish', { connection })
}
```

- [ ] **Step 4: Create `src/services/scheduleService.js`**

```js
export function createScheduleService(queue) {
  async function createJob(postId, scheduledAt) {
    const delay = new Date(scheduledAt).getTime() - Date.now()
    const job = await queue.add('publish', { postId }, {
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    return job.id
  }

  async function rescheduleJob(bullJobId, scheduledAt) {
    const existing = await queue.getJob(bullJobId)
    if (!existing) throw new Error(`Job ${bullJobId} not found`)
    const { postId } = existing.data
    await existing.remove()
    return createJob(postId, scheduledAt)
  }

  async function cancelJob(bullJobId) {
    const job = await queue.getJob(bullJobId)
    if (job) await job.remove()
  }

  return { createJob, rescheduleJob, cancelJob }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/services/scheduleService.test.js`
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/queues/postQueue.js src/services/scheduleService.js src/services/scheduleService.test.js
git commit -m "feat: add postQueue and scheduleService with BullMQ delayed job management"
```

---

## Task 3: mediaService

**Files:**
- Create: `src/services/mediaService.js`
- Create: `src/services/mediaService.test.js`

- [ ] **Step 1: Write the failing tests** — create `src/services/mediaService.test.js`:

```js
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/services/mediaService.test.js`
Expected: FAIL — `Cannot find module './mediaService.js'`

- [ ] **Step 3: Create `src/services/mediaService.js`**

```js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { config } from '../config.js'

const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
})

export async function getUploadUrl(contentType) {
  const key = randomUUID()
  const command = new PutObjectCommand({
    Bucket: config.AWS_S3_BUCKET,
    Key: key,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 })
  const mediaUrl = `https://${config.AWS_S3_BUCKET}.s3.${config.AWS_REGION}.amazonaws.com/${key}`
  return { uploadUrl, mediaUrl }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/mediaService.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/mediaService.js src/services/mediaService.test.js
git commit -m "feat: add mediaService with S3 presigned URL generation"
```

---

## Task 4: metaService Phase 3 additions

**Files:**
- Modify: `src/services/metaService.js`
- Modify: `src/services/metaService.test.js`

The existing `graphFetch` only supports GET. Add an `options` parameter so POST calls work. Then add 4 new exported functions.

- [ ] **Step 1: Write the failing tests** — append these 4 `describe` blocks to the end of `src/services/metaService.test.js` (after the existing `getValidToken` block):

```js
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
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npm test -- src/services/metaService.test.js`
Expected: existing 9 PASS, 4 new FAIL — `publishImage is not a function`

- [ ] **Step 3: Update `src/services/metaService.js`** — replace the existing `graphFetch` function and add 4 new exports at the end:

Replace:
```js
async function graphFetch(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'Meta API error')
  return data
}
```

With:
```js
async function graphFetch(url, options = {}) {
  const res = await fetch(url, options)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'Meta API error')
  return data
}
```

Then add at the end of the file:

```js
export async function publishImage(instagramAccountId, accessToken, { imageUrl, caption }) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('image_url', imageUrl)
  if (caption) url.searchParams.set('caption', caption)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}

export async function createVideoContainer(instagramAccountId, accessToken, { videoUrl, caption }) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('video_url', videoUrl)
  url.searchParams.set('media_type', 'REELS')
  if (caption) url.searchParams.set('caption', caption)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}

export async function getContainerStatus(containerId, accessToken) {
  const url = new URL(`${GRAPH_URL}/${containerId}`)
  url.searchParams.set('fields', 'status_code')
  url.searchParams.set('access_token', accessToken)
  const data = await graphFetch(url)
  return data.status_code
}

export async function publishContainer(instagramAccountId, accessToken, containerId) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media_publish`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('creation_id', containerId)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}
```

- [ ] **Step 4: Run all metaService tests to verify they pass**

Run: `npm test -- src/services/metaService.test.js`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/metaService.js src/services/metaService.test.js
git commit -m "feat: add publishImage, createVideoContainer, getContainerStatus, publishContainer to metaService"
```

---

## Task 5: postWorker

**Files:**
- Create: `src/workers/postWorker.js`
- Create: `src/workers/postWorker.test.js`

- [ ] **Step 1: Write the failing tests** — create `src/workers/postWorker.test.js`:

```js
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
const log = { info: vi.fn(), error: vi.fn() }

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
      publishPost({ data: { postId: 'post-3' } }, prisma, log, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Video processing timed out')

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-3' },
      data: { status: 'FAILED', errorMessage: 'Video processing timed out' },
    })
  })

  it('skips silently when post not found', async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(null)
    await publishPost({ data: { postId: 'missing' } }, prisma, log, { pollIntervalMs: 0 })
    expect(metaService.publishImage).not.toHaveBeenCalled()
    expect(mockPrismaUpdate).not.toHaveBeenCalled()
  })

  it('skips silently when post status is not SCHEDULED', async () => {
    mockPrismaFindUnique.mockResolvedValueOnce({
      id: 'post-5',
      status: 'PUBLISHED',
      socialAccount: mockAccount,
    })
    await publishPost({ data: { postId: 'post-5' } }, prisma, log, { pollIntervalMs: 0 })
    expect(metaService.publishImage).not.toHaveBeenCalled()
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
      publishPost({ data: { postId: 'post-6' } }, prisma, log, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Meta API error')

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 'post-6' },
      data: { status: 'FAILED', errorMessage: 'Meta API error' },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/workers/postWorker.test.js`
Expected: FAIL — `Cannot find module './postWorker.js'`

- [ ] **Step 3: Create `src/workers/postWorker.js`**

```js
import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

function isVideo(mediaUrl) {
  return mediaUrl ? /\.(mp4|mov)$/i.test(mediaUrl) : false
}

async function pollContainer(containerId, accessToken, intervalMs) {
  for (let i = 0; i < 10; i++) {
    const status = await metaService.getContainerStatus(containerId, accessToken)
    if (status === 'FINISHED') return
    if (i < 9) await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Video processing timed out')
}

export async function publishPost(job, prisma, log, { pollIntervalMs = 5000 } = {}) {
  const { postId } = job.data

  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { socialAccount: true },
  })

  if (!post || post.status !== 'SCHEDULED') return

  const accessToken = await metaService.getValidToken(post.socialAccount, prisma)
  const { instagramAccountId } = post.socialAccount

  try {
    let mediaId
    if (isVideo(post.mediaUrl)) {
      const containerId = await metaService.createVideoContainer(instagramAccountId, accessToken, {
        videoUrl: post.mediaUrl,
        caption: post.caption,
      })
      await pollContainer(containerId, accessToken, pollIntervalMs)
      mediaId = await metaService.publishContainer(instagramAccountId, accessToken, containerId)
    } else {
      const containerId = await metaService.publishImage(instagramAccountId, accessToken, {
        imageUrl: post.mediaUrl,
        caption: post.caption,
      })
      mediaId = await metaService.publishContainer(instagramAccountId, accessToken, containerId)
    }

    await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'PUBLISHED' } })
    log.info({ postId, mediaId }, 'post published')
  } catch (err) {
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'FAILED', errorMessage: err.message },
    })
    log.error({ postId, err: err.message }, 'post publish failed')
    throw err
  }
}

export function createPostWorker(connection, prisma, log) {
  return new Worker(
    'post.publish',
    (job) => publishPost(job, prisma, log),
    { connection, concurrency: 5 },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/workers/postWorker.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/workers/postWorker.js src/workers/postWorker.test.js
git commit -m "feat: add postWorker with image and video publishing via Meta Graph API"
```

---

## Task 6: posts routes

**Files:**
- Create: `src/modules/posts/routes.js`
- Create: `src/modules/posts/posts.test.js`

- [ ] **Step 1: Write the failing tests** — create `src/modules/posts/posts.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/posts/posts.test.js`
Expected: FAIL — `Cannot find module './routes.js'` or registration error

- [ ] **Step 3: Create `src/modules/posts/routes.js`**

```js
import { createPostQueue } from '../../queues/postQueue.js'
import { createScheduleService } from '../../services/scheduleService.js'
import * as mediaService from '../../services/mediaService.js'

export default async function postRoutes(fastify) {
  const queue = createPostQueue(fastify.redis)
  const scheduleService = createScheduleService(queue)

  fastify.addHook('onClose', async () => {
    await queue.close()
  })

  fastify.get('/media/upload-url', async (request, reply) => {
    const { contentType } = request.query
    if (!contentType) return reply.code(400).send({ error: 'contentType is required' })
    try {
      return await mediaService.getUploadUrl(contentType)
    } catch {
      return reply.code(500).send({ error: 'Failed to generate upload URL' })
    }
  })

  fastify.post('/posts', async (request, reply) => {
    const { socialAccountId, caption, mediaUrl, scheduledAt } = request.body

    if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
      return reply.code(400).send({ error: 'scheduledAt must be in the future' })
    }

    const user = await fastify.prisma.user.findUnique({ where: { clerkId: request.auth.userId } })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, userId: user.id },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const post = await fastify.prisma.scheduledPost.create({
      data: { socialAccountId, caption, mediaUrl, scheduledAt: new Date(scheduledAt), status: 'SCHEDULED' },
    })

    const bullJobId = await scheduleService.createJob(post.id, scheduledAt)
    const updated = await fastify.prisma.scheduledPost.update({
      where: { id: post.id },
      data: { bullJobId },
    })

    return reply.code(201).send(updated)
  })

  fastify.get('/posts', async (request, reply) => {
    const { socialAccountId } = request.query
    if (!socialAccountId) return reply.code(400).send({ error: 'socialAccountId is required' })

    const user = await fastify.prisma.user.findUnique({ where: { clerkId: request.auth.userId } })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, userId: user.id },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    return fastify.prisma.scheduledPost.findMany({
      where: { socialAccountId },
      orderBy: { scheduledAt: 'desc' },
    })
  })

  fastify.patch('/posts/:id', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({ where: { clerkId: request.auth.userId } })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const post = await fastify.prisma.scheduledPost.findFirst({
      where: { id: request.params.id, socialAccount: { userId: user.id } },
    })
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    if (post.status === 'PUBLISHED') {
      return reply.code(400).send({ error: 'Cannot edit a published post' })
    }

    const { caption, mediaUrl, scheduledAt } = request.body ?? {}

    if (scheduledAt !== undefined && new Date(scheduledAt) <= new Date()) {
      return reply.code(400).send({ error: 'scheduledAt must be in the future' })
    }

    const updateData = {}
    if (caption !== undefined) updateData.caption = caption
    if (mediaUrl !== undefined) updateData.mediaUrl = mediaUrl
    if (scheduledAt !== undefined) {
      updateData.scheduledAt = new Date(scheduledAt)
      updateData.bullJobId = await scheduleService.rescheduleJob(post.bullJobId, scheduledAt)
    }

    return fastify.prisma.scheduledPost.update({ where: { id: post.id }, data: updateData })
  })

  fastify.delete('/posts/:id', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({ where: { clerkId: request.auth.userId } })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const post = await fastify.prisma.scheduledPost.findFirst({
      where: { id: request.params.id, socialAccount: { userId: user.id } },
    })
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    await scheduleService.cancelJob(post.bullJobId)
    await fastify.prisma.scheduledPost.delete({ where: { id: post.id } })
    return reply.code(204).send()
  })
}
```

- [ ] **Step 4: Run tests to verify they fail** (routes exist but not registered in server.js yet)

Run: `npm test -- src/modules/posts/posts.test.js`
Expected: FAIL — routes return 404 (not registered yet)

- [ ] **Step 5: Register postRoutes in `src/server.js`** — add import and registration:

Add import at top:
```js
import postRoutes from './modules/posts/routes.js'
```

Add inside the protected scope (after `accountRoutes`):
```js
await protectedApp.register(postRoutes)
```

The protected scope block should now look like:
```js
await fastify.register(async (protectedApp) => {
  await protectedApp.register(clerkPlugin)
  await protectedApp.register(authProtectedRoutes)
  await protectedApp.register(accountRoutes)
  await protectedApp.register(postRoutes)
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- src/modules/posts/posts.test.js`
Expected: PASS — all posts tests pass

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/modules/posts/routes.js src/modules/posts/posts.test.js src/server.js
git commit -m "feat: add posts routes with CRUD, scheduling, and media upload endpoint"
```

---

## Task 7: Wire postWorker into server.js

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add postWorker to `start()` in `src/server.js`**

Add imports at top:
```js
import { createPostWorker } from './workers/postWorker.js'
```

Update `start()` to start the postWorker alongside the existing tokenRefreshWorker:

```js
export async function start() {
  const fastify = await build()

  const tokenRefreshQueue = createTokenRefreshQueue(fastify.redis)
  const tokenRefreshWorker = createTokenRefreshWorker(
    fastify.redisWorker,
    fastify.prisma,
    fastify.log,
  )
  await scheduleTokenRefreshJob(tokenRefreshQueue)

  const postWorker = createPostWorker(fastify.redisWorker, fastify.prisma, fastify.log)

  fastify.addHook('onClose', async () => {
    await tokenRefreshWorker.close()
    await tokenRefreshQueue.close()
    await postWorker.close()
  })

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: start postWorker on server boot for scheduled post publishing"
```
