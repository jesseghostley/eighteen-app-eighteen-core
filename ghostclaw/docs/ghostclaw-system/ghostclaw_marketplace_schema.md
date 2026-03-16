# Ghost Mart Marketplace Schema

Ghost Mart is the capability marketplace for GhostClaw.

Products include:

agents
skills
tools
automation packs
company blueprints

---

## Listing Fields

listing_id
product_type
product_name
category
description
capabilities
inputs
outputs
installation
pricing
rating
author
version

## Additional Listing Fields

dependency_tree
compatibility_matrix
approval_state
install_status
review_status
trust_score
release_channel

## Example Listing

product_name: SEO Agent
product_type: agent

Capabilities:
keyword research
content planning
ranking monitoring

Install command:
install_agent seo_agent
---

## Product Types

Ghost Mart uses the following canonical product types for V1:

- skill
- agent
- automation_pack
- company_blueprint
- developer_tool
---
## Terminology Rules

Skill = atomic capability used by agents

Tool = implementation detail or packaged technical utility that may power a skill or developer tool

Automation Pack = bundled agents + skills + workflows

Company Blueprint = structured autonomous business design

Developer Tool = capability used to build, test, or extend GhostClaw

