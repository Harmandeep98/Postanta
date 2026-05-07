export default async function accountRoutes(fastify) {
  fastify.get('/accounts', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { clerkId: request.auth.userId },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const accounts = await fastify.prisma.socialAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        instagramAccountId: true,
        instagramUsername: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    })

    return accounts
  })

  fastify.delete('/accounts/:id', async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { clerkId: request.auth.userId },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: request.params.id, userId: user.id },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    await fastify.prisma.socialAccount.delete({ where: { id: request.params.id } })
    return reply.code(204).send()
  })
}
