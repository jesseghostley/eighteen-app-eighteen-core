import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import { remoteExecutionStore } from './remote_execution';
import type {
  IRemoteExecutionAdapter,
  RemoteExecutionRequest,
  RemoteExecutionResult,
} from './remote_execution';

let _nextAuditId = 1;
function nextAuditId(): string {
  return `audit_re_${_nextAuditId++}`;
}

/**
 * LocalStubRemoteExecutionAdapter — in-process stub that exercises the
 * IRemoteExecutionAdapter contract without any external infrastructure.
 *
 * Execution behaviour:
 *   - shell_command:  echoes the command back as stdout
 *   - file_write:     echoes a confirmation message
 *   - patch_apply:    echoes a confirmation message
 *   - script_run:     echoes the script name/body back
 *
 * All lifecycle events are emitted on the EventBus and logged to the audit log.
 * Policy rejection is enforced: if policy_context.approved === false the request
 * is marked 'rejected' and no execution occurs.
 */
export class LocalStubRemoteExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name = 'local-stub';

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    // Persist the request
    remoteExecutionStore.saveRequest(request);

    // Policy gate: reject if policy_context.approved !== true
    if (!request.policy_context.approved) {
      request.status = 'rejected';
      remoteExecutionStore.updateStatus(request.request_id, 'rejected');

      auditLog.append({
        id: nextAuditId(),
        eventType: 'remote_execution.rejected',
        objectType: 'RemoteExecutionRequest',
        objectId: request.request_id,
        actorId: 'local-stub',
        timestamp: Date.now(),
        summary: `Remote execution rejected by policy: ${request.policy_context.blocking_policy_id ?? 'unknown'}`,
        workspaceId: request.workspace_id,
        metadata: { policy_context: request.policy_context },
      });

      return request;
    }

    // Mark dispatched → emit requested event
    request.status = 'dispatched';
    remoteExecutionStore.updateStatus(request.request_id, 'dispatched');

    eventBus.emit('remote.execution.requested', request);
    auditLog.append({
      id: nextAuditId(),
      eventType: 'remote_execution.requested',
      objectType: 'RemoteExecutionRequest',
      objectId: request.request_id,
      actorId: 'local-stub',
      timestamp: Date.now(),
      summary: `Remote execution requested: ${request.execution_type}`,
      workspaceId: request.workspace_id,
      metadata: { execution_type: request.execution_type },
    });

    // Mark running → emit started event
    request.status = 'running';
    remoteExecutionStore.updateStatus(request.request_id, 'running');

    eventBus.emit('remote.execution.started', request);
    auditLog.append({
      id: nextAuditId(),
      eventType: 'remote_execution.started',
      objectType: 'RemoteExecutionRequest',
      objectId: request.request_id,
      actorId: 'local-stub',
      timestamp: Date.now(),
      summary: `Remote execution started: ${request.execution_type}`,
      workspaceId: request.workspace_id,
    });

    // Execute stub logic
    const startedAt = Date.now();
    const stdout = this.stubExecute(request);
    const completedAt = Date.now();

    // Build result
    const result: RemoteExecutionResult = {
      request_id: request.request_id,
      status: 'completed',
      stdout,
      stderr: '',
      exit_code: 0,
      artifact_ids: [],
      remote_run_id: `stub_run_${request.request_id}`,
      started_at: startedAt,
      completed_at: completedAt,
      error: null,
    };

    // Mark completed
    request.status = 'completed';
    remoteExecutionStore.updateStatus(request.request_id, 'completed');
    remoteExecutionStore.saveResult(result);

    eventBus.emit('remote.execution.completed', result);
    auditLog.append({
      id: nextAuditId(),
      eventType: 'remote_execution.completed',
      objectType: 'RemoteExecutionRequest',
      objectId: request.request_id,
      actorId: 'local-stub',
      timestamp: Date.now(),
      summary: `Remote execution completed: ${request.execution_type}`,
      workspaceId: request.workspace_id,
      metadata: { remote_run_id: result.remote_run_id },
    });

    return request;
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

    return true;
  }

  /**
   * Simulates execution for each execution type.
   * Returns a stub stdout string.
   */
  private stubExecute(request: RemoteExecutionRequest): string {
    switch (request.execution_type) {
      case 'shell_command':
        return `[stub] executed: ${String(request.payload.command ?? '')}`;
      case 'file_write':
        return `[stub] wrote file: ${String(request.payload.path ?? '')}`;
      case 'patch_apply':
        return `[stub] applied patch (${String(request.payload.patch ?? '').length} bytes)`;
      case 'script_run':
        return `[stub] ran script: ${String(request.payload.script_name ?? request.payload.script ?? '')}`;
      default:
        return `[stub] unknown execution type`;
    }
  }
}

/**
 * Factory: creates a failing stub adapter for testing error/failure paths.
 * Every submit() call produces a failed result.
 */
export class FailingStubRemoteExecutionAdapter implements IRemoteExecutionAdapter {
  readonly name = 'failing-stub';

  constructor(private readonly failureMessage: string = 'Simulated execution failure') {}

  async submit(request: RemoteExecutionRequest): Promise<RemoteExecutionRequest> {
    remoteExecutionStore.saveRequest(request);

    if (!request.policy_context.approved) {
      request.status = 'rejected';
      remoteExecutionStore.updateStatus(request.request_id, 'rejected');
      return request;
    }

    request.status = 'dispatched';
    remoteExecutionStore.updateStatus(request.request_id, 'dispatched');
    eventBus.emit('remote.execution.requested', request);

    request.status = 'running';
    remoteExecutionStore.updateStatus(request.request_id, 'running');
    eventBus.emit('remote.execution.started', request);

    // Simulate failure
    const now = Date.now();
    const result: RemoteExecutionResult = {
      request_id: request.request_id,
      status: 'failed',
      stdout: '',
      stderr: this.failureMessage,
      exit_code: 1,
      artifact_ids: [],
      remote_run_id: `stub_run_${request.request_id}`,
      started_at: now,
      completed_at: now,
      error: this.failureMessage,
    };

    request.status = 'failed';
    remoteExecutionStore.updateStatus(request.request_id, 'failed');
    remoteExecutionStore.saveResult(result);

    eventBus.emit('remote.execution.failed', result);
    auditLog.append({
      id: nextAuditId(),
      eventType: 'remote_execution.failed',
      objectType: 'RemoteExecutionRequest',
      objectId: request.request_id,
      actorId: 'failing-stub',
      timestamp: now,
      summary: `Remote execution failed: ${this.failureMessage}`,
      workspaceId: request.workspace_id,
      metadata: { error: this.failureMessage },
    });

    return request;
  }

  async getStatus(requestId: string): Promise<RemoteExecutionRequest | undefined> {
    return remoteExecutionStore.getRequestById(requestId);
  }

  async getResult(requestId: string): Promise<RemoteExecutionResult | undefined> {
    return remoteExecutionStore.getResultByRequestId(requestId);
  }

  async cancel(_requestId: string): Promise<boolean> {
    return false;
  }
}

export const localStubAdapter = new LocalStubRemoteExecutionAdapter();
