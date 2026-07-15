// One-off: seeds a User + fake SocialAccount + a handful of posts/rules/logs so the
// Posts/Automations/Dashboard pages have something to show without a real Meta account.
// Safe to re-run — upserts the user/account, only adds posts/rules if none exist yet.
import { PrismaClient } from '@prisma/client'

const clerkId = process.argv[2]
const email = process.argv[3]
if (!clerkId || !email) {
  console.error('Usage: node --env-file=.env.local scripts/seed-demo-data.js <clerkUserId> <email>')
  process.exit(1)
}

const prisma = new PrismaClient()

const user = await prisma.user.upsert({
  where: { clerkId },
  create: { clerkId, email },
  update: {},
})

const account = await prisma.socialAccount.upsert({
  where: { userId_instagramAccountId: { userId: user.id, instagramAccountId: 'fake_ig_account_1' } },
  create: {
    userId: user.id,
    instagramAccountId: 'fake_ig_account_1',
    instagramUsername: 'fake_test_account',
    accessToken: 'fake-access-token-for-local-testing',
    tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  },
  update: {},
})

const existingPosts = await prisma.scheduledPost.count({ where: { socialAccountId: account.id } })
if (existingPosts === 0) {
  const now = Date.now()
  await prisma.scheduledPost.createMany({
    data: [
      {
        socialAccountId: account.id,
        caption: 'Behind the scenes at the studio ✨',
        mediaUrls: ['https://picsum.photos/seed/demo1/1080'],
        scheduledAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        instagramMediaId: 'demo_media_1',
      },
      {
        socialAccountId: account.id,
        caption: 'New drop this Friday 🔥',
        mediaUrls: ['https://picsum.photos/seed/demo2/1080', 'https://picsum.photos/seed/demo3/1080'],
        scheduledAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        instagramMediaId: 'demo_media_2',
      },
      {
        socialAccountId: account.id,
        caption: 'Q&A livestream recap',
        mediaUrls: ['https://picsum.photos/seed/demo4/1080'],
        scheduledAt: new Date(now + 2 * 24 * 60 * 60 * 1000),
        status: 'SCHEDULED',
      },
      {
        socialAccountId: account.id,
        caption: 'Oops, bad upload',
        mediaUrls: ['https://picsum.photos/seed/demo5/1080'],
        scheduledAt: new Date(now - 12 * 60 * 60 * 1000),
        status: 'FAILED',
        errorMessage: 'Invalid OAuth access token - Cannot parse access token',
      },
    ],
  })
  console.log('Seeded 4 demo posts')
}

const existingRules = await prisma.automationRule.count({ where: { socialAccountId: account.id } })
let rules = []
if (existingRules === 0) {
  await prisma.automationRule.createMany({
    data: [
      {
        socialAccountId: account.id,
        triggerType: 'COMMENT_KEYWORD',
        triggerKeyword: 'price',
        matchType: 'CONTAINS',
        actionType: 'SEND_DM',
        messageTemplate: 'Hi {{first_name}}, here are our prices: link.example.com/pricing',
        isActive: true,
      },
      {
        socialAccountId: account.id,
        triggerType: 'COMMENT_KEYWORD',
        triggerKeyword: 'love this',
        matchType: 'CONTAINS',
        actionType: 'REPLY_COMMENT',
        messageTemplate: 'Thank you so much! 🙏',
        isActive: true,
      },
      {
        socialAccountId: account.id,
        triggerType: 'DM_KEYWORD',
        triggerKeyword: 'shipping',
        matchType: 'CONTAINS',
        actionType: 'REPLY_DM',
        messageTemplate: 'We ship worldwide! 3-5 business days.',
        isActive: false,
      },
    ],
  })
  console.log('Seeded 3 demo automation rules')
}
rules = await prisma.automationRule.findMany({ where: { socialAccountId: account.id } })

const existingLogs = await prisma.ruleExecutionLog.count({ where: { ruleId: { in: rules.map((r) => r.id) } } })
if (existingLogs === 0 && rules.length > 0) {
  const [priceRule, loveRule] = rules
  const now = Date.now()
  await prisma.ruleExecutionLog.createMany({
    data: [
      { ruleId: priceRule.id, instagramUserId: 'demo_user_1', triggerPayload: {}, outcome: 'EXECUTED', createdAt: new Date(now - 2 * 60 * 60 * 1000) },
      { ruleId: priceRule.id, instagramUserId: 'demo_user_2', triggerPayload: {}, outcome: 'EXECUTED', createdAt: new Date(now - 5 * 60 * 60 * 1000) },
      { ruleId: priceRule.id, instagramUserId: 'demo_user_1', triggerPayload: {}, outcome: 'SKIPPED_ONCE_PER_USER', createdAt: new Date(now - 6 * 60 * 60 * 1000) },
      { ruleId: loveRule.id, instagramUserId: 'demo_user_3', triggerPayload: {}, outcome: 'EXECUTED', createdAt: new Date(now - 30 * 60 * 1000) },
      { ruleId: loveRule.id, instagramUserId: 'demo_user_4', triggerPayload: {}, outcome: 'FAILED', errorMessage: 'Invalid OAuth access token', createdAt: new Date(now - 45 * 60 * 1000) },
    ],
  })
  console.log('Seeded 5 demo rule execution logs')
}

console.log('Demo data ready for account:', account.id)
await prisma.$disconnect()
