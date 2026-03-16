import type { PackageInstallStatus } from '../../ghost_mart_package';
import type { WorkspaceInstallRecord } from '../../ghost_mart_workspace_install';

/**
 * IWorkspaceInstallStore — storage interface for per-workspace package install records.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md § install_status
 * Runtime chain:  GhostMartInstaller writes install records through this interface.
 *
 * Each workspace can install the same package independently, with its own
 * configuration overrides and lifecycle state.
 */
export interface IWorkspaceInstallStore {
  create(record: WorkspaceInstallRecord): WorkspaceInstallRecord;
  getById(id: string): WorkspaceInstallRecord | undefined;
  getByWorkspaceAndPackage(
    workspaceId: string,
    packageId: string,
  ): WorkspaceInstallRecord | undefined;
  listByWorkspace(workspaceId: string): WorkspaceInstallRecord[];
  listByPackage(packageId: string): WorkspaceInstallRecord[];
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
  ): WorkspaceInstallRecord | undefined;
  reset(): void;
}
