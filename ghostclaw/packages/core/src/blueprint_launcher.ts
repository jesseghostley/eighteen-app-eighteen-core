import { eventBus } from './event_bus';
import { auditLog } from './audit_log';
import { jobQueue, type QueueJob } from './job_queue';
import { runtimeStore, type Signal } from './runtime_loop';
import { ghostMartInstaller } from './ghost_mart_installer';
import { workspaceInstallStore } from './ghost_mart_workspace_install';
import { workspacePolicyStore } from './workspace_policy';
import type {
  BlueprintLaunchPlan,
  BlueprintLaunchStep,
  BlueprintLaunchStepType,
} from './blueprint_launch_planner';

// ── Execution Status Types ─────────────────────────────────────────────────

/**
 * BlueprintLaunchStatus — lifecycle state for a launch execution.
 */
export type BlueprintLaunchStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * BlueprintLaunchStepStatus — lifecycle state for an individual step.
 */
export type BlueprintLaunchStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

// ── Step Execution Record ──────────────────────────────────────────────────

/**
 * BlueprintLaunchStepExecution — tracks the execution state of a single
 * launch step, including any runtime objects it created.
 */
export type BlueprintLaunchStepExecution = {
  /** The step_id from the original launch step. */
  step_id: string;
  /** The launch_id this step belongs to. */
  launch_id: string;
  /** What kind of action this step performs. */
  step_type: BlueprintLaunchStepType;
  /** Current execution status. */
  status: BlueprintLaunchStepStatus;
  /** IDs of jobs created by this step. */
  created_job_ids: string[];
  /** IDs of signals seeded by this step. */
  created_signal_ids: string[];
  /** IDs of install records created/updated by this step. */
  created_install_ids: string[];
  /** Error message if the step failed. */
  error: string | null;
  /** Unix timestamp (milliseconds) when execution started. */
  started_at: number | null;
  /** Unix timestamp (milliseconds) when execution completed/failed. */
  completed_at: number | null;
};

// ── Launch Execution Record ────────────────────────────────────────────────

/**
 * BlueprintLaunchExecution — the top-level record tracking a full blueprint
 * launch from start to finish.  Preserves launch_id traceability across all
 * created runtime objects.
 */
export type BlueprintLaunchExecution = {
  /** The launch_id from the original launch plan. */
  launch_id: string;
  /** Blueprint being launched. */
  blueprint_id: string;
  /** Target workspace. */
  workspace_id: string;
  /** Overall launch status. */
  status: BlueprintLaunchStatus;
  /** Per-step execution records. */
  step_executions: BlueprintLaunchStepExecution[];
  /** All job IDs created across all steps (for traceability). */
  all_created_job_ids: string[];
  /** All signal IDs created across all steps. */
  all_created_signal_ids: string[];
  /** Total steps in the plan. */
  total_steps: number;
  /** Steps completed so far. */
  completed_steps: number;
  /** Error message if the launch failed. */
  error: string | null;
  /** Unix timestamp (milliseconds) when the launch started. */
  started_at: number;
  /** Unix timestamp (milliseconds) when the launch completed/failed/cancelled. */
  completed_at: number | null;
};

// ── ID generators ──────────────────────────────────────────────────────────

let _nextLauncherJobId = 1;
function nextLauncherJobId(): string {
  return `launch_job_${_nextLauncherJobId++}`;
}

let _nextLauncherSignalId = 1;
function nextLauncherSignalId(): string {
  return `launch_signal_${_nextLauncherSignalId++}`;
}

let _nextLauncherAuditId = 1;
function nextLauncherAuditId(): string {
  return `audit_bll_${_nextLauncherAuditId++}`;
}

// ── BlueprintLauncher ──────────────────────────────────────────────────────

/**
 * BlueprintLauncher — executes a BlueprintLaunchPlan by translating launch
 * steps into real GhostClaw runtime objects.
 *
 * The launcher does NOT bypass the existing Signal → Plan → Job pipeline.
 * It creates jobs for install/enable/agent steps and seeds signals for the
 * final blueprint kickoff.  Each step is tracked individually, and the launch
 * fails safely if a required step cannot complete.
 *
 * Workspace policies are checked before launch begins.  If an active
 * 'execution' policy exists with enforcement mode 'block' and rules that
 * disallow blueprint launches, the launch is rejected.
 */
