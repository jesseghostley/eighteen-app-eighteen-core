/**
 * Ghost Mart package install lifecycle tests.
 *
 * Tests cover the full lifecycle: discover → install → enable → disable → uninstall → update
 * as well as validation errors and audit log entries.
 */

import request from 'supertest';
import app from '../apps/api/src/app';
import { ghostMartPackageStore } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore } from '../packages/core/src/ghost_mart_workspace_install';
import { auditLog } from '../packages/core/src/audit_log';
import { eventBus } from '../packages/core/src/event_bus';
import { ghostMartSeedManifest } from '../packages/core/src/ghost_mart_seed_manifest';

const WORKSPACE_ID = 'ws_test_001';

beforeEach(() => {
  ghostMartPackageStore.reset();
  workspaceInstallStore.reset();
  auditLog.reset();
  eventBus.reset();
});

// ─── GET /api/ghost-mart/packages ──────────────────────────────────────────

describe('GET /api/ghost-mart/packages', () => {
  it('returns empty array initially', async () => {
    const res = await request(app).get('/api/ghost-mart/packages');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

// ─── POST /api/ghost-mart/packages/discover ─────────────────────────────────

describe('POST /api/ghost-mart/packages/discover', () => {
  it('loads the seed manifest and returns discovered packages', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);

    expect(res.status).toBe(201);
    expect(res.body.discovered).toBe(ghostMartSeedManifest.length);
    expect(Array.isArray(res.body.packages)).toBe(true);
    expect(res.body.packages).toHaveLength(ghostMartSeedManifest.length);
  });

  it('returns 400 when body is not an array', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send({ not: 'an array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });
});

// ─── GET /api/ghost-mart/packages after discover ───────────────────────────

describe('GET /api/ghost-mart/packages after discover', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
  });

  it('returns all discovered packages', async () => {
    const res = await request(app).get('/api/ghost-mart/packages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(ghostMartSeedManifest.length);
  });

  it('filters by ?type=skill', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=skill');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('skill');
    });
  });

  it('filters by ?type=agent', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=agent');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('agent');
    });
  });

  it('filters by ?type=blueprint', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=blueprint');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('blueprint');
    });
  });

  it('returns 400 for an unknown type filter', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=unknown');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid package type/i);
  });
});

// ─── GET /api/ghost-mart/packages/:id ──────────────────────────────────────

describe('GET /api/ghost-mart/packages/:id', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
  });

  it('returns a single package by id', async () => {
    const res = await request(app).get(
      '/api/ghost-mart/packages/skill_keyword_research',
    );
    expect(res.status).toBe(200);
    expect(res.body.package_id).toBe('skill_keyword_research');
    expect(res.body.package_type).toBe('skill');
  });

  it('returns 404 for an unknown package id', async () => {
    const res = await request(app).get('/api/ghost-mart/packages/not_a_real_package');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── POST /api/ghost-mart/install ───────────────────────────────────────────

describe('POST /api/ghost-mart/install', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
  });

  it('installs a package into a workspace and returns 201', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(201);
    expect(res.body.package_id).toBe('skill_keyword_research');
    expect(res.body.workspace_id).toBe(WORKSPACE_ID);
    expect(res.body.install_status).toBe('installed');
    expect(typeof res.body.id).toBe('string');
  });

  it('returns 400 when package_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/package_id/i);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workspace_id/i);
  });

  it('returns 422 when package is not in the store', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'nonexistent_pkg', workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('creates an audit log entry for install', async () => {
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });

    const entries = auditLog.listByEventType('package.installed');
    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe('package.installed');
    expect(entries[0].workspaceId).toBe(WORKSPACE_ID);
  });

  it('emits a package.installed event on the event bus', async () => {
    const emitted: unknown[] = [];
    eventBus.on('package.installed', (payload) => emitted.push(payload));

    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });

    expect(emitted).toHaveLength(1);
  });
});

// ─── GET /api/ghost-mart/workspaces/:id/packages ────────────────────────────

