import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import { remoteExecutionStore } from './remote_execution';
import type {
  IRemoteExecutionAdapter,
  RemoteExecutionRequest,
  RemoteExecutionResult,
  RemoteExecutionType,
} from './remote_execution';

/**
 * Pope-Claw Adapter — Configuration
 *
 * Modeled after Eighteen Core's PopeClawConfig, generalized for GhostClaw.
 * All provider-specific details (GitHub PAT, Octokit, etc.) are replaced
 * with abstract configuration boundaries that any backend can implement.
 */

// ── Configuration ───────────────────────────────────────────────────────────

export type PopeClawRetryPolicy = {
  /** Maximum auto-retries for transient failures. */
  max_retries: number;
  /** Backoff intervals in milliseconds, one per retry attempt. */
  backoff_ms: number[];
};

export type PopeClawAdapterConfig = {
  /** Human-readable name for this adapter instance (e.g. 'pope-claw-github', 'pope-claw-ssh'). */
  name: string;

  /**
   * Remote endpoint or channel identifier.
   * For GitHub Actions: "owner/repo"
   * For SSH: "user@host:port"
   * For container: image reference
   * The adapter does not interpret this — it passes it to the dispatch backend.
   */
  remote_endpoint: string;

  /**
   * Audit branch or namespace where execution output is committed.
   * For GitHub Actions: "audit/main"
   * For other backends: log partition identifier.
   */
  audit_ref: string;

  /**
   * Workflow or entrypoint identifier on the remote side.
   * For GitHub Actions: "pope-claw-exec.yml"
   * For SSH: script path
   * For container: entrypoint command
   */
  workflow_id: string;

  /**
   * Callback URL or channel for the remote side to report completion.
   * Placeholder in this pass — not required for simulated dispatch.
   */
  callback_url: string;

  /**
   * Shared secret for HMAC-SHA256 verification of callback payloads.
   * Placeholder in this pass — verification logic is modeled but not
   * connected to real HTTP.
   */
  callback_secret: string;

  /**
   * Maximum time (ms) to wait for a remote execution to complete.
   * After this timeout the request is marked failed.
   */
  timeout_ms: number;

  /** Retry policy for transient failures. */
  retry_policy: PopeClawRetryPolicy;

  /**
   * Execution types this adapter instance is willing to handle.
   * Requests for types not in this list are rejected.
   */
  supported_execution_types: RemoteExecutionType[];
};

/**
 * Default configuration for development/testing.
 * All endpoints are placeholders — no real network calls occur.
 */
export const DEFAULT_POPE_CLAW_CONFIG: PopeClawAdapterConfig = {
  name: 'pope-claw',
  remote_endpoint: 'ghostclaw/execution-node',
  audit_ref: 'audit/main',
  workflow_id: 'pope-claw-exec.yml',
  callback_url: 'https://localhost:3000/api/pope-claw/callback',
  callback_secret: '',
  timeout_ms: 120_000,
  retry_policy: {
    max_retries: 2,
    backoff_ms: [30_000, 90_000],
  },
  supported_execution_types: ['shell_command', 'patch_apply', 'file_write', 'script_run'],
};

// ── Failure classification (ported from Eighteen Core) ──────────────────────

/** Transient error patterns that warrant auto-retry. */
const TRANSIENT_PATTERNS = [
  /network/i,
  /timeout/i,
  /rate limit/i,
  /429/,
  /503/,
  /ECONNRESET/,
  /runner.*unavailable/i,
  /could not resolve/i,
];

export type FailureClassification = 'transient' | 'permanent';

export function classifyFailure(errorMessage: string): FailureClassification {
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    return 'transient';
  }
  return 'permanent';
}

// ── Dispatch backend interface ──────────────────────────────────────────────

/**
 * IPopeClawDispatcher — the pluggable backend that actually sends work
 * to a remote execution environment.
 *
 * In production this would be a GitHub Actions dispatcher (Octokit),
 * an SSH client, or a container runtime client.  For this pass we
 * provide a SimulatedDispatcher that models the async dispatch/poll/callback
 * lifecycle without real network calls.
 */
