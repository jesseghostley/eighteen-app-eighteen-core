/**
 * Ghost Mart dashboard API interaction tests.
 *
 * Covers the full lifecycle visible from the operator dashboard:
 * discover → list packages → install → list workspace packages →
 * enable → disable → update → uninstall
 *
 * Also tests filter behaviour (type, status) and error cases.
 */

import request from 'supertest';
import app from '../apps/api/src/app';
import { ghostMartPackageStore } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore } from '../packages/core/src/ghost_mart_workspace_install';
import { auditLog } from '../packages/core/src/audit_log';
import { eventBus } from '../packages/core/src/event_bus';
import { ghostMartSeedManifest } from '../packages/core/src/ghost_mart_seed_manifest';

const WORKSPACE_ID = 'ws_dashboard_001';

beforeEach(() => {
  ghostMartPackageStore.reset();
  workspaceInstallStore.reset();
  auditLog.reset();
  eventBus.reset();
});

// ─── Full lifecycle from dashboard perspective ──────────────────────────────

describe('Dashboard package lifecycle: discover → install → enable → disable → update → uninstall', () => {
  it('completes the full operator lifecycle for a package', async () => {
    // Step 1: discover packages
    const discoverRes = await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    expect(discoverRes.status).toBe(201);
    expect(discoverRes.body.discovered).toBeGreaterThan(0);

    // Step 2: list available packages — dashboard "Available Packages" table
    const listRes = await request(app).get('/api/ghost-mart/packages');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);

    const pkgId = 'skill_keyword_research';

    // Step 3: install into workspace — "Install" button action
    const installRes = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: pkgId, workspace_id: WORKSPACE_ID });
    expect(installRes.status).toBe(201);
    expect(installRes.body.package_id).toBe(pkgId);
    expect(installRes.body.workspace_id).toBe(WORKSPACE_ID);
    expect(installRes.body.install_status).toBe('installed');

    // Step 4: list workspace installed packages — "Workspace Installed Packages" table
    const wsListRes = await request(app).get(
      `/api/ghost-mart/workspaces/${WORKSPACE_ID}/packages`,
    );
    expect(wsListRes.status).toBe(200);
    expect(wsListRes.body).toHaveLength(1);
    expect(wsListRes.body[0].package_id).toBe(pkgId);

    // Step 5: enable — "Enable" button action
    const enableRes = await request(app)
      .post(`/api/ghost-mart/packages/${pkgId}/enable`)
      .send({ workspace_id: WORKSPACE_ID });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.install_status).toBe('enabled');
    expect(typeof enableRes.body.enabled_at).toBe('number');

    // Step 6: disable — "Disable" button action
    const disableRes = await request(app)
      .post(`/api/ghost-mart/packages/${pkgId}/disable`)
      .send({ workspace_id: WORKSPACE_ID });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.install_status).toBe('disabled');
    expect(typeof disableRes.body.disabled_at).toBe('number');

    // Step 7: update — "Update" button action
    const updateRes = await request(app)
      .post(`/api/ghost-mart/packages/${pkgId}/update`)
      .send({ workspace_id: WORKSPACE_ID });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.package_id).toBe(pkgId);
    expect(updateRes.body.workspace_id).toBe(WORKSPACE_ID);
    expect(updateRes.body.install_status).toBe('installed');

    // Step 8: uninstall — "Uninstall" button action
    const uninstallRes = await request(app)
      .post(`/api/ghost-mart/packages/${pkgId}/uninstall`)
      .send({ workspace_id: WORKSPACE_ID });
    expect(uninstallRes.status).toBe(200);
    expect(typeof uninstallRes.body.uninstalled_at).toBe('number');
  });
});

// ─── Filter behavior ────────────────────────────────────────────────────────

