// Sends a properly-signed fake Meta webhook payload to the local server, so the
// rule engine (signature check -> match -> cooldown/once-per-user -> enqueue ->
// worker -> RuleExecutionLog) can be exercised end-to-end without ngrok or a
// real Meta app. The final Graph API send will fail (fake token) and land the
// execution as FAILED — that's expected, it proves the failure path works.
import crypto from 'crypto'

const [, , eventType, text, instagramAccountId = 'fake_ig_account_1'] = process.argv

if (!['comment', 'dm'].includes(eventType) || !text) {
  console.error('Usage: node --env-file=.env.local scripts/simulate-webhook.js <comment|dm> "<text>" [instagramAccountId]')
  process.exit(1)
}

const entry =
  eventType === 'comment'
    ? {
        id: instagramAccountId,
        changes: [
          {
            field: 'comments',
            value: { from: { id: 'fake_commenter_1' }, text, media: { id: 'fake_post_1' }, id: 'fake_comment_1' },
          },
        ],
      }
    : {
        id: instagramAccountId,
        messaging: [{ sender: { id: 'fake_sender_1' }, message: { text } }],
      }

const payload = JSON.stringify({ object: 'instagram', entry: [entry] })

const secret = process.env.META_WEBHOOK_SECRET
if (!secret) {
  console.error('META_WEBHOOK_SECRET not set — run with: node --env-file=.env.local scripts/simulate-webhook.js ...')
  process.exit(1)
}

const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')

const baseUrl = process.env.LOCAL_API_URL || 'http://localhost:3000'
const res = await fetch(`${baseUrl}/webhooks/meta`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body: payload,
})

console.log(res.status, await res.text())
