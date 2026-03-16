import type { RuntimeEventLogEntry } from '../../runtime_event_log';

export interface IRuntimeEventLogStore {
  append(entry: RuntimeEventLogEntry): RuntimeEventLogEntry;
  getById(eventId: string): RuntimeEventLogEntry | undefined;
  /** Returns the most recent `limit` entries, ordered newest-first. */
  listRecent(limit: number): RuntimeEventLogEntry[];
  listByWorkspace(workspaceId: string): RuntimeEventLogEntry[];
  listByJob(jobId: string): RuntimeEventLogEntry[];
  listBySkillInvocation(skillInvocationId: string): RuntimeEventLogEntry[];
  listByCorrelationId(correlationId: string): RuntimeEventLogEntry[];
  reset(): void;
}