export class BlueprintLauncher {
  private readonly executions = new Map<string, BlueprintLaunchExecution>();

  /**
   * Execute a blueprint launch plan.
   *
   * Walks through steps sequentially, creating runtime objects for each.
   * If any step fails, subsequent steps are skipped and the launch is
   * marked as failed.
   */
  executeLaunch(plan: BlueprintLaunchPlan): BlueprintLaunchExecution {
    // Check workspace policy
    const policyBlock = this.checkWorkspacePolicy(plan.workspace_id);
    if (policyBlock) {
      const execution = this.createExecution(plan);
      execution.status = 'failed';
      execution.error = policyBlock;
      execution.completed_at = Date.now();
      this.executions.set(execution.launch_id, execution);
      this.emitStarted(execution);
      this.emitFailed(execution);
      return execution;
    }

    const execution = this.createExecution(plan);
    execution.status = 'running';
    this.executions.set(execution.launch_id, execution);
    this.emitStarted(execution);

    // Execute each step sequentially
    for (const stepExec of execution.step_executions) {
      // Check for cancellation (status may change via cancelLaunch() in async contexts)
      if ((execution.status as BlueprintLaunchStatus) === 'cancelled') {
        stepExec.status = 'skipped';
        continue;
      }

      const step = plan.steps.find((s) => s.step_id === stepExec.step_id);
      if (!step) {
        stepExec.status = 'failed';
        stepExec.error = `Step '${stepExec.step_id}' not found in launch plan.`;
        stepExec.completed_at = Date.now();
        this.emitStepFailed(execution, stepExec);
        execution.status = 'failed';
        execution.error = stepExec.error;
        execution.completed_at = Date.now();
        this.emitFailed(execution);
        return execution;
      }

      this.executeStep(execution, stepExec, step, plan);

      if (stepExec.status === 'failed') {
        execution.status = 'failed';
        execution.error = `Step '${stepExec.step_id}' (${stepExec.step_type}) failed: ${stepExec.error}`;
        execution.completed_at = Date.now();
        // Mark remaining steps as skipped
        for (const remaining of execution.step_executions) {
          if (remaining.status === 'pending') {
            remaining.status = 'skipped';
          }
        }
        this.emitFailed(execution);
        return execution;
      }
    }

    // All steps completed
    execution.status = 'completed';
    execution.completed_at = Date.now();
    execution.completed_steps = execution.step_executions.filter(
      (s) => s.status === 'completed',
    ).length;
    this.emitCompleted(execution);
    return execution;
  }

  /**
   * Cancel an in-progress launch execution.
   */
  cancelLaunch(launchId: string): BlueprintLaunchExecution | undefined {
    const execution = this.executions.get(launchId);
    if (!execution) return undefined;
    if (execution.status !== 'running' && execution.status !== 'pending') {
      return execution;
    }

    execution.status = 'cancelled';
    execution.completed_at = Date.now();

    // Mark pending steps as skipped
    for (const stepExec of execution.step_executions) {
      if (stepExec.status === 'pending') {
        stepExec.status = 'skipped';
      }
    }

    this.emitCancelled(execution);
    return execution;
  }

  /**
   * Get a launch execution by launch_id.
   */
  getExecution(launchId: string): BlueprintLaunchExecution | undefined {
    return this.executions.get(launchId);
  }

