# GhostClaw Master Control System

> The Master Control System (MCS) is the governance and oversight layer of GhostClaw OS responsible for policy enforcement, approval flows, operator control, and runtime safety.

---

## 1. System Authority Model

The MCS defines authority for every principal that participates in the GhostClaw runtime. Each role has an explicit set of capabilities and hard limits.

| Role | Can Do | Cannot Do |
|---|---|---|
| **Operator** | Override any agent decision; approve or reject any work item at any state; modify any policy; trigger emergency shutdown; access all audit logs | Disable audit logging |
| **Administrator** | Manage workspace configuration, user access, and system settings; modify workspace-scoped policies | Override CEO Engine strategy; directly execute agent work; bypass operator-set policies |
| **CEO Engine** | Own company-level goals, revenue strategy, and high-level prioritization; delegate execution plans to the Planner | Bypass operator-set policies; approve publishing without policy clearance |
| **Planner** | Interpret signals and generate execution plans; assign agents and skills to jobs | Approve publishing; override any policy; approve its own plans |
| **Agent** | Perform jobs using assigned skills within scoped authority | Self-approve work; self-publish artifacts; escalate beyond assigned scope |
| **Skill** | Execute atomic capabilities within a sandboxed invocation context | Make decisions; hold state between invocations; access resources outside granted scope |
| **Policy** | Constrain all other roles through declarative rules enforced automatically by the MCS | Be modified by anyone other than Operators or Administrators |

### Authority Hierarchy

```
Operator (human)
  ↓
Administrator
  ↓
CEO Engine
  ↓
Planner
  ↓
Agent
  ↓
Skill
```

Policies are enforced across all layers. No role in the hierarchy is exempt from policy evaluation.

---

## 2. Policy Enforcement Model

Policies are declarative rules managed by the MCS. They are not procedural logic embedded in agents or skills — they are evaluated externally by the MCS before any consequential action proceeds.

### Policy Categories

#### Workspace Policies
Define the operating boundaries of a workspace: allowed agent types, resource limits, company-level rules, and scope constraints. Every workspace carries its own policy set. Cross-workspace actions require explicit policy grants.

#### Execution Policies
Govern what agents may do during job execution: which skills an agent may invoke, retry limits, timeout thresholds, and concurrency caps. Execution policies are evaluated at job assignment and before each skill invocation.

#### Publish Policies
Define what requires approval before any artifact is released externally. Publish policies apply to websites, marketplace listings, customer communications, and pricing changes. No artifact may be published without policy clearance.

#### Safety Policies
Enforce system-level guardrails: rate limits, cost caps, external API call limits, content moderation rules, and emergency stop triggers. Safety policies are evaluated continuously and may halt execution automatically.

### Enforcement Rules

- Policies are **declarative**, not procedural. They define conditions, not code paths.
- Policies are **evaluated before** every plan approval, job assignment, skill invocation, and publish action.
- Every policy evaluation is **logged**, whether the result is pass or fail.
- Policies may only be **modified by Operators or Administrators**. No other role may alter a policy definition.

---

## 3. Approval State Machine

Every work item in the GhostClaw runtime progresses through a defined set of states managed by the MCS. No work item may skip a state.

### States

| State | Description |
|---|---|
| `proposed` | Work item created by Planner or Agent. Awaiting MCS policy check. |
| `policy_check` | MCS is evaluating applicable policies against the proposed work. |
| `awaiting_approval` | Policy requires human or CEO Engine approval before work may proceed. |
| `approved` | Approval granted. Work may enter execution. |
| `executing` | Work is actively running. Agent is performing assigned job. |
| `completed` | Work finished successfully. Outputs are persisted. |
| `rejected` | Approval denied or a policy violation was detected. Work is halted. |

### State Transitions

```
proposed → policy_check → approved → executing → completed
                        ↘ awaiting_approval → approved
                                             ↘ rejected
                        ↘ rejected (auto-reject on policy violation)
```

### Transition Rules

- Every transition must be **logged** with the actor, timestamp, and reason.
- **Rejected items** may be resubmitted after modification. Resubmission creates a new work item in the `proposed` state.
- **No work item may skip** the `policy_check` state. Any attempt to transition directly from `proposed` to `approved` or `executing` is a protocol violation and is blocked by the MCS.

---

## 4. Override and Escalation Rules

### Operator Override

Operators may manually approve, reject, or cancel any work item at any state. Operator overrides bypass the `awaiting_approval` state and take immediate effect. All overrides are logged with the actor identity, timestamp, affected work item, and stated reason. Overrides cannot disable audit logging.

