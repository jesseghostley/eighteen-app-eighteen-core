# GhostClaw Runtime Persistence Specification

**Spec Version:** 0.1.0  
**Status:** Draft  
**Date:** 2026-03-15  
**Scope:** Canonical persistence models for all GhostClaw runtime objects  

---

## Purpose

This document defines the canonical persistence model for every runtime object produced or consumed by the GhostClaw execution pipeline. It bridges the existing TypeScript implementation (`packages/core/src/`, `packages/planner/src/`, `packages/shared/src/`) and future durable storage backends so the system can evolve from in-memory stores to PostgreSQL, Redis, or an event-sourced architecture without ambiguity.

This spec is the authoritative reference for:
- Database schema design (tables, indexes, foreign keys)
- TypeScript type alignment and field contracts
- State machine correctness
- Data retention and compliance planning
- Query optimization across all deployment modes

Cross-references:
- [`ghostclaw_runtime_execution_spec.md`](./ghostclaw_runtime_execution_spec.md) — Section 10 (Persistence Layer), Section 14 (Minimum Runtime Objects)
- [`ghostclaw_runtime_signals.md`](./ghostclaw_runtime_signals.md) — Signal structure definition
- [`ghostclaw_master_control_system.md`](./ghostclaw_master_control_system.md) — MCS audit logging, workspace policies, approval state machine
- [`ghostclaw_concepts.md`](./ghostclaw_concepts.md) — Core runtime grammar
- [`ghostclaw_archetype_framework.md`](./ghostclaw_archetype_framework.md) — Archetype-to-runtime-object mapping

---

## Terminology

Keywords used in this document follow RFC 2119 conventions:
- **MUST** — an absolute requirement of this specification.
- **MUST NOT** — an absolute prohibition.
- **SHOULD** — recommended; may be omitted only with valid justification.
- **MAY** — optional.

---

## 1. Object Relationship Diagram

The complete runtime pipeline follows this chain:

```
Signal
  └─► Plan
        └─► Job
              └─► Assignment
                    └─► SkillInvocation
                          └─► Artifact
                                └─► PublishEvent

Cross-cutting (reference all of the above):
  ├─► AuditLogEntry   (append-only; every consequential event)
  └─► WorkspacePolicy (declarative rules enforced at execution time)
```

All object identifiers are strings. Foreign key relationships are represented as `id` string fields pointing to the canonical `id` of the referenced object. The runtime MUST enforce referential integrity for the primary chain (`Signal → Plan → Job → Assignment → SkillInvocation → Artifact → PublishEvent`).

---

## 2. Canonical Persistence Models

### 2.1 Signal

The entry point for all work in the runtime. A Signal represents an external or internal event that causes the planner to evaluate and generate a plan.

**TypeScript source:** `packages/core/src/runtime_loop.ts`  
**In-memory store:** `runtimeStore.signals[]`  
**Archetype role:** Signal (see `ghostclaw_archetype_framework.md`)  
**Signal structure reference:** `ghostclaw_runtime_signals.md`

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. MUST be immutable after creation. |
| `name` | `string` | Canonical signal name using `snake_case` (e.g., `keyword_opportunity_detected`). Signal name conventions are defined in [`ghostclaw_runtime_signals.md`](./ghostclaw_runtime_signals.md). |
| `createdAt` | `number` | Unix timestamp (milliseconds) of creation. MUST be immutable. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `payload` | `Record<string, unknown>` | Structured context data associated with the signal. MAY be absent for system-internal signals. |

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Plans | one-to-many | `Plan.signalId` references this Signal's `id`. |

#### Creation Trigger

A Signal is created when:
- An external event is received by the runtime entry point (`processSignal()` in `runtime_loop.ts`).
- The `EventBus` emits a system event that causes the runtime loop to generate a new Signal record.
- A scheduled or periodic trigger fires.

#### Update Lifecycle

Signals are **immutable after creation**. No fields MUST be updated once the Signal record is persisted. The signal `id` and `createdAt` MUST NOT be modified under any circumstance.

#### Retention Expectations

Signals SHOULD be retained indefinitely (append-only log). They MAY be archived to cold storage after all associated Plans have reached terminal state (`completed` or `failed`) and their retention window has passed.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- List all signals ordered by `createdAt` descending — SHOULD be supported.
- Lookup signals by `name` — SHOULD be indexed for planner routing queries.

---

### 2.2 Plan

A Plan is generated from a Signal by the Planner via a selected strategy. It describes the intended course of action as a structured planner decision.

**TypeScript source:** `packages/core/src/runtime_loop.ts`, `packages/planner/src/signal_router.ts`, `packages/shared/src/types/planner_strategy.ts`  
**In-memory store:** `runtimeStore.plans[]`  
**Archetype role:** Mentor (Planner)

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `signalId` | `string` | Foreign key referencing `Signal.id`. MUST reference an existing Signal. |
| `action` | `PlannerAction` | One of: `generate_content_cluster`, `optimize_existing_page`, `create_new_skill`, `handle_runtime_error`. |
| `strategyId` | `string` | Identifier of the `PlannerStrategy` that produced this plan. |
| `strategyType` | `StrategyType` | One of: `rule`, `ai`, `hybrid`. |
| `createdAt` | `number` | Unix timestamp (milliseconds) of creation. |

