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
