import type { PublishEvent, PublishEventStatus } from '../../publish_event';

export interface IPublishEventStore {
  create(event: PublishEvent): PublishEvent;
  getById(id: string): PublishEvent | undefined;
  listAll(): PublishEvent[];
  listByArtifactId(artifactId: string): PublishEvent[];
  listByStatus(status: PublishEventStatus): PublishEvent[];
  updateStatus(
    id: string,
    status: PublishEventStatus,
    updates?: Partial<Pick<PublishEvent, 'approvedBy' | 'approvedAt' | 'externalUrl' | 'failureReason' | 'retryCount'>>,
  ): PublishEvent | undefined;
  reset(): void;
}
