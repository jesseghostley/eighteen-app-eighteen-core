import type { IAssignmentStore } from './storage/interfaces/IAssignmentStore';

/**
 * Assignment — the binding of a Job to an Agent.
 *
 * Canonical spec: ghostclaw_runtime_persistence_spec.md § 2.4
 * Runtime chain:  Signal → Plan → Job → **Assignment** → SkillInvocation → Artifact → PublishEvent
 *
 * An Assignment records why a specific agent was chosen and what fallback behaviour
 * applies if the primary agent fails.  In the current in-memory mode the store is
 * write-once; a new Assignment record MUST be created for any re-assignment rather
 * than mutating an existing record.
 */

export type Assignment = {
  /** Globally unique identifier. */
  id: string;
  /** Foreign key referencing Job.id. */
  jobId: string;
  /**
   * Name of the assigned agent.
   * MUST match AgentDefinition.agentName in agent_registry.ts.
   * This value is also mirrored in Job.assignedAgent.
   */
  agentName: string;
  /** Human-readable explanation of why this agent was selected. */
  reason: string;
  /** Unix timestamp (milliseconds) when the assignment was created. */
  createdAt: number;

  // --- Optional fields ---

  /** Name of the fallback agent to use if the primary agent fails. */
  fallbackAgentName?: string;
  /** Explanation of the fallback selection rationale. */
  fallbackReason?: string;
  /** Timestamp when the assignment was revoked (e.g. agent unavailable). */
  revokedAt?: number;
  /** Reason the assignment was revoked. */
  revokedReason?: string;
};

export class InMemoryAssignmentStore implements IAssignmentStore {
  private readonly assignments = new Map<string, Assignment>();

  create(assignment: Assignment): Assignment {
    this.assignments.set(assignment.id, assignment);
    return assignment;
  }

  getById(id: string): Assignment | undefined {
    return this.assignments.get(id);
  }

  listAll(): Assignment[] {
    return Array.from(this.assignments.values());
  }

  listByJobId(jobId: string): Assignment[] {
    return Array.from(this.assignments.values()).filter(
      (a) => a.jobId === jobId,
    );
  }

  listByAgentName(agentName: string): Assignment[] {
    return Array.from(this.assignments.values()).filter(
      (a) => a.agentName === agentName,
    );
  }

  /**
   * Soft-revoke an assignment.  Sets revokedAt/revokedReason; does not delete
   * the record (assignments are append-additive per the persistence spec).
   */
  revoke(id: string, revokedAt: number, revokedReason: string): Assignment | undefined {
    const assignment = this.assignments.get(id);
    if (!assignment) {
      return undefined;
    }
    assignment.revokedAt = revokedAt;
    assignment.revokedReason = revokedReason;
    return assignment;
  }

  reset(): void {
    this.assignments.clear();
  }
}

export const assignmentStore = new InMemoryAssignmentStore();
