import { eventBus } from './event_bus';
import { auditLog } from './audit_log';

// ── Worker Node Types ───────────────────────────────────────────────────────

/**
 * Worker status lifecycle:
 *   online  — healthy and accepting work
 *   offline — unreachable or gracefully shut down
 *   busy    — at max concurrency, cannot accept more work
 */
export type WorkerStatus = 'online' | 'offline' | 'busy';

/**
 * WorkerNode — represents a single execution backend that GhostClaw can
 * route work to.  Each worker advertises a set of capabilities (e.g.
 * 'shell_command', 'docker', 'node', 'git') and an execution backend name
 * that maps to a registered IRemoteExecutionAdapter.
 */
export type WorkerNode = {
  /** Globally unique worker identifier. */
  worker_id: string;
  /** Human-readable name for this worker. */
  name: string;
  /** Current operational status. */
  status: WorkerStatus;
  /** Capabilities this worker supports (e.g. 'shell_command', 'docker'). */
  capabilities: string[];
  /** Name of the execution backend this worker routes to. */
  execution_backend: string;
  /** Unix timestamp (ms) of the last heartbeat received. */
  last_heartbeat: number;
  /** Maximum number of concurrent jobs this worker can handle. */
  max_concurrency: number;
  /** Current number of active jobs on this worker. */
  current_load: number;
};

// ── Worker Registry ─────────────────────────────────────────────────────────

let _nextWorkerAuditId = 1;
function nextWorkerAuditId(): string {
  return `audit_wk_${_nextWorkerAuditId++}`;
}

/**
 * WorkerRegistry — manages the lifecycle of worker nodes.
 *
 * Provides registration, heartbeat tracking, capability queries, and
 * automatic offline detection.  Emits runtime events for all state
 * transitions.
 */
export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerNode>();

  /**
   * Register a new worker node.
   * Emits 'worker.registered' and appends an audit entry.
   */
  registerWorker(worker: WorkerNode): WorkerNode {
    this.workers.set(worker.worker_id, worker);

    eventBus.emit('worker.registered', worker);
    auditLog.append({
      id: nextWorkerAuditId(),
      eventType: 'worker.registered',
      objectType: 'WorkerNode',
      objectId: worker.worker_id,
      actorId: 'worker-registry',
      timestamp: Date.now(),
      summary: `Worker registered: ${worker.name} (backend: ${worker.execution_backend})`,
      metadata: {
        capabilities: worker.capabilities,
        max_concurrency: worker.max_concurrency,
      },
    });

    return worker;
  }

  /**
   * Unregister a worker node, removing it from the registry.
   * Returns true if the worker was found and removed.
   */
  unregisterWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return false;
    }

    this.workers.delete(workerId);

    auditLog.append({
      id: nextWorkerAuditId(),
      eventType: 'worker.unregistered',
      objectType: 'WorkerNode',
      objectId: workerId,
      actorId: 'worker-registry',
      timestamp: Date.now(),
      summary: `Worker unregistered: ${worker.name}`,
    });

    return true;
  }

  /**
   * Update heartbeat for a worker.  Marks the worker as 'online' if it
   * was previously 'offline'.
   * Emits 'worker.heartbeat'.
   */
  updateHeartbeat(workerId: string): WorkerNode | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return undefined;
    }

    const wasOffline = worker.status === 'offline';
    worker.last_heartbeat = Date.now();

    if (wasOffline) {
      worker.status = 'online';
    }

    eventBus.emit('worker.heartbeat', worker);

    return worker;
  }

  /**
   * Mark a worker as offline.
   * Emits 'worker.offline'.
   */
  markOffline(workerId: string): WorkerNode | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return undefined;
    }

    worker.status = 'offline';

    eventBus.emit('worker.offline', worker);
    auditLog.append({
      id: nextWorkerAuditId(),
      eventType: 'worker.offline',
      objectType: 'WorkerNode',
      objectId: workerId,
      actorId: 'worker-registry',
      timestamp: Date.now(),
      summary: `Worker went offline: ${worker.name}`,
    });

    return worker;
  }

  /**
   * Check all workers for stale heartbeats and mark them offline.
   * @param timeoutMs — milliseconds after which a worker is considered stale.
   */
  detectOfflineWorkers(timeoutMs: number): WorkerNode[] {
    const now = Date.now();
    const offlined: WorkerNode[] = [];

    for (const worker of this.workers.values()) {
      if (worker.status !== 'offline' && now - worker.last_heartbeat > timeoutMs) {
        this.markOffline(worker.worker_id);
        offlined.push(worker);
      }
    }

    return offlined;
  }

  /**
   * List all registered workers.
   */
  listWorkers(): WorkerNode[] {
    return Array.from(this.workers.values());
  }

  /**
   * Find workers that support a given capability.
   */
  getWorkerByCapability(capability: string): WorkerNode[] {
    return Array.from(this.workers.values()).filter((w) =>
      w.capabilities.includes(capability),
    );
  }

  /**
   * Get a specific worker by ID.
   */
  getWorkerById(workerId: string): WorkerNode | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Increment the current load on a worker.
   * If load reaches max_concurrency, status transitions to 'busy'.
   */
  incrementLoad(workerId: string): WorkerNode | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return undefined;
    }

    worker.current_load += 1;
    if (worker.current_load >= worker.max_concurrency) {
      worker.status = 'busy';
    }

    return worker;
  }

  /**
   * Decrement the current load on a worker.
   * If the worker was 'busy' and load drops below max_concurrency, transitions back to 'online'.
   */
  decrementLoad(workerId: string): WorkerNode | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return undefined;
    }

    worker.current_load = Math.max(0, worker.current_load - 1);
    if (worker.status === 'busy' && worker.current_load < worker.max_concurrency) {
      worker.status = 'online';
    }

    return worker;
  }

  /**
   * Clear all workers. For test isolation only.
   */
  reset(): void {
    this.workers.clear();
    _nextWorkerAuditId = 1;
  }
}

export const workerRegistry = new WorkerRegistry();
