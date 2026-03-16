import type { IPublishEventStore } from './storage/interfaces/IPublishEventStore';

/**
 * PublishEvent — records when an Artifact is published externally.
 *
 * Canonical spec: ghostclaw_runtime_persistence_spec.md § 2.7
 * Runtime chain:  Signal → Plan → Job → Assignment → SkillInvocation → Artifact → **PublishEvent**
 *
 * A PublishEvent captures the publishing target, outcome, and authorisation trail
 * for every external publish action.  If MCS publish policies require approval,
 * the record starts in `pending` state and transitions through the MCS approval
 * state machine.
 *
 * TODO(schema-alignment): Behavioural wiring deferred.
 *   PublishEvent records are defined here but are not yet created automatically
 *   by the execution pipeline.  Wiring the MCS approval state machine and
 *   publish-gate enforcement requires the full MCS policy evaluation layer,
 *   which is out of scope for this alignment pass.
 */

export type PublishEventStatus = 'pending' | 'approved' | 'published' | 'failed' | 'rejected';

export type PublishEvent = {
  /** Globally unique identifier. */
  id: string;
  /** Foreign key referencing Artifact.id. */
  artifactId: string;
  /** Unix timestamp (milliseconds) when publishing occurred or was initiated. */
  publishedAt: number;
  /** Target destination identifier (e.g. `ghost_mart`, `website_cms`, `cdn_bucket`). */
  destination: string;
  /** Current lifecycle state. */
  status: PublishEventStatus;
  /** Agent or operator identity that triggered publishing. */
  publishedBy: string;

  // --- Optional fields ---

  /** Identity that approved the publish action (if policy required approval). */
  approvedBy?: string;
  /** Timestamp of approval. */
  approvedAt?: number;
  /** Foreign key referencing WorkspacePolicy.id that governed this publish action. */
  policyId?: string;
  /** URL of the published artifact at its destination. */
  externalUrl?: string;
  /** Error description if publishing failed. */
  failureReason?: string;
  /** Number of publish retry attempts. */
  retryCount?: number;
};

export class InMemoryPublishEventStore implements IPublishEventStore {
  private readonly events = new Map<string, PublishEvent>();

  create(event: PublishEvent): PublishEvent {
    this.events.set(event.id, event);
    return event;
  }

  getById(id: string): PublishEvent | undefined {
    return this.events.get(id);
  }

  listAll(): PublishEvent[] {
    return Array.from(this.events.values());
  }

  listByArtifactId(artifactId: string): PublishEvent[] {
    return Array.from(this.events.values()).filter(
      (e) => e.artifactId === artifactId,
    );
  }

  listByStatus(status: PublishEventStatus): PublishEvent[] {
    return Array.from(this.events.values()).filter((e) => e.status === status);
  }

  /**
   * Update mutable fields on a PublishEvent.
   * Immutable fields (id, artifactId, publishedAt, destination, publishedBy)
   * MUST NOT be included in updates.
   */
  updateStatus(
    id: string,
    status: PublishEventStatus,
    updates?: Partial<
      Pick<
        PublishEvent,
        'approvedBy' | 'approvedAt' | 'externalUrl' | 'failureReason' | 'retryCount'
      >
    >,
  ): PublishEvent | undefined {
    const event = this.events.get(id);
    if (!event) {
      return undefined;
    }
    event.status = status;
    if (updates) {
      // Only apply keys that are explicitly provided (skip undefined values so
      // existing fields are not accidentally cleared).
      const defined = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined),
      ) as Partial<typeof updates>;
      Object.assign(event, defined);
    }
    return event;
  }

  reset(): void {
    this.events.clear();
  }
}

export const publishEventStore = new InMemoryPublishEventStore();
