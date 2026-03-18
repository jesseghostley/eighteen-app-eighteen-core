import Database from 'better-sqlite3';
import type { IAssignmentStore } from '../interfaces/IAssignmentStore';
import type { Assignment } from '../../assignment';

export class SqliteAssignmentStore implements IAssignmentStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        agentName TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        fallbackAgentName TEXT,
        fallbackReason TEXT,
        revokedAt INTEGER,
        revokedReason TEXT
      )
    `);
  }

  private rowToAssignment(row: Record<string, unknown>): Assignment {
    const assignment: Assignment = {
      id: row.id as string,
      jobId: row.jobId as string,
      agentName: row.agentName as string,
      reason: row.reason as string,
      createdAt: row.createdAt as number,
    };
    if (row.fallbackAgentName != null) assignment.fallbackAgentName = row.fallbackAgentName as string;
    if (row.fallbackReason != null) assignment.fallbackReason = row.fallbackReason as string;
    if (row.revokedAt != null) assignment.revokedAt = row.revokedAt as number;
    if (row.revokedReason != null) assignment.revokedReason = row.revokedReason as string;
    return assignment;
  }

  create(assignment: Assignment): Assignment {
    this.db.prepare(`
      INSERT INTO assignments
        (id, jobId, agentName, reason, createdAt, fallbackAgentName, fallbackReason, revokedAt, revokedReason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assignment.id,
      assignment.jobId,
      assignment.agentName,
      assignment.reason,
      assignment.createdAt,
      assignment.fallbackAgentName ?? null,
      assignment.fallbackReason ?? null,
      assignment.revokedAt ?? null,
      assignment.revokedReason ?? null,
    );
    return assignment;
  }

  getById(id: string): Assignment | undefined {
    const row = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToAssignment(row) : undefined;
  }

  listAll(): Assignment[] {
    const rows = this.db.prepare('SELECT * FROM assignments ORDER BY createdAt ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToAssignment(r));
  }

  listByJobId(jobId: string): Assignment[] {
    const rows = this.db
      .prepare('SELECT * FROM assignments WHERE jobId = ? ORDER BY createdAt ASC')
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAssignment(r));
  }

  listByAgentName(agentName: string): Assignment[] {
    const rows = this.db
      .prepare('SELECT * FROM assignments WHERE agentName = ? ORDER BY createdAt ASC')
      .all(agentName) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAssignment(r));
  }

  revoke(id: string, revokedAt: number, revokedReason: string): Assignment | undefined {
    const existing = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) return undefined;

    this.db.prepare('UPDATE assignments SET revokedAt = ?, revokedReason = ? WHERE id = ?')
      .run(revokedAt, revokedReason, id);
    return this.getById(id);
  }

  reset(): void {
    this.db.prepare('DELETE FROM assignments').run();
  }
}
