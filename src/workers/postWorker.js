import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

function isVideo(mediaUrl) {
  return mediaUrl ? /\.(mp4|mov)$/i.test(mediaUrl) : false
}

async function pollContainer(containerId, accessToken, intervalMs, attempt = 0) {
  const status = await metaService.getContainerStatus(containerId, accessToken)
  if (status === 'FINISHED') return
  if (status === 'ERROR') throw new Error('Video container processing failed')
  if (attempt >= 9) throw new Error('Video processing timed out')

  await new Promise((r) => setTimeout(r, intervalMs))
  return pollContainer(containerId, accessToken, intervalMs, attempt + 1)
}

export async function publishPost(job, prisma, log, { pollIntervalMs = 5000 } = {}) {
  const { postId } = job.data

  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { socialAccount: true },
  })

  if (!post) {
    log.warn({ postId }, 'scheduledPost not found, skipping')
    return
  }
  if (post.status !== 'SCHEDULED') {
    log.warn({ postId, status: post.status }, 'scheduledPost not in SCHEDULED state, skipping')
    return
  }

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

    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'PUBLISHED', instagramMediaId: mediaId },
    })
    log.info({ postId, mediaId }, 'post published')
  } catch (err) {
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'FAILED', errorMessage: err.message },
    })
    log.error({ postId, jobId: job.id, err: err.message, attempt: job.attemptsMade }, 'post publish failed')
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
