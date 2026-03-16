import { InMemoryJobQueue } from '../packages/core/src/job_queue';
import type { QueueJob } from '../packages/core/src/job_queue';

function makeJob(id: string, overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id,
    planId: 'plan_1',
    jobType: 'draft_cluster_outline',
    assignedAgent: null,
    status: 'queued',
    inputPayload: {},
    outputPayload: null,
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('InMemoryJobQueue', () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  it('enqueues and dequeues a job', () => {
    const job = makeJob('job_1');
    queue.enqueue(job);
    const dequeued = queue.dequeue();
    expect(dequeued).toBeDefined();
    expect(dequeued?.id).toBe('job_1');
    expect(dequeued?.status).toBe('assigned');
  });

  it('returns undefined when the queue is empty', () => {
    expect(queue.dequeue()).toBeUndefined();
  });

  it('does not enqueue the same job twice', () => {
    const job = makeJob('job_1');
    queue.enqueue(job);
    queue.enqueue(job);
    queue.dequeue();
    expect(queue.dequeue()).toBeUndefined();
  });

  it('marks a job as running', () => {
    const job = makeJob('job_1');
    queue.enqueue(job);
    const dequeued = queue.dequeue()!;
    queue.markRunning(dequeued.id);
    const jobs = queue.list();
    expect(jobs[0].status).toBe('running');
  });

  it('marks a job as completed', () => {
    const job = makeJob('job_1');
    queue.enqueue(job);
    const dequeued = queue.dequeue()!;
    queue.markRunning(dequeued.id);
    queue.markComplete(dequeued.id);
    expect(queue.list()[0].status).toBe('completed');
  });

  it('retries a failed job up to MAX_RETRIES', () => {
    const job = makeJob('job_1');
    queue.enqueue(job);

    // First attempt: dequeue → fail (retryCount = 1, re-queued)
    queue.dequeue();
    queue.markFailed('job_1');
    expect(queue.list()[0].status).toBe('queued');
    expect(queue.list()[0].retryCount).toBe(1);

    // Second attempt: dequeue → fail (retryCount = 2, re-queued)
    queue.dequeue();
    queue.markFailed('job_1');
    expect(queue.list()[0].status).toBe('queued');
    expect(queue.list()[0].retryCount).toBe(2);

    // Third attempt: dequeue → fail (retryCount = 3, permanently failed)
    queue.dequeue();
    queue.markFailed('job_1');
    expect(queue.list()[0].status).toBe('failed');
    expect(queue.list()[0].retryCount).toBe(3);
  });

  it('lists all jobs', () => {
    queue.enqueue(makeJob('job_1'));
    queue.enqueue(makeJob('job_2'));
    expect(queue.list()).toHaveLength(2);
  });
});
