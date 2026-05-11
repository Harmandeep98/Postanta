import { Worker } from 'bullmq'
import * as metaService from '../services/metaService.js'

function renderTemplate(template, firstName) {
  return template.replace(/\{\{first_name\}\}/g, firstName)
}

export async function executeAutomation(job, prisma, log) {
  const { ruleId, actionType, instagramUserId, socialAccountId, messageTemplate, commentId, threadId } = job.data

  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId } })
  const { accessToken } = account

  try {
    const { first_name } = await metaService.getUserProfile(instagramUserId, accessToken)
    const message = renderTemplate(messageTemplate, first_name)

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
