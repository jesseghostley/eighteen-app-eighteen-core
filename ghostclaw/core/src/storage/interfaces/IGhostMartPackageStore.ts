import type { GhostMartPackage, PackageType, PackageInstallStatus } from '../../ghost_mart_package';

/**
 * IGhostMartPackageStore — storage interface for Ghost Mart package metadata.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md
 * Runtime chain:  GhostMartInstaller reads/writes packages through this interface.
 *
 * All implementations MUST be interface-first per GhostClaw storage conventions.
 */
export interface IGhostMartPackageStore {
  create(pkg: GhostMartPackage): GhostMartPackage;
  getById(packageId: string): GhostMartPackage | undefined;
  listAll(): GhostMartPackage[];
  listByType(packageType: PackageType): GhostMartPackage[];
  listByStatus(status: PackageInstallStatus): GhostMartPackage[];
  updateStatus(
    packageId: string,
    status: PackageInstallStatus,
    updatedAt: number,
  ): GhostMartPackage | undefined;
  reset(): void;
}
