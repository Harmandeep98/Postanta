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

    instance.get('/webhooks/meta', {
      schema: {
        tags: ['Webhooks'],
        summary: 'Meta webhook challenge verification (called by Meta, not you)',
        querystring: {
          type: 'object',
          properties: {
            'hub.mode': { type: 'string' },
            'hub.verify_token': { type: 'string' },
            'hub.challenge': { type: 'string' },
          },
        },
      },
    }, async (request, reply) => {
      const mode = request.query['hub.mode']
      const token = request.query['hub.verify_token']
      const challenge = request.query['hub.challenge']
      if (mode === 'subscribe' && token === config.META_WEBHOOK_SECRET) {
        return reply.code(200).send(challenge)
      }
      return reply.code(403).send({ error: 'Forbidden' })
    })

    instance.post('/webhooks/meta', {
      schema: {
        tags: ['Webhooks'],
        summary: 'Receive Meta comment/DM events (called by Meta, not you)',
        description: 'Requires valid X-Hub-Signature-256 header. Returns 200 immediately — processing is fire-and-forget.',
      },
    }, async (request, reply) => {
      const sig = request.headers['x-hub-signature-256']
      const expected =
        'sha256=' +
        crypto
          .createHmac('sha256', config.META_WEBHOOK_SECRET)
          .update(request.body)
          .digest('hex')
      const sigBuf = Buffer.from(sig ?? '', 'utf8')
      const expectedBuf = Buffer.from(expected, 'utf8')
      if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      let payload
      try {
        payload = JSON.parse(request.body)
      } catch {
        request.log.warn({ bodyBytes: request.body?.length }, 'webhook payload is not valid JSON')
        return reply.code(400).send({ error: 'Bad Request' })
      }

      request.log.info(
        { bodyBytes: request.body.length, entryCount: payload.entry?.length ?? 0 },
        'webhook received',
      )

      Promise.all(
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
      ).catch((err) => fastify.log.error({ err }, 'webhook processing error'))

      return reply.code(200).send()
    })
  })
}
