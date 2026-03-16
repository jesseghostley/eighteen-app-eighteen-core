import type {
  IRemoteExecutionAdapter,
  RemoteExecutionRequest,
  RemoteExecutionResult,
} from './remote_execution';
import type { WorkerRegistry } from './worker_node';
import type { WorkerBackendRegistry } from './worker_backend_manifest';
import { WorkerSelector } from './worker_selector';

// ── Worker-Aware Execution Adapter ──────────────────────────────────────────

/**
 * WorkerExecutionAdapter — wraps a set of named IRemoteExecutionAdapters and
 * uses the WorkerSelector to route RemoteExecutionRequests to the appropriate
 * worker backend.
 *
 * When a WorkerBackendRegistry is provided, the adapter validates that the
 * selected worker's backend has a registered manifest and that the manifest
 * supports the requested execution type before delegating.
 *
 * This adapter implements IRemoteExecutionAdapter so it can be used anywhere
 * a standard adapter is expected.
 */
export class WorkerExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name = 'worker-execution-adapter';

  private readonly selector: WorkerSelector;
  private readonly adapters = new Map<string, IRemoteExecutionAdapter>();

  constructor(
    private readonly registry: WorkerRegistry,
    private readonly backendRegistry?: WorkerBackendRegistry,
  ) {
    this.selector = new WorkerSelector(registry, backendRegistry);
  }

  /**
   * Register an execution backend adapter by name.
   * Workers reference backends by their execution_backend field.
   */
  registerBackend(name: string, adapter: IRemoteExecutionAdapter): void {
    this.adapters.set(name, adapter);
  }

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    // Select a worker for this request
    const result = this.selector.select({
      execution_type: request.execution_type,
      required_capabilities: request.requested_capabilities,
      skill_invocation_id: request.skill_invocation_id,
      workspace_id: request.workspace_id,
    });

    if (!result.worker) {
      // No worker available — reject the request
      request.status = 'rejected';
      return request;
    }

    const worker = result.worker;
    const backend = this.adapters.get(worker.execution_backend);

    if (!backend) {
      request.status = 'rejected';
      return request;
    }

    // Increment load before dispatching
    this.registry.incrementLoad(worker.worker_id);

    try {
      const submitted = await backend.submit(request);
      return submitted;
    } finally {
      // Decrement load after dispatch completes (success or failure)
      this.registry.decrementLoad(worker.worker_id);
    }
  }

  async getStatus(requestId: string): Promise<RemoteExecutionRequest | undefined> {
    // Delegate to all backends (first match wins)
    for (const backend of this.adapters.values()) {
      const status = await backend.getStatus(requestId);
      if (status) {
        return status;
      }
    }
    return undefined;
  }

  async getResult(requestId: string): Promise<RemoteExecutionResult | undefined> {
    for (const backend of this.adapters.values()) {
      const result = await backend.getResult(requestId);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  async cancel(requestId: string): Promise<boolean> {
    for (const backend of this.adapters.values()) {
      const cancelled = await backend.cancel(requestId);
      if (cancelled) {
        return true;
      }
    }
    return false;
  }
}
