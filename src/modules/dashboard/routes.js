import { createAutomationQueue } from '../../queues/automationQueue.js'
import { createPostQueue } from '../../queues/postQueue.js'
import { createTokenRefreshQueue } from '../../queues/tokenRefreshQueue.js'
import { createQueueStatusService } from '../../services/queueStatusService.js'

const OUTCOMES = ['EXECUTED', 'SKIPPED_ONCE_PER_USER', 'SKIPPED_COOLDOWN', 'FAILED']

export default async function dashboardRoutes(fastify) {
  const automationQueue = createAutomationQueue(fastify.redis)
  const postQueue = createPostQueue(fastify.redis)
  const tokenRefreshQueue = createTokenRefreshQueue(fastify.redis)
  const queueStatusService = createQueueStatusService({
    automation: automationQueue,
    posts: postQueue,
    tokenRefresh: tokenRefreshQueue,
  })

  fastify.addHook('onClose', async () => {
    await Promise.all([automationQueue.close(), postQueue.close(), tokenRefreshQueue.close()])
  })

  fastify.get('/dashboard/analytics/rules', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Per-rule trigger outcome breakdown',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['socialAccountId'],
        properties: {
          socialAccountId: { type: 'string' },
          ruleId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const { socialAccountId, ruleId, from, to } = request.query
    if (!socialAccountId) return reply.code(400).send({ error: 'socialAccountId is required' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const [groups, rules] = await Promise.all([
      fastify.prisma.ruleExecutionLog.groupBy({
        by: ['ruleId', 'outcome'],
        where: {
          rule: { socialAccountId },
          ...(ruleId && { ruleId }),
          ...((from || to) && {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        _count: true,
      }),
      fastify.prisma.automationRule.findMany({
        where: { socialAccountId, ...(ruleId && { id: ruleId }) },
        select: { id: true, triggerType: true, triggerKeyword: true, actionType: true, isActive: true },
      }),
    ])

    const countsByRule = new Map()
    for (const group of groups) {
      const counts = countsByRule.get(group.ruleId) ?? {}
      counts[group.outcome] = group._count
      countsByRule.set(group.ruleId, counts)
    }

    const rulesWithCounts = rules.map((rule) => {
      const rawCounts = countsByRule.get(rule.id) ?? {}
      const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, rawCounts[outcome] ?? 0]))
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
      return {
        ruleId: rule.id,
        triggerType: rule.triggerType,
        triggerKeyword: rule.triggerKeyword,
        actionType: rule.actionType,
        isActive: rule.isActive,
        counts,
        total,
      }
    })

    return { socialAccountId, from: from ?? null, to: to ?? null, rules: rulesWithCounts }
  })

  fastify.get('/dashboard/queues', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Live BullMQ job counts per queue',
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    return queueStatusService.getAllQueueCounts()
  })

  fastify.get('/dashboard/rule-logs', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Paginated, filterable rule execution log',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['socialAccountId'],
        properties: {
          socialAccountId: { type: 'string' },
          ruleId: { type: 'string' },
          outcome: { type: 'string', enum: OUTCOMES },
          page: { type: 'string', description: 'Defaults to 1' },
          limit: { type: 'string', description: 'Defaults to 20, max 100' },
        },
      },
    },
  }, async (request, reply) => {
    const { socialAccountId, ruleId, outcome } = request.query
    if (!socialAccountId) return reply.code(400).send({ error: 'socialAccountId is required' })

    const page = request.query.page !== undefined ? Number(request.query.page) : 1
    const limit = request.query.limit !== undefined ? Number(request.query.limit) : 20

    if (!Number.isInteger(page) || page < 1) {
      return reply.code(400).send({ error: 'page must be a positive integer' })
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ error: 'limit must be between 1 and 100' })
    }

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const where = {
      rule: { socialAccountId },
      ...(ruleId && { ruleId }),
      ...(outcome && { outcome }),
    }

    const [logs, total] = await Promise.all([
      fastify.prisma.ruleExecutionLog.findMany({
        where,
        select: {
          id: true,
          ruleId: true,
          instagramUserId: true,
          outcome: true,
          errorMessage: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      fastify.prisma.ruleExecutionLog.count({ where }),
    ])

    return {
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  })
}