  /**
   * List all launch executions.
   */
  listExecutions(): BlueprintLaunchExecution[] {
    return Array.from(this.executions.values());
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private createExecution(plan: BlueprintLaunchPlan): BlueprintLaunchExecution {
    const stepExecutions: BlueprintLaunchStepExecution[] = plan.steps.map((step) => ({
      step_id: step.step_id,
      launch_id: plan.launch_id,
      step_type: step.step_type,
      status: 'pending' as BlueprintLaunchStepStatus,
      created_job_ids: [],
      created_signal_ids: [],
      created_install_ids: [],
      error: null,
      started_at: null,
      completed_at: null,
    }));

    return {
      launch_id: plan.launch_id,
      blueprint_id: plan.blueprint_id,
      workspace_id: plan.workspace_id,
      status: 'pending',
      step_executions: stepExecutions,
      all_created_job_ids: [],
      all_created_signal_ids: [],
      total_steps: plan.steps.length,
      completed_steps: 0,
      error: null,
      started_at: Date.now(),
      completed_at: null,
    };
  }

  private executeStep(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    stepExec.status = 'running';
    stepExec.started_at = Date.now();
    this.emitStepStarted(execution, stepExec);

    try {
      switch (step.step_type) {
        case 'install_package':
          this.executeInstallPackage(execution, stepExec, step, plan);
          break;
        case 'enable_package':
          this.executeEnablePackage(execution, stepExec, step, plan);
          break;
        case 'create_agent':
          this.executeCreateAgent(execution, stepExec, step, plan);
          break;
        case 'initialize_workspace_resource':
          this.executeInitializeWorkspaceResource(execution, stepExec, step, plan);
          break;
        case 'initialize_memory':
          this.executeInitializeMemory(execution, stepExec, step, plan);
          break;
        case 'seed_signal':
          this.executeSeedSignal(execution, stepExec, step, plan);
          break;
        default:
          stepExec.status = 'failed';
          stepExec.error = `Unknown step type: ${step.step_type}`;
          stepExec.completed_at = Date.now();
          this.emitStepFailed(execution, stepExec);
          return;
      }
    } catch (err: unknown) {
      stepExec.status = 'failed';
      stepExec.error = err instanceof Error ? err.message : String(err);
      stepExec.completed_at = Date.now();
      this.emitStepFailed(execution, stepExec);
      return;
    }

    if (stepExec.status === 'running') {
      stepExec.status = 'completed';
      stepExec.completed_at = Date.now();
      execution.completed_steps++;
      this.emitStepCompleted(execution, stepExec);
    }
  }

  /**
   * Install a package by creating a job that represents the install operation.
   * Uses ghostMartInstaller to perform the actual install, feeding the result
   * into the job queue for traceability.
   */
  private executeInstallPackage(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    if (!step.package_id) {
      stepExec.status = 'failed';
      stepExec.error = 'install_package step requires a package_id.';
      stepExec.completed_at = Date.now();
      this.emitStepFailed(execution, stepExec);
      return;
    }

    const job = this.createLaunchJob(execution, step, 'install_package', {
      package_id: step.package_id,
      workspace_id: plan.workspace_id,
      launch_id: plan.launch_id,
    });
    stepExec.created_job_ids.push(job.id);
    execution.all_created_job_ids.push(job.id);

    // Perform the install through the installer
    const record = ghostMartInstaller.install(
      step.package_id,
      plan.workspace_id,
      'blueprint-launcher',
    );
    stepExec.created_install_ids.push(record.id);

    // Mark job as completed
    jobQueue.markRunning(job.id);
    jobQueue.markComplete(job.id);
  }

  /**
   * Enable a package by creating a job and using the installer.
   */
  private executeEnablePackage(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    if (!step.package_id) {
      stepExec.status = 'failed';
      stepExec.error = 'enable_package step requires a package_id.';
      stepExec.completed_at = Date.now();
      this.emitStepFailed(execution, stepExec);
      return;
    }

    const job = this.createLaunchJob(execution, step, 'enable_package', {
      package_id: step.package_id,
      workspace_id: plan.workspace_id,
      launch_id: plan.launch_id,
    });
    stepExec.created_job_ids.push(job.id);
    execution.all_created_job_ids.push(job.id);

    // Find the install record for this package/workspace and enable it
    const installRecord = workspaceInstallStore.getByWorkspaceAndPackage(
      plan.workspace_id,
      step.package_id,
    );
    if (!installRecord) {
      stepExec.status = 'failed';
      stepExec.error = `No install record found for package '${step.package_id}' in workspace '${plan.workspace_id}'.`;
      stepExec.completed_at = Date.now();
      this.emitStepFailed(execution, stepExec);
      return;
    }

    ghostMartInstaller.enable(installRecord.id);

    jobQueue.markRunning(job.id);
    jobQueue.markComplete(job.id);
  }

  /**
   * Create an agent by enqueuing a job representing the agent creation.
   */
  private executeCreateAgent(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    if (!step.package_id) {
      stepExec.status = 'failed';
      stepExec.error = 'create_agent step requires a package_id.';
      stepExec.completed_at = Date.now();
      this.emitStepFailed(execution, stepExec);
      return;
    }

    const job = this.createLaunchJob(execution, step, 'create_agent', {
      package_id: step.package_id,
      workspace_id: plan.workspace_id,
      launch_id: plan.launch_id,
      required_capabilities: step.required_capabilities,
    });
    stepExec.created_job_ids.push(job.id);
    execution.all_created_job_ids.push(job.id);

    // The agent was already registered during install_package (ghostMartInstaller.install
    // calls register internally).  This step creates a tracking job for the agent
    // creation/initialization phase that sits between install and signal seeding.

    jobQueue.markRunning(job.id);
    jobQueue.markComplete(job.id);
  }

  /**
   * Initialize workspace resources — creates a job for resource setup.
   */
  private executeInitializeWorkspaceResource(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    const job = this.createLaunchJob(execution, step, 'initialize_workspace_resource', {
      blueprint_id: plan.blueprint_id,
      workspace_id: plan.workspace_id,
      launch_id: plan.launch_id,
    });
    stepExec.created_job_ids.push(job.id);
    execution.all_created_job_ids.push(job.id);

    jobQueue.markRunning(job.id);
    jobQueue.markComplete(job.id);
  }

  /**
   * Initialize memory — creates a job for memory/state initialization.
   */
  private executeInitializeMemory(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    const job = this.createLaunchJob(execution, step, 'initialize_memory', {
      blueprint_id: plan.blueprint_id,
      workspace_id: plan.workspace_id,
      launch_id: plan.launch_id,
    });
    stepExec.created_job_ids.push(job.id);
    execution.all_created_job_ids.push(job.id);

    jobQueue.markRunning(job.id);
    jobQueue.markComplete(job.id);
  }

  /**
   * Seed the initial signal that kicks off the blueprint through the
   * existing Signal → Plan → Job pipeline.
   */
  private executeSeedSignal(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
    step: BlueprintLaunchStep,
    plan: BlueprintLaunchPlan,
  ): void {
    const signalId = nextLauncherSignalId();
    const signal: Signal = {
      id: signalId,
      name: `blueprint.launch.${plan.blueprint_id}`,
      payload: {
        launch_id: plan.launch_id,
        blueprint_id: plan.blueprint_id,
        workspace_id: plan.workspace_id,
      },
      createdAt: Date.now(),
    };

    runtimeStore.signals.push(signal);
    eventBus.emit('signal.received', signal);

    stepExec.created_signal_ids.push(signalId);
    execution.all_created_signal_ids.push(signalId);
  }

  /**
   * Create a job in the queue for a launch step, preserving launch_id
   * traceability in the input payload.
   */
  private createLaunchJob(
    execution: BlueprintLaunchExecution,
    step: BlueprintLaunchStep,
    jobType: string,
    inputPayload: Record<string, unknown>,
  ): QueueJob {
    const jobId = nextLauncherJobId();
    const job: QueueJob = {
      id: jobId,
      planId: `launch_plan_${execution.launch_id}`,
      jobType,
      assignedAgent: null,
      status: 'queued',
      inputPayload: {
        ...inputPayload,
        launch_id: execution.launch_id,
        step_id: step.step_id,
      },
      outputPayload: null,
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    jobQueue.enqueue(job);
    eventBus.emit('job.queued', job);
    return job;
  }

  /**
   * Check workspace policies for execution blocks.
   */
  private checkWorkspacePolicy(workspaceId: string): string | null {
    const activePolicies = workspacePolicyStore.listActive(workspaceId, 'execution');
    for (const policy of activePolicies) {
      if (
        policy.enforcementMode === 'block' &&
        policy.rules?.['block_blueprint_launch'] === true
      ) {
        return `Workspace policy '${policy.name}' (${policy.id}) blocks blueprint launches.`;
      }
    }
    return null;
  }

  // ── Event Emission ────────────────────────────────────────────────────────

  private emitStarted(execution: BlueprintLaunchExecution): void {
    eventBus.emit('blueprint.launch.started', execution);
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.started',
      objectType: 'BlueprintLaunchExecution',
      objectId: execution.launch_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Blueprint launch '${execution.launch_id}' started for '${execution.blueprint_id}' in workspace '${execution.workspace_id}'.`,
      workspaceId: execution.workspace_id,
      metadata: {
        blueprint_id: execution.blueprint_id,
        total_steps: execution.total_steps,
      },
    });
  }

  private emitCompleted(execution: BlueprintLaunchExecution): void {
    eventBus.emit('blueprint.launch.completed', execution);
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.completed',
      objectType: 'BlueprintLaunchExecution',
      objectId: execution.launch_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Blueprint launch '${execution.launch_id}' completed — ${execution.completed_steps}/${execution.total_steps} steps, ${execution.all_created_job_ids.length} jobs created.`,
      workspaceId: execution.workspace_id,
      metadata: {
        blueprint_id: execution.blueprint_id,
        completed_steps: execution.completed_steps,
        total_steps: execution.total_steps,
        created_job_ids: execution.all_created_job_ids,
        created_signal_ids: execution.all_created_signal_ids,
      },
    });
  }