`PlannerAction` is defined in `packages/planner/src/signal_router.ts`.  
`StrategyType` is defined in `packages/shared/src/types/planner_strategy.ts`.

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `priority` | `number` | Planning priority derived from `PlannerDecision.priority`. MAY be stored for queue ordering. |
| `requiredAgents` | `string[]` | Agent names required to execute this plan, sourced from `PlannerDecision.requiredAgents`. |
| `expectedOutputs` | `string[]` | Expected artifact types, sourced from `PlannerDecision.expectedOutputs`. |

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Signal | many-to-one | `Plan.signalId` → `Signal.id` |
| Jobs | one-to-many | `Job.planId` references this Plan's `id`. |
| SkillInvocations | one-to-many | `SkillInvocation.planId` references this Plan's `id`. |

#### Creation Trigger

A Plan is created immediately after the Planner receives and routes a Signal. The `routeSignal()` function in `signal_router.ts` returns a `PlannerDecision` from which the Plan record is constructed.

#### Update Lifecycle

Plans are effectively immutable after creation. The `action`, `strategyId`, `strategyType`, and `signalId` MUST NOT be modified. Plans do not carry their own status field; status is derived by inspecting the state of the associated Jobs.

#### Retention Expectations

Plans MUST be retained as long as any associated Job, SkillInvocation, or Artifact exists. Plans MAY be archived to cold storage after all dependent objects have been archived.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `signalId` — MUST be indexed (planner linking).
- List all plans ordered by `createdAt` descending — SHOULD be supported.
- Filter by `action` — SHOULD be indexed for analytics queries.

---

### 2.3 Job

A Job is a discrete unit of work derived from a Plan. Jobs are queued, assigned to agents, and executed. Jobs are the smallest unit of assigned work in the runtime.

**TypeScript source:** `packages/core/src/job_queue.ts`  
**Type alias:** `Job = QueueJob` (re-exported from `runtime_loop.ts`)  
**In-memory store:** `InMemoryJobQueue` class in `job_queue.ts`, and `runtimeStore.jobs[]`  
**Archetype role:** Workers (Executors)

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `planId` | `string` | Foreign key referencing `Plan.id`. MUST reference an existing Plan. |
| `jobType` | `string` | Capability string used to match the job to an agent (e.g., `write_article`). |
| `assignedAgent` | `string \| null` | Name of the assigned agent, or `null` when unassigned. |
| `status` | `JobStatus` | Current lifecycle state. See Update Lifecycle below. |
| `inputPayload` | `Record<string, unknown>` | Input data passed to the agent for execution. |
| `outputPayload` | `Record<string, unknown> \| null` | Structured output from the agent. `null` until completion. |
| `retryCount` | `number` | Number of times this job has been retried after failure. |
| `createdAt` | `number` | Unix timestamp (milliseconds) of creation. |
| `updatedAt` | `number` | Unix timestamp (milliseconds) of last status change. MUST be updated on every state transition. |

`JobStatus` is defined in `packages/core/src/job_queue.ts`:  
`'queued' | 'assigned' | 'running' | 'completed' | 'failed'`

#### Optional Fields

None beyond those defined in `QueueJob`. Future versions MAY add `scheduledAt`, `timeoutAt`, `workspaceId`.

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Plan | many-to-one | `Job.planId` → `Plan.id` |
| Assignment | one-to-one | `Assignment.jobId` references this Job's `id`. |
| SkillInvocations | one-to-many | `SkillInvocation.jobId` references this Job's `id`. |
| Artifacts | one-to-many | `Artifact.jobId` references this Job's `id`. |

#### Creation Trigger

Jobs are created inside `processSignal()` in `runtime_loop.ts` after a Plan is produced. One or more Jobs are created per Plan, each corresponding to a discrete task type derived from the planner action.

#### Update Lifecycle

```
queued → assigned → running → completed
                 ↘           ↘
                  → running → failed (→ queued if retryCount < MAX_RETRIES)
```

State transition rules:
- `queued` → `assigned`: when `dequeue()` selects the job and an agent is identified.
- `assigned` → `running`: when the agent begins execution (`markRunning()`).
- `running` → `completed`: when the agent successfully completes work (`markComplete()`).
- `running` → `failed`: when the agent reports an error (`markFailed()`).
- `failed` → `queued`: automatic re-enqueue if `retryCount < MAX_RETRIES` (currently 2).

The `assignedAgent`, `status`, `outputPayload`, `retryCount`, and `updatedAt` fields are mutable. All other fields MUST NOT be modified after creation.

#### Retention Expectations

Jobs MUST be retained until all associated SkillInvocations and Artifacts have been archived. Completed and failed Jobs SHOULD be retained for at least 90 days for audit purposes.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `planId` — MUST be indexed.
- Filter by `status` — MUST be indexed (queue dequeue operations).
- Lookup by `assignedAgent` — SHOULD be indexed (agent load queries).
- List jobs ordered by `createdAt` — SHOULD be supported.

