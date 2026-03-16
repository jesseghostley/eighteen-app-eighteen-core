import Database from 'better-sqlite3';
import type { IAuditLogStore } from '../interfaces/IAuditLogStore';
import type { AuditLogEntry, AuditEventType } from '../../audit_log';

export class SqliteAuditLogStore implements IAuditLogStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        eventType TEXT NOT NULL,
        objectType TEXT NOT NULL,
        objectId TEXT NOT NULL,
        actorId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        summary TEXT NOT NULL,
        workspaceId TEXT,
        previousState TEXT,
        newState TEXT,
        metadata TEXT
      )
    `);
  }

  private rowToEntry(row: Record<string, unknown>): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: row.id as string,
      eventType: row.eventType as AuditEventType,
      objectType: row.objectType as string,
      objectId: row.objectId as string,
      actorId: row.actorId as string,
      timestamp: row.timestamp as number,
      summary: row.summary as string,
    };

    if (row.workspaceId != null) entry.workspaceId = row.workspaceId as string;
    if (row.previousState != null) entry.previousState = row.previousState as string;
    if (row.newState != null) entry.newState = row.newState as string;
    if (row.metadata != null) {
      entry.metadata = JSON.parse(row.metadata as string) as Record<string, unknown>;
    }

    return entry;
  }

  append(entry: AuditLogEntry): AuditLogEntry {
    this.db.prepare(`
      INSERT INTO audit_log
        (id, eventType, objectType, objectId, actorId, timestamp, summary,
         workspaceId, previousState, newState, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.eventType,
      entry.objectType,
      entry.objectId,
      entry.actorId,
      entry.timestamp,
      entry.summary,
      entry.workspaceId ?? null,
      entry.previousState ?? null,
      entry.newState ?? null,
      entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null,
    );
    return entry;
  }

  listAll(): AuditLogEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByObjectId(objectType: string, objectId: string): AuditLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE objectType = ? AND objectId = ? ORDER BY timestamp ASC')
      .all(objectType, objectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByEventType(eventType: AuditEventType): AuditLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE eventType = ? ORDER BY timestamp ASC')
      .all(eventType) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByActorId(actorId: string): AuditLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE actorId = ? ORDER BY timestamp ASC')
      .all(actorId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  listByWorkspaceId(workspaceId: string): AuditLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE workspaceId = ? ORDER BY timestamp ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  reset(): void {
    this.db.prepare('DELETE FROM audit_log').run();
  }
}
