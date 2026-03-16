import type { StorageConfig } from './storage_config';
import type {
  ISignalStore,
  IPlanStore,
  IJobStore,
  IAssignmentStore,
  ISkillInvocationStore,
  IArtifactStore,
  IPublishEventStore,
  IAuditLogStore,
  IWorkspacePolicyStore,
  IRuntimeEventLogStore,
} from './interfaces';

import Database from 'better-sqlite3';
import { InMemorySignalStore } from './memory/InMemorySignalStore';
import { InMemoryPlanStore } from './memory/InMemoryPlanStore';
import { InMemoryArtifactStore } from './memory/InMemoryArtifactStore';
import { InMemoryJobQueue } from '../job_queue';
import { InMemoryAssignmentStore } from '../assignment';
import { InMemorySkillInvocationStore } from '../skill_invocation';
import { InMemoryPublishEventStore } from '../publish_event';
import { InMemoryAuditLog } from '../audit_log';
import { InMemoryWorkspacePolicyStore } from '../workspace_policy';
import { InMemoryRuntimeEventLogStore } from '../runtime_event_log';

import { SqliteJobStore } from './sqlite/SqliteJobStore';
import { SqliteSkillInvocationStore } from './sqlite/SqliteSkillInvocationStore';
import { SqliteArtifactStore } from './sqlite/SqliteArtifactStore';
import { SqliteAuditLogStore } from './sqlite/SqliteAuditLogStore';

export type StoreBundle = {
  signalStore: ISignalStore;
  planStore: IPlanStore;
  jobStore: IJobStore;
  assignmentStore: IAssignmentStore;
  skillInvocationStore: ISkillInvocationStore;
  artifactStore: IArtifactStore;
  publishEventStore: IPublishEventStore;
  auditLogStore: IAuditLogStore;
  workspacePolicyStore: IWorkspacePolicyStore;
  runtimeEventLogStore: IRuntimeEventLogStore;
};

export function createStores(config: StorageConfig): StoreBundle {
  if (config.mode === 'sqlite') {
    if (!config.sqlitePath) {
      throw new Error('sqlitePath is required when storage mode is sqlite');
    }

    // Dynamic require so that the module is only loaded in sqlite mode.
    const db = new Database(config.sqlitePath);

    return {
      signalStore: new InMemorySignalStore(),
      planStore: new InMemoryPlanStore(),
      jobStore: new SqliteJobStore(db),
      assignmentStore: new InMemoryAssignmentStore(),
      skillInvocationStore: new SqliteSkillInvocationStore(db),
      artifactStore: new SqliteArtifactStore(db),
      publishEventStore: new InMemoryPublishEventStore(),
      auditLogStore: new SqliteAuditLogStore(db),
      workspacePolicyStore: new InMemoryWorkspacePolicyStore(),
      runtimeEventLogStore: new InMemoryRuntimeEventLogStore(),
    };
  }

  // Default: in-memory mode
  return {
    signalStore: new InMemorySignalStore(),
    planStore: new InMemoryPlanStore(),
    jobStore: new InMemoryJobQueue(),
    assignmentStore: new InMemoryAssignmentStore(),
    skillInvocationStore: new InMemorySkillInvocationStore(),
    artifactStore: new InMemoryArtifactStore(),
    publishEventStore: new InMemoryPublishEventStore(),
    auditLogStore: new InMemoryAuditLog(),
    workspacePolicyStore: new InMemoryWorkspacePolicyStore(),
    runtimeEventLogStore: new InMemoryRuntimeEventLogStore(),
  };
}