---

### 2.4 Assignment

An Assignment is the binding of a Job to an Agent. It records why a specific agent was chosen and what fallback behavior applies if the agent fails.

**TypeScript source:** No standalone TypeScript type currently defined. Assignment records are implicit in the `assignedAgent` field on `QueueJob`. This spec formalizes Assignment as a first-class object.  
**In-memory store:** Currently embedded in `Job.assignedAgent`. A dedicated store is required for durable mode.  
**Archetype role:** Planner/Mentor (routing decision), Workers (execution binding)

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `jobId` | `string` | Foreign key referencing `Job.id`. |
| `agentName` | `string` | Name of the assigned agent. MUST match `AgentDefinition.agentName` in `agent_registry.ts`. This is also the value stored in `Job.assignedAgent`. |
| `reason` | `string` | Human-readable explanation of why this agent was selected. |
| `createdAt` | `number` | Unix timestamp (milliseconds) when the assignment was created. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `fallbackAgentName` | `string` | Name of the fallback agent to use if the primary agent fails. MUST match `AgentDefinition.agentName` if provided. |
| `fallbackReason` | `string` | Explanation of the fallback selection rationale. |
| `revokedAt` | `number` | Timestamp when the assignment was revoked (e.g., agent unavailable). |
| `revokedReason` | `string` | Reason for revocation. |

`AgentDefinition` is defined in `packages/core/src/agent_registry.ts`.

> **Note on agent identity:** The current runtime uses agent names (strings like `ContentWriterAgent`) as the canonical agent identifier, matching `AgentDefinition.agentName`. The `Job.assignedAgent` field and `SkillInvocation.agentId` field both store this name string. A future durable mode implementation MAY introduce a separate auto-generated `agentId` (UUID), at which point `agentName` becomes a display field and `agentId` becomes the foreign key. Until that migration is complete, `agentName` is the authoritative agent reference across all runtime objects.

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Job | many-to-one | `Assignment.jobId` → `Job.id` |
| SkillInvocations | one-to-many | `SkillInvocation.assignmentId` references this Assignment's `id`. |

#### Creation Trigger

An Assignment is created when the runtime selects an agent for a queued Job via `findAgentForJob()` in `agent_registry.ts`. Each Job SHOULD have exactly one active Assignment at any time.

#### Update Lifecycle

Assignments are largely immutable after creation. The `revokedAt` and `revokedReason` fields MAY be set if the assignment is cancelled or the agent becomes unavailable. A new Assignment record MUST be created for any re-assignment rather than mutating the original.

#### Retention Expectations

Assignments MUST be retained for at least as long as their associated Job. They SHOULD be retained for audit purposes for a minimum of 90 days after the Job reaches terminal state.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `jobId` — MUST be indexed.
- Lookup by `agentName` — MUST be indexed (agent workload queries).
- Filter active (non-revoked) assignments by `agentName` — SHOULD be indexed.

---

### 2.5 SkillInvocation

A SkillInvocation records a single invocation of a named skill by an agent during job execution. It tracks input, output, retry behavior, fallback usage, and timing.

**TypeScript source:** `packages/core/src/skill_invocation.ts`  
**In-memory store:** `InMemorySkillInvocationStore` class in `skill_invocation.ts`, and `runtimeStore.skillInvocations[]`  
**Archetype role:** Workers (execution), Forge (skill capability tracking)

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `workspaceId` | `string` | Workspace context in which the skill was invoked. |
| `planId` | `string` | Foreign key referencing `Plan.id`. |
| `jobId` | `string` | Foreign key referencing `Job.id`. |
| `assignmentId` | `string` | Foreign key referencing `Assignment.id`. |
| `agentId` | `string` | Name of the agent that invoked the skill. Stores the agent name string per `AgentDefinition.agentName` (see note in Section 2.4 on agent identity). |
| `skillId` | `string` | Identifier of the skill being invoked. |
| `status` | `SkillInvocationStatus` | Current lifecycle state. See Update Lifecycle below. |
| `inputPayload` | `Record<string, unknown>` | Input data passed to the skill. |
| `outputPayload` | `Record<string, unknown> \| null` | Output data returned by the skill. `null` until completion. |
| `artifactIds` | `string[]` | IDs of Artifacts produced by this invocation. |
| `error` | `string \| null` | Error message if the invocation failed. `null` otherwise. |
| `retryCount` | `number` | Number of retry attempts. |
| `fallbackUsed` | `boolean` | Whether a fallback skill or agent was used. |
| `startedAt` | `number` | Unix timestamp (milliseconds) when execution began. |
| `completedAt` | `number \| null` | Unix timestamp (milliseconds) when execution completed. `null` if not yet complete. |

`SkillInvocationStatus` is defined in `packages/core/src/skill_invocation.ts`:  
`'pending' | 'running' | 'failed' | 'completed' | 'cancelled'`

#### Optional Fields

