import request from 'supertest';
import app from '../apps/api/src/app';
import { runtimeStore } from '../packages/core/src/runtime_loop';
import { jobQueue } from '../packages/core/src/job_queue';
import { skillInvocationStore } from '../packages/core/src/skill_invocation';
import { assignmentStore } from '../packages/core/src/assignment';

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
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'ghostclaw-api' });
  });
});

describe('POST /api/signals', () => {
  it('processes a valid signal and returns 201', async () => {
    const res = await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected', payload: { topic: 'Test' } });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Signal processed.');
    expect(res.body.signal.name).toBe('keyword_opportunity_detected');
    expect(res.body.plan.action).toBe('generate_content_cluster');
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.skillInvocations).toHaveLength(1);
    expect(res.body.storeCounts.signals).toBe(1);
    expect(res.body.storeCounts.skillInvocations).toBe(1);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/signals').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when name is blank', async () => {
    const res = await request(app).post('/api/signals').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 422 for an unrecognised signal name', async () => {
    const res = await request(app)
      .post('/api/signals')
      .send({ name: 'not_a_real_signal' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unsupported signal/i);
  });
});

describe('GET /api/runtime/status', () => {
  it('returns zeroed counts on a fresh store', async () => {
    const res = await request(app).get('/api/runtime/status');
    expect(res.status).toBe(200);
    expect(res.body.totalSignals).toBe(0);
    expect(res.body.registeredAgents).toBeGreaterThan(0);
  });

  it('reflects signals processed via /api/signals', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'runtime_error_detected' });

    const res = await request(app).get('/api/runtime/status');
    expect(res.body.totalSignals).toBe(1);
    expect(res.body.totalArtifacts).toBe(1);
  });
});

describe('GET /api/runtime/agents', () => {
  it('returns registered agents including DiagnosticsAgent', async () => {
    const res = await request(app).get('/api/runtime/agents');
    expect(res.status).toBe(200);
    const agentNames: string[] = res.body.agents.map((a: { agentName: string }) => a.agentName);
    expect(agentNames).toContain('DiagnosticsAgent');
  });
});

describe('GET /api/runtime/planner-strategies', () => {
  it('returns all four seeded strategies', async () => {
    const res = await request(app).get('/api/runtime/planner-strategies');
    expect(res.status).toBe(200);
    expect(res.body.strategyCount).toBe(4);
  });
});

describe('GET /api/runtime/queue', () => {
  it('returns queue status with job counts', async () => {
    const res = await request(app).get('/api/runtime/queue');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalJobs).toBe('number');
  });
});

describe('GET /api/runtime/artifacts', () => {
  it('returns artifact list', async () => {
    const res = await request(app).get('/api/runtime/artifacts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.artifacts)).toBe(true);
  });
});

describe('GET /api/skill-invocations', () => {
  it('returns empty array when no invocations exist', async () => {
    const res = await request(app).get('/api/skill-invocations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns invocations after a signal is processed', async () => {
    await request(app)
      .post('/api/signals')
      .send({ name: 'keyword_opportunity_detected' });

    const res = await request(app).get('/api/skill-invocations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].skillId).toBe('draft_cluster_outline');
    expect(res.body[0].status).toBe('completed');
  });
});

describe('GET /api/skill-invocations with query filters', () => {
  beforeEach(async () => {
    await request(app).post('/api/signals').send({ name: 'keyword_opportunity_detected' });
    await request(app).post('/api/signals').send({ name: 'runtime_error_detected' });
  });

  it('filters by status=completed', async () => {
    const res = await request(app).get('/api/skill-invocations?status=completed');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    (res.body as { status: string }[]).forEach((inv) => {
      expect(inv.status).toBe('completed');
    });
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await request(app).get('/api/skill-invocations?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/i);
  });

  it('filters by skill', async () => {
    const res = await request(app).get(
      '/api/skill-invocations?skill=draft_cluster_outline',
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { skillId: string }[]).forEach((inv) => {
      expect(inv.skillId).toBe('draft_cluster_outline');
    });
  });

  it('returns empty array when skill filter matches nothing', async () => {
    const res = await request(app).get(
      '/api/skill-invocations?skill=nonexistent_skill',
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('filters by agent', async () => {
    const allRes = await request(app).get('/api/skill-invocations');
    const agentId = (allRes.body as { agentId: string }[])[0].agentId;

    const res = await request(app).get(
      `/api/skill-invocations?agent=${agentId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { agentId: string }[]).forEach((inv) => {
      expect(inv.agentId).toBe(agentId);
    });
  });

  it('filters by workspace', async () => {
    const allRes = await request(app).get('/api/skill-invocations');
    const workspaceId = (allRes.body as { workspaceId: string }[])[0]
      .workspaceId;

    const res = await request(app).get(
      `/api/skill-invocations?workspace=${workspaceId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { workspaceId: string }[]).forEach((inv) => {
      expect(inv.workspaceId).toBe(workspaceId);
    });
  });
});

describe('GET /api/skill-invocations/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/skill-invocations/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns the invocation when it exists', async () => {
    const signalRes = await request(app)
      .post('/api/signals')
      .send({ name: 'runtime_error_detected' });

    const invocation = signalRes.body.skillInvocations[0];
    const res = await request(app).get(`/api/skill-invocations/${invocation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invocation.id);
    expect(res.body.skillId).toBe('run_diagnostics');
  });
});

describe('GET /api/jobs/:id/skill-invocations', () => {
  it('returns empty array for a job with no invocations', async () => {
    const res = await request(app).get('/api/jobs/nonexistent_job/skill-invocations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns invocations for a specific job', async () => {
    const signalRes = await request(app)
      .post('/api/signals')
      .send({ name: 'marketplace_gap_detected' });

    const jobId = signalRes.body.jobs[0].id;
    const res = await request(app).get(`/api/jobs/${jobId}/skill-invocations`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].jobId).toBe(jobId);
  });
});
