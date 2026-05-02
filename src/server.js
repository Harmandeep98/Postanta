import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import prismaPlugin from './plugins/prisma.js'
import redisPlugin from './plugins/redis.js'
import clerkPlugin from './plugins/clerk.js'
import healthRoutes from './modules/health/routes.js'

export async function build(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger ?? {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    ...opts,
  })

  await fastify.register(cors)
  await fastify.register(prismaPlugin)
  await fastify.register(redisPlugin)

  // Unprotected routes — no auth required
  await fastify.register(healthRoutes)

  // Protected scope — clerk onRequest hook applies only inside this child scope
  await fastify.register(async (protectedApp) => {
    await protectedApp.register(clerkPlugin)
    // Future authenticated modules register here
  })

  return fastify
}

export async function start() {
  const fastify = await build()
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
