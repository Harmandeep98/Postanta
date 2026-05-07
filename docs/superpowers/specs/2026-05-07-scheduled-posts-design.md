# Phase 3: Scheduled Posts — Design Spec

**Date:** 2026-05-07
**Branch:** feature/phase-3-scheduled-posts
**Status:** Approved

---

## Overview

Phase 3 adds scheduled Instagram post publishing. Users create a post with a caption, media (image or video), and a future publish time. A BullMQ delayed job fires at that time and publishes via the Meta Graph API. Users can edit, reschedule, or cancel posts before they publish.

---

## Architecture

### New files
```
src/modules/posts/routes.js        — CRUD + schedule endpoints
src/services/scheduleService.js    — BullMQ delayed job management
src/services/mediaService.js       — S3 presigned URL generation
src/workers/postWorker.js          — publishes posts via Meta Graph API
src/queues/postQueue.js            — BullMQ queue definition
```

### Modified files
```
src/server.js    — register posts module, start postWorker
src/config.js    — add AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
.env.example     — document new vars
```

### Schema
`ScheduledPost` is already fully defined in `prisma/schema.prisma` — `caption`, `mediaUrl`, `scheduledAt`, `status` (DRAFT/SCHEDULED/PUBLISHED/FAILED), `bullJobId`, `errorMessage`. No migration needed.

### New dependencies
```
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
```

### New environment variables
```
AWS_S3_BUCKET           # S3 bucket name for media uploads
AWS_REGION              # AWS region, e.g. eu-west-1
AWS_ACCESS_KEY_ID       # AWS IAM access key
AWS_SECRET_ACCESS_KEY   # AWS IAM secret key
```

---

## Section 1: Media Upload

### `GET /media/upload-url?contentType=<mime>`
**Auth:** Clerk required

1. Validate `contentType` query param is present.
2. Call `mediaService.getUploadUrl(contentType)` → generates a presigned S3 `PutObjectCommand` URL (15-min TTL). Object key is a `crypto.randomUUID()`.
3. Return:
```json
{ "uploadUrl": "https://s3.amazonaws.com/...", "mediaUrl": "https://{bucket}.s3.{region}.amazonaws.com/{key}" }
```

Client uploads the file directly to `uploadUrl` via HTTP PUT, then uses `mediaUrl` as the `mediaUrl` field when creating a post.

### `mediaService.getUploadUrl(contentType)`
Uses `@aws-sdk/s3-request-presigner` with `PutObjectCommand`. Returns `{ uploadUrl, mediaUrl }`.

---

## Section 2: Posts API

All routes protected (Clerk auth required). `socialAccountId` ownership verified before every operation — return `404` if the account doesn't belong to the authenticated user (don't reveal existence).

### `POST /posts`
**Body:** `{ socialAccountId, caption, mediaUrl?, scheduledAt }` — `mediaUrl` is optional; caption-only posts are valid.

1. Validate `scheduledAt` is in the future — `400` if not.
2. Verify `socialAccountId` belongs to the authenticated user — `404` if not.
3. `prisma.scheduledPost.create({ data: { socialAccountId, caption, mediaUrl, scheduledAt, status: 'SCHEDULED' } })` → get `post`.
4. `scheduleService.createJob(post.id, scheduledAt)` → get `bullJobId`.
5. `prisma.scheduledPost.update({ where: { id: post.id }, data: { bullJobId } })`.
6. Return `201` with created post (including `bullJobId`).

### `GET /posts?socialAccountId=...`
1. Verify `socialAccountId` belongs to authenticated user — `404` if not.
2. `prisma.scheduledPost.findMany({ where: { socialAccountId }, orderBy: { scheduledAt: 'desc' } })`.
3. Return array (all statuses included).

### `PATCH /posts/:id`
**Body:** any subset of `{ caption, mediaUrl, scheduledAt }`

1. `prisma.scheduledPost.findFirst({ where: { id, userId } })` — `404` if not found.
2. If `status === 'PUBLISHED'` → `400 { error: 'Cannot edit a published post' }`.
3. If `scheduledAt` provided: validate it is in the future — `400` if not.
4. Build update data from provided fields.
5. If `scheduledAt` changed: `scheduleService.rescheduleJob(post.bullJobId, scheduledAt)` → get new `bullJobId`, add to update data.
6. `prisma.scheduledPost.update(...)`.
7. Return updated post.

### `DELETE /posts/:id`
1. `prisma.scheduledPost.findFirst({ where: { id, userId } })` — `404` if not found.
2. `scheduleService.cancelJob(post.bullJobId)` (no-op if job already fired).
3. `prisma.scheduledPost.delete({ where: { id } })`.
4. Return `204`.

---

## Section 3: scheduleService

