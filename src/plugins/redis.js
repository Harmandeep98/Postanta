import fp from 'fastify-plugin'
import Redis from 'ioredis'
import { config } from '../config.js'

async function redisPlugin(fastify) {
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
  })

  const redisWorker = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  })

  await redis.connect()
  await redisWorker.connect()

  fastify.decorate('redis', redis)
  fastify.decorate('redisWorker', redisWorker)

  fastify.addHook('onClose', async () => {
    await redis.quit()
    await redisWorker.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
