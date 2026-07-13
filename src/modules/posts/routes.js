import { createPostQueue } from '../../queues/postQueue.js'
import { createScheduleService } from '../../services/scheduleService.js'
import * as mediaService from '../../services/mediaService.js'

export default async function postRoutes(fastify) {
  const queue = createPostQueue(fastify.redis)
  const scheduleService = createScheduleService(queue)

  fastify.addHook('onClose', async () => {
    await queue.close()
  })

  fastify.get('/media/upload-url', {
    schema: {
      tags: ['Media'],
      summary: 'Get S3 presigned upload URL',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['contentType'],
        properties: {
          contentType: { type: 'string', description: 'MIME type of the file to upload (e.g. image/jpeg, video/mp4)' },
        },
      },
    },
  }, async (request, reply) => {
    const { contentType } = request.query
    if (!contentType) return reply.code(400).send({ error: 'contentType is required' })
    try {
      return await mediaService.getUploadUrl(contentType)
    } catch (err) {
      if (err.message.startsWith('Unsupported content type')) {
        return reply.code(400).send({ error: err.message })
      }
      return reply.code(500).send({ error: 'Failed to generate upload URL' })
    }
  })

  fastify.post('/posts', {
    schema: {
      tags: ['Posts'],
      summary: 'Schedule a new post',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['socialAccountId', 'scheduledAt'],
        properties: {
          socialAccountId: { type: 'string' },
          caption: { type: 'string' },
          mediaUrl: { type: 'string', description: 'Public URL of the uploaded media' },
          scheduledAt: { type: 'string', format: 'date-time', description: 'Must be in the future' },
        },
      },
    },
  }, async (request, reply) => {
    const { socialAccountId, caption, mediaUrl, scheduledAt } = request.body

    if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
      return reply.code(400).send({ error: 'scheduledAt must be in the future' })
    }

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const post = await fastify.prisma.scheduledPost.create({
      data: { socialAccountId, caption, mediaUrl, scheduledAt: new Date(scheduledAt), status: 'SCHEDULED' },
    })

    let bullJobId
    try {
      bullJobId = await scheduleService.createJob(post.id, scheduledAt)
    } catch {
      await fastify.prisma.scheduledPost.delete({ where: { id: post.id } })
      return reply.code(500).send({ error: 'Failed to schedule post' })
    }

    const updated = await fastify.prisma.scheduledPost.update({
      where: { id: post.id },
      data: { bullJobId },
    })

    return reply.code(201).send(updated)
  })

  fastify.get('/posts', {
    schema: {
      tags: ['Posts'],
      summary: 'List scheduled posts for an account',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['socialAccountId'],
        properties: { socialAccountId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { socialAccountId } = request.query
    if (!socialAccountId) return reply.code(400).send({ error: 'socialAccountId is required' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    return fastify.prisma.scheduledPost.findMany({
      where: { socialAccountId },
      orderBy: { scheduledAt: 'desc' },
    })
  })

  fastify.patch('/posts/:id', {
    schema: {
      tags: ['Posts'],
      summary: 'Edit caption or reschedule a post',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          caption: { type: 'string' },
          mediaUrl: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time', description: 'Must be in the future' },
        },
      },
    },
  }, async (request, reply) => {
    const post = await fastify.prisma.scheduledPost.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
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
      try {
        updateData.bullJobId = await scheduleService.rescheduleJob(post.bullJobId, scheduledAt, post.id)
      } catch (err) {
        await fastify.prisma.scheduledPost.update({
          where: { id: post.id },
          data: { status: 'FAILED', errorMessage: `Reschedule failed: ${err.message}` },
        })
        return reply.code(500).send({ error: 'Failed to reschedule post' })
      }
      updateData.status = 'SCHEDULED'
      updateData.errorMessage = null
    }

    return fastify.prisma.scheduledPost.update({ where: { id: post.id }, data: updateData })
  })

  fastify.delete('/posts/:id', {
    schema: {
      tags: ['Posts'],
      summary: 'Cancel and delete a scheduled post',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const post = await fastify.prisma.scheduledPost.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    await Promise.all([
      scheduleService.cancelJob(post.bullJobId),
      fastify.prisma.scheduledPost.delete({ where: { id: post.id } }),
    ])
    return reply.code(204).send()
  })
}
