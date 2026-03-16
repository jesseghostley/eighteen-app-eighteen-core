import {
  InMemoryWorkspacePolicyStore,
  workspacePolicyStore,
  type WorkspacePolicy,
  type PolicyType,
} from '../packages/core/src/workspace_policy';

function makePolicy(overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  const now = Date.now();
  return {
    id: 'policy_1',
    workspaceId: 'ws_default',
    policyType: 'execution',
    name: 'Default execution policy',
    description: 'Controls which skills agents may invoke.',
    rules: { allowedSkills: ['draft_cluster_outline'] },
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  workspacePolicyStore.reset();
});

describe('InMemoryWorkspacePolicyStore', () => {
  describe('create', () => {
    it('stores and returns the policy', () => {
      const p = makePolicy();
      const stored = workspacePolicyStore.create(p);
      expect(stored).toEqual(p);
    });
  });

  describe('getById', () => {
    it('retrieves a policy by id', () => {
      const p = makePolicy();
      workspacePolicyStore.create(p);
      expect(workspacePolicyStore.getById('policy_1')).toEqual(p);
    });

    it('returns undefined for unknown id', () => {
      expect(workspacePolicyStore.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('returns empty array when no policies exist', () => {
      expect(workspacePolicyStore.listAll()).toEqual([]);
    });

    it('returns all stored policies', () => {
      workspacePolicyStore.create(makePolicy({ id: 'policy_1' }));
      workspacePolicyStore.create(makePolicy({ id: 'policy_2', policyType: 'publish' }));
      expect(workspacePolicyStore.listAll()).toHaveLength(2);
    });
  });

  describe('listByWorkspaceId', () => {
    it('returns policies for the given workspaceId', () => {
      workspacePolicyStore.create(makePolicy({ id: 'p1', workspaceId: 'ws_a' }));
      workspacePolicyStore.create(makePolicy({ id: 'p2', workspaceId: 'ws_b' }));
      const result = workspacePolicyStore.listByWorkspaceId('ws_a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });
  });

  describe('listActive', () => {
    it('returns only active policies for a workspace', () => {
      workspacePolicyStore.create(makePolicy({ id: 'p1', status: 'active' }));
      workspacePolicyStore.create(makePolicy({ id: 'p2', status: 'inactive' }));
      const result = workspacePolicyStore.listActive('ws_default');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('filters by policyType when provided', () => {
      workspacePolicyStore.create(makePolicy({ id: 'p1', policyType: 'execution', status: 'active' }));
      workspacePolicyStore.create(makePolicy({ id: 'p2', policyType: 'publish', status: 'active' }));
      const result = workspacePolicyStore.listActive('ws_default', 'publish');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p2');
    });
  });

  describe('update', () => {
    it('updates mutable fields', () => {
      workspacePolicyStore.create(makePolicy());
      const updatedAt = Date.now() + 1000;
      const updated = workspacePolicyStore.update('policy_1', {
        name: 'Updated policy name',
        updatedAt,
      });
      expect(updated?.name).toBe('Updated policy name');
      expect(updated?.updatedAt).toBe(updatedAt);
    });

    it('returns undefined for unknown id', () => {
      expect(
        workspacePolicyStore.update('nonexistent', { updatedAt: Date.now() }),
      ).toBeUndefined();
    });
  });

  describe('deactivate', () => {
    it('sets status to inactive (soft delete)', () => {
      workspacePolicyStore.create(makePolicy({ status: 'active' }));
      const deactivated = workspacePolicyStore.deactivate('policy_1', Date.now(), 'operator_1');
      expect(deactivated?.status).toBe('inactive');
    });

    it('does not delete the record', () => {
      workspacePolicyStore.create(makePolicy());
      workspacePolicyStore.deactivate('policy_1', Date.now());
      expect(workspacePolicyStore.getById('policy_1')).toBeDefined();
    });

    it('returns undefined for unknown id', () => {
      expect(workspacePolicyStore.deactivate('nonexistent', Date.now())).toBeUndefined();
    });
  });

  describe('policyType variants', () => {
    const policyTypes: PolicyType[] = ['execution', 'publish', 'safety', 'workspace'];

    it.each(policyTypes)('supports policyType "%s"', (policyType) => {
      const p = makePolicy({ id: `policy_${policyType}`, policyType });
      workspacePolicyStore.create(p);
      expect(workspacePolicyStore.getById(`policy_${policyType}`)?.policyType).toBe(policyType);
    });
  });

  describe('reset', () => {
    it('clears all stored policies', () => {
      workspacePolicyStore.create(makePolicy({ id: 'p1' }));
      workspacePolicyStore.create(makePolicy({ id: 'p2', policyType: 'safety' }));
      workspacePolicyStore.reset();
      expect(workspacePolicyStore.listAll()).toEqual([]);
    });
  });

  describe('instances are independent', () => {
    it('InMemoryWorkspacePolicyStore instances do not share state', () => {
      const store1 = new InMemoryWorkspacePolicyStore();
      const store2 = new InMemoryWorkspacePolicyStore();
      store1.create(makePolicy({ id: 'p_a' }));
      expect(store1.listAll()).toHaveLength(1);
      expect(store2.listAll()).toHaveLength(0);
    });
  });
});
