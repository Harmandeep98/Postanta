export function createScheduleService(queue) {
  async function createJob(postId, scheduledAt) {
    const delay = new Date(scheduledAt).getTime() - Date.now()
    const job = await queue.add('publish', { postId }, {
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    return job.id
  }

  async function rescheduleJob(bullJobId, scheduledAt) {
    const existing = await queue.getJob(bullJobId)
    if (!existing) throw new Error(`Job ${bullJobId} not found`)
    const { postId } = existing.data
    await existing.remove()
    return createJob(postId, scheduledAt)
  }

  async function cancelJob(bullJobId) {
    const job = await queue.getJob(bullJobId)
    if (job) await job.remove()
  }

  return { createJob, rescheduleJob, cancelJob }
}
