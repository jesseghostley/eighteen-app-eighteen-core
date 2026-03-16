import {
  InMemorySkillInvocationStore,
  skillInvocationStore,
  type SkillInvocation,
} from '../packages/core/src/skill_invocation';

function makeInvocation(overrides: Partial<SkillInvocation> = {}): SkillInvocation {
  return {
    id: 'inv_test_1',
    workspaceId: 'default',
    planId: 'plan_1',
    jobId: 'job_1',
    assignmentId: 'assign_job_1',
    agentId: 'TestAgent',
    skillId: 'draft_cluster_outline',
    status: 'pending',
    inputPayload: { signalName: 'test' },
    outputPayload: null,
    artifactIds: [],
    error: null,
    retryCount: 0,
    fallbackUsed: false,
    startedAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  skillInvocationStore.reset();
});

describe('InMemorySkillInvocationStore', () => {
  describe('create', () => {
    it('stores and returns a new invocation', () => {
      const inv = makeInvocation();
      const stored = skillInvocationStore.create(inv);
      expect(stored).toEqual(inv);
    });
  });

  describe('getById', () => {
    it('retrieves an invocation by id', () => {
      const inv = makeInvocation();
      skillInvocationStore.create(inv);
      expect(skillInvocationStore.getById('inv_test_1')).toEqual(inv);
    });

    it('returns undefined for unknown id', () => {
      expect(skillInvocationStore.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('returns empty array when no invocations', () => {
      expect(skillInvocationStore.listAll()).toEqual([]);
    });

    it('returns all stored invocations', () => {
      skillInvocationStore.create(makeInvocation({ id: 'inv_1', jobId: 'job_1' }));
      skillInvocationStore.create(makeInvocation({ id: 'inv_2', jobId: 'job_2' }));
      expect(skillInvocationStore.listAll()).toHaveLength(2);
    });
  });

  describe('listByJobId', () => {
    it('returns only invocations for the given jobId', () => {
      skillInvocationStore.create(makeInvocation({ id: 'inv_1', jobId: 'job_1' }));
      skillInvocationStore.create(makeInvocation({ id: 'inv_2', jobId: 'job_2' }));
      const result = skillInvocationStore.listByJobId('job_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inv_1');
    });

    it('returns empty array when no invocations match jobId', () => {
      skillInvocationStore.create(makeInvocation({ id: 'inv_1', jobId: 'job_1' }));
      expect(skillInvocationStore.listByJobId('job_999')).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('updates the status of an invocation', () => {
      skillInvocationStore.create(makeInvocation());
      const updated = skillInvocationStore.updateStatus('inv_test_1', 'running');
      expect(updated?.status).toBe('running');
    });

    it('updates optional fields', () => {
      skillInvocationStore.create(makeInvocation());
      const completedAt = Date.now();
      const updated = skillInvocationStore.updateStatus('inv_test_1', 'completed', {
        outputPayload: { result: 'done' },
        artifactIds: ['artifact_job_1'],
        completedAt,
      });
      expect(updated?.status).toBe('completed');
      expect(updated?.outputPayload).toEqual({ result: 'done' });
      expect(updated?.artifactIds).toEqual(['artifact_job_1']);
      expect(updated?.completedAt).toBe(completedAt);
    });

    it('updates error and retryCount on failure', () => {
      skillInvocationStore.create(makeInvocation());
      const updated = skillInvocationStore.updateStatus('inv_test_1', 'failed', {
        error: 'something went wrong',
        retryCount: 1,
      });
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('something went wrong');
      expect(updated?.retryCount).toBe(1);
    });

    it('returns undefined for unknown id', () => {
      expect(skillInvocationStore.updateStatus('nonexistent', 'running')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all stored invocations', () => {
      skillInvocationStore.create(makeInvocation({ id: 'inv_1' }));
      skillInvocationStore.create(makeInvocation({ id: 'inv_2' }));
      skillInvocationStore.reset();
      expect(skillInvocationStore.listAll()).toEqual([]);
    });
  });

  describe('status lifecycle transitions', () => {
    it('transitions pending → running → completed', () => {
      const inv = skillInvocationStore.create(makeInvocation({ status: 'pending' }));
      expect(inv.status).toBe('pending');

      skillInvocationStore.updateStatus(inv.id, 'running');
      expect(skillInvocationStore.getById(inv.id)?.status).toBe('running');

      skillInvocationStore.updateStatus(inv.id, 'completed', {
        outputPayload: { result: 'ok' },
        completedAt: Date.now(),
      });
      expect(skillInvocationStore.getById(inv.id)?.status).toBe('completed');
    });

    it('transitions pending → running → failed', () => {
      const inv = skillInvocationStore.create(makeInvocation({ status: 'pending' }));
      skillInvocationStore.updateStatus(inv.id, 'running');
      skillInvocationStore.updateStatus(inv.id, 'failed', { error: 'handler threw' });
      expect(skillInvocationStore.getById(inv.id)?.status).toBe('failed');
      expect(skillInvocationStore.getById(inv.id)?.error).toBe('handler threw');
    });

    it('can be set to cancelled', () => {
      const inv = skillInvocationStore.create(makeInvocation({ status: 'pending' }));
      skillInvocationStore.updateStatus(inv.id, 'cancelled');
      expect(skillInvocationStore.getById(inv.id)?.status).toBe('cancelled');
    });
  });

  describe('uses independent instance', () => {
    it('InMemorySkillInvocationStore instances are independent', () => {
      const store1 = new InMemorySkillInvocationStore();
      const store2 = new InMemorySkillInvocationStore();
      store1.create(makeInvocation({ id: 'inv_a' }));
      expect(store1.listAll()).toHaveLength(1);
      expect(store2.listAll()).toHaveLength(0);
    });
  });
});
