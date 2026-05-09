# Phase 4 — Rule Engine Design

**Date:** 2026-05-09
**Branch:** feature/phase-4-rule-engine
**Status:** Approved

---

## Overview

Phase 4 adds a ManyChat-style automation rule engine. Instagram webhook events (comments and DMs) are matched against user-configured rules. Matching rules are enqueued as BullMQ jobs and executed by an automation worker that calls the Meta Graph API to send DMs or post replies.

The overall architecture follows Approach A: synchronous rule evaluation inline with the webhook handler (fast — DB reads + enqueue only), with all slow Meta API work deferred to the worker.

---

## New Files

| File | Purpose |
|---|---|
| `src/modules/automations/routes.js` | CRUD endpoints for `AutomationRule` (Clerk-protected) |
| `src/modules/webhooks/routes.js` | Meta webhook receiver — GET challenge + POST events (no Clerk auth) |
| `src/services/ruleEngineService.js` | Keyword matching, once-per-user check, cooldown check, job enqueue |
| `src/workers/automationWorker.js` | Executes automation jobs — fetch profile, substitute, call Meta API |
| `src/queues/automationQueue.js` | BullMQ queue definition for `automation.queue` |

### Extensions to existing files

- `src/services/metaService.js` — add `getUserProfile`, `sendDm`, `replyToComment`, `replyInThread`
- `src/server.js` — register webhooks route (unprotected scope), automations route (protected scope), start `automationWorker`

---

## Data Models

Already defined in `prisma/schema.prisma`. No new migrations needed for Phase 4.

| Model | Purpose |
|---|---|
| `AutomationRule` | User-configured rule: trigger, keyword, match type, action, template |
| `RuleExecution` | Once-per-user dedup — unique constraint on `[ruleId, instagramUserId]` |
| `RuleExecutionLog` | Append-only audit trail — every evaluation outcome recorded |

**Enums already present:** `TriggerType`, `MatchType`, `ActionType`, `LogOutcome`

---

## API Endpoints

All routes under `/automations`, Clerk-protected. Ownership enforced: routes verify the target `SocialAccount` belongs to the authenticated user.

```
POST   /automations          Create a new rule
GET    /automations          List rules (filterable by ?socialAccountId=)
GET    /automations/:id      Get a single rule
PATCH  /automations/:id      Update rule fields
DELETE /automations/:id      Delete a rule
```

### Request body fields (create / update)

| Field | Type | Notes |
|---|---|---|
| `socialAccountId` | string | Required on create only |
| `triggerType` | `COMMENT_KEYWORD` \| `DM_KEYWORD` | |
| `triggerKeyword` | string | |
| `matchType` | `CONTAINS` \| `EXACT` \| `STARTS_WITH` | |
| `actionType` | `SEND_DM` \| `REPLY_COMMENT` \| `REPLY_DM` | |
| `messageTemplate` | string | Supports `{{first_name}}` |
| `postId` | string \| null | null = all posts; only meaningful for `COMMENT_KEYWORD` |
| `replyOncePerUser` | boolean | Default: `true` |
| `cooldownMinutes` | integer | Default: `60` |
| `isActive` | boolean | Default: `true` |

### Validation rules (enforced at API layer)

- `REPLY_COMMENT` requires `triggerType: COMMENT_KEYWORD`
- `REPLY_DM` requires `triggerType: DM_KEYWORD`
- `SEND_DM` works with either trigger type
- `postId` is ignored (set to null) when `triggerType: DM_KEYWORD`

---

## Webhook Handler

Registered in the unprotected route scope (no Clerk auth), same as `/webhooks/clerk`.

### GET /webhooks/meta — subscription verification

Meta sends this once when you subscribe in the Meta App Dashboard.

```
query params: hub.mode, hub.verify_token, hub.challenge
→ if hub.mode === 'subscribe' && hub.verify_token === META_WEBHOOK_SECRET
    → respond 200 with hub.challenge (plain text)
→ else → 403
```

### POST /webhooks/meta — event receiver

```
1. Read raw body (needed for HMAC verification)
2. Compute HMAC-SHA256(rawBody, META_WEBHOOK_SECRET)
3. Compare to X-Hub-Signature-256 header — reject with 403 if mismatch
4. Parse JSON body
5. For each entry in payload:
   a. Look up SocialAccount by entry.id (instagramAccountId) — skip silently if not found
   b. Detect event type and extract fields:
      - Comment: entry.changes[].field === 'comments'
          → { type: 'COMMENT', socialAccountId, commenterId: value.from.id,
              text: value.text, postId: value.media.id, commentId: value.id }
      - DM: entry.messaging[].message.text exists
          → { type: 'DM', socialAccountId, senderId: messaging.sender.id,
              text: messaging.message.text, threadId: messaging.sender.id }
   c. Call ruleEngineService.evaluate(normalizedEvent)
6. Return 200 immediately
```

All `evaluate()` calls are fired concurrently via `Promise.all` across entries. The route handler never awaits slow work — DB lookups and BullMQ enqueues are fast.

