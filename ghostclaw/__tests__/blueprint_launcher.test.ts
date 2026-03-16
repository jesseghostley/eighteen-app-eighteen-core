import {
  BlueprintLauncher,
  type BlueprintLaunchExecution,
  type BlueprintLaunchStepExecution,
} from '../packages/core/src/blueprint_launcher';
import {
  BlueprintLaunchPlanner,
  type BlueprintLaunchPlan,
  type BlueprintLaunchStep,
} from '../packages/core/src/blueprint_launch_planner';
import { ghostMartPackageStore, type GhostMartPackage } from '../packages/core/src/ghost_mart_package';
import { workspaceInstallStore, type WorkspaceInstallRecord } from '../packages/core/src/ghost_mart_workspace_install';
import { WorkerBackendRegistry, type WorkerBackendManifest } from '../packages/core/src/worker_backend_manifest';
import { ghostMartInstaller } from '../packages/core/src/ghost_mart_installer';
import { auditLog } from '../packages/core/src/audit_log';
import { eventBus } from '../packages/core/src/event_bus';
import { jobQueue } from '../packages/core/src/job_queue';
import { runtimeStore } from '../packages/core/src/runtime_loop';
import { workspacePolicyStore, type WorkspacePolicy } from '../packages/core/src/workspace_policy';

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
    permissions_required: ['skill_registry.write', 'event_bus.emit'],
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

/**
 * Create a simple plan using the planner for test consumption.
 */
