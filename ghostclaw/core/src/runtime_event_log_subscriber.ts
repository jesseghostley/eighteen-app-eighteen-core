import type { IRuntimeEventLogStore } from './storage/interfaces/IRuntimeEventLogStore';
import type { EventBus } from './event_bus';
import type { RuntimeEventMap } from './runtime_events';
import { runtimeEventLog as defaultRuntimeEventLog } from './runtime_event_log';

/**
 * Registers subscribers that persist every RuntimeEventMap event as a
 * `RuntimeEventLogEntry` in the provided store.
 *
 * For each event the subscriber extracts related object IDs from the payload
 * and determines a `correlation_id` that traces back to the originating signal,
 * linking all events in a single execution chain.
 *
 * A closure-based correlation map is built up as events arrive so that later
 * events (job.queued, skill.invocation.*, etc.) can be correlated back to the
 * originating signal even though their payloads do not carry `signalId` directly.
 *
 * Call once during runtime initialisation alongside `registerRuntimeSubscribers()`.
 * For tests, call after `eventBus.reset()` to re-register on a clean bus.
 */
export function registerRuntimeEventLogSubscribers(
  bus: EventBus<RuntimeEventMap>,
  store: IRuntimeEventLogStore = defaultRuntimeEventLog,
): void {
  // ── Correlation chain maps (scoped to this registration) ─────────────────
  // planId → signalId
  const planToSignal = new Map<string, string>();
  // jobId → signalId (resolved via planId)
  const jobToSignal = new Map<string, string>();
  // artifactId → signalId (resolved via jobId)
  const artifactToSignal = new Map<string, string>();

  bus.on('signal.received', (signal) => {
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'signal.received',
      occurred_at: Date.now(),
      signal_id: signal.id,
      correlation_id: signal.id,
      payload: signal,
    });
  });

  bus.on('plan.created', (plan) => {
    planToSignal.set(plan.id, plan.signalId);
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'plan.created',
      occurred_at: Date.now(),
      plan_id: plan.id,
      signal_id: plan.signalId,
      correlation_id: plan.signalId,
      payload: plan,
    });
  });

  bus.on('job.queued', (job) => {
    const signalId = planToSignal.get(job.planId) ?? job.planId;
    jobToSignal.set(job.id, signalId);
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'job.queued',
      occurred_at: Date.now(),
      job_id: job.id,
      plan_id: job.planId,
      signal_id: planToSignal.get(job.planId),
      correlation_id: signalId,
      payload: job,
    });
  });

  bus.on('job.assigned', (job) => {
    const signalId = jobToSignal.get(job.id) ?? planToSignal.get(job.planId) ?? job.planId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'job.assigned',
      occurred_at: Date.now(),
      job_id: job.id,
      plan_id: job.planId,
      signal_id: planToSignal.get(job.planId),
      correlation_id: signalId,
      payload: job,
    });
  });

  bus.on('skill.invocation.started', (invocation) => {
    const signalId = jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId) ?? invocation.planId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'skill.invocation.started',
      occurred_at: Date.now(),
      workspace_id: invocation.workspaceId,
      skill_invocation_id: invocation.id,
      job_id: invocation.jobId,
      plan_id: invocation.planId,
      assignment_id: invocation.assignmentId,
      signal_id: jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId),
      correlation_id: signalId,
      payload: invocation,
    });
  });

  bus.on('skill.invocation.completed', (invocation) => {
    const signalId = jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId) ?? invocation.planId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'skill.invocation.completed',
      occurred_at: Date.now(),
      workspace_id: invocation.workspaceId,
      skill_invocation_id: invocation.id,
      job_id: invocation.jobId,
      plan_id: invocation.planId,
      assignment_id: invocation.assignmentId,
      signal_id: jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId),
      correlation_id: signalId,
      payload: invocation,
    });
  });

  bus.on('skill.invocation.failed', (invocation) => {
    const signalId = jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId) ?? invocation.planId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'skill.invocation.failed',
      occurred_at: Date.now(),
      workspace_id: invocation.workspaceId,
      skill_invocation_id: invocation.id,
      job_id: invocation.jobId,
      plan_id: invocation.planId,
      assignment_id: invocation.assignmentId,
      signal_id: jobToSignal.get(invocation.jobId) ?? planToSignal.get(invocation.planId),
      correlation_id: signalId,
      payload: invocation,
    });
  });

  bus.on('artifact.created', (artifact) => {
    const signalId = jobToSignal.get(artifact.jobId) ?? artifact.jobId;
    artifactToSignal.set(artifact.id, signalId);
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'artifact.created',
      occurred_at: Date.now(),
      workspace_id: artifact.workspaceId,
      artifact_id: artifact.id,
      job_id: artifact.jobId,
      skill_invocation_id: artifact.skillInvocationId,
      signal_id: jobToSignal.get(artifact.jobId),
      correlation_id: signalId,
      payload: artifact,
    });
  });

  bus.on('publish.requested', (publishEvent) => {
    const signalId = artifactToSignal.get(publishEvent.artifactId) ?? publishEvent.artifactId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'publish.requested',
      occurred_at: Date.now(),
      publish_event_id: publishEvent.id,
      artifact_id: publishEvent.artifactId,
      signal_id: artifactToSignal.get(publishEvent.artifactId),
      correlation_id: signalId,
      payload: publishEvent,
    });
  });

  bus.on('publish.completed', (publishEvent) => {
    const signalId = artifactToSignal.get(publishEvent.artifactId) ?? publishEvent.artifactId;
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'publish.completed',
      occurred_at: Date.now(),
      publish_event_id: publishEvent.id,
      artifact_id: publishEvent.artifactId,
      signal_id: artifactToSignal.get(publishEvent.artifactId),
      correlation_id: signalId,
      payload: publishEvent,
    });
  });

  bus.on('audit.logged', (auditEntry) => {
    store.append({
      event_id: nextLogEntryId(),
      event_type: 'audit.logged',
      occurred_at: Date.now(),
      workspace_id: auditEntry.workspaceId,
      correlation_id: auditEntry.objectId,
      payload: auditEntry,
    });
  });
}

let _eventLogEntryCounter = 0;

function nextLogEntryId(): string {
  return `el_${++_eventLogEntryCounter}`;
}

/** Resets the subscriber-side ID counter — for test isolation only. */
export function resetEventLogSubscriberState(): void {
  _eventLogEntryCounter = 0;
}
