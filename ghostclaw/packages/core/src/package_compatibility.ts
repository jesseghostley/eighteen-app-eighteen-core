import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import type { GhostMartPackage } from './ghost_mart_package';
import type { WorkerBackendManifest, BackendTrustLevel } from './worker_backend_manifest';
import type { WorkerBackendRegistry } from './worker_backend_manifest';
import type { RemoteExecutionType } from './remote_execution';

// ── Package Compatibility Metadata ──────────────────────────────────────────

/**
 * PackageCompatibilityMetadata — declares the execution requirements a
 * Ghost Mart package has against the worker/backend system.
 *
 * This metadata is attached to a package (keyed by package_id) and used
 * during install/enable validation to ensure a compatible backend exists
 * in the target workspace before the package is activated.
 */
export type PackageCompatibilityMetadata = {
  /** The package this metadata applies to. */
  package_id: string;
  /** Execution types the package needs at runtime. */
  required_execution_types: RemoteExecutionType[];
  /** Additional capabilities the package needs from a backend. */
  required_capabilities: string[];
  /** Minimum trust level the backend must have. */
  minimum_trust_level: BackendTrustLevel;
  /** Whether the package requires backends that support approval workflows. */
  requires_approval: boolean;
  /** Backend types the package is compatible with (empty = any). */
  compatible_backend_types: string[];
  /** Workspace scope constraints — if set, limits which workspaces the package can serve. */
  workspace_scope_constraints: string[] | null;
};

// ── Compatibility Check Result ──────────────────────────────────────────────

/**
 * CompatibilityCheckResult — the outcome of a package-to-backend
 * compatibility check.
 */
