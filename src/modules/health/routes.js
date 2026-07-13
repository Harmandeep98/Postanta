import { createAutomationQueue } from '../../queues/automationQueue.js'
import { createPostQueue } from '../../queues/postQueue.js'
import { createTokenRefreshQueue } from '../../queues/tokenRefreshQueue.js'
import { createQueueStatusService } from '../../services/queueStatusService.js'

export default async function healthRoutes(fastify) {
  const automationQueue = createAutomationQueue(fastify.redis)
  const postQueue = createPostQueue(fastify.redis)
  const tokenRefreshQueue = createTokenRefreshQueue(fastify.redis)
  const queueStatusService = createQueueStatusService({
    automation: automationQueue,
    posts: postQueue,
    tokenRefresh: tokenRefreshQueue,
  })

  fastify.addHook('onClose', async () => {
    await Promise.all([automationQueue.close(), postQueue.close(), tokenRefreshQueue.close()])
  })

  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness check',
        response: {
          200: {
            type: 'object',
            required: ['status', 'uptime', 'queues'],
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              queues: {
                type: 'object',
                properties: {
                  pending: { type: 'number' },
                  active: { type: 'number' },
                  failed: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const counts = await queueStatusService.getAllQueueCounts()
      const queues = { pending: 0, active: 0, failed: 0 }
      for (const queueCounts of Object.values(counts)) {
        queues.pending += (queueCounts.waiting ?? 0) + (queueCounts.delayed ?? 0)
        queues.active += queueCounts.active ?? 0
        queues.failed += queueCounts.failed ?? 0
      }

      return {
        status: 'ok',
        uptime: process.uptime(),
        queues,
      }
    },
  )
}
