import type {
  IRemoteExecutionAdapter,
  RemoteExecutionRequest,
  RemoteExecutionResult,
} from './remote_execution';
import type { WorkerRegistry } from './worker_node';
import { WorkerSelector } from './worker_selector';

// ── Worker-Aware Execution Adapter ──────────────────────────────────────────

/**
 * WorkerExecutionAdapter — wraps a set of named IRemoteExecutionAdapters and
 * uses the WorkerSelector to route RemoteExecutionRequests to the appropriate
 * worker backend.
 *
 * This adapter extends the runtime cleanly: it implements IRemoteExecutionAdapter
 * so it can be used anywhere a standard adapter is expected, but internally it
 * selects a worker, increments/decrements load, and delegates to the worker's
 * execution backend adapter.
 */
export class WorkerExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name = 'worker-execution-adapter';

  private readonly selector: WorkerSelector;
  private readonly backends = new Map<string, IRemoteExecutionAdapter>();

  constructor(
    private readonly registry: WorkerRegistry,
  ) {
    this.selector = new WorkerSelector(registry);
  }

  /**
   * Register an execution backend adapter by name.
   * Workers reference backends by their execution_backend field.
   */
  registerBackend(name: string, adapter: IRemoteExecutionAdapter): void {
    this.backends.set(name, adapter);
  }

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    // Select a worker for this request
    const result = this.selector.select({
      execution_type: request.execution_type,
      required_capabilities: request.requested_capabilities,
      skill_invocation_id: request.skill_invocation_id,
    });

    if (!result.worker) {
      // No worker available — reject the request
      request.status = 'rejected';
      return request;
    }

    const worker = result.worker;
    const backend = this.backends.get(worker.execution_backend);

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
    for (const backend of this.backends.values()) {
      const status = await backend.getStatus(requestId);
      if (status) {
        return status;
      }
    }
    return undefined;
  }

  async getResult(requestId: string): Promise<RemoteExecutionResult | undefined> {
    for (const backend of this.backends.values()) {
      const result = await backend.getResult(requestId);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  async cancel(requestId: string): Promise<boolean> {
    for (const backend of this.backends.values()) {
      const cancelled = await backend.cancel(requestId);
      if (cancelled) {
        return true;
      }
    }
    return false;
  }
}
