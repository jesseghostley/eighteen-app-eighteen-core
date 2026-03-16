import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import type { GhostMartPackage } from './ghost_mart_package';
import { ghostMartPackageStore } from './ghost_mart_package';
import { workspaceInstallStore } from './ghost_mart_workspace_install';
import type { WorkerBackendManifest, BackendTrustLevel } from './worker_backend_manifest';
import type { WorkerBackendRegistry } from './worker_backend_manifest';
import type { PackageCompatibilityChecker } from './package_compatibility';
import type { WorkspacePolicy } from './workspace_policy';
import { workspacePolicyStore } from './workspace_policy';
import type { RemoteExecutionType } from './remote_execution';

// ── Blueprint Launch Metadata ───────────────────────────────────────────────

/**
 * BlueprintLaunchMetadata — declares the runtime prerequisites a blueprint
 * needs before it can be considered launch-ready in a workspace.
 *
 * This extends beyond package-level compatibility: it captures the
 * aggregate requirements of the entire blueprint (all constituent
 * packages, execution backends, policy clearance, and config/secrets).
 */
export type BlueprintLaunchMetadata = {
  /** The blueprint package_id this metadata applies to. */
  blueprint_id: string;
  /** Execution types the blueprint needs at runtime. */
  required_execution_types: RemoteExecutionType[];
  /** Capabilities required from backends. */
  required_capabilities: string[];
  /** Minimum backend trust level for the blueprint to operate. */
  minimum_trust_level: BackendTrustLevel;
  /** Whether the blueprint requires backends that support approval. */
  requires_approval: boolean;
  /** Backend types the blueprint is compatible with (empty = any). */
  compatible_backend_types: string[];
  /** Config keys that must be present in the workspace install config. */
  required_config_keys: string[];
  /** Secret keys that must be present (checked by key name only). */
  required_secret_keys: string[];
  /** Policy types that must have at least one active policy in the workspace. */
  required_policy_types: Array<'execution' | 'publish' | 'safety' | 'workspace'>;
};

// ── Launch Readiness Result ─────────────────────────────────────────────────

/**
 * MissingRequirement — a single unmet prerequisite for blueprint launch.
 */
export type MissingRequirement = {
  /** Category of the missing requirement. */
  category: 'package' | 'backend' | 'trust' | 'approval' | 'config' | 'secret' | 'policy' | 'workspace_scope';
  /** Human-readable description of the missing requirement. */
  description: string;
};

/**
 * BlueprintLaunchReadinessResult — the outcome of a blueprint readiness check.
 */
export type BlueprintLaunchReadinessResult = {
  /** Whether the blueprint is ready to launch. */
  ready: boolean;
  /** The blueprint package_id checked. */
  blueprint_id: string;
  /** The workspace ID checked. */
  workspace_id: string;
  /** All missing requirements (empty if ready). */
  missing_requirements: MissingRequirement[];
  /** Compatible backends found for the blueprint. */
  compatible_backends: WorkerBackendManifest[];
  /** Human-readable failure reasons (empty if ready). */
  failure_reasons: string[];
};

// ── Trust Level Ordering ────────────────────────────────────────────────────

const TRUST_LEVEL_RANK: Record<BackendTrustLevel, number> = {
  untrusted: 0,
  restricted: 1,
  trusted: 2,
};

function meetsMinimumTrustLevel(
  backendTrust: BackendTrustLevel,
  requiredMinimum: BackendTrustLevel,
): boolean {
  return TRUST_LEVEL_RANK[backendTrust] >= TRUST_LEVEL_RANK[requiredMinimum];
}

// ── Blueprint Launch Readiness Checker ──────────────────────────────────────

let _nextLaunchAuditId = 1;
function nextLaunchAuditId(): string {
  return `audit_bl_${_nextLaunchAuditId++}`;
}

/**
 * BlueprintLaunchReadinessChecker — evaluates whether a blueprint is
 * launch-ready in a given workspace.
 *
 * Checks:
 * 1. Blueprint package exists and is a blueprint type
 * 2. All dependency packages are installed in the workspace
 * 3. All dependency packages are enabled in the workspace
 * 4. Required execution types are available via backends
 * 5. Required capabilities are available via backends
 * 6. Minimum trust level is satisfied by at least one backend
 * 7. Workspace scope is compatible
 * 8. Approval requirements are met by backends
 * 9. Required policy types are present and active in the workspace
 * 10. Required config/secret keys are present
 *
 * Optionally delegates per-package backend checks to a
 * PackageCompatibilityChecker if one is provided.
 */
export class BlueprintLaunchReadinessChecker {
  private readonly metadata = new Map<string, BlueprintLaunchMetadata>();

  constructor(
    private readonly backendRegistry: WorkerBackendRegistry,
    private readonly compatibilityChecker?: PackageCompatibilityChecker,
  ) {}

