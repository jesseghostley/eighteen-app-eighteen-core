import type { EventBus } from './event_bus';
import type { RuntimeEventMap } from './runtime_events';
import type { InMemoryAuditLog, AuditLogEntry } from './audit_log';
import type { InMemoryPublishEventStore } from './publish_event';
import { eventBus as defaultEventBus } from './event_bus';
import { auditLog as defaultAuditLog } from './audit_log';
import { publishEventStore as defaultPublishEventStore } from './publish_event';
import {
  registerRuntimeEventLogSubscribers,
  resetEventLogSubscriberState,
} from './runtime_event_log_subscriber';
import { runtimeEventLog as defaultRuntimeEventLog } from './runtime_event_log';
import type { InMemoryRuntimeEventLogStore } from './runtime_event_log';

let _auditEntryCounter = 0;

function nextAuditId(): string {
  return `audit_${++_auditEntryCounter}`;
}

/**
 * Resets the audit entry counter — for test isolation only.
 */
export function resetSubscriberState(): void {
  _auditEntryCounter = 0;
  resetEventLogSubscriberState();
}

/**
 * Registers event subscribers that wire:
 *  1. Audit logging — lifecycle events → AuditLogEntry records
 *  2. Publish flow — artifact.created → publish.requested → publish.completed
 *  3. Runtime event log — all lifecycle events → RuntimeEventLogEntry records
 *
 * Call once during runtime initialisation.  For tests, call after eventBus.reset()
 * to re-register subscribers on a clean bus.
 */
export function registerRuntimeSubscribers(
  bus: EventBus<RuntimeEventMap> = defaultEventBus,
  auditLog: InMemoryAuditLog = defaultAuditLog,
  publishStore: InMemoryPublishEventStore = defaultPublishEventStore,
  eventLogStore: InMemoryRuntimeEventLogStore = defaultRuntimeEventLog,
): void {
  // ─── Runtime event log subscribers ───────────────────────────────────────
  registerRuntimeEventLogSubscribers(bus, eventLogStore);

  // ─── Audit logging subscribers ────────────────────────────────────────────

  bus.on('signal.received', (signal) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'signal.received',
      objectType: 'Signal',
      objectId: signal.id,
      actorId: 'runtime',
      timestamp: Date.now(),
      summary: `Signal "${signal.name}" received.`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('plan.created', (plan) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'plan.created',
      objectType: 'Plan',
      objectId: plan.id,
      actorId: 'runtime',
      timestamp: Date.now(),
      summary: `Plan "${plan.id}" created with action "${plan.action}".`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('skill.invocation.started', (invocation) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'skill_invocation.started',
      objectType: 'SkillInvocation',
      objectId: invocation.id,
      actorId: invocation.agentId,
      timestamp: Date.now(),
      summary: `Skill invocation "${invocation.id}" started for skill "${invocation.skillId}".`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('skill.invocation.completed', (invocation) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'skill_invocation.completed',
      objectType: 'SkillInvocation',
      objectId: invocation.id,
      actorId: invocation.agentId,
      timestamp: Date.now(),
      summary: `Skill invocation "${invocation.id}" completed.`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('skill.invocation.failed', (invocation) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'skill_invocation.failed',
      objectType: 'SkillInvocation',
      objectId: invocation.id,
      actorId: invocation.agentId,
      timestamp: Date.now(),
      summary: `Skill invocation "${invocation.id}" failed: ${invocation.error ?? 'unknown error'}.`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('artifact.created', (artifact) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'artifact.created',
      objectType: 'Artifact',
      objectId: artifact.id,
      actorId: 'runtime',
      timestamp: Date.now(),
      summary: `Artifact "${artifact.id}" of type "${artifact.type}" created.`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('publish.requested', (publishEvent) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'publish_event.initiated',
      objectType: 'PublishEvent',
      objectId: publishEvent.id,
      actorId: publishEvent.publishedBy,
      timestamp: Date.now(),
      summary: `Publish requested for artifact "${publishEvent.artifactId}" to "${publishEvent.destination}".`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  bus.on('publish.completed', (publishEvent) => {
    const entry: AuditLogEntry = {
      id: nextAuditId(),
      eventType: 'publish_event.published',
      objectType: 'PublishEvent',
      objectId: publishEvent.id,
      actorId: publishEvent.publishedBy,
      timestamp: Date.now(),
      summary: `Publish completed for artifact "${publishEvent.artifactId}" to "${publishEvent.destination}".`,
    };
    const appended = auditLog.append(entry);
    bus.emit('audit.logged', appended);
  });

  // ─── Publish flow subscriber ───────────────────────────────────────────────

  bus.on('artifact.created', (artifact) => {
    const publishEventId = `publish_${artifact.id}`;
    const publishEvent = publishStore.create({
      id: publishEventId,
      artifactId: artifact.id,
      publishedAt: Date.now(),
      destination: 'default',
      status: 'pending',
      publishedBy: 'runtime',
    });

    bus.emit('publish.requested', publishEvent);

    // For this single-node in-memory runtime, publishing completes immediately.
    publishStore.updateStatus(publishEventId, 'published');
    const completed = publishStore.getById(publishEventId);
    if (completed) {
      bus.emit('publish.completed', completed);
    }
  });
}
