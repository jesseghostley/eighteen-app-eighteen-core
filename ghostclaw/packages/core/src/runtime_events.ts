import type { Signal, Plan, Job, Artifact } from './runtime_loop';
import type { SkillInvocation } from './skill_invocation';
import type { PublishEvent } from './publish_event';
import type { AuditLogEntry } from './audit_log';
import type { WorkspaceInstallRecord } from './ghost_mart_workspace_install';
import type { RemoteExecutionRequest, RemoteExecutionResult } from './remote_execution';
import type { WorkerNode } from './worker_node';
import type { WorkerBackendManifest } from './worker_backend_manifest';
import type { CompatibilityCheckResult } from './package_compatibility';

/**
 * RuntimeEventMap — strongly-typed mapping of every runtime lifecycle event
 * to its canonical payload type.
 *
 * This map is the single source of truth for the event-driven orchestration
 * layer.  The typed EventBus uses this map to enforce payload types on
 * emit() and on() at compile time.
 */
export interface RuntimeEventMap {
  /** Signal created and received by the runtime. */
  'signal.received': Signal;
  /** Plan derived from a received signal. */
  'plan.created': Plan;
  /** Job enqueued for execution. */
  'job.queued': Job;
  /** Agent assigned to a job. */
  'job.assigned': Job & { agentName: string };
  /** Skill invocation transitions from pending → running. */
  'skill.invocation.started': SkillInvocation;
  /** Skill invocation completes successfully. */
  'skill.invocation.completed': SkillInvocation;
  /** Skill invocation fails. */
  'skill.invocation.failed': SkillInvocation;
  /** Artifact produced from a completed skill invocation. */
  'artifact.created': Artifact;
  /** Publish flow initiated for an artifact. */
  'publish.requested': PublishEvent;
  /** Publish completes successfully. */
  'publish.completed': PublishEvent;
  /** Audit entry appended to the audit log. */
  'audit.logged': AuditLogEntry;
  /** Ghost Mart package installed into a workspace. */
  'package.installed': WorkspaceInstallRecord;
  /** Ghost Mart package enabled in a workspace. */
  'package.enabled': WorkspaceInstallRecord;
  /** Ghost Mart package disabled in a workspace. */
  'package.disabled': WorkspaceInstallRecord;
  /** Ghost Mart package uninstalled from a workspace. */
  'package.uninstalled': WorkspaceInstallRecord;
  /** Ghost Mart package updated in a workspace. */
  'package.updated': WorkspaceInstallRecord;

  // ── Remote execution lifecycle ──────────────────────────────────────────

  /** Remote execution request submitted to an adapter. */
  'remote.execution.requested': RemoteExecutionRequest;
  /** Remote execution started on the remote side. */
  'remote.execution.started': RemoteExecutionRequest;
  /** Remote execution completed successfully. */
  'remote.execution.completed': RemoteExecutionResult;
  /** Remote execution failed. */
  'remote.execution.failed': RemoteExecutionResult;

  // ── Worker node lifecycle ───────────────────────────────────────────────

  /** Worker node registered with the registry. */
  'worker.registered': WorkerNode;
  /** Worker node heartbeat received. */
  'worker.heartbeat': WorkerNode;
  /** Worker node went offline (missed heartbeat or explicit). */
  'worker.offline': WorkerNode;
  /** Worker node selected for a skill invocation. */
  'worker.selected': WorkerNode;

  // ── Worker backend manifest lifecycle ─────────────────────────────────────

  /** Worker backend manifest registered. */
  'worker_backend.registered': WorkerBackendManifest;
  /** Worker backend manifest unregistered. */
  'worker_backend.unregistered': WorkerBackendManifest;
  /** Worker backend manifest updated. */
  'worker_backend.updated': WorkerBackendManifest;

  // ── Package compatibility lifecycle ───────────────────────────────────────

  /** Package compatibility check completed (no requirements). */
  'package.compatibility.checked': CompatibilityCheckResult;
  /** Package compatibility check failed — no compatible backend found. */
  'package.compatibility.failed': CompatibilityCheckResult;
  /** Package compatibility check satisfied — compatible backend(s) found. */
  'package.compatibility.satisfied': CompatibilityCheckResult;
}
