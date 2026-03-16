/**
 * WorkspaceInstallRecord — tracks per-workspace install state for a Ghost Mart package.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md § install_status
 * Runtime chain:  GhostMartInstaller → WorkspaceInstallStore
 *
 * Each workspace maintains its own install record per package, allowing
 * different workspaces to be at different lifecycle stages and carry
 * workspace-specific configuration overrides.
 */

import type { IWorkspaceInstallStore } from './storage/interfaces/IWorkspaceInstallStore';
import type { PackageInstallStatus } from './ghost_mart_package';

export type WorkspaceInstallRecord = {
  /** Globally unique identifier for this install record. */
  id: string;
  /** The workspace this install belongs to. */
  workspace_id: string;
  /** The package that was installed. */
  package_id: string;
  /** Current lifecycle status within this workspace. */
  install_status: PackageInstallStatus;
  /** Unix timestamp (milliseconds) when the install was initiated. */
  installed_at: number;
  /** Operator or system actor that triggered the install. */
  installed_by: string;
  /** Unix timestamp (milliseconds) when the package was enabled in this workspace, or null. */
  enabled_at: number | null;
  /** Unix timestamp (milliseconds) when the package was disabled in this workspace, or null. */
  disabled_at: number | null;
  /** Unix timestamp (milliseconds) when the package was uninstalled from this workspace, or null. */
  uninstalled_at: number | null;
  /** Unix timestamp (milliseconds) of last modification. */
  updated_at: number;
  /** Workspace-specific configuration overrides for this package. */
  config: Record<string, unknown>;
};

/**
 * InMemoryWorkspaceInstallStore — Map-backed in-memory store for WorkspaceInstallRecord entries.
 *
 * Follows the same interface-first, Map-based pattern used by InMemoryWorkspacePolicyStore.
 */
export class InMemoryWorkspaceInstallStore implements IWorkspaceInstallStore {
  private readonly records = new Map<string, WorkspaceInstallRecord>();

  create(record: WorkspaceInstallRecord): WorkspaceInstallRecord {
    this.records.set(record.id, record);
    return record;
  }

  getById(id: string): WorkspaceInstallRecord | undefined {
    return this.records.get(id);
  }

  getByWorkspaceAndPackage(
    workspaceId: string,
    packageId: string,
  ): WorkspaceInstallRecord | undefined {
    return Array.from(this.records.values()).find(
      (r) => r.workspace_id === workspaceId && r.package_id === packageId,
    );
  }

  listByWorkspace(workspaceId: string): WorkspaceInstallRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.workspace_id === workspaceId,
    );
  }

  listByPackage(packageId: string): WorkspaceInstallRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.package_id === packageId,
    );
  }

  updateStatus(
    id: string,
    status: PackageInstallStatus,
    updatedAt: number,
    extraFields?: Partial<
      Pick<
        WorkspaceInstallRecord,
        'enabled_at' | 'disabled_at' | 'uninstalled_at'
      >
    >,
  ): WorkspaceInstallRecord | undefined {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }
    record.install_status = status;
    record.updated_at = updatedAt;
    if (extraFields) {
      const defined = Object.fromEntries(
        Object.entries(extraFields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof extraFields>;
      Object.assign(record, defined);
    }
    return record;
  }

  /**
   * Reset is intentionally provided only for test isolation.
   * In production/durable mode this method MUST NOT be called.
   */
  reset(): void {
    this.records.clear();
  }
}

export const workspaceInstallStore = new InMemoryWorkspaceInstallStore();
