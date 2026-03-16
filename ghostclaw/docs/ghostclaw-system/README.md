# GhostClaw Documentation Structure Brief

**Start here:** [GhostClaw Concepts](ghostclaw_concepts.md) — canonical entrypoint for GhostClaw OS.

## Purpose

GhostClaw is designed as a modular AI operating system and ecosystem platform capable of orchestrating agents, launching autonomous companies, and distributing capabilities through a marketplace.

As the system grows, the documentation must remain:

- understandable for developers
- navigable for contributors
- interpretable by AI agents
- scalable as the ecosystem expands

To achieve this, GhostClaw documentation follows the same structural philosophy used by large systems such as:

- Kubernetes
- Linux
- Stripe
- Terraform
- OpenAI SDKs

These systems organize documentation into clear conceptual layers, separating architecture, execution behavior, ecosystem usage, and reference material.

## Why large systems use this structure

Large technical systems organize documentation into layers because each audience approaches the system differently.

| Audience | What they need |
| --- | --- |
| Architects | Understand system design |
| Developers | Understand runtime behavior |
| Operators | Understand how systems interact |
| Ecosystem builders | Understand expansion and integrations |
| Contributors | Understand definitions and terminology |

Without layered documentation, users must search through unrelated files to understand the system.

## Current repository layout (actual)

All GhostClaw system documents currently live in a single folder:

```text
docs/ghostclaw-system/
```

The sections below represent a **logical structure** (conceptual grouping), not separate physical subdirectories.

## Logical structure

### Architecture

The Architecture layer explains how GhostClaw is designed at a conceptual and structural level.


All GhostClaw system documents currently live in a single folder:

```text
docs/ghostclaw-system/
```

The sections below represent a **logical structure** (conceptual grouping), not separate physical subdirectories.

## Logical structure

### Architecture

The Architecture layer explains how GhostClaw is designed at a conceptual and structural level.

- [ghostclaw_system_map.md](./ghostclaw_system_map.md)
- [ghostclaw_master_control_system.md](./ghostclaw_master_control_system.md)
- [ghostclaw_infrastructure_blueprint.md](./ghostclaw_infrastructure_blueprint.md)
- [ghostclaw_archetype_framework.md](./ghostclaw_archetype_framework.md)
- [ghostclaw_canonical_identity.md](./ghostclaw_canonical_identity.md)
- [ghostclaw_system_architecture.md](./ghostclaw_system_architecture.md)
- [ghostclaw_system_layers.md](./ghostclaw_system_layers.md)

This layer answers questions such as:

- What is GhostClaw?
- How are system components connected?
- What are the architectural principles?

### Runtime

The Runtime layer describes how GhostClaw behaves during execution.

- [ghostclaw_runtime_execution_spec.md](./ghostclaw_runtime_execution_spec.md)
- [ghostclaw_runtime_signals.md](./ghostclaw_runtime_signals.md)
- [ghostclaw_runtime_persistence_spec.md](./ghostclaw_runtime_persistence_spec.md) — Canonical persistence models for all runtime objects (Signal through PublishEvent), storage strategies, and implementation guidance for evolving from in-memory to durable storage.
- [ghostclaw_planner_actions.md](./ghostclaw_planner_actions.md)
- [ghostclaw_agent_registry.md](./ghostclaw_agent_registry.md)
- [ghostclaw_skill_registry.md](./ghostclaw_skill_registry.md)

This layer answers questions such as:

- How do agents execute tasks?
- What signals trigger system actions?
- How are skills registered and used?
- How does the planner coordinate agents?
- How are runtime objects persisted and what is their full lifecycle?

### Ecosystem

The Ecosystem layer describes how GhostClaw expands beyond the core runtime.

- [ghostclaw_company_factory.md](./ghostclaw_company_factory.md)
- [ghostclaw_ecosystem_growth_engine.md](./ghostclaw_ecosystem_growth_engine.md)
- [ghostclaw_marketplace_schema.md](./ghostclaw_marketplace_schema.md)
- [ghostclaw_ghost_mart_launch_catalog.md](./ghostclaw_ghost_mart_launch_catalog.md)

This layer answers questions such as:

- How are autonomous companies created?
- How does GhostClaw grow its ecosystem?
- How are capabilities distributed through Ghost Mart?

### Reference

The Reference layer provides canonical definitions used across the system.

- [ghostclaw_system_glossary.md](./ghostclaw_system_glossary.md)
- [ghostclaw_naming_and_origin.md](./ghostclaw_naming_and_origin.md)

This layer helps ensure consistency in terminology, core concepts, and naming conventions.

## Benefits of this structure

Organizing GhostClaw documentation into layered sections provides several advantages:

1. **Scalability**
   As GhostClaw grows to include more agents, skills, and companies, documentation remains organized and navigable.

2. **Developer clarity**
   New contributors can read architecture first, then runtime behavior.

3. **AI readability**
   A clear hierarchy improves machine interpretation for AI-assisted workflows.

4. **Ecosystem expansion**
   Separating ecosystem materials from runtime materials makes the platform easier to extend.

5. **Professional system documentation**
   This organization aligns with common documentation practices used by major infrastructure platforms.

## Long-term vision

As GhostClaw evolves, this structure will support growth of:

- autonomous agents
- reusable skills
- digital company blueprints
- distributed marketplaces
- AI-driven infrastructure

The documentation becomes a living manual for the GhostClaw operating system.
