import type { SkillInvocation, SkillInvocationStatus } from '../../skill_invocation';

export interface ISkillInvocationStore {
  create(invocation: SkillInvocation): SkillInvocation;
  getById(id: string): SkillInvocation | undefined;
  listAll(): SkillInvocation[];
  listByJobId(jobId: string): SkillInvocation[];
  updateStatus(
    id: string,
    status: SkillInvocationStatus,
    updates?: Partial<Pick<SkillInvocation, 'outputPayload' | 'error' | 'completedAt' | 'artifactIds' | 'retryCount'>>,
  ): SkillInvocation | undefined;
  reset(): void;
}
