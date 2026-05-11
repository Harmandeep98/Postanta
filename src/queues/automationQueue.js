import { Queue } from 'bullmq'

export function createAutomationQueue(connection) {
  return new Queue('automation.queue', {
    connection,
    // 5xx Meta errors rethrow from executeAutomation, triggering BullMQ retry
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  })
}
