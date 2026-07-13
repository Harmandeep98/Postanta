import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

export async function runSweep(prisma, log) {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const accounts = await prisma.socialAccount.findMany({
    where: { tokenExpiresAt: { lt: sevenDaysFromNow } },
  })

  log.info({ count: accounts.length }, 'token refresh sweep started')

  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      const { accessToken, expiresIn } = await metaService.refreshLongLivedToken(
        account.accessToken,
      )
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        },
      })
    }),
  )

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      log.error(
        { accountId: accounts[i].id, err: result.reason?.message },
        'token refresh failed for account',
      )
    }
  })

  const succeeded = results.filter((r) => r.status === 'fulfilled').length
  log.info({ succeeded, failed: results.length - succeeded }, 'token refresh sweep complete')
}

export function createTokenRefreshWorker(connection, prisma, log) {
  return new Worker('token.refresh', () => runSweep(prisma, log), {
    connection,
    concurrency: 1,
  })
}

export async function scheduleTokenRefreshJob(queue) {
  await queue.add('token.refresh.sweep', {}, {
    repeat: { cron: '0 3 * * *' },
    jobId: 'token.refresh.sweep',
  })
}
