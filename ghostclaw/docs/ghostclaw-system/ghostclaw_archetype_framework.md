# GhostClaw Archetype Framework: Runtime Role Specification

---

## 1. Overview

The GhostClaw Archetype Framework defines the seven canonical behavioral roles within GhostClaw OS. Each archetype maps to a distinct runtime responsibility, a set of authorized actions, and a collection of runtime objects it owns or produces. The framework gives the system a coherent internal grammar: every agent, every signal, and every capability falls under exactly one archetype.

This document is a **runtime role specification**. It governs how archetypes are instantiated, how skills are bound to them, how workspace policies constrain their privileges, and how they coordinate at runtime.

### 1.1 Rationale

Structuring the system around archetypes provides:

- A single, consistent mental model for operators, developers, and AI agents.
- Explicit authority boundaries — each archetype knows exactly what it may and may not do.
- A foundation for governance: workspace policies, approval gates, and audit logging all reference archetype identity.
- Self-expansion: The Forge and Marketplace archetypes allow GhostClaw to grow its own capability surface without architectural rewrites.

### 1.2 Related Documents

| Document | Relationship |
|---|---|
| [`ghostclaw_runtime_execution_spec.md`](./ghostclaw_runtime_execution_spec.md) | Runtime execution layers this spec maps archetypes onto |
| [`ghostclaw_master_control_system.md`](./ghostclaw_master_control_system.md) | MCS governance, workspace policies, approval gates |
| [`ghostclaw_agent_registry.md`](./ghostclaw_agent_registry.md) | Agent definitions and capability registration |
| [`ghostclaw_system_glossary.md`](./ghostclaw_system_glossary.md) | Canonical term definitions |
| [`ghostclaw_concepts.md`](./ghostclaw_concepts.md) | Canonical concepts entry point |

---

## 2. Canonical Definition

> **An Archetype is a predefined behavioral role template that defines how an AI agent plans, decides, and executes work within GhostClaw OS.**

Every agent registered in `packages/core/src/agent_registry.ts` MUST declare an archetype. The archetype determines which capabilities the agent is permitted to register, which runtime objects it may produce, and what system-level privileges it holds.

---

## 3. Archetype Specifications

### 3.1 Signal

**Runtime Role Summary:** Opportunity or problem event entering the runtime.

#### Responsibilities

- Represent a detected opportunity, problem, or scheduled trigger entering GhostClaw OS.
- Carry a typed name and structured payload sufficient for the Mentor to generate a plan.
- Persist in the runtime store for audit and replay.

#### Decision Scope

- The Signal archetype makes no decisions. It is a data object, not an agent.
- Signal routing decisions belong to the Mentor archetype (via `routeSignal()` in `packages/planner/src/signal_router.ts`).

#### Allowed Actions

- Emit into the runtime via `processSignal()`.
- Carry arbitrary structured payload (`Record<string, unknown>`).

#### Default Skills

- None. Signal is not an agent archetype; it has no attached skills.

#### Runtime Privileges

- **Read:** None (passive input object).
- **Write:** Appended to `runtimeStore.signals` on creation.
- **Emit:** Entry point for `processSignal()`.
- Signal objects are **immutable** after creation. No agent or skill may modify a signal once persisted.

---

### 3.2 Mentor

**Runtime Role Summary:** CEO Agent + Master Planner — strategy and plan generation.

#### Responsibilities

- Interpret incoming signals and determine the correct execution strategy.
- Generate `Plan` objects that translate a signal into actionable jobs.
- Own company-level goals and high-level prioritization.
- Delegate execution plans to agents via the job queue.

#### Decision Scope

- MUST decide which `PlannerAction` maps to an incoming signal.
- MUST select the `strategyId` that governs plan execution.
- MUST specify `requiredAgents` and `expectedOutputs` in every `PlannerDecision`.
- MAY escalate unresolvable signals to the MCS for operator review.
- MUST NOT approve its own plans (approval authority rests with the MCS or Operator).
- MUST NOT bypass operator-set workspace policies.

#### Allowed Actions

- Call `routeSignal()` to derive a `PlannerDecision` from a signal.
- Create and persist `Plan` objects in `runtimeStore.plans`.
- Enqueue jobs derived from the plan into the job queue.

#### Default Skills

- `route_signal` — maps signal names to planner actions.
- `generate_plan` — constructs a `Plan` from a `PlannerDecision`.

#### Runtime Privileges

