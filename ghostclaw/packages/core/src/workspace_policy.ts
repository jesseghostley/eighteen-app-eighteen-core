import type { IWorkspacePolicyStore } from './storage/interfaces/IWorkspacePolicyStore';

/**
 * WorkspacePolicy — declarative rules governing execution, publishing, or safety
 * behaviour within a workspace.
 *
 * Canonical spec: ghostclaw_runtime_persistence_spec.md § 2.9
 *                 ghostclaw_master_control_system.md § 2
 * Runtime chain:  cross-cutting; WorkspacePolicies are evaluated by the MCS at
 *                 every plan approval, job assignment, skill invocation, and
 *                 publish action.
 *
 * Policies are evaluated by the MCS before any consequential action proceeds.
 * Policies may only be modified by Operators or Administrators.
 *
 * TODO(schema-alignment): MCS policy evaluation deferred.
 *   WorkspacePolicy records are defined here but policy evaluation is not yet
 *   wired into the execution pipeline.  Full evaluation requires the MCS governance
 *   layer and is out of scope for this alignment pass.  Policies MUST NOT be
 *   hard-deleted; set status = 'inactive' instead (soft delete).
 */

export type PolicyType = 'execution' | 'publish' | 'safety' | 'workspace';

export type PolicyStatus = 'active' | 'inactive';

/** How a policy violation should be handled at runtime. */
export type EnforcementMode = 'block' | 'warn' | 'audit';

export type WorkspacePolicy = {
  /** Globally unique identifier. MUST be immutable after creation. */
  id: string;
  /** The workspace to which this policy applies. MUST be immutable after creation. */
  workspaceId: string;
  /**
   * Category of behaviour governed by this policy.
   * MUST be immutable after creation.
   */
  policyType: PolicyType;
  /** Human-readable policy name. */
  name: string;
  /** Detailed description of what the policy governs. */
  description: string;
  /** Structured policy rule definition. Schema is policy-type-specific. */
  rules: Record<string, unknown>;
  /** One of: 'active' | 'inactive'. */
  status: PolicyStatus;
  /** Unix timestamp (milliseconds) of creation. MUST be immutable after creation. */
  createdAt: number;
  /** Unix timestamp (milliseconds) of last modification. */
  updatedAt: number;

  // --- Optional fields ---

  /** Evaluation priority when multiple policies apply. Higher values evaluated first. */
  priority?: number;
  /** Timestamp after which the policy automatically becomes inactive. */
  expiresAt?: number;
  /** Identity of the operator or system component that created the policy. */
  createdBy?: string;
  /** Identity of the last modifier. */
  updatedBy?: string;
  /** How a policy violation should be handled. */
  enforcementMode?: EnforcementMode;
};

export class InMemoryWorkspacePolicyStore implements IWorkspacePolicyStore {
  private readonly policies = new Map<string, WorkspacePolicy>();

  create(policy: WorkspacePolicy): WorkspacePolicy {
    this.policies.set(policy.id, policy);
    return policy;
  }

  getById(id: string): WorkspacePolicy | undefined {
    return this.policies.get(id);
  }

  listAll(): WorkspacePolicy[] {
    return Array.from(this.policies.values());
  }

  listByWorkspaceId(workspaceId: string): WorkspacePolicy[] {
    return Array.from(this.policies.values()).filter(
      (p) => p.workspaceId === workspaceId,
    );
  }

  listActive(workspaceId: string, policyType?: PolicyType): WorkspacePolicy[] {
    return Array.from(this.policies.values()).filter(
      (p) =>
        p.workspaceId === workspaceId &&
        p.status === 'active' &&
        (policyType === undefined || p.policyType === policyType),
    );
  }

  /**
   * Update mutable fields on a WorkspacePolicy.
   * Immutable fields (id, workspaceId, policyType, createdAt) MUST NOT be modified.
   * All modifications MUST produce an AuditLogEntry of type 'policy.evaluated'
   * — wiring to the audit log is deferred (see module TODO above).
   */
  update(
    id: string,
    updates: Partial<
      Pick<
        WorkspacePolicy,
        | 'name'
        | 'description'
        | 'rules'
        | 'status'
        | 'priority'
        | 'expiresAt'
        | 'updatedBy'
        | 'enforcementMode'
      >
    > & { updatedAt: number },
  ): WorkspacePolicy | undefined {
    const policy = this.policies.get(id);
    if (!policy) {
      return undefined;
    }
    // Intentional in-place mutation: the in-memory store holds a single
    // authoritative instance per ID.  Callers that read the policy via
    // getById() will receive the same reference and therefore see the updated
    // values, which is the expected behaviour for an in-memory store.
    Object.assign(policy, updates);
    return policy;
  }

  /**
   * Soft-delete: sets status = 'inactive' rather than removing the record.
   * Hard deletion is prohibited per the persistence spec.
   */
  deactivate(id: string, updatedAt: number, updatedBy?: string): WorkspacePolicy | undefined {
    return this.update(id, { status: 'inactive', updatedAt, updatedBy });
  }

  reset(): void {
    this.policies.clear();
  }
}

export const workspacePolicyStore = new InMemoryWorkspacePolicyStore();
