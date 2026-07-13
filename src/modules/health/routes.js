export default async function healthRoutes(fastify) {
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
      return {
        status: 'ok',
        uptime: process.uptime(),
        queues: { pending: 0, active: 0, failed: 0 },
      }
    },
  )
}