  /**
   * Register launch metadata for a blueprint.
   */
  registerMetadata(meta: BlueprintLaunchMetadata): void {
    this.metadata.set(meta.blueprint_id, meta);
  }

  /**
   * Get launch metadata for a blueprint.
   */
  getMetadata(blueprintId: string): BlueprintLaunchMetadata | undefined {
    return this.metadata.get(blueprintId);
  }

  /**
   * Validate whether a blueprint is launch-ready in a workspace.
   */
  validateBlueprintLaunchReadiness(
    blueprintId: string,
    workspaceId: string,
  ): BlueprintLaunchReadinessResult {
    const missing = this.listMissingRequirementsForBlueprint(blueprintId, workspaceId);
    const compatibleBackends = this.findCompatibleBackends(blueprintId, workspaceId);

    const result: BlueprintLaunchReadinessResult = {
      ready: missing.length === 0,
      blueprint_id: blueprintId,
      workspace_id: workspaceId,
      missing_requirements: missing,
      compatible_backends: compatibleBackends,
      failure_reasons: missing.map((m) => m.description),
    };

    if (result.ready) {
      this.emitSatisfied(result);
    } else {
      this.emitFailed(result);
    }

    return result;
  }

  /**
   * Produce human-readable explanations of why a blueprint cannot launch.
   */
  explainBlueprintLaunchFailure(
    blueprintId: string,
    workspaceId: string,
  ): string[] {
    const missing = this.listMissingRequirementsForBlueprint(blueprintId, workspaceId);
    return missing.map((m) => m.description);
  }

