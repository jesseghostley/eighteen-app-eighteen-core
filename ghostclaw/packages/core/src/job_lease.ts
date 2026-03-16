import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import { jobQueue, type QueueJob } from './job_queue';
import type { WorkerRegistry } from './worker_node';

// ── Lease Types ────────────────────────────────────────────────────────────

/**
 * JobLeaseStatus — lifecycle state for a job lease.
 *
 *   active   — worker holds the lease and is executing the job
 *   released — worker finished the job and released the lease normally
 *   expired  — lease timed out (worker crashed or failed to renew)
 *   revoked  — lease forcibly revoked by the system
 */
export type JobLeaseStatus = 'active' | 'released' | 'expired' | 'revoked';

/**
 * JobLease — represents a worker's exclusive claim on a job.
 *
 * In a distributed environment, multiple workers may attempt to claim the
 * same job.  The lease mechanism ensures exactly one worker holds the claim
 * at any given time.  Workers must periodically renew their lease via
 * heartbeat; if the lease expires, the job becomes claimable again.
 */
export type JobLease = {
  /** Globally unique lease identifier. */
  job_lease_id: string;
  /** The job this lease applies to. */
  job_id: string;
  /** The worker that holds this lease. */
  worker_id: string;
  /** Unix timestamp (ms) when the lease was claimed. */
  claimed_at: number;
  /** Unix timestamp (ms) when the lease expires unless renewed. */
  lease_expires_at: number;
  /** Unix timestamp (ms) of the last heartbeat/renewal. */
  heartbeat_at: number;
  /** How many times this job has been leased (including reclaims). */
  retry_count: number;
  /** Current lease status. */
  lease_status: JobLeaseStatus;
};

// ── Lease Configuration ────────────────────────────────────────────────────

/**
 * Default lease duration in milliseconds (30 seconds).
 * Workers must renew before this window elapses.
 */
export const DEFAULT_LEASE_DURATION_MS = 30_000;

/**
 * Maximum number of times a job can be reclaimed after lease expiry.
 */
export const MAX_LEASE_RETRIES = 3;

// ── ID generators ──────────────────────────────────────────────────────────

let _nextLeaseId = 1;
function nextLeaseId(): string {
  return `lease_${_nextLeaseId++}`;
}

let _nextLeaseAuditId = 1;
function nextLeaseAuditId(): string {
  return `audit_jl_${_nextLeaseAuditId++}`;
}

// ── JobLeaseManager ────────────────────────────────────────────────────────

/**
 * JobLeaseManager — manages lease-based job claiming for distributed workers.
 *
 * Ensures that:
 * - Only one worker can hold a lease on a given job at any time.
 * - Workers must renew leases via heartbeat before expiry.
 * - Expired leases are detected and the job becomes re-claimable.
 * - Jobs that exceed the maximum retry count are marked as failed.
 *
 * Integrates with WorkerRegistry (to verify worker liveness), the job queue
 * (to transition job statuses), the event bus, and the audit log.
 */
export class JobLeaseManager {
  private readonly leases = new Map<string, JobLease>();
  /** Index: job_id → active lease_id for O(1) duplicate-claim prevention. */
  private readonly activeLeaseByJob = new Map<string, string>();
  private readonly leaseDurationMs: number;

  constructor(
    private readonly workerRegistry: WorkerRegistry,
    leaseDurationMs?: number,
  ) {
    this.leaseDurationMs = leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  }

  // ── Core lease operations ─────────────────────────────────────────────

