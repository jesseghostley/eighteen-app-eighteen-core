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

  it('returns SQLite store instances for the 4 priority stores', () => {
    const stores = createStores({ mode: 'sqlite', sqlitePath: dbPath });

    expect(stores.jobStore).toBeInstanceOf(SqliteJobStore);
    expect(stores.skillInvocationStore).toBeInstanceOf(SqliteSkillInvocationStore);
    expect(stores.artifactStore).toBeInstanceOf(SqliteArtifactStore);
    expect(stores.auditLogStore).toBeInstanceOf(SqliteAuditLogStore);
  });

  it('returns in-memory stores for the remaining 5 domains', () => {
    const stores = createStores({ mode: 'sqlite', sqlitePath: dbPath });

    expect(stores.signalStore).toBeInstanceOf(InMemorySignalStore);
    expect(stores.planStore).toBeInstanceOf(InMemoryPlanStore);
    expect(stores.assignmentStore).toBeInstanceOf(InMemoryAssignmentStore);
    expect(stores.publishEventStore).toBeInstanceOf(InMemoryPublishEventStore);
    expect(stores.workspacePolicyStore).toBeInstanceOf(InMemoryWorkspacePolicyStore);
  });

  it('throws when sqlitePath is missing in sqlite mode', () => {
    expect(() => createStores({ mode: 'sqlite' })).toThrow('sqlitePath is required');
  });
});
