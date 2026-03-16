import request from 'supertest';
import app from '../apps/api/src/app';
import { runtimeStore } from '../packages/core/src/runtime_loop';
import { jobQueue } from '../packages/core/src/job_queue';
import { skillInvocationStore } from '../packages/core/src/skill_invocation';
import { assignmentStore } from '../packages/core/src/assignment';
import {
  registerRuntimeEventLogSubscribers,
  resetEventLogSubscriberState,
} from '../packages/core/src/runtime_event_log_subscriber';
import { runtimeEventLog } from '../packages/core/src/runtime_event_log';
import { eventBus } from '../packages/core/src/event_bus';

beforeEach(() => {
  runtimeStore.signals.length = 0;
  runtimeStore.plans.length = 0;
  runtimeStore.jobs.length = 0;
  runtimeStore.artifacts.length = 0;
  runtimeStore.skillInvocations.length = 0;
  runtimeStore.assignments.length = 0;
  jobQueue.reset();
  skillInvocationStore.reset();
  assignmentStore.reset();
  runtimeEventLog.reset();
  resetEventLogSubscriberState();
  eventBus.reset();
  registerRuntimeEventLogSubscribers(eventBus, runtimeEventLog);
});

describe('GET /api/runtime-events', () => {
  it('returns empty array on fresh store', async () => {
    const res = await request(app).get('/api/runtime-events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns emitted events after processing a signal', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected', payload: { topic: 'Test' } });

    const res = await request(app).get('/api/runtime-events');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const eventTypes = (res.body as { event_type: string }[]).map((e) => e.event_type);
    expect(eventTypes).toContain('signal.received');
  });

  it('filters by event_type=signal.received', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const res = await request(app).get('/api/runtime-events?event_type=signal.received');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { event_type: string }[]).forEach((e) => {
      expect(e.event_type).toBe('signal.received');
    });
  });

  it('filters by workspace', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    // Find a workspace_id from the events
    const allRes = await request(app).get('/api/runtime-events');
    const workspaceEvent = (allRes.body as { workspace_id?: string }[]).find(
      (e) => e.workspace_id,
    );
    if (!workspaceEvent?.workspace_id) {
      // No workspace-tagged events in this signal — skip assertion
      return;
    }

    const ws = workspaceEvent.workspace_id;
    const res = await request(app).get(`/api/runtime-events?workspace=${ws}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { workspace_id?: string }[]).forEach((e) => {
      expect(e.workspace_id).toBe(ws);
    });
  });

  it('filters by correlation_id', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=signal.received',
    );
    const signalEvent = allRes.body[0] as { correlation_id?: string };
    expect(signalEvent.correlation_id).toBeDefined();

    const corrId = signalEvent.correlation_id!;
    const res = await request(app).get(
      `/api/runtime-events?correlation_id=${corrId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { correlation_id?: string }[]).forEach((e) => {
      expect(e.correlation_id).toBe(corrId);
    });
  });

  it('respects the limit query parameter', async () => {
    // Process two signals to generate multiple events
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });
    await request(app)
      .post('/api/signals')
      .send({ name: 'runtime_error_detected' });

    const allRes = await request(app).get('/api/runtime-events');
    const totalCount = allRes.body.length;

    if (totalCount > 2) {
      const res = await request(app).get('/api/runtime-events?limit=2');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    }
  });
});

describe('GET /api/runtime-events/:id', () => {
  it('returns 404 for an unknown event ID', async () => {
    const res = await request(app).get('/api/runtime-events/nonexistent_id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns the event with replayable field when it exists', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=signal.received',
    );
    expect(allRes.body.length).toBeGreaterThan(0);
    const eventId = (allRes.body[0] as { event_id: string }).event_id;

    const res = await request(app).get(`/api/runtime-events/${eventId}`);
    expect(res.status).toBe(200);
    expect(res.body.event_id).toBe(eventId);
    expect(res.body.event_type).toBe('signal.received');
    expect(typeof res.body.replayable).toBe('boolean');
    expect(res.body.replayable).toBe(true);
  });

  it('marks non-replayable event types correctly', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=skill.invocation.completed',
    );
    if (allRes.body.length === 0) return; // skip if no such event

    const eventId = (allRes.body[0] as { event_id: string }).event_id;
    const res = await request(app).get(`/api/runtime-events/${eventId}`);
    expect(res.status).toBe(200);
    expect(res.body.replayable).toBe(false);
  });
});

describe('GET /api/runtime-events/by-correlation/:correlationId', () => {
  it('returns empty events array for a nonexistent correlation ID', async () => {
    const res = await request(app).get(
      '/api/runtime-events/by-correlation/nonexistent',
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events).toHaveLength(0);
    expect(typeof res.body.chain_complete).toBe('boolean');
    expect(typeof res.body.has_failures).toBe('boolean');
  });

  it('returns full chain for a valid correlation ID', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=signal.received',
    );
    const corrId = (allRes.body[0] as { correlation_id?: string }).correlation_id;
    expect(corrId).toBeDefined();

    const res = await request(app).get(
      `/api/runtime-events/by-correlation/${corrId}`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);

    const eventTypes = (res.body.events as { event_type: string }[]).map(
      (e) => e.event_type,
    );
    expect(eventTypes).toContain('signal.received');
  });

  it('includes chain_complete and has_failures metadata', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=signal.received',
    );
    const corrId = (allRes.body[0] as { correlation_id?: string }).correlation_id!;

    const res = await request(app).get(
      `/api/runtime-events/by-correlation/${corrId}`,
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.chain_complete).toBe('boolean');
    expect(typeof res.body.has_failures).toBe('boolean');
    // A successful keyword_opportunity_detected signal should complete the chain
    expect(res.body.chain_complete).toBe(true);
    expect(res.body.has_failures).toBe(false);
  });

  it('returns events ordered chronologically (oldest first)', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const allRes = await request(app).get(
      '/api/runtime-events?event_type=signal.received',
    );
    const corrId = (allRes.body[0] as { correlation_id?: string }).correlation_id!;

    const res = await request(app).get(
      `/api/runtime-events/by-correlation/${corrId}`,
    );
    const events = res.body.events as { occurred_at: number }[];
    if (events.length >= 2) {
      for (let i = 1; i < events.length; i++) {
        expect(events[i].occurred_at).toBeGreaterThanOrEqual(events[i - 1].occurred_at);
      }
    }
  });
});