  /**
   * Attempt to claim a lease on a job for a worker.
   *
   * Fails if:
   * - The job does not exist or is not in a claimable status.
   * - Another worker already holds an active lease on this job.
   * - The worker is not registered or is offline.
   * - The job has exceeded the maximum lease retry count.
   */
  claimLease(
    jobId: string,
    workerId: string,
  ): { success: boolean; lease: JobLease | null; reason: string } {
    // Validate worker
    const worker = this.workerRegistry.getWorkerById(workerId);
    if (!worker) {
      return { success: false, lease: null, reason: `Worker '${workerId}' not found in registry.` };
    }
    if (worker.status === 'offline') {
      return { success: false, lease: null, reason: `Worker '${workerId}' is offline.` };
    }

    // Validate job
    const job = this.findJobById(jobId);
    if (!job) {
      return { success: false, lease: null, reason: `Job '${jobId}' not found.` };
    }
    if (!this.isClaimableStatus(job.status)) {
      return { success: false, lease: null, reason: `Job '${jobId}' is not claimable (status: '${job.status}').` };
    }

    // Check for existing active lease (prevent duplicate execution)
    const existingLeaseId = this.activeLeaseByJob.get(jobId);
    if (existingLeaseId) {
      const existingLease = this.leases.get(existingLeaseId);
      if (existingLease && existingLease.lease_status === 'active') {
        return {
          success: false,
          lease: null,
          reason: `Job '${jobId}' already has an active lease held by worker '${existingLease.worker_id}'.`,
        };
      }
    }

    // Check retry limit from previous leases on this job
    const previousRetries = this.countPreviousRetries(jobId);
    if (previousRetries >= MAX_LEASE_RETRIES) {
      return {
        success: false,
        lease: null,
        reason: `Job '${jobId}' has exceeded maximum lease retries (${MAX_LEASE_RETRIES}).`,
      };
    }

    // Create the lease
    const now = Date.now();
    const lease: JobLease = {
      job_lease_id: nextLeaseId(),
      job_id: jobId,
      worker_id: workerId,
      claimed_at: now,
      lease_expires_at: now + this.leaseDurationMs,
      heartbeat_at: now,
      retry_count: previousRetries + 1,
      lease_status: 'active',
    };

    this.leases.set(lease.job_lease_id, lease);
    this.activeLeaseByJob.set(jobId, lease.job_lease_id);

    // Transition job to 'assigned' then 'running'
    job.assignedAgent = workerId;
    job.status = 'running';
    job.updatedAt = now;

    // Increment worker load
    this.workerRegistry.incrementLoad(workerId);

    const isReclaim = previousRetries > 0;
    this.emitClaimed(lease);
    if (isReclaim) {
      this.emitReclaimed(lease);
    }
    return { success: true, lease, reason: isReclaim ? 'Lease reclaimed successfully.' : 'Lease claimed successfully.' };
  }

  /**
   * Renew an active lease, extending the expiry window.
   *
   * Workers should call this periodically (heartbeat) to signal liveness.
   */
  renewLease(
    jobLeaseId: string,
  ): { success: boolean; lease: JobLease | null; reason: string } {
    const lease = this.leases.get(jobLeaseId);
    if (!lease) {
      return { success: false, lease: null, reason: `Lease '${jobLeaseId}' not found.` };
    }
    if (lease.lease_status !== 'active') {
      return {
        success: false,
        lease: null,
        reason: `Lease '${jobLeaseId}' is not active (status: '${lease.lease_status}').`,
      };
    }

    const now = Date.now();
    if (now > lease.lease_expires_at) {
      // Already expired — cannot renew
      return {
        success: false,
        lease: null,
        reason: `Lease '${jobLeaseId}' has already expired.`,
      };
    }

    lease.heartbeat_at = now;
    lease.lease_expires_at = now + this.leaseDurationMs;

    this.emitRenewed(lease);
    return { success: true, lease, reason: 'Lease renewed successfully.' };
  }

  /**
   * Release a lease normally (job completed or worker is done).
   *
   * Transitions the lease to 'released' and decrements the worker's load.
   */
  releaseLease(
    jobLeaseId: string,
  ): { success: boolean; lease: JobLease | null; reason: string } {
    const lease = this.leases.get(jobLeaseId);
    if (!lease) {
      return { success: false, lease: null, reason: `Lease '${jobLeaseId}' not found.` };
    }
    if (lease.lease_status !== 'active') {
      return {
        success: false,
        lease: null,
        reason: `Lease '${jobLeaseId}' is not active (status: '${lease.lease_status}').`,
      };
    }

    lease.lease_status = 'released';
    this.activeLeaseByJob.delete(lease.job_id);

    // Decrement worker load
    this.workerRegistry.decrementLoad(lease.worker_id);

    this.emitReleased(lease);
    return { success: true, lease, reason: 'Lease released successfully.' };
  }

