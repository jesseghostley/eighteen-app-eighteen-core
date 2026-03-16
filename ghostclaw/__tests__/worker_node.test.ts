import { WorkerRegistry } from '../packages/core/src/worker_node';
import type { WorkerNode } from '../packages/core/src/worker_node';
import { WorkerSelector } from '../packages/core/src/worker_selector';
import { WorkerExecutionAdapter } from '../packages/core/src/worker_execution_adapter';
import { LocalStubRemoteExecutionAdapter } from '../packages/core/src/local_stub_adapter';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';
import { remoteExecutionStore } from '../packages/core/src/remote_execution';
import type { RemoteExecutionRequest } from '../packages/core/src/remote_execution';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeWorker(id: string, overrides: Partial<WorkerNode> = {}): WorkerNode {
  return {
    worker_id: id,
    name: `worker-${id}`,
    status: 'online',
    capabilities: ['shell_command'],
    execution_backend: 'local-stub',
    last_heartbeat: Date.now(),
    max_concurrency: 4,
    current_load: 0,
    ...overrides,
  };
}

function makeRequest(id: string, overrides: Partial<RemoteExecutionRequest> = {}): RemoteExecutionRequest {
  return {
    request_id: id,
    workspace_id: 'ws_1',
    job_id: 'job_1',
    assignment_id: 'assign_1',
    skill_invocation_id: 'inv_1',
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WorkerNode System', () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
    eventBus.reset();
    auditLog.reset();
    remoteExecutionStore.reset();
  });

  // ── Worker Registration ───────────────────────────────────────────────

  describe('WorkerRegistry — registration', () => {
    it('registers a worker and stores it', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);

      expect(registry.getWorkerById('w1')).toBeDefined();
      expect(registry.getWorkerById('w1')?.name).toBe('worker-w1');
    });

    it('lists all registered workers', () => {
      registry.registerWorker(makeWorker('w1'));
      registry.registerWorker(makeWorker('w2'));
      registry.registerWorker(makeWorker('w3'));

      expect(registry.listWorkers()).toHaveLength(3);
    });

    it('unregisters a worker by ID', () => {
      registry.registerWorker(makeWorker('w1'));
      expect(registry.unregisterWorker('w1')).toBe(true);
      expect(registry.getWorkerById('w1')).toBeUndefined();
    });

    it('returns false when unregistering an unknown worker', () => {
      expect(registry.unregisterWorker('unknown')).toBe(false);
    });

    it('emits worker.registered event on registration', () => {
      registry.registerWorker(makeWorker('w1'));

      const events = eventBus.getHistory().filter((e) => e.event === 'worker.registered');
      expect(events).toHaveLength(1);
      expect((events[0].payload as WorkerNode).worker_id).toBe('w1');
    });

    it('appends audit entry on registration', () => {
      registry.registerWorker(makeWorker('w1'));

      const entries = auditLog.listAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('worker.registered');
      expect(entries[0].objectId).toBe('w1');
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────

  describe('WorkerRegistry — heartbeat', () => {
    it('updates last_heartbeat timestamp', () => {
      const worker = makeWorker('w1', { last_heartbeat: 1000 });
      registry.registerWorker(worker);

      const before = Date.now();
      registry.updateHeartbeat('w1');
      const updated = registry.getWorkerById('w1');

      expect(updated?.last_heartbeat).toBeGreaterThanOrEqual(before);
    });

    it('emits worker.heartbeat event', () => {
      registry.registerWorker(makeWorker('w1'));
      registry.updateHeartbeat('w1');

      const events = eventBus.getHistory().filter((e) => e.event === 'worker.heartbeat');
      expect(events).toHaveLength(1);
    });

    it('transitions offline worker back to online on heartbeat', () => {
      const worker = makeWorker('w1', { status: 'offline' });
      registry.registerWorker(worker);

      registry.updateHeartbeat('w1');
      expect(registry.getWorkerById('w1')?.status).toBe('online');
    });

    it('returns undefined for unknown worker heartbeat', () => {
      expect(registry.updateHeartbeat('unknown')).toBeUndefined();
    });
  });

  // ── Offline Detection ─────────────────────────────────────────────────

  describe('WorkerRegistry — offline detection', () => {
    it('marks workers offline when heartbeat exceeds timeout', () => {
      const staleHeartbeat = Date.now() - 60_000;
      registry.registerWorker(makeWorker('w1', { last_heartbeat: staleHeartbeat }));
      registry.registerWorker(makeWorker('w2')); // fresh heartbeat

      const offlined = registry.detectOfflineWorkers(30_000);
      expect(offlined).toHaveLength(1);
      expect(offlined[0].worker_id).toBe('w1');
      expect(registry.getWorkerById('w1')?.status).toBe('offline');
      expect(registry.getWorkerById('w2')?.status).toBe('online');
    });

    it('emits worker.offline event', () => {
      registry.registerWorker(makeWorker('w1'));
      registry.markOffline('w1');

      const events = eventBus.getHistory().filter((e) => e.event === 'worker.offline');
      expect(events).toHaveLength(1);
    });

    it('does not re-offline already-offline workers', () => {
      const stale = Date.now() - 60_000;
      registry.registerWorker(makeWorker('w1', { status: 'offline', last_heartbeat: stale }));

      const offlined = registry.detectOfflineWorkers(30_000);
      expect(offlined).toHaveLength(0);
    });
  });

  // ── Capability Matching ───────────────────────────────────────────────

  describe('WorkerRegistry — capability matching', () => {
    it('returns workers with the requested capability', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command', 'docker'] }));
      registry.registerWorker(makeWorker('w2', { capabilities: ['shell_command'] }));
      registry.registerWorker(makeWorker('w3', { capabilities: ['docker'] }));

      const dockerWorkers = registry.getWorkerByCapability('docker');
      expect(dockerWorkers).toHaveLength(2);
      expect(dockerWorkers.map((w) => w.worker_id).sort()).toEqual(['w1', 'w3']);
    });

    it('returns empty array when no workers match', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));
      expect(registry.getWorkerByCapability('kubernetes')).toHaveLength(0);
    });
  });

  // ── Load Management ───────────────────────────────────────────────────

  describe('WorkerRegistry — load management', () => {
    it('increments worker load', () => {
      registry.registerWorker(makeWorker('w1', { max_concurrency: 4, current_load: 0 }));
      registry.incrementLoad('w1');
      expect(registry.getWorkerById('w1')?.current_load).toBe(1);
    });

    it('transitions to busy when max concurrency reached', () => {
      registry.registerWorker(makeWorker('w1', { max_concurrency: 2, current_load: 1 }));
      registry.incrementLoad('w1');
      expect(registry.getWorkerById('w1')?.status).toBe('busy');
    });

    it('decrements worker load', () => {
      registry.registerWorker(makeWorker('w1', { current_load: 3 }));
      registry.decrementLoad('w1');
      expect(registry.getWorkerById('w1')?.current_load).toBe(2);
    });

    it('does not decrement below zero', () => {
      registry.registerWorker(makeWorker('w1', { current_load: 0 }));
      registry.decrementLoad('w1');
      expect(registry.getWorkerById('w1')?.current_load).toBe(0);
    });

    it('transitions from busy to online when load drops below max', () => {
      registry.registerWorker(makeWorker('w1', { max_concurrency: 2, current_load: 2, status: 'busy' }));
      registry.decrementLoad('w1');
      expect(registry.getWorkerById('w1')?.status).toBe('online');
    });
  });

  // ── WorkerSelector ────────────────────────────────────────────────────

  describe('WorkerSelector', () => {
    let selector: WorkerSelector;

    beforeEach(() => {
      selector = new WorkerSelector(registry);
    });

    it('selects an online worker with matching capabilities', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeDefined();
      expect(result.worker?.worker_id).toBe('w1');
    });

    it('returns null when no workers have required capabilities', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));

      const result = selector.select({
        execution_type: 'patch_apply',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
      expect(result.reason).toContain('No workers with required capabilities');
    });

    it('skips offline workers', () => {
      registry.registerWorker(makeWorker('w1', { status: 'offline', capabilities: ['shell_command'] }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
      expect(result.reason).toContain('none are online');
    });

    it('skips busy workers', () => {
      registry.registerWorker(makeWorker('w1', { status: 'busy', capabilities: ['shell_command'] }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
    });

    it('selects the least-loaded worker (load balancing)', () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        max_concurrency: 4,
        current_load: 3,
      }));
      registry.registerWorker(makeWorker('w2', {
        capabilities: ['shell_command'],
        max_concurrency: 4,
        current_load: 1,
      }));
      registry.registerWorker(makeWorker('w3', {
        capabilities: ['shell_command'],
        max_concurrency: 4,
        current_load: 2,
      }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w2');
    });

    it('considers load ratio, not absolute load', () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        max_concurrency: 10,
        current_load: 5,  // 50% loaded
      }));
      registry.registerWorker(makeWorker('w2', {
        capabilities: ['shell_command'],
        max_concurrency: 4,
        current_load: 1,  // 25% loaded
      }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w2');
    });

    it('matches additional required capabilities', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));
      registry.registerWorker(makeWorker('w2', { capabilities: ['shell_command', 'docker'] }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: ['docker'],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w2');
    });

    it('emits worker.selected event', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));

      selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      const events = eventBus.getHistory().filter((e) => e.event === 'worker.selected');
      expect(events).toHaveLength(1);
    });

    it('does not emit worker.selected when no worker found', () => {
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
      const events = eventBus.getHistory().filter((e) => e.event === 'worker.selected');
      expect(events).toHaveLength(0);
    });

    it('reports candidates_evaluated count', () => {
      registry.registerWorker(makeWorker('w1', { capabilities: ['shell_command'] }));
      registry.registerWorker(makeWorker('w2', { capabilities: ['shell_command'] }));

      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.candidates_evaluated).toBe(2);
    });
  });

  // ── WorkerExecutionAdapter ────────────────────────────────────────────

  describe('WorkerExecutionAdapter', () => {
    let adapter: WorkerExecutionAdapter;
    let stubBackend: LocalStubRemoteExecutionAdapter;

    beforeEach(() => {
      adapter = new WorkerExecutionAdapter(registry);
      stubBackend = new LocalStubRemoteExecutionAdapter();
      adapter.registerBackend('local-stub', stubBackend);
    });

    it('routes a request through a selected worker backend', async () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('completed');
    });

    it('rejects when no worker is available', async () => {
      // No workers registered
      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('rejected');
    });

    it('rejects when backend is not registered', async () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'unknown-backend',
      }));

      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('rejected');
    });

    it('decrements worker load after successful execution', async () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
        current_load: 0,
      }));

      await adapter.submit(makeRequest('req_1'));

      // Load should be back to 0 after completion
      expect(registry.getWorkerById('w1')?.current_load).toBe(0);
    });

    it('delegates getStatus to backends', async () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      await adapter.submit(makeRequest('req_1'));
      const status = await adapter.getStatus('req_1');
      expect(status).toBeDefined();
    });

    it('delegates getResult to backends', async () => {
      registry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      await adapter.submit(makeRequest('req_1'));
      const result = await adapter.getResult('req_1');
      expect(result).toBeDefined();
      expect(result?.status).toBe('completed');
    });
  });
});
