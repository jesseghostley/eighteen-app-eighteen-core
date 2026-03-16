import type { QueueJob, JobStatus } from '../../job_queue';

export interface IJobStore {
  enqueue(job: QueueJob): QueueJob;
  dequeue(): QueueJob | undefined;
  list(): QueueJob[];
  markRunning(jobId: string): void;
  markComplete(jobId: string): void;
  markFailed(jobId: string): void;
  reset(): void;
}

export type { QueueJob, JobStatus };
