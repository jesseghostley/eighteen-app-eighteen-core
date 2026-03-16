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
import type { QueueJob } from '../../packages/core/src/job_queue';
import type { SkillInvocation } from '../../packages/core/src/skill_invocation';
import type { Artifact } from '../../packages/core/src/runtime_loop';
import type { AuditLogEntry } from '../../packages/core/src/audit_log';

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
