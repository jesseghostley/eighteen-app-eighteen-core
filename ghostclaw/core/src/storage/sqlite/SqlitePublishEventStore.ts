import Database from 'better-sqlite3';
import type { IPublishEventStore } from '../interfaces/IPublishEventStore';
import type { PublishEvent, PublishEventStatus } from '../../publish_event';

export class SqlitePublishEventStore implements IPublishEventStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publish_events (
        id TEXT PRIMARY KEY,
        artifactId TEXT NOT NULL,
        publishedAt INTEGER NOT NULL,
        destination TEXT NOT NULL,
        status TEXT NOT NULL,
        publishedBy TEXT NOT NULL,
        approvedBy TEXT,
        approvedAt INTEGER,
        policyId TEXT,
        externalUrl TEXT,
        failureReason TEXT,
        retryCount INTEGER
      )
    `);
  }

  private rowToEvent(row: Record<string, unknown>): PublishEvent {
    const event: PublishEvent = {
      id: row.id as string,
      artifactId: row.artifactId as string,
      publishedAt: row.publishedAt as number,
      destination: row.destination as string,
      status: row.status as PublishEventStatus,
      publishedBy: row.publishedBy as string,
    };
    if (row.approvedBy != null) event.approvedBy = row.approvedBy as string;
    if (row.approvedAt != null) event.approvedAt = row.approvedAt as number;
    if (row.policyId != null) event.policyId = row.policyId as string;
    if (row.externalUrl != null) event.externalUrl = row.externalUrl as string;
    if (row.failureReason != null) event.failureReason = row.failureReason as string;
    if (row.retryCount != null) event.retryCount = row.retryCount as number;
    return event;
  }

  create(event: PublishEvent): PublishEvent {
    this.db.prepare(`
      INSERT INTO publish_events
        (id, artifactId, publishedAt, destination, status, publishedBy,
         approvedBy, approvedAt, policyId, externalUrl, failureReason, retryCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.artifactId,
      event.publishedAt,
      event.destination,
      event.status,
      event.publishedBy,
      event.approvedBy ?? null,
      event.approvedAt ?? null,
      event.policyId ?? null,
      event.externalUrl ?? null,
      event.failureReason ?? null,
      event.retryCount ?? null,
    );
    return event;
  }

  getById(id: string): PublishEvent | undefined {
    const row = this.db
      .prepare('SELECT * FROM publish_events WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEvent(row) : undefined;
  }

  listAll(): PublishEvent[] {
    const rows = this.db.prepare('SELECT * FROM publish_events ORDER BY publishedAt ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  listByArtifactId(artifactId: string): PublishEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM publish_events WHERE artifactId = ? ORDER BY publishedAt ASC')
      .all(artifactId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  listByStatus(status: PublishEventStatus): PublishEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM publish_events WHERE status = ? ORDER BY publishedAt ASC')
      .all(status) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  updateStatus(
    id: string,
    status: PublishEventStatus,
    updates?: Partial<Pick<PublishEvent, 'approvedBy' | 'approvedAt' | 'externalUrl' | 'failureReason' | 'retryCount'>>,
  ): PublishEvent | undefined {
    const existing = this.db
      .prepare('SELECT * FROM publish_events WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) return undefined;

    const setClauses: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (updates) {
      if (updates.approvedBy !== undefined) {
        setClauses.push('approvedBy = ?');
        params.push(updates.approvedBy);
      }
      if (updates.approvedAt !== undefined) {
        setClauses.push('approvedAt = ?');
        params.push(updates.approvedAt);
      }
      if (updates.externalUrl !== undefined) {
        setClauses.push('externalUrl = ?');
        params.push(updates.externalUrl);
      }
      if (updates.failureReason !== undefined) {
        setClauses.push('failureReason = ?');
        params.push(updates.failureReason);
      }
      if (updates.retryCount !== undefined) {
        setClauses.push('retryCount = ?');
        params.push(updates.retryCount);
      }
    }

    params.push(id);
    this.db.prepare(`UPDATE publish_events SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  reset(): void {
    this.db.prepare('DELETE FROM publish_events').run();
  }
}
