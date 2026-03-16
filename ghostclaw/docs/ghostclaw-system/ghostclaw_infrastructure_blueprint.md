# GhostClaw Infrastructure Blueprint

GhostClaw is an AI agent runtime, capability marketplace, and autonomous company factory. It receives signals, plans work through a structured planner layer, executes through agents and skills, and persists all state for auditability and recovery. This document defines the infrastructure, storage, integration, and deployment specification for implementing and operating GhostClaw.

> **Cross-references:** [`ghostclaw_runtime_execution_spec.md`](ghostclaw_runtime_execution_spec.md) · [`ghostclaw_master_control_system.md`](ghostclaw_master_control_system.md) · [`ghostclaw_skill_registry.md`](ghostclaw_skill_registry.md) · `packages/core/src/`

---

## System Topology

GhostClaw operates across three node types:

```
GhostClaw Core   — cloud control node; canonical production runtime
GhostClaw Forge  — local development node; never exposed as production
GhostClaw Edge   — optional distributed execution endpoints
```

### GhostClaw Core (Cloud Control Node)

Central runtime host. Runs all production services: dashboard, API, runtime engine, planner, job workers, persistence, artifact storage, reverse proxy, and monitoring.

**Minimum VM specification:**

```
CPU:     8 vCPU
RAM:     32 GB
Storage: 320 GB NVMe
OS:      Ubuntu 24.04 LTS
Network: Static IP, nightly snapshots
```

Recommended providers: DigitalOcean General Purpose, AWS EC2 M7i, Hetzner Cloud.

### GhostClaw Forge (Local Development Node)

Development and testing environment. Runs the full monorepo, local runtime, CI pipelines, local model experiments, and browser automation. Not exposed publicly.

**Recommended workstation:**

```
CPU:        Ryzen 9 9950X
RAM:        128 GB
GPU:        RTX 5090 (preferred)
OS Drive:   2 TB NVMe
Data Drive: 4 TB NVMe
OS:         Ubuntu 24.04 LTS
```

### GhostClaw Edge (Optional Node)

Lightweight distributed execution nodes. Connect back to Core API. Used for remote signal collection, distributed agent execution, or embedded hardware endpoints.

**Example hardware:** NVIDIA Jetson Orin Nano (6-core ARM, 8 GB RAM, 7–25 W).

---

## Core Services

