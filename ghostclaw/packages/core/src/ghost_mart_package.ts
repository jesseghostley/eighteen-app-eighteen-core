/**
 * GhostMartPackage — canonical metadata record for a Ghost Mart installable package.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md, ghostclaw_skill_registry.md,
 *                 ghostclaw_agent_registry.md
 * Runtime chain:  GhostMartInstaller → GhostMartPackageStore → skill/agent/blueprint registries
 *
 * Packages are manifest-driven (no remote sync) and may be installed into one or
 * more workspaces.  Each workspace install is tracked separately via
 * WorkspaceInstallRecord in ghost_mart_workspace_install.ts.
 */

import type { IGhostMartPackageStore } from './storage/interfaces/IGhostMartPackageStore';

/** Canonical package categories supported by Ghost Mart V1. */
export type PackageType = 'skill' | 'agent' | 'blueprint';

/**
 * Full lifecycle install status for a Ghost Mart package.
 *
 * State machine: available → installing → installed → enabled ⇄ disabled
 *                installed/enabled → uninstalling → (removed from store)
 *                any → failed
 */
export type PackageInstallStatus =
  | 'available'     // discovered in manifest, not installed
  | 'installing'    // install in progress
  | 'installed'     // installed but not yet enabled
  | 'enabled'       // installed and active
  | 'disabled'      // installed but deactivated
  | 'uninstalling'  // uninstall in progress
  | 'failed';       // install/uninstall failed

export type GhostMartPackage = {
  /** Globally unique package identifier. */
  package_id: string;
  /** Human-readable package name. */
  name: string;
  /** Semantic version string (e.g. '1.0.0'). */
  version: string;
  /** Canonical package category. */
  package_type: PackageType;
  /** Human-readable description of the package's purpose. */
  description: string;
  /** Author or publisher identity. */
  author: string;
  /** List of package_ids this package depends on. */
  dependencies: string[];
  /** Permission identifiers required (e.g. 'skill_registry.write', 'event_bus.emit'). */
  permissions_required: string[];
  /** '*' for global packages, or a specific workspace_id. */
  workspace_scope: string;
  /** Current install lifecycle status. */
  install_status: PackageInstallStatus;
  /** Functional category (e.g. 'seo', 'content', 'automation'). */
  category: string;
  /** Skill IDs or capability identifiers provided by this package. */
  capabilities: string[];
  /** Expected input identifiers. */
  inputs: string[];
  /** Expected output identifiers. */
  outputs: string[];
  /** Canonical install command string. */
  install_command: string;
  /** Unix timestamp (milliseconds) of creation. */
  created_at: number;
  /** Unix timestamp (milliseconds) of last modification. */
  updated_at: number;
};

/**
 * InMemoryGhostMartPackageStore — Map-backed in-memory store for GhostMartPackage records.
 *
 * Follows the same interface-first, Map-based pattern used by InMemoryWorkspacePolicyStore
 * and InMemoryPublishEventStore.
 */
export class InMemoryGhostMartPackageStore implements IGhostMartPackageStore {
  private readonly packages = new Map<string, GhostMartPackage>();

  create(pkg: GhostMartPackage): GhostMartPackage {
    this.packages.set(pkg.package_id, pkg);
    return pkg;
  }

  getById(packageId: string): GhostMartPackage | undefined {
    return this.packages.get(packageId);
  }

  listAll(): GhostMartPackage[] {
    return Array.from(this.packages.values());
  }

  listByType(packageType: PackageType): GhostMartPackage[] {
    return Array.from(this.packages.values()).filter(
      (p) => p.package_type === packageType,
    );
  }

  listByStatus(status: PackageInstallStatus): GhostMartPackage[] {
    return Array.from(this.packages.values()).filter(
      (p) => p.install_status === status,
    );
  }

  updateStatus(
    packageId: string,
    status: PackageInstallStatus,
    updatedAt: number,
  ): GhostMartPackage | undefined {
    const pkg = this.packages.get(packageId);
    if (!pkg) {
      return undefined;
    }
    pkg.install_status = status;
    pkg.updated_at = updatedAt;
    return pkg;
  }

  /**
   * Reset is intentionally provided only for test isolation.
   * In production/durable mode this method MUST NOT be called.
   */
  reset(): void {
    this.packages.clear();
  }
}

export const ghostMartPackageStore = new InMemoryGhostMartPackageStore();
