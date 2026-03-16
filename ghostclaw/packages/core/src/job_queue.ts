/**
 * JobStatus — lifecycle states for a Job.
 *
 * Canonical spec: ghostclaw_runtime_execution_spec.md § 4 (Job Status Model)
 *                 ghostclaw_runtime_persistence_spec.md § 2.3
 *
 * The in-memory execution pipeline actively uses: queued, assigned, running,
 * completed, failed.  The remaining states are reserved for future MCS
 * integration and durable-mode workflows.
 *
 * TODO(schema-alignment): State machine transitions for the following statuses
 *   are deferred pending MCS governance layer implementation:
 *   - 'proposed'       — job exists but is not yet placed into the active queue
 *   - 'blocked'        — execution paused; missing dependency/approval/resource
 *   - 'waiting_review' — completed but requires QA or publishing review
 *   - 'published'      — output has been externally published or activated
 *   - 'cancelled'      — intentionally terminated before completion
 */
export type JobStatus =
  | 'proposed'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'blocked'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'published'
  | 'cancelled';

export type QueueJob = {
  id: string;
  planId: string;
  jobType: string;
  assignedAgent: string | null;
  status: JobStatus;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown> | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
};

import type { IJobStore } from './storage/interfaces/IJobStore';

export const MAX_RETRIES = 2;

export class InMemoryJobQueue implements IJobStore {
  private readonly jobsById = new Map<string, QueueJob>();
  private readonly queue: string[] = [];
  private readonly executing = new Set<string>();

  enqueue(job: QueueJob): QueueJob {
    const existing = this.jobsById.get(job.id);
    if (existing) {
      return existing;
    }

    this.jobsById.set(job.id, job);
    if (job.status === 'queued') {
      this.queue.push(job.id);
    }

    return job;
  }

  dequeue(): QueueJob | undefined {
    while (this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) {
        continue;
      }

      const job = this.jobsById.get(jobId);
      if (!job) {
        continue;
      }

      if (job.status !== 'queued') {
        continue;
      }

      if (this.executing.has(job.id)) {
        continue;
      }

      job.status = 'assigned';
      job.updatedAt = Date.now();
      return job;
    }

    return undefined;
  }

  list(): QueueJob[] {
    return Array.from(this.jobsById.values());
  }

  markRunning(jobId: string): void {
    const job = this.jobsById.get(jobId);
    if (!job || this.executing.has(jobId) || job.status === 'completed') {
      return;
    }

    job.status = 'running';
    job.updatedAt = Date.now();
    this.executing.add(jobId);
  }

  markComplete(jobId: string): void {
    const job = this.jobsById.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'completed';
    job.updatedAt = Date.now();
    this.executing.delete(jobId);
  }

  markFailed(jobId: string): void {
    const job = this.jobsById.get(jobId);
    if (!job) {
      return;
    }

    this.executing.delete(jobId);
    job.retryCount += 1;
    job.updatedAt = Date.now();

    if (job.retryCount <= MAX_RETRIES) {
      job.status = 'queued';
      this.queue.push(job.id);
      return;
    }

    job.status = 'failed';
  }

  reset(): void {
    this.jobsById.clear();
    this.queue.length = 0;
    this.executing.clear();
  }
}

export const jobQueue = new InMemoryJobQueue();
