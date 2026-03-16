import Database from 'better-sqlite3';
import type { IJobStore } from '../interfaces/IJobStore';
import type { QueueJob } from '../../job_queue';
import { MAX_RETRIES } from '../../job_queue';

export class SqliteJobStore implements IJobStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        planId TEXT NOT NULL,
        jobType TEXT NOT NULL,
        assignedAgent TEXT,
        status TEXT NOT NULL,
        inputPayload TEXT NOT NULL,
        outputPayload TEXT,
        retryCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  private rowToJob(row: Record<string, unknown>): QueueJob {
    return {
      id: row.id as string,
      planId: row.planId as string,
      jobType: row.jobType as string,
      assignedAgent: (row.assignedAgent as string | null) ?? null,
      status: row.status as QueueJob['status'],
      inputPayload: JSON.parse(row.inputPayload as string) as Record<string, unknown>,
      outputPayload: row.outputPayload
        ? (JSON.parse(row.outputPayload as string) as Record<string, unknown>)
        : null,
      retryCount: row.retryCount as number,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
    };
  }

  enqueue(job: QueueJob): QueueJob {
    const existing = this.db
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(job.id) as Record<string, unknown> | undefined;
    if (existing) {
      return this.rowToJob(existing);
    }

    this.db.prepare(`
      INSERT INTO jobs (id, planId, jobType, assignedAgent, status, inputPayload, outputPayload, retryCount, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.planId,
      job.jobType,
      job.assignedAgent,
      job.status,
      JSON.stringify(job.inputPayload),
      job.outputPayload !== null ? JSON.stringify(job.outputPayload) : null,
      job.retryCount,
      job.createdAt,
      job.updatedAt,
    );

    return job;
  }

  dequeue(): QueueJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1")
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    const now = Date.now();
    this.db.prepare("UPDATE jobs SET status = 'assigned', updatedAt = ? WHERE id = ?").run(now, row.id);
    return this.rowToJob({ ...row, status: 'assigned', updatedAt: now });
  }

  list(): QueueJob[] {
    const rows = this.db.prepare('SELECT * FROM jobs').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  markRunning(jobId: string): void {
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(jobId) as Record<string, unknown> | undefined;

    if (!row || row.status === 'completed') {
      return;
    }

    this.db
      .prepare("UPDATE jobs SET status = 'running', updatedAt = ? WHERE id = ?")
      .run(Date.now(), jobId);
  }

  markComplete(jobId: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'completed', updatedAt = ? WHERE id = ?")
      .run(Date.now(), jobId);
  }

  markFailed(jobId: string): void {
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(jobId) as Record<string, unknown> | undefined;

    if (!row) {
      return;
    }

    const retryCount = (row.retryCount as number) + 1;
    const now = Date.now();

    if (retryCount <= MAX_RETRIES) {
      this.db
        .prepare("UPDATE jobs SET status = 'queued', retryCount = ?, updatedAt = ? WHERE id = ?")
        .run(retryCount, now, jobId);
    } else {
      this.db
        .prepare("UPDATE jobs SET status = 'failed', retryCount = ?, updatedAt = ? WHERE id = ?")
        .run(retryCount, now, jobId);
    }
  }

  reset(): void {
    this.db.prepare('DELETE FROM jobs').run();
  }
}
