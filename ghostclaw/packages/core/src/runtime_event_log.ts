import type { IRuntimeEventLogStore } from './storage/interfaces/IRuntimeEventLogStore';

/**
 * RuntimeEventLogEntry — a durable record of a single runtime lifecycle event.
 *
 * This is richer than the in-bus `EventHistoryEntry` and is designed for
 * persistence, auditability, and future replay/recovery use-cases.
 *
 * Canonical spec: ghostclaw_runtime_persistence_spec.md (runtime durability layer)
 */
export type RuntimeEventLogEntry = {
  /** Globally unique string identifier for this log entry. */
  event_id: string;
  /** Matches a key from RuntimeEventMap (e.g. 'signal.received', 'plan.created'). */
  event_type: string;
  /** Unix timestamp in milliseconds when the event occurred. */
  occurred_at: number;
  /** Workspace context when available. */
  workspace_id?: string;

  // ── Related object IDs ────────────────────────────────────────────────────
  signal_id?: string;
  plan_id?: string;
  job_id?: string;
  assignment_id?: string;
  skill_invocation_id?: string;
  artifact_id?: string;
  publish_event_id?: string;

  /** The raw event payload as emitted on the EventBus. */
  payload: unknown;

  /**
   * Execution-chain correlation ID.  Typically the `signal_id` that started
   * the chain, allowing all events in a single `processSignal()` call to be
   * grouped together.
   */
  correlation_id?: string;
};

/**
 * Append-only in-memory store for RuntimeEventLogEntry records.
 *
 * Mirrors the pattern used by InMemoryAuditLog.  Entries may only be
 * appended; no mutation or deletion methods are exposed.
 *
 * `event_id` values are assigned by the caller (e.g. the EventBus subscriber)
 * before calling `append()`.
 */
export class InMemoryRuntimeEventLogStore implements IRuntimeEventLogStore {
  private readonly entries: RuntimeEventLogEntry[] = [];

  append(entry: RuntimeEventLogEntry): RuntimeEventLogEntry {
    this.entries.push(entry);
    return entry;
  }

  getById(eventId: string): RuntimeEventLogEntry | undefined {
    return this.entries.find((e) => e.event_id === eventId);
  }

  /** Returns the most recent `limit` entries, ordered newest-first. */
  listRecent(limit: number): RuntimeEventLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  listByWorkspace(workspaceId: string): RuntimeEventLogEntry[] {
    return this.entries.filter((e) => e.workspace_id === workspaceId);
  }

  listByJob(jobId: string): RuntimeEventLogEntry[] {
    return this.entries.filter((e) => e.job_id === jobId);
  }

  listBySkillInvocation(skillInvocationId: string): RuntimeEventLogEntry[] {
    return this.entries.filter((e) => e.skill_invocation_id === skillInvocationId);
  }

  listByCorrelationId(correlationId: string): RuntimeEventLogEntry[] {
    return this.entries.filter((e) => e.correlation_id === correlationId);
  }

  /**
   * Resets the store.
   * Intended for test isolation only.
   */
  reset(): void {
    this.entries.length = 0;
  }
}

export const runtimeEventLog = new InMemoryRuntimeEventLogStore();
