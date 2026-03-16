# GhostClaw Remote Execution Adapter

## Overview

The Remote Execution Adapter is a provider-agnostic, policy-aware contract for
executing high-trust operations outside the local GhostClaw runtime. It enables
GhostClaw to delegate destructive or privileged work (shell commands, file
writes, patch applications, script execution) to sandboxed backends while
maintaining full auditability and governance.

This pattern is inspired by the Pope-Claw bridge from Eighteen Core, generalized
into a GhostClaw-native abstraction.

## Position in the Runtime Chain

```
Signal → Plan → Job → Assignment → SkillInvocation
                                        ↓
                              RemoteExecutionRequest
                                        ↓
                            IRemoteExecutionAdapter
                              (submit / getResult)
                                        ↓
                              RemoteExecutionResult
                                        ↓
                                     Artifact
                                        ↓
                                   PublishEvent
```

RemoteExecution sits between **SkillInvocation** and **Artifact**. When a skill
invocation determines that its work requires remote or sandboxed execution, it
creates a `RemoteExecutionRequest` and delegates to an adapter. The adapter
returns a `RemoteExecutionResult`, which the skill invocation uses to produce
artifacts.

## V1 Execution Types

| Type            | Description                                |
|-----------------|--------------------------------------------|
| `shell_command` | Execute an arbitrary shell command          |
| `patch_apply`   | Apply a git-format patch to the workspace   |
| `file_write`    | Write content to a specified file path      |
| `script_run`    | Execute a named script or script body       |

## Request Lifecycle

```
pending → dispatched → running → completed
                               → failed
        → rejected  (policy blocked before dispatch)
```

1. **pending**: Request created, not yet submitted to adapter.
2. **dispatched**: Adapter has accepted the request and sent it to the backend.
3. **running**: Execution has started on the remote side.
4. **completed**: Execution finished successfully. Result available.
5. **failed**: Execution failed. Error details in result.
6. **rejected**: MCS/policy evaluation blocked the request before dispatch.

## Policy Integration

Every `RemoteExecutionRequest` carries a `policy_context`:

```typescript
{
  evaluated_policy_ids: string[];   // Policies checked
  approved: boolean;                // Pass/fail gate
  blocking_policy_id?: string;      // Which policy blocked (if any)
  enforcement_mode?: 'block' | 'warn' | 'audit';
  summary?: string;
}
```

Adapters **MUST** check `policy_context.approved === true` before proceeding.
Rejected requests are marked `'rejected'` and logged to the audit trail without
any execution occurring.

This integrates with the existing MCS `WorkspacePolicy` system. Policies of type
`'execution'` govern which remote execution types, capabilities, and payloads are
permitted per workspace.

## Runtime Events

| Event                          | Payload Type               |
|--------------------------------|----------------------------|
| `remote.execution.requested`   | `RemoteExecutionRequest`   |
| `remote.execution.started`     | `RemoteExecutionRequest`   |
| `remote.execution.completed`   | `RemoteExecutionResult`    |
| `remote.execution.failed`      | `RemoteExecutionResult`    |

All events are emitted on the canonical `EventBus` and are available to runtime
subscribers, the runtime event log, and the audit log.

## Audit Events

| Audit Event Type                | Trigger                          |
|---------------------------------|----------------------------------|
| `remote_execution.requested`    | Request dispatched to adapter    |
| `remote_execution.started`      | Execution begins on remote side  |
| `remote_execution.completed`    | Execution succeeds               |
| `remote_execution.failed`       | Execution fails                  |
| `remote_execution.rejected`     | Policy blocks before dispatch    |

## Adapter Interface

```typescript
interface IRemoteExecutionAdapter {
  readonly name: string;
  submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest>;
  getStatus(requestId: string): Promise<RemoteExecutionRequest | undefined>;
  getResult(requestId: string): Promise<RemoteExecutionResult | undefined>;
  cancel(requestId: string): Promise<boolean>;
}
```

### V1 Adapters

| Adapter                | Purpose                                    |
|------------------------|--------------------------------------------|
| `LocalStubAdapter`     | In-process stub for testing/development    |
| `FailingStubAdapter`   | Always-failing stub for error path testing |
| `PopeClawAdapter`      | Pope-Claw-backed remote execution          |

### Future Adapters

| Adapter                      | Backend                               |
|------------------------------|---------------------------------------|
| `ContainerSandboxAdapter`    | Docker/OCI container execution        |
| `SSHNodeAdapter`             | Remote node via SSH                   |

---

## Pope-Claw Adapter

### Overview

The `PopeClawRemoteExecutionAdapter` is a real remote execution backend modeled
after the Pope-Claw bridge pattern from Eighteen Core.  It exercises the full
dispatch → poll/callback → result lifecycle while remaining provider-agnostic.

Unlike the `LocalStubAdapter` (which executes in-process), the Pope-Claw adapter
models a two-phase async execution flow:

1. **Dispatch** — send the request to a remote execution environment
2. **Await** — poll or receive a callback when execution completes

This separation is critical for production use with GitHub Actions, SSH nodes,
or container runtimes where execution is inherently asynchronous.

### How It Differs from LocalStubAdapter

