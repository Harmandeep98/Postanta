# Phase 2: Instagram OAuth & Token Management — Design Spec

**Date:** 2026-05-04
**Branch:** feature/phase-2-instagram-auth
**Status:** Approved

---

## Overview

Phase 2 adds Instagram Business account connectivity. Users authorize via Meta OAuth, we store a long-lived access token, and a background job keeps tokens fresh. A Clerk webhook provisions `User` rows on signup.

---

## Architecture

### New files
```
src/modules/auth/routes.js          — OAuth initiate + callback + Clerk webhook
src/modules/accounts/routes.js      — list + disconnect Instagram accounts
src/services/metaService.js         — token exchange, refresh, Graph API wrapper
src/workers/tokenRefreshWorker.js   — BullMQ worker, proactive token refresh
src/queues/tokenRefreshQueue.js     — BullMQ queue definition
```

### Modified files
```
src/server.js     — register auth + accounts modules, start tokenRefreshWorker
src/config.js     — add CLERK_WEBHOOK_SECRET, META_REDIRECT_URI, FRONTEND_URL
.env.example      — add new vars
```

### New dependency
```
svix    — Clerk-recommended package for webhook signature verification
```

### New environment variables
```
CLERK_WEBHOOK_SECRET   # Clerk Svix signing secret (from Clerk dashboard → Webhooks)
META_REDIRECT_URI      # Full callback URL, e.g. https://api.example.com/auth/instagram/callback
FRONTEND_URL           # Frontend app base URL, e.g. https://app.example.com
```

---

## Section 1: Clerk Webhook — User Provisioning

**Endpoint:** `POST /webhooks/clerk`
**Auth:** None (Clerk-signed, verified via Svix)
**Registration:** Mounted outside the Clerk-protected scope in `server.js`, alongside `/health`

### Flow
1. Read raw request body — Fastify must preserve it unparsed for Svix signature verification
2. Verify Svix signature using `CLERK_WEBHOOK_SECRET` and headers `svix-id`, `svix-timestamp`, `svix-signature` — reject with `400` if invalid
3. Parse event type:
   - `user.created` → `prisma.user.create({ data: { clerkId: data.id, email: data.email_addresses[0].email_address } })`
   - `user.deleted` → `prisma.user.delete({ where: { clerkId: data.id } })` — cascades to `SocialAccount`
   - All other types → `200` no-op
4. Return `200 { received: true }`

---

## Section 2: Instagram OAuth Flow

### `GET /auth/instagram` — protected (Clerk auth required)

1. Generate a random `state` UUID (`crypto.randomUUID()`)
2. Store in Redis: `SET oauth:state:{state} {clerkUserId} EX 600` (10-minute TTL)
3. Build Meta authorization URL:
   - Base: `https://www.facebook.com/v21.0/dialog/oauth`
   - `client_id` = `META_APP_ID`
   - `redirect_uri` = `META_REDIRECT_URI`
   - `scope` = `instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_messaging,pages_show_list`
   - `response_type` = `code`
   - `state` = UUID from step 1
4. `reply.redirect(302, authorizationUrl)`

### `GET /auth/instagram/callback` — unprotected (Meta redirects here)

1. If `?error` query param present → redirect to `{FRONTEND_URL}/connect/error?reason={error}`
2. Read `state` from query params → `GET oauth:state:{state}` from Redis → get `clerkUserId` → `DEL` key. If key missing or expired → `400 { error: 'Invalid or expired state' }`
3. `prisma.user.upsert({ where: { clerkId }, create: { clerkId, email: '' }, update: {} })` → get internal `userId`. Upsert rather than findUnique guards against Clerk webhook delivery delays — the email field is left blank if we're creating here (Clerk webhook will fill it shortly after, or it can be fetched from Clerk's API in future).
4. Exchange `code` for short-lived user token via `metaService.exchangeCodeForShortLivedToken(code)`
5. Exchange short-lived for long-lived user token via `metaService.exchangeForLongLivedToken(shortLivedToken)` → `{ accessToken, expiresIn }` (expiresIn is in seconds, typically ~5184000 for 60 days)
6. Call `metaService.getInstagramAccounts(longLivedToken)` → returns array of `{ instagramAccountId, username }` (one per IG Business Account linked to a Page the user manages)
7. For each account: `prisma.socialAccount.upsert` keyed on `[userId, instagramAccountId]` — stores `accessToken`, `tokenExpiresAt = now + expiresIn seconds`, `instagramUsername`. All upserts run concurrently via `Promise.all`.
8. Redirect to `{FRONTEND_URL}/connect/success?accountId={firstAccountId}`

**Note:** If the user's Facebook account manages multiple Pages each with an IG Business Account, one `SocialAccount` row is upserted per account. Pages with no linked IG Business Account are silently skipped with a `warn` log.

---

## Section 3: Token Storage & Refresh