None beyond those defined in the TypeScript type. Future versions MAY add `durationMs` (derived), `costTokens`, `costUsd`.

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Plan | many-to-one | `SkillInvocation.planId` → `Plan.id` |
| Job | many-to-one | `SkillInvocation.jobId` → `Job.id` |
| Assignment | many-to-one | `SkillInvocation.assignmentId` → `Assignment.id` |
| Artifacts | one-to-many | `Artifact.skillInvocationId` references this SkillInvocation's `id`. |

#### Creation Trigger

A SkillInvocation is created when `job_executor.ts` begins executing a Job and calls a skill. One Job MAY produce multiple SkillInvocations (e.g., retries, multi-step skills).

#### Update Lifecycle

```
pending → running → completed
                 ↘
                  → failed (→ pending if retryCount < limit)
                  → cancelled
```

Mutable fields: `status`, `outputPayload`, `artifactIds`, `error`, `retryCount`, `fallbackUsed`, `completedAt`.  
Immutable fields: `id`, `workspaceId`, `planId`, `jobId`, `assignmentId`, `agentId`, `skillId`, `inputPayload`, `startedAt`.

The `updateStatus()` method in `InMemorySkillInvocationStore` handles all transitions.

#### Retention Expectations

SkillInvocations MUST be retained for at least as long as any referenced Artifact exists. They SHOULD be retained for 90 days minimum after reaching terminal state for audit and retry analysis.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `jobId` — MUST be indexed (job execution tracing).
- Lookup by `agentId` — MUST be indexed (agent performance queries).
- Filter by `status` — MUST be indexed.
- Lookup by `skillId` — SHOULD be indexed (skill analytics).
- Lookup by `workspaceId` — SHOULD be indexed (workspace isolation).

---

### 2.6 Artifact

An Artifact is a durable output produced by a completed Job or SkillInvocation. Artifacts represent the concrete deliverables of the runtime (content, schemas, metadata, skills).

**TypeScript source:** `packages/core/src/runtime_loop.ts`  
**In-memory store:** `runtimeStore.artifacts[]`  
**Archetype role:** Workers (produce), Guardian (validate), Marketplace (distribute)

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `jobId` | `string` | Foreign key referencing `Job.id`. |
| `skillInvocationId` | `string` | Foreign key referencing `SkillInvocation.id`. |
| `type` | `string` | Artifact type identifier (e.g., `article`, `schema`, `skill_package`). |
| `content` | `string` | Serialized artifact content. For large artifacts, this SHOULD be a storage reference (URL or object key). |
| `createdAt` | `number` | Unix timestamp (milliseconds) of creation. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Workspace context. SHOULD be populated when workspace isolation is required. |
| `contentUri` | `string` | External storage reference (S3 key, file path) when content is stored externally. |
| `mimeType` | `string` | MIME type of the artifact content. |
| `sizeBytes` | `number` | Size of the artifact content in bytes. |
| `checksum` | `string` | SHA-256 hash for content integrity verification. |
| `validatedAt` | `number` | Timestamp when the artifact passed validation by the Guardian archetype. |
| `validationStatus` | `string` | One of: `pending`, `pass`, `fail`. Defaults to `pending`. |

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Job | many-to-one | `Artifact.jobId` → `Job.id` |
| SkillInvocation | many-to-one | `Artifact.skillInvocationId` → `SkillInvocation.id` |
| PublishEvents | one-to-many | `PublishEvent.artifactId` references this Artifact's `id`. |

#### Creation Trigger

An Artifact is created when a SkillInvocation completes successfully and produces output that must be persisted. The invocation sets `artifactIds` on the SkillInvocation record upon creation.

#### Update Lifecycle

Artifacts are immutable in their core identity fields (`id`, `jobId`, `skillInvocationId`, `type`, `createdAt`). The optional validation fields (`validatedAt`, `validationStatus`) MAY be updated as validation results are recorded. The `content` field MUST NOT be modified after creation; new versions MUST produce new Artifact records.

#### Retention Expectations

Artifacts are durable outputs and MUST be retained for at least as long as any downstream PublishEvent references them. Artifact retention policies SHOULD be configurable per workspace and artifact type. Minimum retention SHOULD be 12 months for published artifacts.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `jobId` — MUST be indexed.
- Lookup by `skillInvocationId` — MUST be indexed.
- Filter by `type` — SHOULD be indexed (type-specific queries).
- Filter by `validationStatus` — SHOULD be indexed (Guardian validation queue).

---

### 2.7 PublishEvent

A PublishEvent records when an Artifact is published externally (e.g., to a website, marketplace, or CMS). It captures the publishing target, outcome, and authorization trail.