function createTestPlan(
  blueprintId: string,
  workspaceId: string,
  planner: BlueprintLaunchPlanner,
): BlueprintLaunchPlan {
  return planner.createLaunchPlan(blueprintId, workspaceId);
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('BlueprintLauncher', () => {
  let backendRegistry: WorkerBackendRegistry;
  let planner: BlueprintLaunchPlanner;
  let launcher: BlueprintLauncher;

  beforeEach(() => {
    ghostMartPackageStore.reset();
    workspaceInstallStore.reset();
    workspacePolicyStore.reset();
    auditLog.reset();
    eventBus.reset();
    jobQueue.reset();
    runtimeStore.signals.length = 0;
    runtimeStore.plans.length = 0;
    runtimeStore.jobs.length = 0;

    backendRegistry = new WorkerBackendRegistry();
    planner = new BlueprintLaunchPlanner(backendRegistry);
    planner.reset();
    launcher = new BlueprintLauncher();
    launcher.reset();
  });

  // ── Successful launch ─────────────────────────────────────────────────

  describe('successful launch execution', () => {
    it('should create a launch execution record from a plan', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.launch_id).toBe(plan.launch_id);
      expect(execution.blueprint_id).toBe('bp_1');
      expect(execution.workspace_id).toBe('ws_1');
      expect(execution.status).toBe('completed');
      expect(execution.error).toBeNull();
      expect(execution.completed_at).not.toBeNull();
      expect(execution.total_steps).toBe(plan.steps.length);
      expect(execution.completed_steps).toBe(plan.steps.length);
    });

    it('should be retrievable after creation', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      launcher.executeLaunch(plan);

      const retrieved = launcher.getExecution(plan.launch_id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.launch_id).toBe(plan.launch_id);
    });

    it('should list all executions', () => {
      const bp1 = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      const bp2 = makePackage({
        package_id: 'bp_2',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(bp1);
      ghostMartPackageStore.create(bp2);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));
      launcher.executeLaunch(createTestPlan('bp_2', 'ws_1', planner));

      expect(launcher.listExecutions().length).toBe(2);
    });
  });

  // ── Step translation ──────────────────────────────────────────────────

  describe('step translation into runtime work', () => {
    it('should create jobs for install_package steps', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      // Should have created jobs
      expect(execution.all_created_job_ids.length).toBeGreaterThan(0);

      // Install step should have created a job
      const installStep = execution.step_executions.find(
        (s) => s.step_type === 'install_package',
      );
      expect(installStep).toBeDefined();
      expect(installStep!.created_job_ids.length).toBe(1);
      expect(installStep!.created_install_ids.length).toBe(1);
      expect(installStep!.status).toBe('completed');
    });

    it('should create jobs for enable_package steps', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);

      // Pre-install skill_a but leave it disabled
      workspaceInstallStore.create(makeInstallRecord('ws_1', 'skill_a', 'disabled'));

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      const enableStep = execution.step_executions.find(
        (s) => s.step_type === 'enable_package',
      );
      expect(enableStep).toBeDefined();
      expect(enableStep!.created_job_ids.length).toBe(1);
      expect(enableStep!.status).toBe('completed');
    });

    it('should create jobs for create_agent steps', () => {
      const agentA = makePackage({
        package_id: 'agent_a',
        package_type: 'agent',
        capabilities: ['cap_agent'],
        permissions_required: ['agent_registry.write', 'event_bus.emit'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['agent_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      const agentStep = execution.step_executions.find(
        (s) => s.step_type === 'create_agent',
      );
      expect(agentStep).toBeDefined();
      expect(agentStep!.created_job_ids.length).toBe(1);
      expect(agentStep!.status).toBe('completed');
    });

    it('should seed a signal for seed_signal steps', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      const signalStep = execution.step_executions.find(
        (s) => s.step_type === 'seed_signal',
      );
      expect(signalStep).toBeDefined();
      expect(signalStep!.created_signal_ids.length).toBe(1);
      expect(signalStep!.status).toBe('completed');

      // Signal should be in the runtime store
      const seededSignal = runtimeStore.signals.find(
        (s) => s.id === signalStep!.created_signal_ids[0],
      );
      expect(seededSignal).toBeDefined();
      expect(seededSignal!.name).toBe('blueprint.launch.bp_1');
      expect(seededSignal!.payload).toEqual({
        launch_id: plan.launch_id,
        blueprint_id: 'bp_1',
        workspace_id: 'ws_1',
      });
    });

    it('should create initialize_workspace_resource and initialize_memory jobs', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      const resourceStep = execution.step_executions.find(
        (s) => s.step_type === 'initialize_workspace_resource',
      );
      const memoryStep = execution.step_executions.find(
        (s) => s.step_type === 'initialize_memory',
      );

      expect(resourceStep).toBeDefined();
      expect(resourceStep!.status).toBe('completed');
      expect(resourceStep!.created_job_ids.length).toBe(1);

      expect(memoryStep).toBeDefined();
      expect(memoryStep!.status).toBe('completed');
      expect(memoryStep!.created_job_ids.length).toBe(1);
    });
  });

  // ── Step failure handling ─────────────────────────────────────────────

  describe('step failure handling', () => {
    it('should fail the launch when a step throws', () => {
      // Create a blueprint with a dependency that has unknown permissions
      // so the installer.install() will throw during validation
      const badSkill = makePackage({
        package_id: 'bad_skill',
        package_type: 'skill',
        dependencies: ['nonexistent_dep'],
        permissions_required: ['skill_registry.write'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['bad_skill'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(badSkill);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBeTruthy();
      expect(execution.completed_at).not.toBeNull();
    });

    it('should skip remaining steps when a step fails', () => {
      const badSkill = makePackage({
        package_id: 'bad_skill',
        package_type: 'skill',
        dependencies: ['nonexistent_dep'],
        permissions_required: ['skill_registry.write'],
      });
      const goodSkill = makePackage({
        package_id: 'good_skill',
        package_type: 'skill',
        capabilities: ['cap_good'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['bad_skill', 'good_skill'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(badSkill);
      ghostMartPackageStore.create(goodSkill);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.status).toBe('failed');

      // Steps after the failed one should be skipped
      const skippedSteps = execution.step_executions.filter(
        (s) => s.status === 'skipped',
      );
      expect(skippedSteps.length).toBeGreaterThan(0);

      // The seed_signal step should be skipped
      const signalStep = execution.step_executions.find(
        (s) => s.step_type === 'seed_signal',
      );
      expect(signalStep!.status).toBe('skipped');
    });

    it('should fail when enable_package has no install record', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);

      // Create a plan, then manually craft a scenario where
      // the plan has an enable step but no install record exists
      const plan = planner.createLaunchPlan('bp_1', 'ws_1');

      // Manually replace all steps with a single enable step for skill_a
      // (which has no install record)
      const enableOnlyPlan: BlueprintLaunchPlan = {
        ...plan,
        steps: [
          {
            step_id: 'step_enable_1',
            step_type: 'enable_package',
            description: 'Enable skill_a',
            package_id: 'skill_a',
            required_capabilities: [],
            jobs_to_create: 1,
          },
        ],
      };

      const execution = launcher.executeLaunch(enableOnlyPlan);

      expect(execution.status).toBe('failed');
      const enableStep = execution.step_executions.find(
        (s) => s.step_type === 'enable_package',
      );
      expect(enableStep!.status).toBe('failed');
      expect(enableStep!.error).toContain('No install record found');
    });
  });

  // ── Cancellation ──────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('should cancel a pending launch execution', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);

      // Execute the plan first to get it into the store
      const execution = launcher.executeLaunch(plan);

      // Since execution is synchronous and already completed, let's test the
      // cancellation path by manually creating an execution in running state
      // We'll use a plan that would have many steps and cancel mid-way
      // For now, test that cancelling a completed launch returns it unchanged
      const result = launcher.cancelLaunch(plan.launch_id);
      expect(result).toBeDefined();
      expect(result!.status).toBe('completed'); // Already completed, can't cancel
    });

    it('should return undefined for unknown launch_id', () => {
      const result = launcher.cancelLaunch('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should emit cancelled event when launch is cancelled', () => {
      const cancelledEvents: BlueprintLaunchExecution[] = [];
      eventBus.on('blueprint.launch.cancelled', (exec) => cancelledEvents.push(exec));

      // We need to test actual cancellation. Use the policy block approach
      // to create a launch that's in a cancellable state.
      // Actually, let's directly manipulate the execution state to test the cancel path:
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      // Execute — this will complete, but let's test cancel logic by
      // making a new launcher and injecting a running execution
      const launcher2 = new BlueprintLauncher();
      launcher2.reset();

      // Execute a plan with lots of steps, then check the cancel path works
      // Since the execution is synchronous, we test the code path by
      // creating a scenario where we launch and the execution gets stored
      const execution = launcher2.executeLaunch(plan);

      // Manually set back to running to test cancel path
      (execution as { status: string }).status = 'running';
      (execution as { completed_at: number | null }).completed_at = null;
      // Mark the last step as pending
      execution.step_executions[execution.step_executions.length - 1].status = 'pending';

      const cancelled = launcher2.cancelLaunch(plan.launch_id);
      expect(cancelled).toBeDefined();
      expect(cancelled!.status).toBe('cancelled');
      expect(cancelled!.completed_at).not.toBeNull();
      expect(cancelledEvents.length).toBe(1);

      // Pending steps should be skipped
      const skippedSteps = cancelled!.step_executions.filter(
        (s) => s.status === 'skipped',
      );
      expect(skippedSteps.length).toBeGreaterThan(0);
    });
  });

  // ── Workspace policy enforcement ──────────────────────────────────────

  describe('workspace policy enforcement', () => {
    it('should fail launch when workspace policy blocks blueprint launches', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      // Create a blocking policy
      workspacePolicyStore.create({
        id: 'policy_1',
        workspaceId: 'ws_1',
        policyType: 'execution',
        name: 'No Blueprint Launches',
        description: 'Blocks all blueprint launches',
        rules: { block_blueprint_launch: true },
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
        enforcementMode: 'block',
      });

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('blocks blueprint launches');
      expect(execution.step_executions.every((s) => s.status === 'pending')).toBe(true);
    });

    it('should allow launch when policy enforcement mode is not block', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      // Create a warn-only policy
      workspacePolicyStore.create({
        id: 'policy_1',
        workspaceId: 'ws_1',
        policyType: 'execution',
        name: 'Warn on Blueprint Launches',
        description: 'Warns about blueprint launches',
        rules: { block_blueprint_launch: true },
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
        enforcementMode: 'warn',
      });

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.status).toBe('completed');
    });
  });

  // ── Event and audit emission ──────────────────────────────────────────

  describe('event and audit emission', () => {
    it('should emit blueprint.launch.started event', () => {
      const events: BlueprintLaunchExecution[] = [];
      eventBus.on('blueprint.launch.started', (e) => events.push(e));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));

      expect(events.length).toBe(1);
      expect(events[0].blueprint_id).toBe('bp_1');
    });

    it('should emit blueprint.launch.completed event on success', () => {
      const events: BlueprintLaunchExecution[] = [];
      eventBus.on('blueprint.launch.completed', (e) => events.push(e));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));

      expect(events.length).toBe(1);
      expect(events[0].status).toBe('completed');
    });

    it('should emit blueprint.launch.failed event on failure', () => {
      const events: BlueprintLaunchExecution[] = [];
      eventBus.on('blueprint.launch.failed', (e) => events.push(e));

      // Create blocking policy
      workspacePolicyStore.create({
        id: 'policy_block',
        workspaceId: 'ws_1',
        policyType: 'execution',
        name: 'Block',
        description: 'Block',
        rules: { block_blueprint_launch: true },
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
        enforcementMode: 'block',
      });

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));

      expect(events.length).toBe(1);
      expect(events[0].status).toBe('failed');
    });

    it('should emit step-level events', () => {
      const stepStarted: Array<{ execution: BlueprintLaunchExecution; step: BlueprintLaunchStepExecution }> = [];
      const stepCompleted: Array<{ execution: BlueprintLaunchExecution; step: BlueprintLaunchStepExecution }> = [];
      eventBus.on('blueprint.launch.step.started', (e) => stepStarted.push(e));
      eventBus.on('blueprint.launch.step.completed', (e) => stepCompleted.push(e));

      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      launcher.executeLaunch(plan);

      // Should have step events for each step
      expect(stepStarted.length).toBe(plan.steps.length);
      expect(stepCompleted.length).toBe(plan.steps.length);
    });

    it('should emit step.failed event when a step fails', () => {
      const stepFailed: Array<{ execution: BlueprintLaunchExecution; step: BlueprintLaunchStepExecution }> = [];
      eventBus.on('blueprint.launch.step.failed', (e) => stepFailed.push(e));

      const badSkill = makePackage({
        package_id: 'bad_skill',
        package_type: 'skill',
        dependencies: ['nonexistent'],
        permissions_required: ['skill_registry.write'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['bad_skill'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(badSkill);
      ghostMartPackageStore.create(blueprint);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));

      expect(stepFailed.length).toBeGreaterThan(0);
      expect(stepFailed[0].step.status).toBe('failed');
    });

    it('should append audit log entries for launch lifecycle', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      launcher.executeLaunch(createTestPlan('bp_1', 'ws_1', planner));

      const startedEntries = auditLog.listByEventType('blueprint.launch.started');
      const completedEntries = auditLog.listByEventType('blueprint.launch.completed');

      expect(startedEntries.length).toBe(1);
      expect(completedEntries.length).toBe(1);
      expect(startedEntries[0].actorId).toBe('blueprint-launcher');
      expect(startedEntries[0].objectType).toBe('BlueprintLaunchExecution');
    });

    it('should append audit entries for step events', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      launcher.executeLaunch(plan);

      const stepStartedEntries = auditLog.listByEventType('blueprint.launch.step.started');
      const stepCompletedEntries = auditLog.listByEventType('blueprint.launch.step.completed');

      expect(stepStartedEntries.length).toBe(plan.steps.length);
      expect(stepCompletedEntries.length).toBe(plan.steps.length);
    });
  });

  // ── launch_id traceability ────────────────────────────────────────────

  describe('launch_id traceability', () => {
    it('should preserve launch_id in all created jobs', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      // Every created job should have launch_id in its input payload
      const allJobs = jobQueue.list();
      const launchJobs = allJobs.filter(
        (j) => execution.all_created_job_ids.includes(j.id),
      );

      expect(launchJobs.length).toBeGreaterThan(0);
      for (const job of launchJobs) {
        expect(job.inputPayload.launch_id).toBe(plan.launch_id);
      }
    });

    it('should preserve launch_id in seeded signals', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      // The seeded signal should carry the launch_id
      for (const signalId of execution.all_created_signal_ids) {
        const signal = runtimeStore.signals.find((s) => s.id === signalId);
        expect(signal).toBeDefined();
        expect(signal!.payload?.launch_id).toBe(plan.launch_id);
      }
    });

    it('should preserve launch_id in step executions', () => {
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: [],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      for (const stepExec of execution.step_executions) {
        expect(stepExec.launch_id).toBe(plan.launch_id);
      }
    });

    it('should aggregate all job and signal IDs in the execution record', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const agentA = makePackage({
        package_id: 'agent_a',
        package_type: 'agent',
        capabilities: ['cap_agent'],
        permissions_required: ['agent_registry.write', 'event_bus.emit'],
      });
      const blueprint = makePackage({
        package_id: 'bp_1',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'agent_a'],
        inputs: ['brief'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });
      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      const plan = createTestPlan('bp_1', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      // all_created_job_ids should match the sum of step-level job IDs
      const stepJobIds = execution.step_executions.flatMap((s) => s.created_job_ids);
      expect(execution.all_created_job_ids).toEqual(stepJobIds);

      // all_created_signal_ids should match step-level signal IDs
      const stepSignalIds = execution.step_executions.flatMap((s) => s.created_signal_ids);
      expect(execution.all_created_signal_ids).toEqual(stepSignalIds);
    });
  });

  // ── Full scenario ─────────────────────────────────────────────────────

  describe('full launch scenario', () => {
    it('should fully launch a blueprint with skills, agents, and signal', () => {
      const skillA = makePackage({
        package_id: 'skill_a',
        package_type: 'skill',
        capabilities: ['cap_a'],
      });
      const skillB = makePackage({
        package_id: 'skill_b',
        package_type: 'skill',
        dependencies: ['skill_a'],
        capabilities: ['cap_b'],
      });
      const agentA = makePackage({
        package_id: 'agent_a',
        package_type: 'agent',
        dependencies: ['skill_a'],
        capabilities: ['agent_cap'],
        permissions_required: ['agent_registry.write', 'event_bus.emit'],
      });
      const blueprint = makePackage({
        package_id: 'bp_full',
        package_type: 'blueprint',
        dependencies: ['skill_a', 'skill_b', 'agent_a'],
        inputs: ['company_brief', 'target_market'],
        permissions_required: ['blueprint.register', 'workspace.write'],
      });

      ghostMartPackageStore.create(skillA);
      ghostMartPackageStore.create(skillB);
      ghostMartPackageStore.create(agentA);
      ghostMartPackageStore.create(blueprint);

      backendRegistry.registerBackend(makeBackend({ backend_id: 'be_1' }));

      const plan = createTestPlan('bp_full', 'ws_1', planner);
      const execution = launcher.executeLaunch(plan);

      expect(execution.status).toBe('completed');
      expect(execution.error).toBeNull();
      expect(execution.total_steps).toBe(execution.completed_steps);

      // All step types should be present
      const stepTypes = execution.step_executions.map((s) => s.step_type);
      expect(stepTypes).toContain('install_package');
      expect(stepTypes).toContain('create_agent');
      expect(stepTypes).toContain('initialize_workspace_resource');
      expect(stepTypes).toContain('initialize_memory');
      expect(stepTypes).toContain('seed_signal');

      // All steps should be completed
      expect(execution.step_executions.every((s) => s.status === 'completed')).toBe(true);

      // Jobs and signals should have been created
      expect(execution.all_created_job_ids.length).toBeGreaterThan(0);
      expect(execution.all_created_signal_ids.length).toBe(1);

      // The seeded signal should reference the launch
      const signal = runtimeStore.signals.find(
        (s) => s.id === execution.all_created_signal_ids[0],
      );
      expect(signal!.payload?.launch_id).toBe(plan.launch_id);
      expect(signal!.payload?.blueprint_id).toBe('bp_full');
    });
  });
});