export type CompatibilityCheckResult = {
  /** Whether the package is compatible with the available backends. */
  compatible: boolean;
  /** Compatible backends found (empty if not compatible). */
  compatible_backends: WorkerBackendManifest[];
  /** Human-readable failure reasons (empty if compatible). */
  failure_reasons: string[];
  /** The package ID checked. */
  package_id: string;
  /** The workspace ID checked (if workspace-scoped). */
  workspace_id?: string;
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

// ── Compatibility Checker ───────────────────────────────────────────────────

let _nextCompatAuditId = 1;
function nextCompatAuditId(): string {
  return `audit_pc_${_nextCompatAuditId++}`;
}

/**
 * PackageCompatibilityChecker — validates that a Ghost Mart package's
 * execution requirements can be satisfied by at least one backend in
 * the target workspace.
 *
 * This checker bridges Ghost Mart packages and the WorkerBackendRegistry
 * without coupling them directly.  It reads compatibility metadata for a
 * package and queries the backend registry to determine whether compatible
 * backends exist.
 *
 * All check results emit runtime events and audit entries.
 */
export class PackageCompatibilityChecker {
  private readonly metadata = new Map<string, PackageCompatibilityMetadata>();

  constructor(private readonly backendRegistry: WorkerBackendRegistry) {}

  /**
   * Register compatibility metadata for a package.
   */
  registerMetadata(meta: PackageCompatibilityMetadata): void {
    this.metadata.set(meta.package_id, meta);
  }

  /**
   * Get compatibility metadata for a package.
   */
  getMetadata(packageId: string): PackageCompatibilityMetadata | undefined {
    return this.metadata.get(packageId);
  }

  /**
   * Validate whether a package can be installed/enabled in a given workspace.
   *
   * Checks:
   * 1. Required execution types are supported by at least one backend
   * 2. Required capabilities are supported
   * 3. Backend trust level meets minimum
   * 4. Approval requirement is satisfied
   * 5. Backend type is compatible
   * 6. Workspace scope constraints are met
   * 7. Backend is healthy or degraded (not unavailable)
   */
  validatePackageCompatibility(
    packageId: string,
    workspaceId: string,
  ): CompatibilityCheckResult {
    const meta = this.metadata.get(packageId);

    // No metadata means no compatibility requirements — always compatible
    if (!meta) {
      const result: CompatibilityCheckResult = {
        compatible: true,
        compatible_backends: [],
        failure_reasons: [],
        package_id: packageId,
        workspace_id: workspaceId,
      };
      this.emitChecked(result);
      return result;
    }

    // Check workspace scope constraints on the metadata itself
    if (
      meta.workspace_scope_constraints !== null &&
      !meta.workspace_scope_constraints.includes(workspaceId)
    ) {
      const result: CompatibilityCheckResult = {
        compatible: false,
        compatible_backends: [],
        failure_reasons: [
          `Package '${packageId}' is restricted to workspaces: ${meta.workspace_scope_constraints.join(', ')}`,
        ],
        package_id: packageId,
        workspace_id: workspaceId,
      };
      this.emitFailed(result);
      return result;
    }

    const compatible = this.findCompatibleBackendsForPackage(packageId, workspaceId);

    if (compatible.length === 0) {
      const reasons = this.explainPackageCompatibilityFailure(packageId, workspaceId);
      const result: CompatibilityCheckResult = {
        compatible: false,
        compatible_backends: [],
        failure_reasons: reasons,
        package_id: packageId,
        workspace_id: workspaceId,
      };
      this.emitFailed(result);
      return result;
    }

    const result: CompatibilityCheckResult = {
      compatible: true,
      compatible_backends: compatible,
      failure_reasons: [],
      package_id: packageId,
      workspace_id: workspaceId,
    };
    this.emitSatisfied(result);
    return result;
  }

  /**
   * Find all backends that satisfy a package's compatibility requirements.
   */
  findCompatibleBackendsForPackage(
    packageId: string,
    workspaceId?: string,
  ): WorkerBackendManifest[] {
    const meta = this.metadata.get(packageId);
    if (!meta) {
      return [];
    }

    return this.backendRegistry.listBackends().filter((backend) => {
      // Must support all required execution types
      for (const execType of meta.required_execution_types) {
        if (!backend.supported_execution_types.includes(execType)) return false;
      }

      // Must support all required capabilities
      for (const cap of meta.required_capabilities) {
        if (!backend.supported_capabilities.includes(cap)) return false;
      }

      // Must meet minimum trust level
      if (!meetsMinimumTrustLevel(backend.trust_level, meta.minimum_trust_level)) return false;

      // If package requires approval, backend must support it
      if (meta.requires_approval && !backend.requires_approval) return false;

      // Backend type must be compatible (empty = any)
      if (
        meta.compatible_backend_types.length > 0 &&
        !meta.compatible_backend_types.includes(backend.backend_type)
      ) {
        return false;
      }

      // Backend must not be unavailable
      if (backend.health_status === 'unavailable') return false;

      // Backend must serve the workspace
      if (
        workspaceId &&
        backend.workspace_scope !== null &&
        !backend.workspace_scope.includes(workspaceId)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Produce human-readable explanations of why a package is incompatible
   * with all available backends in a workspace.
   */
  explainPackageCompatibilityFailure(
    packageId: string,
    workspaceId: string,
  ): string[] {
    const meta = this.metadata.get(packageId);
    if (!meta) {
      return [`No compatibility metadata registered for package '${packageId}'.`];
    }

    const allBackends = this.backendRegistry.listBackends();
    if (allBackends.length === 0) {
      return ['No backends are registered in the WorkerBackendRegistry.'];
    }

    // Collect per-backend explanations
    const reasons: string[] = [];

    // Filter to workspace-serving backends first
    const workspaceBackends = allBackends.filter((b) =>
      b.workspace_scope === null || b.workspace_scope.includes(workspaceId),
    );

    if (workspaceBackends.length === 0) {
      reasons.push(`No backends serve workspace '${workspaceId}'.`);
      return reasons;
    }

    // Check each requirement category across all workspace backends
    for (const execType of meta.required_execution_types) {
      const supportsExec = workspaceBackends.some((b) =>
        b.supported_execution_types.includes(execType),
      );
      if (!supportsExec) {
        reasons.push(
          `No backend in workspace '${workspaceId}' supports execution type '${execType}'.`,
        );
      }
    }

    for (const cap of meta.required_capabilities) {
      const supportsCap = workspaceBackends.some((b) =>
        b.supported_capabilities.includes(cap),
      );
      if (!supportsCap) {
        reasons.push(
          `No backend in workspace '${workspaceId}' supports capability '${cap}'.`,
        );
      }
    }

    const meetsTrust = workspaceBackends.some((b) =>
      meetsMinimumTrustLevel(b.trust_level, meta.minimum_trust_level),
    );
    if (!meetsTrust) {
      reasons.push(
        `No backend in workspace '${workspaceId}' meets minimum trust level '${meta.minimum_trust_level}'.`,
      );
    }

    if (meta.requires_approval) {
      const hasApproval = workspaceBackends.some((b) => b.requires_approval);
      if (!hasApproval) {
        reasons.push(
          `Package requires approval-capable backend, but none in workspace '${workspaceId}' support approval.`,
        );
      }
    }

    if (meta.compatible_backend_types.length > 0) {
      const hasType = workspaceBackends.some((b) =>
        meta.compatible_backend_types.includes(b.backend_type),
      );
      if (!hasType) {
        reasons.push(
          `No backend in workspace '${workspaceId}' matches compatible types: ${meta.compatible_backend_types.join(', ')}.`,
        );
      }
    }

    const hasHealthy = workspaceBackends.some((b) => b.health_status !== 'unavailable');
    if (!hasHealthy) {
      reasons.push(
        `All backends in workspace '${workspaceId}' are unavailable.`,
      );
    }

    // If no specific reason found, provide a generic one
    if (reasons.length === 0) {
      reasons.push(
        `No single backend satisfies all requirements for package '${packageId}' in workspace '${workspaceId}'.`,
      );
    }

    return reasons;
  }

  // ── Event Emission ──────────────────────────────────────────────────────

  private emitChecked(result: CompatibilityCheckResult): void {
    eventBus.emit('package.compatibility.checked', result);
    auditLog.append({
      id: nextCompatAuditId(),
      eventType: 'package.compatibility.checked',
      objectType: 'GhostMartPackage',
      objectId: result.package_id,
      actorId: 'package-compatibility-checker',
      timestamp: Date.now(),
      summary: `Compatibility check passed for package '${result.package_id}' (no requirements).`,
      workspaceId: result.workspace_id,
      metadata: { compatible: true },
    });
  }

  private emitSatisfied(result: CompatibilityCheckResult): void {
    eventBus.emit('package.compatibility.satisfied', result);
    auditLog.append({
      id: nextCompatAuditId(),
      eventType: 'package.compatibility.satisfied',
      objectType: 'GhostMartPackage',
      objectId: result.package_id,
      actorId: 'package-compatibility-checker',
      timestamp: Date.now(),
      summary: `Compatibility satisfied for package '${result.package_id}' — ${result.compatible_backends.length} compatible backend(s).`,
      workspaceId: result.workspace_id,
      metadata: {
        compatible_backend_ids: result.compatible_backends.map((b) => b.backend_id),
      },
    });
  }

  private emitFailed(result: CompatibilityCheckResult): void {
    eventBus.emit('package.compatibility.failed', result);
    auditLog.append({
      id: nextCompatAuditId(),
      eventType: 'package.compatibility.failed',
      objectType: 'GhostMartPackage',
      objectId: result.package_id,
      actorId: 'package-compatibility-checker',
      timestamp: Date.now(),
      summary: `Compatibility failed for package '${result.package_id}': ${result.failure_reasons[0]}`,
      workspaceId: result.workspace_id,
      metadata: {
        failure_reasons: result.failure_reasons,
      },
    });
  }

  /**
   * Clear all metadata. For test isolation only.
   */
  reset(): void {
    this.metadata.clear();
    _nextCompatAuditId = 1;
  }
}
