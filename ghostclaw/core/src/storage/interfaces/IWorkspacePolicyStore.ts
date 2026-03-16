import type { WorkspacePolicy, PolicyType } from '../../workspace_policy';

export interface IWorkspacePolicyStore {
  create(policy: WorkspacePolicy): WorkspacePolicy;
  getById(id: string): WorkspacePolicy | undefined;
  listAll(): WorkspacePolicy[];
  listByWorkspaceId(workspaceId: string): WorkspacePolicy[];
  listActive(workspaceId: string, policyType?: PolicyType): WorkspacePolicy[];
  update(
    id: string,
    updates: Partial<Pick<WorkspacePolicy, 'name' | 'description' | 'rules' | 'status' | 'priority' | 'expiresAt' | 'updatedBy' | 'enforcementMode'>> & { updatedAt: number },
  ): WorkspacePolicy | undefined;
  deactivate(id: string, updatedAt: number, updatedBy?: string): WorkspacePolicy | undefined;
  reset(): void;
}
