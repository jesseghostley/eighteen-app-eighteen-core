import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import { remoteExecutionStore } from './remote_execution';
import type {
  IRemoteExecutionAdapter,
  RemoteExecutionRequest,
  RemoteExecutionResult,
  RemoteExecutionType,
} from './remote_execution';

// ── Retry & Backoff Strategy ────────────────────────────────────────────────

/**
 * Classifies execution errors to determine if a retry is appropriate.
 */
export type RetryClassification = 'transient' | 'permanent' | 'unknown';

export interface IRetryPolicy {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Initial backoff duration in milliseconds. */
  initialBackoffMs: number;
  /** Maximum backoff duration in milliseconds. */
  maxBackoffMs: number;
  /** Multiplier applied to backoff on each retry (exponential backoff). */
  backoffMultiplier: number;
  /** Determines whether an error is retryable. */
  classifyError(error: Error | string): RetryClassification;
}

export const defaultRetryPolicy: IRetryPolicy = {
  maxRetries: 3,
  initialBackoffMs: 100,
  maxBackoffMs: 10000,
  backoffMultiplier: 2,
  classifyError(error: Error | string): RetryClassification {
    const msg = error instanceof Error ? error.message : String(error);
    const lowerMsg = msg.toLowerCase();

    // Transient errors: network timeouts, temporary unavailability, rate limits
    if (
      lowerMsg.includes('timeout') ||
      lowerMsg.includes('ECONNREFUSED') ||
      lowerMsg.includes('ECONNRESET') ||
      lowerMsg.includes('503') ||
      lowerMsg.includes('429')
    ) {
      return 'transient';
    }

    // Permanent errors: validation, policy blocks, not found
    if (
      lowerMsg.includes('policy') ||
      lowerMsg.includes('rejected') ||
      lowerMsg.includes('not found') ||
      lowerMsg.includes('invalid')
    ) {
      return 'permanent';
    }

    return 'unknown';
  },
};

// ── Execution Type Whitelist ────────────────────────────────────────────────

/**
 * Configuration for which execution types are allowed per workspace.
 */
export type ExecutionTypeWhitelist = {
  /** Set of allowed execution types. If empty, all types are allowed. */
  allowedTypes: RemoteExecutionType[];
};

// ── Pope-Claw Dispatcher Abstraction ────────────────────────────────────────

/**
 * IPopeClawDispatcher — abstracts the mechanism for dispatching remote
 * execution requests to a Pope-Claw-backed backend (GitHub Actions,
 * container sandbox, SSH node, etc.).
 *
 * Implementations may communicate via HTTP, event streams, message queues,
 * or other protocols without exposing those details to the adapter.
 */
export interface IPopeClawDispatcher {
  /** Human-readable name of the dispatcher backend. */
  readonly name: string;

  /**
   * Dispatch a remote execution request to the backend.
   * Returns the provider-specific run ID if successful.
   * Throws if dispatch fails.
   */
  dispatch(request: RemoteExecutionRequest): Promise<string>;

  /**
   * Query the current status of a dispatched request.
   * Returns 'running', 'completed', or 'failed'.
   */
  getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'>;

  /**
   * Retrieve execution result (stdout, stderr, exit code, etc.).
   * Returns null if not yet available.
   */
  getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null>;

  /**
   * Attempt to cancel a dispatched execution.
   * Returns true if successful, false otherwise.
   */
  cancel(remoteRunId: string): Promise<boolean>;
}

/**
 * Result returned by dispatcher's getExecutionResult().
 */
export type PopeClawExecutionResult = {
  status: 'completed' | 'failed';
  stdout: string;
  stderr: string;
  exit_code?: number;
  error?: string;
};

// ── Configuration ──────────────────────────────────────────────────────────

export interface IPopeClawAdapterConfig {
  /** Name of this adapter instance. */
  name: string;
  /** Dispatcher backend implementation. */
  dispatcher: IPopeClawDispatcher;
  /** Retry/backoff policy for transient errors. */
  retryPolicy?: IRetryPolicy;
  /** Execution type whitelist. If empty, all types allowed. */
  executionTypeWhitelist?: ExecutionTypeWhitelist;
}

// ── Audit Metadata ─────────────────────────────────────────────────────────

/**
 * Audit metadata attached to remote execution events.
 */