**File:** `src/services/scheduleService.js`

```
createJob(postId, scheduledAt)            → bullJobId (string)
rescheduleJob(bullJobId, scheduledAt)     → new bullJobId (string)
cancelJob(bullJobId)                      → void
```

- `createJob`: enqueues a BullMQ delayed job with payload `{ postId }` and delay = `scheduledAt - Date.now()` ms. Returns the BullMQ job ID.
- `rescheduleJob`: calls `queue.getJob(bullJobId)` → removes it if found, then calls `createJob`.
- `cancelJob`: calls `queue.getJob(bullJobId)` → calls `job.remove()` if found. Silently no-ops if job is missing (already fired or never existed).

---

## Section 4: postWorker

**File:** `src/workers/postWorker.js`
**Queue:** `post.publish` (`src/queues/postQueue.js`)
**Concurrency:** 5
**BullMQ retry policy:** 3 attempts, exponential backoff

Job payload: `{ postId }`

Processor:
1. Load `ScheduledPost` + `SocialAccount` from DB. If not found or `status !== 'SCHEDULED'` → return (skip silently — post was cancelled).
2. Get valid token: `metaService.getValidToken(socialAccount, prisma)`.
3. Detect media type by `mediaUrl` extension: `.mp4`, `.mov` → video (Reels); everything else → image.
4. **Image flow:**
   - `POST /v21.0/{instagramAccountId}/media` with `{ image_url: mediaUrl, caption }` → `containerId`
   - `POST /v21.0/{instagramAccountId}/media_publish` with `{ creation_id: containerId }` → `mediaId`
5. **Video (Reels) flow:**
   - `POST /v21.0/{instagramAccountId}/media` with `{ video_url: mediaUrl, media_type: 'REELS', caption }` → `containerId`
   - Poll `GET /v21.0/{containerId}?fields=status_code` every 5 seconds, up to 10 attempts, until `status_code === 'FINISHED'`. If not finished after 10 attempts → throw `Error('Video processing timed out')`.
   - `POST /v21.0/{instagramAccountId}/media_publish` with `{ creation_id: containerId }` → `mediaId`
6. On success: `prisma.scheduledPost.update({ status: 'PUBLISHED' })`. Log `info` with `postId`, `mediaId`.
7. On failure: `prisma.scheduledPost.update({ status: 'FAILED', errorMessage: err.message })`. Log `error`. Re-throw so BullMQ retries.

All Meta Graph API calls go through `metaService` helpers added in Phase 3 (`publishImage`, `createVideoContainer`, `getContainerStatus`, `publishContainer`).

---

## Section 5: Error Handling

| Scenario | Behaviour |
|---|---|
| `scheduledAt` in the past | `400 { error: 'scheduledAt must be in the future' }` |
| `socialAccountId` belongs to different user | `404` |
| `PATCH` on published post | `400 { error: 'Cannot edit a published post' }` |
| `DELETE`/`PATCH` another user's post | `404` |
| Meta API publish fails | `status: FAILED`, `errorMessage` stored, BullMQ retries 3× with exponential backoff |
| Video container polling times out | Throw → job fails → BullMQ retries |
| S3 presigned URL generation fails | `500` |

---

## Section 6: Testing

**`src/modules/posts/posts.test.js`**
- `POST /posts` without auth → `401`
- `POST /posts` with `scheduledAt` in the past → `400`
- `POST /posts` valid → row created, BullMQ job enqueued, `bullJobId` stored, `201`
- `GET /posts` → array returned for own account
- `GET /posts` another user's account → `404`
- `PATCH /posts/:id` caption only → updated, BullMQ job unchanged
- `PATCH /posts/:id` with new `scheduledAt` → old job cancelled, new job created, `bullJobId` updated
- `PATCH /posts/:id` on published post → `400`
- `PATCH /posts/:id` another user's post → `404`
- `DELETE /posts/:id` → job cancelled, row deleted, `204`
- `DELETE /posts/:id` another user's post → `404`

**`src/workers/postWorker.test.js`**
- Image flow → `status: PUBLISHED`, correct Meta API calls made
- Video flow → polls container, publishes on `FINISHED`, `status: PUBLISHED`
- Video polling times out → throws, `status: FAILED`
- Post not found → skipped (no DB update, no Meta call)
- Post already `PUBLISHED`/`FAILED` → skipped
- Meta API failure → `status: FAILED`, error re-thrown for BullMQ retry

**`src/services/scheduleService.test.js`**
- `createJob` → job enqueued with correct delay
- `rescheduleJob` → old job removed, new job created
- `cancelJob` → job removed
- `cancelJob` with unknown jobId → no-op, no error

All BullMQ queue/worker calls and Meta API calls mocked with `vi.fn()`.