  private emitFailed(execution: BlueprintLaunchExecution): void {
    eventBus.emit('blueprint.launch.failed', execution);
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.failed',
      objectType: 'BlueprintLaunchExecution',
      objectId: execution.launch_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Blueprint launch '${execution.launch_id}' failed: ${execution.error}`,
      workspaceId: execution.workspace_id,
      metadata: {
        blueprint_id: execution.blueprint_id,
        error: execution.error,
        completed_steps: execution.completed_steps,
        total_steps: execution.total_steps,
      },
    });
  }

  private emitCancelled(execution: BlueprintLaunchExecution): void {
    eventBus.emit('blueprint.launch.cancelled', execution);
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.cancelled',
      objectType: 'BlueprintLaunchExecution',
      objectId: execution.launch_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Blueprint launch '${execution.launch_id}' cancelled — ${execution.completed_steps}/${execution.total_steps} steps completed before cancellation.`,
      workspaceId: execution.workspace_id,
      metadata: {
        blueprint_id: execution.blueprint_id,
        completed_steps: execution.completed_steps,
        total_steps: execution.total_steps,
      },
    });
  }

  private emitStepStarted(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
  ): void {
    eventBus.emit('blueprint.launch.step.started', {
      execution,
      step: stepExec,
    });
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.step.started',
      objectType: 'BlueprintLaunchStepExecution',
      objectId: stepExec.step_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Launch step '${stepExec.step_id}' (${stepExec.step_type}) started for launch '${execution.launch_id}'.`,
      workspaceId: execution.workspace_id,
      metadata: {
        launch_id: execution.launch_id,
        step_type: stepExec.step_type,
      },
    });
  }

  private emitStepCompleted(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
  ): void {
    eventBus.emit('blueprint.launch.step.completed', {
      execution,
      step: stepExec,
    });
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.step.completed',
      objectType: 'BlueprintLaunchStepExecution',
      objectId: stepExec.step_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Launch step '${stepExec.step_id}' (${stepExec.step_type}) completed — created ${stepExec.created_job_ids.length} job(s).`,
      workspaceId: execution.workspace_id,
      metadata: {
        launch_id: execution.launch_id,
        step_type: stepExec.step_type,
        created_job_ids: stepExec.created_job_ids,
        created_signal_ids: stepExec.created_signal_ids,
      },
    });
  }

  private emitStepFailed(
    execution: BlueprintLaunchExecution,
    stepExec: BlueprintLaunchStepExecution,
  ): void {
    eventBus.emit('blueprint.launch.step.failed', {
      execution,
      step: stepExec,
    });
    auditLog.append({
      id: nextLauncherAuditId(),
      eventType: 'blueprint.launch.step.failed',
      objectType: 'BlueprintLaunchStepExecution',
      objectId: stepExec.step_id,
      actorId: 'blueprint-launcher',
      timestamp: Date.now(),
      summary: `Launch step '${stepExec.step_id}' (${stepExec.step_type}) failed: ${stepExec.error}`,
      workspaceId: execution.workspace_id,
      metadata: {
        launch_id: execution.launch_id,
        step_type: stepExec.step_type,
        error: stepExec.error,
      },
    });
  }

  /**
   * Clear all internal state. For test isolation only.
   */
  reset(): void {
    this.executions.clear();
    _nextLauncherJobId = 1;
    _nextLauncherSignalId = 1;
    _nextLauncherAuditId = 1;
  }
}
