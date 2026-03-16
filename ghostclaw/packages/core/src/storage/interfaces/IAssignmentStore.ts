import type { Assignment } from '../../assignment';

export interface IAssignmentStore {
  create(assignment: Assignment): Assignment;
  getById(id: string): Assignment | undefined;
  listAll(): Assignment[];
  listByJobId(jobId: string): Assignment[];
  listByAgentName(agentName: string): Assignment[];
  revoke(id: string, revokedAt: number, revokedReason: string): Assignment | undefined;
  reset(): void;
}
