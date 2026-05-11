import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/metaService.js', () => ({
  getUserProfile: vi.fn(),
  sendDm: vi.fn(),
  replyToComment: vi.fn(),
  replyInThread: vi.fn(),
}))

const mockWorkerOn = vi.fn()
const mockWorkerClose = vi.fn().mockResolvedValue(undefined)
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: mockWorkerOn,
    close: mockWorkerClose,
  })),
}))

const metaService = await import('../services/metaService.js')
const { Worker } = await import('bullmq')
const { executeAutomation, createAutomationWorker } = await import('./automationWorker.js')

const mockRuleExecutionUpsert = vi.fn().mockResolvedValue({})
const mockRuleExecutionLogCreate = vi.fn().mockResolvedValue({})
const mockSocialAccountFindUnique = vi.fn()

const prisma = {
  socialAccount: { findUnique: mockSocialAccountFindUnique },
  ruleExecution: { upsert: mockRuleExecutionUpsert },
  ruleExecutionLog: { create: mockRuleExecutionLogCreate },
}
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const baseJobData = {
  ruleId: 'rule-1',
  actionType: 'SEND_DM',
  instagramUserId: 'ig-user-1',
  socialAccountId: 'acc-1',
  messageTemplate: 'Hey {{first_name}}!',
  commentId: undefined,
  threadId: undefined,
}
const baseJob = { id: 'job-1', attemptsMade: 0, data: baseJobData }

beforeEach(() => {
  vi.clearAllMocks()
  mockSocialAccountFindUnique.mockResolvedValue({ id: 'acc-1', accessToken: 'token-abc' })
  metaService.getUserProfile.mockResolvedValue({ name: 'Jane Doe', first_name: 'Jane' })
  mockRuleExecutionUpsert.mockResolvedValue({})
  mockRuleExecutionLogCreate.mockResolvedValue({})
})

describe('executeAutomation', () => {
  it('SEND_DM: calls sendDm with substituted template, upserts RuleExecution, logs EXECUTED', async () => {
    metaService.sendDm.mockResolvedValueOnce({})
    await executeAutomation(baseJob, prisma, log)
    expect(metaService.sendDm).toHaveBeenCalledWith('ig-user-1', 'Hey Jane!', 'token-abc')
    expect(mockRuleExecutionUpsert).toHaveBeenCalledWith({
      where: { ruleId_instagramUserId: { ruleId: 'rule-1', instagramUserId: 'ig-user-1' } },
      create: { ruleId: 'rule-1', instagramUserId: 'ig-user-1' },
      update: {},
    })
    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'EXECUTED' }) }),
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1', actionType: 'SEND_DM' }),
      'automation job completed',
    )
  })

  it('REPLY_COMMENT: calls replyToComment with commentId', async () => {
    const job = { ...baseJob, data: { ...baseJobData, actionType: 'REPLY_COMMENT', commentId: 'comment-abc' } }
    metaService.replyToComment.mockResolvedValueOnce({})
    await executeAutomation(job, prisma, log)
    expect(metaService.replyToComment).toHaveBeenCalledWith('comment-abc', 'Hey Jane!', 'token-abc')
    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'EXECUTED' }) }),
    )
  })

  it('REPLY_DM: calls replyInThread with threadId', async () => {
    const job = { ...baseJob, data: { ...baseJobData, actionType: 'REPLY_DM', threadId: 'thread-1' } }
    metaService.replyInThread.mockResolvedValueOnce({})
    await executeAutomation(job, prisma, log)
    expect(metaService.replyInThread).toHaveBeenCalledWith('thread-1', 'Hey Jane!', 'token-abc')
  })

  it('{{first_name}} is substituted correctly', async () => {
    metaService.getUserProfile.mockResolvedValueOnce({ name: 'Bob Smith', first_name: 'Bob' })
    metaService.sendDm.mockResolvedValueOnce({})
    const job = { ...baseJob, data: { ...baseJobData, messageTemplate: 'Hi {{first_name}}, claim your reward!' } }
    await executeAutomation(job, prisma, log)
    expect(metaService.sendDm).toHaveBeenCalledWith('ig-user-1', 'Hi Bob, claim your reward!', 'token-abc')
  })

  it('4xx Meta error: writes FAILED log and resolves without rethrowing', async () => {
    const err = Object.assign(new Error('User blocked'), { status: 403 })
    metaService.sendDm.mockRejectedValueOnce(err)
    await expect(executeAutomation(baseJob, prisma, log)).resolves.toBeUndefined()
    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'FAILED', errorMessage: 'User blocked' }),
      }),
    )
    expect(mockRuleExecutionUpsert).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1', err: 'User blocked' }),
      'automation job failed (4xx)',
    )
  })

  it('5xx Meta error: rethrows so BullMQ retries', async () => {
    const err = Object.assign(new Error('Internal server error'), { status: 500 })
    metaService.sendDm.mockRejectedValueOnce(err)
    await expect(executeAutomation(baseJob, prisma, log)).rejects.toThrow('Internal server error')
    expect(mockRuleExecutionLogCreate).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1', err: 'Internal server error' }),
      'automation job failed',
    )
  })
})

describe('createAutomationWorker failed event handler', () => {
  it('writes FAILED log after all retries exhausted', async () => {
    const failedHandlers = []
    mockWorkerOn.mockImplementation((event, fn) => {
      if (event === 'failed') failedHandlers.push(fn)
    })

    const connection = {}
    createAutomationWorker(connection, prisma, log)

    const failedJob = {
      id: 'job-exhaust',
      data: { ...baseJobData, ruleId: 'rule-1', instagramUserId: 'ig-user-1' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    }
    const err = new Error('Server down')
    await failedHandlers[0](failedJob, err)

    expect(mockRuleExecutionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'FAILED', errorMessage: 'Server down' }),
      }),
    )
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'rule-1' }),
      'automation job exhausted retries',
    )
  })

  it('skips writing log when retries not yet exhausted', async () => {
    const failedHandlers = []
    mockWorkerOn.mockImplementation((event, fn) => {
      if (event === 'failed') failedHandlers.push(fn)
    })

    createAutomationWorker({}, prisma, log)

    const failedJob = {
      id: 'job-retry',
      data: baseJobData,
      attemptsMade: 1,
      opts: { attempts: 3 },
    }
    await failedHandlers[0](failedJob, new Error('Temporary'))
    expect(mockRuleExecutionLogCreate).not.toHaveBeenCalled()
  })
})
