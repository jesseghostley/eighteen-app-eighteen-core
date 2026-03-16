import { PackageCompatibilityChecker } from '../packages/core/src/package_compatibility';
import type { PackageCompatibilityMetadata } from '../packages/core/src/package_compatibility';
import { WorkerBackendRegistry } from '../packages/core/src/worker_backend_manifest';
import type { WorkerBackendManifest } from '../packages/core/src/worker_backend_manifest';
import { GhostMartInstaller } from '../packages/core/src/ghost_mart_installer';
import { ghostMartPackageStore } from '../packages/core/src/ghost_mart_package';
import type { GhostMartPackage } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore } from '../packages/core/src/ghost_mart_workspace_install';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(id: string, overrides: Partial<WorkerBackendManifest> = {}): WorkerBackendManifest {
  return {
    backend_id: id,
    backend_name: `backend-${id}`,
    backend_type: 'container',
    supported_execution_types: ['shell_command'],
    supported_capabilities: ['shell_command'],
    workspace_scope: null,
    trust_level: 'trusted',
    max_concurrency: 10,
    health_status: 'healthy',
    requires_approval: false,
    provider_class: 'TestAdapter',
    ...overrides,
  };
}

function makeMeta(packageId: string, overrides: Partial<PackageCompatibilityMetadata> = {}): PackageCompatibilityMetadata {
  return {
    package_id: packageId,
    required_execution_types: ['shell_command'],
    required_capabilities: [],
    minimum_trust_level: 'trusted',
    requires_approval: false,
    compatible_backend_types: [],
    workspace_scope_constraints: null,
    ...overrides,
  };
}

