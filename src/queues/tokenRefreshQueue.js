import { Queue } from 'bullmq'

export function createTokenRefreshQueue(connection) {
  return new Queue('token.refresh', { connection })
}