export interface IPopeClawDispatcher {
  /**
   * Dispatch a request to the remote execution environment.
   * Returns a remote_run_id for tracking.
   */
  dispatch(
    config: PopeClawAdapterConfig,
    request: RemoteExecutionRequest,
  ): Promise<{ remote_run_id: string }>;

  /**
   * Poll or wait for a dispatched run to complete.
   * Returns the execution result.
   */
  awaitResult(
    config: PopeClawAdapterConfig,
    request: RemoteExecutionRequest,
    remoteRunId: string,
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exit_code: number;
    commit_sha?: string;
  }>;
}

// ── Simulated dispatcher ────────────────────────────────────────────────────

/**
 * SimulatedPopeClawDispatcher — exercises the dispatch/await lifecycle
 * without real network calls.  Simulates:
 *   - dispatch → returns a run ID
 *   - awaitResult → returns simulated output per execution type
 *
 * For failure testing, set shouldFail=true or failureMessage in the constructor.
 */
export class SimulatedPopeClawDispatcher implements IPopeClawDispatcher {
  private _dispatchCount = 0;

  constructor(
    private readonly shouldFail: boolean = false,
    private readonly failureMessage: string = 'Remote execution failed on remote node',
  ) {}

  get dispatchCount(): number {
    return this._dispatchCount;
  }

  async dispatch(
    config: PopeClawAdapterConfig,
    request: RemoteExecutionRequest,
  ): Promise<{ remote_run_id: string }> {
    this._dispatchCount++;
    const runId = `run_${config.name}_${request.request_id}_${this._dispatchCount}`;
    return { remote_run_id: runId };
  }

  async awaitResult(
    _config: PopeClawAdapterConfig,
    request: RemoteExecutionRequest,
    _remoteRunId: string,
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exit_code: number;
    commit_sha?: string;
  }> {
    if (this.shouldFail) {
      return {
        success: false,
        stdout: '',
        stderr: this.failureMessage,
        exit_code: 1,
      };
    }

    const stdout = this.simulateOutput(request);
    return {
      success: true,
      stdout,
      stderr: '',
      exit_code: 0,
      commit_sha: `abc${request.request_id.slice(0, 4)}`,
    };
  }

  private simulateOutput(request: RemoteExecutionRequest): string {
    switch (request.execution_type) {
      case 'shell_command':
        return `[pope-claw] executed on remote: ${String(request.payload.command ?? '')}`;
      case 'file_write':
        return `[pope-claw] wrote to remote: ${String(request.payload.path ?? '')}`;
      case 'patch_apply':
        return `[pope-claw] applied patch on remote (${String(request.payload.patch ?? '').length} bytes)`;
      case 'script_run':
        return `[pope-claw] ran script on remote: ${String(request.payload.script_name ?? request.payload.script ?? '')}`;
      default:
        return `[pope-claw] completed unknown execution type`;
    }
  }
}

// ── Audit helper ────────────────────────────────────────────────────────────

let _nextAuditId = 1;
function nextAuditId(): string {
  return `audit_pc_${_nextAuditId++}`;
}

/** Reset audit ID counter (for test isolation). */
export function resetPopeClawAuditIds(): void {
  _nextAuditId = 1;
}

// ── The adapter ─────────────────────────────────────────────────────────────

/**
 * PopeClawRemoteExecutionAdapter — a Pope-Claw-backed implementation of
 * IRemoteExecutionAdapter for GhostClaw.
 *
 * Models the full Eighteen Core Pope-Claw lifecycle:
 *   1. Policy gate (reject if not approved)
 *   2. Execution type validation (reject unsupported types)
 *   3. Dispatch to remote backend via IPopeClawDispatcher
 *   4. Await result (poll/callback)
 *   5. Classify failures (transient vs permanent)
 *   6. Auto-retry transient failures with exponential backoff
 *   7. Emit runtime events and audit log entries at every stage
 *
 * This adapter does NOT import Anthropic, Claude, OpenRouter, Telegram,
 * Octokit, or any other provider-specific dependency.
 */
