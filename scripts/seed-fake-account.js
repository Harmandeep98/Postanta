// Creates (or reuses) a fake SocialAccount tied to a real Clerk user, so the
// Posts/Automations/Dashboard pages have something to attach to without a real
// Meta OAuth connect. Any Graph API call made against its fake token will fail —
// that's expected, it exercises the FAILED/error paths, not the happy path to Meta.
import { PrismaClient } from '@prisma/client'

const clerkId = process.argv[2]
if (!clerkId) {
  console.error('Usage: node --env-file=.env.local scripts/seed-fake-account.js <clerkUserId>')
  process.exit(1)
}

const prisma = new PrismaClient()

const user = await prisma.user.findUnique({ where: { clerkId } })
if (!user) {
  console.error(`No User row for clerkId ${clerkId} — sign in first so a User row exists.`)
  process.exit(1)
}

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

console.log('Fake SocialAccount ready:', account.id, account.instagramAccountId)
await prisma.$disconnect()
