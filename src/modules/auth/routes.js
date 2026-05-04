import { Webhook } from 'svix'
import { config } from '../../config.js'
import * as metaService from '../../services/metaService.js'

export async function authPublicRoutes(fastify) {
  // Nested scope so the raw-body parser only applies to the webhook route
  fastify.register(async function webhookScope(instance) {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    )

    instance.post('/webhooks/clerk', async (request, reply) => {
      const svixId = request.headers['svix-id']
      const svixTimestamp = request.headers['svix-timestamp']
      const svixSignature = request.headers['svix-signature']

      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.code(400).send({ error: 'Invalid webhook signature' })
      }

      const wh = new Webhook(config.CLERK_WEBHOOK_SECRET)
      let event
      try {
        event = wh.verify(request.body, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        })
      } catch {
        return reply.code(400).send({ error: 'Invalid webhook signature' })
      }

      const { type, data } = event

      if (type === 'user.created') {
        await instance.prisma.user.create({
          data: {
            clerkId: data.id,
            email: data.email_addresses?.[0]?.email_address ?? '',
          },
        })
      } else if (type === 'user.deleted') {
        await instance.prisma.user.delete({ where: { clerkId: data.id } })
      }

      return { received: true }
    })
  })

  fastify.get('/auth/instagram/callback', async (request, reply) => {
    const { code, state, error } = request.query

    if (error) {
      return reply.redirect(
        `${config.FRONTEND_URL}/connect/error?reason=${encodeURIComponent(error)}`,
      )
    }

    const clerkUserId = await fastify.redis.get(`oauth:state:${state}`)
    if (!clerkUserId) {
      return reply.code(400).send({ error: 'Invalid or expired state' })
    }
    await fastify.redis.del(`oauth:state:${state}`)

    try {
      const user = await fastify.prisma.user.upsert({
        where: { clerkId: clerkUserId },
        create: { clerkId: clerkUserId, email: '' },
        update: {},
      })

      const { accessToken: shortToken } = await metaService.exchangeCodeForShortLivedToken(code)
      const { accessToken: longToken, expiresIn } =
        await metaService.exchangeForLongLivedToken(shortToken)
      const accounts = await metaService.getInstagramAccounts(longToken)
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

      if (accounts.length === 0) {
        return reply.redirect(`${config.FRONTEND_URL}/connect/error?reason=no_instagram_account`)
      }

      const upserted = await Promise.all(
        accounts.map((acc) =>
          fastify.prisma.socialAccount.upsert({
            where: {
              userId_instagramAccountId: {
                userId: user.id,
                instagramAccountId: acc.instagramAccountId,
              },
            },
            create: {
              userId: user.id,
              instagramAccountId: acc.instagramAccountId,
              instagramUsername: acc.username,
              accessToken: longToken,
              tokenExpiresAt,
            },
            update: {
              instagramUsername: acc.username,
              accessToken: longToken,
              tokenExpiresAt,
            },
          }),
        ),
      )

      return reply.redirect(
        `${config.FRONTEND_URL}/connect/success?accountId=${upserted[0].id}`,
      )
    } catch (err) {
      request.log.error({ err: err.message }, 'OAuth callback failed')
      return reply.redirect(`${config.FRONTEND_URL}/connect/error?reason=token_exchange_failed`)
    }
  })
}

export async function authProtectedRoutes(fastify) {
  fastify.get('/auth/instagram', async (request, reply) => {
    const state = crypto.randomUUID()
    await fastify.redis.set(`oauth:state:${state}`, request.auth.userId, 'EX', 600)

    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    url.searchParams.set('client_id', config.META_APP_ID)
    url.searchParams.set('redirect_uri', config.META_REDIRECT_URI)
    url.searchParams.set(
      'scope',
      'instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_messaging,pages_show_list',
    )
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)

    return reply.redirect(url.toString())
  })
}
