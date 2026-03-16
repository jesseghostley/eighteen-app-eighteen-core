/**
 * Ghost Mart API routes — package discovery, installation, and workspace lifecycle.
 *
 * Canonical spec: ghostclaw_marketplace_schema.md
 * Runtime chain:  HTTP client → GhostMartInstaller → package/install stores → skill/agent registries
 *
 * Endpoints:
 *   GET    /api/ghost-mart/packages                 — list available packages (optional ?type= filter)
 *   GET    /api/ghost-mart/packages/:id             — get single package details
 *   POST   /api/ghost-mart/packages/discover        — load packages from manifest body
 *   POST   /api/ghost-mart/install                  — install a package { package_id, workspace_id }
 *   GET    /api/ghost-mart/workspaces/:id/packages  — list installed packages for a workspace
 *   POST   /api/ghost-mart/packages/:id/enable      — enable an installed package { workspace_id }
 *   POST   /api/ghost-mart/packages/:id/disable     — disable an installed package { workspace_id }
 *   POST   /api/ghost-mart/packages/:id/uninstall   — uninstall from workspace { workspace_id }
 *   POST   /api/ghost-mart/packages/:id/update      — update package in workspace { workspace_id }
 */

import { Router } from 'express';
import type { PackageType } from '../../../../packages/core/src/ghost_mart_package';
import { ghostMartPackageStore } from '../../../../packages/core/src/ghost_mart_package';
import { workspaceInstallStore } from '../../../../packages/core/src/ghost_mart_workspace_install';
import { ghostMartInstaller } from '../../../../packages/core/src/ghost_mart_installer';

const router = Router();

const VALID_PACKAGE_TYPES = new Set<PackageType>(['skill', 'agent', 'blueprint']);

// ─── GET /packages ──────────────────────────────────────────────────────────

router.get('/packages', (req, res) => {
  const typeParam = req.query['type'] as string | undefined;

  if (typeParam !== undefined) {
    if (!VALID_PACKAGE_TYPES.has(typeParam as PackageType)) {
      res.status(400).json({
        error: `Invalid package type '${typeParam}'. Must be one of: skill, agent, blueprint.`,
      });
      return;
    }
    const packages = ghostMartPackageStore.listByType(typeParam as PackageType);
    res.json(packages);
    return;
  }

  res.json(ghostMartPackageStore.listAll());
});

// ─── POST /packages/discover ────────────────────────────────────────────────
// NOTE: This route MUST be registered before GET /packages/:id so that
// the literal path segment 'discover' is matched first.

router.post('/packages/discover', (req, res) => {
  const manifest = req.body;

  if (!Array.isArray(manifest)) {
    res.status(400).json({ error: 'Request body must be an array of package definitions.' });
    return;
  }

  try {
    const discovered = ghostMartInstaller.discover(manifest);
    res.status(201).json({ discovered: discovered.length, packages: discovered });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to discover packages.';
    res.status(422).json({ error: message });
  }
});

// ─── GET /packages/:id ──────────────────────────────────────────────────────

router.get('/packages/:id', (req, res) => {
  const pkg = ghostMartPackageStore.getById(req.params['id']);
  if (!pkg) {
    res.status(404).json({ error: `Package '${req.params['id']}' not found.` });
    return;
  }
  res.json(pkg);
});

// ─── POST /install ───────────────────────────────────────────────────────────

router.post('/install', (req, res) => {
  const { package_id, workspace_id, installed_by } = req.body ?? {};

  if (typeof package_id !== 'string' || !package_id.trim()) {
    res.status(400).json({ error: '"package_id" is required.' });
    return;
  }
  if (typeof workspace_id !== 'string' || !workspace_id.trim()) {
    res.status(400).json({ error: '"workspace_id" is required.' });
    return;
  }

  const actor = typeof installed_by === 'string' && installed_by.trim()
    ? installed_by.trim()
    : 'operator';

  try {
    const record = ghostMartInstaller.install(package_id, workspace_id, actor);
    res.status(201).json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to install package.';
    res.status(422).json({ error: message });
  }
});

// ─── GET /workspaces/:id/packages ───────────────────────────────────────────

router.get('/workspaces/:id/packages', (req, res) => {
  const installs = workspaceInstallStore.listByWorkspace(req.params['id']);
  res.json(installs);
});

// ─── POST /packages/:id/enable ──────────────────────────────────────────────

router.post('/packages/:id/enable', (req, res) => {
  const { workspace_id } = req.body ?? {};

  if (typeof workspace_id !== 'string' || !workspace_id.trim()) {
    res.status(400).json({ error: '"workspace_id" is required.' });
    return;
  }

  const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(
    workspace_id,
    req.params['id'],
  );

  if (!installRecord) {
    res.status(404).json({
      error: `No install record found for package '${req.params['id']}' in workspace '${workspace_id}'.`,
    });
    return;
  }

  try {
    const record = ghostMartInstaller.enable(installRecord.id);
    res.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to enable package.';
    res.status(422).json({ error: message });
  }
});

// ─── POST /packages/:id/disable ─────────────────────────────────────────────

router.post('/packages/:id/disable', (req, res) => {
  const { workspace_id } = req.body ?? {};

  if (typeof workspace_id !== 'string' || !workspace_id.trim()) {
    res.status(400).json({ error: '"workspace_id" is required.' });
    return;
  }

  const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(
    workspace_id,
    req.params['id'],
  );

  if (!installRecord) {
    res.status(404).json({
      error: `No install record found for package '${req.params['id']}' in workspace '${workspace_id}'.`,
    });
    return;
  }

  try {
    const record = ghostMartInstaller.disable(installRecord.id);
    res.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disable package.';
    res.status(422).json({ error: message });
  }
});

// ─── POST /packages/:id/uninstall ───────────────────────────────────────────

router.post('/packages/:id/uninstall', (req, res) => {
  const { workspace_id } = req.body ?? {};

  if (typeof workspace_id !== 'string' || !workspace_id.trim()) {
    res.status(400).json({ error: '"workspace_id" is required.' });
    return;
  }

  const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(
    workspace_id,
    req.params['id'],
  );

  if (!installRecord) {
    res.status(404).json({
      error: `No install record found for package '${req.params['id']}' in workspace '${workspace_id}'.`,
    });
    return;
  }

  try {
    const record = ghostMartInstaller.uninstall(installRecord.id);
    res.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to uninstall package.';
    res.status(422).json({ error: message });
  }
});

// ─── POST /packages/:id/update ──────────────────────────────────────────────

router.post('/packages/:id/update', (req, res) => {
  const { workspace_id } = req.body ?? {};

  if (typeof workspace_id !== 'string' || !workspace_id.trim()) {
    res.status(400).json({ error: '"workspace_id" is required.' });
    return;
  }

  try {
    const record = ghostMartInstaller.update(req.params['id'], workspace_id);
    res.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update package.';
    res.status(422).json({ error: message });
  }
});

export default router;