**TypeScript source:** No standalone TypeScript type currently defined. This spec formalizes PublishEvent as a first-class object.  
**In-memory store:** None currently. A dedicated store is required for durable mode.  
**Archetype role:** Marketplace (distribution), Guardian (audit), MCS (publish policy gating)  
**MCS reference:** `ghostclaw_master_control_system.md` — Publish Policies, Approval State Machine

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `artifactId` | `string` | Foreign key referencing `Artifact.id`. |
| `publishedAt` | `number` | Unix timestamp (milliseconds) when publishing occurred. |
| `destination` | `string` | Target destination identifier (e.g., `ghost_mart`, `website_cms`, `cdn_bucket`). |
| `status` | `string` | One of: `pending`, `approved`, `published`, `failed`, `rejected`. |
| `publishedBy` | `string` | Agent or operator identity that triggered publishing. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `approvedBy` | `string` | Identity that approved the publish action (if policy required approval). |
| `approvedAt` | `number` | Timestamp of approval. |
| `policyId` | `string` | Foreign key referencing `WorkspacePolicy.id` that governed this publish action. |
| `externalUrl` | `string` | URL of the published artifact at its destination. |
| `failureReason` | `string` | Error description if publishing failed. |
| `retryCount` | `number` | Number of publish retry attempts. |

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| Artifact | many-to-one | `PublishEvent.artifactId` → `Artifact.id` |
| WorkspacePolicy | many-to-one | `PublishEvent.policyId` → `WorkspacePolicy.id` |
| AuditLogEntries | one-to-many | AuditLogEntry records reference `PublishEvent.id` as `objectId`. |

#### Creation Trigger

A PublishEvent is created when a publish action is initiated by an agent or operator. If MCS publish policies require approval, the record is created in `pending` state and transitions to `approved` or `rejected` through the MCS approval state machine.

#### Update Lifecycle

```
pending → approved → published
        ↘           ↘
         rejected    failed (→ pending for retry)
```

The `status`, `approvedBy`, `approvedAt`, `externalUrl`, `failureReason`, and `retryCount` fields are mutable. All other fields MUST NOT be modified after creation.

#### Retention Expectations

PublishEvents MUST be retained indefinitely as part of the publish audit trail. They SHOULD never be deleted; they MAY be archived to cold storage after the referenced Artifact has been archived.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Lookup by `artifactId` — MUST be indexed.
- Filter by `status` — MUST be indexed (publish queue processing).
- Filter by `destination` — SHOULD be indexed (per-destination reporting).
- Filter by `publishedBy` — SHOULD be indexed (operator audit queries).

---

### 2.8 AuditLogEntry

An AuditLogEntry is an append-only record of every consequential event in the runtime. It provides a tamper-evident history for compliance, debugging, and operator oversight.

**TypeScript source:** No standalone TypeScript type currently defined. This spec formalizes AuditLogEntry as a first-class object.  
**In-memory store:** None currently. A dedicated append-only store is required for durable mode.  
**Archetype role:** Guardian (monitoring), MCS (governance)  
**MCS reference:** `ghostclaw_master_control_system.md` — Section 5: Audit Logging

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `eventType` | `string` | Canonical event type identifier. See Event Type Catalog below. |
| `objectType` | `string` | The type of runtime object involved (e.g., `Signal`, `Job`, `Artifact`). |
| `objectId` | `string` | The `id` of the runtime object involved. |
| `actorId` | `string` | Identity of the agent, operator, or system component that caused the event. |
| `timestamp` | `number` | Unix timestamp (milliseconds). MUST be immutable after creation. |
| `summary` | `string` | Human-readable description of the event. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Workspace context. SHOULD be populated for all workspace-scoped events. |
| `previousState` | `string` | Serialized previous state of the object (JSON string). |
| `newState` | `string` | Serialized new state of the object (JSON string). |
| `metadata` | `Record<string, unknown>` | Additional structured context for the event. |

#### Event Type Catalog

The following event types MUST be logged as AuditLogEntries:

| Event Type | Description |
|---|---|
| `signal.received` | A Signal was received by the runtime. |
| `plan.created` | A Plan was generated from a Signal. |
| `job.created` | A Job was created from a Plan. |
| `job.assigned` | A Job was assigned to an Agent. |
| `job.started` | A Job began execution. |
| `job.completed` | A Job completed successfully. |
| `job.failed` | A Job failed. |
| `job.retried` | A Job was re-queued after failure. |
| `skill_invocation.started` | A SkillInvocation began execution. |
| `skill_invocation.completed` | A SkillInvocation completed successfully. |
| `skill_invocation.failed` | A SkillInvocation failed. |
| `artifact.created` | An Artifact was created. |
| `artifact.validated` | An Artifact was validated by the Guardian. |
| `publish_event.initiated` | A publish action was initiated. |
| `publish_event.approved` | A publish action was approved. |
| `publish_event.rejected` | A publish action was rejected. |
| `publish_event.published` | An Artifact was published externally. |
| `publish_event.failed` | A publish action failed. |
| `policy.evaluated` | A WorkspacePolicy was evaluated. |
| `policy.violated` | A WorkspacePolicy was violated. |
| `operator.override` | An operator override was applied. |
| `system.emergency_stop` | An emergency stop was triggered. |

#### Relationships

AuditLogEntries reference runtime objects via `objectType` + `objectId` (a polymorphic reference pattern). They MUST NOT use foreign key constraints that would prevent recording events for deleted or archived objects.

