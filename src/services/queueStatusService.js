export function createQueueStatusService({ automation, posts, tokenRefresh }) {
  async function getAllQueueCounts() {
    const [automationCounts, postsCounts, tokenRefreshCounts] = await Promise.all([
      automation.getJobCounts(),
      posts.getJobCounts(),
      tokenRefresh.getJobCounts(),
    ])
    return { automation: automationCounts, posts: postsCounts, tokenRefresh: tokenRefreshCounts }
  }

  return { getAllQueueCounts }
}
