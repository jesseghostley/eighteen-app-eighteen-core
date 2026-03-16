import Database from 'better-sqlite3';
import type { ISkillInvocationStore } from '../interfaces/ISkillInvocationStore';
import type { SkillInvocation, SkillInvocationStatus } from '../../skill_invocation';

export class SqliteSkillInvocationStore implements ISkillInvocationStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_invocations (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        planId TEXT NOT NULL,
        jobId TEXT NOT NULL,
        assignmentId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        skillId TEXT NOT NULL,
        status TEXT NOT NULL,
        inputPayload TEXT NOT NULL,
        outputPayload TEXT,
        artifactIds TEXT NOT NULL,
        error TEXT,
        retryCount INTEGER NOT NULL DEFAULT 0,
        fallbackUsed INTEGER NOT NULL DEFAULT 0,
        startedAt INTEGER NOT NULL,
        completedAt INTEGER
      )
    `);
  }

  private rowToInvocation(row: Record<string, unknown>): SkillInvocation {
    return {
      id: row.id as string,
      workspaceId: row.workspaceId as string,
      planId: row.planId as string,
      jobId: row.jobId as string,
      assignmentId: row.assignmentId as string,
      agentId: row.agentId as string,
      skillId: row.skillId as string,
      status: row.status as SkillInvocationStatus,
      inputPayload: JSON.parse(row.inputPayload as string) as Record<string, unknown>,
      outputPayload: row.outputPayload
        ? (JSON.parse(row.outputPayload as string) as Record<string, unknown>)
        : null,
      artifactIds: JSON.parse(row.artifactIds as string) as string[],
      error: (row.error as string | null) ?? null,
      retryCount: row.retryCount as number,
      fallbackUsed: Boolean(row.fallbackUsed),
      startedAt: row.startedAt as number,
      completedAt: (row.completedAt as number | null) ?? null,
    };
  }

  create(invocation: SkillInvocation): SkillInvocation {
    this.db.prepare(`
      INSERT INTO skill_invocations
        (id, workspaceId, planId, jobId, assignmentId, agentId, skillId, status,
         inputPayload, outputPayload, artifactIds, error, retryCount, fallbackUsed, startedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invocation.id,
      invocation.workspaceId,
      invocation.planId,
      invocation.jobId,
      invocation.assignmentId,
      invocation.agentId,
      invocation.skillId,
      invocation.status,
      JSON.stringify(invocation.inputPayload),
      invocation.outputPayload !== null ? JSON.stringify(invocation.outputPayload) : null,
      JSON.stringify(invocation.artifactIds),
      invocation.error,
      invocation.retryCount,
      invocation.fallbackUsed ? 1 : 0,
      invocation.startedAt,
      invocation.completedAt,
    );
    return invocation;
  }

  getById(id: string): SkillInvocation | undefined {
    const row = this.db
      .prepare('SELECT * FROM skill_invocations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToInvocation(row) : undefined;
  }

  listAll(): SkillInvocation[] {
    const rows = this.db.prepare('SELECT * FROM skill_invocations').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToInvocation(r));
  }

  listByJobId(jobId: string): SkillInvocation[] {
    const rows = this.db
      .prepare('SELECT * FROM skill_invocations WHERE jobId = ?')
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToInvocation(r));
  }

  updateStatus(
    id: string,
    status: SkillInvocationStatus,
    updates?: Partial<Pick<SkillInvocation, 'outputPayload' | 'error' | 'completedAt' | 'artifactIds' | 'retryCount'>>,
  ): SkillInvocation | undefined {
    const existing = this.db
      .prepare('SELECT * FROM skill_invocations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!existing) {
      return undefined;
    }

    const setClauses: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (updates) {
      if (updates.outputPayload !== undefined) {
        setClauses.push('outputPayload = ?');
        params.push(JSON.stringify(updates.outputPayload));
      }
      if (updates.error !== undefined) {
        setClauses.push('error = ?');
        params.push(updates.error);
      }
      if (updates.completedAt !== undefined) {
        setClauses.push('completedAt = ?');
        params.push(updates.completedAt);
      }
      if (updates.artifactIds !== undefined) {
        setClauses.push('artifactIds = ?');
        params.push(JSON.stringify(updates.artifactIds));
      }
      if (updates.retryCount !== undefined) {
        setClauses.push('retryCount = ?');
        params.push(updates.retryCount);
      }
    }

    params.push(id);
    this.db.prepare(`UPDATE skill_invocations SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    return this.getById(id);
  }

  reset(): void {
    this.db.prepare('DELETE FROM skill_invocations').run();
  }
}