#### Creation Trigger

An AuditLogEntry MUST be created for every event listed in the Event Type Catalog. AuditLogEntries MUST be written before returning control to the caller (synchronous, write-ahead semantics) in durable mode.

#### Update Lifecycle

AuditLogEntries are **strictly append-only**. No field MUST ever be modified after the record is created. Deletion is prohibited.

#### Retention Expectations

AuditLogEntries MUST be retained for a minimum of 7 years for compliance purposes (adjustable by workspace policy). They MUST NOT be deleted. They MAY be archived to cold storage after 12 months.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Filter by `objectType` + `objectId` — MUST be indexed (object event history).
- Filter by `eventType` — MUST be indexed (event type monitoring).
- Filter by `actorId` — MUST be indexed (actor audit trails).
- Filter by `timestamp` range — MUST be indexed (time-window queries).
- Filter by `workspaceId` — SHOULD be indexed (workspace-scoped audit).

---

### 2.9 WorkspacePolicy

A WorkspacePolicy is a declarative rule governing execution, publishing, or safety behavior within a workspace. Policies are evaluated by the MCS at runtime to gate or modify agent behavior.

**TypeScript source:** No standalone TypeScript type currently defined in `packages/`. This spec formalizes WorkspacePolicy as a first-class object.  
**In-memory store:** None currently. A dedicated policy store is required for durable mode.  
**Archetype role:** MCS (policy enforcement), Guardian (safety)  
**MCS reference:** `ghostclaw_master_control_system.md` — Section 2: Policy Enforcement Model

#### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique identifier. |
| `workspaceId` | `string` | The workspace to which this policy applies. |
| `policyType` | `string` | One of: `execution`, `publish`, `safety`, `workspace`. |
| `name` | `string` | Human-readable policy name. |
| `description` | `string` | Detailed description of what the policy governs. |
| `rules` | `Record<string, unknown>` | Structured policy rule definition. Schema is policy-type-specific. |
| `status` | `string` | One of: `active`, `inactive`. |
| `createdAt` | `number` | Unix timestamp (milliseconds) of creation. |
| `updatedAt` | `number` | Unix timestamp (milliseconds) of last modification. |

#### Optional Fields

| Field | Type | Description |
|---|---|---|
| `priority` | `number` | Evaluation priority when multiple policies apply. Higher values evaluated first. |
| `expiresAt` | `number` | Timestamp after which the policy automatically becomes `inactive`. |
| `createdBy` | `string` | Identity of the operator or system component that created the policy. |
| `updatedBy` | `string` | Identity of the last modifier. |
| `enforcementMode` | `string` | One of: `block` (prevent action), `warn` (log warning), `audit` (record only). |

#### Policy Type Definitions

| `policyType` | Governed Behavior |
|---|---|
| `workspace` | Operating boundaries, resource limits, concurrency caps. |
| `execution` | Which skills agents may invoke, retry limits, timeouts. |
| `publish` | What artifacts require approval before external publishing. |
| `safety` | Rate limits, cost caps, content moderation rules, emergency stops. |

#### Relationships

| Relation | Type | Target Object |
|---|---|---|
| PublishEvents | one-to-many | `PublishEvent.policyId` → `WorkspacePolicy.id` |
| AuditLogEntries | one-to-many | AuditLogEntries reference `WorkspacePolicy.id` via `objectId` when `objectType = 'WorkspacePolicy'`. |

#### Creation Trigger

WorkspacePolicies are created by operators or administrator-level actors via the MCS control interface. They MAY also be seeded from system defaults at workspace initialization.

#### Update Lifecycle

WorkspacePolicies are mutable. The `rules`, `status`, `priority`, `expiresAt`, `enforcementMode`, `updatedAt`, and `updatedBy` fields MAY be modified by authorized actors. The `id`, `workspaceId`, `policyType`, and `createdAt` fields MUST NOT be modified after creation. All modifications MUST produce an AuditLogEntry of type `policy.evaluated`.

#### Retention Expectations

WorkspacePolicies MUST be retained for the lifetime of their workspace. Inactive policies SHOULD be retained for audit purposes. Policies MUST NOT be hard-deleted; they SHOULD be soft-deleted by setting `status = 'inactive'`.

#### Indexing / Query Requirements

- Lookup by `id` — MUST be O(1) (primary key).
- Filter by `workspaceId` + `status` — MUST be indexed (active policy lookup at runtime).
- Filter by `policyType` + `status` — MUST be indexed (type-specific policy evaluation).
- Filter by `expiresAt` — SHOULD be indexed (expiry sweep jobs).

---

## 3. Storage Strategy

### 3.1 In-Memory Development Mode (Current State)

**Description:** All runtime objects are stored in JavaScript process memory using Map/Array stores. State is not durable across process restarts.

