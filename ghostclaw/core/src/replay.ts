import type { RuntimeEventLogEntry } from './runtime_event_log';
import type { EventBus } from './event_bus';
import type { RuntimeEventMap } from './runtime_events';

/**
 * Events that are safe to replay because they are idempotent and deterministic.
 * Replaying these events recreates state-machine transitions without triggering
 * side-effecting operations.
 */
export const REPLAYABLE_EVENTS: ReadonlyArray<keyof RuntimeEventMap> = [
  'signal.received',
  'plan.created',
  'job.queued',
  'job.assigned',
] as const;

/**
 * Events that MUST NOT be replayed because they are side-effecting or
 * non-deterministic (e.g. external I/O, skill execution, publishing).
 */
export const NON_REPLAYABLE_EVENTS: ReadonlyArray<keyof RuntimeEventMap> = [
  'skill.invocation.started',
  'skill.invocation.completed',
  'skill.invocation.failed',
  'artifact.created',
  'publish.requested',
  'publish.completed',
  'audit.logged',
] as const;

/** Returns `true` if the given event type is classified as replayable. */
export function isReplayable(eventType: string): boolean {
  return (REPLAYABLE_EVENTS as readonly string[]).includes(eventType);
}

export type ReplayResult = {
  /** Entries that were successfully re-emitted. */
  replayed: RuntimeEventLogEntry[];
  /** Entries that were skipped because their event type is non-replayable. */
  skipped: RuntimeEventLogEntry[];
  /** Entries where the emit handler threw; does not abort the replay loop. */
  errors: Array<{ entry: RuntimeEventLogEntry; error: Error }>;
};

/**
 * Developer-safe replay utility.
 *
 * Re-emits a list of `RuntimeEventLogEntry` records on the provided `EventBus`,
 * skipping any non-replayable events and capturing per-entry errors so that a
 * single failing subscriber does not abort the whole replay.
 *
 * @param entries  - Ordered list of log entries to replay (typically from
 *                   `IRuntimeEventLogStore.listByCorrelationId()`).
 * @param bus      - The `EventBus` instance to emit on.
 * @returns        A `ReplayResult` summarising what was replayed, skipped, and errored.
 *
 * @warning **LOCAL / TEST USE ONLY.**
 * This utility is intentionally minimal and is NOT a production replay orchestrator.
 * It does not handle idempotency guards, distributed coordination, ordering guarantees
 * across nodes, or durable re-execution of skill invocations.  Do not use in
 * production workloads.
 */
export function replayEvents(
  entries: RuntimeEventLogEntry[],
  bus: EventBus<RuntimeEventMap>,
): ReplayResult {
  const replayed: RuntimeEventLogEntry[] = [];
  const skipped: RuntimeEventLogEntry[] = [];
  const errors: Array<{ entry: RuntimeEventLogEntry; error: Error }> = [];

  for (const entry of entries) {
    if (!isReplayable(entry.event_type)) {
      skipped.push(entry);
      continue;
    }

    try {
      bus.emit(
        entry.event_type as keyof RuntimeEventMap,
        entry.payload as RuntimeEventMap[keyof RuntimeEventMap],
      );
      replayed.push(entry);
    } catch (err) {
      errors.push({
        entry,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return { replayed, skipped, errors };
}