function makePackage(id: string, overrides: Partial<GhostMartPackage> = {}): GhostMartPackage {
  return {
    package_id: id,
    name: `pkg-${id}`,
    version: '1.0.0',
    package_type: 'skill',
    description: `Test package ${id}`,
    author: 'test',
    dependencies: [],
    permissions_required: [],
    workspace_scope: '*',
    install_status: 'available',
    category: 'test',
    capabilities: ['test_cap'],
    inputs: [],
    outputs: [],
    install_command: `install ${id}`,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Package Compatibility System', () => {
  let backendRegistry: WorkerBackendRegistry;
  let checker: PackageCompatibilityChecker;

  beforeEach(() => {
    backendRegistry = new WorkerBackendRegistry();
    checker = new PackageCompatibilityChecker(backendRegistry);
    ghostMartPackageStore.reset();
    workspaceInstallStore.reset();
    eventBus.reset();
    auditLog.reset();
  });

  // ── Metadata Registration ─────────────────────────────────────────────

  describe('PackageCompatibilityChecker — metadata', () => {
    it('registers and retrieves compatibility metadata', () => {
      const meta = makeMeta('pkg_1');
      checker.registerMetadata(meta);

      expect(checker.getMetadata('pkg_1')).toBeDefined();
      expect(checker.getMetadata('pkg_1')?.required_execution_types).toEqual(['shell_command']);
    });

    it('returns undefined for unregistered package', () => {
      expect(checker.getMetadata('unknown')).toBeUndefined();
    });
  });

  // ── Package install blocked due to missing backend ────────────────────

  describe('install blocked — missing backend', () => {
    it('fails when no backends are registered', () => {
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons.length).toBeGreaterThan(0);
      expect(result.failure_reasons[0]).toContain('No backends');
    });

    it('fails when no backend supports required execution type', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['patch_apply'],
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        required_execution_types: ['shell_command'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons.some((r) => r.includes("execution type 'shell_command'"))).toBe(true);
    });

    it('fails when no backend supports required capability', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_capabilities: ['shell_command'],
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        required_capabilities: ['docker'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons.some((r) => r.includes("capability 'docker'"))).toBe(true);
    });

    it('fails when backend does not serve the workspace', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        workspace_scope: ['ws_other'],
      }));
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
    });

    it('fails when all backends are unavailable', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        health_status: 'unavailable',
      }));
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
    });
  });

  // ── Package install blocked due to insufficient trust level ───────────

  describe('install blocked — insufficient trust level', () => {
    it('fails when backend trust is untrusted but package requires trusted', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        trust_level: 'untrusted',
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        minimum_trust_level: 'trusted',
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons.some((r) => r.includes("trust level 'trusted'"))).toBe(true);
    });

    it('fails when backend trust is restricted but package requires trusted', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        trust_level: 'restricted',
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        minimum_trust_level: 'trusted',
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
    });

    it('passes when backend trust meets minimum', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        trust_level: 'trusted',
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        minimum_trust_level: 'restricted',
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });

    it('restricted backend satisfies restricted requirement', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        trust_level: 'restricted',
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        minimum_trust_level: 'restricted',
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });
  });

  // ── Package install allowed when compatible backends exist ────────────

  describe('install allowed — compatible backends', () => {
    it('passes when a matching backend exists', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
      expect(result.compatible_backends).toHaveLength(1);
      expect(result.compatible_backends[0].backend_id).toBe('be_1');
    });

    it('passes with no metadata (no requirements)', () => {
      const result = checker.validatePackageCompatibility('pkg_no_meta', 'ws_1');
      expect(result.compatible).toBe(true);
    });

    it('returns multiple compatible backends', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      backendRegistry.registerBackend(makeManifest('be_2'));
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
      expect(result.compatible_backends).toHaveLength(2);
    });

    it('includes degraded backends', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { health_status: 'degraded' }));
      checker.registerMetadata(makeMeta('pkg_1'));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });

    it('passes when backend type matches', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { backend_type: 'container' }));
      checker.registerMetadata(makeMeta('pkg_1', {
        compatible_backend_types: ['container'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });

    it('fails when backend type does not match', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { backend_type: 'ssh' }));
      checker.registerMetadata(makeMeta('pkg_1', {
        compatible_backend_types: ['container'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
    });
  });

  // ── Approval Requirement ──────────────────────────────────────────────

  describe('approval requirement', () => {
    it('fails when package requires approval but no backend supports it', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { requires_approval: false }));
      checker.registerMetadata(makeMeta('pkg_1', { requires_approval: true }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons.some((r) => r.includes('approval'))).toBe(true);
    });

    it('passes when backend supports approval', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { requires_approval: true }));
      checker.registerMetadata(makeMeta('pkg_1', { requires_approval: true }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });
  });

  // ── Workspace Scope Constraints ───────────────────────────────────────

  describe('workspace scope constraints', () => {
    it('fails when workspace is not in package scope constraints', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1', {
        workspace_scope_constraints: ['ws_2', 'ws_3'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(false);
      expect(result.failure_reasons[0]).toContain('restricted to workspaces');
    });

    it('passes when workspace is in scope constraints', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1', {
        workspace_scope_constraints: ['ws_1', 'ws_2'],
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });

    it('passes when scope constraints are null (global)', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1', {
        workspace_scope_constraints: null,
      }));

      const result = checker.validatePackageCompatibility('pkg_1', 'ws_1');
      expect(result.compatible).toBe(true);
    });
  });

  // ── Compatibility Explanations ────────────────────────────────────────

  describe('explainPackageCompatibilityFailure', () => {
    it('explains missing execution type', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_execution_types: ['patch_apply'],
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        required_execution_types: ['shell_command'],
      }));

      const reasons = checker.explainPackageCompatibilityFailure('pkg_1', 'ws_1');
      expect(reasons.some((r) => r.includes("execution type 'shell_command'"))).toBe(true);
    });

    it('explains missing capability', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        supported_capabilities: ['shell_command'],
      }));
      checker.registerMetadata(makeMeta('pkg_1', {
        required_capabilities: ['docker'],
      }));

      const reasons = checker.explainPackageCompatibilityFailure('pkg_1', 'ws_1');
      expect(reasons.some((r) => r.includes("capability 'docker'"))).toBe(true);
    });

    it('explains insufficient trust level', () => {
      backendRegistry.registerBackend(makeManifest('be_1', { trust_level: 'untrusted' }));
      checker.registerMetadata(makeMeta('pkg_1', { minimum_trust_level: 'trusted' }));

      const reasons = checker.explainPackageCompatibilityFailure('pkg_1', 'ws_1');
      expect(reasons.some((r) => r.includes("trust level 'trusted'"))).toBe(true);
    });

    it('explains no backends registered', () => {
      checker.registerMetadata(makeMeta('pkg_1'));

      const reasons = checker.explainPackageCompatibilityFailure('pkg_1', 'ws_1');
      expect(reasons[0]).toContain('No backends');
    });

    it('explains no backends serve workspace', () => {
      backendRegistry.registerBackend(makeManifest('be_1', {
        workspace_scope: ['ws_other'],
      }));
      checker.registerMetadata(makeMeta('pkg_1'));

      const reasons = checker.explainPackageCompatibilityFailure('pkg_1', 'ws_1');
      expect(reasons[0]).toContain("workspace 'ws_1'");
    });

    it('returns metadata-missing message for unregistered packages', () => {
      const reasons = checker.explainPackageCompatibilityFailure('unknown_pkg', 'ws_1');
      expect(reasons[0]).toContain('No compatibility metadata');
    });
  });

  // ── findCompatibleBackendsForPackage ──────────────────────────────────

  describe('findCompatibleBackendsForPackage', () => {
    it('returns empty when no metadata registered', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      expect(checker.findCompatibleBackendsForPackage('pkg_1')).toHaveLength(0);
    });

    it('filters by all criteria together', () => {
      backendRegistry.registerBackend(makeManifest('be_full', {
        supported_execution_types: ['shell_command', 'script_run'],
        supported_capabilities: ['shell_command', 'docker'],
        trust_level: 'trusted',
        backend_type: 'container',
        health_status: 'healthy',
      }));
      backendRegistry.registerBackend(makeManifest('be_partial', {
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['shell_command'],
        trust_level: 'restricted',
        backend_type: 'ssh',
      }));

      checker.registerMetadata(makeMeta('pkg_1', {
        required_execution_types: ['shell_command', 'script_run'],
        required_capabilities: ['docker'],
        minimum_trust_level: 'trusted',
        compatible_backend_types: ['container'],
      }));

      const backends = checker.findCompatibleBackendsForPackage('pkg_1', 'ws_1');
      expect(backends).toHaveLength(1);
      expect(backends[0].backend_id).toBe('be_full');
    });
  });

  // ── Runtime Events ────────────────────────────────────────────────────

  describe('runtime events', () => {
    it('emits package.compatibility.satisfied on success', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));

      checker.validatePackageCompatibility('pkg_1', 'ws_1');

      const events = eventBus.getHistory().filter((e) => e.event === 'package.compatibility.satisfied');
      expect(events).toHaveLength(1);
    });

    it('emits package.compatibility.failed on failure', () => {
      checker.registerMetadata(makeMeta('pkg_1'));

      checker.validatePackageCompatibility('pkg_1', 'ws_1');

      const events = eventBus.getHistory().filter((e) => e.event === 'package.compatibility.failed');
      expect(events).toHaveLength(1);
    });

    it('emits package.compatibility.checked when no metadata exists', () => {
      checker.validatePackageCompatibility('pkg_no_meta', 'ws_1');

      const events = eventBus.getHistory().filter((e) => e.event === 'package.compatibility.checked');
      expect(events).toHaveLength(1);
    });
  });

  // ── Audit Entries ─────────────────────────────────────────────────────

  describe('audit entries', () => {
    it('appends audit entry on compatibility satisfied', () => {
      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));

      checker.validatePackageCompatibility('pkg_1', 'ws_1');

      const entries = auditLog.listByEventType('package.compatibility.satisfied');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('pkg_1');
      expect(entries[0].metadata?.compatible_backend_ids).toEqual(['be_1']);
    });

    it('appends audit entry on compatibility failed', () => {
      checker.registerMetadata(makeMeta('pkg_1'));

      checker.validatePackageCompatibility('pkg_1', 'ws_1');

      const entries = auditLog.listByEventType('package.compatibility.failed');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('pkg_1');
      expect((entries[0].metadata?.failure_reasons as string[]).length).toBeGreaterThan(0);
    });
  });

  // ── GhostMartInstaller Integration ────────────────────────────────────

  describe('GhostMartInstaller integration', () => {
    let installer: GhostMartInstaller;

    beforeEach(() => {
      installer = new GhostMartInstaller();
    });

    it('blocks install when no compatible backend exists', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      checker.registerMetadata(makeMeta('pkg_1', {
        required_execution_types: ['shell_command'],
      }));
      // No backends registered
      installer.setCompatibilityChecker(checker);

      expect(() => {
        installer.install('pkg_1', 'ws_1', 'operator_1');
      }).toThrow(/Cannot install package 'pkg_1'/);
    });

    it('blocks install when trust level is insufficient', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      backendRegistry.registerBackend(makeManifest('be_1', { trust_level: 'untrusted' }));
      checker.registerMetadata(makeMeta('pkg_1', { minimum_trust_level: 'trusted' }));
      installer.setCompatibilityChecker(checker);

      expect(() => {
        installer.install('pkg_1', 'ws_1', 'operator_1');
      }).toThrow(/Cannot install package 'pkg_1'/);
    });

    it('allows install when compatible backend exists', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));
      installer.setCompatibilityChecker(checker);

      const record = installer.install('pkg_1', 'ws_1', 'operator_1');
      expect(record.install_status).toBe('installed');
    });

    it('allows install when no compatibility metadata registered (no requirements)', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      // Checker set but no metadata for pkg_1
      installer.setCompatibilityChecker(checker);

      const record = installer.install('pkg_1', 'ws_1', 'operator_1');
      expect(record.install_status).toBe('installed');
    });

    it('allows install when no compatibility checker configured', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      // No checker set at all
      const record = installer.install('pkg_1', 'ws_1', 'operator_1');
      expect(record.install_status).toBe('installed');
    });

    it('blocks enable when backend becomes unavailable after install', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));
      installer.setCompatibilityChecker(checker);

      const record = installer.install('pkg_1', 'ws_1', 'operator_1');

      // Backend goes unavailable after install
      backendRegistry.updateBackend('be_1', { health_status: 'unavailable' });

      expect(() => {
        installer.enable(record.id);
      }).toThrow(/Cannot enable package 'pkg_1'/);
    });

    it('allows enable when backend is healthy', () => {
      const pkg = makePackage('pkg_1');
      installer.discover([pkg]);

      backendRegistry.registerBackend(makeManifest('be_1'));
      checker.registerMetadata(makeMeta('pkg_1'));
      installer.setCompatibilityChecker(checker);

      const record = installer.install('pkg_1', 'ws_1', 'operator_1');
      const enabled = installer.enable(record.id);
      expect(enabled.install_status).toBe('enabled');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all metadata', () => {
      checker.registerMetadata(makeMeta('pkg_1'));
      checker.reset();
      expect(checker.getMetadata('pkg_1')).toBeUndefined();
    });
  });
});
