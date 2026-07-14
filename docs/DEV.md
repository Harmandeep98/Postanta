# Developer Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Runtime |
| pnpm | any | Package manager (`npm i -g pnpm`) |
| Redis | 6+ | BullMQ job queue |

No local Postgres install/container needed — local dev and staging both point at the same
AWS RDS PostgreSQL instance (`db.t4g.micro`, Free Tier eligible). `DATABASE_URL` in `.env.local`
is the RDS connection string; Redis still runs locally via Docker Compose (`docker compose up`).

---

## Local Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and fill in values
cp .env.example .env

# 3. Run DB migrations
npx prisma migrate dev

# 4. Start Redis (keep this running in a separate terminal)
redis-server

# 5. Start the server
npm run dev
```

Server starts at `http://localhost:3000`.

---

## Environment Variables

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | AWS RDS PostgreSQL connection string (shared by local dev + staging) |
| `REDIS_URL` | `redis://localhost:6379` for local |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard → Webhooks → your endpoint |
| `META_APP_ID` | Meta Developer Portal → Your App |
| `META_APP_SECRET` | Meta Developer Portal → Your App → Settings |
| `META_WEBHOOK_SECRET` | You choose this string — must match what you set in Meta |
| `META_REDIRECT_URI` | `http://localhost:3000/auth/instagram/callback` for local |
| `FRONTEND_URL` | `http://localhost:3001` or wherever your frontend runs |
| `AWS_S3_BUCKET` etc. | AWS Console → S3 (only needed for media uploads) |

---

## Getting a Clerk Auth Token (for API testing)

Every protected endpoint requires a Clerk JWT in the `Authorization` header.

**Easiest way (no frontend needed):**
1. Go to Clerk Dashboard → Users → select a user
2. Click **"Create session token"** (or use Clerk's test tokens feature)
3. Copy the token and paste it in Postman/Bruno as `Bearer <token>`

**From your frontend:**
After signing in via Clerk, call `await getToken()` from `@clerk/clerk-react` and copy the result.

---

## API Reference

Base URL: `http://localhost:3000`

### Auth required
All endpoints except `/health`, `/webhooks/*` require:
```
Authorization: Bearer <clerk-jwt-token>
```

---

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Server liveness check |

**Response:**
```json
{ "status": "ok", "uptime": 42.3, "queues": { "pending": 0, "active": 0, "failed": 0 } }
```

---

### Auth / Instagram Connect

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/instagram` | Yes | Redirect to Meta OAuth consent screen |
| GET | `/auth/instagram/callback` | No | Meta redirects here after OAuth |

**Flow:**
1. Call `GET /auth/instagram` — you get redirected to Meta's login page
2. User grants permission
3. Meta redirects to `/auth/instagram/callback?code=...&state=...`
4. Server exchanges code for long-lived token and stores `SocialAccount`

---

### Accounts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/accounts` | Yes | List connected Instagram accounts |
| DELETE | `/accounts/:id` | Yes | Disconnect an account |

**GET /accounts response:**
```json
[
  {
    "id": "clx...",
    "instagramAccountId": "17841400000000000",
    "instagramUsername": "myhandle",
    "tokenExpiresAt": "2026-08-01T00:00:00.000Z",
    "createdAt": "2026-05-01T00:00:00.000Z"
  }
]
```

---

### Scheduled Posts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/posts` | Yes | Schedule a new post |
| GET | `/posts?socialAccountId=` | Yes | List posts for an account |
| PATCH | `/posts/:id` | Yes | Edit caption / reschedule |
| DELETE | `/posts/:id` | Yes | Cancel and delete |

**POST /posts body:**
```json
{
  "socialAccountId": "clx...",
  "caption": "Hello world! #instagram",
  "mediaUrl": "https://your-s3-bucket.s3.amazonaws.com/image.jpg",
  "scheduledAt": "2026-06-01T10:00:00.000Z"
}
```

**Post status values:** `SCHEDULED` → `PUBLISHED` or `FAILED`

---

### Media Upload

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/media/upload-url?contentType=image/jpeg` | Yes | Get S3 presigned upload URL |

**Response:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "mediaUrl": "https://your-bucket.s3.amazonaws.com/uploads/uuid.jpg"
}
```

Upload your file with a `PUT` request to `uploadUrl`, then use `mediaUrl` in `POST /posts`.

---

### Automation Rules

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/automations` | Yes | Create a rule |
| GET | `/automations?socialAccountId=` | Yes | List rules for an account |
| GET | `/automations/:id` | Yes | Get one rule |
| PATCH | `/automations/:id` | Yes | Update a rule |
| DELETE | `/automations/:id` | Yes | Delete a rule |

**POST /automations body:**
```json
{
  "socialAccountId": "clx...",
  "triggerType": "COMMENT_KEYWORD",
  "triggerKeyword": "price",
  "matchType": "CONTAINS",
  "actionType": "SEND_DM",
  "messageTemplate": "Hi {{first_name}}, here are our prices: ...",
  "postId": null,
  "replyOncePerUser": true,
  "cooldownMinutes": 60,
  "isActive": true
}
```

**Valid combos:**

| triggerType | actionType | Effect |
|-------------|------------|--------|
| `COMMENT_KEYWORD` | `SEND_DM` | Comment with keyword → DM the commenter |
| `COMMENT_KEYWORD` | `REPLY_COMMENT` | Comment with keyword → public reply |
| `DM_KEYWORD` | `REPLY_DM` | Incoming DM matches keyword → reply in thread |

**matchType values:** `CONTAINS`, `EXACT`, `STARTS_WITH`

**messageTemplate:** Supports `{{first_name}}` placeholder.

---

### Webhooks (Meta)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/webhooks/meta` | No | Meta challenge verification |
| POST | `/webhooks/meta` | No | Receive comment/DM events |

These are called by Meta, not by you directly. To test locally use [ngrok](https://ngrok.com) to expose your local server.

### Testing the rule engine without a real Meta account

Before Meta App Review / a working OAuth connect, you can still exercise the whole rule-engine
pipeline (signature check → keyword match → cooldown/once-per-user → enqueue → worker →
`RuleExecutionLog`) using a fake account and a properly-signed fake webhook payload:

```bash
# 1. Create a fake SocialAccount tied to your real signed-in Clerk user
docker compose exec app npm run seed:fake-account -- <your-clerk-user-id>

# 2. In the app UI, select that fake account and create an automation rule

# 3. Fire a signed fake webhook event at it
docker compose exec app npm run webhook:simulate -- comment "what is the price?"
docker compose exec app npm run webhook:simulate -- dm "hello there"
```

The final Graph API call (reply/DM send) will fail — the fake account has no real access
token — and the execution lands as `FAILED` in the dashboard's Execution Log with Meta's real
"Invalid OAuth access token" error. That's expected: it proves the failure path works. Everything
upstream of that call (signature verification, rule matching, dedup, logging) is real.

---

## Useful Commands

```bash
npm run dev          # Start server with file watch
npm test             # Run all tests
npm run lint         # ESLint check
npx prisma studio    # Visual DB browser at localhost:5555
npx prisma migrate dev   # Apply new migrations
```
