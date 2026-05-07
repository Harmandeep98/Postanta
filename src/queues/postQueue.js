import { Queue } from 'bullmq'

export function createPostQueue(connection) {
  return new Queue('post.publish', { connection })
}
