import fp from 'fastify-plugin'
import { verifyToken } from '@clerk/backend'
import { config } from '../config.js'

async function clerkPlugin(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const token = authHeader.slice(7)

    try {
      const payload = await verifyToken(token, {
        secretKey: config.CLERK_SECRET_KEY,
      })
      request.auth = { userId: payload.sub, sessionId: payload.sid }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}

export default fp(clerkPlugin, { name: 'clerk' })
