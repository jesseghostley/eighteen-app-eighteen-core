import {
  InMemoryAssignmentStore,
  assignmentStore,
  type Assignment,
} from '../packages/core/src/assignment';

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assign_job_1',
    jobId: 'job_1',
    agentName: 'ContentStrategistAgent',
    reason: 'Agent selected by capability match for job type draft_cluster_outline.',
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  assignmentStore.reset();
});

describe('InMemoryAssignmentStore', () => {
  describe('create', () => {
    it('stores and returns the assignment', () => {
      const a = makeAssignment();
      const stored = assignmentStore.create(a);
      expect(stored).toEqual(a);
    });
  });

  describe('getById', () => {
    it('retrieves an assignment by id', () => {
      const a = makeAssignment();
      assignmentStore.create(a);
      expect(assignmentStore.getById('assign_job_1')).toEqual(a);
    });

    it('returns undefined for unknown id', () => {
      expect(assignmentStore.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('returns empty array when no assignments exist', () => {
      expect(assignmentStore.listAll()).toEqual([]);
    });

    it('returns all stored assignments', () => {
      assignmentStore.create(makeAssignment({ id: 'assign_job_1', jobId: 'job_1' }));
      assignmentStore.create(makeAssignment({ id: 'assign_job_2', jobId: 'job_2' }));
      expect(assignmentStore.listAll()).toHaveLength(2);
    });
  });

  describe('listByJobId', () => {
    it('returns assignments for the given jobId', () => {
      assignmentStore.create(makeAssignment({ id: 'assign_job_1', jobId: 'job_1' }));
      assignmentStore.create(makeAssignment({ id: 'assign_job_2', jobId: 'job_2' }));
      const result = assignmentStore.listByJobId('job_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('assign_job_1');
    });

    it('returns empty array when no assignments match jobId', () => {
      assignmentStore.create(makeAssignment({ id: 'assign_job_1', jobId: 'job_1' }));
      expect(assignmentStore.listByJobId('job_999')).toEqual([]);
    });
  });

  describe('listByAgentName', () => {
    it('returns assignments for the given agent name', () => {
      assignmentStore.create(
        makeAssignment({ id: 'assign_job_1', agentName: 'ContentStrategistAgent' }),
      );
      assignmentStore.create(
        makeAssignment({ id: 'assign_job_2', jobId: 'job_2', agentName: 'DiagnosticsAgent' }),
      );
      const result = assignmentStore.listByAgentName('ContentStrategistAgent');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('assign_job_1');
    });
  });

  describe('revoke', () => {
    it('sets revokedAt and revokedReason', () => {
      assignmentStore.create(makeAssignment());
      const revokedAt = Date.now();
      const updated = assignmentStore.revoke('assign_job_1', revokedAt, 'agent unavailable');
      expect(updated?.revokedAt).toBe(revokedAt);
      expect(updated?.revokedReason).toBe('agent unavailable');
    });

    it('returns undefined for unknown id', () => {
      expect(assignmentStore.revoke('nonexistent', Date.now(), 'reason')).toBeUndefined();
    });

    it('does not delete the record when revoked', () => {
      assignmentStore.create(makeAssignment());
      assignmentStore.revoke('assign_job_1', Date.now(), 'agent unavailable');
      expect(assignmentStore.getById('assign_job_1')).toBeDefined();
    });
  });

  describe('reset', () => {
    it('clears all stored assignments', () => {
      assignmentStore.create(makeAssignment({ id: 'assign_1' }));
      assignmentStore.create(makeAssignment({ id: 'assign_2', jobId: 'job_2' }));
      assignmentStore.reset();
      expect(assignmentStore.listAll()).toEqual([]);
    });
  });

  describe('instances are independent', () => {
    it('InMemoryAssignmentStore instances do not share state', () => {
      const store1 = new InMemoryAssignmentStore();
      const store2 = new InMemoryAssignmentStore();
      store1.create(makeAssignment({ id: 'assign_a' }));
      expect(store1.listAll()).toHaveLength(1);
      expect(store2.listAll()).toHaveLength(0);
    });
  });
});