describe('Dashboard filter behavior', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
  });

  it('type filter=skill returns only skill packages', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=skill');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('skill');
    });
  });

  it('type filter=agent returns only agent packages', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=agent');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('agent');
    });
  });

  it('type filter=blueprint returns only blueprint packages', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=blueprint');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    (res.body as { package_type: string }[]).forEach((pkg) => {
      expect(pkg.package_type).toBe('blueprint');
    });
  });

  it('invalid type filter returns 400', async () => {
    const res = await request(app).get('/api/ghost-mart/packages?type=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid package type/i);
  });

  it('workspace filter returns only packages for that workspace', async () => {
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_seo_audit', workspace_id: 'ws_other' });

    const res = await request(app).get(
      `/api/ghost-mart/workspaces/${WORKSPACE_ID}/packages`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].workspace_id).toBe(WORKSPACE_ID);
  });

  it('workspace with no installs returns empty array', async () => {
    const res = await request(app).get('/api/ghost-mart/workspaces/ws_empty/packages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─── Error cases ────────────────────────────────────────────────────────────

describe('Dashboard error cases', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
  });

  it('install without package_id returns 400', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ workspace_id: WORKSPACE_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/package_id/i);
  });

  it('install without workspace_id returns 400', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workspace_id/i);
  });

  it('install for missing package returns 422', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'nonexistent_pkg', workspace_id: WORKSPACE_ID });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('enable without workspace_id returns 400', async () => {
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workspace_id/i);
  });

  it('enable for package not in workspace returns 404', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: 'ws_unknown' });
    expect(res.status).toBe(404);
  });

  it('disable without workspace_id returns 400', async () => {
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_seo_audit', workspace_id: WORKSPACE_ID });
    await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/enable')
      .send({ workspace_id: WORKSPACE_ID });
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_seo_audit/disable')
      .send({});
    expect(res.status).toBe(400);
  });

  it('uninstall for package not in workspace returns 404', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({ workspace_id: 'ws_unknown' });
    expect(res.status).toBe(404);
  });

  it('update for nonexistent package returns 422', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/nonexistent_pkg/update')
      .send({ workspace_id: WORKSPACE_ID });
    expect(res.status).toBe(422);
  });

  it('dependency failure returns 422 with dependency error message', async () => {
    // Load only content_generation which depends on skill_keyword_research
    ghostMartPackageStore.reset();
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

  it('get single package returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/ghost-mart/packages/not_a_real_package');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('discover with non-array body returns 400', async () => {
    const res = await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send({ not: 'an array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });
});

// ─── Audit log entries for dashboard actions ────────────────────────────────

describe('Dashboard operator actions create audit log entries', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/ghost-mart/packages/discover')
      .send(ghostMartSeedManifest);
    await request(app)
      .post('/api/ghost-mart/install')
      .send({ package_id: 'skill_keyword_research', workspace_id: WORKSPACE_ID });
  });

  it('install action creates a package.installed audit entry', () => {
    const entries = auditLog.listByEventType('package.installed');
    expect(entries).toHaveLength(1);
    expect(entries[0].workspaceId).toBe(WORKSPACE_ID);
  });

  it('enable action creates a package.enabled audit entry', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: WORKSPACE_ID });
    const entries = auditLog.listByEventType('package.enabled');
    expect(entries).toHaveLength(1);
  });

  it('disable action creates a package.disabled audit entry', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/enable')
      .send({ workspace_id: WORKSPACE_ID });
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/disable')
      .send({ workspace_id: WORKSPACE_ID });
    const entries = auditLog.listByEventType('package.disabled');
    expect(entries).toHaveLength(1);
  });

  it('uninstall action creates a package.uninstalled audit entry', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/uninstall')
      .send({ workspace_id: WORKSPACE_ID });
    const entries = auditLog.listByEventType('package.uninstalled');
    expect(entries).toHaveLength(1);
  });

  it('update action creates a package.updated audit entry', async () => {
    await request(app)
      .post('/api/ghost-mart/packages/skill_keyword_research/update')
      .send({ workspace_id: WORKSPACE_ID });
    const entries = auditLog.listByEventType('package.updated');
    expect(entries).toHaveLength(1);
  });
});
