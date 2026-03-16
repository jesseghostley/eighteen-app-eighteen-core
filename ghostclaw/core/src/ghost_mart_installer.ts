/**
 * GhostMartInstaller — lifecycle engine for Ghost Mart package installation.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md, ghostclaw_infrastructure_blueprint.md
 * Runtime chain:  manifest → discover → validate → install → register → enable ⇄ disable → uninstall
 *
 * This is a manifest-driven local implementation.  No remote marketplace sync is performed.
 * All lifecycle actions emit events on the EventBus and create AuditLogEntry records.
 *
 * Registration routing by package_type:
 *   skill     → blueprintRegistry (simple Map) keyed by capability id
 *   agent     → agentRegistry.registerAgent()
 *   blueprint → blueprintRegistry Map keyed by package_id
 */

import { randomUUID } from 'crypto';
import type { GhostMartPackage } from './ghost_mart_package';
import { ghostMartPackageStore } from './ghost_mart_package';
import type { WorkspaceInstallRecord } from './ghost_mart_workspace_install';
import { workspaceInstallStore } from './ghost_mart_workspace_install';
import { agentRegistry } from './agent_registry';
import { eventBus } from './event_bus';
import { auditLog } from './audit_log';

/** Known permissions that the installer will accept during validation. */
const KNOWN_PERMISSIONS = new Set([
  'skill_registry.write',
  'skill_registry.read',
  'agent_registry.write',
  'agent_registry.read',
  'event_bus.emit',
  'event_bus.subscribe',
  'audit_log.write',
  'workspace.read',
  'workspace.write',
  'blueprint.register',
]);

/**
 * Simple blueprint registry used when package_type === 'blueprint'.
 * Stored as a Map from package_id → GhostMartPackage for workspace-level retrieval.
 */
const blueprintRegistry = new Map<string, GhostMartPackage>();

/**
 * Simple skill capability registry used when package_type === 'skill'.
 * Stored as a Map from capability_id → GhostMartPackage.
 */
const skillRegistry = new Map<string, GhostMartPackage>();

export class GhostMartInstaller {
  /**
   * discover — loads packages from a manifest array into the package store.
   *
   * Each package in the manifest is upserted with status `available`.
   * Existing packages with the same package_id are overwritten.
   *
   * @param manifest Array of GhostMartPackage definitions to load.
   * @returns The list of discovered packages as stored.
   */
  discover(manifest: GhostMartPackage[]): GhostMartPackage[] {
    const now = Date.now();
    return manifest.map((pkg) => {
      const record: GhostMartPackage = {
        ...pkg,
        install_status: 'available',
        created_at: pkg.created_at ?? now,
        updated_at: now,
      };
      return ghostMartPackageStore.create(record);
    });
  }

