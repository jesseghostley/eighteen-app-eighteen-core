import Database from 'better-sqlite3';
import type { IWorkspacePolicyStore } from '../interfaces/IWorkspacePolicyStore';
import type { WorkspacePolicy, PolicyType } from '../../workspace_policy';

export class SqliteWorkspacePolicyStore implements IWorkspacePolicyStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_policies (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        policyType TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        rules TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        priority INTEGER,
        expiresAt INTEGER,
        createdBy TEXT,
        updatedBy TEXT,
        enforcementMode TEXT
      )
    `);
  }

  private rowToPolicy(row: Record<string, unknown>): WorkspacePolicy {
    const policy: WorkspacePolicy = {
      id: row.id as string,
      workspaceId: row.workspaceId as string,
      policyType: row.policyType as PolicyType,
      name: row.name as string,
      description: row.description as string,
      rules: JSON.parse(row.rules as string) as Record<string, unknown>,
      status: row.status as WorkspacePolicy['status'],
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
    };
    if (row.priority != null) policy.priority = row.priority as number;
    if (row.expiresAt != null) policy.expiresAt = row.expiresAt as number;
    if (row.createdBy != null) policy.createdBy = row.createdBy as string;
    if (row.updatedBy != null) policy.updatedBy = row.updatedBy as string;
    if (row.enforcementMode != null) {
      policy.enforcementMode = row.enforcementMode as WorkspacePolicy['enforcementMode'];
    }
    return policy;
  }

  create(policy: WorkspacePolicy): WorkspacePolicy {
    this.db.prepare(`
      INSERT INTO workspace_policies
        (id, workspaceId, policyType, name, description, rules, status,
         createdAt, updatedAt, priority, expiresAt, createdBy, updatedBy, enforcementMode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policy.id,
      policy.workspaceId,
      policy.policyType,
      policy.name,
      policy.description,
      JSON.stringify(policy.rules),
      policy.status,
      policy.createdAt,
      policy.updatedAt,
      policy.priority ?? null,
      policy.expiresAt ?? null,
      policy.createdBy ?? null,
      policy.updatedBy ?? null,
      policy.enforcementMode ?? null,
    );
    return policy;
  }

  getById(id: string): WorkspacePolicy | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspace_policies WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToPolicy(row) : undefined;
  }

  listAll(): WorkspacePolicy[] {
    const rows = this.db.prepare('SELECT * FROM workspace_policies ORDER BY createdAt ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToPolicy(r));
  }

  listByWorkspaceId(workspaceId: string): WorkspacePolicy[] {
    const rows = this.db
      .prepare('SELECT * FROM workspace_policies WHERE workspaceId = ? ORDER BY createdAt ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToPolicy(r));
  }

  listActive(workspaceId: string, policyType?: PolicyType): WorkspacePolicy[] {
    if (policyType !== undefined) {
      const rows = this.db
        .prepare('SELECT * FROM workspace_policies WHERE workspaceId = ? AND status = ? AND policyType = ? ORDER BY createdAt ASC')
        .all(workspaceId, 'active', policyType) as Record<string, unknown>[];
      return rows.map((r) => this.rowToPolicy(r));
    }
    const rows = this.db
      .prepare('SELECT * FROM workspace_policies WHERE workspaceId = ? AND status = ? ORDER BY createdAt ASC')
      .all(workspaceId, 'active') as Record<string, unknown>[];
    return rows.map((r) => this.rowToPolicy(r));
  }

  update(
    id: string,
    updates: Partial<Pick<WorkspacePolicy, 'name' | 'description' | 'rules' | 'status' | 'priority' | 'expiresAt' | 'updatedBy' | 'enforcementMode'>> & { updatedAt: number },
  ): WorkspacePolicy | undefined {
    const existing = this.db
      .prepare('SELECT * FROM workspace_policies WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) return undefined;

    const setClauses: string[] = ['updatedAt = ?'];
    const params: unknown[] = [updates.updatedAt];

    if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { setClauses.push('description = ?'); params.push(updates.description); }
    if (updates.rules !== undefined) { setClauses.push('rules = ?'); params.push(JSON.stringify(updates.rules)); }
    if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
    if (updates.priority !== undefined) { setClauses.push('priority = ?'); params.push(updates.priority); }
    if (updates.expiresAt !== undefined) { setClauses.push('expiresAt = ?'); params.push(updates.expiresAt); }
    if (updates.updatedBy !== undefined) { setClauses.push('updatedBy = ?'); params.push(updates.updatedBy); }
    if (updates.enforcementMode !== undefined) { setClauses.push('enforcementMode = ?'); params.push(updates.enforcementMode); }

    params.push(id);
    this.db.prepare(`UPDATE workspace_policies SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  deactivate(id: string, updatedAt: number, updatedBy?: string): WorkspacePolicy | undefined {
    return this.update(id, { status: 'inactive', updatedAt, updatedBy });
  }

  reset(): void {
    this.db.prepare('DELETE FROM workspace_policies').run();
  }
}
