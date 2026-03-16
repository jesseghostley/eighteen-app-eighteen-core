# GhostClaw Concepts (Canonical Entrypoint)

## Canonical definition

GhostClaw is an Autonomous AI Operating System composed of three core systems:

1. AI Agent Runtime
2. Capability Marketplace (Ghost Mart)
3. Autonomous Company Factory

## What GhostClaw OS is

- A signal-driven runtime where agents coordinate through plans, jobs, skills, and workflows.
- A policy-governed environment that keeps work auditable and aligned to goals.
- A workspace/company-aware system so teams, approvals, and publishing stay traceable.
- A platform that combines runtime execution, capability distribution, and autonomous company formation into one governed system.

## The three core systems

- **AI Agent Runtime** — executes plans as jobs through agents and skills.  
  See: [`ghostclaw_runtime_execution_spec.md`](ghostclaw_runtime_execution_spec.md), [`ghostclaw_runtime_signals.md`](ghostclaw_runtime_signals.md), [`ghostclaw_planner_actions.md`](ghostclaw_planner_actions.md), [`ghostclaw_skill_registry.md`](ghostclaw_skill_registry.md).

- **Capability Marketplace (Ghost Mart)** — registers and delivers capabilities across the ecosystem.  
  See: [`ghostclaw_marketplace_schema.md`](ghostclaw_marketplace_schema.md), [`ghostclaw_ghost_mart_launch_catalog.md`](ghostclaw_ghost_mart_launch_catalog.md).

- **Autonomous Company Factory** — governs goals, revenue strategies, and organizational logic via the CEO Engine.  
  See: [`ghostclaw_master_control_system.md`](ghostclaw_master_control_system.md), [`ghostclaw_company_factory.md`](ghostclaw_company_factory.md).

## Core runtime grammar (conceptual flow)

```
Signal → Plan → Job → Agent → Skill → Artifact → Validation/Publish → Follow-up Signal
```

- **Signal** — triggers work (external event, scheduled task, or emitted output).
- **Plan** — structured breakdown of a goal into jobs.
- **Job** — discrete unit of work assigned to an agent.
- **Agent** — autonomous executor; selects and calls skills.
- **Skill** — atomic capability registered in Ghost Mart.
- **Artifact** — durable output produced by a job or skill.
- **Validation/Publish** — policy checks gate artifact release; passing emits a new signal.
- **Follow-up Signal** — closes the loop and may trigger downstream plans.

Deep dive: [`ghostclaw_runtime_execution_spec.md`](ghostclaw_runtime_execution_spec.md), [`ghostclaw_runtime_signals.md`](ghostclaw_runtime_signals.md).

## Workspace / company model

- Workspaces map to companies or teams within the platform.
- CEO Engine owns company-level goals and delegates to the Planner and Agents.
- Roles and approvals live within the workspace to keep governance local and auditable.

See: [`ghostclaw_master_control_system.md`](ghostclaw_master_control_system.md), [`ghostclaw_company_factory.md`](ghostclaw_company_factory.md).

## Policies and approvals

- Policies gate plan approval, agent execution, and publishing.
- The CEO Engine and Dashboard enforce who can approve and under what conditions.
- All approvals are logged and traceable back to the originating signal.

See: [`ghostclaw_master_control_system.md`](ghostclaw_master_control_system.md).

## Publishing and artifacts

- Artifacts are the durable outputs of jobs and skills.
- Publishing requires validation and policy checks before an artifact is released.
- Validated artifacts may emit a new follow-up signal to continue downstream workflows.

See: [`ghostclaw_runtime_execution_spec.md`](ghostclaw_runtime_execution_spec.md).

## Blueprints and starter packs

- Infrastructure and deployment patterns are captured in [`ghostclaw_infrastructure_blueprint.md`](ghostclaw_infrastructure_blueprint.md).
- Archetype and identity patterns define reusable company and agent templates:  
  [`ghostclaw_archetype_framework.md`](ghostclaw_archetype_framework.md), [`ghostclaw_canonical_identity.md`](ghostclaw_canonical_identity.md).

## Dashboard / operator console

The full control chain operators work within:

```
Dashboard → API Server → Core Runtime → CEO Engine → Planner → Agents → Skills → Marketplace
```

- The Dashboard is the visibility and approval surface for operators.
- CEO Engine must remain in this chain; removing it reduces GhostClaw to a basic automation tool.
- Policies set at the Dashboard level are enforced throughout the chain.

## Related documentation

| Document | Purpose |
| --- | --- |
| [`ghostclaw_system_map.md`](ghostclaw_system_map.md) | Visual and structural map of the full system |
| [`ghostclaw_system_architecture.md`](ghostclaw_system_architecture.md) | Architectural layers and component relationships |
| [`ghostclaw_master_control_system.md`](ghostclaw_master_control_system.md) | CEO Engine, control chain, and governance model |
| [`ghostclaw_runtime_execution_spec.md`](ghostclaw_runtime_execution_spec.md) | Runtime execution model and job lifecycle |
| [`ghostclaw_runtime_signals.md`](ghostclaw_runtime_signals.md) | Signal types, schema, and routing rules |
| [`ghostclaw_planner_actions.md`](ghostclaw_planner_actions.md) | Planner action types and planning logic |
| [`ghostclaw_skill_registry.md`](ghostclaw_skill_registry.md) | Skill registration, versioning, and discovery |
| [`ghostclaw_marketplace_schema.md`](ghostclaw_marketplace_schema.md) | Ghost Mart capability schema |
| [`ghostclaw_ghost_mart_launch_catalog.md`](ghostclaw_ghost_mart_launch_catalog.md) | Launch catalog and onboarding for Ghost Mart |
| [`ghostclaw_company_factory.md`](ghostclaw_company_factory.md) | Autonomous company creation and lifecycle |
| [`ghostclaw_infrastructure_blueprint.md`](ghostclaw_infrastructure_blueprint.md) | Infrastructure patterns and deployment blueprints |
| [`ghostclaw_archetype_framework.md`](ghostclaw_archetype_framework.md) | Archetype definitions for agents and companies |
| [`ghostclaw_canonical_identity.md`](ghostclaw_canonical_identity.md) | Canonical identity model |
| [`ghostclaw_ecosystem_growth_engine.md`](ghostclaw_ecosystem_growth_engine.md) | Ecosystem growth strategy and automation |
| [`ghostclaw_system_glossary.md`](ghostclaw_system_glossary.md) | Canonical definitions and terminology |
| [`ghostclaw_naming_and_origin.md`](ghostclaw_naming_and_origin.md) | Naming conventions and origin of GhostClaw |

## Why GhostClaw is an OS for AI agents

- It combines runtime, marketplace, and company-formation logic into one governed system — not just an automation layer.
- It keeps strategy (CEO Engine), planning (Planner), and execution (Agents/Skills) in a single audited flow.
- It makes capabilities discoverable, composable, and publishable across teams and companies.
- Workspaces, policies, and the CEO Engine together give it the governance properties of an operating system rather than a framework.