- **Read:** Full access to `runtimeStore.signals`.
- **Write:** `runtimeStore.plans`, `jobQueue`.
- **Emit:** Downstream job creation.
- **Cannot:** Approve plans; override workspace policies; directly execute agent work.

---

### 3.3 Guardian

**Runtime Role Summary:** Runtime Monitor, QA Agent — stability and failure handling.

#### Responsibilities

- Continuously monitor runtime health, job queue depth, agent availability, and execution error rates.
- Detect failures, anomalies, and blocked workflows.
- Enforce retry logic and escalate unrecoverable failures to the MCS.
- Produce `MetricSnapshot` and `ValidationResult` objects for audit and operator visibility.
- Apply quality assurance checks to artifacts before they are validated for publishing.

#### Decision Scope

- MUST decide whether a failed job should be retried or escalated.
- MUST decide whether an artifact passes quality validation before publishing.
- SHOULD inform Forge priorities based on detected capability gaps or recurring failures.
- MAY trigger MCS escalation when a job cannot be recovered within retry limits.
- MUST NOT modify plan strategy or override Mentor decisions.

#### Allowed Actions

- Call `getRuntimeStatus()`, `getQueueStatus()`, `getAgentStatus()` from `packages/core/src/runtime_monitor.ts`.
- Update job `status` fields to reflect retry, failure, or escalation state.
- Emit `ValidationResult` objects for artifact review.
- Trigger MCS escalation events.

#### Default Skills

- `monitor_runtime_health` — polls runtime metrics and surfaces anomalies.
- `run_diagnostics` — executes diagnostic checks against failing jobs or agents.
- `validate_artifact` — runs quality checks on an artifact before publishing.

#### Runtime Privileges

- **Read:** `runtimeStore.jobs`, `runtimeStore.artifacts`, `runtimeStore.skillInvocations`, job queue state.
- **Write:** Job `status`, `MetricSnapshot`, `ValidationResult`.
- **Emit:** MCS escalation events, Guardian alerts.
- **Cannot:** Modify plans or signals; approve publishing without policy clearance.

---

### 3.4 Forge

**Runtime Role Summary:** GhostClaw Forge — capability creation and Ghost Mart publishing.

#### Responsibilities

