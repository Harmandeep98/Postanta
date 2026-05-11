import crypto from 'crypto'
import { config } from '../../config.js'
import { createAutomationQueue } from '../../queues/automationQueue.js'
import { createRuleEngineService } from '../../services/ruleEngineService.js'

export default async function webhookRoutes(fastify) {
  const queue = createAutomationQueue(fastify.redis)
  const ruleEngineService = createRuleEngineService(queue, fastify.prisma, fastify.log)

  fastify.addHook('onClose', async () => {
    await queue.close()
  })

  fastify.register(async function rawScope(instance) {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    )

    instance.get('/webhooks/meta', async (request, reply) => {
      const mode = request.query['hub.mode']
      const token = request.query['hub.verify_token']
      const challenge = request.query['hub.challenge']
      if (mode === 'subscribe' && token === config.META_WEBHOOK_SECRET) {
        return reply.code(200).send(challenge)
      }
      return reply.code(403).send({ error: 'Forbidden' })
    })

    instance.post('/webhooks/meta', async (request, reply) => {
      const sig = request.headers['x-hub-signature-256']
      const expected =
        'sha256=' +
        crypto
          .createHmac('sha256', config.META_WEBHOOK_SECRET)
          .update(request.body)
          .digest('hex')
      if (sig !== expected) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const payload = JSON.parse(request.body)

      await Promise.all(
        (payload.entry ?? []).map(async (entry) => {
          const account = await instance.prisma.socialAccount.findFirst({
            where: { instagramAccountId: entry.id },
          })
          if (!account) return

          const events = []

          for (const change of entry.changes ?? []) {
            if (change.field === 'comments' && change.value?.from?.id) {
              events.push({
                type: 'COMMENT',
                socialAccountId: account.id,
                commenterId: change.value.from.id,
                text: change.value.text ?? '',
                postId: change.value.media?.id,
                commentId: change.value.id,
              })
            }
          }

          for (const msg of entry.messaging ?? []) {
            if (msg.message?.text) {
              events.push({
                type: 'DM',
                socialAccountId: account.id,
                senderId: msg.sender.id,
                text: msg.message.text,
                threadId: msg.sender.id,
              })
            }
          }

          await Promise.all(events.map((e) => ruleEngineService.evaluate(e)))
        }),
      )

      return reply.code(200).send()
    })
  })
}
