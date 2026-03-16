import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import type { RemoteExecutionType } from './remote_execution';

// ── Backend Manifest Types ──────────────────────────────────────────────────

/**
 * Health status of a backend.
 *   healthy     — accepting work normally
 *   degraded    — operating with reduced capacity or elevated error rate
 *   unavailable — not accepting work
 */
export type BackendHealthStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * Trust level assigned to a backend.
 *   trusted     — fully trusted, no additional approval needed
 *   restricted  — may require approval for certain execution types
 *   untrusted   — always requires approval
 */
export type BackendTrustLevel = 'trusted' | 'restricted' | 'untrusted';

/**
 * WorkerBackendManifest — declares the identity, capabilities, constraints,
 * and trust level of a single execution backend.
 *
 * Manifests make backends explicitly discoverable and inspectable.  The
 * WorkerSelector and WorkerExecutionAdapter use manifests to validate that
 * a worker's declared backend actually supports the execution type and
 * capabilities required by a given request.
 */
export type WorkerBackendManifest = {
  /** Globally unique backend identifier. */
  backend_id: string;
  /** Human-readable name for this backend. */
  backend_name: string;
  /** Backend type category (e.g. 'container', 'ssh', 'github_actions', 'local'). */
  backend_type: string;
  /** Execution types this backend can handle. */
  supported_execution_types: RemoteExecutionType[];
  /** Capabilities this backend advertises (e.g. 'docker', 'git', 'node'). */
  supported_capabilities: string[];
  /** Optional workspace scope — if set, this backend only serves the listed workspaces. */
  workspace_scope: string[] | null;
  /** Trust level for policy evaluation. */
  trust_level: BackendTrustLevel;
  /** Maximum concurrent executions this backend supports. */
  max_concurrency: number;
  /** Current health status. */
  health_status: BackendHealthStatus;
  /** Whether executions on this backend require explicit approval. */
  requires_approval: boolean;
  /** Provider class identifier (opaque string, e.g. 'PopeClawAdapter', 'LocalStub'). */
  provider_class: string;
};

// ── Backend Registry ────────────────────────────────────────────────────────

let _nextBackendAuditId = 1;
function nextBackendAuditId(): string {
  return `audit_bm_${_nextBackendAuditId++}`;
}

/**
 * WorkerBackendRegistry — manages the lifecycle of backend manifests.
 *
 * Provides registration, lookup by ID/execution-type/capability, health
 * updates, and workspace-scoped filtering.  Emits runtime events and
 * audit entries for all state transitions.
 */
export class WorkerBackendRegistry {
  private readonly backends = new Map<string, WorkerBackendManifest>();

  /**
   * Register a new backend manifest.
   * Emits 'worker_backend.registered' and appends an audit entry.
   */
  registerBackend(manifest: WorkerBackendManifest): WorkerBackendManifest {
    this.backends.set(manifest.backend_id, manifest);

    eventBus.emit('worker_backend.registered', manifest);
    auditLog.append({
      id: nextBackendAuditId(),
      eventType: 'worker_backend.registered',
      objectType: 'WorkerBackendManifest',
      objectId: manifest.backend_id,
      actorId: 'worker-backend-registry',
      timestamp: Date.now(),
      summary: `Backend registered: ${manifest.backend_name} (type: ${manifest.backend_type}, provider: ${manifest.provider_class})`,
      metadata: {
        supported_execution_types: manifest.supported_execution_types,
        supported_capabilities: manifest.supported_capabilities,
        trust_level: manifest.trust_level,
        max_concurrency: manifest.max_concurrency,
        requires_approval: manifest.requires_approval,
      },
    });

    return manifest;
  }

  /**
   * Unregister a backend manifest.
   * Returns true if the backend was found and removed.
   */
  unregisterBackend(backendId: string): boolean {
    const manifest = this.backends.get(backendId);
    if (!manifest) {
      return false;
    }

    this.backends.delete(backendId);

    eventBus.emit('worker_backend.unregistered', manifest);
    auditLog.append({
      id: nextBackendAuditId(),
      eventType: 'worker_backend.unregistered',
      objectType: 'WorkerBackendManifest',
      objectId: backendId,
      actorId: 'worker-backend-registry',
      timestamp: Date.now(),
      summary: `Backend unregistered: ${manifest.backend_name}`,
    });

    return true;
  }

  /**
   * Update an existing backend manifest.
   * Merges the provided fields into the existing manifest.
   * Emits 'worker_backend.updated' and appends an audit entry.
   */
  updateBackend(
    backendId: string,
    updates: Partial<Omit<WorkerBackendManifest, 'backend_id'>>,
  ): WorkerBackendManifest | undefined {
    const manifest = this.backends.get(backendId);
    if (!manifest) {
      return undefined;
    }

    const previousState = { ...manifest };
    Object.assign(manifest, updates);

    eventBus.emit('worker_backend.updated', manifest);
    auditLog.append({
      id: nextBackendAuditId(),
      eventType: 'worker_backend.updated',
      objectType: 'WorkerBackendManifest',
      objectId: backendId,
      actorId: 'worker-backend-registry',
      timestamp: Date.now(),
      summary: `Backend updated: ${manifest.backend_name}`,
      previousState: JSON.stringify(previousState),
      newState: JSON.stringify(manifest),
      metadata: {
        updated_fields: Object.keys(updates),
      },
    });

    return manifest;
  }

  /**
   * List all registered backend manifests.
   */
  listBackends(): WorkerBackendManifest[] {
    return Array.from(this.backends.values());
  }

  /**
   * Get a specific backend manifest by ID.
   */
  getBackendById(backendId: string): WorkerBackendManifest | undefined {
    return this.backends.get(backendId);
  }

  /**
   * Find backends that support a given execution type.
   */
  findBackendsByExecutionType(executionType: RemoteExecutionType): WorkerBackendManifest[] {
    return Array.from(this.backends.values()).filter((b) =>
      b.supported_execution_types.includes(executionType),
    );
  }

  /**
   * Find backends that support a given capability.
   */
  findBackendsByCapability(capability: string): WorkerBackendManifest[] {
    return Array.from(this.backends.values()).filter((b) =>
      b.supported_capabilities.includes(capability),
    );
  }

  /**
   * Find backends available for a given workspace.
   * Returns backends with no workspace scope (global) or whose scope includes the workspace.
   */
  findBackendsForWorkspace(workspaceId: string): WorkerBackendManifest[] {
    return Array.from(this.backends.values()).filter((b) =>
      b.workspace_scope === null || b.workspace_scope.includes(workspaceId),
    );
  }

  /**
   * Find backends matching all the given criteria.
   */
  findCompatibleBackends(
    executionType: RemoteExecutionType,
    requiredCapabilities: string[],
    workspaceId?: string,
  ): WorkerBackendManifest[] {
    return Array.from(this.backends.values()).filter((b) => {
      // Must support the execution type
      if (!b.supported_execution_types.includes(executionType)) return false;
      // Must support all required capabilities
      if (!requiredCapabilities.every((cap) => b.supported_capabilities.includes(cap))) return false;
      // Must be healthy or degraded
      if (b.health_status === 'unavailable') return false;
      // Must serve the workspace (if scoped)
      if (workspaceId && b.workspace_scope !== null && !b.workspace_scope.includes(workspaceId)) return false;
      return true;
    });
  }

  /**
   * Clear all backends. For test isolation only.
   */
  reset(): void {
    this.backends.clear();
    _nextBackendAuditId = 1;
  }
}

export const workerBackendRegistry = new WorkerBackendRegistry();
