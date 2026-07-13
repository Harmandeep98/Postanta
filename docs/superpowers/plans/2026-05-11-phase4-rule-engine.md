# Phase 4 — Rule Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ManyChat-style rule engine that matches Instagram comment/DM webhook events against user-configured rules and executes automated DMs or replies via the Meta Graph API.

**Architecture:** Webhook events from Meta are HMAC-SHA256 verified in `webhooks/routes.js`, parsed into normalized event objects, and passed to `ruleEngineService.evaluate()` which runs keyword matching + deduplication checks (once-per-user, cooldown) and enqueues passing rules to `automation.queue`. The `automationWorker` (concurrency 10) consumes jobs, fetches the commenter's first name from Meta, renders the message template, calls the appropriate Meta API method, then writes `RuleExecution` (upsert) and `RuleExecutionLog` (append-only).

**Tech Stack:** Fastify, BullMQ, Prisma, Node.js built-in `crypto` (HMAC-SHA256), Meta Graph API v21.0, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/queues/automationQueue.js` | BullMQ queue definition for `automation.queue` |
| Modify | `src/services/metaService.js` | Add `err.status` to `graphFetch`; add `getUserProfile`, `sendDm`, `replyToComment`, `replyInThread` |
| Modify | `src/services/metaService.test.js` | Append tests for the 4 new methods + status attachment |
| Create | `src/services/ruleEngineService.js` | Keyword matching, once-per-user check, cooldown check, BullMQ enqueue |
| Create | `src/services/ruleEngineService.test.js` | Unit tests for all evaluation branches |
| Create | `src/workers/automationWorker.js` | Template substitution, Meta API calls, DB writes, error handling |
| Create | `src/workers/automationWorker.test.js` | Unit tests for all 3 action types + error cases |
| Create | `src/modules/webhooks/routes.js` | GET challenge verification + POST HMAC-verify + event parsing + evaluate call |
| Create | `src/modules/webhooks/webhooks.test.js` | Integration tests via fastify.inject |
| Create | `src/modules/automations/routes.js` | 5 CRUD endpoints for AutomationRule (Clerk-protected) |
| Create | `src/modules/automations/automations.test.js` | Integration tests via fastify.inject |
| Modify | `src/server.js` | Register webhook/automation routes; start automationWorker |

---

## Task 1: automationQueue + metaService extensions

**Files:**
- Create: `src/queues/automationQueue.js`
- Modify: `src/services/metaService.js`
- Modify: `src/services/metaService.test.js`

- [ ] **Step 1: Create automationQueue.js**

```js
// src/queues/automationQueue.js
import { Queue } from 'bullmq'

export function createAutomationQueue(connection) {
  return new Queue('automation.queue', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  })
}
```

- [ ] **Step 2: Modify graphFetch in metaService.js to attach HTTP status to errors**

Find the `graphFetch` function (lines 5–18 of `src/services/metaService.js`). Replace:
```js
    throw new Error(message)
```
with:
```js
    const err = new Error(message)
    err.status = res.status
    throw err
```

Full updated `graphFetch`:
```js
async function graphFetch(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let message = 'Meta API error'
    try {
      const data = await res.json()
      message = data.error?.message ?? message
    } catch {}
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}
```

- [ ] **Step 3: Add 4 new exports to metaService.js**

Append after `publishContainer` (after line 119):
```js
export async function getUserProfile(instagramUserId, accessToken) {
  const url = new URL(`${GRAPH_URL}/${instagramUserId}`)
  url.searchParams.set('fields', 'name')
  url.searchParams.set('access_token', accessToken)
  const data = await graphFetch(url)
  const name = data.name ?? ''
  const first_name = name.split(' ')[0] || 'there'
  return { name, first_name }
}

