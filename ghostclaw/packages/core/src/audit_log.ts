import type { IAuditLogStore } from './storage/interfaces/IAuditLogStore';

/**
 * AuditLogEntry — append-only record of every consequential runtime event.
 *
 * Canonical spec: ghostclaw_runtime_persistence_spec.md § 2.8
 *                 ghostclaw_master_control_system.md § 5
 * Runtime chain:  cross-cutting; every stage emits AuditLogEntries.
 *
 * AuditLogEntries are strictly append-only.  No entry may be modified or deleted
 * after creation.  In durable mode this invariant MUST be enforced at the database
 * layer (no UPDATE/DELETE privileges on the audit table).
 *
 * TODO(schema-alignment): Automatic emission deferred.
 *   The AuditLogEntry type and store are defined here, but the runtime pipeline
 *   does not yet emit entries automatically at every state transition.  Full wiring
 *   requires the MCS governance layer and is out of scope for this alignment pass.
 *   Each deferred emission point is documented in the Event Type Catalog below.
 */

/**
 * Canonical event type identifiers.
 * Every type in this union MUST be logged as an AuditLogEntry per the persistence spec.
 */
export type AuditEventType =
  | 'signal.received'
  | 'plan.created'
  | 'job.created'
  | 'job.assigned'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.retried'
  | 'skill_invocation.started'
  | 'skill_invocation.completed'
  | 'skill_invocation.failed'
  | 'artifact.created'
  | 'artifact.validated'
  | 'publish_event.initiated'
  | 'publish_event.approved'
  | 'publish_event.rejected'
  | 'publish_event.published'
  | 'publish_event.failed'
  | 'policy.evaluated'
  | 'policy.violated'
  | 'operator.override'
  | 'system.emergency_stop'
  | 'package.installed'
  | 'package.enabled'
  | 'package.disabled'
  | 'package.uninstalled'
  | 'package.updated'
  | 'remote_execution.requested'
  | 'remote_execution.started'
  | 'remote_execution.completed'
  | 'remote_execution.failed'
  | 'remote_execution.rejected';

export type AuditLogEntry = {
  /** Globally unique identifier. MUST be immutable after creation. */
  id: string;
  /** Canonical event type identifier. See AuditEventType. */
  eventType: AuditEventType;
  /** The type of runtime object involved (e.g. 'Signal', 'Job', 'Artifact'). */
  objectType: string;
  /** The `id` of the runtime object involved. */
  objectId: string;
  /** Identity of the agent, operator, or system component that caused the event. */
  actorId: string;
  /** Unix timestamp (milliseconds). MUST be immutable after creation. */
  timestamp: number;
  /** Human-readable description of the event. */
  summary: string;

  // --- Optional fields ---

  /** Workspace context. SHOULD be populated for all workspace-scoped events. */
  workspaceId?: string;
  /** Serialised previous state of the object (JSON string). */
  previousState?: string;
  /** Serialised new state of the object (JSON string). */
  newState?: string;
  /** Additional structured context for the event. */
  metadata?: Record<string, unknown>;
};

/**
 * Append-only in-memory audit log.
 *
 * Entries may only be appended; no mutation or deletion methods are exposed.
 * This mirrors the strict append-only semantics required in durable mode.
 */
export class InMemoryAuditLog implements IAuditLogStore {
  private readonly entries: AuditLogEntry[] = [];

  append(entry: AuditLogEntry): AuditLogEntry {
    this.entries.push(entry);
    return entry;
  }

  listAll(): AuditLogEntry[] {
    return [...this.entries];
  }

  listByObjectId(objectType: string, objectId: string): AuditLogEntry[] {
    return this.entries.filter(
      (e) => e.objectType === objectType && e.objectId === objectId,
    );
  }

  listByEventType(eventType: AuditEventType): AuditLogEntry[] {
    return this.entries.filter((e) => e.eventType === eventType);
  }

  listByActorId(actorId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.actorId === actorId);
  }

  listByWorkspaceId(workspaceId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.workspaceId === workspaceId);
  }

  /**
   * Reset is intentionally provided only for test isolation.
   * In production/durable mode this method MUST NOT be called.
   */
  reset(): void {
    this.entries.length = 0;
  }
}

export const auditLog = new InMemoryAuditLog();