  /**
   * Scan all active leases and expire any whose expiry time has passed.
   *
   * For each expired lease:
   * - Marks the lease as 'expired'.
   * - Clears the active-lease index for the job.
   * - Transitions the job back to 'queued' (if within retry limit).
   * - Marks the job as 'failed' if retries are exhausted.
   * - Marks the worker as offline via the WorkerRegistry.
   *
   * Returns all leases that were expired during this scan.
   */
  expireStaleLeases(): JobLease[] {
    const now = Date.now();
    const expired: JobLease[] = [];

    for (const lease of this.leases.values()) {
      if (lease.lease_status !== 'active') continue;
      if (now <= lease.lease_expires_at) continue;

      lease.lease_status = 'expired';
      this.activeLeaseByJob.delete(lease.job_id);

      // Decrement worker load and mark offline (worker presumed dead)
      this.workerRegistry.decrementLoad(lease.worker_id);
      this.workerRegistry.markOffline(lease.worker_id);

      // Transition job back to claimable or fail it
      const job = this.findJobById(lease.job_id);
      if (job) {
        if (lease.retry_count >= MAX_LEASE_RETRIES) {
          job.status = 'failed';
          job.updatedAt = now;
        } else {
          job.status = 'queued';
          job.assignedAgent = null;
          job.updatedAt = now;
        }
      }

      this.emitExpired(lease);
      expired.push(lease);
    }

    return expired;
  }

  /**
   * Find all jobs that are currently claimable (queued, no active lease).
   */
  findClaimableJobs(): QueueJob[] {
    return jobQueue.list().filter((job) => {
      if (!this.isClaimableStatus(job.status)) return false;
      const activeLeaseId = this.activeLeaseByJob.get(job.id);
      if (activeLeaseId) {
        const lease = this.leases.get(activeLeaseId);
        if (lease && lease.lease_status === 'active') return false;
      }
      // Check retry count hasn't been exceeded
      const retries = this.countPreviousRetries(job.id);
      if (retries >= MAX_LEASE_RETRIES) return false;
      return true;
    });
  }

  // ── Query methods ─────────────────────────────────────────────────────

  /**
   * Get a lease by its ID.
   */
  getLeaseById(jobLeaseId: string): JobLease | undefined {
    return this.leases.get(jobLeaseId);
  }

  /**
   * Get the currently active lease for a job (if any).
   */
  getActiveLeaseForJob(jobId: string): JobLease | undefined {
    const leaseId = this.activeLeaseByJob.get(jobId);
    if (!leaseId) return undefined;
    const lease = this.leases.get(leaseId);
    if (!lease || lease.lease_status !== 'active') return undefined;
    return lease;
  }

  /**
   * List all leases for a given job (including expired/released).
   */
  listLeasesForJob(jobId: string): JobLease[] {
    return Array.from(this.leases.values()).filter((l) => l.job_id === jobId);
  }

  /**
   * List all active leases held by a specific worker.
   */
  listLeasesForWorker(workerId: string): JobLease[] {
    return Array.from(this.leases.values()).filter(
      (l) => l.worker_id === workerId && l.lease_status === 'active',
    );
  }

