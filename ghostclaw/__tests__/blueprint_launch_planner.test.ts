import {
  BlueprintLaunchPlanner,
  type BlueprintLaunchPlan,
  type BlueprintLaunchStep,
  type BlueprintLaunchStepType,
} from '../packages/core/src/blueprint_launch_planner';
import { ghostMartPackageStore, type GhostMartPackage } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore, type WorkspaceInstallRecord } from '../packages/core/src/ghost_mart_workspace_install';
import { WorkerBackendRegistry, type WorkerBackendManifest } from '../packages/core/src/worker_backend_manifest';
import { BlueprintLaunchReadinessChecker } from '../packages/core/src/blueprint_launch_readiness';
import { auditLog, type AuditLogEntry } from '../packages/core/src/audit_log';
import { eventBus } from '../packages/core/src/event_bus';

// ── Test helpers ────────────────────────────────────────────────────────────

const NOW = 1700000000000;

function makePackage(overrides: Partial<GhostMartPackage> & { package_id: string }): GhostMartPackage {
  return {
    name: overrides.package_id,
    version: '1.0.0',
    package_type: 'skill',
    description: `Test package ${overrides.package_id}`,
    author: 'test',
    dependencies: [],
    permissions_required: [],
    workspace_scope: '*',
    install_status: 'available',
    category: 'test',
    capabilities: [],
    inputs: [],
    outputs: [],
    install_command: `install ${overrides.package_id}`,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeInstallRecord(
  workspaceId: string,
  packageId: string,
  status: WorkspaceInstallRecord['install_status'] = 'enabled',
): WorkspaceInstallRecord {
  return {
    id: `install_${workspaceId}_${packageId}`,
    workspace_id: workspaceId,
    package_id: packageId,
    install_status: status,
    installed_at: NOW,
    installed_by: 'test',
    enabled_at: status === 'enabled' ? NOW : null,
    disabled_at: null,
    uninstalled_at: null,
    updated_at: NOW,
    config: {},
  };
}

function makeBackend(overrides: Partial<WorkerBackendManifest> & { backend_id: string }): WorkerBackendManifest {
  return {
    backend_name: overrides.backend_id,
    backend_type: 'default',
    supported_execution_types: ['shell_command'],
    supported_capabilities: [],
    workspace_scope: null,
    trust_level: 'trusted',
    max_concurrency: 10,
    health_status: 'healthy',
    requires_approval: false,
    provider_class: 'TestProvider',
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('BlueprintLaunchPlanner', () => {
  let backendRegistry: WorkerBackendRegistry;
  let planner: BlueprintLaunchPlanner;

  beforeEach(() => {
    ghostMartPackageStore.reset();
    workspaceInstallStore.reset();
    auditLog.reset();
    backendRegistry = new WorkerBackendRegistry();
    planner = new BlueprintLaunchPlanner(backendRegistry);
    // Reset ID counters by creating a fresh planner
    planner.reset();
  });

  // ── Basic plan creation ─────────────────────────────────────────────────

  describe('createLaunchPlan', () => {
    it('should return a plan with readiness failure when blueprint is not found', () => {
      const plan = planner.createLaunchPlan('nonexistent', 'ws_1');

      expect(plan.blueprint_id).toBe('nonexistent');
      expect(plan.workspace_id).toBe('ws_1');
      expect(plan.readiness_passed).toBe(false);
      expect(plan.readiness_failures).toEqual([
        "Blueprint 'nonexistent' not found in package store.",
      ]);
      expect(plan.steps).toEqual([]);
      expect(plan.estimated_jobs).toBe(0);
    });

    it('should return a plan with readiness failure when package is not a blueprint', () => {
      ghostMartPackageStore.create(makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
      }));

      const plan = planner.createLaunchPlan('skill_a', 'ws_1');

      expect(plan.readiness_passed).toBe(false);
      expect(plan.readiness_failures[0]).toContain("type 'skill', not 'blueprint'");
      expect(plan.steps).toEqual([]);
    });

    it('should create a plan with install steps for missing packages', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', dependencies: ['skill_a'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      expect(plan.readiness_passed).toBe(true);
      expect(plan.required_packages).toContain('skill_a');
      expect(plan.required_packages).toContain('agent_a');

      const installSteps = plan.steps.filter((s) => s.step_type === 'install_package');
      expect(installSteps.length).toBe(2);
      // Skills should come before agents
      expect(installSteps[0].package_id).toBe('skill_a');
      expect(installSteps[1].package_id).toBe('agent_a');
    });

    it('should skip install steps for already-installed packages', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_a', 'enabled'));

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const installSteps = plan.steps.filter((s) => s.step_type === 'install_package');
      expect(installSteps.length).toBe(0);
    });

    it('should create enable steps for installed-but-not-enabled packages', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_a', 'disabled'));

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const enableSteps = plan.steps.filter((s) => s.step_type === 'enable_package');
      expect(enableSteps.length).toBe(1);
      expect(enableSteps[0].package_id).toBe('skill_a');
    });

    it('should create agent steps for agent-type packages', () => {
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', capabilities: ['cap_1'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const agentSteps = plan.steps.filter((s) => s.step_type === 'create_agent');
      expect(agentSteps.length).toBe(1);
      expect(agentSteps[0].package_id).toBe('agent_a');
      expect(agentSteps[0].required_capabilities).toEqual(['cap_1']);
    });

    it('should always include workspace resource, memory, and signal steps', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief', 'target'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const resourceSteps = plan.steps.filter((s) => s.step_type === 'initialize_workspace_resource');
      const memorySteps = plan.steps.filter((s) => s.step_type === 'initialize_memory');
      const signalSteps = plan.steps.filter((s) => s.step_type === 'seed_signal');

      expect(resourceSteps.length).toBe(1);
      expect(memorySteps.length).toBe(1);
      expect(signalSteps.length).toBe(1);
      expect(signalSteps[0].description).toContain('brief, target');
    });

    it('should compute estimated_jobs as sum of all step jobs_to_create', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      // 2 install + 1 create_agent + 1 workspace + 1 memory + 1 signal = 6
      expect(plan.estimated_jobs).toBe(plan.steps.length);
      expect(plan.estimated_jobs).toBe(6);
    });
  });

  // ── Step ordering ───────────────────────────────────────────────────────

  describe('step ordering', () => {
    it('should order steps: install → enable → create_agent → workspace → memory → signal', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const skillB = makePackage({ package_id: 'skill_b', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', dependencies: ['skill_a'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'skill_b', 'agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(skillB);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      // skill_a is installed but disabled, skill_b is not installed, agent_a is not installed
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_a', 'disabled'));

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const typeOrder = plan.steps.map((s) => s.step_type);

      // install_package should come before enable_package
      const installIdx = typeOrder.indexOf('install_package');
      const enableIdx = typeOrder.indexOf('enable_package');
      const agentIdx = typeOrder.indexOf('create_agent');
      const resourceIdx = typeOrder.indexOf('initialize_workspace_resource');
      const memoryIdx = typeOrder.indexOf('initialize_memory');
      const signalIdx = typeOrder.indexOf('seed_signal');

      expect(installIdx).toBeLessThan(enableIdx);
      expect(enableIdx).toBeLessThan(agentIdx);
      expect(agentIdx).toBeLessThan(resourceIdx);
      expect(resourceIdx).toBeLessThan(memoryIdx);
      expect(memoryIdx).toBeLessThan(signalIdx);
    });

    it('should install skills before agents', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a', 'skill_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const installSteps = plan.steps.filter((s) => s.step_type === 'install_package');
      expect(installSteps[0].package_id).toBe('skill_a');
      expect(installSteps[1].package_id).toBe('agent_a');
    });
  });

  // ── Dependency resolution ─────────────────────────────────────────────

  describe('dependency resolution', () => {
    it('should collect transitive dependencies in topological order', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const skillB = makePackage({ package_id: 'skill_b', package_type: 'skill', dependencies: ['skill_a'] });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', dependencies: ['skill_b'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(skillB);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      // Should include all transitive deps
      expect(plan.required_packages).toEqual(['skill_a', 'skill_b', 'agent_a']);

      const installSteps = plan.steps.filter((s) => s.step_type === 'install_package');
      // skill_a before skill_b before agent_a (topological + type ordering)
      const installIds = installSteps.map((s) => s.package_id);
      expect(installIds.indexOf('skill_a')).toBeLessThan(installIds.indexOf('skill_b'));
    });

    it('should handle missing transitive dependencies gracefully', () => {
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', dependencies: ['skill_missing'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      // Should still include agent_a even though skill_missing isn't in the store
      expect(plan.required_packages).toContain('agent_a');
      expect(plan.required_packages).not.toContain('skill_missing');
    });

    it('should not duplicate packages in required_packages', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent', dependencies: ['skill_a'] });
      const agentB = makePackage({ package_id: 'agent_b', package_type: 'agent', dependencies: ['skill_a'] });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a', 'agent_b', 'skill_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(agentB);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const skillACount = plan.required_packages.filter((p) => p === 'skill_a').length;
      expect(skillACount).toBe(1);
    });
  });

  // ── Backend integration ─────────────────────────────────────────────────

  describe('backend integration', () => {
    it('should include compatible backends in the plan', () => {
      const backend = makeBackend({ backend_id: 'be_1' });
      backendRegistry.registerBackend(backend);

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      expect(plan.required_backends.length).toBe(1);
      expect(plan.required_backends[0].backend_id).toBe('be_1');
    });

    it('should exclude unavailable backends', () => {
      backendRegistry.registerBackend(makeBackend({ backend_id: 'be_1', health_status: 'unavailable' }));
      backendRegistry.registerBackend(makeBackend({ backend_id: 'be_2', health_status: 'healthy' }));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      expect(plan.required_backends.length).toBe(1);
      expect(plan.required_backends[0].backend_id).toBe('be_2');
    });

    it('should exclude backends scoped to other workspaces', () => {
      backendRegistry.registerBackend(makeBackend({ backend_id: 'be_1', workspace_scope: ['ws_2'] }));
      backendRegistry.registerBackend(makeBackend({ backend_id: 'be_2', workspace_scope: null }));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      expect(plan.required_backends.length).toBe(1);
      expect(plan.required_backends[0].backend_id).toBe('be_2');
    });
  });

  // ── Readiness checker integration ─────────────────────────────────────

  describe('readiness checker integration', () => {
    it('should reflect readiness check results when checker is provided', () => {
      const readinessChecker = new BlueprintLaunchReadinessChecker(backendRegistry);
      const plannerWithChecker = new BlueprintLaunchPlanner(backendRegistry, readinessChecker);
      plannerWithChecker.reset();

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_missing'],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = plannerWithChecker.createLaunchPlan('bp_1', 'ws_1');

      // Readiness checker will report missing package
      expect(plan.readiness_passed).toBe(false);
      expect(plan.readiness_failures.length).toBeGreaterThan(0);
      // Plan should still be generated with steps
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should pass readiness when all requirements are met', () => {
      const readinessChecker = new BlueprintLaunchReadinessChecker(backendRegistry);
      const plannerWithChecker = new BlueprintLaunchPlanner(backendRegistry, readinessChecker);
      plannerWithChecker.reset();

      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_a', 'enabled'));

      const plan = plannerWithChecker.createLaunchPlan('bp_1', 'ws_1');

      expect(plan.readiness_passed).toBe(true);
      expect(plan.readiness_failures).toEqual([]);
    });
  });

  // ── Events and audit ──────────────────────────────────────────────────

  describe('events and audit', () => {
    it('should emit blueprint.launch_plan.created event', () => {
      const events: BlueprintLaunchPlan[] = [];
      eventBus.on('blueprint.launch_plan.created', (plan) => events.push(plan));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      planner.createLaunchPlan('bp_1', 'ws_1');

      expect(events.length).toBe(1);
      expect(events[0].blueprint_id).toBe('bp_1');
    });

    it('should append audit log entry on plan creation', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      planner.createLaunchPlan('bp_1', 'ws_1');

      const entries = auditLog.listByEventType('blueprint.launch_plan.created');
      expect(entries.length).toBe(1);
      expect(entries[0].objectType).toBe('BlueprintLaunchPlan');
      expect(entries[0].actorId).toBe('blueprint-launch-planner');
      expect(entries[0].summary).toContain('bp_1');
    });

    it('should include readiness failure in audit summary when plan fails readiness', () => {
      const plan = planner.createLaunchPlan('nonexistent', 'ws_1');

      const entries = auditLog.listByEventType('blueprint.launch_plan.created');
      expect(entries.length).toBe(1);
      expect(entries[0].summary).toContain('readiness failures');
    });
  });

  // ── Helper methods ────────────────────────────────────────────────────

  describe('helper methods', () => {
    it('getSteps should return a copy of plan steps', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');
      const steps = planner.getSteps(plan);

      expect(steps).toEqual(plan.steps);
      expect(steps).not.toBe(plan.steps); // different array reference
    });

    it('getStepsByType should filter steps by type', () => {
      const skillA = makePackage({ package_id: 'skill_a', package_type: 'skill' });
      const agentA = makePackage({ package_id: 'agent_a', package_type: 'agent' });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'agent_a'],
        inputs: ['brief'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      const installSteps = planner.getStepsByType(plan, 'install_package');
      const agentSteps = planner.getStepsByType(plan, 'create_agent');
      const signalSteps = planner.getStepsByType(plan, 'seed_signal');

      expect(installSteps.length).toBe(2);
      expect(agentSteps.length).toBe(1);
      expect(signalSteps.length).toBe(1);
    });
  });

  // ── Full blueprint scenario ───────────────────────────────────────────

  describe('full blueprint scenario', () => {
    it('should produce a complete plan for a realistic blueprint', () => {
      // Set up the SEO agency blueprint scenario
      const skillKeyword = makePackage({
        package_id: 'skill_keyword_research',
        package_type: 'skill',
        capabilities: ['research_keyword_cluster'],
      });
      const skillSeo = makePackage({
        package_id: 'skill_seo_audit',
        package_type: 'skill',
        capabilities: ['run_seo_audit'],
      });
      const skillContent = makePackage({
        package_id: 'skill_content_generation',
        package_type: 'skill',
        dependencies: ['skill_keyword_research'],
        capabilities: ['write_article'],
      });
      const agentSeoCeo = makePackage({
        package_id: 'agent_seo_ceo',
        package_type: 'agent',
        dependencies: ['skill_keyword_research', 'skill_seo_audit'],
        capabilities: ['generate_seo_strategy'],
      });
      const agentWriter = makePackage({
        package_id: 'agent_content_writer',
        package_type: 'agent',
        dependencies: ['skill_content_generation'],
        capabilities: ['write_article', 'draft_cluster_outline'],
      });
      const blueprint = makePackage({
        package_id: 'blueprint_ai_seo_agency',
        package_type: 'blueprint',
        dependencies: [
          'agent_seo_ceo',
          'agent_content_writer',
          'skill_keyword_research',
          'skill_seo_audit',
          'skill_content_generation',
        ],
        inputs: ['company_brief', 'target_market', 'brand_guidelines'],
      });

      ghostMartPackageStore.create(skillKeyword);
      ghostMartPackageStore.create(skillSeo);
      ghostMartPackageStore.create(skillContent);
      ghostMartPackageStore.create(agentSeoCeo);
      ghostMartPackageStore.create(agentWriter);
      ghostMartPackageStore.create(blueprint);

      // Some packages already installed
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_keyword_research', 'enabled'));
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_seo_audit', 'disabled'));

      backendRegistry.registerBackend(makeBackend({
        backend_id: 'be_1',
        supported_execution_types: ['shell_command'],
        supported_capabilities: ['research_keyword_cluster', 'run_seo_audit', 'write_article'],
      }));

      const plan = planner.createLaunchPlan('blueprint_ai_seo_agency', 'ws_1');

      expect(plan.readiness_passed).toBe(true);
      expect(plan.required_packages.length).toBe(5);
      expect(plan.required_backends.length).toBe(1);

      // Install: skill_content_generation (skill, not installed), agent_seo_ceo, agent_content_writer (agents, not installed)
      const installSteps = planner.getStepsByType(plan, 'install_package');
      const installIds = installSteps.map((s) => s.package_id);
      expect(installIds).toContain('skill_content_generation');
      expect(installIds).toContain('agent_seo_ceo');
      expect(installIds).toContain('agent_content_writer');
      // skill_keyword_research already enabled, should not be in install
      expect(installIds).not.toContain('skill_keyword_research');

      // Enable: skill_seo_audit (installed but disabled)
      const enableSteps = planner.getStepsByType(plan, 'enable_package');
      expect(enableSteps.length).toBe(1);
      expect(enableSteps[0].package_id).toBe('skill_seo_audit');

      // Create agents: both agents
      const agentSteps = planner.getStepsByType(plan, 'create_agent');
      expect(agentSteps.length).toBe(2);
      const agentIds = agentSteps.map((s) => s.package_id);
      expect(agentIds).toContain('agent_seo_ceo');
      expect(agentIds).toContain('agent_content_writer');

      // Seed signal
      const signalSteps = planner.getStepsByType(plan, 'seed_signal');
      expect(signalSteps.length).toBe(1);
      expect(signalSteps[0].description).toContain('company_brief');
      expect(signalSteps[0].description).toContain('target_market');
      expect(signalSteps[0].description).toContain('brand_guidelines');

      // Total
      expect(plan.estimated_jobs).toBe(plan.steps.length);
    });
  });
});
