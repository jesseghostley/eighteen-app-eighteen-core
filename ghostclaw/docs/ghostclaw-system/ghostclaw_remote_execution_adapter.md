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

| Adapter                              | Purpose                                                       |
|--------------------------------------|---------------------------------------------------------------|
| `LocalStubAdapter`                   | In-process stub for testing/development                       |
| `FailingStubAdapter`                 | Always-failing stub for error path testing                    |
| `PopeClawRemoteExecutionAdapter`     | Policy-aware, provider-agnostic adapter backed by Pope-Claw   |

### Simulated Dispatchers (for PopeClawRemoteExecutionAdapter testing)

| Dispatcher                            | Purpose                                                    |
|---------------------------------------|------------------------------------------------------------|
| `SimulatedSuccessDispatcher`          | Always succeeds (happy path testing)                       |
| `SimulatedFailureDispatcher`          | Always fails (error path testing)                          |
| `SimulatedTransientFailureDispatcher` | Fails N times then succeeds (retry logic testing)          |
| `SimulatedPermanentFailureDispatcher` | Always fails with permanent error (no-retry testing)       |
| `SimulatedControlledDispatcher`       | Manual control of execution behavior (scenario testing)    |

### Future Adapters (not in this pass)

| Adapter                      | Backend                               |
|------------------------------|---------------------------------------|
| `GitHubActionsAdapter`       | Pope-Claw pattern via repository dispatch |
| `ContainerSandboxAdapter`    | Docker/OCI container execution        |
| `SSHNodeAdapter`             | Remote node via SSH                   |

## PopeClawRemoteExecutionAdapter

The `PopeClawRemoteExecutionAdapter` is a feature-rich, policy-aware implementation of
`IRemoteExecutionAdapter` suitable for production use or as a template for custom adapters.

### Key Features

- **Policy Gate Enforcement**: Validates `policy_context.approved === true` before dispatch; rejects with `'rejected'` status otherwise.
- **Execution Type Whitelisting**: Optionally restricts allowed execution types per adapter instance.
- **Retry Classification + Exponential Backoff**: Automatically classifies errors as transient or permanent and retries transient failures with configurable backoff.
- **Full Audit Trail**: Emits comprehensive audit events (via `auditLog`) for all state transitions.
- **Runtime Events**: Emits events on the canonical `EventBus` for integration with runtime subscribers.
- **Chain Traceability**: Preserves `workspace_id`, `job_id`, `assignment_id`, and `skill_invocation_id` through the entire lifecycle.
- **Audit Metadata**: Captures `remote_run_id`, dispatcher name, retry attempt count, and execution timing in audit records.

### Configuration

```typescript
const adapter = new PopeClawRemoteExecutionAdapter({
  name: 'pope-claw-instance-1',
  dispatcher: someDispatcherImpl,
  retryPolicy: {
    maxRetries: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 10000,
    backoffMultiplier: 2,
    classifyError: (error) => { /* return 'transient' | 'permanent' | 'unknown' */ },
  },
  executionTypeWhitelist: {
    allowedTypes: ['shell_command', 'file_write'], // Empty array = allow all
  },
});
```

### Dispatcher Contract

Implementations of `IPopeClawDispatcher` must:
1. Accept a `RemoteExecutionRequest` and dispatch it to a backend.
2. Return a provider-specific `remote_run_id` (string).
3. Throw an error if dispatch fails (transient or permanent).
4. Implement `getExecutionStatus()` to poll for completion.
5. Implement `getExecutionResult()` to retrieve stdout, stderr, exit code, and error.
6. Implement `cancel()` to attempt cancellation.

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
| `__tests__/remote_execution.test.ts` | Test suite (25 tests) |
