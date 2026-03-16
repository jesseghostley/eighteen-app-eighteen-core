import { WorkerBackendRegistry } from '../packages/core/src/worker_backend_manifest';
import type { WorkerBackendManifest } from '../packages/core/src/worker_backend_manifest';
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

function makeManifest(id: string, overrides: Partial<WorkerBackendManifest> = {}): WorkerBackendManifest {
  return {
    backend_id: id,
    backend_name: `backend-${id}`,
    backend_type: 'local',
    supported_execution_types: ['shell_command'],
    supported_capabilities: ['shell_command'],
    workspace_scope: null,
    trust_level: 'trusted',
    max_concurrency: 10,
    health_status: 'healthy',
    requires_approval: false,
    provider_class: 'LocalStubAdapter',
    ...overrides,
  };
}

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

describe('WorkerBackendManifest System', () => {
  let backendRegistry: WorkerBackendRegistry;

  beforeEach(() => {
    backendRegistry = new WorkerBackendRegistry();
    eventBus.reset();
    auditLog.reset();
    remoteExecutionStore.reset();
  });

  // ── Backend Registration ──────────────────────────────────────────────

  describe('WorkerBackendRegistry — registration', () => {
    it('registers a backend and stores it', () => {
      const manifest = makeManifest('be_1');
      backendRegistry.registerBackend(manifest);

      expect(backendRegistry.getBackendById('be_1')).toBeDefined();
      expect(backendRegistry.getBackendById('be_1')?.backend_name).toBe('backend-be_1');
    });

    it('lists all registered backends', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.registerBackend(makeManifest('be_2'));
      backendRegistry.registerBackend(makeManifest('be_3'));

      expect(backendRegistry.listBackends()).toHaveLength(3);
    });

    it('unregisters a backend by ID', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      expect(backendRegistry.unregisterBackend('be_1')).toBe(true);
      expect(backendRegistry.getBackendById('be_1')).toBeUndefined();
    });

    it('returns false when unregistering an unknown backend', () => {
      expect(backendRegistry.unregisterBackend('unknown')).toBe(false);
    });

    it('emits worker_backend.registered event', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));

      const events = eventBus.getHistory().filter((e) => e.event === 'worker_backend.registered');
      expect(events).toHaveLength(1);
      expect((events[0].payload as WorkerBackendManifest).backend_id).toBe('be_1');
    });

    it('emits worker_backend.unregistered event', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.unregisterBackend('be_1');

      const events = eventBus.getHistory().filter((e) => e.event === 'worker_backend.unregistered');
      expect(events).toHaveLength(1);
    });

    it('appends audit entry on registration', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));

      const entries = auditLog.listByEventType('worker_backend.registered');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('be_1');
      expect(entries[0].objectType).toBe('WorkerBackendManifest');
      expect(entries[0].metadata?.trust_level).toBe('trusted');
    });

    it('appends audit entry on unregistration', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.unregisterBackend('be_1');

      const entries = auditLog.listByEventType('worker_backend.unregistered');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('be_1');
    });
  });

  // ── Backend Update ────────────────────────────────────────────────────

  describe('WorkerBackendRegistry — update', () => {
    it('updates backend fields', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { health_status: 'healthy' }));
      const updated = backendRegistry.updateBackend('be_1', { health_status: 'degraded' });

      expect(updated?.health_status).toBe('degraded');
      expect(backendRegistry.getBackendById('be_1')?.health_status).toBe('degraded');
    });

    it('returns undefined for unknown backend', () => {
      expect(backendRegistry.updateBackend('unknown', { health_status: 'degraded' })).toBeUndefined();
    });

    it('emits worker_backend.updated event', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.updateBackend('be_1', { health_status: 'degraded' });

      const events = eventBus.getHistory().filter((e) => e.event === 'worker_backend.updated');
      expect(events).toHaveLength(1);
    });

    it('appends audit entry with previous and new state', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { max_concurrency: 10 }));
      backendRegistry.updateBackend('be_1', { max_concurrency: 20 });

      const entries = auditLog.listByEventType('worker_backend.updated');
      expect(entries).toHaveLength(1);
      expect(entries[0].previousState).toBeDefined();
      expect(entries[0].newState).toBeDefined();

      const prev = JSON.parse(entries[0].previousState!);
      const next = JSON.parse(entries[0].newState!);
      expect(prev.max_concurrency).toBe(10);
      expect(next.max_concurrency).toBe(20);
    });

    it('records updated field names in metadata', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.updateBackend('be_1', { health_status: 'degraded', max_concurrency: 5 });

      const entries = auditLog.listByEventType('worker_backend.updated');
      const fields = entries[0].metadata?.updated_fields as string[];
      expect(fields).toContain('health_status');
      expect(fields).toContain('max_concurrency');
    });
  });

  // ── Execution Type Lookup ─────────────────────────────────────────────

  describe('WorkerBackendRegistry — execution type lookup', () => {
    it('finds backends by execution type', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['shell_command', 'script_run'],
      }));
      backendRegistry.registerBackend(makeManifest('be_2', {
        supported_execution_types: ['patch_apply'],
      }));

      const shellBackends = backendRegistry.findBackendsByExecutionType('shell_command');
      expect(shellBackends).toHaveLength(1);
      expect(shellBackends[0].backend_id).toBe('be_1');

      const patchBackends = backendRegistry.findBackendsByExecutionType('patch_apply');
      expect(patchBackends).toHaveLength(1);
      expect(patchBackends[0].backend_id).toBe('be_2');
    });

    it('returns empty array when no backends support the type', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['shell_command'],
      }));

      expect(backendRegistry.findBackendsByExecutionType('file_write')).toHaveLength(0);
    });

    it('returns multiple backends for the same execution type', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['shell_command'],
      }));
      backendRegistry.registerBackend(makeManifest('be_2', {
        supported_execution_types: ['shell_command', 'script_run'],
      }));

      expect(backendRegistry.findBackendsByExecutionType('shell_command')).toHaveLength(2);
    });
  });

  // ── Capability Lookup ─────────────────────────────────────────────────

  describe('WorkerBackendRegistry — capability lookup', () => {
    it('finds backends by capability', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_capabilities: ['shell_command', 'docker'],
      }));
      backendRegistry.registerBackend(makeManifest('be_2', {
        supported_capabilities: ['shell_command', 'git'],
      }));

      const dockerBackends = backendRegistry.findBackendsByCapability('docker');
      expect(dockerBackends).toHaveLength(1);
      expect(dockerBackends[0].backend_id).toBe('be_1');
    });

    it('returns empty array when no backends have the capability', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_capabilities: ['shell_command'],
      }));

      expect(backendRegistry.findBackendsByCapability('kubernetes')).toHaveLength(0);
    });
  });

  // ── Workspace Scope ───────────────────────────────────────────────────

  describe('WorkerBackendRegistry — workspace scope', () => {
    it('global backends (null scope) serve any workspace', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { workspace_scope: null }));

      const backends = backendRegistry.findBackendsForWorkspace('ws_any');
      expect(backends).toHaveLength(1);
    });

    it('scoped backends only serve listed workspaces', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        workspace_scope: ['ws_1', 'ws_2'],
      }));

      expect(backendRegistry.findBackendsForWorkspace('ws_1')).toHaveLength(1);
      expect(backendRegistry.findBackendsForWorkspace('ws_3')).toHaveLength(0);
    });
  });

  // ── Compatible Backends ───────────────────────────────────────────────

  describe('WorkerBackendRegistry — findCompatibleBackends', () => {
    it('filters by execution type, capabilities, and health', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command', 'docker'],
        health_status: 'healthy',
      }));
      backendRegistry.registerBackend(makeManifest('be_2', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
        health_status: 'healthy',
      }));
      backendRegistry.registerBackend(makeManifest('be_3', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command', 'docker'],
        health_status: 'unavailable',
      }));

      const compatible = backendRegistry.findCompatibleBackends(
        'shell_command',
        ['docker'],
      );

      // Only be_1: has docker + healthy.  be_2 lacks docker, be_3 is unavailable.
      expect(compatible).toHaveLength(1);
      expect(compatible[0].backend_id).toBe('be_1');
    });

    it('includes degraded backends', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { health_status: 'degraded' }));

      const compatible = backendRegistry.findCompatibleBackends('shell_command', []);
      expect(compatible).toHaveLength(1);
    });

    it('respects workspace scope', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { workspace_scope: ['ws_1'] }));
      backendRegistry.registerBackend(makeManifest('be_2', { workspace_scope: null }));

      const forWs1 = backendRegistry.findCompatibleBackends('shell_command', [], 'ws_1');
      expect(forWs1).toHaveLength(2);

      const forWs2 = backendRegistry.findCompatibleBackends('shell_command', [], 'ws_2');
      expect(forWs2).toHaveLength(1);
      expect(forWs2[0].backend_id).toBe('be_2');
    });
  });

  // ── Worker/Backend Compatibility via WorkerSelector ───────────────────

  describe('WorkerSelector — backend manifest validation', () => {
    let workerRegistry: WorkerRegistry;

    beforeEach(() => {
      workerRegistry = new WorkerRegistry();
    });

    it('selects a worker whose backend manifest supports the execution type', () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w1');
      expect(result.matched_backend_id).toBe('local-stub');
    });

    it('rejects a worker whose backend manifest does not support the execution type', () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        supported_execution_types: ['patch_apply'],  // not shell_command
        supported_capabilities: ['shell_command'],
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
      expect(result.reason).toContain('compatible backend manifest');
    });

    it('rejects a worker whose backend manifest is unavailable', () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        health_status: 'unavailable',
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
    });

    it('rejects a worker whose backend has no registered manifest', () => {
      // No manifest registered for 'missing-backend'
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'missing-backend',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker).toBeNull();
    });

    it('selects only workers whose backend manifest supports required capabilities', () => {
      backendRegistry.registerBackend(makeManifest('be_basic', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
      }));
      backendRegistry.registerBackend(makeManifest('be_docker', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command', 'docker'],
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'be_basic',
      }));
      workerRegistry.registerWorker(makeWorker('w2', {
        capabilities: ['shell_command', 'docker'],
        execution_backend: 'be_docker',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: ['docker'],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w2');
      expect(result.matched_backend_id).toBe('be_docker');
    });

    it('respects workspace scope in backend manifest during selection', () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        workspace_scope: ['ws_2'],  // does NOT include ws_1
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
        workspace_id: 'ws_1',
      });

      expect(result.worker).toBeNull();
    });

    it('allows degraded backend manifests during selection', () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        health_status: 'degraded',
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const selector = new WorkerSelector(workerRegistry, backendRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w1');
    });

    it('still works without a backend registry (backwards compatible)', () => {
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
      }));

      // No backend registry passed
      const selector = new WorkerSelector(workerRegistry);
      const result = selector.select({
        execution_type: 'shell_command',
        required_capabilities: [],
        skill_invocation_id: 'inv_1',
      });

      expect(result.worker?.worker_id).toBe('w1');
      expect(result.matched_backend_id).toBeUndefined();
    });
  });

  // ── Routing through declared backend manifests ────────────────────────

  describe('WorkerExecutionAdapter — manifest-aware routing', () => {
    let workerRegistry: WorkerRegistry;

    beforeEach(() => {
      workerRegistry = new WorkerRegistry();
    });

    it('routes through a manifest-validated worker', async () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const adapter = new WorkerExecutionAdapter(workerRegistry, backendRegistry);
      adapter.registerBackend('local-stub', new LocalStubRemoteExecutionAdapter());

      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('completed');
    });

    it('rejects when backend manifest does not support execution type', async () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        supported_execution_types: ['patch_apply'],  // not shell_command
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const adapter = new WorkerExecutionAdapter(workerRegistry, backendRegistry);
      adapter.registerBackend('local-stub', new LocalStubRemoteExecutionAdapter());

      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('rejected');
    });

    it('rejects when backend manifest is unavailable', async () => {
      backendRegistry.registerBackend(makeManifest('local-stub', {
        health_status: 'unavailable',
      }));
      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'local-stub',
      }));

      const adapter = new WorkerExecutionAdapter(workerRegistry, backendRegistry);
      adapter.registerBackend('local-stub', new LocalStubRemoteExecutionAdapter());

      const request = makeRequest('req_1');
      const result = await adapter.submit(request);

      expect(result.status).toBe('rejected');
    });

    it('routes correctly when multiple backends exist', async () => {
      backendRegistry.registerBackend(makeManifest('be_shell', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
      }));
      backendRegistry.registerBackend(makeManifest('be_patch', {
        supported_execution_types: ['patch_apply'],
        supported_capabilities: ['patch_apply'],
      }));

      workerRegistry.registerWorker(makeWorker('w1', {
        capabilities: ['shell_command'],
        execution_backend: 'be_shell',
      }));
      workerRegistry.registerWorker(makeWorker('w2', {
        capabilities: ['patch_apply'],
        execution_backend: 'be_patch',
      }));

      const adapter = new WorkerExecutionAdapter(workerRegistry, backendRegistry);
      adapter.registerBackend('be_shell', new LocalStubRemoteExecutionAdapter());
      adapter.registerBackend('be_patch', new LocalStubRemoteExecutionAdapter());

      const shellReq = makeRequest('req_shell', { execution_type: 'shell_command' });
      const shellResult = await adapter.submit(shellReq);
      expect(shellResult.status).toBe('completed');

      const patchReq = makeRequest('req_patch', { execution_type: 'patch_apply' });
      const patchResult = await adapter.submit(patchReq);
      expect(patchResult.status).toBe('completed');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────

  describe('WorkerBackendRegistry — reset', () => {
    it('clears all backends on reset', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.registerBackend(makeManifest('be_2'));

      backendRegistry.reset();
      expect(backendRegistry.listBackends()).toHaveLength(0);
    });
  });
});
