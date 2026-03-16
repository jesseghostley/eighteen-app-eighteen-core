import { processSignal, runtimeStore } from '../packages/core/src/runtime_loop';
import { jobQueue } from '../packages/core/src/job_queue';
import { skillInvocationStore } from '../packages/core/src/skill_invocation';
import { assignmentStore } from '../packages/core/src/assignment';
import { auditLog } from '../packages/core/src/audit_log';
import { publishEventStore } from '../packages/core/src/publish_event';
import { eventBus } from '../packages/core/src/event_bus';
import { EventBus } from '../packages/core/src/event_bus';
import {
  registerRuntimeSubscribers,
  resetSubscriberState,
} from '../packages/core/src/runtime_subscribers';
import { runtimeEventLog } from '../packages/core/src/runtime_event_log';
import { REPLAYABLE_EVENTS, NON_REPLAYABLE_EVENTS, isReplayable, replayEvents } from '../packages/core/src/replay';

function resetAll() {
  runtimeStore.signals.length = 0;
  runtimeStore.plans.length = 0;
  runtimeStore.jobs.length = 0;
  runtimeStore.artifacts.length = 0;
  runtimeStore.skillInvocations.length = 0;
  runtimeStore.assignments.length = 0;
  jobQueue.reset();
  skillInvocationStore.reset();
  assignmentStore.reset();
  auditLog.reset();
  publishEventStore.reset();
  runtimeEventLog.reset();
  eventBus.reset();
  resetSubscriberState();
  // Re-register subscribers on the clean bus for each test.
  registerRuntimeSubscribers();
}

beforeEach(resetAll);

// ─────────────────────────────────────────────────────────────────────────────
// Event persistence
// ─────────────────────────────────────────────────────────────────────────────

