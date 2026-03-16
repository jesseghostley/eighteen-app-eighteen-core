import { WorkerRegistry } from '../packages/core/src/worker_node';
import type { WorkerNode } from '../packages/core/src/worker_node';
import { JobLeaseManager, DEFAULT_LEASE_DURATION_MS, MAX_LEASE_RETRIES } from '../packages/core/src/job_lease';
import { jobQueue } from '../packages/core/src/job_queue';
import type { QueueJob } from '../packages/core/src/job_queue';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';

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

function makeJob(id: string, overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id,
    planId: 'plan_1',
    jobType: 'draft_cluster_outline',
    assignedAgent: null,
    status: 'queued',
    inputPayload: {},
    outputPayload: null,
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('JobLeaseManager', () => {
  let registry: WorkerRegistry;
  let manager: JobLeaseManager;

  beforeEach(() => {
    registry = new WorkerRegistry();
    // Use a short lease duration for tests (100ms)
    manager = new JobLeaseManager(registry, 100);
    jobQueue.reset();
    auditLog.reset();
    eventBus.reset();
  });

  afterEach(() => {
    manager.reset();
    registry.reset();
  });

  // ── Lease Claiming ────────────────────────────────────────────────────

  describe('claimLease', () => {
    it('should claim a lease on a queued job', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      const job = makeJob('j1');
      jobQueue.enqueue(job);

      const result = manager.claimLease('j1', 'w1');

      expect(result.success).toBe(true);
      expect(result.lease).not.toBeNull();
      expect(result.lease!.job_id).toBe('j1');
      expect(result.lease!.worker_id).toBe('w1');
      expect(result.lease!.lease_status).toBe('active');
      expect(result.lease!.retry_count).toBe(1);
    });

    it('should transition job to running when lease is claimed', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      const job = makeJob('j1');
      jobQueue.enqueue(job);

      manager.claimLease('j1', 'w1');

      const jobs = jobQueue.list();
      const updatedJob = jobs.find((j) => j.id === 'j1');
      expect(updatedJob!.status).toBe('running');
      expect(updatedJob!.assignedAgent).toBe('w1');
    });

    it('should increment worker load on claim', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      manager.claimLease('j1', 'w1');

      const w = registry.getWorkerById('w1');
      expect(w!.current_load).toBe(1);
    });

    it('should prevent duplicate execution (same job claimed twice)', () => {
      const w1 = makeWorker('w1');
      const w2 = makeWorker('w2');
      registry.registerWorker(w1);
      registry.registerWorker(w2);
      jobQueue.enqueue(makeJob('j1'));

      const first = manager.claimLease('j1', 'w1');
      const second = manager.claimLease('j1', 'w2');

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.reason).toContain('not claimable');
    });

    it('should fail if worker is not registered', () => {
      jobQueue.enqueue(makeJob('j1'));

      const result = manager.claimLease('j1', 'unknown');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found in registry');
    });

    it('should fail if worker is offline', () => {
      const worker = makeWorker('w1', { status: 'offline' });
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const result = manager.claimLease('j1', 'w1');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('offline');
    });

    it('should fail if job does not exist', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);

      const result = manager.claimLease('nonexistent', 'w1');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should fail if job is not in claimable status', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1', { status: 'completed' }));

      const result = manager.claimLease('j1', 'w1');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not claimable');
    });

    it('should emit job.lease.claimed event', () => {
      const events: unknown[] = [];
      eventBus.on('job.lease.claimed', (data) => events.push(data));

      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      manager.claimLease('j1', 'w1');

      expect(events.length).toBe(1);
    });
  });

  // ── Lease Renewal ─────────────────────────────────────────────────────

  describe('renewLease', () => {
    it('should extend lease expiry on renewal', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      const originalExpiry = lease!.lease_expires_at;

      const result = manager.renewLease(lease!.job_lease_id);

      expect(result.success).toBe(true);
      expect(result.lease!.lease_expires_at).toBeGreaterThanOrEqual(originalExpiry);
    });

    it('should fail to renew a non-existent lease', () => {
      const result = manager.renewLease('nonexistent');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should fail to renew a released lease', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      manager.releaseLease(lease!.job_lease_id);

      const result = manager.renewLease(lease!.job_lease_id);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not active');
    });

    it('should emit job.lease.renewed event', () => {
      const events: unknown[] = [];
      eventBus.on('job.lease.renewed', (data) => events.push(data));

      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      manager.renewLease(lease!.job_lease_id);

      expect(events.length).toBe(1);
    });
  });

  // ── Lease Release ─────────────────────────────────────────────────────

  describe('releaseLease', () => {
    it('should release an active lease', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      const result = manager.releaseLease(lease!.job_lease_id);

      expect(result.success).toBe(true);
      expect(result.lease!.lease_status).toBe('released');
    });

    it('should decrement worker load on release', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      manager.claimLease('j1', 'w1');
      expect(registry.getWorkerById('w1')!.current_load).toBe(1);

      const { lease } = manager.claimLease('j1', 'w1'); // already claimed, will fail
      // Use the lease from the first claim
      const activeLease = manager.getActiveLeaseForJob('j1');
      manager.releaseLease(activeLease!.job_lease_id);

      expect(registry.getWorkerById('w1')!.current_load).toBe(0);
    });

    it('should clear active lease index on release', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      manager.releaseLease(lease!.job_lease_id);

      expect(manager.getActiveLeaseForJob('j1')).toBeUndefined();
    });

    it('should emit job.lease.released event', () => {
      const events: unknown[] = [];
      eventBus.on('job.lease.released', (data) => events.push(data));

      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const { lease } = manager.claimLease('j1', 'w1');
      manager.releaseLease(lease!.job_lease_id);

      expect(events.length).toBe(1);
    });
  });

  // ── Lease Expiration ──────────────────────────────────────────────────

  describe('expireStaleLeases', () => {
    it('should expire leases past their expiry time', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      // Use a very short lease duration (1ms)
      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      // Wait for the lease to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const expired = shortManager.expireStaleLeases();

      expect(expired.length).toBe(1);
      expect(expired[0].lease_status).toBe('expired');

      shortManager.reset();
    });

    it('should mark worker offline when lease expires', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      expect(registry.getWorkerById('w1')!.status).toBe('offline');

      shortManager.reset();
    });

    it('should transition job back to queued after lease expiry', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      const job = jobQueue.list().find((j) => j.id === 'j1');
      expect(job!.status).toBe('queued');
      expect(job!.assignedAgent).toBeNull();

      shortManager.reset();
    });

    it('should mark job as failed when retries exhausted', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);

      // Claim and expire MAX_LEASE_RETRIES times
      for (let i = 0; i < MAX_LEASE_RETRIES; i++) {
        // Bring worker back online for next claim
        const w = registry.getWorkerById('w1');
        if (w) {
          w.status = 'online';
          w.last_heartbeat = Date.now();
        }

        // Re-queue the job if needed
        const job = jobQueue.list().find((j) => j.id === 'j1');
        if (job && job.status !== 'queued') {
          job.status = 'queued';
          job.assignedAgent = null;
        }

        shortManager.claimLease('j1', 'w1');
        await new Promise((resolve) => setTimeout(resolve, 10));
        shortManager.expireStaleLeases();
      }

      const job = jobQueue.list().find((j) => j.id === 'j1');
      expect(job!.status).toBe('failed');

      shortManager.reset();
    });

    it('should emit job.lease.expired event', async () => {
      const events: unknown[] = [];
      eventBus.on('job.lease.expired', (data) => events.push(data));

      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      expect(events.length).toBe(1);

      shortManager.reset();
    });
  });

  // ── Reclaiming Jobs ───────────────────────────────────────────────────

  describe('reclaiming jobs', () => {
    it('should allow a different worker to reclaim an expired job', async () => {
      const w1 = makeWorker('w1');
      const w2 = makeWorker('w2');
      registry.registerWorker(w1);
      registry.registerWorker(w2);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      // Job should be claimable again
      const result = shortManager.claimLease('j1', 'w2');

      expect(result.success).toBe(true);
      expect(result.lease!.worker_id).toBe('w2');
      expect(result.lease!.retry_count).toBe(2);
      expect(result.reason).toContain('reclaimed');

      shortManager.reset();
    });

    it('should emit job.lease.reclaimed event on reclaim', async () => {
      const reclaimEvents: unknown[] = [];
      eventBus.on('job.lease.reclaimed', (data) => reclaimEvents.push(data));

      const w1 = makeWorker('w1');
      const w2 = makeWorker('w2');
      registry.registerWorker(w1);
      registry.registerWorker(w2);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      shortManager.claimLease('j1', 'w2');

      expect(reclaimEvents.length).toBe(1);

      shortManager.reset();
    });

    it('should not emit reclaimed event on first claim', () => {
      const reclaimEvents: unknown[] = [];
      eventBus.on('job.lease.reclaimed', (data) => reclaimEvents.push(data));

      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      manager.claimLease('j1', 'w1');

      expect(reclaimEvents.length).toBe(0);
    });
  });

  // ── Worker Crash Recovery ─────────────────────────────────────────────

  describe('worker crash recovery', () => {
    it('should recover all jobs held by a crashed worker', async () => {
      const w1 = makeWorker('w1');
      const w2 = makeWorker('w2');
      registry.registerWorker(w1);
      registry.registerWorker(w2);

      jobQueue.enqueue(makeJob('j1'));
      jobQueue.enqueue(makeJob('j2'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');
      shortManager.claimLease('j2', 'w1');

      // Worker crashes (leases expire)
      await new Promise((resolve) => setTimeout(resolve, 10));
      const expired = shortManager.expireStaleLeases();

      expect(expired.length).toBe(2);

      // Both jobs should be claimable
      const claimable = shortManager.findClaimableJobs();
      expect(claimable.length).toBe(2);

      // Another worker can reclaim both
      const r1 = shortManager.claimLease('j1', 'w2');
      const r2 = shortManager.claimLease('j2', 'w2');

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      shortManager.reset();
    });

    it('should decrement worker load on crash recovery', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);
      shortManager.claimLease('j1', 'w1');
      expect(registry.getWorkerById('w1')!.current_load).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 10));
      shortManager.expireStaleLeases();

      expect(registry.getWorkerById('w1')!.current_load).toBe(0);

      shortManager.reset();
    });
  });

  // ── findClaimableJobs ─────────────────────────────────────────────────

  describe('findClaimableJobs', () => {
    it('should return queued jobs without active leases', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);

      jobQueue.enqueue(makeJob('j1'));
      jobQueue.enqueue(makeJob('j2'));

      manager.claimLease('j1', 'w1');

      const claimable = manager.findClaimableJobs();
      expect(claimable.length).toBe(1);
      expect(claimable[0].id).toBe('j2');
    });

    it('should exclude jobs with exhausted retries', async () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      const shortManager = new JobLeaseManager(registry, 1);

      for (let i = 0; i < MAX_LEASE_RETRIES; i++) {
        const w = registry.getWorkerById('w1');
        if (w) {
          w.status = 'online';
          w.last_heartbeat = Date.now();
        }

        const job = jobQueue.list().find((j) => j.id === 'j1');
        if (job && job.status !== 'queued') {
          job.status = 'queued';
          job.assignedAgent = null;
        }

        shortManager.claimLease('j1', 'w1');
        await new Promise((resolve) => setTimeout(resolve, 10));
        shortManager.expireStaleLeases();
      }

      // Force job back to queued to test the filter
      const job = jobQueue.list().find((j) => j.id === 'j1');
      if (job) {
        job.status = 'queued';
      }

      const claimable = shortManager.findClaimableJobs();
      expect(claimable.length).toBe(0);

      shortManager.reset();
    });
  });

  // ── Audit Log Integration ────────────────────────────────────────────

  describe('audit log integration', () => {
    it('should append audit entries for lease lifecycle', () => {
      const worker = makeWorker('w1');
      registry.registerWorker(worker);
      jobQueue.enqueue(makeJob('j1'));

      // Clear audit entries from worker registration
      auditLog.reset();

      const { lease } = manager.claimLease('j1', 'w1');
      manager.renewLease(lease!.job_lease_id);
      manager.releaseLease(lease!.job_lease_id);

      const entries = auditLog.listAll();
      const leaseEntries = entries.filter((e: { eventType: string }) => e.eventType.startsWith('job.lease.'));

      expect(leaseEntries.length).toBe(3);
      expect(leaseEntries.map((e: { eventType: string }) => e.eventType)).toEqual([
        'job.lease.claimed',
        'job.lease.renewed',
        'job.lease.released',
      ]);
    });
  });
});
