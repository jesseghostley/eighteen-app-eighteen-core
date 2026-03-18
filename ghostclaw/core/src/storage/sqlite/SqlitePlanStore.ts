import Database from 'better-sqlite3';
import type { IPlanStore } from '../interfaces/IPlanStore';
import type { Plan } from '../../runtime_loop';

export class SqlitePlanStore implements IPlanStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        signalId TEXT NOT NULL,
        action TEXT NOT NULL,
        strategyId TEXT NOT NULL,
        strategyType TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        priority INTEGER,
        requiredAgents TEXT,
        expectedOutputs TEXT
      )
    `);
  }

  private rowToPlan(row: Record<string, unknown>): Plan {
    const plan: Plan = {
      id: row.id as string,
      signalId: row.signalId as string,
      action: row.action as Plan['action'],
      strategyId: row.strategyId as string,
      strategyType: row.strategyType as Plan['strategyType'],
      createdAt: row.createdAt as number,
    };
    if (row.priority != null) plan.priority = row.priority as number;
    if (row.requiredAgents != null) {
      plan.requiredAgents = JSON.parse(row.requiredAgents as string) as string[];
    }
    if (row.expectedOutputs != null) {
      plan.expectedOutputs = JSON.parse(row.expectedOutputs as string) as string[];
    }
    return plan;
  }

  create(plan: Plan): Plan {
    this.db.prepare(`
      INSERT INTO plans
        (id, signalId, action, strategyId, strategyType, createdAt, priority, requiredAgents, expectedOutputs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.id,
      plan.signalId,
      plan.action,
      plan.strategyId,
      plan.strategyType,
      plan.createdAt,
      plan.priority ?? null,
      plan.requiredAgents ? JSON.stringify(plan.requiredAgents) : null,
      plan.expectedOutputs ? JSON.stringify(plan.expectedOutputs) : null,
    );
    return plan;
  }

  getById(id: string): Plan | undefined {
    const row = this.db
      .prepare('SELECT * FROM plans WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToPlan(row) : undefined;
  }

  listAll(): Plan[] {
    const rows = this.db.prepare('SELECT * FROM plans ORDER BY createdAt ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToPlan(r));
  }

  listBySignalId(signalId: string): Plan[] {
    const rows = this.db
      .prepare('SELECT * FROM plans WHERE signalId = ? ORDER BY createdAt ASC')
      .all(signalId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToPlan(r));
  }

  reset(): void {
    this.db.prepare('DELETE FROM plans').run();
  }
}
