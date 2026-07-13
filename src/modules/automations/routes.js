export default async function automationRoutes(fastify) {
  fastify.post('/automations', {
    schema: {
      tags: ['Automations'],
      summary: 'Create an automation rule',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          socialAccountId: { type: 'string' },
          triggerType: { type: 'string', enum: ['COMMENT_KEYWORD', 'DM_KEYWORD'] },
          triggerKeyword: { type: 'string', description: 'Word or phrase to match' },
          matchType: { type: 'string', enum: ['CONTAINS', 'EXACT', 'STARTS_WITH'] },
          actionType: { type: 'string', enum: ['SEND_DM', 'REPLY_COMMENT', 'REPLY_DM'] },
          messageTemplate: { type: 'string', description: 'Supports {{first_name}} placeholder' },
          postId: { type: 'string', nullable: true, description: 'null = apply to all posts' },
          replyOncePerUser: { type: 'boolean', default: true },
          cooldownMinutes: { type: 'integer', default: 60 },
          isActive: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const {
      socialAccountId,
      triggerType,
      triggerKeyword,
      matchType,
      actionType,
      messageTemplate,
      postId,
      replyOncePerUser = true,
      cooldownMinutes = 60,
      isActive = true,
    } = request.body

    if (!socialAccountId || !triggerType || !triggerKeyword || !matchType || !actionType || !messageTemplate) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    if (actionType === 'REPLY_COMMENT' && triggerType !== 'COMMENT_KEYWORD') {
      return reply.code(400).send({ error: 'REPLY_COMMENT requires triggerType COMMENT_KEYWORD' })
    }
    if (actionType === 'REPLY_DM' && triggerType !== 'DM_KEYWORD') {
      return reply.code(400).send({ error: 'REPLY_DM requires triggerType DM_KEYWORD' })
    }

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const rule = await fastify.prisma.automationRule.create({
      data: {
        socialAccountId,
        triggerType,
        triggerKeyword,
        matchType,
        actionType,
        messageTemplate,
        postId: triggerType === 'DM_KEYWORD' ? null : (postId ?? null),
        replyOncePerUser,
        cooldownMinutes,
        isActive,
      },
    })
    return reply.code(201).send(rule)
  })

  fastify.get('/automations', {
    schema: {
      tags: ['Automations'],
      summary: 'List automation rules for an account',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['socialAccountId'],
        properties: { socialAccountId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { socialAccountId } = request.query
    if (!socialAccountId) return reply.code(400).send({ error: 'socialAccountId is required' })

    const account = await fastify.prisma.socialAccount.findFirst({
      where: { id: socialAccountId, user: { clerkId: request.auth.userId } },
    })
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    return fastify.prisma.automationRule.findMany({
      where: { socialAccountId },
      orderBy: { createdAt: 'desc' },
    })
  })

  fastify.get('/automations/:id', {
    schema: {
      tags: ['Automations'],
      summary: 'Get a single automation rule',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const rule = await fastify.prisma.automationRule.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!rule) return reply.code(404).send({ error: 'Rule not found' })
    return rule
  })

  fastify.patch('/automations/:id', {
    schema: {
      tags: ['Automations'],
      summary: 'Update an automation rule',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          triggerType: { type: 'string', enum: ['COMMENT_KEYWORD', 'DM_KEYWORD'] },
          triggerKeyword: { type: 'string' },
          matchType: { type: 'string', enum: ['CONTAINS', 'EXACT', 'STARTS_WITH'] },
          actionType: { type: 'string', enum: ['SEND_DM', 'REPLY_COMMENT', 'REPLY_DM'] },
          messageTemplate: { type: 'string' },
          postId: { type: 'string', nullable: true },
          replyOncePerUser: { type: 'boolean' },
          cooldownMinutes: { type: 'integer' },
          isActive: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const rule = await fastify.prisma.automationRule.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!rule) return reply.code(404).send({ error: 'Rule not found' })

    const { triggerType, actionType, triggerKeyword, matchType, messageTemplate, postId, replyOncePerUser, cooldownMinutes, isActive } = request.body ?? {}

    const finalTriggerType = triggerType ?? rule.triggerType
    const finalActionType = actionType ?? rule.actionType

    if (finalActionType === 'REPLY_COMMENT' && finalTriggerType !== 'COMMENT_KEYWORD') {
      return reply.code(400).send({ error: 'REPLY_COMMENT requires triggerType COMMENT_KEYWORD' })
    }
    if (finalActionType === 'REPLY_DM' && finalTriggerType !== 'DM_KEYWORD') {
      return reply.code(400).send({ error: 'REPLY_DM requires triggerType DM_KEYWORD' })
    }

    const updateData = {}
    if (triggerType !== undefined) updateData.triggerType = triggerType
    if (triggerKeyword !== undefined) updateData.triggerKeyword = triggerKeyword
    if (matchType !== undefined) updateData.matchType = matchType
    if (actionType !== undefined) updateData.actionType = actionType
    if (messageTemplate !== undefined) updateData.messageTemplate = messageTemplate
    if (replyOncePerUser !== undefined) updateData.replyOncePerUser = replyOncePerUser
    if (cooldownMinutes !== undefined) updateData.cooldownMinutes = cooldownMinutes
    if (isActive !== undefined) updateData.isActive = isActive
    if (postId !== undefined) updateData.postId = finalTriggerType === 'DM_KEYWORD' ? null : postId
    if (triggerType === 'DM_KEYWORD') updateData.postId = null

    return fastify.prisma.automationRule.update({ where: { id: rule.id }, data: updateData })
  })

  fastify.delete('/automations/:id', {
    schema: {
      tags: ['Automations'],
      summary: 'Delete an automation rule',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const rule = await fastify.prisma.automationRule.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!rule) return reply.code(404).send({ error: 'Rule not found' })
    await fastify.prisma.automationRule.delete({ where: { id: rule.id } })
    return reply.code(204).send()
  })
}
