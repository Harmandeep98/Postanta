import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createScheduleService } from './scheduleService.js'

const mockJobId = 'job-abc-123'
const mockJobRemove = vi.fn().mockResolvedValue(undefined)

const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: mockJobId }),
  getJob: vi.fn(),
}

let svc

beforeEach(() => {
  vi.clearAllMocks()
  svc = createScheduleService(mockQueue)
})

describe('createJob', () => {
  it('enqueues a delayed job and returns its id', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString()
    const id = await svc.createJob('post-1', futureDate)

    expect(mockQueue.add).toHaveBeenCalledWith(
      'publish',
      { postId: 'post-1' },
      expect.objectContaining({ delay: expect.any(Number), attempts: 3 }),
    )
    expect(id).toBe(mockJobId)
  })
})

describe('rescheduleJob', () => {
  it('removes old job and creates a new one, returning new id', async () => {
    const existingJob = { id: 'old-job', data: { postId: 'post-1' }, remove: mockJobRemove }
    mockQueue.getJob.mockResolvedValueOnce(existingJob)
    mockQueue.add.mockResolvedValueOnce({ id: 'new-job-id' })

    const futureDate = new Date(Date.now() + 120_000).toISOString()
    const newId = await svc.rescheduleJob('old-job', futureDate)

    expect(mockJobRemove).toHaveBeenCalled()
    expect(mockQueue.add).toHaveBeenCalled()
    expect(newId).toBe('new-job-id')
  })

  it('throws if old job not found', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)
    await expect(svc.rescheduleJob('missing-job', new Date().toISOString())).rejects.toThrow(
      'not found',
    )
  })
})

describe('cancelJob', () => {
  it('removes the job', async () => {
    const job = { remove: mockJobRemove }
    mockQueue.getJob.mockResolvedValueOnce(job)

    await svc.cancelJob('job-1')
    expect(mockJobRemove).toHaveBeenCalled()
  })

  it('is a no-op if job not found', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)
    await expect(svc.cancelJob('missing')).resolves.toBeUndefined()
    expect(mockJobRemove).not.toHaveBeenCalled()
  })
})