- Detect missing capabilities in the runtime (e.g., unsupported signal types, gaps surfaced by Guardian).
- Scaffold and generate new skill packages (`SkillInvocation`, `Artifact` of type `skill_package`).
- Test generated skills before publishing.
- Publish validated skills to Ghost Mart (the Marketplace archetype's distribution layer).

#### Decision Scope

- MUST decide whether a detected capability gap warrants new skill creation.
- MUST decide when a generated skill is sufficiently tested for marketplace publication.
- SHOULD coordinate with Guardian to prioritize capability gaps by failure frequency.
- MAY defer skill publication pending Operator or Administrator approval under workspace policy.
- MUST NOT self-approve publishing without policy clearance.

#### Allowed Actions

- Invoke `scaffold_skill_package` skill to generate a new skill package artifact.
- Create `SkillInvocation` records for skill build and test jobs.
- Submit completed skill packages to the Marketplace via `PublishEvent`.

#### Default Skills

- `scaffold_skill_package` — generates a new skill package from a capability specification.
- `refresh_page_sections` — updates existing skill content or integration definitions.

#### Runtime Privileges

- **Read:** `runtimeStore.jobs`, `runtimeStore.artifacts`, Guardian-emitted capability gap signals.
- **Write:** `SkillInvocation`, `Artifact` (skill packages), `PublishEvent`.
- **Emit:** Skill publish events to Ghost Mart.
- **Cannot:** Approve own publish events; modify Guardian validation logic; override workspace policies.

---

### 3.5 Workers

**Runtime Role Summary:** Research, Build, Growth, Operations agents — task execution.

#### Responsibilities

- Execute discrete jobs assigned by the Mentor's plan.
- Invoke skills registered in Ghost Mart to produce artifacts.
- Return `outputPayload` and `Artifact` references upon job completion.
- Specialize by domain: Research, Build, Growth, or Operations.

**Worker specializations:**

| Domain | Example Agents |
|---|---|
| Research | `KeywordResearchAgent`, Trend Scout, Competitor Intelligence |
| Build | `WebsiteBuilderAgent`, Integration Builder |
| Growth | `ContentStrategistAgent`, `ContentWriterAgent`, Backlink Agent |
| Operations | `DiagnosticsAgent`, Analytics Agent, Assignment Agent |

#### Decision Scope

- MUST select the correct skill for a given job type based on registered capabilities.
- MAY fall back to an alternate skill if the primary skill fails (`fallbackUsed` flag on `SkillInvocation`).
- MUST NOT self-approve work; MUST NOT self-publish artifacts.
- MUST NOT escalate beyond assigned job scope without Guardian involvement.

#### Allowed Actions

- Dequeue jobs from the job queue matching registered capabilities.
- Create and update `SkillInvocation` records for each skill call.
- Produce `Artifact` objects as job outputs.
- Retry skill invocations up to the limit defined by workspace execution policy.

#### Default Skills

Determined by agent registration. Examples:

- `draft_cluster_outline` (`ContentStrategistAgent`)
- `write_article` (`ContentWriterAgent`)
- `research_keyword_cluster` (`KeywordResearchAgent`)
- `generate_metadata`, `generate_schema` (`WebsiteBuilderAgent`)
- `run_diagnostics` (`DiagnosticsAgent`)

#### Runtime Privileges

- **Read:** Job queue (own-capability jobs only), assigned `SkillInvocation` records.
- **Write:** `SkillInvocation` status and output, `Artifact` (job outputs).
- **Emit:** Job completion events.
- **Cannot:** Read other agents' skill invocations; modify plans; access the job queue beyond assigned capabilities.

---

### 3.6 Marketplace

**Runtime Role Summary:** Ghost Mart — capability distribution layer.

#### Responsibilities

- Maintain the registry of published skills, agent workflows, automation packs, and integrations.
- Accept `PublishEvent` objects from the Forge archetype after policy clearance.
- Distribute capabilities to workers across workspaces.
- Manage capability versioning, discovery, and listing metadata.

#### Decision Scope

- MUST validate that a `PublishEvent` has passed workspace publish policy before accepting a listing.
- MUST version published capabilities and surface the latest validated version to consumers.
- MAY reject a listing that does not conform to Ghost Mart schema requirements.
- MUST NOT execute skills; it is a distribution layer, not an execution layer.

#### Allowed Actions

- Accept and persist `PublishEvent` objects as marketplace listings (`Artifact` of type `marketplace_listing`).
- Serve skill metadata and `skillId` references to agents on request.
- Emit capability-available events that may trigger follow-up signals.

#### Default Skills

- `publish_skill` — registers a validated skill package as a Ghost Mart listing.
- `list_capabilities` — returns available skills matching a query.

#### Runtime Privileges

- **Read:** `PublishEvent`, `Artifact` (skill packages from Forge).
- **Write:** Marketplace listing `Artifact`, capability registry.
- **Emit:** Capability-available events.
- **Cannot:** Execute skills; modify workspace policies; approve own listings without policy clearance.

---

### 3.7 Shadow

**Runtime Role Summary:** System entropy — drift, failure, and complexity (adversarial model).

#### Responsibilities

- Represent the aggregate entropy forces that degrade GhostClaw OS over time.
- Surface as detectable signals: architectural drift, incomplete automation, runtime failures, operational complexity, lost opportunities, fragmented tooling.
- Inform Guardian monitoring thresholds and Forge capability-gap prioritization.

#### Decision Scope

- The Shadow makes no decisions. It is an **adversarial model**, not an agent.
- Shadow entropy is **detected by Guardian** via metrics and anomaly detection.
- Shadow-sourced signals are **prioritized by Mentor** when they indicate systemic risk.

#### Allowed Actions

- None. The Shadow does not act. It manifests as degradation patterns that Guardian detects.

#### Default Skills

- None. The Shadow has no runtime representation and no attached skills.

#### Runtime Privileges

- None owned. Shadow entropy is detected via Guardian `MetricSnapshot` objects and runtime error patterns.
- The Shadow MUST NOT be modeled as an agent with executable capabilities.

---

## 4. Interaction Model

### 4.1 Coordination Chain

The following diagram shows the canonical archetype coordination flow at runtime:

```
┌─────────────────────────────────────────────────────────────────┐
│                        GhostClaw OS Runtime                      │
│                                                                   │
│  [External Event / Scheduler]                                     │
│          ↓                                                        │
│  ┌───────────────┐                                               │
│  │   SIGNAL       │  Signal enters via processSignal()           │
│  └───────┬───────┘                                               │
│          ↓                                                        │
│  ┌───────────────┐                                               │
│  │   MENTOR       │  routeSignal() → PlannerDecision → Plan      │
│  │  (CEO Engine + │  Enqueues Jobs                               │
│  │   Planner)     │                                               │
│  └───────┬───────┘                                               │
│          ↓                                                        │
│  ┌───────────────┐   SkillInvocation → Artifact                  │
│  │   WORKERS      │  Executes jobs from queue                    │
│  │  (Research /   │                                               │
│  │   Build /      │◄──── FORGE supplies skills via Ghost Mart    │
│  │   Growth / Ops)│                                               │
│  └───────┬───────┘                                               │
│          ↓                                                        │
│  ┌───────────────┐                                               │
│  │   GUARDIAN     │  Validates Artifacts, monitors job health    │
│  │  (Monitor +    │  Retries or escalates failures               │
│  │   QA Agent)    │◄──── SHADOW entropy surfaces here           │
│  └───────┬───────┘                                               │
│          ↓                                                        │
│  ┌───────────────┐                                               │
│  │  MARKETPLACE   │  Accepts PublishEvent from Forge             │
│  │  (Ghost Mart)  │  Distributes capabilities to Workers         │
│  └───────────────┘                                               │
│                                                                   │
│  MCS (Master Control System) governs every transition above      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Message Passing Between Archetypes

| Source Archetype | Message / Object | Target Archetype |
|---|---|---|
| External event | `Signal` | Mentor |
| Mentor | `Plan`, job queue entries | Workers |
| Mentor | `PlannerDecision` | Workers (via job assignment) |
| Workers | `SkillInvocation`, `Artifact` | Guardian (validation), Marketplace (if publishing) |
| Guardian | Retry trigger, escalation event | MCS, Workers |
| Guardian | Capability gap signal | Forge |
| Forge | `PublishEvent`, skill `Artifact` | Marketplace |
| Marketplace | `skillId` references, listing metadata | Workers |
| Shadow (entropy) | Anomaly patterns (detected in metrics) | Guardian |
| Guardian | `MetricSnapshot` | Mentor (informs re-planning), Forge (informs capability gaps) |

### 4.3 Guardian Monitoring and Intervention

The Guardian MUST continuously observe the following runtime surfaces:

- **Job queue depth** — rising depth indicates Workers are under-provisioned or failing.
- **SkillInvocation error rate** — repeated failures on a `skillId` surface a capability gap to Forge.
- **Artifact validation results** — failed validations block publishing and trigger Worker retry or replanning.
- **Agent availability** — unreachable agents are escalated to the MCS.

**Intervention protocol:**

```
Job fails
  → Guardian increments retryCount on SkillInvocation
  → If retryCount < policy limit: re-enqueue job
  → If retryCount ≥ policy limit:
      → Emit escalation event to MCS
      → If failure rate for this skillId exceeds 50% over the last 10 invocations:
          emit capability gap signal to Forge (skill is systematically broken)
```

### 4.4 Shadow Informing Guardian and Forge

The Shadow is not an agent — it has no runtime representation. It manifests as measurable degradation:

- **Architectural drift** → detected by Guardian as unexpected job type patterns not matching any registered capability.
- **Runtime failure** → detected by Guardian as elevated `SkillInvocation` error rates.
- **Operational complexity** → detected by Guardian as abnormal queue depth or escalation frequency.
- **Lost opportunities** → detected by Mentor when Signals arrive with no matching `PlannerAction`.

Guardian SHOULD surface persistent Shadow indicators as high-priority signals routed back to the Mentor for re-planning. Forge SHOULD treat Guardian-identified capability gaps caused by Shadow entropy as top-priority scaffolding work.

---

## 5. Runtime Binding

### 5.1 Archetype Instantiation

Archetypes are bound at **agent registration time**. Every agent registered via `agentRegistry.registerAgent()` in `packages/core/src/agent_registry.ts` receives an implicit archetype assignment based on its declared capabilities.

```
AgentDefinition { agentName, capabilities }
```

- An agent's `capabilities` array MUST only contain skill identifiers that are valid for its archetype.
- The MCS enforces this constraint at registration time and again at each job assignment.
- Agents with capabilities spanning multiple archetypes are not permitted; each agent instance MUST belong to exactly one archetype.

**Example archetype assignments for registered agents:**

| Agent | Archetype |
|---|---|
| `ContentStrategistAgent` | Workers (Growth) |
| `ContentWriterAgent` | Workers (Growth) |
| `KeywordResearchAgent` | Workers (Research) |
| `WebsiteBuilderAgent` | Workers (Build) |
| `RuntimeMonitorAgent` | Guardian |
| `DiagnosticsAgent` | Guardian |
| `SkillBuilderAgent` | Forge |

### 5.2 Skill Attachment

Skills are bound to agents in two phases. At **registration time**, agents declare capability types via `agentRegistry.registerAgent()` — this establishes which skill identifiers an agent may invoke. At **invocation time**, a specific skill instance is bound via `SkillInvocation.skillId` in `packages/core/src/skill_invocation.ts`.

```
SkillInvocation { id, workspaceId, planId, jobId, assignmentId, agentId, skillId, ... }
```

- The `skillId` MUST match a skill registered in Ghost Mart that is valid for the invoking agent's archetype.
- Default skills for each archetype (listed in Section 3) are resolved at job assignment time — the job executor selects the `skillId` from the agent's registered capabilities that matches the job's `jobType`.
- If no default skill matches and a fallback is registered, the executor sets `fallbackUsed: true` on the `SkillInvocation`.
- Skills are **stateless** across invocations. State is carried only through `inputPayload`, `outputPayload`, and `Artifact` references.

### 5.3 Workspace Policy Application

Each workspace carries a policy set enforced by the MCS (see [`ghostclaw_master_control_system.md`](./ghostclaw_master_control_system.md)). Archetype privileges are subject to workspace policy constraints:

- `workspaceId` on `SkillInvocation` identifies which workspace policy set applies to each invocation.
- **Workspace policies MAY restrict** which archetypes are permitted to operate within a workspace (e.g., a workspace may disable Forge to prevent unapproved skill creation).
- **Execution policies** constrain retry limits, timeout thresholds, and concurrency caps for Workers and Forge agents within a workspace.
- **Publish policies** require explicit clearance before Forge publishes skill packages to Ghost Mart or Workers' artifacts are released externally. Workers MUST NOT self-publish; all external publishing routes through Forge (for skills) or the Marketplace (for capability listings). No archetype may self-approve a publish action.
- **Safety policies** apply uniformly across all archetypes. No archetype is exempt from rate limits, cost caps, or emergency stop triggers.

Cross-workspace `SkillInvocation` records require explicit policy grants from an Operator or Administrator of the target workspace.

### 5.4 Archetype-to-Runtime-Object Mapping

| Archetype | Primary Runtime Objects |
|---|---|
| Signal | `Signal` |
| Mentor | `Plan`, `PlannerDecision` |
| Guardian | `MetricSnapshot`, `ValidationResult` |
| Forge | `SkillInvocation`, `Artifact` (skill packages) |
| Workers | `Job`, `SkillInvocation`, `Artifact` |
| Marketplace | `PublishEvent`, `Artifact` (listings) |
| Shadow | *(adversarial model — no owned objects; detected via Guardian `MetricSnapshot` and error patterns)* |

**Object sources:**

- `Signal`, `Plan`, `Job`, `Artifact` — defined in `packages/core/src/runtime_loop.ts`
- `SkillInvocation` — defined in `packages/core/src/skill_invocation.ts`
- `PlannerDecision`, `PlannerAction` — defined in `packages/planner/src/signal_router.ts`
- `AgentDefinition` — defined in `packages/core/src/agent_registry.ts`

---

## 6. Archetype Summary

| Archetype | Runtime Role | Owns Objects | Key Agents |
|---|---|---|---|
| Signal | Opportunity or problem event entering the runtime | `Signal` | — |
| Mentor | CEO Engine + Master Planner — strategy and plan generation | `Plan`, `PlannerDecision` | Ghost CEO Agent, Master Planner |
| Guardian | Runtime Monitor, QA Agent — stability and failure handling | `MetricSnapshot`, `ValidationResult` | `RuntimeMonitorAgent`, `DiagnosticsAgent` |
| Forge | Skill Builder — capability creation and Ghost Mart publishing | `SkillInvocation`, `Artifact` (skill packages) | `SkillBuilderAgent` |
| Workers | Research, Build, Growth, Operations — task execution | `Job`, `SkillInvocation`, `Artifact` | `ContentStrategistAgent`, `KeywordResearchAgent`, `WebsiteBuilderAgent`, etc. |
| Marketplace | Ghost Mart — capability distribution layer | `PublishEvent`, `Artifact` (listings) | — |
| Shadow | System entropy — adversarial model | *(none; detected by Guardian)* | — |