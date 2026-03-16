import type { IArtifactStore } from '../interfaces/IArtifactStore';
import type { Artifact } from '../../runtime_loop';

export class InMemoryArtifactStore implements IArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();

  create(artifact: Artifact): Artifact {
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  getById(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  listAll(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  listByJobId(jobId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter((a) => a.jobId === jobId);
  }

  reset(): void {
    this.artifacts.clear();
  }
}