  /**
   * validate — checks that a package's dependencies and permissions are satisfied.
   *
   * @param packageId The package_id to validate.
   * @returns { valid: boolean; errors: string[] }
   */
  validate(packageId: string): { valid: boolean; errors: string[] } {
    const pkg = ghostMartPackageStore.getById(packageId);
    const errors: string[] = [];

    if (!pkg) {
      return { valid: false, errors: [`Package '${packageId}' not found in store.`] };
    }

    // Check all dependencies exist in the store
    for (const depId of pkg.dependencies) {
      if (!ghostMartPackageStore.getById(depId)) {
        errors.push(`Dependency '${depId}' is not available in the package store.`);
      }
    }

    // Check all required permissions are recognised
    for (const permission of pkg.permissions_required) {
      if (!KNOWN_PERMISSIONS.has(permission)) {
        errors.push(`Unknown permission '${permission}' is not recognised.`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * install — validates a package and creates a WorkspaceInstallRecord with status `installed`.
   *
   * @param packageId   The package to install.
   * @param workspaceId The target workspace.
   * @param installedBy The operator or system actor identity.
   * @returns The created WorkspaceInstallRecord.
   * @throws Error if validation fails.
   */
  install(
    packageId: string,
    workspaceId: string,
    installedBy: string,
  ): WorkspaceInstallRecord {
    const validation = this.validate(packageId);
    if (!validation.valid) {
      throw new Error(
        `Cannot install package '${packageId}': ${validation.errors.join('; ')}`,
      );
    }

    const now = Date.now();

    // Update package-level status to 'installed'
    ghostMartPackageStore.updateStatus(packageId, 'installed', now);

    const record = workspaceInstallStore.create({
      id: randomUUID(),
      workspace_id: workspaceId,
      package_id: packageId,
      install_status: 'installed',
      installed_at: now,
      installed_by: installedBy,
      enabled_at: null,
      disabled_at: null,
      uninstalled_at: null,
      updated_at: now,
      config: {},
    });

    // Register the package into the appropriate runtime registry
    this.register(packageId, workspaceId);

    // Emit event
    eventBus.emit('package.installed', record);

    // Append audit entry
    auditLog.append({
      id: randomUUID(),
      eventType: 'package.installed',
      objectType: 'WorkspaceInstallRecord',
      objectId: record.id,
      actorId: installedBy,
      timestamp: now,
      summary: `Package '${packageId}' installed into workspace '${workspaceId}'.`,
      workspaceId,
      metadata: { packageId, workspaceId },
    });

    return record;
  }

  /**
   * register — routes the package into the appropriate runtime registry based on package_type.
   *
   * - skill     → writes capabilities into the skillRegistry Map
   * - agent     → calls agentRegistry.registerAgent()
   * - blueprint → writes the package into the blueprintRegistry Map
   *
   * @param packageId   The package to register.
   * @param workspaceId The workspace context (used for scoped registrations).
   */
  register(packageId: string, workspaceId: string): void {
    const pkg = ghostMartPackageStore.getById(packageId);
    if (!pkg) {
      throw new Error(`Cannot register unknown package '${packageId}'.`);
    }

    switch (pkg.package_type) {
      case 'skill':
        for (const capability of pkg.capabilities) {
          skillRegistry.set(`${workspaceId}:${capability}`, pkg);
        }
        break;

      case 'agent':
        agentRegistry.registerAgent(pkg.name, pkg.capabilities);
        break;

      case 'blueprint':
        blueprintRegistry.set(pkg.package_id, pkg);
        break;
    }
  }

  /**
   * enable — transitions an install record to `enabled` and emits the package.enabled event.
   *
   * @param installId The WorkspaceInstallRecord.id to enable.
   * @returns The updated WorkspaceInstallRecord.
   * @throws Error if the record is not found.
   */
  enable(installId: string): WorkspaceInstallRecord {
    const now = Date.now();
    const record = workspaceInstallStore.updateStatus(installId, 'enabled', now, {
      enabled_at: now,
    });

    if (!record) {
      throw new Error(`Install record '${installId}' not found.`);
    }

    eventBus.emit('package.enabled', record);

    auditLog.append({
      id: randomUUID(),
      eventType: 'package.enabled',
      objectType: 'WorkspaceInstallRecord',
      objectId: record.id,
      actorId: 'system',
      timestamp: now,
      summary: `Package '${record.package_id}' enabled in workspace '${record.workspace_id}'.`,
      workspaceId: record.workspace_id,
      metadata: { packageId: record.package_id, workspaceId: record.workspace_id },
    });

    return record;
  }

  /**
   * disable — transitions an install record to `disabled` and emits the package.disabled event.
   *
   * @param installId The WorkspaceInstallRecord.id to disable.
   * @returns The updated WorkspaceInstallRecord.
   * @throws Error if the record is not found.
   */
  disable(installId: string): WorkspaceInstallRecord {
    const now = Date.now();
    const record = workspaceInstallStore.updateStatus(installId, 'disabled', now, {
      disabled_at: now,
    });

    if (!record) {
      throw new Error(`Install record '${installId}' not found.`);
    }

    eventBus.emit('package.disabled', record);

    auditLog.append({
      id: randomUUID(),
      eventType: 'package.disabled',
      objectType: 'WorkspaceInstallRecord',
      objectId: record.id,
      actorId: 'system',
      timestamp: now,
      summary: `Package '${record.package_id}' disabled in workspace '${record.workspace_id}'.`,
      workspaceId: record.workspace_id,
      metadata: { packageId: record.package_id, workspaceId: record.workspace_id },
    });

    return record;
  }

  /**
   * uninstall — removes a package's registration and sets status to `available` on the package.
   *
   * @param installId The WorkspaceInstallRecord.id to uninstall.
   * @returns The updated WorkspaceInstallRecord.
   * @throws Error if the record is not found.
   */
  uninstall(installId: string): WorkspaceInstallRecord {
    const now = Date.now();
    const existing = workspaceInstallStore.getById(installId);

    if (!existing) {
      throw new Error(`Install record '${installId}' not found.`);
    }

    const { package_id, workspace_id } = existing;

    // Remove from runtime registries
    const pkg = ghostMartPackageStore.getById(package_id);
    if (pkg) {
      switch (pkg.package_type) {
        case 'skill':
          for (const capability of pkg.capabilities) {
            skillRegistry.delete(`${workspace_id}:${capability}`);
          }
          break;
        case 'agent':
          // Agent registry does not have a remove method; capability is left in place
          break;
        case 'blueprint':
          blueprintRegistry.delete(package_id);
          break;
      }

      // Reset package-level status back to 'available'
      ghostMartPackageStore.updateStatus(package_id, 'available', now);
    }

    const record = workspaceInstallStore.updateStatus(installId, 'disabled', now, {
      uninstalled_at: now,
    });

    // Record is guaranteed to exist — getById returned it above
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const finalRecord = record!;

    eventBus.emit('package.uninstalled', finalRecord);

    auditLog.append({
      id: randomUUID(),
      eventType: 'package.uninstalled',
      objectType: 'WorkspaceInstallRecord',
      objectId: finalRecord.id,
      actorId: 'system',
      timestamp: now,
      summary: `Package '${package_id}' uninstalled from workspace '${workspace_id}'.`,
      workspaceId: workspace_id,
      metadata: { packageId: package_id, workspaceId: workspace_id },
    });

    return finalRecord;
  }

  /**
   * update — re-validates and re-installs a package in a workspace with the latest version.
   *
   * If an existing install record is found, it is superseded by a new install.
   * The package definition in the store should have been refreshed (e.g. via discover)
   * before calling update.
   *
   * @param packageId   The package to update.
   * @param workspaceId The workspace to update within.
   * @returns The updated WorkspaceInstallRecord.
   * @throws Error if validation fails.
   */
  update(packageId: string, workspaceId: string): WorkspaceInstallRecord {
    const validation = this.validate(packageId);
    if (!validation.valid) {
      throw new Error(
        `Cannot update package '${packageId}': ${validation.errors.join('; ')}`,
      );
    }

    const now = Date.now();

    // Mark existing install as superseded (transition back to available for tracking)
    const existing = workspaceInstallStore.getByWorkspaceAndPackage(
      workspaceId,
      packageId,
    );
    if (existing) {
      workspaceInstallStore.updateStatus(existing.id, 'disabled', now, {
        uninstalled_at: now,
      });
    }

    // Re-install with a fresh record
    ghostMartPackageStore.updateStatus(packageId, 'installed', now);

    const record = workspaceInstallStore.create({
      id: randomUUID(),
      workspace_id: workspaceId,
      package_id: packageId,
      install_status: 'installed',
      installed_at: now,
      installed_by: 'system',
      enabled_at: null,
      disabled_at: null,
      uninstalled_at: null,
      updated_at: now,
      config: existing?.config ?? {},
    });

    // Re-register with updated capabilities
    this.register(packageId, workspaceId);

    eventBus.emit('package.updated', record);

    auditLog.append({
      id: randomUUID(),
      eventType: 'package.updated',
      objectType: 'WorkspaceInstallRecord',
      objectId: record.id,
      actorId: 'system',
      timestamp: now,
      summary: `Package '${packageId}' updated in workspace '${workspaceId}'.`,
      workspaceId,
      metadata: { packageId, workspaceId },
    });

    return record;
  }
}

export const ghostMartInstaller = new GhostMartInstaller();