export async function sendDm(recipientId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/me/messages`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
  })
}

export async function replyToComment(commentId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/${commentId}/replies`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

export async function replyInThread(threadId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/me/messages`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: threadId }, message: { text: message } }),
  })
}
```

- [ ] **Step 4: Add tests to metaService.test.js**

Add `getUserProfile`, `sendDm`, `replyToComment`, `replyInThread` to the import at the top of `src/services/metaService.test.js`:
```js
const {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  getInstagramAccounts,
  getValidToken,
  publishImage,
  createVideoContainer,
  getContainerStatus,
  publishContainer,
  getUserProfile,
  sendDm,
  replyToComment,
  replyInThread,
} = await import('./metaService.js')
```

Append these describe blocks at the end of `src/services/metaService.test.js`:
```js
describe('getUserProfile', () => {
  beforeEach(() => fetchMock.mockReset())

  it('returns name and first_name (first word of name)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: 'Jane Doe' }),
    })
    const result = await getUserProfile('ig-user-123', 'token-abc')
    expect(result).toEqual({ name: 'Jane Doe', first_name: 'Jane' })
    const [url] = fetchMock.mock.calls[0]
    expect(url.toString()).toContain('/ig-user-123')
    expect(url.toString()).toContain('fields=name')
  })

  it('falls back to "there" when name is empty', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: '' }),
    })
    const result = await getUserProfile('ig-user-123', 'token-abc')
    expect(result.first_name).toBe('there')
  })
})

describe('sendDm', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /me/messages with recipient and message body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recipient_id: 'ig-user-123', message_id: 'msg-1' }),
    })
    await sendDm('ig-user-123', 'Hello Jane!', 'token-abc')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(url.toString()).toContain('/me/messages')
    expect(JSON.parse(opts.body)).toEqual({ recipient: { id: 'ig-user-123' }, message: { text: 'Hello Jane!' } })
  })
})

describe('replyToComment', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /{commentId}/replies with message body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'reply-1' }),
    })
    await replyToComment('comment-1', 'Thanks!', 'token-abc')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(url.toString()).toContain('/comment-1/replies')
    expect(JSON.parse(opts.body)).toEqual({ message: 'Thanks!' })
  })
})

describe('replyInThread', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POSTs to /me/messages with threadId as recipient', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recipient_id: 'thread-1', message_id: 'msg-2' }),
    })
    await replyInThread('thread-1', 'Got it!', 'token-abc')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(url.toString()).toContain('/me/messages')
    expect(JSON.parse(opts.body)).toEqual({ recipient: { id: 'thread-1' }, message: { text: 'Got it!' } })
  })
})

describe('graphFetch error status', () => {
  beforeEach(() => fetchMock.mockReset())

  it('attaches HTTP status code to thrown error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: 'User blocked' } }),
    })
    let caught
    try { await getUserProfile('bad', 'token') } catch (err) { caught = err }
    expect(caught.message).toBe('User blocked')
    expect(caught.status).toBe(403)
  })
})
```

- [ ] **Step 5: Run tests to confirm they pass**

```
npm test -- --reporter=verbose src/services/metaService.test.js
```

Expected: all existing tests still pass + 6 new ones pass.

- [ ] **Step 6: Commit**

```
git add src/queues/automationQueue.js src/services/metaService.js src/services/metaService.test.js
git commit -m "feat: add automationQueue and metaService messaging methods"
```

---

## Task 2: ruleEngineService

**Files:**
- Create: `src/services/ruleEngineService.js`
- Create: `src/services/ruleEngineService.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/services/ruleEngineService.test.js`:
```js
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
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test -- --reporter=verbose src/services/ruleEngineService.test.js
```

Expected: FAIL — `Cannot find module './ruleEngineService.js'`

- [ ] **Step 3: Implement ruleEngineService.js**

Create `src/services/ruleEngineService.js`:
```js
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
          if (rule.replyOncePerUser) {
            const existing = await prisma.ruleExecution.findUnique({
              where: { ruleId_instagramUserId: { ruleId: rule.id, instagramUserId } },
            })
            if (existing) {
              await prisma.ruleExecutionLog.create({
                data: { ruleId: rule.id, instagramUserId, triggerPayload: event, outcome: 'SKIPPED_ONCE_PER_USER' },
              })
              log.warn({ ruleId: rule.id, instagramUserId }, 'skipped: once per user')
              return null
            }
          }

          const windowStart = new Date(Date.now() - rule.cooldownMinutes * 60 * 1000)
          const recent = await prisma.ruleExecutionLog.findFirst({
            where: { ruleId: rule.id, instagramUserId, createdAt: { gte: windowStart } },
            orderBy: { createdAt: 'desc' },
          })
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

    log.info({ socialAccountId, matched: matched.length, enqueued: passing.length }, 'rule evaluation complete')
  }

  return { evaluate }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm test -- --reporter=verbose src/services/ruleEngineService.test.js
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```
git add src/services/ruleEngineService.js src/services/ruleEngineService.test.js
git commit -m "feat: add ruleEngineService with keyword matching and deduplication"
```

---

## Task 3: automationWorker

**Files:**
- Create: `src/workers/automationWorker.js`
- Create: `src/workers/automationWorker.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/workers/automationWorker.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/metaService.js', () => ({
  getUserProfile: vi.fn(),
  sendDm: vi.fn(),
  replyToComment: vi.fn(),
  replyInThread: vi.fn(),
}))