**Current implementations:**
- `runtimeStore` object in `packages/core/src/runtime_loop.ts` — stores Signals, Plans, Jobs, Artifacts, SkillInvocations in arrays.
- `InMemoryJobQueue` class in `packages/core/src/job_queue.ts` — stores Jobs with status transition logic.
- `InMemorySkillInvocationStore` class in `packages/core/src/skill_invocation.ts` — stores SkillInvocations.
- `InMemoryAgentRegistry` class in `packages/core/src/agent_registry.ts` — stores AgentDefinitions.
- `EventBus` class in `packages/core/src/event_bus.ts` — in-process pub/sub with no persistence.
- `getRuntimeStatus()` and related functions in `packages/core/src/runtime_monitor.ts` — derive status from in-memory stores.

**Characteristics:**
- Zero infrastructure dependencies. Suitable for local development and automated testing.
- No durability. All state is lost on process exit.
- No concurrency safety. Single-threaded JavaScript execution provides implicit serialization.
- Assignment and PublishEvent objects do not yet have dedicated stores; they are represented implicitly in other objects.
- AuditLogEntry and WorkspacePolicy objects have no implementation; they are deferred to durable mode.

**Limitations:**
- Cannot support multi-process or distributed deployment.
- Cannot survive process crashes.
- Cannot support audit or compliance requirements.
- Cannot scale beyond single-process memory limits.

### 3.2 Single-Node Durable Mode

**Description:** All runtime objects are persisted to PostgreSQL. Redis is used for job queue operations (dequeue, status transitions). Artifacts are stored in a file system or object store (S3-compatible). The EventBus is replaced by a persistent message broker (e.g., Redis Pub/Sub or PostgreSQL LISTEN/NOTIFY).

**Object-to-store mapping:**

| Object | Primary Store | Notes |
|---|---|---|
| Signal | PostgreSQL table | Append-only; index on `name`, `createdAt`. |
| Plan | PostgreSQL table | Index on `signalId`, `action`, `createdAt`. |
| Job | PostgreSQL table + Redis queue | Redis sorted set for queue ordering; Postgres for authoritative state. |
| Assignment | PostgreSQL table | Index on `jobId`, `agentId`. |
| SkillInvocation | PostgreSQL table | Index on `jobId`, `agentId`, `skillId`, `status`. |
| Artifact | PostgreSQL table + object store | `content` field stores object key; actual bytes in S3-compatible store. |
| PublishEvent | PostgreSQL table | Append-heavy; index on `artifactId`, `status`, `destination`. |
| AuditLogEntry | PostgreSQL append-only table | Partitioned by `timestamp`; no UPDATE/DELETE permissions. |
| WorkspacePolicy | PostgreSQL table | Index on `workspaceId` + `status` + `policyType`. |

**Migration path from in-memory mode:**
1. Replace `InMemoryJobQueue` with a `PostgresJobQueue` implementing the same interface.
2. Replace `InMemorySkillInvocationStore` with a `PostgresSkillInvocationStore` implementing the same interface.
3. Replace `InMemoryAgentRegistry` with a `PostgresAgentRegistry` or seed from configuration.
4. Replace `runtimeStore` arrays with Postgres-backed repositories for Signal, Plan, Artifact.
5. Add `AssignmentRepository`, `PublishEventRepository`, `AuditLogRepository`, and `WorkspacePolicyRepository` as new first-class components.
6. Replace `EventBus` with a persistent event broker.

**Runtime monitor:** `packages/core/src/runtime_monitor.ts` functions (`getRuntimeStatus`, `getQueueStatus`, etc.) MUST be updated to query the durable stores rather than in-memory arrays.

### 3.3 Future Distributed / Event-Driven Mode

**Description:** The runtime is decomposed into independent services communicating via durable event streams. All state changes are represented as immutable events (event sourcing). Read models are derived via CQRS projections. Multi-node replication is supported.

**Key architectural patterns:**

| Pattern | Application |
|---|---|
| Event sourcing | All state transitions become append-only domain events in an event log (e.g., Kafka, EventStoreDB). |
| CQRS | Write side: command handlers emit events. Read side: projections build materialized views for queries. |
| Saga / process manager | Long-running workflows (Signal → Plan → Job → Artifact → Publish) are orchestrated via durable sagas. |
| Multi-node replication | Event log partitioned by `workspaceId`; nodes process events for assigned partitions. |
| Idempotent processing | All event handlers MUST be idempotent to support at-least-once delivery semantics. |

**Object treatment:**

- Signal, Plan, Job, Assignment, SkillInvocation, Artifact, PublishEvent become **event-sourced aggregates** — their current state is derived by replaying their event history.
- AuditLogEntry is the **canonical event store** — all domain events are AuditLogEntries. Additional query models are projections.
- WorkspacePolicy is a **configuration aggregate** — changes are event-sourced but state is projected into a fast in-memory cache per node.

**Consistency guarantees:**
- Within a single workspace partition: **strong consistency** (ordered event log per partition).
- Across workspace partitions: **eventual consistency** (asynchronous event propagation).

---

## 4. Implementation Guidance

### 4.1 File-to-Object Ownership Map