| Aspect | LocalStubAdapter | PopeClawAdapter |
|--------|-----------------|-----------------|
| **Execution** | In-process, synchronous simulation | Two-phase: dispatch + await via `IPopeClawDispatcher` |
| **Backend** | None (echoes input) | Pluggable dispatcher (simulated, GitHub Actions, SSH, container) |
| **Retry** | No retry logic | Automatic retry with exponential backoff for transient failures |
| **Failure classification** | Not applicable | Classifies failures as transient vs permanent |
| **Configuration** | None | Full config: endpoint, audit ref, workflow ID, timeout, callback, retry policy |
| **Execution type validation** | Accepts all types | Validates against `supported_execution_types` in config |
| **Audit detail** | Basic lifecycle entries | Rich metadata: remote_endpoint, commit_sha, failure_classification, retry attempts |
| **Use case** | Unit tests, contract verification | Integration testing, staging, production |

### Architecture

```
GhostClaw Runtime
  └─ SkillInvocation
       └─ PopeClawRemoteExecutionAdapter
            ├─ Policy gate (reject if not approved)
            ├─ Execution type validation
            ├─ IPopeClawDispatcher.dispatch()      ← pluggable backend
            │    ├─ SimulatedDispatcher (testing)
            │    ├─ GitHubActionsDispatcher (future)
            │    ├─ SSHDispatcher (future)
            │    └─ ContainerDispatcher (future)
            ├─ IPopeClawDispatcher.awaitResult()
            ├─ Failure classification (transient / permanent)
            ├─ Auto-retry with exponential backoff
            ├─ EventBus emission at every stage
            └─ AuditLog entries at every stage
```

### Configuration

```typescript
type PopeClawAdapterConfig = {
  name: string;                          // Adapter instance name
  remote_endpoint: string;               // Target: "owner/repo", "user@host", etc.
  audit_ref: string;                     // Audit branch: "audit/main"
  workflow_id: string;                   // Workflow: "pope-claw-exec.yml"
  callback_url: string;                  // Callback endpoint (placeholder)
  callback_secret: string;               // HMAC secret (placeholder)
  timeout_ms: number;                    // Max wait time (default: 120000)
  retry_policy: {
    max_retries: number;                 // Max auto-retries (default: 2)
    backoff_ms: number[];                // Backoff intervals: [30000, 90000]
  };
  supported_execution_types: RemoteExecutionType[];  // What this adapter handles
};
```

All configuration boundaries are placeholders in this pass.  No real network
calls, GitHub API tokens, or webhook secrets are required.

### Failure Classification

Ported from Eighteen Core's `error-recovery.ts`:

| Pattern | Classification | Behavior |
|---------|---------------|----------|
| `network`, `timeout`, `ECONNRESET` | Transient | Auto-retry with backoff |
| `rate limit`, `429`, `503` | Transient | Auto-retry with backoff |
| `runner unavailable` | Transient | Auto-retry with backoff |
| Everything else | Permanent | Fail immediately, no retry |

### Dispatcher Interface

The adapter delegates actual remote communication to an `IPopeClawDispatcher`:

```typescript
interface IPopeClawDispatcher {
  dispatch(config, request): Promise<{ remote_run_id: string }>;
  awaitResult(config, request, remoteRunId): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exit_code: number;
    commit_sha?: string;
  }>;
}
```

**V1 Dispatchers:**

| Dispatcher | Behavior |
|-----------|----------|
| `SimulatedPopeClawDispatcher` | Returns simulated output per execution type |
| `SimulatedPopeClawDispatcher(true, msg)` | Always fails with given message |

**Future Dispatchers** (not in this pass):

| Dispatcher | Backend |
|-----------|---------|
| `GitHubActionsDispatcher` | Octokit → repository_dispatch → poll/callback |
| `SSHDispatcher` | SSH exec + SCP for artifacts |
| `ContainerDispatcher` | Docker/OCI run + volume mount |

## Storage

`IRemoteExecutionStore` provides persistence for requests and results:

- `saveRequest` / `getRequestById` / `listAll`
- `listByJobId` / `listByWorkspaceId` / `listByStatus`
- `updateStatus`
- `saveResult` / `getResultByRequestId`

In-memory implementation: `InMemoryRemoteExecutionStore` (singleton: `remoteExecutionStore`).

## Chain Context

Every request carries full chain context for traceability:

```
workspace_id        → workspace scope
job_id              → originating job
assignment_id       → agent assignment
skill_invocation_id → parent skill invocation
```

This allows any remote execution to be traced back through the full runtime
chain: Signal → Plan → Job → Assignment → SkillInvocation → RemoteExecution.

## Files

| File | Purpose |
|------|---------|
| `packages/core/src/remote_execution.ts` | Types, interfaces, in-memory store |
| `packages/core/src/local_stub_adapter.ts` | LocalStub and FailingStub adapters |
| `packages/core/src/storage/interfaces/IRemoteExecutionStore.ts` | Store interface |
| `packages/core/src/runtime_events.ts` | RuntimeEventMap (extended) |
| `packages/core/src/audit_log.ts` | AuditEventType (extended) |
| `packages/core/src/pope_claw_adapter.ts` | Pope-Claw adapter, config, dispatcher, failure classification |
| `__tests__/remote_execution.test.ts` | LocalStub/FailingStub test suite (25 tests) |
| `__tests__/pope_claw_adapter.test.ts` | Pope-Claw adapter test suite (34 tests) |
