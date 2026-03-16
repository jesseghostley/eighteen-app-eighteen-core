import type { Artifact } from '../../runtime_loop';

export interface IArtifactStore {
  create(artifact: Artifact): Artifact;
  getById(id: string): Artifact | undefined;
  listAll(): Artifact[];
  listByJobId(jobId: string): Artifact[];
  reset(): void;
}