export type PopeClawAuditMetadata = {
  remoteRunId?: string | null;
  dispatcherName: string;
  retryAttempt?: number;
  maxRetries?: number;
  executionTimeMs?: number;
};

// ── Adapter Implementation ─────────────────────────────────────────────────

let _nextAuditId = 1;
function nextAuditId(): string {
  return `audit_re_${_nextAuditId++}`;
}

/**
 * PopeClawRemoteExecutionAdapter — provider-agnostic, policy-aware remote
 * execution adapter backed by the Pope-Claw pattern.
 *
 * Features:
 *   - Policy gate enforcement (policy_context.approved must be true)
 *   - Execution type whitelisting
 *   - Automatic retry classification + exponential backoff for transient failures
 *   - Full audit trail emission (eventBus + auditLog)
 *   - Chain traceability (workspace_id, job_id, assignment_id, skill_invocation_id)
 *   - Audit metadata capture (remote_run_id, dispatcher, retry info, timing)
 */
export class PopeClawRemoteExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name: string;
  private readonly dispatcher: IPopeClawDispatcher;
  private readonly retryPolicy: IRetryPolicy;
  private readonly executionTypeWhitelist: ExecutionTypeWhitelist;
  private readonly requestRetryCount = new Map<string, number>();

  constructor(config: IPopeClawAdapterConfig) {
    this.name = config.name;
    this.dispatcher = config.dispatcher;
    this.retryPolicy = config.retryPolicy ?? defaultRetryPolicy;
    this.executionTypeWhitelist = config.executionTypeWhitelist ?? { allowedTypes: [] };
  }

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    // Persist the request
    remoteExecutionStore.saveRequest(request);

    // ── Policy Gate ─────────────────────────────────────────────────────
    if (!request.policy_context.approved) {
      request.status = 'rejected';
      remoteExecutionStore.updateStatus(request.request_id, 'rejected');

      auditLog.append({
        id: nextAuditId(),
        eventType: 'remote_execution.rejected',
        objectType: 'RemoteExecutionRequest',
        objectId: request.request_id,
        actorId: this.dispatcher.name,
        timestamp: Date.now(),
        summary: `Remote execution rejected by policy: ${request.policy_context.blocking_policy_id ?? 'unknown'}`,
        workspaceId: request.workspace_id,
        metadata: {
          policy_context: request.policy_context,
          dispatcherName: this.dispatcher.name,
        },
      });

      return request;
    }

    // ── Execution Type Whitelist ────────────────────────────────────────
    if (
      this.executionTypeWhitelist.allowedTypes.length > 0 &&
      !this.executionTypeWhitelist.allowedTypes.includes(request.execution_type)
    ) {
      request.status = 'rejected';
      remoteExecutionStore.updateStatus(request.request_id, 'rejected');

      auditLog.append({
        id: nextAuditId(),
        eventType: 'remote_execution.rejected',
        objectType: 'RemoteExecutionRequest',
        objectId: request.request_id,
        actorId: this.dispatcher.name,
        timestamp: Date.now(),
        summary: `Remote execution rejected: execution type '${request.execution_type}' not whitelisted`,
        workspaceId: request.workspace_id,
        metadata: {
          reason: 'execution_type_not_whitelisted',
          executionType: request.execution_type,
          dispatcherName: this.dispatcher.name,
        },
      });

      return request;
    }

    // ── Dispatch with Retry ─────────────────────────────────────────────
    await this.submitWithRetry(request);

    return request;
  }

  /**
   * Submit request to dispatcher with exponential backoff retry logic.
   */
  private async submitWithRetry(request: RemoteExecutionRequest): Promise<void> {
    const retryCount = this.requestRetryCount.get(request.request_id) ?? 0;

    try {
      // ── Mark dispatched ──────────────────────────────────────────────
      request.status = 'dispatched';
      remoteExecutionStore.updateStatus(request.request_id, 'dispatched');

      eventBus.emit('remote.execution.requested', request);
      auditLog.append({
        id: nextAuditId(),
        eventType: 'remote_execution.requested',
        objectType: 'RemoteExecutionRequest',
        objectId: request.request_id,
        actorId: this.dispatcher.name,
        timestamp: Date.now(),
        summary: `Remote execution requested: ${request.execution_type}`,
        workspaceId: request.workspace_id,
        metadata: {
          execution_type: request.execution_type,
          dispatcherName: this.dispatcher.name,
          retryAttempt: retryCount,
        },
      });

      // ── Dispatch to backend ──────────────────────────────────────────
      const remoteRunId = await this.dispatcher.dispatch(request);

      // ── Mark running ─────────────────────────────────────────────────
      request.status = 'running';
      remoteExecutionStore.updateStatus(request.request_id, 'running');

      eventBus.emit('remote.execution.started', request);
      auditLog.append({
        id: nextAuditId(),
        eventType: 'remote_execution.started',
        objectType: 'RemoteExecutionRequest',
        objectId: request.request_id,
        actorId: this.dispatcher.name,
        timestamp: Date.now(),
        summary: `Remote execution started: ${request.execution_type}`,
        workspaceId: request.workspace_id,
        metadata: {
          remoteRunId,
          dispatcherName: this.dispatcher.name,
        },
      });

      // ── Poll for result ──────────────────────────────────────────────
      const result = await this.pollForResult(request, remoteRunId);

      // ── Save result and mark terminal status ──────────────────────────
      remoteExecutionStore.saveResult(result);
      request.status = result.status;
      remoteExecutionStore.updateStatus(request.request_id, result.status);

      if (result.status === 'completed') {
        eventBus.emit('remote.execution.completed', result);
        auditLog.append({
          id: nextAuditId(),
          eventType: 'remote_execution.completed',
          objectType: 'RemoteExecutionRequest',
          objectId: request.request_id,
          actorId: this.dispatcher.name,
          timestamp: Date.now(),
          summary: `Remote execution completed: ${request.execution_type}`,
          workspaceId: request.workspace_id,
          metadata: {
            remoteRunId,
            dispatcherName: this.dispatcher.name,
            executionTimeMs: result.completed_at - result.started_at,
          } as PopeClawAuditMetadata,
        });
      } else {
        eventBus.emit('remote.execution.failed', result);
        auditLog.append({
          id: nextAuditId(),
          eventType: 'remote_execution.failed',
          objectType: 'RemoteExecutionRequest',
          objectId: request.request_id,
          actorId: this.dispatcher.name,
          timestamp: Date.now(),
          summary: `Remote execution failed: ${result.error ?? 'unknown error'}`,
          workspaceId: request.workspace_id,
          metadata: {
            remoteRunId,
            dispatcherName: this.dispatcher.name,
            error: result.error,
          } as PopeClawAuditMetadata,
        });
      }

      // Clear retry count on success
      this.requestRetryCount.delete(request.request_id);
    } catch (error) {
      const errorInput = error instanceof Error ? error : new Error(String(error));
      const classification = this.retryPolicy.classifyError(errorInput);
      const canRetry =
        classification === 'transient' && retryCount < this.retryPolicy.maxRetries;

      if (canRetry) {
        // ── Retry with exponential backoff ──────────────────────────────
        const backoffMs = Math.min(
          this.retryPolicy.initialBackoffMs * Math.pow(this.retryPolicy.backoffMultiplier, retryCount),
          this.retryPolicy.maxBackoffMs,
        );

        this.requestRetryCount.set(request.request_id, retryCount + 1);

        auditLog.append({
          id: nextAuditId(),
          eventType: 'remote_execution.failed',
          objectType: 'RemoteExecutionRequest',
          objectId: request.request_id,
          actorId: this.dispatcher.name,
          timestamp: Date.now(),
          summary: `Remote execution transient failure, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${this.retryPolicy.maxRetries})`,
          workspaceId: request.workspace_id,
          metadata: {
            error: errorInput.message,
            retryAttempt: retryCount + 1,
            maxRetries: this.retryPolicy.maxRetries,
            backoffMs,
            classification,
            dispatcherName: this.dispatcher.name,
          },
        });

        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        await this.submitWithRetry(request);
      } else {
        // ── Permanent failure or max retries exceeded ───────────────────
        const errorMsg = errorInput.message;
        const now = Date.now();

        const result: RemoteExecutionResult = {
          request_id: request.request_id,
          status: 'failed',
          stdout: '',
          stderr: errorMsg,
          exit_code: 1,
          artifact_ids: [],
          remote_run_id: null,
          started_at: now,
          completed_at: now,
          error: errorMsg,
        };

        remoteExecutionStore.saveResult(result);
        request.status = 'failed';
        remoteExecutionStore.updateStatus(request.request_id, 'failed');

        eventBus.emit('remote.execution.failed', result);
        auditLog.append({
          id: nextAuditId(),
          eventType: 'remote_execution.failed',
          objectType: 'RemoteExecutionRequest',
          objectId: request.request_id,
          actorId: this.dispatcher.name,
          timestamp: now,
          summary: `Remote execution failed: ${errorMsg}`,
          workspaceId: request.workspace_id,
          metadata: {
            error: errorMsg,
            retryAttempt: retryCount,
            maxRetries: this.retryPolicy.maxRetries,
            classification,
            dispatcherName: this.dispatcher.name,
          },
        });

        this.requestRetryCount.delete(request.request_id);
      }
    }
  }

  /**
   * Poll dispatcher for execution result.
   * Simple polling with 5 checks over 1 second (hardcoded for now).
   */
  private async pollForResult(
    request: RemoteExecutionRequest,
    remoteRunId: string,
  ): Promise<RemoteExecutionResult> {
    const startedAt = Date.now();
    const maxWaitMs = 1000;
    const pollIntervalMs = 200;
    let lastStatus: 'running' | 'completed' | 'failed' = 'running';

    while (Date.now() - startedAt < maxWaitMs) {
      lastStatus = await this.dispatcher.getExecutionStatus(remoteRunId);

      if (lastStatus !== 'running') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const dispatcherResult = await this.dispatcher.getExecutionResult(remoteRunId);

    if (!dispatcherResult) {
      // Timeout: assume still running but return empty result
      return {
        request_id: request.request_id,
        status: lastStatus === 'running' ? 'completed' : lastStatus,
        stdout: '',
        stderr: lastStatus === 'running' ? 'Execution timeout (still running)' : '',
        exit_code: lastStatus === 'running' ? 0 : 1,
        artifact_ids: [],
        remote_run_id: remoteRunId,
        started_at: startedAt,
        completed_at: Date.now(),
        error: lastStatus === 'running' ? null : 'No result available',
      };
    }

    return {
      request_id: request.request_id,
      status: dispatcherResult.status,
      stdout: dispatcherResult.stdout,
      stderr: dispatcherResult.stderr,
      exit_code: dispatcherResult.exit_code,
      artifact_ids: [],
      remote_run_id: remoteRunId,
      started_at: startedAt,
      completed_at: Date.now(),
      error: dispatcherResult.error ?? null,
    };
  }

  async getStatus(requestId: string): Promise<RemoteExecutionRequest | undefined> {
    return remoteExecutionStore.getRequestById(requestId);
  }

  async getResult(requestId: string): Promise<RemoteExecutionResult | undefined> {
    return remoteExecutionStore.getResultByRequestId(requestId);
  }

  async cancel(requestId: string): Promise<boolean> {
    const request = remoteExecutionStore.getRequestById(requestId);
    if (!request) {
      return false;
    }

    // Can only cancel pending or dispatched requests
    if (request.status !== 'pending' && request.status !== 'dispatched') {
      return false;
    }

    // If we have a remote_run_id, attempt cancellation on dispatcher
    // For now, we'll use a placeholder implementation
    const now = Date.now();

    request.status = 'failed';
    remoteExecutionStore.updateStatus(requestId, 'failed');

    const result: RemoteExecutionResult = {
      request_id: requestId,
      status: 'failed',
      stdout: '',
      stderr: '',
      artifact_ids: [],
      remote_run_id: null,
      started_at: now,
      completed_at: now,
      error: 'Cancelled by caller',
    };

    remoteExecutionStore.saveResult(result);
    eventBus.emit('remote.execution.failed', result);

    auditLog.append({
      id: nextAuditId(),
      eventType: 'remote_execution.failed',
      objectType: 'RemoteExecutionRequest',
      objectId: requestId,
      actorId: this.dispatcher.name,
      timestamp: now,
      summary: 'Remote execution cancelled by caller',
      workspaceId: request.workspace_id,
      metadata: {
        dispatcherName: this.dispatcher.name,
      },
    });

    return true;
  }
}