export class PopeClawRemoteExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name: string;
  private readonly config: PopeClawAdapterConfig;
  private readonly dispatcher: IPopeClawDispatcher;

  constructor(config: PopeClawAdapterConfig, dispatcher: IPopeClawDispatcher) {
    this.name = config.name;
    this.config = config;
    this.dispatcher = dispatcher;
  }

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    // Persist the request
    remoteExecutionStore.saveRequest(request);

    // ── Policy gate ───────────────────────────────────────────────────────
    if (!request.policy_context.approved) {
      return this.reject(request, `Blocked by policy: ${request.policy_context.blocking_policy_id ?? 'unknown'}`);
    }

    // ── Execution type validation ─────────────────────────────────────────
    if (!this.config.supported_execution_types.includes(request.execution_type)) {
      return this.reject(
        request,
        `Unsupported execution type: ${request.execution_type} (supported: ${this.config.supported_execution_types.join(', ')})`,
      );
    }

    // ── Dispatch ──────────────────────────────────────────────────────────
    request.status = 'dispatched';
    remoteExecutionStore.updateStatus(request.request_id, 'dispatched');

    eventBus.emit('remote.execution.requested', request);
    this.auditAppend('remote_execution.requested', request.request_id, request.workspace_id,
      `Pope-Claw dispatch: ${request.execution_type} → ${this.config.remote_endpoint}`,
      {
        execution_type: request.execution_type,
        remote_endpoint: this.config.remote_endpoint,
        workflow_id: this.config.workflow_id,
      },
    );

    let remoteRunId: string;
    try {
      const dispatchResult = await this.dispatcher.dispatch(this.config, request);
      remoteRunId = dispatchResult.remote_run_id;
    } catch (err) {
      return this.fail(request, null, `Dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Running ───────────────────────────────────────────────────────────
    request.status = 'running';
    remoteExecutionStore.updateStatus(request.request_id, 'running');

    eventBus.emit('remote.execution.started', request);
    this.auditAppend('remote_execution.started', request.request_id, request.workspace_id,
      `Pope-Claw execution started: ${remoteRunId}`,
      { remote_run_id: remoteRunId },
    );

    // ── Await result with retry ───────────────────────────────────────────
    return this.awaitWithRetry(request, remoteRunId);
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
    if (request.status !== 'pending' && request.status !== 'dispatched') {
      return false;
    }

    request.status = 'failed';
    remoteExecutionStore.updateStatus(requestId, 'failed');

    const result: RemoteExecutionResult = {
      request_id: requestId,
      status: 'failed',
      stdout: '',
      stderr: '',
      artifact_ids: [],
      remote_run_id: null,
      started_at: Date.now(),
      completed_at: Date.now(),
      error: 'Cancelled by caller',
    };
    remoteExecutionStore.saveResult(result);

    eventBus.emit('remote.execution.failed', result);
    this.auditAppend('remote_execution.failed', requestId, request.workspace_id,
      'Pope-Claw execution cancelled by caller',
      { reason: 'cancelled' },
    );

    return true;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Await the result from the dispatcher and retry transient failures.
   */
  private async awaitWithRetry(
    request: RemoteExecutionRequest,
    remoteRunId: string,
  ): Promise<RemoteExecutionRequest> {
    const { max_retries, backoff_ms } = this.config.retry_policy;
    let lastRunId = remoteRunId;

    // Initial attempt
    const initialResult = await this.tryAwait(request, lastRunId);
    if (initialResult.success) {
      return this.complete(request, lastRunId, initialResult);
    }

    // Classify failure
    const classification = classifyFailure(initialResult.stderr);
    if (classification === 'permanent') {
      return this.fail(request, lastRunId,
        initialResult.stderr || 'Permanent failure on remote node',
        initialResult.exit_code,
      );
    }

    // Transient — retry with backoff
    for (let attempt = 0; attempt < max_retries; attempt++) {
      const delay = backoff_ms[attempt] ?? backoff_ms[backoff_ms.length - 1];

      this.auditAppend('remote_execution.requested', request.request_id, request.workspace_id,
        `Pope-Claw retry ${attempt + 1}/${max_retries} after ${delay}ms`,
        { retry_attempt: attempt + 1, delay_ms: delay, remote_run_id: lastRunId },
      );

      await sleep(delay);

      // Re-dispatch
      try {
        const redispatch = await this.dispatcher.dispatch(this.config, request);
        lastRunId = redispatch.remote_run_id;
      } catch {
        continue;
      }

      const retryResult = await this.tryAwait(request, lastRunId);
      if (retryResult.success) {
        this.auditAppend('remote_execution.completed', request.request_id, request.workspace_id,
          `Pope-Claw succeeded on retry ${attempt + 1}`,
          { retry_attempt: attempt + 1, remote_run_id: lastRunId },
        );
        return this.complete(request, lastRunId, retryResult);
      }
    }

    // All retries exhausted
    return this.fail(request, lastRunId,
      `All ${max_retries} retries exhausted. Last error: ${initialResult.stderr}`,
      initialResult.exit_code,
    );
  }

  /** Single attempt to await a result from the dispatcher. */
  private async tryAwait(
    request: RemoteExecutionRequest,
    remoteRunId: string,
  ): Promise<{ success: boolean; stdout: string; stderr: string; exit_code: number; commit_sha?: string }> {
    try {
      return await this.dispatcher.awaitResult(this.config, request, remoteRunId);
    } catch (err) {
      return {
        success: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  }

  /** Mark a request as completed and persist the result. */
  private complete(
    request: RemoteExecutionRequest,
    remoteRunId: string,
    output: { stdout: string; stderr: string; exit_code: number; commit_sha?: string },
  ): RemoteExecutionRequest {
    const now = Date.now();

    request.status = 'completed';
    remoteExecutionStore.updateStatus(request.request_id, 'completed');

    const result: RemoteExecutionResult = {
      request_id: request.request_id,
      status: 'completed',
      stdout: output.stdout,
      stderr: output.stderr,
      exit_code: output.exit_code,
      artifact_ids: [],
      remote_run_id: remoteRunId,
      started_at: now,
      completed_at: now,
      error: null,
    };
    remoteExecutionStore.saveResult(result);

    eventBus.emit('remote.execution.completed', result);
    this.auditAppend('remote_execution.completed', request.request_id, request.workspace_id,
      `Pope-Claw execution completed: ${request.execution_type}`,
      {
        remote_run_id: remoteRunId,
        commit_sha: output.commit_sha,
        exit_code: output.exit_code,
      },
    );

    return request;
  }

  /** Mark a request as failed and persist the result. */
  private fail(
    request: RemoteExecutionRequest,
    remoteRunId: string | null,
    error: string,
    exitCode?: number,
  ): RemoteExecutionRequest {
    const now = Date.now();

    request.status = 'failed';
    remoteExecutionStore.updateStatus(request.request_id, 'failed');

    const result: RemoteExecutionResult = {
      request_id: request.request_id,
      status: 'failed',
      stdout: '',
      stderr: error,
      exit_code: exitCode,
      artifact_ids: [],
      remote_run_id: remoteRunId,
      started_at: now,
      completed_at: now,
      error,
    };
    remoteExecutionStore.saveResult(result);

    eventBus.emit('remote.execution.failed', result);
    this.auditAppend('remote_execution.failed', request.request_id, request.workspace_id,
      `Pope-Claw execution failed: ${error}`,
      {
        remote_run_id: remoteRunId,
        error,
        failure_classification: classifyFailure(error),
      },
    );

    return request;
  }

  /** Mark a request as rejected (policy or validation). */
  private reject(request: RemoteExecutionRequest, reason: string): RemoteExecutionRequest {
    request.status = 'rejected';
    remoteExecutionStore.updateStatus(request.request_id, 'rejected');

    this.auditAppend('remote_execution.rejected', request.request_id, request.workspace_id,
      `Pope-Claw execution rejected: ${reason}`,
      { policy_context: request.policy_context, reason },
    );

    return request;
  }

  /** Append an audit log entry. */
  private auditAppend(
    eventType: 'remote_execution.requested' | 'remote_execution.started' | 'remote_execution.completed' | 'remote_execution.failed' | 'remote_execution.rejected',
    objectId: string,
    workspaceId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): void {
    auditLog.append({
      id: nextAuditId(),
      eventType,
      objectType: 'RemoteExecutionRequest',
      objectId,
      actorId: this.name,
      timestamp: Date.now(),
      summary,
      workspaceId,
      metadata,
    });
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
