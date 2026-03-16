import type { AuditLogEntry, AuditEventType } from '../../audit_log';

export interface IAuditLogStore {
  append(entry: AuditLogEntry): AuditLogEntry;
  listAll(): AuditLogEntry[];
  listByObjectId(objectType: string, objectId: string): AuditLogEntry[];
  listByEventType(eventType: AuditEventType): AuditLogEntry[];
  listByActorId(actorId: string): AuditLogEntry[];
  listByWorkspaceId(workspaceId: string): AuditLogEntry[];
  reset(): void;
}
