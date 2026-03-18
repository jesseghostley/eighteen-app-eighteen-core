/**
 * Behavioral tests for the SQLite store implementations.
 * Each test group verifies the same behavioral contract as the in-memory stores.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';

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
import type { QueueJob } from '../../packages/core/src/job_queue';
import type { SkillInvocation } from '../../packages/core/src/skill_invocation';
import type { Artifact, Signal, Plan } from '../../packages/core/src/runtime_loop';
import type { AuditLogEntry } from '../../packages/core/src/audit_log';
import type { Assignment } from '../../packages/core/src/assignment';
import type { PublishEvent } from '../../packages/core/src/publish_event';
import type { WorkspacePolicy } from '../../packages/core/src/workspace_policy';
import type { RuntimeEventLogEntry } from '../../packages/core/src/runtime_event_log';

function makeDb(): Database.Database {
  return new Database(path.join(os.tmpdir(), `ghostclaw-sqlite-test-${Date.now()}-${Math.random()}.db`));
}

function makeJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: 'job_1',
    planId: 'plan_1',
    jobType: 'draft_cluster_outline',
    assignedAgent: null,
    status: 'queued',
    inputPayload: { topic: 'test' },
    outputPayload: null,
    retryCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeInvocation(overrides: Partial<SkillInvocation> = {}): SkillInvocation {
  return {
    id: 'inv_1',
    workspaceId: 'ws_1',
    planId: 'plan_1',
    jobId: 'job_1',
    assignmentId: 'assign_1',
    agentId: 'AgentX',
    skillId: 'draft_cluster_outline',
    status: 'pending',
    inputPayload: { topic: 'test' },
    outputPayload: null,
    artifactIds: [],
    error: null,
    retryCount: 0,
    fallbackUsed: false,
    startedAt: 1000,
    completedAt: null,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact_1',
    jobId: 'job_1',
    skillInvocationId: 'inv_1',
    type: 'draft_cluster_outline',
    content: 'some content',
    createdAt: 1000,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'entry_1',
    eventType: 'job.created',
    objectType: 'Job',
    objectId: 'job_1',
    actorId: 'system',
    timestamp: 1000,
    summary: 'Job created',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SqliteJobStore
// ---------------------------------------------------------------------------
describe('SqliteJobStore', () => {
  let store: SqliteJobStore;

  beforeEach(() => {
    store = new SqliteJobStore(makeDb());
  });

  it('enqueues and lists jobs', () => {
    const job = makeJob();
    store.enqueue(job);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe('job_1');
  });

  it('returns existing job on duplicate enqueue', () => {
    const job = makeJob();
    store.enqueue(job);
    const result = store.enqueue({ ...job, jobType: 'other' });
    expect(result.jobType).toBe('draft_cluster_outline');
    expect(store.list()).toHaveLength(1);
  });

  it('dequeues the next queued job and marks it assigned', () => {
    store.enqueue(makeJob());
    const dequeued = store.dequeue();
    expect(dequeued).toBeDefined();
    expect(dequeued!.status).toBe('assigned');
  });

  it('returns undefined when the queue is empty', () => {
    expect(store.dequeue()).toBeUndefined();
  });

  it('markRunning sets status to running', () => {
    const job = makeJob();
    store.enqueue(job);
    store.dequeue(); // assigned
    store.markRunning('job_1');
    expect(store.list()[0].status).toBe('running');
  });

  it('markComplete sets status to completed', () => {
    store.enqueue(makeJob());
    store.dequeue();
    store.markRunning('job_1');
    store.markComplete('job_1');
    expect(store.list()[0].status).toBe('completed');
  });

  it('markFailed retries up to MAX_RETRIES (2)', () => {
    store.enqueue(makeJob());
    store.dequeue();
    store.markFailed('job_1'); // retry 1 → queued
    expect(store.list()[0].status).toBe('queued');
    expect(store.list()[0].retryCount).toBe(1);

    store.dequeue();
    store.markFailed('job_1'); // retry 2 → queued
    expect(store.list()[0].status).toBe('queued');

    store.dequeue();
    store.markFailed('job_1'); // retry 3 → failed
    expect(store.list()[0].status).toBe('failed');
  });

  it('reset clears all jobs', () => {
    store.enqueue(makeJob());
    store.reset();
    expect(store.list()).toHaveLength(0);
  });

  it('serialises and deserialises inputPayload', () => {
    store.enqueue(makeJob({ inputPayload: { nested: { value: 42 } } }));
    const stored = store.list()[0];
    expect(stored.inputPayload).toEqual({ nested: { value: 42 } });
  });
});

// ---------------------------------------------------------------------------
// SqliteSkillInvocationStore
// ---------------------------------------------------------------------------
describe('SqliteSkillInvocationStore', () => {
  let store: SqliteSkillInvocationStore;

  beforeEach(() => {
    store = new SqliteSkillInvocationStore(makeDb());
  });

  it('creates and retrieves an invocation', () => {
    const inv = makeInvocation();
    store.create(inv);
    expect(store.getById('inv_1')).toBeDefined();
    expect(store.getById('inv_1')!.skillId).toBe('draft_cluster_outline');
  });

  it('listAll returns all invocations', () => {
    store.create(makeInvocation());
    store.create(makeInvocation({ id: 'inv_2', jobId: 'job_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByJobId filters correctly', () => {
    store.create(makeInvocation({ id: 'inv_1', jobId: 'job_1' }));
    store.create(makeInvocation({ id: 'inv_2', jobId: 'job_2' }));
    expect(store.listByJobId('job_1')).toHaveLength(1);
    expect(store.listByJobId('job_2')).toHaveLength(1);
    expect(store.listByJobId('job_99')).toHaveLength(0);
  });

  it('updateStatus updates status and optional fields', () => {
    store.create(makeInvocation());
    const updated = store.updateStatus('inv_1', 'completed', {
      outputPayload: { result: 'done' },
      artifactIds: ['art_1'],
      completedAt: 2000,
    });
    expect(updated!.status).toBe('completed');
    expect(updated!.outputPayload).toEqual({ result: 'done' });
    expect(updated!.artifactIds).toEqual(['art_1']);
    expect(updated!.completedAt).toBe(2000);
  });

  it('updateStatus returns undefined for unknown id', () => {
    expect(store.updateStatus('nope', 'completed')).toBeUndefined();
  });

  it('reset clears all invocations', () => {
    store.create(makeInvocation());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteArtifactStore
// ---------------------------------------------------------------------------
describe('SqliteArtifactStore', () => {
  let store: SqliteArtifactStore;

  beforeEach(() => {
    store = new SqliteArtifactStore(makeDb());
  });

  it('creates and retrieves an artifact', () => {
    store.create(makeArtifact());
    expect(store.getById('artifact_1')).toBeDefined();
    expect(store.getById('artifact_1')!.type).toBe('draft_cluster_outline');
  });

  it('listAll returns all artifacts', () => {
    store.create(makeArtifact());
    store.create(makeArtifact({ id: 'artifact_2', jobId: 'job_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByJobId filters correctly', () => {
    store.create(makeArtifact({ id: 'artifact_1', jobId: 'job_1' }));
    store.create(makeArtifact({ id: 'artifact_2', jobId: 'job_2' }));
    expect(store.listByJobId('job_1')).toHaveLength(1);
    expect(store.listByJobId('job_99')).toHaveLength(0);
  });

  it('preserves optional fields', () => {
    store.create(makeArtifact({ workspaceId: 'ws_1', mimeType: 'text/plain', validationStatus: 'pass' }));
    const stored = store.getById('artifact_1')!;
    expect(stored.workspaceId).toBe('ws_1');
    expect(stored.mimeType).toBe('text/plain');
    expect(stored.validationStatus).toBe('pass');
  });

  it('reset clears all artifacts', () => {
    store.create(makeArtifact());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteAuditLogStore
// ---------------------------------------------------------------------------
describe('SqliteAuditLogStore', () => {
  let store: SqliteAuditLogStore;

  beforeEach(() => {
    store = new SqliteAuditLogStore(makeDb());
  });

  it('appends and lists entries', () => {
    store.append(makeAuditEntry());
    expect(store.listAll()).toHaveLength(1);
    expect(store.listAll()[0].eventType).toBe('job.created');
  });

  it('listByObjectId filters by objectType and objectId', () => {
    store.append(makeAuditEntry({ id: 'e1', objectType: 'Job', objectId: 'job_1' }));
    store.append(makeAuditEntry({ id: 'e2', objectType: 'Artifact', objectId: 'art_1' }));
    expect(store.listByObjectId('Job', 'job_1')).toHaveLength(1);
    expect(store.listByObjectId('Artifact', 'art_1')).toHaveLength(1);
    expect(store.listByObjectId('Job', 'art_1')).toHaveLength(0);
  });

  it('listByEventType filters correctly', () => {
    store.append(makeAuditEntry({ id: 'e1', eventType: 'job.created' }));
    store.append(makeAuditEntry({ id: 'e2', eventType: 'artifact.created' }));
    expect(store.listByEventType('job.created')).toHaveLength(1);
    expect(store.listByEventType('artifact.created')).toHaveLength(1);
  });

  it('listByActorId filters correctly', () => {
    store.append(makeAuditEntry({ id: 'e1', actorId: 'agent_1' }));
    store.append(makeAuditEntry({ id: 'e2', actorId: 'agent_2' }));
    expect(store.listByActorId('agent_1')).toHaveLength(1);
  });

  it('listByWorkspaceId filters correctly', () => {
    store.append(makeAuditEntry({ id: 'e1', workspaceId: 'ws_1' }));
    store.append(makeAuditEntry({ id: 'e2', workspaceId: 'ws_2' }));
    expect(store.listByWorkspaceId('ws_1')).toHaveLength(1);
    expect(store.listByWorkspaceId('ws_99')).toHaveLength(0);
  });

  it('serialises and deserialises metadata', () => {
    store.append(makeAuditEntry({ metadata: { key: 'value', nested: { n: 1 } } }));
    const stored = store.listAll()[0];
    expect(stored.metadata).toEqual({ key: 'value', nested: { n: 1 } });
  });

  it('reset clears all entries', () => {
    store.append(makeAuditEntry());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Factories for new stores
// ---------------------------------------------------------------------------
function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'signal_1',
    name: 'test_signal',
    createdAt: 1000,
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_1',
    signalId: 'signal_1',
    action: 'generate_content_cluster',
    strategyId: 'strat_1',
    strategyType: 'rule',
    createdAt: 1000,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assign_1',
    jobId: 'job_1',
    agentName: 'AgentX',
    reason: 'best fit',
    createdAt: 1000,
    ...overrides,
  };
}

function makePublishEvent(overrides: Partial<PublishEvent> = {}): PublishEvent {
  return {
    id: 'pub_1',
    artifactId: 'artifact_1',
    publishedAt: 1000,
    destination: 'ghost_mart',
    status: 'pending',
    publishedBy: 'system',
    ...overrides,
  };
}

function makeWorkspacePolicy(overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    id: 'policy_1',
    workspaceId: 'ws_1',
    policyType: 'execution',
    name: 'Test Policy',
    description: 'A test policy',
    rules: { maxRetries: 3 },
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeRuntimeEventLogEntry(overrides: Partial<RuntimeEventLogEntry> = {}): RuntimeEventLogEntry {
  return {
    event_id: 'evt_1',
    event_type: 'signal.received',
    occurred_at: 1000,
    payload: { name: 'test' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SqliteSignalStore
// ---------------------------------------------------------------------------
describe('SqliteSignalStore', () => {
  let store: SqliteSignalStore;

  beforeEach(() => {
    store = new SqliteSignalStore(makeDb());
  });

  it('creates and retrieves a signal', () => {
    store.create(makeSignal());
    expect(store.getById('signal_1')).toBeDefined();
    expect(store.getById('signal_1')!.name).toBe('test_signal');
  });

  it('listAll returns all signals', () => {
    store.create(makeSignal());
    store.create(makeSignal({ id: 'signal_2', name: 'other' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('serialises and deserialises payload', () => {
    store.create(makeSignal({ payload: { nested: { value: 42 } } }));
    const stored = store.getById('signal_1')!;
    expect(stored.payload).toEqual({ nested: { value: 42 } });
  });

  it('handles undefined payload', () => {
    store.create(makeSignal());
    const stored = store.getById('signal_1')!;
    expect(stored.payload).toBeUndefined();
  });

  it('reset clears all signals', () => {
    store.create(makeSignal());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqlitePlanStore
// ---------------------------------------------------------------------------
describe('SqlitePlanStore', () => {
  let store: SqlitePlanStore;

  beforeEach(() => {
    store = new SqlitePlanStore(makeDb());
  });

  it('creates and retrieves a plan', () => {
    store.create(makePlan());
    expect(store.getById('plan_1')).toBeDefined();
    expect(store.getById('plan_1')!.action).toBe('generate_content_cluster');
  });

  it('listAll returns all plans', () => {
    store.create(makePlan());
    store.create(makePlan({ id: 'plan_2', signalId: 'signal_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listBySignalId filters correctly', () => {
    store.create(makePlan({ id: 'plan_1', signalId: 'signal_1' }));
    store.create(makePlan({ id: 'plan_2', signalId: 'signal_2' }));
    expect(store.listBySignalId('signal_1')).toHaveLength(1);
    expect(store.listBySignalId('signal_99')).toHaveLength(0);
  });

  it('preserves optional fields', () => {
    store.create(makePlan({ priority: 5, requiredAgents: ['AgentA'], expectedOutputs: ['draft'] }));
    const stored = store.getById('plan_1')!;
    expect(stored.priority).toBe(5);
    expect(stored.requiredAgents).toEqual(['AgentA']);
    expect(stored.expectedOutputs).toEqual(['draft']);
  });

  it('reset clears all plans', () => {
    store.create(makePlan());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteAssignmentStore
// ---------------------------------------------------------------------------
describe('SqliteAssignmentStore', () => {
  let store: SqliteAssignmentStore;

  beforeEach(() => {
    store = new SqliteAssignmentStore(makeDb());
  });

  it('creates and retrieves an assignment', () => {
    store.create(makeAssignment());
    expect(store.getById('assign_1')).toBeDefined();
    expect(store.getById('assign_1')!.agentName).toBe('AgentX');
  });

  it('listAll returns all assignments', () => {
    store.create(makeAssignment());
    store.create(makeAssignment({ id: 'assign_2', jobId: 'job_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByJobId filters correctly', () => {
    store.create(makeAssignment({ id: 'assign_1', jobId: 'job_1' }));
    store.create(makeAssignment({ id: 'assign_2', jobId: 'job_2' }));
    expect(store.listByJobId('job_1')).toHaveLength(1);
    expect(store.listByJobId('job_99')).toHaveLength(0);
  });

  it('listByAgentName filters correctly', () => {
    store.create(makeAssignment({ id: 'assign_1', agentName: 'AgentX' }));
    store.create(makeAssignment({ id: 'assign_2', agentName: 'AgentY' }));
    expect(store.listByAgentName('AgentX')).toHaveLength(1);
    expect(store.listByAgentName('AgentZ')).toHaveLength(0);
  });

  it('revoke sets revokedAt and revokedReason', () => {
    store.create(makeAssignment());
    const revoked = store.revoke('assign_1', 2000, 'agent unavailable');
    expect(revoked).toBeDefined();
    expect(revoked!.revokedAt).toBe(2000);
    expect(revoked!.revokedReason).toBe('agent unavailable');
  });

  it('revoke returns undefined for unknown id', () => {
    expect(store.revoke('nope', 2000, 'reason')).toBeUndefined();
  });

  it('reset clears all assignments', () => {
    store.create(makeAssignment());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqlitePublishEventStore
// ---------------------------------------------------------------------------
describe('SqlitePublishEventStore', () => {
  let store: SqlitePublishEventStore;

  beforeEach(() => {
    store = new SqlitePublishEventStore(makeDb());
  });

  it('creates and retrieves a publish event', () => {
    store.create(makePublishEvent());
    expect(store.getById('pub_1')).toBeDefined();
    expect(store.getById('pub_1')!.destination).toBe('ghost_mart');
  });

  it('listAll returns all events', () => {
    store.create(makePublishEvent());
    store.create(makePublishEvent({ id: 'pub_2', artifactId: 'artifact_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByArtifactId filters correctly', () => {
    store.create(makePublishEvent({ id: 'pub_1', artifactId: 'artifact_1' }));
    store.create(makePublishEvent({ id: 'pub_2', artifactId: 'artifact_2' }));
    expect(store.listByArtifactId('artifact_1')).toHaveLength(1);
    expect(store.listByArtifactId('artifact_99')).toHaveLength(0);
  });

  it('listByStatus filters correctly', () => {
    store.create(makePublishEvent({ id: 'pub_1', status: 'pending' }));
    store.create(makePublishEvent({ id: 'pub_2', status: 'published' }));
    expect(store.listByStatus('pending')).toHaveLength(1);
    expect(store.listByStatus('published')).toHaveLength(1);
    expect(store.listByStatus('failed')).toHaveLength(0);
  });

  it('updateStatus updates status and optional fields', () => {
    store.create(makePublishEvent());
    const updated = store.updateStatus('pub_1', 'approved', {
      approvedBy: 'admin',
      approvedAt: 2000,
      externalUrl: 'https://example.com/page',
    });
    expect(updated!.status).toBe('approved');
    expect(updated!.approvedBy).toBe('admin');
    expect(updated!.approvedAt).toBe(2000);
    expect(updated!.externalUrl).toBe('https://example.com/page');
  });

  it('updateStatus returns undefined for unknown id', () => {
    expect(store.updateStatus('nope', 'published')).toBeUndefined();
  });

  it('reset clears all events', () => {
    store.create(makePublishEvent());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteWorkspacePolicyStore
// ---------------------------------------------------------------------------
describe('SqliteWorkspacePolicyStore', () => {
  let store: SqliteWorkspacePolicyStore;

  beforeEach(() => {
    store = new SqliteWorkspacePolicyStore(makeDb());
  });

  it('creates and retrieves a policy', () => {
    store.create(makeWorkspacePolicy());
    expect(store.getById('policy_1')).toBeDefined();
    expect(store.getById('policy_1')!.name).toBe('Test Policy');
  });

  it('listAll returns all policies', () => {
    store.create(makeWorkspacePolicy());
    store.create(makeWorkspacePolicy({ id: 'policy_2', workspaceId: 'ws_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByWorkspaceId filters correctly', () => {
    store.create(makeWorkspacePolicy({ id: 'policy_1', workspaceId: 'ws_1' }));
    store.create(makeWorkspacePolicy({ id: 'policy_2', workspaceId: 'ws_2' }));
    expect(store.listByWorkspaceId('ws_1')).toHaveLength(1);
    expect(store.listByWorkspaceId('ws_99')).toHaveLength(0);
  });

  it('listActive filters by status and optional policyType', () => {
    store.create(makeWorkspacePolicy({ id: 'policy_1', status: 'active', policyType: 'execution' }));
    store.create(makeWorkspacePolicy({ id: 'policy_2', status: 'inactive', policyType: 'publish' }));
    store.create(makeWorkspacePolicy({ id: 'policy_3', status: 'active', policyType: 'publish' }));
    expect(store.listActive('ws_1')).toHaveLength(2);
    expect(store.listActive('ws_1', 'execution')).toHaveLength(1);
    expect(store.listActive('ws_1', 'publish')).toHaveLength(1);
  });

  it('update modifies mutable fields', () => {
    store.create(makeWorkspacePolicy());
    const updated = store.update('policy_1', { name: 'Updated', updatedAt: 2000, enforcementMode: 'warn' });
    expect(updated!.name).toBe('Updated');
    expect(updated!.updatedAt).toBe(2000);
    expect(updated!.enforcementMode).toBe('warn');
  });

  it('update returns undefined for unknown id', () => {
    expect(store.update('nope', { updatedAt: 2000 })).toBeUndefined();
  });

  it('deactivate sets status to inactive', () => {
    store.create(makeWorkspacePolicy());
    const deactivated = store.deactivate('policy_1', 2000, 'admin');
    expect(deactivated!.status).toBe('inactive');
    expect(deactivated!.updatedBy).toBe('admin');
  });

  it('serialises and deserialises rules', () => {
    store.create(makeWorkspacePolicy({ rules: { nested: { key: [1, 2, 3] } } }));
    const stored = store.getById('policy_1')!;
    expect(stored.rules).toEqual({ nested: { key: [1, 2, 3] } });
  });

  it('reset clears all policies', () => {
    store.create(makeWorkspacePolicy());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteRuntimeEventLogStore
// ---------------------------------------------------------------------------
describe('SqliteRuntimeEventLogStore', () => {
  let store: SqliteRuntimeEventLogStore;

  beforeEach(() => {
    store = new SqliteRuntimeEventLogStore(makeDb());
  });

  it('appends and retrieves an entry', () => {
    store.append(makeRuntimeEventLogEntry());
    expect(store.getById('evt_1')).toBeDefined();
    expect(store.getById('evt_1')!.event_type).toBe('signal.received');
  });

  it('listRecent returns newest-first with limit', () => {
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_1', occurred_at: 1000 }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_2', occurred_at: 2000 }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_3', occurred_at: 3000 }));
    const recent = store.listRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].event_id).toBe('evt_3');
    expect(recent[1].event_id).toBe('evt_2');
  });

  it('listByWorkspace filters correctly', () => {
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_1', workspace_id: 'ws_1' }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_2', workspace_id: 'ws_2' }));
    expect(store.listByWorkspace('ws_1')).toHaveLength(1);
    expect(store.listByWorkspace('ws_99')).toHaveLength(0);
  });

  it('listByJob filters correctly', () => {
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_1', job_id: 'job_1' }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_2', job_id: 'job_2' }));
    expect(store.listByJob('job_1')).toHaveLength(1);
  });

  it('listBySkillInvocation filters correctly', () => {
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_1', skill_invocation_id: 'inv_1' }));
    expect(store.listBySkillInvocation('inv_1')).toHaveLength(1);
    expect(store.listBySkillInvocation('inv_99')).toHaveLength(0);
  });

  it('listByCorrelationId filters correctly', () => {
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_1', correlation_id: 'corr_1' }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_2', correlation_id: 'corr_1' }));
    store.append(makeRuntimeEventLogEntry({ event_id: 'evt_3', correlation_id: 'corr_2' }));
    expect(store.listByCorrelationId('corr_1')).toHaveLength(2);
  });

  it('serialises and deserialises payload', () => {
    store.append(makeRuntimeEventLogEntry({ payload: { deep: { nested: true } } }));
    const stored = store.getById('evt_1')!;
    expect(stored.payload).toEqual({ deep: { nested: true } });
  });

  it('reset clears all entries', () => {
    store.append(makeRuntimeEventLogEntry());
    store.reset();
    expect(store.listRecent(100)).toHaveLength(0);
  });
});