---

## Rule Engine Service

`src/services/ruleEngineService.js`

```
evaluate(event) →
  1. Load active AutomationRule rows:
     - WHERE socialAccountId = event.socialAccountId
     - AND triggerType matches event.type (COMMENT_KEYWORD for COMMENT, DM_KEYWORD for DM)
     - AND (postId IS NULL OR postId = event.postId)  [COMMENT only]
  2. Filter by keyword match:
     - CONTAINS:     keyword present anywhere in text (case-insensitive)
     - EXACT:        text equals keyword (case-insensitive, trimmed)
     - STARTS_WITH:  text starts with keyword (case-insensitive)
  3. For each matching rule, run concurrently via Promise.all:
     a. If replyOncePerUser: query RuleExecution for [ruleId, instagramUserId]
        → if found: log SKIPPED_ONCE_PER_USER, skip rule
     b. Query latest RuleExecutionLog for [ruleId, instagramUserId] within cooldownMinutes
        → if found: log SKIPPED_COOLDOWN, skip rule
  4. Enqueue all passing rules in a single Promise.all to automation.queue
```

The `instagramUserId` for COMMENT events is `event.commenterId`; for DM events it is `event.senderId`.

---

## Job Payload

```js
{
  ruleId,
  actionType,          // SEND_DM | REPLY_COMMENT | REPLY_DM
  instagramUserId,     // commenter or DM sender IGSID
  socialAccountId,     // DB id — worker fetches accessToken from here
  messageTemplate,     // raw template, e.g. "Hey {{first_name}}!"
  commentId,           // present when actionType === REPLY_COMMENT
  threadId,            // present when actionType === REPLY_DM
}
```

---

## Automation Worker

`src/workers/automationWorker.js` — concurrency: 10

```
1. Fetch SocialAccount (accessToken) and call metaService.getUserProfile(instagramUserId, accessToken)
   → run both in Promise.all (independent)
2. Extract first_name from profile response
3. Substitute {{first_name}} in messageTemplate
4. Execute action:
   - SEND_DM       → metaService.sendDm(instagramUserId, message, accessToken)
   - REPLY_COMMENT → metaService.replyToComment(commentId, message, accessToken)
   - REPLY_DM      → metaService.replyInThread(threadId, message, accessToken)
5. Upsert RuleExecution { ruleId, instagramUserId }
6. Append RuleExecutionLog { ruleId, instagramUserId, outcome: 'EXECUTED' }
```

### Error handling

| Error type | Behaviour |
|---|---|
| 4xx from Meta (user blocked, invalid token, etc.) | Catch in worker, write `RuleExecutionLog { outcome: 'FAILED' }`, do NOT rethrow — job completes at BullMQ level |
| 5xx / rate limit from Meta | Rethrow — BullMQ retries up to 3× with exponential backoff (initial delay: 5 000 ms) |
| After 3 failed attempts | BullMQ moves job to failed queue; `failed` event handler writes `RuleExecutionLog { outcome: 'FAILED' }` |

---

## metaService Extensions

Four new methods added to `src/services/metaService.js`:

```
getUserProfile(instagramUserId, accessToken)
  → GET /{instagramUserId}?fields=name&access_token={accessToken}
  → returns { name, first_name } (first word of name used as first_name fallback)

sendDm(recipientId, message, accessToken)
  → POST /me/messages with { recipient: { id }, message: { text } }

replyToComment(commentId, message, accessToken)
  → POST /{commentId}/replies with { message }

replyInThread(threadId, message, accessToken)
  → POST /me/messages with { recipient: { id: threadId }, message: { text } }
```

All methods go through the existing `graphFetch()` helper for error normalisation.

---

## Testing

### `automations.test.js`
- Create rule: valid body, invalid trigger/action combo (e.g. REPLY_DM + COMMENT_KEYWORD)
- Ownership: cannot read/update/delete another user's rule (403)
- List: filtered correctly by `socialAccountId`

### `webhooks.test.js`
- GET: valid verify token → echoes challenge; invalid token → 403
- POST: invalid signature → 403
- POST: valid comment event → `ruleEngineService.evaluate` called with correct normalised payload
- POST: valid DM event → same
- POST: `instagramAccountId` not in DB → 200, no crash (silent drop)

### `ruleEngineService.test.js`
- Keyword matching: CONTAINS / EXACT / STARTS_WITH (case-insensitive)
- `replyOncePerUser: true` → skips and logs `SKIPPED_ONCE_PER_USER`
- Cooldown within window → skips and logs `SKIPPED_COOLDOWN`
- Multiple matching rules → all enqueued via `Promise.all`

### `automationWorker.test.js`
- Happy path for each actionType
- `{{first_name}}` correctly substituted
- 4xx Meta error → `RuleExecutionLog { outcome: 'FAILED' }` written, no rethrow
- 5xx Meta error → rethrows for BullMQ retry
- Failed event handler → writes `FAILED` log after exhausted retries
