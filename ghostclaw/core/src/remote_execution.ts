import type { IRemoteExecutionStore } from './storage/interfaces/IRemoteExecutionStore';

/**
 * RemoteExecution — provider-agnostic, policy-aware remote execution contract.
 *
 * Canonical spec: ghostclaw_remote_execution_adapter.md
 * Runtime chain:  Signal → Plan → Job → Assignment → SkillInvocation
 *                 → **RemoteExecution** → Artifact → PublishEvent
 *
 * RemoteExecution sits between SkillInvocation and Artifact.  When a skill
 * invocation determines that its work must be performed outside the local
 * runtime (shell command, file write, patch apply, script execution), it
 * creates a RemoteExecutionRequest and delegates to an IRemoteExecutionAdapter.
 *
 * The adapter pattern allows GhostClaw to route execution through any backend
 * (GitHub Actions, container sandbox, SSH node, local stub) without coupling
 * the core runtime to a specific provider.
 *
 * All requests are audit-logged and policy-checked before dispatch.
 */

// ── Execution types ─────────────────────────────────────────────────────────

/**
 * V1 execution types supported by the remote execution adapter.
 *
 * - shell_command:  Execute an arbitrary shell command.
 * - patch_apply:    Apply a git-format patch to the workspace.
 * - file_write:     Write content to a specified file path.
 * - script_run:     Execute a named script or script body.
 */
export type RemoteExecutionType =
  | 'shell_command'
  | 'patch_apply'
  | 'file_write'
  | 'script_run';

// ── Status lifecycle ────────────────────────────────────────────────────────

/**
 * Status lifecycle for a remote execution request:
 *
 *   pending → dispatched → running → completed
 *                                  → failed
 *          → rejected  (policy blocked before dispatch)
 */
export type RemoteExecutionStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

// ── Policy context ──────────────────────────────────────────────────────────

/**
 * Policy context attached to every remote execution request.
 * Captures the workspace policies that were evaluated before dispatch.
 */
export type RemoteExecutionPolicyContext = {
  /** IDs of workspace policies evaluated for this request. */
  evaluated_policy_ids: string[];
  /** Whether all evaluated policies passed. */
  approved: boolean;
  /** If rejected, the ID of the blocking policy. */
  blocking_policy_id?: string;
  /** If rejected, the enforcement mode of the blocking policy. */
  enforcement_mode?: 'block' | 'warn' | 'audit';
  /** Human-readable summary of the policy evaluation. */
  summary?: string;
};

// ── Request ─────────────────────────────────────────────────────────────────

export type RemoteExecutionRequest = {
  /** Globally unique identifier. MUST be immutable after creation. */
  request_id: string;

  // ── Chain context (traces back to originating signal) ───────────────────
  workspace_id: string;
  job_id: string;
  assignment_id: string;
  skill_invocation_id: string;

  // ── Execution specification ────────────────────────────────────────────
  execution_type: RemoteExecutionType;
  /** Provider-specific payload (e.g. command string, patch content, file path + body). */
  payload: Record<string, unknown>;
  /** Capabilities the execution environment must provide (e.g. 'git', 'node', 'docker'). */
  requested_capabilities: string[];

  // ── Policy ─────────────────────────────────────────────────────────────
  policy_context: RemoteExecutionPolicyContext;

  // ── Lifecycle ──────────────────────────────────────────────────────────
  status: RemoteExecutionStatus;
  created_at: number;
};

// ── Result ──────────────────────────────────────────────────────────────────

export type RemoteExecutionResult = {
  /** The request_id this result corresponds to. */
  request_id: string;
  /** Final status. */
  status: 'completed' | 'failed';
  /** Standard output captured from the execution. */
  stdout: string;
  /** Standard error captured from the execution. */
  stderr: string;
  /** Exit code when applicable (shell_command, script_run). */
  exit_code?: number;
  /** IDs of artifacts produced by this execution. */
  artifact_ids: string[];
  /** Provider-specific run identifier for traceability. */
  remote_run_id: string | null;
  /** Unix timestamp (ms) when execution started on the remote side. */
  started_at: number;
  /** Unix timestamp (ms) when execution completed on the remote side. */
  completed_at: number;
  /** Error description if status === 'failed'. */
  error: string | null;
};

// ── Adapter interface ───────────────────────────────────────────────────────

/**
 * IRemoteExecutionAdapter — the contract that any remote execution backend
 * must implement to participate in the GhostClaw runtime.
 *
 * Implementations may include:
 *   - LocalStubAdapter      (in-process, for testing and development)
 *   - GitHubActionsAdapter   (Pope-Claw pattern, git-audited)
 *   - ContainerSandboxAdapter
 *   - SSHNodeAdapter
 */
export interface IRemoteExecutionAdapter {
  /** Human-readable name of this adapter (e.g. 'local-stub', 'github-actions'). */
  readonly name: string;

  /**
   * Submit a request for remote execution.
   * The adapter MUST validate that policy_context.approved === true before
   * proceeding and reject with status 'rejected' otherwise.
   */
  submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest>;

  /**
   * Query the current status of a previously submitted request.
   * Returns undefined if the request_id is unknown.
   */
  getStatus(requestId: string): Promise<RemoteExecutionRequest | undefined>;

  /**
   * Retrieve the result of a completed or failed request.
   * Returns undefined if the request is still in progress or unknown.
   */
  getResult(requestId: string): Promise<RemoteExecutionResult | undefined>;

  /**
   * Cancel a pending or dispatched request if the adapter supports it.
   * Returns true if cancellation was successful, false otherwise.
   */
  cancel(requestId: string): Promise<boolean>;
}

// ── In-memory store ─────────────────────────────────────────────────────────

export class InMemoryRemoteExecutionStore implements IRemoteExecutionStore {
  private readonly requests = new Map<string, RemoteExecutionRequest>();
  private readonly results = new Map<string, RemoteExecutionResult>();

  saveRequest(request: RemoteExecutionRequest): RemoteExecutionRequest {
    this.requests.set(request.request_id, request);
    return request;
  }

  getRequestById(requestId: string): RemoteExecutionRequest | undefined {
    return this.requests.get(requestId);
  }

  listAll(): RemoteExecutionRequest[] {
    return Array.from(this.requests.values());
  }

  listByJobId(jobId: string): RemoteExecutionRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.job_id === jobId);
  }

  listByWorkspaceId(workspaceId: string): RemoteExecutionRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.workspace_id === workspaceId);
  }

  listByStatus(status: RemoteExecutionStatus): RemoteExecutionRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === status);
  }

  updateStatus(requestId: string, status: RemoteExecutionStatus): RemoteExecutionRequest | undefined {
    const request = this.requests.get(requestId);
    if (!request) {
      return undefined;
    }
    request.status = status;
    return request;
  }

  saveResult(result: RemoteExecutionResult): RemoteExecutionResult {
    this.results.set(result.request_id, result);
    return result;
  }

  getResultByRequestId(requestId: string): RemoteExecutionResult | undefined {
    return this.results.get(requestId);
  }

  reset(): void {
    this.requests.clear();
    this.results.clear();
  }
}

export const remoteExecutionStore = new InMemoryRemoteExecutionStore();
