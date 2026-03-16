import {
  InMemoryAuditLog,
  auditLog,
  type AuditLogEntry,
  type AuditEventType,
} from '../packages/core/src/audit_log';

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit_1',
    eventType: 'signal.received',
    objectType: 'Signal',
    objectId: 'signal_1',
    actorId: 'system',
    timestamp: Date.now(),
    summary: 'Signal signal_1 received.',
    ...overrides,
  };
}

beforeEach(() => {
  auditLog.reset();
});

describe('InMemoryAuditLog', () => {
  describe('append', () => {
    it('stores and returns the entry', () => {
      const entry = makeEntry();
      const stored = auditLog.append(entry);
      expect(stored).toEqual(entry);
    });

    it('accumulates multiple entries in order', () => {
      auditLog.append(makeEntry({ id: 'audit_1', eventType: 'signal.received' }));
      auditLog.append(makeEntry({ id: 'audit_2', eventType: 'plan.created', objectType: 'Plan', objectId: 'plan_1' }));
      const all = auditLog.listAll();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe('audit_1');
      expect(all[1].id).toBe('audit_2');
    });
  });

  describe('listAll', () => {
    it('returns empty array when no entries exist', () => {
      expect(auditLog.listAll()).toEqual([]);
    });

    it('returns a copy so external mutations do not affect the store', () => {
      auditLog.append(makeEntry());
      const list1 = auditLog.listAll();
      list1.push(makeEntry({ id: 'audit_extra' }));
      expect(auditLog.listAll()).toHaveLength(1);
    });
  });

  describe('listByObjectId', () => {
    it('returns entries matching objectType and objectId', () => {
      auditLog.append(makeEntry({ id: 'a1', objectType: 'Signal', objectId: 'signal_1' }));
      auditLog.append(makeEntry({ id: 'a2', objectType: 'Job', objectId: 'job_1', eventType: 'job.created' }));
      const result = auditLog.listByObjectId('Signal', 'signal_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
    });
  });

  describe('listByEventType', () => {
    it('returns only entries of the given event type', () => {
      auditLog.append(makeEntry({ id: 'a1', eventType: 'signal.received' }));
      auditLog.append(
        makeEntry({ id: 'a2', eventType: 'job.completed', objectType: 'Job', objectId: 'job_1' }),
      );
      const result = auditLog.listByEventType('signal.received');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
    });
  });

  describe('listByActorId', () => {
    it('returns entries for the given actor', () => {
      auditLog.append(makeEntry({ id: 'a1', actorId: 'system' }));
      auditLog.append(makeEntry({ id: 'a2', actorId: 'operator_1', eventType: 'operator.override', objectType: 'Job', objectId: 'job_1' }));
      const result = auditLog.listByActorId('operator_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a2');
    });
  });

  describe('listByWorkspaceId', () => {
    it('returns entries for the given workspaceId', () => {
      auditLog.append(makeEntry({ id: 'a1', workspaceId: 'ws_1' }));
      auditLog.append(makeEntry({ id: 'a2', workspaceId: 'ws_2' }));
      const result = auditLog.listByWorkspaceId('ws_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
    });
  });

  describe('append-only semantics', () => {
    it('does not expose a delete or update method', () => {
      const log = new InMemoryAuditLog();
      expect((log as unknown as Record<string, unknown>).delete).toBeUndefined();
      expect((log as unknown as Record<string, unknown>).update).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all entries (test isolation only)', () => {
      auditLog.append(makeEntry({ id: 'a1' }));
      auditLog.append(makeEntry({ id: 'a2' }));
      auditLog.reset();
      expect(auditLog.listAll()).toEqual([]);
    });
  });

  describe('instances are independent', () => {
    it('InMemoryAuditLog instances do not share state', () => {
      const log1 = new InMemoryAuditLog();
      const log2 = new InMemoryAuditLog();
      log1.append(makeEntry({ id: 'a1' }));
      expect(log1.listAll()).toHaveLength(1);
      expect(log2.listAll()).toHaveLength(0);
    });
  });

  describe('AuditEventType catalog', () => {
    const catalogEvents: AuditEventType[] = [
      'signal.received',
      'plan.created',
      'job.created',
      'job.assigned',
      'job.started',
      'job.completed',
      'job.failed',
      'job.retried',
      'skill_invocation.started',
      'skill_invocation.completed',
      'skill_invocation.failed',
      'artifact.created',
      'artifact.validated',
      'publish_event.initiated',
      'publish_event.approved',
      'publish_event.rejected',
      'publish_event.published',
      'publish_event.failed',
      'policy.evaluated',
      'policy.violated',
      'operator.override',
      'system.emergency_stop',
    ];

    it.each(catalogEvents)('can append an entry with eventType "%s"', (eventType) => {
      const entry = makeEntry({ id: `audit_${eventType}`, eventType });
      auditLog.append(entry);
      const found = auditLog.listByEventType(eventType);
      expect(found).toHaveLength(1);
      expect(found[0].eventType).toBe(eventType);
    });
  });
});