const metaService = await import('../services/metaService.js')
const { executeAutomation } = await import('./automationWorker.js')

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
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test -- --reporter=verbose src/workers/automationWorker.test.js
```

Expected: FAIL — `Cannot find module './automationWorker.js'`

- [ ] **Step 3: Implement automationWorker.js**

Create `src/workers/automationWorker.js`:
```js
import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

function renderTemplate(template, firstName) {
  return template.replace(/\{\{first_name\}\}/g, firstName)
}

export async function executeAutomation(job, prisma, log) {
  const { ruleId, actionType, instagramUserId, socialAccountId, messageTemplate, commentId, threadId } = job.data

  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId } })
  const { accessToken } = account

  const { first_name } = await metaService.getUserProfile(instagramUserId, accessToken)
  const message = renderTemplate(messageTemplate, first_name)

  try {
    if (actionType === 'SEND_DM') {
      await metaService.sendDm(instagramUserId, message, accessToken)
    } else if (actionType === 'REPLY_COMMENT') {
      await metaService.replyToComment(commentId, message, accessToken)
    } else {
      await metaService.replyInThread(threadId, message, accessToken)
    }

    await Promise.all([
      prisma.ruleExecution.upsert({
        where: { ruleId_instagramUserId: { ruleId, instagramUserId } },
        create: { ruleId, instagramUserId },
        update: {},
      }),
      prisma.ruleExecutionLog.create({
        data: { ruleId, instagramUserId, triggerPayload: job.data, outcome: 'EXECUTED' },
      }),
    ])
    log.info({ ruleId, actionType, instagramUserId, jobId: job.id }, 'automation job completed')
  } catch (err) {
    if (err.status >= 400 && err.status < 500) {
      await prisma.ruleExecutionLog.create({
        data: { ruleId, instagramUserId, triggerPayload: job.data, outcome: 'FAILED', errorMessage: err.message },
      })
      log.error({ ruleId, jobId: job.id, err: err.message, attempt: job.attemptsMade }, 'automation job failed (4xx)')
      return
    }
    log.error({ ruleId, jobId: job.id, err: err.message, attempt: job.attemptsMade }, 'automation job failed')
    throw err
  }
}

export function createAutomationWorker(connection, prisma, log) {
  const worker = new Worker(
    'automation.queue',
    (job) => executeAutomation(job, prisma, log),
    { connection, concurrency: 10 },
  )

  worker.on('failed', async (job, err) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return
    const { ruleId, instagramUserId } = job.data
    try {
      await prisma.ruleExecutionLog.create({
        data: { ruleId, instagramUserId, triggerPayload: job.data, outcome: 'FAILED', errorMessage: err.message },
      })
    } catch (logErr) {
      log.error({ ruleId, jobId: job.id, err: logErr.message }, 'failed to write failure log')
    }
    log.error({ ruleId, jobId: job.id, err: err.message }, 'automation job exhausted retries')
  })

  return worker
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm test -- --reporter=verbose src/workers/automationWorker.test.js
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```
git add src/workers/automationWorker.js src/workers/automationWorker.test.js
git commit -m "feat: add automationWorker with template rendering and 4xx/5xx error handling"
```

---

## Task 4: Webhook Routes

