import type { ISkillInvocationStore } from './storage/interfaces/ISkillInvocationStore';

export type SkillInvocationStatus = 'pending' | 'running' | 'failed' | 'completed' | 'cancelled';

export type SkillInvocation = {
  id: string;
  workspaceId: string;
  planId: string;
  jobId: string;
  assignmentId: string;
  agentId: string;
  skillId: string;
  status: SkillInvocationStatus;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown> | null;
  artifactIds: string[];
  error: string | null;
  retryCount: number;
  fallbackUsed: boolean;
  startedAt: number;
  completedAt: number | null;
};

export class InMemorySkillInvocationStore implements ISkillInvocationStore {
  private readonly invocations = new Map<string, SkillInvocation>();

  create(invocation: SkillInvocation): SkillInvocation {
    this.invocations.set(invocation.id, invocation);
    return invocation;
  }

  getById(id: string): SkillInvocation | undefined {
    return this.invocations.get(id);
  }

  listAll(): SkillInvocation[] {
    return Array.from(this.invocations.values());
  }

  listByJobId(jobId: string): SkillInvocation[] {
    return Array.from(this.invocations.values()).filter((inv) => inv.jobId === jobId);
  }

  updateStatus(
    id: string,
    status: SkillInvocationStatus,
    updates?: Partial<Pick<SkillInvocation, 'outputPayload' | 'error' | 'completedAt' | 'artifactIds' | 'retryCount'>>,
  ): SkillInvocation | undefined {
    const invocation = this.invocations.get(id);
    if (!invocation) {
      return undefined;
    }

    invocation.status = status;
    if (updates) {
      if (updates.outputPayload !== undefined) {
        invocation.outputPayload = updates.outputPayload;
      }
      if (updates.error !== undefined) {
        invocation.error = updates.error;
      }
      if (updates.completedAt !== undefined) {
        invocation.completedAt = updates.completedAt;
      }
      if (updates.artifactIds !== undefined) {
        invocation.artifactIds = updates.artifactIds;
      }
      if (updates.retryCount !== undefined) {
        invocation.retryCount = updates.retryCount;
      }
    }

    return invocation;
  }

  reset(): void {
    this.invocations.clear();
  }
}

export const skillInvocationStore = new InMemorySkillInvocationStore();
