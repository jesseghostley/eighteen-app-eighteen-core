import { createStores } from '../../packages/core/src/storage/storage_factory';
import { InMemoryJobQueue } from '../../packages/core/src/job_queue';
import { InMemorySkillInvocationStore } from '../../packages/core/src/skill_invocation';
import { InMemoryArtifactStore } from '../../packages/core/src/storage/memory/InMemoryArtifactStore';
import { InMemoryAuditLog } from '../../packages/core/src/audit_log';
import { InMemorySignalStore } from '../../packages/core/src/storage/memory/InMemorySignalStore';
import { InMemoryPlanStore } from '../../packages/core/src/storage/memory/InMemoryPlanStore';
import { InMemoryAssignmentStore } from '../../packages/core/src/assignment';
import { InMemoryPublishEventStore } from '../../packages/core/src/publish_event';
import { InMemoryWorkspacePolicyStore } from '../../packages/core/src/workspace_policy';
import { SqliteJobStore } from '../../packages/core/src/storage/sqlite/SqliteJobStore';
import { SqliteSkillInvocationStore } from '../../packages/core/src/storage/sqlite/SqliteSkillInvocationStore';
import { SqliteArtifactStore } from '../../packages/core/src/storage/sqlite/SqliteArtifactStore';
import { SqliteAuditLogStore } from '../../packages/core/src/storage/sqlite/SqliteAuditLogStore';
import { SqliteSignalStore } from '../../packages/core/src/storage/sqlite/SqliteSignalStore';
import { SqlitePlanStore } from '../../packages/core/src/storage/sqlite/SqlitePlanStore';
import { SqliteAssignmentStore } from '../../packages/core/src/storage/sqlite/SqliteAssignmentStore';
import { SqlitePublishEventStore } from '../../packages/core/src/storage/sqlite/SqlitePublishEventStore';
import { SqliteWorkspacePolicyStore } from '../../packages/core/src/storage/sqlite/SqliteWorkspacePolicyStore';
import { SqliteRuntimeEventLogStore } from '../../packages/core/src/storage/sqlite/SqliteRuntimeEventLogStore';
import * as os from 'os';
import * as path from 'path';

describe('createStores — memory mode', () => {
  it('returns in-memory store instances for all 9 domains', () => {
    const stores = createStores({ mode: 'memory' });

    expect(stores.signalStore).toBeInstanceOf(InMemorySignalStore);
    expect(stores.planStore).toBeInstanceOf(InMemoryPlanStore);
    expect(stores.jobStore).toBeInstanceOf(InMemoryJobQueue);
    expect(stores.assignmentStore).toBeInstanceOf(InMemoryAssignmentStore);
    expect(stores.skillInvocationStore).toBeInstanceOf(InMemorySkillInvocationStore);
    expect(stores.artifactStore).toBeInstanceOf(InMemoryArtifactStore);
    expect(stores.publishEventStore).toBeInstanceOf(InMemoryPublishEventStore);
    expect(stores.auditLogStore).toBeInstanceOf(InMemoryAuditLog);
    expect(stores.workspacePolicyStore).toBeInstanceOf(InMemoryWorkspacePolicyStore);
  });
});

describe('createStores — sqlite mode', () => {
  const dbPath = path.join(os.tmpdir(), `ghostclaw-test-${Date.now()}.sqlite`);

  it('returns SQLite store instances for all 10 domains', () => {
    const stores = createStores({ mode: 'sqlite', sqlitePath: dbPath });

    expect(stores.signalStore).toBeInstanceOf(SqliteSignalStore);
    expect(stores.planStore).toBeInstanceOf(SqlitePlanStore);
    expect(stores.jobStore).toBeInstanceOf(SqliteJobStore);
    expect(stores.assignmentStore).toBeInstanceOf(SqliteAssignmentStore);
    expect(stores.skillInvocationStore).toBeInstanceOf(SqliteSkillInvocationStore);
    expect(stores.artifactStore).toBeInstanceOf(SqliteArtifactStore);
    expect(stores.publishEventStore).toBeInstanceOf(SqlitePublishEventStore);
    expect(stores.auditLogStore).toBeInstanceOf(SqliteAuditLogStore);
    expect(stores.workspacePolicyStore).toBeInstanceOf(SqliteWorkspacePolicyStore);
    expect(stores.runtimeEventLogStore).toBeInstanceOf(SqliteRuntimeEventLogStore);
  });

  it('throws when sqlitePath is missing in sqlite mode', () => {
    expect(() => createStores({ mode: 'sqlite' })).toThrow('sqlitePath is required');
  });
});
