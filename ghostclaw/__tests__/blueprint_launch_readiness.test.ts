import { BlueprintLaunchReadinessChecker } from '../packages/core/src/blueprint_launch_readiness';
import type { BlueprintLaunchMetadata } from '../packages/core/src/blueprint_launch_readiness';
import { PackageCompatibilityChecker } from '../packages/core/src/package_compatibility';
import { WorkerBackendRegistry } from '../packages/core/src/worker_backend_manifest';
import type { WorkerBackendManifest } from '../packages/core/src/worker_backend_manifest';
import { ghostMartPackageStore } from '../packages/core/src/ghost_mart_package';
import type { GhostMartPackage } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore } from '../packages/core/src/ghost_mart_workspace_install';
import type { WorkspaceInstallRecord } from '../packages/core/src/ghost_mart_workspace_install';
import { workspacePolicyStore } from '../packages/core/src/workspace_policy';
import type { WorkspacePolicy } from '../packages/core/src/workspace_policy';
import { eventBus } from '../packages/core/src/event_bus';
import { auditLog } from '../packages/core/src/audit_log';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeBackend(id: string, overrides: Partial<WorkerBackendManifest> = {}): WorkerBackendManifest {
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

function makeBlueprint(id: string, deps: string[], overrides: Partial<GhostMartPackage> = {}): GhostMartPackage {
  return makePackage(id, {
    package_type: 'blueprint',
    dependencies: deps,
    category: 'automation',
    ...overrides,
  });
}

function makeInstallRecord(
  packageId: string,
  workspaceId: string,
  overrides: Partial<WorkspaceInstallRecord> = {},
): WorkspaceInstallRecord {
  return {
    id: `install_${packageId}_${workspaceId}`,
    workspace_id: workspaceId,
    package_id: packageId,
    install_status: 'enabled',
    installed_at: Date.now(),
    installed_by: 'test',
    enabled_at: Date.now(),
    disabled_at: null,
    uninstalled_at: null,
    updated_at: Date.now(),
    config: {},
    ...overrides,
  };
}

function makeLaunchMeta(blueprintId: string, overrides: Partial<BlueprintLaunchMetadata> = {}): BlueprintLaunchMetadata {
  return {
    blueprint_id: blueprintId,
    required_execution_types: ['shell_command'],
    required_capabilities: [],
    minimum_trust_level: 'trusted',
    requires_approval: false,
    compatible_backend_types: [],
    required_config_keys: [],
    required_secret_keys: [],
    required_policy_types: [],
    ...overrides,
  };
}

function makePolicy(id: string, workspaceId: string, overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    id,
    workspaceId,
    policyType: 'execution',
    name: `policy-${id}`,
    description: 'Test policy',
    rules: {},
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BlueprintLaunchReadiness', () => {
  let backendRegistry: WorkerBackendRegistry;
  let checker: BlueprintLaunchReadinessChecker;

  beforeEach(() => {
    backendRegistry = new WorkerBackendRegistry();
    checker = new BlueprintLaunchReadinessChecker(backendRegistry);
    ghostMartPackageStore.reset();
    workspaceInstallStore.reset();
    workspacePolicyStore.reset();
    eventBus.reset();
    auditLog.reset();
  });

  // ── Missing Package ───────────────────────────────────────────────────

  describe('missing package', () => {
    it('fails when blueprint is not in package store', () => {
      const result = checker.validateBlueprintLaunchReadiness('bp_unknown', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements).toHaveLength(1);
      expect(result.missing_requirements[0].category).toBe('package');
      expect(result.missing_requirements[0].description).toContain('not found');
    });

    it('fails when package is not a blueprint type', () => {
      ghostMartPackageStore.create(makePackage('pkg_skill', { package_type: 'skill' }));

      const result = checker.validateBlueprintLaunchReadiness('pkg_skill', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements[0].description).toContain("not 'blueprint'");
    });

    it('fails when a required dependency package is missing from store', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_missing']));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'package' && m.description.includes('dep_missing'),
      )).toBe(true);
    });

    it('fails when a required dependency is not installed in workspace', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_1']));
      ghostMartPackageStore.create(makePackage('dep_1'));
      // dep_1 exists in store but no install record for ws_1

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'package' && m.description.includes('not installed'),
      )).toBe(true);
    });
  });

  // ── Disabled Package ──────────────────────────────────────────────────

  describe('disabled package', () => {
    it('fails when a required dependency is installed but not enabled', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_1']));
      ghostMartPackageStore.create(makePackage('dep_1'));
      workspaceInstallStore.create(makeInstallRecord('dep_1', 'ws_1', {
        install_status: 'installed',
        enabled_at: null,
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'package' && m.description.includes('not enabled'),
      )).toBe(true);
    });

    it('fails when a required dependency is disabled', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_1']));
      ghostMartPackageStore.create(makePackage('dep_1'));
      workspaceInstallStore.create(makeInstallRecord('dep_1', 'ws_1', {
        install_status: 'disabled',
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.description.includes("status: 'disabled'"),
      )).toBe(true);
    });
  });

  // ── Missing Backend Capability ────────────────────────────────────────

  describe('missing backend capability', () => {
    it('fails when no backend supports required execution type', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', {
        supported_execution_types: ['patch_apply'],
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_execution_types: ['shell_command'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'backend' && m.description.includes("execution type 'shell_command'"),
      )).toBe(true);
    });

    it('fails when no backend supports required capability', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', {
        supported_capabilities: ['shell_command'],
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_capabilities: ['docker'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'backend' && m.description.includes("capability 'docker'"),
      )).toBe(true);
    });

    it('fails when no backends are available for the workspace', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', {
        workspace_scope: ['ws_other'],
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_execution_types: ['shell_command'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'backend',
      )).toBe(true);
    });

    it('fails when backend type is incompatible', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', { backend_type: 'ssh' }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        compatible_backend_types: ['container'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'backend' && m.description.includes('compatible types'),
      )).toBe(true);
    });
  });

  // ── Insufficient Trust Level ──────────────────────────────────────────

  describe('insufficient trust level', () => {
    it('fails when no backend meets minimum trust level', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', { trust_level: 'untrusted' }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        minimum_trust_level: 'trusted',
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'trust' && m.description.includes("trust level 'trusted'"),
      )).toBe(true);
    });

    it('passes when backend trust meets requirement', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', { trust_level: 'trusted' }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        minimum_trust_level: 'restricted',
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      // No trust-related failures
      expect(result.missing_requirements.filter((m) => m.category === 'trust')).toHaveLength(0);
    });
  });

  // ── Workspace Mismatch ────────────────────────────────────────────────

  describe('workspace mismatch', () => {
    it('fails when backend only serves a different workspace', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', {
        workspace_scope: ['ws_2'],
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_execution_types: ['shell_command'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
    });

    it('passes when backend has global scope (null)', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', {
        workspace_scope: null,
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1'));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(true);
    });
  });

  // ── Missing Approval Requirement ──────────────────────────────────────

  describe('missing approval requirement', () => {
    it('fails when blueprint requires approval but no backend supports it', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', { requires_approval: false }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        requires_approval: true,
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'approval' && m.description.includes('approval'),
      )).toBe(true);
    });

    it('passes when backend supports approval', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1', { requires_approval: true }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        requires_approval: true,
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.missing_requirements.filter((m) => m.category === 'approval')).toHaveLength(0);
    });
  });

  // ── Policy Requirements ───────────────────────────────────────────────

  describe('policy requirements', () => {
    it('fails when required policy type is missing', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_policy_types: ['execution'],
      }));
      // No execution policy in ws_1

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'policy' && m.description.includes("'execution' policy"),
      )).toBe(true);
    });

    it('passes when required policy types are active', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      workspacePolicyStore.create(makePolicy('pol_1', 'ws_1', { policyType: 'execution' }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_policy_types: ['execution'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.missing_requirements.filter((m) => m.category === 'policy')).toHaveLength(0);
    });

    it('fails when policy exists but is inactive', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      workspacePolicyStore.create(makePolicy('pol_1', 'ws_1', {
        policyType: 'safety',
        status: 'inactive',
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_policy_types: ['safety'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'policy' && m.description.includes("'safety'"),
      )).toBe(true);
    });
  });

  // ── Config / Secret Requirements ──────────────────────────────────────

  describe('config and secret requirements', () => {
    it('fails when required config key is missing', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      workspaceInstallStore.create(makeInstallRecord('bp_1', 'ws_1', { config: {} }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_config_keys: ['api_endpoint'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'config' && m.description.includes("'api_endpoint'"),
      )).toBe(true);
    });

    it('fails when required secret is missing', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      workspaceInstallStore.create(makeInstallRecord('bp_1', 'ws_1', { config: {} }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_secret_keys: ['api_key'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'secret' && m.description.includes("'api_key'"),
      )).toBe(true);
    });

    it('passes when required config and secrets are present', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      workspaceInstallStore.create(makeInstallRecord('bp_1', 'ws_1', {
        config: { api_endpoint: 'https://example.com', api_key: 'secret123' },
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_config_keys: ['api_endpoint'],
        required_secret_keys: ['api_key'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.missing_requirements.filter(
        (m) => m.category === 'config' || m.category === 'secret',
      )).toHaveLength(0);
    });
  });

  // ── Launch-Ready Blueprint ────────────────────────────────────────────

  describe('launch-ready blueprint', () => {
    it('passes when all requirements are met', () => {
      // Blueprint with two dependencies
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_a', 'dep_b']));
      ghostMartPackageStore.create(makePackage('dep_a'));
      ghostMartPackageStore.create(makePackage('dep_b'));

      // Both deps installed and enabled
      workspaceInstallStore.create(makeInstallRecord('dep_a', 'ws_1'));
      workspaceInstallStore.create(makeInstallRecord('dep_b', 'ws_1'));

      // Blueprint install record with config
      workspaceInstallStore.create(makeInstallRecord('bp_1', 'ws_1', {
        config: { company_brief: 'Test Corp' },
      }));

      // Backend available
      backendRegistry.registerBackend(makeBackend('be_1'));

      // Policy in place
      workspacePolicyStore.create(makePolicy('pol_1', 'ws_1', { policyType: 'execution' }));

      // Metadata
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        required_config_keys: ['company_brief'],
        required_policy_types: ['execution'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(true);
      expect(result.missing_requirements).toHaveLength(0);
      expect(result.compatible_backends).toHaveLength(1);
    });

    it('passes with no metadata (no extra requirements beyond packages)', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_a']));
      ghostMartPackageStore.create(makePackage('dep_a'));
      workspaceInstallStore.create(makeInstallRecord('dep_a', 'ws_1'));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(true);
    });
  });

  // ── Per-Package Backend Compatibility ─────────────────────────────────

  describe('per-package compatibility (with PackageCompatibilityChecker)', () => {
    it('catches per-dependency backend incompatibility', () => {
      const compatChecker = new PackageCompatibilityChecker(backendRegistry);
      checker = new BlueprintLaunchReadinessChecker(backendRegistry, compatChecker);

      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_1']));
      ghostMartPackageStore.create(makePackage('dep_1'));
      workspaceInstallStore.create(makeInstallRecord('dep_1', 'ws_1'));

      // Register compatibility metadata that requires docker
      compatChecker.registerMetadata({
        package_id: 'dep_1',
        required_execution_types: ['shell_command'],
        required_capabilities: ['docker'],
        minimum_trust_level: 'trusted',
        requires_approval: false,
        compatible_backend_types: [],
        workspace_scope_constraints: null,
      });

      // Backend does NOT support docker
      backendRegistry.registerBackend(makeBackend('be_1', {
        supported_capabilities: ['shell_command'],
      }));

      const result = checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      expect(result.ready).toBe(false);
      expect(result.missing_requirements.some(
        (m) => m.category === 'backend' && m.description.includes('dep_1'),
      )).toBe(true);
    });
  });

  // ── Operator-Facing Explanations ──────────────────────────────────────

  describe('explainBlueprintLaunchFailure', () => {
    it('returns human-readable explanations for all failure categories', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_missing']));
      backendRegistry.registerBackend(makeBackend('be_1', { trust_level: 'untrusted' }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        minimum_trust_level: 'trusted',
        required_capabilities: ['kubernetes'],
        required_policy_types: ['safety'],
        required_config_keys: ['endpoint'],
      }));

      const reasons = checker.explainBlueprintLaunchFailure('bp_1', 'ws_1');

      expect(reasons.length).toBeGreaterThan(0);
      // Should have package, backend, trust, policy, config issues
      expect(reasons.some((r) => r.includes('dep_missing'))).toBe(true);
      expect(reasons.some((r) => r.includes('kubernetes'))).toBe(true);
      expect(reasons.some((r) => r.includes('trust level'))).toBe(true);
      expect(reasons.some((r) => r.includes('safety'))).toBe(true);
      expect(reasons.some((r) => r.includes('endpoint'))).toBe(true);
    });

    it('returns empty array when blueprint is launch-ready', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));

      const reasons = checker.explainBlueprintLaunchFailure('bp_1', 'ws_1');
      expect(reasons).toHaveLength(0);
    });
  });

  // ── listMissingRequirementsForBlueprint ───────────────────────────────

  describe('listMissingRequirementsForBlueprint', () => {
    it('categorizes requirements correctly', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', ['dep_1']));
      ghostMartPackageStore.create(makePackage('dep_1'));
      // dep_1 not installed

      backendRegistry.registerBackend(makeBackend('be_1', {
        trust_level: 'untrusted',
        requires_approval: false,
      }));
      checker.registerMetadata(makeLaunchMeta('bp_1', {
        minimum_trust_level: 'trusted',
        requires_approval: true,
        required_secret_keys: ['api_key'],
      }));

      const missing = checker.listMissingRequirementsForBlueprint('bp_1', 'ws_1');

      const categories = missing.map((m) => m.category);
      expect(categories).toContain('package');
      expect(categories).toContain('trust');
      expect(categories).toContain('approval');
      expect(categories).toContain('secret');
    });
  });

  // ── Runtime Events ────────────────────────────────────────────────────

  describe('runtime events', () => {
    it('emits blueprint.launch_readiness.satisfied when ready', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));

      checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      const events = eventBus.getHistory().filter(
        (e) => e.event === 'blueprint.launch_readiness.satisfied',
      );
      expect(events).toHaveLength(1);
    });

    it('emits blueprint.launch_readiness.failed when not ready', () => {
      checker.validateBlueprintLaunchReadiness('bp_missing', 'ws_1');

      const events = eventBus.getHistory().filter(
        (e) => e.event === 'blueprint.launch_readiness.failed',
      );
      expect(events).toHaveLength(1);
    });
  });

  // ── Audit Entries ─────────────────────────────────────────────────────

  describe('audit entries', () => {
    it('appends audit entry on satisfied', () => {
      ghostMartPackageStore.create(makeBlueprint('bp_1', []));
      backendRegistry.registerBackend(makeBackend('be_1'));
      checker.registerMetadata(makeLaunchMeta('bp_1'));

      checker.validateBlueprintLaunchReadiness('bp_1', 'ws_1');

      const entries = auditLog.listByEventType('blueprint.launch_readiness.satisfied');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('bp_1');
      expect(entries[0].workspaceId).toBe('ws_1');
    });

    it('appends audit entry on failed with failure metadata', () => {
      checker.validateBlueprintLaunchReadiness('bp_missing', 'ws_1');

      const entries = auditLog.listByEventType('blueprint.launch_readiness.failed');
      expect(entries).toHaveLength(1);
      expect(entries[0].objectId).toBe('bp_missing');
      expect((entries[0].metadata?.missing_count as number)).toBeGreaterThan(0);
      expect((entries[0].metadata?.categories as string[])).toContain('package');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all metadata', () => {
      checker.registerMetadata(makeLaunchMeta('bp_1'));
      checker.reset();
      expect(checker.getMetadata('bp_1')).toBeUndefined();
    });
  });
});