All services run on GhostClaw Core in production. Each has a well-defined responsibility boundary. See [Runtime Infrastructure Boundaries](#runtime-infrastructure-boundaries) for inter-service communication.

| Service | Responsibility |
|---|---|
| `ghostclaw-web` | Operator dashboard. System state visualization, approval UI, policy management. Maps to `apps/dashboard/`. |
| `ghostclaw-api` | HTTP gateway. Signal intake, command routing, authentication, marketplace access. Maps to `apps/api/`. |
| `ghostclaw-runtime` | Job lifecycle orchestration. Queue processing, executor dispatch, artifact collection. Maps to `packages/core/src/runtime_loop.ts`, `job_queue.ts`, `job_executor.ts`. |
| `ghostclaw-planner` | Signal interpretation and plan generation. Strategy selection and agent coordination. Maps to `packages/core/src/planner_registry.ts`, `packages/planner/src/signal_router.ts`. |
| `ghostclaw-worker` | Agent execution host. Runs skill invocations, tool calls, and content generation tasks. |
| `postgres` | Canonical persistent state for all runtime objects (plans, jobs, assignments, invocations, artifacts, audit logs, policies). |
| `redis` | Job queue coordination, caching, and pub/sub transport (future event bus backend). |
| `artifact-storage` | Output file storage. Filesystem, MinIO, or S3-compatible. |
| `reverse-proxy` | HTTPS termination, routing, and TLS certificate management. Recommended: Caddy. |
| `monitoring` | System health and metrics. Uptime Kuma + Prometheus + Grafana. |

---

## Storage Domain Mapping

All runtime state is partitioned into eight storage domains. Each domain maps to specific TypeScript types in `packages/core/src/`. In the current implementation, domains use in-memory stores; production deployment targets PostgreSQL for all durable domains.

> See `ghostclaw_runtime_execution_spec.md` §Persistence Layer and `ghostclaw_master_control_system.md` §Audit Logging for additional context.

---

### 1. Workspace State

Workspace configuration, policy sets, and scope boundaries. Governs the operating context for all runtime activity within a workspace.

**Record structure:**

| Field | Type | Description |
|---|---|---|
| `workspaceId` | string | Canonical workspace identifier |
| `name` | string | Human-readable workspace name |
| `policySetIds` | string[] | Active policy set references |
| `scopeBoundaries` | object | Resource and permission limits |
| `createdAt` | number | Creation timestamp |
| `updatedAt` | number | Last modification timestamp |
| `version` | number | Monotonic version counter |

**Owner:** Master Control System (MCS).

**Written:** On workspace creation; on any policy modification by an Operator or Administrator.

**Read:** On every MCS policy evaluation — before plan approval, before job execution, before publish actions.

**Retention:** Indefinite. All versions retained with full change history.

---

### 2. Plan State

Plan records produced by the planner in response to signals. Corresponds to the `Plan` type in `packages/core/src/runtime_loop.ts`.

**Record structure (`Plan` type — `runtime_loop.ts`):**

| Field | Type | Description |
|---|---|---|
| `id` | string | Plan identifier (e.g., `plan_1`) |
| `signalId` | string | Reference to originating signal |
| `action` | `PlannerAction` | Resolved planner action |
| `strategyId` | string | Strategy used for planning |
| `strategyType` | `StrategyType` | Strategy classification |
| `createdAt` | number | Unix timestamp (ms) |

**Owner:** Planner (`packages/core/src/planner_registry.ts`, `runtime_loop.ts`).

**Written:** When `createPlan()` executes in `runtime_loop.ts` — immediately after signal intake.

**Read:** By job creation (to derive job types), by the dashboard for status display, by analytics for plan-to-outcome tracing.

**Retention:** Indefinite. Plans are the audit anchor for downstream jobs and artifacts.

---

### 3. Job State

Job records throughout their execution lifecycle. Corresponds to the `QueueJob` type in `packages/core/src/job_queue.ts`.

**Record structure (`QueueJob` type — `job_queue.ts`):**

| Field | Type | Description |
|---|---|---|
| `id` | string | Job identifier |
| `planId` | string | Reference to parent plan |
| `jobType` | string | Type of work (e.g., `draft_cluster_outline`) |
| `assignedAgent` | string \| null | Agent name, or null if unassigned |
| `status` | `JobStatus` | `queued \| assigned \| running \| completed \| failed` |
| `inputPayload` | object | Signal name and payload forwarded to executor |
| `outputPayload` | object \| null | Execution result; null until completed |
| `retryCount` | number | Number of execution attempts |
| `createdAt` | number | Unix timestamp (ms) |
| `updatedAt` | number | Unix timestamp (ms) of last status change |

**Owner:** `InMemoryJobQueue` (`job_queue.ts`), `job_executor.ts`.

**Written:** On `enqueue()` (status: `queued`); on `dequeue()` (status: `assigned`); on `markRunning()` (status: `running`); on `markComplete()` or `markFailed()` (status: `completed` or `failed`).

**Read:** By the executor to select the next job, by the runtime monitor for status polling, by the dashboard for job list views, by analytics for throughput metrics.

**Retention:** Indefinite. Failed jobs retained without purge for post-mortem diagnostics.

---

### 4. Assignment State

Assignment records linking an agent to a specific job at a specific point in time. Currently generated inline in `job_executor.ts` (`assignmentId = assign_${job.id}`).

**Record structure:**

| Field | Type | Description |
|---|---|---|
| `assignmentId` | string | Assignment identifier |
| `agentId` | string | Selected agent name |
| `jobId` | string | Job being assigned |
| `reason` | string | Selection rationale (capability match) |
| `fallbackAgents` | string[] | Ordered fallback candidates, if any |
| `timestamp` | number | Unix timestamp (ms) of assignment |

**Owner:** `job_executor.ts` (assignment logic); to be extracted into a dedicated assignment module.

**Written:** When `executeJobs()` calls `agentRegistry.findAgentForJob(jobType)` and assigns the result to a job.

**Read:** By the audit log (every assignment is a consequential event per MCS spec), by the monitor, by the dashboard for job detail views.

**Retention:** Indefinite.

---

### 5. Skill Invocation History

Full lifecycle records for each skill invocation. Corresponds to the `SkillInvocation` type in `packages/core/src/skill_invocation.ts`.

**Record structure (`SkillInvocation` type — `skill_invocation.ts`):**

| Field | Type | Description |
|---|---|---|
| `id` | string | Invocation identifier |
| `workspaceId` | string | Owning workspace |
| `planId` | string | Parent plan |
| `jobId` | string | Parent job |
| `assignmentId` | string | Assignment that triggered this invocation |
| `agentId` | string | Executing agent |
| `skillId` | string | Skill being invoked |
| `status` | `SkillInvocationStatus` | `pending \| running \| failed \| completed \| cancelled` |
| `inputPayload` | object | Input forwarded to the skill |
| `outputPayload` | object \| null | Skill output; null until completed |
| `artifactIds` | string[] | IDs of artifacts produced |
| `error` | string \| null | Error message if failed |
| `retryCount` | number | Retry attempts |
| `fallbackUsed` | boolean | Whether a fallback skill was substituted |
| `startedAt` | number | Unix timestamp (ms) |
| `completedAt` | number \| null | Unix timestamp (ms); null until completed |

**Owner:** `InMemorySkillInvocationStore` (`skill_invocation.ts`).

**Written:** On invocation creation (`create()`); on each status transition via `updateStatus()`.

**Read:** By `runtime_monitor.ts` for real-time status, by the audit log for every state transition, by analytics for skill performance metrics, by the dashboard for invocation detail views.

**Retention:** Indefinite.

---

### 6. Artifacts

Output records produced at job execution completion. Corresponds to the `Artifact` type in `packages/core/src/runtime_loop.ts`.

**Record structure (`Artifact` type — `runtime_loop.ts`):**

| Field | Type | Description |
|---|---|---|
| `id` | string | Artifact identifier (e.g., `artifact_${jobId}`) |
| `jobId` | string | Job that produced the artifact |
| `skillInvocationId` | string | Invocation that produced the artifact |
| `type` | string | Artifact type (maps to job type) |
| `content` | string | Artifact content or reference path |
| `createdAt` | number | Unix timestamp (ms) |

**Owner:** `job_executor.ts` (creation); `runtimeStore.artifacts` array in `runtime_loop.ts` (in-memory aggregation).

**Written:** On successful job execution, after `markComplete()` is called.

**Read:** By the dashboard for artifact display, by the publish pipeline for output delivery, by the marketplace for listing candidates.

**Retention:** Indefinite for metadata records. Large binary artifact files may be moved to cold storage after 90 days.

---

### 7. Audit Logs

Append-only event records for all consequential runtime activity. Defined in `ghostclaw_master_control_system.md` §Audit Logging.

**Record structure:**

| Field | Type | Description |
|---|---|---|
| `event_type` | string | Category of event (see below) |
| `actor` | string | Role or identity that triggered the event |
| `timestamp` | number | Unix timestamp (ms) |
| `target_object` | string | ID of the affected object |
| `result` | string | `success \| failure \| rejected \| override` |
| `context` | object | Event-specific metadata |

**Event categories:** signal intake, plan creation, job execution, skill invocations, approval decisions, publish actions, policy evaluations, failures, operator overrides, system events.

**Owner:** MCS audit subsystem.

**Written:** On every consequential runtime event — signal intake, `createPlan()`, job status transitions, `skill.invocation.*` events, approval state machine transitions, publish operations, policy evaluations, failures, and operator overrides.

**Read:** By operators via the dashboard, by compliance queries, by the MCS for override validation.

**Retention:** Append-only; records are never deleted or modified. Minimum 365-day retention per workspace. Retention duration is configurable per workspace by Operators.

---

### 8. Policy Configurations

Declarative policy definitions that govern all runtime behavior. Defined in `ghostclaw_master_control_system.md` §Policy Categories.

**Policy categories:**

| Category | Governs |
|---|---|
| Workspace Policies | Operating boundaries, permitted agent types, resource limits |
| Execution Policies | Permitted agent actions, skill invocation limits, timeout thresholds |
| Publish Policies | What requires operator approval before external publication |
| Safety Policies | Rate limits, API cost caps, content moderation rules |

**Owner:** MCS policy subsystem.

**Written:** On policy creation or modification by an Operator or Administrator. No other role may modify policies.

**Read:** On every MCS policy evaluation — before plan approval, before job assignment, before skill execution, before publish actions.

**Retention:** Indefinite. Full version history retained; no policy record is deleted.

---

## Runtime Infrastructure Boundaries

Each component has a defined process boundary, responsibility, and communication contract.

| Component | Process | Responsibility | Communicates With |
|---|---|---|---|
| API Layer | `ghostclaw-api` | HTTP gateway. Signal intake, command routing, authentication. Entry point for all external requests. | Dashboard (inbound), MCS (policy check), Runtime Engine (job dispatch) |
| Runtime Engine | `ghostclaw-runtime` | Job lifecycle management. Queue processing, executor orchestration, artifact collection. Maps to `runtime_loop.ts`, `job_queue.ts`, `job_executor.ts`. | Planner (plan creation), Event Bus (event emission), Persistence Layer (state writes) |
| Planner | `ghostclaw-planner` | Signal interpretation, plan generation, strategy selection. Maps to `planner_registry.ts`, `signal_router.ts`. | Runtime Engine (returns plan), MCS (policy pre-check before plan commit) |
| Event Bus | In-process (`event_bus.ts`) | Pub/sub for runtime events: `skill.invocation.started`, `skill.invocation.completed`, `skill.invocation.failed`. Future backend: Redis Streams or NATS. | All components (emit and subscribe) |
| Registries | In-process (`agent_registry.ts`, `planner_registry.ts`) | Agent definitions, capability maps, planner strategy definitions. | Runtime Engine (agent lookup), Planner (strategy lookup) |
| Dashboard | `ghostclaw-web` | Operator console. System state visualization, approval UI, policy management interface. | API Layer (all reads and writes via HTTP) |
| Persistence Layer | PostgreSQL + filesystem/S3 | Canonical durable store for all eight storage domains. In development: in-memory stores (`InMemoryJobQueue`, `InMemorySkillInvocationStore`, `InMemoryAgentRegistry`). | Runtime Engine, MCS, Dashboard (via API Layer) |

**Current implementation notes:**

- `InMemoryJobQueue` (`job_queue.ts`) and `InMemorySkillInvocationStore` (`skill_invocation.ts`) are the active persistence implementations. Both expose interfaces designed for adapter substitution.
- `event_bus.ts` is an in-process synchronous emitter. It must be replaced with an out-of-process broker before the Runtime Engine and Worker are separated into distinct processes.
- Assignment state is generated inline in `job_executor.ts` (`assignmentId = assign_${job.id}`). A dedicated assignment module must be extracted before assignment records can be persisted as a first-class storage domain and included in the audit trail. This is a required prerequisite for Phase 2 (runtime persistence).

---

## Integration Architecture

### Model Providers

The Runtime Engine routes model calls through an abstraction layer that decouples skill execution from specific LLM providers. Each workspace may specify a default model provider in its Workspace Policy. Skills declare model requirements as inputs; the executor resolves provider configuration at runtime.

- Provider configuration is stored in Workspace State (policy-scoped).
- Model calls are subject to Safety Policies (rate limits, cost caps).
- All model calls are recorded in Skill Invocation History with input/output payloads.

### External APIs

Skills may invoke external APIs (search data APIs, analytics APIs, third-party services) as part of their execution. All outbound API calls are:

- Subject to Safety Policies defined in the MCS (rate limiting, cost cap enforcement per workspace).
- Logged in Skill Invocation History (`inputPayload` records the request context).
- Failures surfaced as `skill.invocation.failed` events on the Event Bus.

### Webhooks

GhostClaw accepts inbound signals via webhook endpoints served by the API Layer (`ghostclaw-api`). Webhook processing:

1. Inbound HTTP request received at a configured webhook endpoint.
2. Request validated (signature verification, source allowlist).
3. Payload normalized into a `Signal` record.
4. Signal routed to the signal intake layer for plan creation.

Webhook endpoint configuration is stored in Workspace State. Signal routing behavior is defined by `packages/planner/src/signal_router.ts`.

### Publish Targets

Artifacts and content produced by the Runtime Engine may be delivered to external destinations. All publish operations are gated by MCS Publish Policies and require operator approval if configured.

| Target | Description |
|---|---|
| Websites | Direct deployment of generated content to web properties |
| Ghost Mart listings | Skill and agent packages published to the capability marketplace |
| External platforms | Third-party integrations (social, analytics, distribution channels) |

Publish events are recorded in the Audit Log with actor, target, result, and policy evaluation outcome.

### Ghost Mart Package and Install Sources

Ghost Mart is the GhostClaw capability marketplace. Skills are distributed as signed packages and installed into workspaces via the install command system.

**Package lifecycle:**

1. Skill author defines a skill record per `ghostclaw_skill_registry.md` (skill_id, inputs, outputs, dependencies, install_command).
2. Package is signed and submitted to Ghost Mart.
3. Ghost Mart validates signature, checks dependencies, and assigns `marketplace_status: installable`.
4. Install command resolves dependencies and registers the skill in the workspace's skill registry.
5. Installed skills become available to the planner for job-to-skill mapping.

**Security:** Package signatures are verified before installation. Dependency conflicts are reported at install time. Workspace Policies may restrict which skill categories are installable.

---

## Deployment Topology

### Local Development (Forge)

- All services run as local Node.js processes or Docker Compose stack.
- PostgreSQL and Redis run in containers; all other services run as `ts-node` or compiled Node processes.
- In-memory stores (`InMemoryJobQueue`, `InMemorySkillInvocationStore`, `InMemoryAgentRegistry`) are active; persistent adapters are injected by swapping the store implementation.
- Event Bus remains in-process (`event_bus.ts`); no external broker required.
- No reverse proxy required; services accessed directly on localhost ports.
- Development runtime is exercised via `__tests__/` (Jest test suite).

### Single-Node Production (Core)

- Docker Compose on single VM (8 vCPU, 32 GB RAM, 320 GB NVMe).
- All services containerized: `ghostclaw-web`, `ghostclaw-api`, `ghostclaw-runtime`, `ghostclaw-planner`, `ghostclaw-worker`.
- PostgreSQL 16 and Redis in containers with named volume mounts for persistence.
- Caddy as reverse proxy with automatic HTTPS (Let's Encrypt).
- Artifact storage on local filesystem or MinIO container; MinIO recommended for S3-compatible API compatibility.
- Nightly database backups exported to external storage or S3.
- Monitoring: Uptime Kuma (uptime checks) + Prometheus (metrics scraping) + Grafana (dashboards).
- All in-memory stores replaced with PostgreSQL-backed adapter implementations.

### Future Distributed Deployment

- Kubernetes cluster with one pod per service type.
- PostgreSQL as managed service (AWS RDS, Google Cloud SQL, or equivalent managed Postgres).
- Redis as managed service (AWS ElastiCache, Redis Cloud) or self-managed Redis Cluster.
- Event Bus migrated from in-process `event_bus.ts` to Redis Streams or a dedicated message broker (NATS or RabbitMQ).
- Artifact storage on S3 or S3-compatible object store.
- Worker pods scaled horizontally; job queue partitioned by queue type (strategic, operational, growth, marketplace, company — per `ghostclaw_runtime_execution_spec.md`).
- Edge nodes operate as lightweight agent-runner pods connecting to Core API over authenticated HTTP.

---

## Monorepo Structure

GhostClaw uses a single canonical monorepo.

```
ghostclaw/

apps/
    dashboard/        # ghostclaw-web — operator console
    api/              # ghostclaw-api — HTTP gateway
    runtime/          # ghostclaw-runtime — job lifecycle engine
    planner/          # ghostclaw-planner — signal interpretation
    worker/           # ghostclaw-worker — agent execution host
    marketplace/      # Ghost Mart interface

packages/
    core/             # Runtime types and in-memory stores (job_queue, job_executor, skill_invocation, agent_registry, planner_registry, event_bus, runtime_loop, runtime_monitor)
    agent-sdk/        # Agent development interface
    skill-registry/   # Skill record definitions
    runtime-types/    # Shared TypeScript types
    signals/          # Signal definitions
    prompts/          # LLM prompt templates
    ui/               # Shared UI components

infrastructure/
    docker/
    compose/
    cloud-init/
    backups/
    observability/

docs/
    ghostclaw-system/

data/
    artifacts/
    logs/
    seeds/

scripts/
```

---

## Core Runtime Flow

The runtime executes a deterministic signal-to-artifact pipeline on every signal intake. See `ghostclaw_runtime_execution_spec.md` for the full layer-by-layer specification.

```
Signal intake
    ↓
Plan creation (signal_router → planner_registry)
    ↓
Job creation and enqueue (job_queue)
    ↓
Agent assignment (agent_registry)
    ↓
Skill invocation (job_executor → skill_invocation)
    ↓
Artifact generation
    ↓
Validation
    ↓
State persistence (all domains written)
    ↓
Output delivery
    ↓
Follow-up signal (optional)
```

**Step notes:**

1. **Signal** — originates from user command via API, inbound webhook, marketplace trigger, or internal scheduler. Stored in `runtimeStore.signals`.
2. **Plan creation** — `routeSignal()` resolves `PlannerAction` and `strategyId`; `createPlan()` constructs the `Plan` record.
3. **Job creation** — `createJobs()` maps `PlannerAction` to one or more job types; each job enqueued via `jobQueue.enqueue()`.
4. **Agent assignment** — `agentRegistry.findAgentForJob(jobType)` returns the first capable agent; assignment record created.
5. **Skill invocation** — handler for job type executes; `SkillInvocation` record created and updated through `pending → running → completed/failed`.
6. **Artifact generation** — on success, `Artifact` record created and stored.
7. **Validation** — output quality checks applied before publish operations.
8. **State persistence** — all records written to the Persistence Layer.
9. **Output delivery** — results delivered to dashboard, marketplace, API response, or external integration.
10. **Follow-up signal** — completion may trigger a downstream signal, continuing the execution loop.

---

## Software Stack

| Layer | Technology |
|---|---|
| Operating System | Ubuntu 24.04 LTS |
| Runtime | Node.js 22 LTS |
| Language | TypeScript |
| Primary Database | PostgreSQL 16 |
| Cache / Queue | Redis |
| Containerization | Docker, Docker Compose |
| Orchestration (future) | Kubernetes |
| Reverse Proxy | Caddy (production) |
| Package Manager | pnpm or npm workspaces |
| Version Control | GitHub |
| CI/CD | GitHub Actions |
| Monitoring | Uptime Kuma, Prometheus, Grafana |
| Artifact Storage | Filesystem / MinIO / S3 |

---

## Naming System

The following names are canonical across all code, infrastructure, documentation, and configuration.

| Name | Role |
|---|---|
| GhostClaw Core | Cloud control node — production runtime host |
| GhostClaw Forge | Local development node |
| GhostClaw Edge | Distributed execution endpoint |
| GhostClaw Runtime | Execution engine (`ghostclaw-runtime`) |
| GhostClaw Planner | Signal interpretation and plan generation (`ghostclaw-planner`) |
| GhostClaw Marketplace | Capability marketplace (Ghost Mart) |
| GhostClaw Factory | Autonomous company creation system |

---

## Phase Roadmap

### Phase 1 — Initial Deployment

- Provision GhostClaw Core VM.
- Harden Linux, install Docker, configure PostgreSQL and Redis.
- Deploy `ghostclaw-api` and `ghostclaw-web`.
- Launch minimal runtime worker with in-memory stores.
- Connect domain, configure Caddy for HTTPS.

### Phase 2 — Runtime Persistence

- Extract assignment logic from `job_executor.ts` into a dedicated assignment module; implement Assignment State as a first-class persisted domain.
- Replace in-memory stores with PostgreSQL-backed adapters for all eight storage domains.
- Deploy `ghostclaw-runtime` and `ghostclaw-planner` as containerized services.
- Enable audit logging to the Audit Log domain.
- Configure monitoring stack (Uptime Kuma, Prometheus, Grafana).
- Activate workspace policy enforcement via MCS.

### Phase 3 — Self-Development Loop

- GhostClaw reads its own backlog, proposes features, generates documentation, and produces code drafts.
- Requires: approval gates for generated output, operator review workflow, full skill invocation history.

### Phase 4 — Capability Marketplace

- Launch Ghost Mart with installable skill packages.
- Enable skill package signing, dependency resolution, and install command execution.
- Operator controls for skill allowlists per workspace.

### Phase 5 — Autonomous Company Factory

- GhostClaw instantiates workspace configurations for autonomous business operations.
- Each company runs as a scoped workspace with dedicated policies, agent assignments, and publish targets.
- Requires: multi-workspace MCS support, per-workspace audit logs, isolated publish pipelines.