### Policy Escalation

When a policy check fails but the work item is flagged as high-priority, the MCS initiates an escalation chain rather than auto-rejecting:

```
Agent → Planner → CEO Engine → Operator
```

The MCS escalates to the CEO Engine first. If the CEO Engine cannot resolve the conflict (e.g., because the policy was set by an Operator), the MCS escalates to an Operator. Escalation events are logged at each step.

### Emergency Shutdown

Operators may trigger a system-wide halt at any time. On emergency shutdown:

- All running jobs are paused immediately.
- All job queues are frozen; no new jobs may be dequeued.
- All publish actions are blocked.
- The system remains halted until an Operator explicitly issues a resume command.

The shutdown event and the resume event are both logged as critical system events. No automated process may override or bypass an operator-initiated emergency shutdown.

---

## 5. Audit Logging

The MCS maintains an append-only audit log covering every consequential event in the runtime. The audit log cannot be deleted or modified by any role, including Operators.

### Audited Event Categories

| Category | What Is Logged |
|---|---|
| **Signal intake** | Every signal received, with source and timestamp |
| **Plan creation** | Every plan generated, with reference to source signal |
| **Job execution** | Every job with full state transition history, assigned agent, and skills used |
| **Skill invocations** | Every skill call with input/output references, duration, and status |
| **Approval decisions** | Every approval decision with actor, decision, reason, and timestamp |
| **Publish actions** | Every artifact published externally with validation status |
| **Policy evaluations** | Every policy check with result (pass/fail), policy ID, and evaluation context |
| **Failures** | Every failure with type, affected job, and recovery action taken |
| **Overrides** | Every operator override with reason and affected work items |
| **System events** | Emergency shutdowns, configuration changes, policy modifications |

### Audit Log Requirements

- **Append-only**: no entry may be deleted or modified after creation.
- Every entry must include: `event_type`, `actor`, `timestamp`, `target_object`, `result`, `context`.
- The log must be **queryable** by time range, event type, actor, and target object.
- **Retention policy** is configurable per workspace by Operators or Administrators.

---

## 6. MCS Integration Points

### Runtime Execution Spec

The MCS governs the runtime defined in [`ghostclaw_runtime_execution_spec.md`](./ghostclaw_runtime_execution_spec.md). It enforces policies at each layer of the runtime: signal intake, planning, job assignment, execution, validation, and publishing. The approval gates defined in Section 8 of the runtime spec are enforced by the MCS — the runtime spec defines what gates exist; the MCS defines how those gates are evaluated and logged.

### Dashboard / Operator Console

The Dashboard is the primary interface for Operators to view system state, approve or reject work items, modify policies, and trigger overrides or emergency shutdown. Every action taken through the Dashboard passes through the API Server and is subject to MCS audit logging. The Dashboard does not bypass the MCS; it is a client of the MCS.

### Workspace Policies

Each workspace maintains its own policy set. The MCS evaluates workspace-scoped policies for every action that occurs within that workspace. Policy definitions are stored and versioned per workspace. Cross-workspace actions require explicit policy grants from an Operator or Administrator of the target workspace.

---

## 7. Control-Flow Diagram

The following diagram shows the canonical control chain and where the MCS enforces governance:

```
Operator Console (Dashboard)
        ↓
    API Server
        ↓
  ┌─────────────────────┐
  │  Master Control      │ ← Policy evaluation at every layer
  │  System (MCS)        │ ← Approval gates
  │                      │ ← Audit logging
  │                      │ ← Override handling
  └─────────────────────┘
        ↓
    Core Runtime
        ↓
    CEO Engine
        ↓
    Planner
        ↓
    Agents
        ↓
    Skills
        ↓
    Artifacts
        ↓
    Validation / Publish
```

The MCS is not a single step in this chain. It is a cross-cutting governance layer that intercepts and evaluates every transition between steps. Every arrow in the diagram above is a transition point where the MCS may enforce a policy, require an approval, log an event, or halt execution.

---

## 8. Summary

The MCS is what separates GhostClaw from unstructured agent frameworks. Any system can orchestrate agents and invoke skills. Without the MCS, GhostClaw would be a runtime — a capable one, but ungoverned. With the MCS, GhostClaw is a governed operating system: one where every action is policy-bound, every consequential decision is logged, every approval is traceable, and every override is attributed to a human actor. The MCS is the mechanism by which GhostClaw can operate autonomously at scale without sacrificing accountability, auditability, or operator control.