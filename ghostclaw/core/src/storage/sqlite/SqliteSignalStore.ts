import Database from 'better-sqlite3';
import type { ISignalStore } from '../interfaces/ISignalStore';
import type { Signal } from '../../runtime_loop';

export class SqliteSignalStore implements ISignalStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT,
        createdAt INTEGER NOT NULL
      )
    `);
  }

  private rowToSignal(row: Record<string, unknown>): Signal {
    const signal: Signal = {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.createdAt as number,
    };
    if (row.payload != null) {
      signal.payload = JSON.parse(row.payload as string) as Record<string, unknown>;
    }
    return signal;
  }

  create(signal: Signal): Signal {
    this.db.prepare(`
      INSERT INTO signals (id, name, payload, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(
      signal.id,
      signal.name,
      signal.payload !== undefined ? JSON.stringify(signal.payload) : null,
      signal.createdAt,
    );
    return signal;
  }

  getById(id: string): Signal | undefined {
    const row = this.db
      .prepare('SELECT * FROM signals WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSignal(row) : undefined;
  }

  listAll(): Signal[] {
    const rows = this.db.prepare('SELECT * FROM signals ORDER BY createdAt ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToSignal(r));
  }

  reset(): void {
    this.db.prepare('DELETE FROM signals').run();
  }
}
