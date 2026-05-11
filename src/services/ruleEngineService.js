function matchesKeyword(text, keyword, matchType) {
  const t = text.toLowerCase()
  const k = keyword.toLowerCase()
  if (matchType === 'CONTAINS') return t.includes(k)
  if (matchType === 'EXACT') return t.trim() === k.trim()
  if (matchType === 'STARTS_WITH') return t.startsWith(k)
  return false
}

export function createRuleEngineService(queue, prisma, log) {
  async function evaluate(event) {
    const { socialAccountId, text } = event
    const instagramUserId = event.type === 'COMMENT' ? event.commenterId : event.senderId

    const where = {
      socialAccountId,
      isActive: true,
      triggerType: event.type === 'COMMENT' ? 'COMMENT_KEYWORD' : 'DM_KEYWORD',
    }
    if (event.type === 'COMMENT') {
      where.OR = [{ postId: null }, { postId: event.postId }]
    }

    const rules = await prisma.automationRule.findMany({ where })
    const matched = rules.filter((r) => matchesKeyword(text, r.triggerKeyword, r.matchType))

    const passing = (
      await Promise.all(
        matched.map(async (rule) => {
          const windowStart = new Date(Date.now() - rule.cooldownMinutes * 60 * 1000)

          const [existing, recent] = await Promise.all([
            rule.replyOncePerUser
              ? prisma.ruleExecution.findUnique({
                  where: { ruleId_instagramUserId: { ruleId: rule.id, instagramUserId } },
                })
              : Promise.resolve(null),
            prisma.ruleExecutionLog.findFirst({
              where: { ruleId: rule.id, instagramUserId, createdAt: { gte: windowStart } },
              orderBy: { createdAt: 'desc' },
            }),
          ])

          if (existing) {
            await prisma.ruleExecutionLog.create({
              data: { ruleId: rule.id, instagramUserId, triggerPayload: event, outcome: 'SKIPPED_ONCE_PER_USER' },
            })
            log.warn({ ruleId: rule.id, instagramUserId }, 'skipped: once per user')
            return null
          }

          if (recent) {
            await prisma.ruleExecutionLog.create({
              data: { ruleId: rule.id, instagramUserId, triggerPayload: event, outcome: 'SKIPPED_COOLDOWN' },
            })
            log.warn({ ruleId: rule.id, instagramUserId }, 'skipped: cooldown')
            return null
          }

          return rule
        }),
      )
    ).filter(Boolean)

    await Promise.all(
      passing.map((rule) =>
        queue.add('execute', {
          ruleId: rule.id,
          actionType: rule.actionType,
          instagramUserId,
          socialAccountId,
          messageTemplate: rule.messageTemplate,
          commentId: event.commentId,
          threadId: event.threadId,
        }),
      ),
    )

    log.debug({ socialAccountId, matched: matched.length, enqueued: passing.length }, 'rule evaluation complete')
  }

  return { evaluate }
}
