/**
 * Verify that in-memory store classes satisfy their interface contracts.
 * These tests mirror the behavioral assertions in sqlite_stores.test.ts,
 * confirming both backends behave identically.
 */
import { InMemorySignalStore } from '../../packages/core/src/storage/memory/InMemorySignalStore';
import { InMemoryPlanStore } from '../../packages/core/src/storage/memory/InMemoryPlanStore';
import { InMemoryArtifactStore } from '../../packages/core/src/storage/memory/InMemoryArtifactStore';
import type { Signal, Plan, Artifact } from '../../packages/core/src/runtime_loop';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return { id: 'signal_1', name: 'keyword_opportunity_detected', createdAt: 1000, ...overrides };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_1',
    signalId: 'signal_1',
    action: 'generate_content_cluster',
    strategyId: 'seo_content_cluster',
    strategyType: 'rule',
    createdAt: 1000,
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

// ---------------------------------------------------------------------------
// InMemorySignalStore
// ---------------------------------------------------------------------------
describe('InMemorySignalStore', () => {
  let store: InMemorySignalStore;

  beforeEach(() => {
    store = new InMemorySignalStore();
  });

  it('creates and retrieves a signal', () => {
    store.create(makeSignal());
    expect(store.getById('signal_1')).toBeDefined();
    expect(store.getById('signal_1')!.name).toBe('keyword_opportunity_detected');
  });

  it('listAll returns all signals', () => {
    store.create(makeSignal({ id: 'signal_1' }));
    store.create(makeSignal({ id: 'signal_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('returns undefined for unknown id', () => {
    expect(store.getById('nope')).toBeUndefined();
  });

  it('reset clears all signals', () => {
    store.create(makeSignal());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// InMemoryPlanStore
// ---------------------------------------------------------------------------
describe('InMemoryPlanStore', () => {
  let store: InMemoryPlanStore;

  beforeEach(() => {
    store = new InMemoryPlanStore();
  });

  it('creates and retrieves a plan', () => {
    store.create(makePlan());
    expect(store.getById('plan_1')).toBeDefined();
    expect(store.getById('plan_1')!.action).toBe('generate_content_cluster');
  });

  it('listAll returns all plans', () => {
    store.create(makePlan({ id: 'plan_1' }));
    store.create(makePlan({ id: 'plan_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listBySignalId filters correctly', () => {
    store.create(makePlan({ id: 'plan_1', signalId: 'signal_1' }));
    store.create(makePlan({ id: 'plan_2', signalId: 'signal_2' }));
    expect(store.listBySignalId('signal_1')).toHaveLength(1);
    expect(store.listBySignalId('signal_99')).toHaveLength(0);
  });

  it('reset clears all plans', () => {
    store.create(makePlan());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// InMemoryArtifactStore
// ---------------------------------------------------------------------------
describe('InMemoryArtifactStore', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  it('creates and retrieves an artifact', () => {
    store.create(makeArtifact());
    expect(store.getById('artifact_1')).toBeDefined();
    expect(store.getById('artifact_1')!.type).toBe('draft_cluster_outline');
  });

  it('listAll returns all artifacts', () => {
    store.create(makeArtifact({ id: 'artifact_1' }));
    store.create(makeArtifact({ id: 'artifact_2', jobId: 'job_2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('listByJobId filters correctly', () => {
    store.create(makeArtifact({ id: 'artifact_1', jobId: 'job_1' }));
    store.create(makeArtifact({ id: 'artifact_2', jobId: 'job_2' }));
    expect(store.listByJobId('job_1')).toHaveLength(1);
    expect(store.listByJobId('job_99')).toHaveLength(0);
  });

  it('reset clears all artifacts', () => {
    store.create(makeArtifact());
    store.reset();
    expect(store.listAll()).toHaveLength(0);
  });
});