### `src/services/metaService.js` — Phase 2 surface

```
exchangeCodeForShortLivedToken(code)           → { accessToken }
exchangeForLongLivedToken(shortLivedToken)     → { accessToken, expiresIn }
refreshLongLivedToken(accessToken)             → { accessToken, expiresIn }
getInstagramAccounts(userToken)                → [{ instagramAccountId, username }]
getValidToken(socialAccount, prisma)           → string (valid access token)
```

All functions call `https://graph.facebook.com` via native `fetch`. No additional HTTP client.

### `getValidToken(socialAccount, prisma)`

On-demand fallback called at the top of every future `metaService` function that needs a token:
1. If `socialAccount.tokenExpiresAt > now + 7 days` → return `accessToken` as-is
2. Otherwise: call `refreshLongLivedToken(accessToken)` → get new token + `expiresIn`
3. `prisma.socialAccount.update` with new `accessToken` and `tokenExpiresAt = now + expiresIn seconds`
4. Return new `accessToken`
5. If refresh fails → throw — caller handles error

### Proactive refresh — BullMQ repeating job

**Queue:** `token.refresh` (`src/queues/tokenRefreshQueue.js`)

**Worker:** `src/workers/tokenRefreshWorker.js`

On startup, registers a repeating job with cron `0 3 * * *` (3 AM daily) named `token.refresh.sweep`. Job processor:
1. `prisma.socialAccount.findMany({ where: { tokenExpiresAt: { lt: now + 7 days } } })`
2. For each account: call `metaService.refreshLongLivedToken` → update DB. All accounts refreshed concurrently via `Promise.allSettled` (partial failure acceptable — log errors per account, don't abort the sweep).
3. Log `info` with count of refreshed accounts, log `error` per failed account.

BullMQ retry policy: 3 attempts with exponential backoff.

Worker started in `src/server.js` alongside future workers.

---

## Section 4: Account Management Endpoints

**File:** `src/modules/accounts/routes.js`
**Auth:** All routes protected (Clerk auth required)
**User resolution:** `clerkId` from `request.auth.userId` → `prisma.user.findUnique` → `userId`

### `GET /accounts`

Returns all connected Instagram accounts for the current user.

```json
[
  {
    "id": "clj...",
    "instagramAccountId": "17841...",
    "instagramUsername": "mybrand",
    "tokenExpiresAt": "2025-07-01T03:00:00.000Z",
    "createdAt": "2025-05-04T10:00:00.000Z"
  }
]
```

`accessToken` is never included in the response.

### `DELETE /accounts/:id`

1. `prisma.socialAccount.findFirst({ where: { id, userId } })` — `404` if not found (don't reveal existence to wrong user)
2. `prisma.socialAccount.delete({ where: { id } })` — cascades to `ScheduledPost`, `AutomationRule`, `RuleExecution`, `RuleExecutionLog`
3. Return `204`

---

## Section 5: Error Handling

| Scenario | Behaviour |
|---|---|
| Invalid Svix signature on Clerk webhook | `400 { error: 'Invalid webhook signature' }` |
| `state` missing or expired in Redis | `400 { error: 'Invalid or expired state' }` |
| Meta returns `?error=access_denied` | Redirect to `{FRONTEND_URL}/connect/error?reason=access_denied` |
| Meta token exchange fails | Redirect to `{FRONTEND_URL}/connect/error?reason=token_exchange_failed` |
| Page has no linked IG Business Account | Skip silently, log `warn` |
| Token refresh fails in sweep worker | Log `error`, BullMQ retries 3× with exponential backoff |
| `DELETE /accounts/:id` by wrong user | `404` |

---

## Section 6: Testing

**`src/modules/auth/auth.test.js`**
- Clerk webhook: valid signature + `user.created` → `User` row created
- Clerk webhook: valid signature + `user.deleted` → `User` row deleted (cascade verified)
- Clerk webhook: invalid signature → `400`
- `GET /auth/instagram` without auth → `401`
- `GET /auth/instagram` with valid Clerk token → redirects, URL contains correct `client_id`, `scope`, and `state` stored in Redis
- `GET /auth/instagram/callback` with missing/expired `state` → `400`
- `GET /auth/instagram/callback` valid `state` + `code` → `SocialAccount` upserted, redirects to `{FRONTEND_URL}/connect/success`

**`src/modules/accounts/accounts.test.js`**
- `GET /accounts` without auth → `401`
- `GET /accounts` → list returned, `accessToken` absent from each item
- `DELETE /accounts/:id` own account → `204`, row deleted
- `DELETE /accounts/:id` another user's account → `404`

**`src/services/metaService.test.js`**
- `getValidToken` with non-expiring token → returns token, no refresh call made
- `getValidToken` with token expiring in 5 days → calls refresh, persists new token + expiry
- All Meta Graph API HTTP calls mocked with `vi.fn()` — no real network in tests