  /**
   * List all leases.
   */
  listAll(): JobLease[] {
    return Array.from(this.leases.values());
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private isClaimableStatus(status: string): boolean {
    return status === 'queued';
  }

  private findJobById(jobId: string): QueueJob | undefined {
    return jobQueue.list().find((j) => j.id === jobId);
  }

  private countPreviousRetries(jobId: string): number {
    let maxRetry = 0;
    for (const lease of this.leases.values()) {
      if (lease.job_id === jobId) {
        maxRetry = Math.max(maxRetry, lease.retry_count);
      }
    }
    return maxRetry;
  }

  // ── Event Emission ────────────────────────────────────────────────────

  private emitClaimed(lease: JobLease): void {
    eventBus.emit('job.lease.claimed', lease);
    auditLog.append({
      id: nextLeaseAuditId(),
      eventType: 'job.lease.claimed',
      objectType: 'JobLease',
      objectId: lease.job_lease_id,
      actorId: lease.worker_id,
      timestamp: Date.now(),
      summary: `Worker '${lease.worker_id}' claimed lease on job '${lease.job_id}' (expires: ${new Date(lease.lease_expires_at).toISOString()}).`,
      metadata: {
        job_id: lease.job_id,
        worker_id: lease.worker_id,
        lease_expires_at: lease.lease_expires_at,
        retry_count: lease.retry_count,
      },
    });
  }

  private emitRenewed(lease: JobLease): void {
    eventBus.emit('job.lease.renewed', lease);
    auditLog.append({
      id: nextLeaseAuditId(),
      eventType: 'job.lease.renewed',
      objectType: 'JobLease',
      objectId: lease.job_lease_id,
      actorId: lease.worker_id,
      timestamp: Date.now(),
      summary: `Worker '${lease.worker_id}' renewed lease '${lease.job_lease_id}' on job '${lease.job_id}'.`,
      metadata: {
        job_id: lease.job_id,
        worker_id: lease.worker_id,
        new_expires_at: lease.lease_expires_at,
      },
    });
  }

  private emitReleased(lease: JobLease): void {
    eventBus.emit('job.lease.released', lease);
    auditLog.append({
      id: nextLeaseAuditId(),
      eventType: 'job.lease.released',
      objectType: 'JobLease',
      objectId: lease.job_lease_id,
      actorId: lease.worker_id,
      timestamp: Date.now(),
      summary: `Worker '${lease.worker_id}' released lease '${lease.job_lease_id}' on job '${lease.job_id}'.`,
      metadata: {
        job_id: lease.job_id,
        worker_id: lease.worker_id,
      },
    });
  }

  private emitExpired(lease: JobLease): void {
    eventBus.emit('job.lease.expired', lease);
    auditLog.append({
      id: nextLeaseAuditId(),
      eventType: 'job.lease.expired',
      objectType: 'JobLease',
      objectId: lease.job_lease_id,
      actorId: 'job-lease-manager',
      timestamp: Date.now(),
      summary: `Lease '${lease.job_lease_id}' on job '${lease.job_id}' expired (worker '${lease.worker_id}' presumed dead). Retry ${lease.retry_count}/${MAX_LEASE_RETRIES}.`,
      metadata: {
        job_id: lease.job_id,
        worker_id: lease.worker_id,
        retry_count: lease.retry_count,
        max_retries: MAX_LEASE_RETRIES,
      },
    });
  }

  private emitReclaimed(lease: JobLease): void {
    eventBus.emit('job.lease.reclaimed', lease);
    auditLog.append({
      id: nextLeaseAuditId(),
      eventType: 'job.lease.reclaimed',
      objectType: 'JobLease',
      objectId: lease.job_lease_id,
      actorId: lease.worker_id,
      timestamp: Date.now(),
      summary: `Worker '${lease.worker_id}' reclaimed job '${lease.job_id}' (retry ${lease.retry_count}/${MAX_LEASE_RETRIES}).`,
      metadata: {
        job_id: lease.job_id,
        worker_id: lease.worker_id,
        retry_count: lease.retry_count,
        max_retries: MAX_LEASE_RETRIES,
      },
    });
  }

  /**
   * Clear all internal state. For test isolation only.
   */
  reset(): void {
    this.leases.clear();
    this.activeLeaseByJob.clear();
    _nextLeaseId = 1;
    _nextLeaseAuditId = 1;
  }
}
