import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

async function prismaPlugin(fastify) {
  const prisma = new PrismaClient()
  await prisma.$connect()

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(prismaPlugin, { name: 'prisma' })
