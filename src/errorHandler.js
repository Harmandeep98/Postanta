// Fastify's default handler echoes err.message straight to the client — fine for
// deliberate 4xx responses (route code already crafted those to be safe), but for
// anything unhandled (Prisma, Meta Graph API, network errors) that leaks internals.
// One handler here beats a try/catch in every route that calls an external service.
export function registerErrorHandler(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'unhandled error')

    const statusCode = error.statusCode ?? 500
    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: error.message })
    }
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' })
  })
}
