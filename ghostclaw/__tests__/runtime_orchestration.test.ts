import { processSignal, runtimeStore } from '../packages/core/src/runtime_loop';
import { jobQueue } from '../packages/core/src/job_queue';
import { skillInvocationStore } from '../packages/core/src/skill_invocation';
import { assignmentStore } from '../packages/core/src/assignment';
import { auditLog } from '../packages/core/src/audit_log';
import { publishEventStore } from '../packages/core/src/publish_event';
import { eventBus } from '../packages/core/src/event_bus';
import {
  registerRuntimeSubscribers,
  resetSubscriberState,
} from '../packages/core/src/runtime_subscribers';

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
  eventBus.reset();
  resetSubscriberState();
  // Re-register subscribers on the clean bus for each test.
  registerRuntimeSubscribers();
}

beforeEach(resetAll);

// ─────────────────────────────────────────────────────────────────────────────
// Event emission order
// ─────────────────────────────────────────────────────────────────────────────

describe('event emission order', () => {
  it('emits events in the correct order for a successful pipeline run', () => {
    processSignal({ name: 'keyword_opportunity_detected', payload: { topic: 'AI' } });

    const history = eventBus.getHistory();
    const eventNames = history.map((e) => e.event);

    // Core lifecycle events must appear in this order
    const signalIdx = eventNames.indexOf('signal.received');
    const planIdx = eventNames.indexOf('plan.created');
    const jobIdx = eventNames.indexOf('job.queued');
    const jobAssignedIdx = eventNames.indexOf('job.assigned');
    const startedIdx = eventNames.indexOf('skill.invocation.started');
    const completedIdx = eventNames.indexOf('skill.invocation.completed');
    const artifactIdx = eventNames.indexOf('artifact.created');
    const auditIdx = eventNames.indexOf('audit.logged');

    expect(signalIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(signalIdx);
    expect(jobIdx).toBeGreaterThan(planIdx);
    expect(jobAssignedIdx).toBeGreaterThan(jobIdx);
    expect(startedIdx).toBeGreaterThan(jobIdx);
    expect(completedIdx).toBeGreaterThan(startedIdx);
    expect(artifactIdx).toBeGreaterThan(completedIdx);
    expect(auditIdx).toBeGreaterThan(signalIdx);
  });

  it('emits signal.received before plan.created', () => {
    processSignal({ name: 'ranking_loss_detected' });
    const history = eventBus.getHistory();
    const names = history.map((e) => e.event);
    expect(names.indexOf('signal.received')).toBeLessThan(names.indexOf('plan.created'));
  });

  it('emits job.queued before job.assigned', () => {
    processSignal({ name: 'ranking_loss_detected' });
    const names = eventBus.getHistory().map((e) => e.event);
    expect(names.indexOf('job.queued')).toBeLessThan(names.indexOf('job.assigned'));
  });

  it('emits artifact.created before publish.requested', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const names = eventBus.getHistory().map((e) => e.event);
    expect(names.indexOf('artifact.created')).toBeLessThan(names.indexOf('publish.requested'));
  });

  it('emits publish.requested before publish.completed', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const names = eventBus.getHistory().map((e) => e.event);
    expect(names.indexOf('publish.requested')).toBeLessThan(names.indexOf('publish.completed'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscriber handling
// ─────────────────────────────────────────────────────────────────────────────

describe('subscriber handling', () => {
  it('subscriber for signal.received receives the correct Signal payload', () => {
    const handler = jest.fn();
    eventBus.on('signal.received', handler);

    processSignal({ name: 'keyword_opportunity_detected', payload: { topic: 'SEO' } });

    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0][0];
    expect(received.name).toBe('keyword_opportunity_detected');
    expect(received.payload).toEqual({ topic: 'SEO' });
    expect(received.id).toBeDefined();
    expect(received.createdAt).toBeDefined();
  });

  it('multiple subscribers for the same event all receive the payload', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    const h3 = jest.fn();
    eventBus.on('plan.created', h1);
    eventBus.on('plan.created', h2);
    eventBus.on('plan.created', h3);

    processSignal({ name: 'ranking_loss_detected' });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).toHaveBeenCalledTimes(1);
  });

  it('subscriber for one event does not receive payloads from another', () => {
    const signalHandler = jest.fn();
    const artifactHandler = jest.fn();
    eventBus.on('signal.received', signalHandler);
    eventBus.on('artifact.created', artifactHandler);

    processSignal({ name: 'keyword_opportunity_detected' });

    // signal handler should NOT receive artifact payloads
    for (const call of signalHandler.mock.calls) {
      expect(call[0]).not.toHaveProperty('skillInvocationId');
    }
    // artifact handler should NOT receive signal payloads
    for (const call of artifactHandler.mock.calls) {
      expect(call[0]).not.toHaveProperty('payload');
    }
  });

  it('subscriber for job.assigned receives agentName', () => {
    const handler = jest.fn();
    eventBus.on('job.assigned', handler);

    processSignal({ name: 'runtime_error_detected' });

    expect(handler).toHaveBeenCalledTimes(1);
    const payload = handler.mock.calls[0][0];
    expect(payload.agentName).toBe('DiagnosticsAgent');
    expect(payload.jobType).toBe('run_diagnostics');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure paths
// ─────────────────────────────────────────────────────────────────────────────

describe('failure paths', () => {
  it('a throwing subscriber does not prevent other subscribers from running', () => {
    const throwing = jest.fn(() => { throw new Error('subscriber boom'); });
    const safe = jest.fn();
    eventBus.on('signal.received', throwing);
    eventBus.on('signal.received', safe);

    expect(() => processSignal({ name: 'ranking_loss_detected' })).not.toThrow();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(safe).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not corrupt runtime state', () => {
    eventBus.on('plan.created', () => { throw new Error('plan subscriber failed'); });

    const result = processSignal({ name: 'keyword_opportunity_detected' });

    // Runtime should still produce the full result
    expect(result.signal).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.jobs).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.skillInvocations).toHaveLength(1);
    expect(result.assignments).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry / replay safety
// ─────────────────────────────────────────────────────────────────────────────

describe('retry and replay safety', () => {
  it('all emitted events have unique, monotonically increasing eventIds', () => {
    processSignal({ name: 'keyword_opportunity_detected' });

    const history = eventBus.getHistory();
    const ids = history.map((e) => e.eventId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);

    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it('event history is append-only and complete across two processSignal calls', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const firstCount = eventBus.getHistory().length;
    expect(firstCount).toBeGreaterThan(0);

    processSignal({ name: 'ranking_loss_detected' });
    const secondCount = eventBus.getHistory().length;
    expect(secondCount).toBeGreaterThan(firstCount);

    // All first-batch events still present
    const history = eventBus.getHistory();
    const first = history.slice(0, firstCount);
    expect(first.some((e) => e.event === 'signal.received')).toBe(true);
  });

  it('each event history entry has a timestamp', () => {
    processSignal({ name: 'runtime_error_detected' });
    for (const entry of eventBus.getHistory()) {
      expect(typeof entry.timestamp).toBe('number');
      expect(entry.timestamp).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit log integration
// ─────────────────────────────────────────────────────────────────────────────

describe('audit log integration', () => {
  it('audit log contains a signal.received entry after processSignal', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const entries = auditLog.listByEventType('signal.received');
    expect(entries).toHaveLength(1);
    expect(entries[0].objectType).toBe('Signal');
    expect(entries[0].actorId).toBe('runtime');
  });

  it('audit log contains a plan.created entry after processSignal', () => {
    processSignal({ name: 'ranking_loss_detected' });
    const entries = auditLog.listByEventType('plan.created');
    expect(entries).toHaveLength(1);
    expect(entries[0].objectType).toBe('Plan');
  });

  it('audit log contains skill_invocation.started and skill_invocation.completed entries', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    expect(auditLog.listByEventType('skill_invocation.started')).toHaveLength(1);
    expect(auditLog.listByEventType('skill_invocation.completed')).toHaveLength(1);
  });

  it('audit log contains an artifact.created entry after processSignal', () => {
    processSignal({ name: 'runtime_error_detected' });
    const entries = auditLog.listByEventType('artifact.created');
    expect(entries).toHaveLength(1);
    expect(entries[0].objectType).toBe('Artifact');
  });

  it('audit log entries have correct objectId linking to the runtime object', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });

    const signalEntries = auditLog.listByEventType('signal.received');
    expect(signalEntries[0].objectId).toBe(result.signal.id);

    const planEntries = auditLog.listByEventType('plan.created');
    expect(planEntries[0].objectId).toBe(result.plan.id);

    const artifactEntries = auditLog.listByEventType('artifact.created');
    expect(artifactEntries[0].objectId).toBe(result.artifacts[0].id);
  });

  it('audit log entries all have a non-zero timestamp', () => {
    processSignal({ name: 'ranking_loss_detected' });
    for (const entry of auditLog.listAll()) {
      expect(entry.timestamp).toBeGreaterThan(0);
    }
  });

  it('audit log accumulates entries across multiple processSignal calls', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const firstCount = auditLog.listAll().length;
    processSignal({ name: 'ranking_loss_detected' });
    expect(auditLog.listAll().length).toBeGreaterThan(firstCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Publish flow wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('publish flow', () => {
  it('publish.requested is emitted after artifact.created', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const names = eventBus.getHistory().map((e) => e.event);
    expect(names).toContain('publish.requested');
    expect(names.indexOf('artifact.created')).toBeLessThan(names.indexOf('publish.requested'));
  });

  it('publish.completed is emitted after publish.requested', () => {
    processSignal({ name: 'keyword_opportunity_detected' });
    const names = eventBus.getHistory().map((e) => e.event);
    expect(names).toContain('publish.completed');
    expect(names.indexOf('publish.requested')).toBeLessThan(names.indexOf('publish.completed'));
  });

  it('publish event store contains a published record after processSignal', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected' });
    const publishEvents = publishEventStore.listByArtifactId(result.artifacts[0].id);
    expect(publishEvents).toHaveLength(1);
    expect(publishEvents[0].status).toBe('published');
  });

  it('audit log contains publish_event.initiated entry', () => {
    processSignal({ name: 'ranking_loss_detected' });
    expect(auditLog.listByEventType('publish_event.initiated')).toHaveLength(1);
  });

  it('audit log contains publish_event.published entry', () => {
    processSignal({ name: 'ranking_loss_detected' });
    expect(auditLog.listByEventType('publish_event.published')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processSignal return shape preserved
// ─────────────────────────────────────────────────────────────────────────────

describe('processSignal return shape', () => {
  it('still returns signal, plan, jobs, artifacts, skillInvocations, assignments', () => {
    const result = processSignal({ name: 'keyword_opportunity_detected', payload: { topic: 'AI' } });

    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('jobs');
    expect(result).toHaveProperty('artifacts');
    expect(result).toHaveProperty('skillInvocations');
    expect(result).toHaveProperty('assignments');
  });

  it('result values match what is stored in runtimeStore', () => {
    const result = processSignal({ name: 'ranking_loss_detected' });

    expect(runtimeStore.signals).toContain(result.signal);
    expect(runtimeStore.plans).toContain(result.plan);
    expect(runtimeStore.jobs).toContainEqual(result.jobs[0]);
    expect(runtimeStore.artifacts).toContainEqual(result.artifacts[0]);
  });
});
