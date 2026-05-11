import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRuleEngineService } from './ruleEngineService.js'

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
const queue = { add: mockQueueAdd }

const mockFindMany = vi.fn()
const mockRuleExecutionFindUnique = vi.fn()
const mockRuleExecutionLogFindFirst = vi.fn()
const mockRuleExecutionLogCreate = vi.fn().mockResolvedValue({})

const prisma = {
  automationRule: { findMany: mockFindMany },
  ruleExecution: { findUnique: mockRuleExecutionFindUnique },
  ruleExecutionLog: { findFirst: mockRuleExecutionLogFindFirst, create: mockRuleExecutionLogCreate },
}
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
const service = createRuleEngineService(queue, prisma, log)

const baseRule = {
  id: 'rule-1',
  socialAccountId: 'acc-1',
  triggerType: 'COMMENT_KEYWORD',
  triggerKeyword: 'promo',
  matchType: 'CONTAINS',
  actionType: 'SEND_DM',
  messageTemplate: 'Hey {{first_name}}!',
  postId: null,
  replyOncePerUser: false,
  cooldownMinutes: 60,
  isActive: true,
}

const commentEvent = {
  type: 'COMMENT',
  socialAccountId: 'acc-1',
  commenterId: 'ig-user-1',
  text: 'I love this promo!',
  postId: 'post-123',
  commentId: 'comment-abc',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRuleExecutionLogCreate.mockResolvedValue({})
})

describe('keyword matching', () => {
  it('CONTAINS: matches keyword anywhere in text (case-insensitive)', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'CONTAINS', triggerKeyword: 'PROMO' }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).toHaveBeenCalledOnce()
  })

  it('CONTAINS: does not match when keyword is absent', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'CONTAINS', triggerKeyword: 'sale' }])
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('EXACT: matches when trimmed text equals keyword (case-insensitive)', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'EXACT', triggerKeyword: 'promo' }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate({ ...commentEvent, text: '  Promo  ' })
    expect(mockQueueAdd).toHaveBeenCalledOnce()
  })

  it('EXACT: does not match when text contains extra words', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'EXACT', triggerKeyword: 'promo' }])
    await service.evaluate(commentEvent) // "I love this promo!"
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('STARTS_WITH: matches when text begins with keyword (case-insensitive)', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'STARTS_WITH', triggerKeyword: 'i love' }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).toHaveBeenCalledOnce()
  })

  it('STARTS_WITH: does not match when text does not start with keyword', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, matchType: 'STARTS_WITH', triggerKeyword: 'promo' }])
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

describe('replyOncePerUser', () => {
  it('skips and logs SKIPPED_ONCE_PER_USER when RuleExecution row exists', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, replyOncePerUser: true }])
    mockRuleExecutionFindUnique.mockResolvedValueOnce({ id: 'exec-1' })
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'SKIPPED_ONCE_PER_USER' }) }),
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1' }),
      'skipped: once per user',
    )
  })

  it('does not query RuleExecution when replyOncePerUser is false', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, replyOncePerUser: false }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate(commentEvent)
    expect(mockRuleExecutionFindUnique).not.toHaveBeenCalled()
    expect(mockQueueAdd).toHaveBeenCalledOnce()
  })
})

describe('cooldown', () => {
  it('skips and logs SKIPPED_COOLDOWN when a recent log exists within window', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, replyOncePerUser: false, cooldownMinutes: 60 }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce({ id: 'log-1', createdAt: new Date() })
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'SKIPPED_COOLDOWN' }) }),
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1' }),
      'skipped: cooldown',
    )
  })

  it('enqueues when no recent log within cooldown window', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...baseRule, replyOncePerUser: false, cooldownMinutes: 60 }])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).toHaveBeenCalledOnce()
    expect(mockQueueAdd).toHaveBeenCalledWith('execute', expect.objectContaining({
      ruleId: 'rule-1',
      actionType: 'SEND_DM',
      instagramUserId: 'ig-user-1',
      socialAccountId: 'acc-1',
      commentId: 'comment-abc',
    }))
    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({ socialAccountId: 'acc-1', enqueued: 1 }),
      'rule evaluation complete',
    )
  })
})

describe('multiple rules', () => {
  it('enqueues all passing rules concurrently', async () => {
    const rule2 = { ...baseRule, id: 'rule-2', actionType: 'REPLY_COMMENT' }
    mockFindMany.mockResolvedValueOnce([baseRule, rule2])
    mockRuleExecutionLogFindFirst.mockResolvedValue(null)
    await service.evaluate(commentEvent)
    expect(mockQueueAdd).toHaveBeenCalledTimes(2)
  })
})

describe('DM events', () => {
  it('uses senderId as instagramUserId and passes threadId in payload', async () => {
    const dmRule = { ...baseRule, triggerType: 'DM_KEYWORD', actionType: 'REPLY_DM', triggerKeyword: 'info' }
    mockFindMany.mockResolvedValueOnce([dmRule])
    mockRuleExecutionLogFindFirst.mockResolvedValueOnce(null)
    const dmEvent = {
      type: 'DM',
      socialAccountId: 'acc-1',
      senderId: 'sender-1',
      text: 'info',
      threadId: 'thread-1',
    }
    await service.evaluate(dmEvent)
    expect(mockQueueAdd).toHaveBeenCalledWith('execute', expect.objectContaining({
      instagramUserId: 'sender-1',
      threadId: 'thread-1',
    }))
  })
})