**Files:**
- Create: `src/modules/webhooks/routes.js`
- Create: `src/modules/webhooks/webhooks.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/webhooks/webhooks.test.js`:
```js
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  })),
}))

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

const mockEvaluate = vi.fn().mockResolvedValue(undefined)
vi.mock('../../services/ruleEngineService.js', () => ({
  createRuleEngineService: vi.fn(() => ({ evaluate: mockEvaluate })),
}))

const prismaSocialAccountFindFirst = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: { findUnique: vi.fn() },
    socialAccount: { findFirst: prismaSocialAccountFindFirst },
    scheduledPost: {
      create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn(),
    },
    automationRule: {
      create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
  })),
}))

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: 'clerk-user-123', sid: 'sess-123' }),
}))

vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: vi.fn() })),
}))

vi.mock('../../services/mediaService.js', () => ({ getUploadUrl: vi.fn() }))

const { build } = await import('../../server.js')

// META_WEBHOOK_SECRET is set to 'test_webhook_secret' in vitest.setup.js
function sign(body) {
  return 'sha256=' + crypto.createHmac('sha256', 'test_webhook_secret').update(body).digest('hex')
}

describe('GET /webhooks/meta', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())

  it('returns challenge text when mode and token match', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=test_webhook_secret&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('abc123')
  })

  it('returns 403 when verify_token does not match', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when hub.mode is not subscribe', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=unsubscribe&hub.verify_token=test_webhook_secret&hub.challenge=abc123',
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /webhooks/meta', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    mockEvaluate.mockReset().mockResolvedValue(undefined)
  })

  it('returns 403 when signature header is invalid', async () => {
    const body = JSON.stringify({ entry: [] })
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': 'sha256=invalid', 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(403)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('calls evaluate with normalized COMMENT event payload', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', instagramAccountId: 'ig-123' })
    const payload = {
      entry: [{
        id: 'ig-123',
        changes: [{
          field: 'comments',
          value: { id: 'comment-abc', from: { id: 'commenter-1' }, text: 'love it!', media: { id: 'post-999' } },
        }],
      }],
    }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).toHaveBeenCalledWith({
      type: 'COMMENT',
      socialAccountId: 'acc-1',
      commenterId: 'commenter-1',
      text: 'love it!',
      postId: 'post-999',
      commentId: 'comment-abc',
    })
  })

  it('calls evaluate with normalized DM event payload', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1', instagramAccountId: 'ig-123' })
    const payload = {
      entry: [{
        id: 'ig-123',
        messaging: [{ sender: { id: 'sender-1' }, message: { text: 'info' } }],
      }],
    }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).toHaveBeenCalledWith({
      type: 'DM',
      socialAccountId: 'acc-1',
      senderId: 'sender-1',
      text: 'info',
      threadId: 'sender-1',
    })
  })

  it('returns 200 and silently skips when instagramAccountId is not in DB', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const payload = { entry: [{ id: 'unknown-ig', changes: [] }] }
    const body = JSON.stringify(payload)
    const res = await fastify.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test -- --reporter=verbose src/modules/webhooks/webhooks.test.js
```

Expected: FAIL (module not found or route 404).

- [ ] **Step 3: Implement webhooks/routes.js**

Create `src/modules/webhooks/routes.js`:
```js
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
      const expected = 'sha256=' + crypto.createHmac('sha256', config.META_WEBHOOK_SECRET).update(request.body).digest('hex')
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
```

- [ ] **Step 4: Register webhookRoutes in server.js (temporary)**

In `src/server.js`, add the import and registration so the test can find the routes:
```js
import webhookRoutes from './modules/webhooks/routes.js'
```

In `build()`, after `await fastify.register(authPublicRoutes)`:
```js
await fastify.register(webhookRoutes)
```

(Full server.js wiring is in Task 6 — this step only adds what's needed to unblock the test.)

- [ ] **Step 5: Run tests to confirm they pass**

```
npm test -- --reporter=verbose src/modules/webhooks/webhooks.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```
git add src/modules/webhooks/routes.js src/modules/webhooks/webhooks.test.js src/server.js
git commit -m "feat: add Meta webhook receiver with HMAC verification and event parsing"
```

---

## Task 5: Automations CRUD Routes

**Files:**
- Create: `src/modules/automations/routes.js`
- Create: `src/modules/automations/automations.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/automations/automations.test.js`:
```js
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue(undefined),
    status: 'ready',
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  })),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../services/ruleEngineService.js', () => ({
  createRuleEngineService: vi.fn(() => ({ evaluate: vi.fn() })),
}))

