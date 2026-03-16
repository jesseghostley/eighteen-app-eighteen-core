import { LocalStubRemoteExecutionAdapter, FailingStubRemoteExecutionAdapter } from '../packages/core/src/local_stub_adapter';
import { remoteExecutionStore } from '../packages/core/src/remote_execution';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';
import type { RemoteExecutionRequest } from '../packages/core/src/remote_execution';

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

describe('RemoteExecution', () => {
  let adapter: LocalStubRemoteExecutionAdapter;

  beforeEach(() => {
    remoteExecutionStore.reset();
    eventBus.reset();
    auditLog.reset();
    adapter = new LocalStubRemoteExecutionAdapter();
  });

  // ── Request submission ──────────────────────────────────────────────────

  describe('request submission', () => {
    it('submits a request and transitions through dispatched → running → completed', async () => {
      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('completed');
      expect(result.request_id).toBe('req_1');
    });

    it('persists the request in the store', async () => {
      await adapter.submit(makeRequest('req_1'));

      const stored = remoteExecutionStore.getRequestById('req_1');
      expect(stored).toBeDefined();
      expect(stored?.request_id).toBe('req_1');
    });

    it('supports all V1 execution types', async () => {
      const types = ['shell_command', 'patch_apply', 'file_write', 'script_run'] as const;
      for (const t of types) {
        remoteExecutionStore.reset();
        const req = makeRequest(`req_${t}`, { execution_type: t });
        const result = await adapter.submit(req);
        expect(result.status).toBe('completed');
      }
    });

    it('generates stub stdout for shell_command', async () => {
      await adapter.submit(makeRequest('req_1', { payload: { command: 'ls -la' } }));
      const result = await adapter.getResult('req_1');
      expect(result?.stdout).toContain('ls -la');
    });

    it('generates stub stdout for file_write', async () => {
      await adapter.submit(makeRequest('req_1', {
        execution_type: 'file_write',
        payload: { path: '/tmp/output.txt', content: 'hello' },
      }));
      const result = await adapter.getResult('req_1');
      expect(result?.stdout).toContain('/tmp/output.txt');
    });

    it('generates stub stdout for patch_apply', async () => {
      await adapter.submit(makeRequest('req_1', {
        execution_type: 'patch_apply',
        payload: { patch: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new' },
      }));
      const result = await adapter.getResult('req_1');
      expect(result?.stdout).toContain('applied patch');
    });

    it('generates stub stdout for script_run', async () => {
      await adapter.submit(makeRequest('req_1', {
        execution_type: 'script_run',
        payload: { script_name: 'deploy.sh' },
      }));
      const result = await adapter.getResult('req_1');
      expect(result?.stdout).toContain('deploy.sh');
    });
  });

  // ── Status lookup ───────────────────────────────────────────────────────

  describe('status lookup', () => {
    it('returns the request with current status via getStatus', async () => {
      await adapter.submit(makeRequest('req_1'));
      const status = await adapter.getStatus('req_1');
      expect(status).toBeDefined();
      expect(status?.status).toBe('completed');
    });

    it('returns undefined for unknown request_id', async () => {
      const status = await adapter.getStatus('nonexistent');
      expect(status).toBeUndefined();
    });

    it('lists requests by job_id', async () => {
      await adapter.submit(makeRequest('req_1', { job_id: 'job_A' }));
      await adapter.submit(makeRequest('req_2', { job_id: 'job_B' }));

      const jobA = remoteExecutionStore.listByJobId('job_A');
      expect(jobA).toHaveLength(1);
      expect(jobA[0].request_id).toBe('req_1');
    });

    it('lists requests by workspace_id', async () => {
      await adapter.submit(makeRequest('req_1', { workspace_id: 'ws_X' }));
      await adapter.submit(makeRequest('req_2', { workspace_id: 'ws_Y' }));

      const wsX = remoteExecutionStore.listByWorkspaceId('ws_X');
      expect(wsX).toHaveLength(1);
    });

    it('lists requests by status', async () => {
      await adapter.submit(makeRequest('req_1'));
      const completed = remoteExecutionStore.listByStatus('completed');
      expect(completed).toHaveLength(1);
    });
  });

  // ── Completion behaviour ────────────────────────────────────────────────

  describe('completion', () => {
    it('produces a result with stdout, exit_code, and timestamps', async () => {
      await adapter.submit(makeRequest('req_1'));
      const result = await adapter.getResult('req_1');

      expect(result).toBeDefined();
      expect(result?.status).toBe('completed');
      expect(result?.exit_code).toBe(0);
      expect(result?.error).toBeNull();
      expect(result?.started_at).toBeLessThanOrEqual(result!.completed_at);
      expect(result?.remote_run_id).toBe('stub_run_req_1');
    });

    it('returns undefined result for unknown request', async () => {
      const result = await adapter.getResult('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ── Failure behaviour ──────────────────────────────────────────────────

  describe('failure', () => {
    it('marks request as failed using FailingStubAdapter', async () => {
      const failing = new FailingStubRemoteExecutionAdapter('disk full');
      const request = makeRequest('req_fail');
      const result = await failing.submit(request);

      expect(result.status).toBe('failed');

      const execResult = await failing.getResult('req_fail');
      expect(execResult?.status).toBe('failed');
      expect(execResult?.error).toBe('disk full');
      expect(execResult?.stderr).toBe('disk full');
      expect(execResult?.exit_code).toBe(1);
    });

    it('emits remote.execution.failed event on failure', async () => {
      const failing = new FailingStubRemoteExecutionAdapter();
      await failing.submit(makeRequest('req_fail'));

      const history = eventBus.getHistory();
      const failEvents = history.filter((e) => e.event === 'remote.execution.failed');
      expect(failEvents).toHaveLength(1);
    });
  });

  // ── Policy rejection ──────────────────────────────────────────────────

  describe('policy rejection', () => {
    it('rejects request when policy_context.approved is false', async () => {
      const request = makeRequest('req_blocked', {
        policy_context: {
          evaluated_policy_ids: ['policy_1'],
          approved: false,
          blocking_policy_id: 'policy_1',
          enforcement_mode: 'block',
          summary: 'Execution blocked by safety policy',
        },
      });

      const result = await adapter.submit(request);
      expect(result.status).toBe('rejected');

      // No execution events emitted
      const history = eventBus.getHistory();
      const execEvents = history.filter((e) => e.event.startsWith('remote.execution.'));
      expect(execEvents).toHaveLength(0);
    });

    it('creates an audit log entry for rejected requests', async () => {
      const request = makeRequest('req_blocked', {
        policy_context: {
          evaluated_policy_ids: ['policy_1'],
          approved: false,
          blocking_policy_id: 'policy_1',
        },
      });

      await adapter.submit(request);

      const entries = auditLog.listByEventType('remote_execution.rejected');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('req_blocked');
    });
  });

  // ── Cancellation ─────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('returns false for unknown request_id', async () => {
      const cancelled = await adapter.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });

    it('returns false for already completed request', async () => {
      await adapter.submit(makeRequest('req_1'));
      const cancelled = await adapter.cancel('req_1');
      expect(cancelled).toBe(false);
    });
  });

  // ── Event emission ──────────────────────────────────────────────────────

  describe('event emission', () => {
    it('emits requested, started, and completed events in order', async () => {
      await adapter.submit(makeRequest('req_1'));

      const history = eventBus.getHistory();
      const remoteEvents = history
        .filter((e) => e.event.startsWith('remote.execution.'))
        .map((e) => e.event);

      expect(remoteEvents).toEqual([
        'remote.execution.requested',
        'remote.execution.started',
        'remote.execution.completed',
      ]);
    });

    it('emits events with correct payload types', async () => {
      await adapter.submit(makeRequest('req_1'));

      const history = eventBus.getHistory();
      const requested = history.find((e) => e.event === 'remote.execution.requested');
      const completed = history.find((e) => e.event === 'remote.execution.completed');

      // requested payload is a RemoteExecutionRequest
      expect((requested?.payload as any).request_id).toBe('req_1');
      expect((requested?.payload as any).execution_type).toBe('shell_command');

      // completed payload is a RemoteExecutionResult
      expect((completed?.payload as any).request_id).toBe('req_1');
      expect((completed?.payload as any).stdout).toBeDefined();
    });

    it('creates audit log entries for the full lifecycle', async () => {
      await adapter.submit(makeRequest('req_1'));

      const entries = auditLog.listAll();
      const reEntries = entries.filter((e) => e.eventType.startsWith('remote_execution.'));
      const types = reEntries.map((e) => e.eventType);

      expect(types).toEqual([
        'remote_execution.requested',
        'remote_execution.started',
        'remote_execution.completed',
      ]);
    });
  });

  // ── Store queries ─────────────────────────────────────────────────────

  describe('store', () => {
    it('lists all requests', async () => {
      await adapter.submit(makeRequest('req_1'));
      await adapter.submit(makeRequest('req_2'));

      expect(remoteExecutionStore.listAll()).toHaveLength(2);
    });

    it('resets cleanly', async () => {
      await adapter.submit(makeRequest('req_1'));
      remoteExecutionStore.reset();

      expect(remoteExecutionStore.listAll()).toHaveLength(0);
      expect(remoteExecutionStore.getResultByRequestId('req_1')).toBeUndefined();
    });
  });
});
