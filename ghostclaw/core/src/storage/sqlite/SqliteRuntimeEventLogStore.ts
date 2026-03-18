import Database from 'better-sqlite3';
import type { IRuntimeEventLogStore } from '../interfaces/IRuntimeEventLogStore';
import type { RuntimeEventLogEntry } from '../../runtime_event_log';

export class SqliteRuntimeEventLogStore implements IRuntimeEventLogStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_event_log (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        workspace_id TEXT,
        signal_id TEXT,
        plan_id TEXT,
        job_id TEXT,
        assignment_id TEXT,
        skill_invocation_id TEXT,
        artifact_id TEXT,
        publish_event_id TEXT,
        payload TEXT NOT NULL,
        correlation_id TEXT
      )
    `);
  }

  private rowToEntry(row: Record<string, unknown>): RuntimeEventLogEntry {
    const entry: RuntimeEventLogEntry = {
      event_id: row.event_id as string,
      event_type: row.event_type as string,
      occurred_at: row.occurred_at as number,
      payload: JSON.parse(row.payload as string) as unknown,
    };
    if (row.workspace_id != null) entry.workspace_id = row.workspace_id as string;
    if (row.signal_id != null) entry.signal_id = row.signal_id as string;
    if (row.plan_id != null) entry.plan_id = row.plan_id as string;
    if (row.job_id != null) entry.job_id = row.job_id as string;
    if (row.assignment_id != null) entry.assignment_id = row.assignment_id as string;
    if (row.skill_invocation_id != null) entry.skill_invocation_id = row.skill_invocation_id as string;
    if (row.artifact_id != null) entry.artifact_id = row.artifact_id as string;
    if (row.publish_event_id != null) entry.publish_event_id = row.publish_event_id as string;
    if (row.correlation_id != null) entry.correlation_id = row.correlation_id as string;
    return entry;
  }

  append(entry: RuntimeEventLogEntry): RuntimeEventLogEntry {
    this.db.prepare(`
      INSERT INTO runtime_event_log
        (event_id, event_type, occurred_at, workspace_id, signal_id, plan_id,
         job_id, assignment_id, skill_invocation_id, artifact_id, publish_event_id,
         payload, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.event_id,
      entry.event_type,
      entry.occurred_at,
      entry.workspace_id ?? null,
      entry.signal_id ?? null,
      entry.plan_id ?? null,
      entry.job_id ?? null,
      entry.assignment_id ?? null,
      entry.skill_invocation_id ?? null,
      entry.artifact_id ?? null,
      entry.publish_event_id ?? null,
      JSON.stringify(entry.payload),
      entry.correlation_id ?? null,
    );
    return entry;
  }

  getById(eventId: string): RuntimeEventLogEntry | undefined {
    const row = this.db
      .prepare('SELECT * FROM runtime_event_log WHERE event_id = ?')
      .get(eventId) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : undefined;
  }

  listRecent(limit: number): RuntimeEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_event_log ORDER BY occurred_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByWorkspace(workspaceId: string): RuntimeEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_event_log WHERE workspace_id = ? ORDER BY occurred_at ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByJob(jobId: string): RuntimeEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_event_log WHERE job_id = ? ORDER BY occurred_at ASC')
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listBySkillInvocation(skillInvocationId: string): RuntimeEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_event_log WHERE skill_invocation_id = ? ORDER BY occurred_at ASC')
      .all(skillInvocationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByCorrelationId(correlationId: string): RuntimeEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_event_log WHERE correlation_id = ? ORDER BY occurred_at ASC')
      .all(correlationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  reset(): void {
    this.db.prepare('DELETE FROM runtime_event_log').run();
  }
}