const prismaSocialAccountFindFirst = vi.fn()
const prismaAutomationRuleCreate = vi.fn()
const prismaAutomationRuleFindMany = vi.fn()
const prismaAutomationRuleFindFirst = vi.fn()
const prismaAutomationRuleUpdate = vi.fn()
const prismaAutomationRuleDelete = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    user: { findUnique: vi.fn() },
    socialAccount: { findFirst: prismaSocialAccountFindFirst },
    scheduledPost: {
      create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn(),
    },
    automationRule: {
      create: prismaAutomationRuleCreate,
      findMany: prismaAutomationRuleFindMany,
      findFirst: prismaAutomationRuleFindFirst,
      update: prismaAutomationRuleUpdate,
      delete: prismaAutomationRuleDelete,
    },
  })),
}))

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: 'clerk-user-123', sid: 'sess-123' }),
}))

vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: vi.fn() })),
}))

vi.mock('../../services/mediaService.js', () => ({ getUploadUrl: vi.fn() }))

const { build } = await import('../../server.js')

const AUTH_HEADER = { authorization: 'Bearer test-token' }

const validBody = {
  socialAccountId: 'acc-1',
  triggerType: 'COMMENT_KEYWORD',
  triggerKeyword: 'promo',
  matchType: 'CONTAINS',
  actionType: 'SEND_DM',
  messageTemplate: 'Hey {{first_name}}!',
}

const mockRule = {
  id: 'rule-1',
  socialAccountId: 'acc-1',
  triggerType: 'COMMENT_KEYWORD',
  triggerKeyword: 'promo',
  matchType: 'CONTAINS',
  actionType: 'SEND_DM',
  messageTemplate: 'Hey {{first_name}}!',
  postId: null,
  replyOncePerUser: true,
  cooldownMinutes: 60,
  isActive: true,
}

describe('POST /automations', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaAutomationRuleCreate.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/automations', body: validBody })
    expect(res.statusCode).toBe(401)
  })

  it('creates a rule and returns 201', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleCreate.mockResolvedValueOnce(mockRule)
    const res = await fastify.inject({ method: 'POST', url: '/automations', headers: AUTH_HEADER, body: validBody })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('rule-1')
    expect(prismaAutomationRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggerKeyword: 'promo' }) }),
    )
  })

  it('returns 404 when socialAccount belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'POST', url: '/automations', headers: AUTH_HEADER, body: validBody })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when REPLY_COMMENT is paired with DM_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, triggerType: 'DM_KEYWORD', actionType: 'REPLY_COMMENT' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/REPLY_COMMENT/)
  })

  it('returns 400 when REPLY_DM is paired with COMMENT_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, actionType: 'REPLY_DM' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/REPLY_DM/)
  })

  it('sets postId to null when triggerType is DM_KEYWORD', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleCreate.mockResolvedValueOnce({ ...mockRule, triggerType: 'DM_KEYWORD', actionType: 'SEND_DM' })
    const res = await fastify.inject({
      method: 'POST',
      url: '/automations',
      headers: AUTH_HEADER,
      body: { ...validBody, triggerType: 'DM_KEYWORD', actionType: 'SEND_DM', postId: 'some-post' },
    })
    expect(res.statusCode).toBe(201)
    expect(prismaAutomationRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ postId: null }) }),
    )
  })
})