  /**
   * List all missing requirements for a blueprint in a workspace.
   */
  listMissingRequirementsForBlueprint(
    blueprintId: string,
    workspaceId: string,
  ): MissingRequirement[] {
    const missing: MissingRequirement[] = [];

    // 1. Blueprint must exist
    const blueprint = ghostMartPackageStore.getById(blueprintId);
    if (!blueprint) {
      missing.push({
        category: 'package',
        description: `Blueprint '${blueprintId}' not found in package store.`,
      });
      return missing;
    }

    if (blueprint.package_type !== 'blueprint') {
      missing.push({
        category: 'package',
        description: `Package '${blueprintId}' is type '${blueprint.package_type}', not 'blueprint'.`,
      });
      return missing;
    }

    // 2–3. Check dependency packages installed + enabled
    for (const depId of blueprint.dependencies) {
      const depPkg = ghostMartPackageStore.getById(depId);
      if (!depPkg) {
        missing.push({
          category: 'package',
          description: `Required package '${depId}' is not available in the package store.`,
        });
        continue;
      }

      const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(workspaceId, depId);
      if (!installRecord) {
        missing.push({
          category: 'package',
          description: `Required package '${depId}' is not installed in workspace '${workspaceId}'.`,
        });
        continue;
      }

      if (installRecord.install_status !== 'enabled') {
        missing.push({
          category: 'package',
          description: `Required package '${depId}' is installed but not enabled (status: '${installRecord.install_status}').`,
        });
      }

      // Per-package backend compatibility check (if checker available)
      if (this.compatibilityChecker) {
        const compat = this.compatibilityChecker.validatePackageCompatibility(depId, workspaceId);
        if (!compat.compatible) {
          missing.push({
            category: 'backend',
            description: `Package '${depId}' has no compatible backend: ${compat.failure_reasons[0]}`,
          });
        }
      }
    }

    // 4–8. Blueprint-level backend requirements (from metadata)
    const meta = this.metadata.get(blueprintId);
    if (meta) {
      this.checkBackendRequirements(meta, workspaceId, missing);
      this.checkPolicyRequirements(meta, workspaceId, missing);
      this.checkConfigRequirements(meta, blueprintId, workspaceId, missing);
    }

    return missing;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private checkBackendRequirements(
    meta: BlueprintLaunchMetadata,
    workspaceId: string,
    missing: MissingRequirement[],
  ): void {
    const backends = this.backendRegistry.listBackends().filter((b) => {
      if (b.health_status === 'unavailable') return false;
      if (b.workspace_scope !== null && !b.workspace_scope.includes(workspaceId)) return false;
      return true;
    });

    if (backends.length === 0 && (meta.required_execution_types.length > 0 || meta.required_capabilities.length > 0)) {
      missing.push({
        category: 'backend',
        description: `No available backends serve workspace '${workspaceId}'.`,
      });
      return;
    }

    for (const execType of meta.required_execution_types) {
      if (!backends.some((b) => b.supported_execution_types.includes(execType))) {
        missing.push({
          category: 'backend',
          description: `No backend in workspace '${workspaceId}' supports execution type '${execType}'.`,
        });
      }
    }

    for (const cap of meta.required_capabilities) {
      if (!backends.some((b) => b.supported_capabilities.includes(cap))) {
        missing.push({
          category: 'backend',
          description: `No backend in workspace '${workspaceId}' supports capability '${cap}'.`,
        });
      }
    }

    if (!backends.some((b) => meetsMinimumTrustLevel(b.trust_level, meta.minimum_trust_level))) {
      missing.push({
        category: 'trust',
        description: `No backend in workspace '${workspaceId}' meets minimum trust level '${meta.minimum_trust_level}'.`,
      });
    }

    if (meta.requires_approval && !backends.some((b) => b.requires_approval)) {
      missing.push({
        category: 'approval',
        description: `Blueprint requires approval-capable backend, but none in workspace '${workspaceId}' support approval.`,
      });
    }

    if (meta.compatible_backend_types.length > 0) {
      if (!backends.some((b) => meta.compatible_backend_types.includes(b.backend_type))) {
        missing.push({
          category: 'backend',
          description: `No backend in workspace '${workspaceId}' matches compatible types: ${meta.compatible_backend_types.join(', ')}.`,
        });
      }
    }
  }

  private checkPolicyRequirements(
    meta: BlueprintLaunchMetadata,
    workspaceId: string,
    missing: MissingRequirement[],
  ): void {
    for (const policyType of meta.required_policy_types) {
      const activePolicies = workspacePolicyStore.listActive(workspaceId, policyType);
      if (activePolicies.length === 0) {
        missing.push({
          category: 'policy',
          description: `No active '${policyType}' policy in workspace '${workspaceId}'.`,
        });
      }
    }
  }

  private checkConfigRequirements(
    meta: BlueprintLaunchMetadata,
    blueprintId: string,
    workspaceId: string,
    missing: MissingRequirement[],
  ): void {
    const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(workspaceId, blueprintId);
    const config = installRecord?.config ?? {};

    for (const key of meta.required_config_keys) {
      if (!(key in config)) {
        missing.push({
          category: 'config',
          description: `Required config key '${key}' is missing from blueprint install config.`,
        });
      }
    }

    for (const key of meta.required_secret_keys) {
      if (!(key in config)) {
        missing.push({
          category: 'secret',
          description: `Required secret '${key}' is not configured.`,
        });
      }
    }
  }

  private findCompatibleBackends(
    blueprintId: string,
    workspaceId: string,
  ): WorkerBackendManifest[] {
    const meta = this.metadata.get(blueprintId);
    if (!meta) {
      return [];
    }

    return this.backendRegistry.listBackends().filter((b) => {
      if (b.health_status === 'unavailable') return false;
      if (b.workspace_scope !== null && !b.workspace_scope.includes(workspaceId)) return false;
      for (const execType of meta.required_execution_types) {
        if (!b.supported_execution_types.includes(execType)) return false;
      }
      for (const cap of meta.required_capabilities) {
        if (!b.supported_capabilities.includes(cap)) return false;
      }
      if (!meetsMinimumTrustLevel(b.trust_level, meta.minimum_trust_level)) return false;
      if (meta.requires_approval && !b.requires_approval) return false;
      if (meta.compatible_backend_types.length > 0 && !meta.compatible_backend_types.includes(b.backend_type)) return false;
      return true;
    });
  }

  // ── Event Emission ────────────────────────────────────────────────────────

  private emitSatisfied(result: BlueprintLaunchReadinessResult): void {
    eventBus.emit('blueprint.launch_readiness.satisfied', result);
    auditLog.append({
      id: nextLaunchAuditId(),
      eventType: 'blueprint.launch_readiness.satisfied',
      objectType: 'GhostMartPackage',
      objectId: result.blueprint_id,
      actorId: 'blueprint-launch-checker',
      timestamp: Date.now(),
      summary: `Blueprint '${result.blueprint_id}' is launch-ready in workspace '${result.workspace_id}' — ${result.compatible_backends.length} compatible backend(s).`,
      workspaceId: result.workspace_id,
      metadata: {
        compatible_backend_ids: result.compatible_backends.map((b) => b.backend_id),
      },
    });
  }

  private emitFailed(result: BlueprintLaunchReadinessResult): void {
    eventBus.emit('blueprint.launch_readiness.failed', result);
    auditLog.append({
      id: nextLaunchAuditId(),
      eventType: 'blueprint.launch_readiness.failed',
      objectType: 'GhostMartPackage',
      objectId: result.blueprint_id,
      actorId: 'blueprint-launch-checker',
      timestamp: Date.now(),
      summary: `Blueprint '${result.blueprint_id}' not launch-ready: ${result.failure_reasons[0]}`,
      workspaceId: result.workspace_id,
      metadata: {
        missing_count: result.missing_requirements.length,
        categories: [...new Set(result.missing_requirements.map((m) => m.category))],
        failure_reasons: result.failure_reasons,
      },
    });
  }

  /**
   * Clear all metadata. For test isolation only.
   */
  reset(): void {
    this.metadata.clear();
    _nextLaunchAuditId = 1;
  }
}
