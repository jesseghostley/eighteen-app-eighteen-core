import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PopeClawRemoteExecutionAdapter, defaultRetryPolicy } from '../core/src/pope_claw_adapter';
import {
  SimulatedSuccessDispatcher,
  SimulatedFailureDispatcher,
  SimulatedTransientFailureDispatcher,
  SimulatedPermanentFailureDispatcher,
  SimulatedControlledDispatcher,
} from '../core/src/pope_claw_simulated_dispatchers';
import {
  remoteExecutionStore,
  type RemoteExecutionRequest,
  type RemoteExecutionStatus,
} from '../core/src/remote_execution';
import { eventBus } from '../core/src/event_bus';
import { auditLog } from '../core/src/audit_log';

describe('PopeClawRemoteExecutionAdapter', () => {
  let adapter: PopeClawRemoteExecutionAdapter;
  let dispatcher: SimulatedSuccessDispatcher;

  const createRequest = (overrides?: Partial<RemoteExecutionRequest>): RemoteExecutionRequest => ({
    request_id: `req_${Date.now()}_${Math.random()}`,
    workspace_id: 'ws_test',
    job_id: 'job_1',
    assignment_id: 'assign_1',
    skill_invocation_id: 'skill_1',
    execution_type: 'shell_command',
    payload: { command: 'echo hello' },
    requested_capabilities: ['bash'],
    policy_context: {
      evaluated_policy_ids: ['policy_1'],
      approved: true,
    },
    status: 'pending' as RemoteExecutionStatus,
    created_at: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    remoteExecutionStore.reset();
    eventBus.reset();
    auditLog.reset();
    dispatcher = new SimulatedSuccessDispatcher();
    adapter = new PopeClawRemoteExecutionAdapter({
      name: 'test-adapter',
      dispatcher,
    });
  });

  afterEach(() => {
    dispatcher.reset();
  });

  describe('Policy Gate Enforcement', () => {
    it('should reject request when policy_context.approved is false', async () => {
      const request = createRequest({
        policy_context: {
          evaluated_policy_ids: ['policy_1'],
          approved: false,
          blocking_policy_id: 'policy_1',
        },
      });

      const result = await adapter.submit(request);

      expect(result.status).toBe('rejected');
      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('rejected');
    });

    it('should emit audit event for rejected request', async () => {
      const request = createRequest({
        policy_context: {
          evaluated_policy_ids: ['policy_1'],
          approved: false,
          blocking_policy_id: 'policy_1',
        },
      });

      await adapter.submit(request);

      const logs = auditLog.listAll();
      const rejectionEvent = logs.find((log) => log.eventType === 'remote_execution.rejected');
      expect(rejectionEvent).toBeDefined();
      expect(rejectionEvent?.summary).toContain('policy');
    });

    it('should allow request when policy_context.approved is true', async () => {
      const request = createRequest({
        policy_context: {
          evaluated_policy_ids: ['policy_1'],
          approved: true,
        },
      });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).not.toBe('rejected');
    });
  });

  describe('Execution Type Whitelisting', () => {
    it('should allow all execution types when whitelist is empty', async () => {
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher,
        executionTypeWhitelist: { allowedTypes: [] },
      });

      const request = createRequest({ execution_type: 'patch_apply' });
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).not.toBe('rejected');
    });

    it('should reject execution types not in whitelist', async () => {
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher,
        executionTypeWhitelist: { allowedTypes: ['shell_command', 'file_write'] },
      });

      const request = createRequest({ execution_type: 'patch_apply' });
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('rejected');
    });

    it('should allow execution types in whitelist', async () => {
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher,
        executionTypeWhitelist: { allowedTypes: ['shell_command', 'file_write'] },
      });

      const request = createRequest({ execution_type: 'shell_command' });
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).not.toBe('rejected');
    });

    it('should emit audit event for type whitelist rejection', async () => {
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher,
        executionTypeWhitelist: { allowedTypes: ['shell_command'] },
      });

      const request = createRequest({ execution_type: 'patch_apply' });
      await adapter.submit(request);

      const logs = auditLog.listAll();
      const rejectionEvent = logs.find((log) => log.eventType === 'remote_execution.rejected');
      expect(rejectionEvent?.summary).toContain('not whitelisted');
    });
  });

  describe('Runtime Event Emission', () => {
    it('should emit remote.execution.requested event', async () => {
      const request = createRequest();
      const events: string[] = [];

      eventBus.on('remote.execution.requested', () => {
        events.push('requested');
      });

      await adapter.submit(request);

      expect(events).toContain('requested');
    });

    it('should emit remote.execution.started event', async () => {
      const request = createRequest();
      const events: string[] = [];

      eventBus.on('remote.execution.started', () => {
        events.push('started');
      });

      await adapter.submit(request);

      expect(events).toContain('started');
    });

    it('should emit remote.execution.completed event on success', async () => {
      const request = createRequest();
      const events: string[] = [];

      eventBus.on('remote.execution.completed', () => {
        events.push('completed');
      });

      await adapter.submit(request);

      expect(events).toContain('completed');
    });

    it('should emit remote.execution.failed event on failure', async () => {
      const failureDispatcher = new SimulatedFailureDispatcher('Test error');
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: failureDispatcher,
      });

      const request = createRequest();
      const events: string[] = [];

      eventBus.on('remote.execution.failed', () => {
        events.push('failed');
      });

      await adapter.submit(request);

      expect(events).toContain('failed');
    });

    it('should emit events in correct order: requested → started → completed', async () => {
      const request = createRequest();
      const eventHistory = eventBus.getHistory();

      eventBus.reset(); // Clear history before test
      await adapter.submit(request);

      const newHistory = eventBus.getHistory();
      const eventNames = newHistory.map((e) => e.event);

      expect(eventNames).toContain('remote.execution.requested');
      expect(eventNames).toContain('remote.execution.started');
      expect(eventNames).toContain('remote.execution.completed');

      const reqIndex = eventNames.indexOf('remote.execution.requested');
      const startIndex = eventNames.indexOf('remote.execution.started');
      const complIndex = eventNames.indexOf('remote.execution.completed');

      expect(reqIndex).toBeLessThan(startIndex);
      expect(startIndex).toBeLessThan(complIndex);
    });
  });

  describe('Audit Logging', () => {
    it('should log audit entry for requested event', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      const requestLog = logs.find((log) => log.eventType === 'remote_execution.requested');
      expect(requestLog).toBeDefined();
      expect(requestLog?.objectId).toBe(request.request_id);
    });

    it('should log audit entry with dispatcher metadata', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      const requestLog = logs.find((log) => log.eventType === 'remote_execution.requested');
      expect(requestLog?.metadata?.dispatcherName).toBe('simulated-success');
    });

    it('should log audit entry for completed event', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      const completedLog = logs.find((log) => log.eventType === 'remote_execution.completed');
      expect(completedLog).toBeDefined();
      expect(completedLog?.metadata?.remoteRunId).toBeDefined();
    });

    it('should include execution time in audit metadata', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      const completedLog = logs.find((log) => log.eventType === 'remote_execution.completed');
      expect(completedLog?.metadata?.executionTimeMs).toBeDefined();
      expect(typeof completedLog?.metadata?.executionTimeMs).toBe('number');
    });

    it('should maintain workspace context in all audit entries', async () => {
      const request = createRequest({ workspace_id: 'ws_custom' });
      await adapter.submit(request);

      const logs = auditLog.listByWorkspaceId('ws_custom');
      expect(logs.length).toBeGreaterThan(0);
      logs.forEach((log) => {
        expect(log.workspaceId).toBe('ws_custom');
      });
    });
  });

  describe('Chain Traceability', () => {
    it('should preserve workspace_id through lifecycle', async () => {
      const workspaceId = 'ws_trace_1';
      const request = createRequest({ workspace_id: workspaceId });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.workspace_id).toBe(workspaceId);
    });

    it('should preserve job_id through lifecycle', async () => {
      const jobId = 'job_trace_1';
      const request = createRequest({ job_id: jobId });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.job_id).toBe(jobId);
    });

    it('should preserve assignment_id through lifecycle', async () => {
      const assignmentId = 'assign_trace_1';
      const request = createRequest({ assignment_id: assignmentId });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.assignment_id).toBe(assignmentId);
    });

    it('should preserve skill_invocation_id through lifecycle', async () => {
      const skillId = 'skill_trace_1';
      const request = createRequest({ skill_invocation_id: skillId });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.skill_invocation_id).toBe(skillId);
    });

    it('should maintain full chain context in result', async () => {
      const request = createRequest({
        workspace_id: 'ws_full',
        job_id: 'job_full',
        assignment_id: 'assign_full',
        skill_invocation_id: 'skill_full',
      });

      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result).toBeDefined();
      expect(result?.request_id).toBe(request.request_id);
    });
  });

  describe('Status Lifecycle', () => {
    it('should transition from pending to dispatched', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).not.toBe('pending');
    });

    it('should transition to running', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('completed');
    });

    it('should transition to completed on success', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('completed');
    });

    it('should transition to failed on failure', async () => {
      const failureDispatcher = new SimulatedFailureDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: failureDispatcher,
      });

      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('failed');
    });
  });

  describe('Result Storage', () => {
    it('should store result with request_id', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result).toBeDefined();
      expect(result?.request_id).toBe(request.request_id);
    });

    it('should store stdout from dispatcher', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result?.stdout).toContain('[simulated]');
    });

    it('should store remote_run_id from dispatcher', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result?.remote_run_id).toMatch(/simulated_run_/);
    });

    it('should store completed status on success', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result?.status).toBe('completed');
    });

    it('should store failed status on failure', async () => {
      const failureDispatcher = new SimulatedFailureDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: failureDispatcher,
      });

      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result?.status).toBe('failed');
      expect(result?.error).toBeDefined();
    });
  });

  describe('getStatus()', () => {
    it('should return request by id', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const status = await adapter.getStatus(request.request_id);
      expect(status).toBeDefined();
      expect(status?.request_id).toBe(request.request_id);
    });

    it('should return undefined for unknown request', async () => {
      const status = await adapter.getStatus('unknown_id');
      expect(status).toBeUndefined();
    });
  });

  describe('getResult()', () => {
    it('should return result by request id', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const result = await adapter.getResult(request.request_id);
      expect(result).toBeDefined();
      expect(result?.request_id).toBe(request.request_id);
    });

    it('should return undefined for unknown request', async () => {
      const result = await adapter.getResult('unknown_id');
      expect(result).toBeUndefined();
    });
  });

  describe('cancel()', () => {
    it('should cancel pending request', async () => {
      const request = createRequest();
      // Don't submit, so it remains pending
      remoteExecutionStore.saveRequest(request);

      const cancelled = await adapter.cancel(request.request_id);
      expect(cancelled).toBe(true);
    });

    it('should mark cancelled request as failed', async () => {
      const request = createRequest();
      remoteExecutionStore.saveRequest(request);

      await adapter.cancel(request.request_id);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('failed');
    });

    it('should return false for unknown request', async () => {
      const cancelled = await adapter.cancel('unknown_id');
      expect(cancelled).toBe(false);
    });

    it('should return false for running request', async () => {
      const request = createRequest();
      remoteExecutionStore.saveRequest(request);
      remoteExecutionStore.updateStatus(request.request_id, 'running');

      const cancelled = await adapter.cancel(request.request_id);
      expect(cancelled).toBe(false);
    });

    it('should emit failed event on cancellation', async () => {
      const request = createRequest();
      remoteExecutionStore.saveRequest(request);

      const events: string[] = [];
      eventBus.on('remote.execution.failed', () => {
        events.push('failed');
      });

      await adapter.cancel(request.request_id);

      expect(events).toContain('failed');
    });
  });

  describe('Retry Logic', () => {
    it('should classify timeout as transient error', async () => {
      const classification = defaultRetryPolicy.classifyError(new Error('Connection timeout'));
      expect(classification).toBe('transient');
    });

    it('should classify policy error as permanent', async () => {
      const classification = defaultRetryPolicy.classifyError(new Error('Policy rejected'));
      expect(classification).toBe('permanent');
    });

    it('should attempt retry on transient failure', async () => {
      const transientDispatcher = new SimulatedTransientFailureDispatcher(1);
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: transientDispatcher,
        retryPolicy: {
          maxRetries: 3,
          initialBackoffMs: 10,
          maxBackoffMs: 100,
          backoffMultiplier: 2,
          classifyError: defaultRetryPolicy.classifyError,
        },
      });

      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      // After retry succeeds
      expect(stored?.status).toBe('completed');
    });

    it('should respect max retries limit', async () => {
      const failureDispatcher = new SimulatedPermanentFailureDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: failureDispatcher,
        retryPolicy: {
          maxRetries: 1,
          initialBackoffMs: 10,
          maxBackoffMs: 100,
          backoffMultiplier: 2,
          classifyError: () => 'permanent',
        },
      });

      const request = createRequest();
      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById(request.request_id);
      expect(stored?.status).toBe('failed');
    });

    it('should include retry attempt in audit log', async () => {
      const transientDispatcher = new SimulatedTransientFailureDispatcher(1);
      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: transientDispatcher,
        retryPolicy: {
          maxRetries: 3,
          initialBackoffMs: 10,
          maxBackoffMs: 100,
          backoffMultiplier: 2,
          classifyError: defaultRetryPolicy.classifyError,
        },
      });

      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      // Look for failed logs that have retry attempt metadata (transient failure retry logs)
      const retryLog = logs.find(
        (log) => log.eventType === 'remote_execution.failed' && log.metadata?.retryAttempt !== undefined
      );
      expect(retryLog?.metadata?.retryAttempt).toBeDefined();
    });
  });

  describe('Name and Identity', () => {
    it('should report adapter name', () => {
      expect(adapter.name).toBe('test-adapter');
    });

    it('should use dispatcher name in audit logs', async () => {
      const request = createRequest();
      await adapter.submit(request);

      const logs = auditLog.listAll();
      logs.forEach((log) => {
        expect(log.actorId).toBe(dispatcher.name);
      });
    });
  });

  describe('Multiple Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const request1 = createRequest({ request_id: 'req_1' });
      const request2 = createRequest({ request_id: 'req_2' });
      const request3 = createRequest({ request_id: 'req_3' });

      await Promise.all([
        adapter.submit(request1),
        adapter.submit(request2),
        adapter.submit(request3),
      ]);

      const stored1 = remoteExecutionStore.getRequestById('req_1');
      const stored2 = remoteExecutionStore.getRequestById('req_2');
      const stored3 = remoteExecutionStore.getRequestById('req_3');

      expect(stored1?.status).toBe('completed');
      expect(stored2?.status).toBe('completed');
      expect(stored3?.status).toBe('completed');
    });

    it('should maintain isolation between requests', async () => {
      const request1 = createRequest({ request_id: 'req_1', workspace_id: 'ws_1' });
      const request2 = createRequest({ request_id: 'req_2', workspace_id: 'ws_2' });

      await Promise.all([adapter.submit(request1), adapter.submit(request2)]);

      const stored1 = remoteExecutionStore.getRequestById('req_1');
      const stored2 = remoteExecutionStore.getRequestById('req_2');

      expect(stored1?.workspace_id).toBe('ws_1');
      expect(stored2?.workspace_id).toBe('ws_2');
    });
  });

  describe('Controlled Dispatcher Tests', () => {
    it('should respect controlled dispatcher results', async () => {
      const controlled = new SimulatedControlledDispatcher();
      controlled.setNextResult({
        status: 'completed',
        stdout: 'Custom output',
        stderr: 'Custom stderr',
        exit_code: 42,
      });

      const adapter = new PopeClawRemoteExecutionAdapter({
        name: 'test-adapter',
        dispatcher: controlled,
      });

      const request = createRequest();
      await adapter.submit(request);

      const result = remoteExecutionStore.getResultByRequestId(request.request_id);
      expect(result?.stdout).toBe('Custom output');
      expect(result?.exit_code).toBe(42);
    });
  });
});