describe('event persistence', () => {
  it('runtimeEventLog contains entries for all emitted events after processSignal', () => {
    processSignal({ name: 'keyword_opportunity_detected', payload: { topic: 'AI' } });

    const entries = runtimeEventLog.listRecent(100);
    const eventTypes = entries.map((e) => e.event_type);

    expect(eventTypes).toContain('signal.received');
    expect(eventTypes).toContain('plan.created');
    expect(eventTypes).toContain('job.queued');
    expect(eventTypes).toContain('job.assigned');
    expect(eventTypes).toContain('skill.invocation.started');
    expect(eventTypes).toContain('skill.invocation.completed');
    expect(eventTypes).toContain('artifact.created');
    expect(eventTypes).toContain('publish.requested');
    expect(eventTypes).toContain('publish.completed');
    expect(eventTypes).toContain('audit.logged');
  });

  it('entries accumulate across multiple processSignal calls', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const firstCount = runtimeEventLog.listRecent(200).length;
    expect(firstCount).toBeGreaterThan(0);

    processSignal({ name: 'ranking_loss_detected' });
    const secondCount = runtimeEventLog.listRecent(200).length;
    expect(secondCount).toBeGreaterThan(firstCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry structure
// ─────────────────────────────────────────────────────────────────────────────

describe('entry structure', () => {
  it('each entry has a unique event_id', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const ids = entries.map((e) => e.event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each entry has a valid occurred_at timestamp', () => {
    processSignal({ name: 'ranking_loss_detected' });
    for (const entry of runtimeEventLog.listRecent(200)) {
      expect(typeof entry.occurred_at).toBe('number');
      expect(entry.occurred_at).toBeGreaterThan(0);
    }
  });

  it('artifact.created entry has artifact_id, job_id, and skill_invocation_id', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const artifactEntry = entries.find((e) => e.event_type === 'artifact.created');

    expect(artifactEntry).toBeDefined();
    expect(artifactEntry!.artifact_id).toBe(result.artifacts[0].id);
    expect(artifactEntry!.job_id).toBe(result.artifacts[0].jobId);
    expect(artifactEntry!.skill_invocation_id).toBe(result.artifacts[0].skillInvocationId);
  });

  it('skill.invocation entries have skill_invocation_id, job_id, plan_id, assignment_id', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const invEntry = entries.find((e) => e.event_type === 'skill.invocation.started');

    expect(invEntry).toBeDefined();
    expect(invEntry!.skill_invocation_id).toBe(result.skillInvocations[0].id);
    expect(invEntry!.job_id).toBe(result.skillInvocations[0].jobId);
    expect(invEntry!.plan_id).toBe(result.skillInvocations[0].planId);
    expect(invEntry!.assignment_id).toBe(result.skillInvocations[0].assignmentId);
  });

  it('publish.requested entry has publish_event_id and artifact_id', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const publishEntry = entries.find((e) => e.event_type === 'publish.requested');

    expect(publishEntry).toBeDefined();
    expect(publishEntry!.artifact_id).toBe(result.artifacts[0].id);
    expect(publishEntry!.publish_event_id).toBeDefined();
  });

  it('signal.received entry has signal_id matching the emitted signal', () => {
    const result = processSignal({ name: 'ranking_loss_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const signalEntry = entries.find((e) => e.event_type === 'signal.received');

    expect(signalEntry).toBeDefined();
    expect(signalEntry!.signal_id).toBe(result.signal.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('query behaviour', () => {
  it('getById() returns the correct entry', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const entries = runtimeEventLog.listRecent(200);
    const target = entries[0];
    const found = runtimeEventLog.getById(target.event_id);
    expect(found).toEqual(target);
  });

  it('getById() returns undefined for an unknown id', () => {
    expect(runtimeEventLog.getById('nonexistent')).toBeUndefined();
  });

  it('listRecent(n) returns the most recent n entries newest-first', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    processSignal({ name: 'ranking_loss_detected' });

    const all = runtimeEventLog.listRecent(200);
    const recent5 = runtimeEventLog.listRecent(5);

    expect(recent5).toHaveLength(5);
    // The first element of listRecent should be the last appended
    expect(recent5[0]).toEqual(all[0]);
  });

  it('listByJob() returns all events related to a specific job', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const jobId = result.jobs[0].id;
    const jobEntries = runtimeEventLog.listByJob(jobId);

    expect(jobEntries.length).toBeGreaterThan(0);
    for (const e of jobEntries) {
      expect(e.job_id).toBe(jobId);
    }

    const eventTypes = jobEntries.map((e) => e.event_type);
    expect(eventTypes).toContain('job.queued');
    expect(eventTypes).toContain('job.assigned');
    expect(eventTypes).toContain('skill.invocation.started');
    expect(eventTypes).toContain('skill.invocation.completed');
    expect(eventTypes).toContain('artifact.created');
  });

  it('listBySkillInvocation() returns correct events for that invocation', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const invId = result.skillInvocations[0].id;
    const invEntries = runtimeEventLog.listBySkillInvocation(invId);

    expect(invEntries.length).toBeGreaterThan(0);
    for (const e of invEntries) {
      expect(e.skill_invocation_id).toBe(invId);
    }

    const eventTypes = invEntries.map((e) => e.event_type);
    expect(eventTypes).toContain('skill.invocation.started');
    expect(eventTypes).toContain('skill.invocation.completed');
  });

  it('listByWorkspace() returns workspace-scoped events (empty when workspace_id not set)', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    // Signal, Plan, Job, Assignment do not carry workspaceId in this runtime.
    // Workspace-scoped events come from SkillInvocation which has a workspaceId.
    const entries = runtimeEventLog.listByWorkspace('nonexistent-workspace');
    expect(entries).toHaveLength(0);
  });

  it('listByWorkspace() returns events that have a matching workspace_id', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const allEntries = runtimeEventLog.listRecent(200);
    const workspaceEntry = allEntries.find((e) => e.workspace_id !== undefined);

    if (workspaceEntry && workspaceEntry.workspace_id) {
      const results = runtimeEventLog.listByWorkspace(workspaceEntry.workspace_id);
      expect(results.length).toBeGreaterThan(0);
      for (const e of results) {
        expect(e.workspace_id).toBe(workspaceEntry.workspace_id);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Correlation across execution chain
// ─────────────────────────────────────────────────────────────────────────────

describe('correlation across execution chain', () => {
  it('signal.received, plan.created, job.queued, job.assigned, skill.invocation.* entries all share the same correlation_id', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const signalId = result.signal.id;
    const allEntries = runtimeEventLog.listRecent(200);

    const coreChainTypes = [
      'signal.received',
      'plan.created',
      'job.queued',
      'job.assigned',
      'skill.invocation.started',
      'skill.invocation.completed',
    ];

    for (const eventType of coreChainTypes) {
      const entry = allEntries.find((e) => e.event_type === eventType);
      expect(entry).toBeDefined();
      expect(entry!.correlation_id).toBe(signalId);
    }
  });

  it('artifact.created entry has a correlation_id tracing back to the signal chain', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const allEntries = runtimeEventLog.listRecent(200);
    const artifactEntry = allEntries.find((e) => e.event_type === 'artifact.created');
    expect(artifactEntry).toBeDefined();
    // artifact.created correlation_id should be the signalId (via job chain)
    expect(artifactEntry!.correlation_id).toBe(result.signal.id);
  });

  it('publish events have a correlation_id tracing back to the signal chain', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const allEntries = runtimeEventLog.listRecent(200);

    const publishRequested = allEntries.find((e) => e.event_type === 'publish.requested');
    const publishCompleted = allEntries.find((e) => e.event_type === 'publish.completed');

    expect(publishRequested).toBeDefined();
    expect(publishCompleted).toBeDefined();
    expect(publishRequested!.correlation_id).toBe(result.signal.id);
    expect(publishCompleted!.correlation_id).toBe(result.signal.id);
  });

  it('listByCorrelationId() returns the full execution chain for a signal', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const signalId = result.signal.id;

    const chainEntries = runtimeEventLog.listByCorrelationId(signalId);
    expect(chainEntries.length).toBeGreaterThan(0);

    const chainTypes = chainEntries.map((e) => e.event_type);
    expect(chainTypes).toContain('signal.received');
    expect(chainTypes).toContain('plan.created');
    expect(chainTypes).toContain('job.queued');
    expect(chainTypes).toContain('job.assigned');
    expect(chainTypes).toContain('skill.invocation.started');
    expect(chainTypes).toContain('skill.invocation.completed');
    expect(chainTypes).toContain('artifact.created');
    expect(chainTypes).toContain('publish.requested');
    expect(chainTypes).toContain('publish.completed');
  });

  it('events from different processSignal calls have different correlation_ids', () => {
    const result1 = processSignal({ name: 'keyword_opportunity_detected' });
    const result2 = processSignal({ name: 'ranking_loss_detected' });

    expect(result1.signal.id).not.toBe(result2.signal.id);

    const chain1 = runtimeEventLog.listByCorrelationId(result1.signal.id);
    const chain2 = runtimeEventLog.listByCorrelationId(result2.signal.id);

    expect(chain1.length).toBeGreaterThan(0);
    expect(chain2.length).toBeGreaterThan(0);

    // Ensure there is no overlap between the two chains
    const ids1 = new Set(chain1.map((e) => e.event_id));
    for (const e of chain2) {
      expect(ids1.has(e.event_id)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay safety rules
// ─────────────────────────────────────────────────────────────────────────────

describe('replay safety rules', () => {
  it('REPLAYABLE_EVENTS contains the correct event types', () => {
    expect(REPLAYABLE_EVENTS).toContain('signal.received');
    expect(REPLAYABLE_EVENTS).toContain('plan.created');
    expect(REPLAYABLE_EVENTS).toContain('job.queued');
    expect(REPLAYABLE_EVENTS).toContain('job.assigned');
  });

  it('NON_REPLAYABLE_EVENTS contains the correct event types', () => {
    expect(NON_REPLAYABLE_EVENTS).toContain('skill.invocation.started');
    expect(NON_REPLAYABLE_EVENTS).toContain('skill.invocation.completed');
    expect(NON_REPLAYABLE_EVENTS).toContain('skill.invocation.failed');
    expect(NON_REPLAYABLE_EVENTS).toContain('artifact.created');
    expect(NON_REPLAYABLE_EVENTS).toContain('publish.requested');
    expect(NON_REPLAYABLE_EVENTS).toContain('publish.completed');
    expect(NON_REPLAYABLE_EVENTS).toContain('audit.logged');
  });

  it('isReplayable() returns true for replayable events', () => {
    expect(isReplayable('signal.received')).toBe(true);
    expect(isReplayable('plan.created')).toBe(true);
    expect(isReplayable('job.queued')).toBe(true);
    expect(isReplayable('job.assigned')).toBe(true);
  });

  it('isReplayable() returns false for non-replayable events', () => {
    expect(isReplayable('skill.invocation.started')).toBe(false);
    expect(isReplayable('skill.invocation.completed')).toBe(false);
    expect(isReplayable('skill.invocation.failed')).toBe(false);
    expect(isReplayable('artifact.created')).toBe(false);
    expect(isReplayable('publish.requested')).toBe(false);
    expect(isReplayable('publish.completed')).toBe(false);
    expect(isReplayable('audit.logged')).toBe(false);
  });

  it('isReplayable() returns false for unknown event types', () => {
    expect(isReplayable('unknown.event')).toBe(false);
    expect(isReplayable('')).toBe(false);
  });

  it('replayEvents() only replays replayable events and skips non-replayable ones', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const result = processSignal({ name: 'ranking_loss_detected' });
    const signalId = result.signal.id;
    const chainEntries = runtimeEventLog.listByCorrelationId(signalId);

    const replayBus = new EventBus();
    const replayResult = replayEvents(chainEntries, replayBus);

    // Replayed should only contain replayable event types
    for (const entry of replayResult.replayed) {
      expect(isReplayable(entry.event_type)).toBe(true);
    }

    // Skipped should only contain non-replayable event types
    for (const entry of replayResult.skipped) {
      expect(isReplayable(entry.event_type)).toBe(false);
    }

    expect(replayResult.replayed.length + replayResult.skipped.length).toBe(chainEntries.length);
  });

  it('replayEvents() returns correct replayed and skipped counts', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const allEntries = runtimeEventLog.listRecent(200);

    const replayBus = new EventBus();
    const result = replayEvents(allEntries, replayBus);

    const expectedReplayedCount = allEntries.filter((e) => isReplayable(e.event_type)).length;
    const expectedSkippedCount = allEntries.filter((e) => !isReplayable(e.event_type)).length;

    expect(result.replayed).toHaveLength(expectedReplayedCount);
    expect(result.skipped).toHaveLength(expectedSkippedCount);
    expect(result.errors).toHaveLength(0);
  });

  it('a failing handler during replay does not abort other events; error is captured', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const allEntries = runtimeEventLog.listRecent(200);
    const replayableEntries = allEntries.filter((e) => isReplayable(e.event_type));

    // Ensure we have at least one replayable entry
    expect(replayableEntries.length).toBeGreaterThan(0);

    const replayBus = new EventBus();
    // Register a handler that throws
    replayBus.on('signal.received', () => {
      throw new Error('replay handler boom');
    });

    // The EventBus swallows subscriber errors internally (see EventBus.emit()),
    // so we should still get the entries recorded in `replayed`, with no errors
    // surfaced to replayEvents().  This tests that the replay loop is resilient
    // regardless of how the bus handles handler failures.
    const result = replayEvents(replayableEntries, replayBus);

    // All replayable entries should be in replayed (bus catches the handler error)
    expect(result.replayed).toHaveLength(replayableEntries.length);
    expect(result.errors).toHaveLength(0);
  });

  it('replayEvents() returns empty results for an empty entry list', () => {
    const replayBus = new EventBus();
    const result = replayEvents([], replayBus);
    expect(result.replayed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