| TypeScript File | Owned Objects | Notes |
|---|---|---|
| `packages/core/src/runtime_loop.ts` | Signal, Plan, Artifact (partial) | Defines types and `runtimeStore`. `Job` re-exported from `job_queue.ts`. |
| `packages/core/src/job_queue.ts` | Job | `InMemoryJobQueue` and `QueueJob` type. |
| `packages/core/src/skill_invocation.ts` | SkillInvocation | `InMemorySkillInvocationStore` and `SkillInvocation` type. |
| `packages/core/src/agent_registry.ts` | (AgentDefinition) | Supports Assignment via `findAgentForJob()`. Does not own Assignment records. |
| `packages/core/src/job_executor.ts` | (execution logic) | Creates SkillInvocations and Artifacts during execution. |
| `packages/core/src/event_bus.ts` | (event infrastructure) | No persisted objects; will be replaced in durable mode. |
| `packages/core/src/runtime_monitor.ts` | (read queries) | Reads from all in-memory stores. |
| `packages/planner/src/signal_router.ts` | (PlannerDecision) | Produces data used to construct Plan records. |
| `packages/shared/src/types/planner_strategy.ts` | (PlannerStrategy) | Defines `StrategyType` referenced by Plan. |

### 4.2 Gaps Between Spec and Current Implementation

The following objects are specified in this document but have **no current TypeScript type or store**:

| Object | Gap | Required Action |
|---|---|---|
| Assignment | Implicit in `Job.assignedAgent`; no dedicated record or type. | Create `Assignment` TypeScript type and store in `packages/core/src/assignment.ts`. Update job execution flow to create Assignment records. |
| PublishEvent | No type or store exists. | Create `PublishEvent` TypeScript type and store in `packages/core/src/publish_event.ts`. |
| AuditLogEntry | No type or store exists. | Create `AuditLogEntry` TypeScript type and append-only store in `packages/core/src/audit_log.ts`. Wire all state transitions to emit entries. |
| WorkspacePolicy | No type or store exists. | Create `WorkspacePolicy` TypeScript type and store in `packages/core/src/workspace_policy.ts`. Wire MCS policy evaluation to load policies from store. |

### 4.3 Changes Required to Reach Durable Mode

The following changes MUST be made to migrate from in-memory to single-node durable mode:

1. **Extract store interfaces.** Define TypeScript interfaces (`ISignalStore`, `IPlanStore`, `IJobQueue`, `ISkillInvocationStore`, `IArtifactStore`, `IAssignmentStore`, `IPublishEventStore`, `IAuditLog`, `IWorkspacePolicyStore`) so that in-memory and Postgres implementations are interchangeable.

2. **Add `workspaceId` to Signal, Plan, Job, Artifact.** These objects currently lack workspace scoping. The field is REQUIRED for multi-tenant durable deployments.

3. **Add `Assignment` type and store.** See gaps above.

4. **Add `PublishEvent` type and store.** See gaps above.

5. **Add `AuditLogEntry` type and store.** See gaps above. Wire `EventBus` emissions to produce AuditLogEntries.

6. **Add `WorkspacePolicy` type and store.** See gaps above.

7. **Update `runtime_monitor.ts`.** Replace direct array access with store interface queries.

8. **Replace `EventBus` with a durable broker.** The current `EventBus` has no persistence. In durable mode, use Redis Pub/Sub or PostgreSQL LISTEN/NOTIFY so events survive process restart.

9. **Add `contentUri` to `Artifact`.** Move large artifact content to object storage and store the URI reference in the database.

10. **Enforce append-only semantics for AuditLogEntry.** Database roles for the audit log table MUST NOT have UPDATE or DELETE privileges.

### 4.4 Alignment with Existing TypeScript Types

All required fields defined in Section 2 align directly with the existing TypeScript types in the listed source files. The following deviations are noted:

| Field | Spec Requirement | Current Implementation |
|---|---|---|
| `Signal.workspaceId` | SHOULD for durable mode | Not present in current `Signal` type. |
| `Plan.priority` | Optional | Not present in current `Plan` type (available in `PlannerDecision`). |
| `Plan.requiredAgents` | Optional | Not present in current `Plan` type (available in `PlannerDecision`). |
| `Artifact.workspaceId` | SHOULD for durable mode | Not present in current `Artifact` type. |
| `Artifact.contentUri` | Optional | Not present in current `Artifact` type. |
| `Artifact.validationStatus` | Optional | Not present in current `Artifact` type. |

No breaking changes to existing required fields are introduced by this spec. All additions are optional fields or new objects.

---

## 5. Summary of Object Lifecycle States

| Object | Terminal States | Append-Only |
|---|---|---|
| Signal | None (immutable after creation) | Yes |
| Plan | None (immutable after creation) | Yes |
| Job | `completed`, `failed` | No |
| Assignment | `revoked` (soft) | No (but revocation is additive) |
| SkillInvocation | `completed`, `failed`, `cancelled` | No |
| Artifact | None (immutable after creation) | Yes |
| PublishEvent | `published`, `failed`, `rejected` | No |
| AuditLogEntry | N/A (strictly append-only) | Yes |
| WorkspacePolicy | `inactive` (soft delete) | No |