describe('GET /automations', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaSocialAccountFindFirst.mockReset()
    prismaAutomationRuleFindMany.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/automations?socialAccountId=acc-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when socialAccountId is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/automations', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(400)
  })

  it('returns list of rules for own account', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce({ id: 'acc-1' })
    prismaAutomationRuleFindMany.mockResolvedValueOnce([mockRule])
    const res = await fastify.inject({
      method: 'GET',
      url: '/automations?socialAccountId=acc-1',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('returns 404 when account belongs to another user', async () => {
    prismaSocialAccountFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'GET',
      url: '/automations?socialAccountId=acc-other',
      headers: AUTH_HEADER,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => { prismaAutomationRuleFindFirst.mockReset() })

  it('returns rule when owned by auth user', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    const res = await fastify.inject({ method: 'GET', url: '/automations/rule-1', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('rule-1')
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'GET', url: '/automations/rule-other', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaAutomationRuleFindFirst.mockReset()
    prismaAutomationRuleUpdate.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'PATCH', url: '/automations/rule-1', body: {} })
    expect(res.statusCode).toBe(401)
  })

  it('updates allowed fields and returns updated rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    prismaAutomationRuleUpdate.mockResolvedValueOnce({ ...mockRule, triggerKeyword: 'discount' })
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-1',
      headers: AUTH_HEADER,
      body: { triggerKeyword: 'discount' },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaAutomationRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggerKeyword: 'discount' }) }),
    )
  })

  it('returns 400 when update creates invalid trigger/action combo', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule) // actionType: SEND_DM, triggerType: COMMENT_KEYWORD
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-1',
      headers: AUTH_HEADER,
      body: { actionType: 'REPLY_DM' }, // REPLY_DM requires DM_KEYWORD but existing is COMMENT_KEYWORD
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/automations/rule-other',
      headers: AUTH_HEADER,
      body: { isActive: false },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /automations/:id', () => {
  let fastify
  beforeAll(async () => { fastify = await build({ logger: false }); await fastify.ready() })
  afterAll(() => fastify.close())
  beforeEach(() => {
    prismaAutomationRuleFindFirst.mockReset()
    prismaAutomationRuleDelete.mockReset()
  })

  it('returns 401 without auth', async () => {
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-1' })
    expect(res.statusCode).toBe(401)
  })

  it('deletes own rule and returns 204', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(mockRule)
    prismaAutomationRuleDelete.mockResolvedValueOnce({})
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-1', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(204)
    expect(prismaAutomationRuleDelete).toHaveBeenCalledWith({ where: { id: 'rule-1' } })
  })

  it('returns 404 for another user\'s rule', async () => {
    prismaAutomationRuleFindFirst.mockResolvedValueOnce(null)
    const res = await fastify.inject({ method: 'DELETE', url: '/automations/rule-other', headers: AUTH_HEADER })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test -- --reporter=verbose src/modules/automations/automations.test.js
```

Expected: FAIL (module not found or routes return 404).

- [ ] **Step 3: Implement automations/routes.js**

Create `src/modules/automations/routes.js`:
```js
export default async function automationRoutes(fastify) {
  fastify.post('/automations', async (request, reply) => {
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

  fastify.get('/automations', async (request, reply) => {
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

  fastify.get('/automations/:id', async (request, reply) => {
    const rule = await fastify.prisma.automationRule.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!rule) return reply.code(404).send({ error: 'Rule not found' })
    return rule
  })

  fastify.patch('/automations/:id', async (request, reply) => {
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

  fastify.delete('/automations/:id', async (request, reply) => {
    const rule = await fastify.prisma.automationRule.findFirst({
      where: { id: request.params.id, socialAccount: { user: { clerkId: request.auth.userId } } },
    })
    if (!rule) return reply.code(404).send({ error: 'Rule not found' })
    await fastify.prisma.automationRule.delete({ where: { id: rule.id } })
    return reply.code(204).send()
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm test -- --reporter=verbose src/modules/automations/automations.test.js
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```
git add src/modules/automations/routes.js src/modules/automations/automations.test.js
git commit -m "feat: add AutomationRule CRUD routes with trigger/action validation"
```

---

## Task 6: server.js Wiring

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Update server.js with full Phase 4 wiring**

Replace the full contents of `src/server.js` with:
```js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import prismaPlugin from './plugins/prisma.js'
import redisPlugin from './plugins/redis.js'
import clerkPlugin from './plugins/clerk.js'
import healthRoutes from './modules/health/routes.js'
import { authPublicRoutes, authProtectedRoutes } from './modules/auth/routes.js'
import accountRoutes from './modules/accounts/routes.js'
import postRoutes from './modules/posts/routes.js'
import webhookRoutes from './modules/webhooks/routes.js'
import automationRoutes from './modules/automations/routes.js'
import { createTokenRefreshQueue } from './queues/tokenRefreshQueue.js'
import { createTokenRefreshWorker, scheduleTokenRefreshJob } from './workers/tokenRefreshWorker.js'
import { createPostWorker } from './workers/postWorker.js'
import { createAutomationWorker } from './workers/automationWorker.js'

export async function build({ logger: loggerOpt, ...rest } = {}) {
  const fastify = Fastify({
    logger: loggerOpt ?? {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    ...rest,
  })

  await fastify.register(cors)
  await fastify.register(prismaPlugin)
  await fastify.register(redisPlugin)

  // Unprotected routes
  await fastify.register(healthRoutes)
  await fastify.register(authPublicRoutes)
  await fastify.register(webhookRoutes)

  // Protected scope — clerk onRequest hook applies only inside this child scope
  await fastify.register(async (protectedApp) => {
    await protectedApp.register(clerkPlugin)
    await protectedApp.register(authProtectedRoutes)
    await protectedApp.register(accountRoutes)
    await protectedApp.register(postRoutes)
    await protectedApp.register(automationRoutes)
  })

  return fastify
}

export async function start() {
  const fastify = await build()

  const tokenRefreshQueue = createTokenRefreshQueue(fastify.redis)
  const tokenRefreshWorker = createTokenRefreshWorker(
    fastify.redisWorker,
    fastify.prisma,
    fastify.log,
  )
  await scheduleTokenRefreshJob(tokenRefreshQueue)

  const postWorker = createPostWorker(fastify.redisWorker, fastify.prisma, fastify.log)
  const automationWorker = createAutomationWorker(fastify.redisWorker, fastify.prisma, fastify.log)

  fastify.addHook('onClose', async () => {
    await Promise.all([
      tokenRefreshWorker.close(),
      postWorker.close(),
      automationWorker.close(),
    ])
    await tokenRefreshQueue.close()
  })

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
}
```

- [ ] **Step 2: Run the full test suite**

```
npm test
```

Expected: all tests pass (previous 68 + new tests from Tasks 1–5).

- [ ] **Step 3: Commit**

```
git add src/server.js
git commit -m "feat: wire Phase 4 webhook and automation routes + automationWorker into server"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| `automationQueue.js` with default retry options | Task 1 |
| `graphFetch` attaches HTTP status to errors | Task 1 |
| `getUserProfile`, `sendDm`, `replyToComment`, `replyInThread` in metaService | Task 1 |
| `createRuleEngineService` with keyword matching (CONTAINS/EXACT/STARTS_WITH) | Task 2 |
| once-per-user dedup via RuleExecution | Task 2 |
| cooldown check via RuleExecutionLog | Task 2 |
| Parallel evaluation via `Promise.all` per matched rule | Task 2 |
| `executeAutomation` with `{{first_name}}` substitution | Task 3 |
| 4xx Meta → write FAILED log, no rethrow | Task 3 |
| 5xx Meta → rethrow for BullMQ retry | Task 3 |
| Failed event handler writes FAILED log after exhausted retries | Task 3 |
| concurrency: 10 on automationWorker | Task 3 |
| GET /webhooks/meta challenge verification | Task 4 |
| POST /webhooks/meta HMAC-SHA256 signature verification | Task 4 |
| Comment + DM event normalization | Task 4 |
| Silent skip when instagramAccountId not in DB | Task 4 |
| POST/GET/GET:id/PATCH/DELETE /automations | Task 5 |
| Ownership enforcement via relation join | Task 5 |
| REPLY_COMMENT requires COMMENT_KEYWORD validation | Task 5 |
| REPLY_DM requires DM_KEYWORD validation | Task 5 |
| DM_KEYWORD forces postId = null | Task 5 |
| server.js registration of all routes + automationWorker | Task 6 |
| Parallel worker close on shutdown | Task 6 |

**Placeholder scan:** No TBD, TODO, or "similar to" references — every step has actual code.

**Type consistency:**
- `createRuleEngineService(queue, prisma, log)` → used consistently in Task 2 (impl), Task 4 (route), Task 4 (test mock)
- `executeAutomation(job, prisma, log)` → matches test import in Task 3
- `createAutomationWorker(connection, prisma, log)` → matches server.js call in Task 6
- Queue name `'automation.queue'` → consistent across `automationQueue.js` and `automationWorker.js`
- Job name `'execute'` → consistent between `ruleEngineService.js` (enqueue) and test assertions
- `ruleId_instagramUserId` compound key → consistent across `ruleEngineService.js` (check) and `automationWorker.js` (upsert)