describe('GET /api/ghost-mart/workspaces/:id/packages', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_seo_audit', workspace_id: WORKSPACE_ID });
  });

  it('returns all install records for a workspace', async () => {
    const res = await request(app).get(
      `/api/ghost-mart/workspaces/${WORKSPACE_ID}/packages`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    (res.body as { workspace_id: string }[]).forEach((record) => {
      expect(record.workspace_id).toBe(WORKSPACE_ID);
    });
  });

  it('returns empty array for a workspace with no installs', async () => {
    const res = await request(app).get('/api/ghost-mart/workspaces/ws_empty/packages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─── POST /packages/:id/enable ──────────────────────────────────────────────

describe('POST /api/ghost-mart/packages/:id/enable', () => {
  let installId: string;

  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    const installRes = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
    installId = installRes.body.id as string;
  });

  it('enables an installed package', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(200);
    expect(res.body.install_status).toBe('enabled');
    expect(typeof res.body.enabled_at).toBe('number');
    expect(res.body.id).toBe(installId);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workspace_id/i);
  });

  it('returns 404 for a package not installed in the workspace', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: 'ws_unknown' });

    expect(res.status).toBe(404);
  });

  it('creates an audit log entry for enable', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: WORKSPACE_ID });

    const entries = auditLog.listByEventType('package.enabled');
    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe('package.enabled');
  });
});

// ─── POST /packages/:id/disable ─────────────────────────────────────────────

describe('POST /api/ghost-mart/packages/:id/disable', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_seo_audit', workspace_id: WORKSPACE_ID });
    // Enable first so we can disable it
    await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/enable')
      .send({ workspace_id: WORKSPACE_ID });
  });

  it('disables an enabled package', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/disable')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(200);
    expect(res.body.install_status).toBe('disabled');
    expect(typeof res.body.disabled_at).toBe('number');
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/disable')
      .send({});

    expect(res.status).toBe(400);
  });

  it('creates an audit log entry for disable', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/disable')
      .send({ workspace_id: WORKSPACE_ID });

    const entries = auditLog.listByEventType('package.disabled');
    expect(entries).toHaveLength(1);
  });
});

// ─── POST /packages/:id/uninstall ───────────────────────────────────────────

describe('POST /api/ghost-mart/packages/:id/uninstall', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
  });

  it('uninstalls a package from a workspace', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(200);
    expect(typeof res.body.uninstalled_at).toBe('number');
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for a package not installed in the workspace', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({ workspace_id: 'ws_unknown' });

    expect(res.status).toBe(404);
  });

  it('creates an audit log entry for uninstall', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({ workspace_id: WORKSPACE_ID });

    const entries = auditLog.listByEventType('package.uninstalled');
    expect(entries).toHaveLength(1);
  });
});

// ─── POST /packages/:id/update ──────────────────────────────────────────────

describe('POST /api/ghost-mart/packages/:id/update', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_seo_audit', workspace_id: WORKSPACE_ID });
  });

  it('updates a package in a workspace and returns a new install record', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/update')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(200);
    expect(res.body.package_id).toBe('skill_seo_audit');
    expect(res.body.workspace_id).toBe(WORKSPACE_ID);
    expect(res.body.install_status).toBe('installed');
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/update')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 422 when package is not in the store', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/nonexistent_pkg/update')
      .send({ workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(422);
  });

  it('creates an audit log entry for update', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/update')
      .send({ workspace_id: WORKSPACE_ID });

    const entries = auditLog.listByEventType('package.updated');
    expect(entries).toHaveLength(1);
  });
});

// ─── Validation errors ──────────────────────────────────────────────────────

describe('Validation — dependency checking', () => {
  it('rejects install when a dependency is missing from the store', async () => {
    // Load only content_generation (which depends on skill_keyword_research)
    // without loading the dependency first
    const contentGenOnly = ghostMartSeedManifest.filter(
      (p) => p.package_id === 'skill_content_generation',
    );
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(contentGenOnly);

    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_content_generation', workspace_id: WORKSPACE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/dependency/i);
  });
});
