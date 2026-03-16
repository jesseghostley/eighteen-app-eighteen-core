import {
  InMemoryPublishEventStore,
  publishEventStore,
  type PublishEvent,
} from '../packages/core/src/publish_event';

function makePublishEvent(overrides: Partial<PublishEvent> = {}): PublishEvent {
  return {
    id: 'pub_event_1',
    artifactId: 'artifact_job_1',
    publishedAt: Date.now(),
    destination: 'ghost_mart',
    status: 'pending',
    publishedBy: 'ContentStrategistAgent',
    ...overrides,
  };
}

beforeEach(() => {
  publishEventStore.reset();
});

describe('InMemoryPublishEventStore', () => {
  describe('create', () => {
    it('stores and returns the publish event', () => {
      const pe = makePublishEvent();
      const stored = publishEventStore.create(pe);
      expect(stored).toEqual(pe);
    });
  });

  describe('getById', () => {
    it('retrieves a publish event by id', () => {
      const pe = makePublishEvent();
      publishEventStore.create(pe);
      expect(publishEventStore.getById('pub_event_1')).toEqual(pe);
    });

    it('returns undefined for unknown id', () => {
      expect(publishEventStore.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('returns empty array when no events exist', () => {
      expect(publishEventStore.listAll()).toEqual([]);
    });

    it('returns all stored events', () => {
      publishEventStore.create(makePublishEvent({ id: 'pub_event_1' }));
      publishEventStore.create(makePublishEvent({ id: 'pub_event_2', artifactId: 'artifact_job_2' }));
      expect(publishEventStore.listAll()).toHaveLength(2);
    });
  });

  describe('listByArtifactId', () => {
    it('returns events for the given artifactId', () => {
      publishEventStore.create(makePublishEvent({ id: 'pub_event_1', artifactId: 'artifact_job_1' }));
      publishEventStore.create(makePublishEvent({ id: 'pub_event_2', artifactId: 'artifact_job_2' }));
      const result = publishEventStore.listByArtifactId('artifact_job_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pub_event_1');
    });
  });

  describe('listByStatus', () => {
    it('returns only events matching the given status', () => {
      publishEventStore.create(makePublishEvent({ id: 'pe_1', status: 'pending' }));
      publishEventStore.create(
        makePublishEvent({ id: 'pe_2', artifactId: 'artifact_job_2', status: 'published' }),
      );
      const pending = publishEventStore.listByStatus('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('pe_1');
    });
  });

  describe('updateStatus', () => {
    it('updates the status', () => {
      publishEventStore.create(makePublishEvent());
      const updated = publishEventStore.updateStatus('pub_event_1', 'approved');
      expect(updated?.status).toBe('approved');
    });

    it('updates optional fields on approval', () => {
      publishEventStore.create(makePublishEvent());
      const approvedAt = Date.now();
      const updated = publishEventStore.updateStatus('pub_event_1', 'approved', {
        approvedBy: 'operator_1',
        approvedAt,
      });
      expect(updated?.approvedBy).toBe('operator_1');
      expect(updated?.approvedAt).toBe(approvedAt);
    });

    it('updates externalUrl and failureReason', () => {
      publishEventStore.create(makePublishEvent());
      const updated = publishEventStore.updateStatus('pub_event_1', 'published', {
        externalUrl: 'https://example.com/listing/1',
      });
      expect(updated?.externalUrl).toBe('https://example.com/listing/1');
    });

    it('records failure reason', () => {
      publishEventStore.create(makePublishEvent());
      const updated = publishEventStore.updateStatus('pub_event_1', 'failed', {
        failureReason: 'CMS rejected the payload',
      });
      expect(updated?.status).toBe('failed');
      expect(updated?.failureReason).toBe('CMS rejected the payload');
    });

    it('returns undefined for unknown id', () => {
      expect(publishEventStore.updateStatus('nonexistent', 'approved')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all stored events', () => {
      publishEventStore.create(makePublishEvent({ id: 'pe_1' }));
      publishEventStore.create(makePublishEvent({ id: 'pe_2', artifactId: 'artifact_job_2' }));
      publishEventStore.reset();
      expect(publishEventStore.listAll()).toEqual([]);
    });
  });

  describe('instances are independent', () => {
    it('InMemoryPublishEventStore instances do not share state', () => {
      const store1 = new InMemoryPublishEventStore();
      const store2 = new InMemoryPublishEventStore();
      store1.create(makePublishEvent({ id: 'pe_a' }));
      expect(store1.listAll()).toHaveLength(1);
      expect(store2.listAll()).toHaveLength(0);
    });
  });
});
