import { eventBus } from './event_bus';
import type { WorkerNode } from './worker_node';
import type { WorkerRegistry } from './worker_node';
import type { WorkerBackendRegistry } from './worker_backend_manifest';
import type { SkillInvocation } from './skill_invocation';
import type { RemoteExecutionType } from './remote_execution';

// ── Worker Selection ────────────────────────────────────────────────────────

/**
 * WorkerSelectionCriteria — describes what the runtime needs from a worker
 * in order to execute a given skill invocation.
 */
export type WorkerSelectionCriteria = {
  /** The remote execution type required (maps to capability matching). */
  execution_type: RemoteExecutionType;
  /** Additional capabilities required beyond the execution type. */
  required_capabilities: string[];
  /** The skill invocation being routed (for traceability). */
  skill_invocation_id: string;
  /** Optional workspace ID for workspace-scoped backend filtering. */
  workspace_id?: string;
};

/**
 * WorkerSelectionResult — the outcome of a worker selection attempt.
 */
export type WorkerSelectionResult = {
  /** The selected worker, or null if no suitable worker was found. */
  worker: WorkerNode | null;
  /** Reason for the selection or rejection. */
  reason: string;
  /** Number of candidate workers evaluated. */
  candidates_evaluated: number;
  /** The backend_id of the matched manifest, if manifest validation was used. */
  matched_backend_id?: string;
};

/**
 * WorkerSelector — selects the best available worker for a given skill
 * invocation based on execution type, capability matching, availability,
 * and current load.
 *
 * When a WorkerBackendRegistry is provided, the selector additionally
 * validates that each worker's declared execution_backend has a registered
 * manifest that supports the requested execution type and capabilities,
 * is healthy, and serves the target workspace.
 *
 * Selection algorithm:
 * 1. Filter workers by required capabilities (execution_type + additional)
 * 2. (If backend registry) Validate worker's backend manifest supports the request
 * 3. Filter by availability (status === 'online')
 * 4. Sort by load (lowest current_load / max_concurrency ratio first)
 * 5. Return the best candidate
 *
 * Emits 'worker.selected' when a worker is chosen.
 */
export class WorkerSelector {
  constructor(
    private readonly registry: WorkerRegistry,
    private readonly backendRegistry?: WorkerBackendRegistry,
  ) {}

  /**
   * Select the best worker for the given criteria.
   */
  select(criteria: WorkerSelectionCriteria): WorkerSelectionResult {
    const allWorkers = this.registry.listWorkers();

    // Step 1: Filter by worker-level capabilities
    const requiredCaps = [criteria.execution_type, ...criteria.required_capabilities];
    const capableWorkers = allWorkers.filter((w) =>
      requiredCaps.every((cap) => w.capabilities.includes(cap)),
    );

    if (capableWorkers.length === 0) {
      return {
        worker: null,
        reason: `No workers with required capabilities: ${requiredCaps.join(', ')}`,
        candidates_evaluated: allWorkers.length,
      };
    }

    // Step 2: If backend registry provided, validate worker's backend manifest
    let manifestValidated = capableWorkers;
    if (this.backendRegistry) {
      manifestValidated = capableWorkers.filter((w) => {
        const manifest = this.backendRegistry!.getBackendById(w.execution_backend);
        if (!manifest) return false;
        if (!manifest.supported_execution_types.includes(criteria.execution_type)) return false;
        if (!criteria.required_capabilities.every((cap) => manifest.supported_capabilities.includes(cap))) return false;
        if (manifest.health_status === 'unavailable') return false;
        if (
          criteria.workspace_id &&
          manifest.workspace_scope !== null &&
          !manifest.workspace_scope.includes(criteria.workspace_id)
        ) {
          return false;
        }
        return true;
      });

      if (manifestValidated.length === 0) {
        return {
          worker: null,
          reason: `${capableWorkers.length} capable worker(s) found but none have a compatible backend manifest`,
          candidates_evaluated: capableWorkers.length,
        };
      }
    }

    // Step 3: Filter by availability (online only)
    const availableWorkers = manifestValidated.filter((w) => w.status === 'online');

    if (availableWorkers.length === 0) {
      return {
        worker: null,
        reason: `${manifestValidated.length} capable worker(s) found but none are online`,
        candidates_evaluated: manifestValidated.length,
      };
    }

    // Step 4: Sort by load ratio (lowest first)
    const sorted = [...availableWorkers].sort((a, b) => {
      const loadA = a.max_concurrency > 0 ? a.current_load / a.max_concurrency : 1;
      const loadB = b.max_concurrency > 0 ? b.current_load / b.max_concurrency : 1;
      return loadA - loadB;
    });

    const selected = sorted[0];

    // Step 5: Emit selection event
    eventBus.emit('worker.selected', selected);

    const result: WorkerSelectionResult = {
      worker: selected,
      reason: `Selected worker '${selected.name}' (load: ${selected.current_load}/${selected.max_concurrency})`,
      candidates_evaluated: availableWorkers.length,
    };

    // Attach matched backend ID if backend registry was used
    if (this.backendRegistry) {
      result.matched_backend_id = selected.execution_backend;
    }

    return result;
  }

  /**
   * Convenience method: select a worker for a SkillInvocation given
   * an execution type and additional capabilities.
   */
  selectForInvocation(
    invocation: SkillInvocation,
    executionType: RemoteExecutionType,
    requiredCapabilities: string[] = [],
  ): WorkerSelectionResult {
    return this.select({
      execution_type: executionType,
      required_capabilities: requiredCapabilities,
      skill_invocation_id: invocation.id,
      workspace_id: invocation.workspaceId,
    });
  }
}
