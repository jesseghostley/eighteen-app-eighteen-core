import {
  PopeClawRemoteExecutionAdapter,
  SimulatedPopeClawDispatcher,
  DEFAULT_POPE_CLAW_CONFIG,
  classifyFailure,
  resetPopeClawAuditIds,
} from '../packages/core/src/pope_claw_adapter';
import type { PopeClawAdapterConfig } from '../packages/core/src/pope_claw_adapter';
import { remoteExecutionStore } from '../packages/core/src/remote_execution';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';
import type { RemoteExecutionRequest } from '../packages/core/src/remote_execution';

// ── Test helpers ────────────────────────────────────────────────────────────

function makeRequest(id: string, overrides: Partial<RemoteExecutionRequest> = {}): RemoteExecutionRequest {
  return {
    request_id: id,
    workspace_id: 'ws_1',
    job_id: 'job_1',
    assignment_id: 'assign_job_1',
    skill_invocation_id: 'inv_job_1',
    execution_type: 'shell_command',
    payload: { command: 'echo hello' },
    requested_capabilities: [],
    policy_context: {
      evaluated_policy_ids: [],
      approved: true,
    },
    status: 'pending',
    created_at: Date.now(),
    ...overrides,
  };
}

/** Config with zero-ms backoff for fast tests. */
function fastConfig(overrides: Partial<PopeClawAdapterConfig> = {}): PopeClawAdapterConfig {
  return {
    ...DEFAULT_POPE_CLAW_CONFIG,
    retry_policy: { max_retries: 2, backoff_ms: [0, 0] },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PopeClawRemoteExecutionAdapter', () => {
  beforeEach(() => {
    remoteExecutionStore.reset();
    eventBus.reset();
    auditLog.reset();
    resetPopeClawAuditIds();
  });

  // ── Approved request dispatch ─────────────────────────────────────────

  describe('approved request dispatch', () => {
    it('dispatches an approved request through the full lifecycle', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      const result = await adapter.submit(makeRequest('req_1'));

      expect(result.status).toBe('completed');
      expect(result.request_id).toBe('req_1');
      expect(dispatcher.dispatchCount).toBe(1);
    });

    it('persists request and result in the store', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const stored = remoteExecutionStore.getRequestById('req_1');
      expect(stored).toBeDefined();
      expect(stored?.status).toBe('completed');

      const execResult = await adapter.getResult('req_1');
      expect(execResult).toBeDefined();
      expect(execResult?.status).toBe('completed');
      expect(execResult?.remote_run_id).toContain('pope-claw');
    });

    it('produces stdout from the simulated dispatcher', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1', {
        execution_type: 'shell_command',
        payload: { command: 'ls -la' },
      }));

      const execResult = await adapter.getResult('req_1');
      expect(execResult?.stdout).toContain('ls -la');
      expect(execResult?.stdout).toContain('[pope-claw]');
    });

    it('supports all V1 execution types', async () => {
      const types = ['shell_command', 'patch_apply', 'file_write', 'script_run'] as const;
      for (const t of types) {
        remoteExecutionStore.reset();
        const dispatcher = new SimulatedPopeClawDispatcher();
        const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);
        const result = await adapter.submit(makeRequest(`req_${t}`, { execution_type: t }));
        expect(result.status).toBe('completed');
      }
    });

    it('includes commit_sha in result metadata', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const auditEntries = auditLog.listAll().filter(
        (e) => e.eventType === 'remote_execution.completed',
      );
      expect(auditEntries.length).toBeGreaterThan(0);
      expect((auditEntries[0].metadata as any)?.commit_sha).toBeDefined();
    });
  });

  // ── Rejected request path ─────────────────────────────────────────────

  describe('rejected request path', () => {
    it('rejects when policy_context.approved is false', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      const result = await adapter.submit(makeRequest('req_blocked', {
        policy_context: {
          evaluated_policy_ids: ['policy_safety_1'],
          approved: false,
          blocking_policy_id: 'policy_safety_1',
          enforcement_mode: 'block',
          summary: 'Safety policy prohibits shell_command',
        },
      }));

      expect(result.status).toBe('rejected');
      expect(dispatcher.dispatchCount).toBe(0);
    });

    it('does not emit runtime events for rejected requests', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_blocked', {
        policy_context: { evaluated_policy_ids: [], approved: false, blocking_policy_id: 'p1' },
      }));

      const remoteEvents = eventBus.getHistory().filter((e) => e.event.startsWith('remote.'));
      expect(remoteEvents).toHaveLength(0);
    });

    it('creates a rejection audit entry', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_blocked', {
        policy_context: { evaluated_policy_ids: ['p1'], approved: false, blocking_policy_id: 'p1' },
      }));

      const rejections = auditLog.listByEventType('remote_execution.rejected');
      expect(rejections).toHaveLength(1);
      expect(rejections[0].objectId).toBe('req_blocked');
      expect(rejections[0].summary).toContain('p1');
    });

    it('rejects unsupported execution types', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const config = fastConfig({
        supported_execution_types: ['shell_command'],
      });
      const adapter = new PopeClawRemoteExecutionAdapter(config, dispatcher);

      const result = await adapter.submit(makeRequest('req_unsupported', {
        execution_type: 'file_write',
      }));

      expect(result.status).toBe('rejected');
      expect(dispatcher.dispatchCount).toBe(0);

      const rejections = auditLog.listByEventType('remote_execution.rejected');
      expect(rejections).toHaveLength(1);
      expect(rejections[0].summary).toContain('Unsupported execution type');
    });
  });

  // ── Status and result retrieval ───────────────────────────────────────

  describe('status and result retrieval', () => {
    it('returns current status via getStatus', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));
      const status = await adapter.getStatus('req_1');

      expect(status).toBeDefined();
      expect(status?.status).toBe('completed');
    });

    it('returns undefined for unknown request_id', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      expect(await adapter.getStatus('nonexistent')).toBeUndefined();
      expect(await adapter.getResult('nonexistent')).toBeUndefined();
    });

    it('returns result with correct fields', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));
      const result = await adapter.getResult('req_1');

      expect(result).toBeDefined();
      expect(result?.request_id).toBe('req_1');
      expect(result?.status).toBe('completed');
      expect(result?.exit_code).toBe(0);
      expect(result?.error).toBeNull();
      expect(result?.remote_run_id).toBeDefined();
      expect(result?.started_at).toBeLessThanOrEqual(result!.completed_at);
      expect(result?.artifact_ids).toEqual([]);
    });
  });

  // ── Failure handling ──────────────────────────────────────────────────

  describe('failure handling', () => {
    it('marks request as failed when dispatcher returns failure', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'Permission denied');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      const result = await adapter.submit(makeRequest('req_fail'));

      expect(result.status).toBe('failed');
    });

    it('stores the error message in the result', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'Permission denied');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_fail'));
      const execResult = await adapter.getResult('req_fail');

      expect(execResult?.status).toBe('failed');
      expect(execResult?.error).toContain('Permission denied');
      expect(execResult?.stderr).toContain('Permission denied');
    });

    it('retries transient failures before giving up', async () => {
      // Simulate a transient "network timeout" failure
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'network timeout');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_retry'));

      // Should have dispatched: 1 initial + 2 retries = 3
      expect(dispatcher.dispatchCount).toBe(3);
    });

    it('does not retry permanent failures', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'Permission denied');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_perm'));

      // Only the initial dispatch, no retries
      expect(dispatcher.dispatchCount).toBe(1);
    });

    it('handles dispatch errors gracefully', async () => {
      const dispatcher: any = {
        dispatch: () => { throw new Error('Connection refused'); },
        awaitResult: () => ({ success: false, stdout: '', stderr: '', exit_code: 1 }),
      };
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      const result = await adapter.submit(makeRequest('req_err'));

      expect(result.status).toBe('failed');
      const execResult = await adapter.getResult('req_err');
      expect(execResult?.error).toContain('Connection refused');
    });
  });

  // ── Cancellation ──────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('returns false for unknown request_id', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);
      expect(await adapter.cancel('nonexistent')).toBe(false);
    });

    it('returns false for completed request', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));
      expect(await adapter.cancel('req_1')).toBe(false);
    });
  });

  // ── Event emission ────────────────────────────────────────────────────

  describe('event emission', () => {
    it('emits requested, started, and completed events for success', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const events = eventBus.getHistory()
        .filter((e) => e.event.startsWith('remote.execution.'))
        .map((e) => e.event);

      expect(events).toEqual([
        'remote.execution.requested',
        'remote.execution.started',
        'remote.execution.completed',
      ]);
    });

    it('emits requested, started, and failed events on failure', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'Permission denied');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_fail'));

      const events = eventBus.getHistory()
        .filter((e) => e.event.startsWith('remote.execution.'))
        .map((e) => e.event);

      expect(events).toEqual([
        'remote.execution.requested',
        'remote.execution.started',
        'remote.execution.failed',
      ]);
    });

    it('includes correct payload types in events', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const history = eventBus.getHistory();
      const requested = history.find((e) => e.event === 'remote.execution.requested');
      const completed = history.find((e) => e.event === 'remote.execution.completed');

      // requested → RemoteExecutionRequest
      expect((requested?.payload as any).request_id).toBe('req_1');
      expect((requested?.payload as any).execution_type).toBe('shell_command');

      // completed → RemoteExecutionResult
      expect((completed?.payload as any).request_id).toBe('req_1');
      expect((completed?.payload as any).stdout).toContain('[pope-claw]');
      expect((completed?.payload as any).remote_run_id).toBeDefined();
    });
  });

  // ── Audit event creation ──────────────────────────────────────────────

  describe('audit event creation', () => {
    it('creates audit entries for the full success lifecycle', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const entries = auditLog.listAll()
        .filter((e) => e.eventType.startsWith('remote_execution.'));
      const types = entries.map((e) => e.eventType);

      expect(types).toEqual([
        'remote_execution.requested',
        'remote_execution.started',
        'remote_execution.completed',
      ]);
    });

    it('sets actorId to the adapter name', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(
        fastConfig({ name: 'pope-claw-test' }),
        dispatcher,
      );

      await adapter.submit(makeRequest('req_1'));

      const entries = auditLog.listAll().filter((e) => e.eventType.startsWith('remote_execution.'));
      for (const entry of entries) {
        expect(entry.actorId).toBe('pope-claw-test');
      }
    });

    it('includes remote_endpoint in dispatch audit metadata', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const config = fastConfig({ remote_endpoint: 'ghostclaw/test-node' });
      const adapter = new PopeClawRemoteExecutionAdapter(config, dispatcher);

      await adapter.submit(makeRequest('req_1'));

      const requestedEntry = auditLog.listByEventType('remote_execution.requested')[0];
      expect((requestedEntry.metadata as any)?.remote_endpoint).toBe('ghostclaw/test-node');
    });

    it('includes failure_classification in failure audit metadata', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'Permission denied');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_fail'));

      const failedEntries = auditLog.listByEventType('remote_execution.failed');
      expect(failedEntries.length).toBeGreaterThan(0);
      expect((failedEntries[0].metadata as any)?.failure_classification).toBe('permanent');
    });

    it('logs retry attempts in audit for transient failures', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher(true, 'network timeout');
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_retry'));

      const allEntries = auditLog.listAll().filter(
        (e) => e.eventType.startsWith('remote_execution.'),
      );
      // Should include retry audit entries (Pope-Claw retry N/M)
      const retryEntries = allEntries.filter((e) =>
        /retry \d+\/\d+/.test(e.summary),
      );
      expect(retryEntries.length).toBe(2); // 2 retries
    });
  });

  // ── Chain traceability ────────────────────────────────────────────────

  describe('chain traceability', () => {
    it('preserves all chain IDs through the lifecycle', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      const request = makeRequest('req_1', {
        workspace_id: 'ws_42',
        job_id: 'job_99',
        assignment_id: 'assign_99',
        skill_invocation_id: 'inv_99',
      });

      await adapter.submit(request);

      const stored = remoteExecutionStore.getRequestById('req_1');
      expect(stored?.workspace_id).toBe('ws_42');
      expect(stored?.job_id).toBe('job_99');
      expect(stored?.assignment_id).toBe('assign_99');
      expect(stored?.skill_invocation_id).toBe('inv_99');
    });

    it('sets workspaceId on all audit entries', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(fastConfig(), dispatcher);

      await adapter.submit(makeRequest('req_1', { workspace_id: 'ws_traced' }));

      const entries = auditLog.listByWorkspaceId('ws_traced');
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.workspaceId).toBe('ws_traced');
      }
    });
  });

  // ── Failure classification ────────────────────────────────────────────

  describe('classifyFailure', () => {
    it('classifies network errors as transient', () => {
      expect(classifyFailure('network timeout')).toBe('transient');
      expect(classifyFailure('ECONNRESET')).toBe('transient');
      expect(classifyFailure('rate limit exceeded')).toBe('transient');
      expect(classifyFailure('503 Service Unavailable')).toBe('transient');
      expect(classifyFailure('runner unavailable')).toBe('transient');
    });

    it('classifies other errors as permanent', () => {
      expect(classifyFailure('Permission denied')).toBe('permanent');
      expect(classifyFailure('File not found')).toBe('permanent');
      expect(classifyFailure('Syntax error in script')).toBe('permanent');
    });
  });

  // ── Configuration ─────────────────────────────────────────────────────

  describe('configuration', () => {
    it('uses the adapter name from config', () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const adapter = new PopeClawRemoteExecutionAdapter(
        fastConfig({ name: 'pope-claw-github' }),
        dispatcher,
      );
      expect(adapter.name).toBe('pope-claw-github');
    });

    it('respects supported_execution_types from config', async () => {
      const dispatcher = new SimulatedPopeClawDispatcher();
      const config = fastConfig({ supported_execution_types: ['shell_command'] });
      const adapter = new PopeClawRemoteExecutionAdapter(config, dispatcher);

      const result = await adapter.submit(makeRequest('req_1', {
        execution_type: 'script_run',
      }));

      expect(result.status).toBe('rejected');
    });

    it('DEFAULT_POPE_CLAW_CONFIG has reasonable defaults', () => {
      expect(DEFAULT_POPE_CLAW_CONFIG.timeout_ms).toBe(120_000);
      expect(DEFAULT_POPE_CLAW_CONFIG.retry_policy.max_retries).toBe(2);
      expect(DEFAULT_POPE_CLAW_CONFIG.supported_execution_types).toContain('shell_command');
      expect(DEFAULT_POPE_CLAW_CONFIG.supported_execution_types).toContain('file_write');
      expect(DEFAULT_POPE_CLAW_CONFIG.supported_execution_types).toContain('patch_apply');
      expect(DEFAULT_POPE_CLAW_CONFIG.supported_execution_types).toContain('script_run');
    });
  });
});
