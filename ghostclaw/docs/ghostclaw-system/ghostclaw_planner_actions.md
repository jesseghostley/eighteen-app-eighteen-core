# GhostClaw Planner Actions

This document defines the actions the Master Planner Agent can take.

Planner actions convert signals into executable work.

---

## create_new_skill

Description:
Request the Skill Builder Agent to design a new capability.

Triggered by:
marketplace_gap_detected
new_skill_required

Assigned agents:
Skill Builder Agent
Blueprint Agent

---
## create_service_page

Description:
Create a core revenue-driving page for a target business or company workflow.

Triggered by:
content_brief_ready
page_copy_needed

Assigned agents:
Content Strategist Agent
Content Writer Agent
Website Builder Agent

---

## create_blog_article

Description:
Create a supporting article to reinforce a content cluster or service page.

Triggered by:
content_brief_ready
keyword_opportunity_detected

Assigned agents:
Content Strategist Agent
Content Writer Agent

---

## optimize_existing_page

Description:
Improve an existing page that has softened in rankings or conversion performance.

Triggered by:
ranking_loss_detected
traffic_growth_opportunity
funnel_dropoff_detected

Assigned agents:
SEO CEO Agent
Content Writer Agent
Analytics Agent

---

## refresh_underperforming_page

Description:
Rebuild or substantially revise a page that is underperforming.

Triggered by:
ranking_loss_detected
output_quality_issue

Assigned agents:
Content Strategist Agent
Content Writer Agent
Website Builder Agent

---

## handle_runtime_error

Description:
Respond to runtime failures or queue bottlenecks.

Triggered by:
runtime_error_detected
queue_latency_high
system_bottleneck_detected

Assigned agents:
Runtime Monitor Agent
Runtime Architect Agent
Platform CEO Agent

---

## refresh_documentation

Description:
Create or update missing system documentation.

Triggered by:
documentation_gap_detected
feature_released

Assigned agents:
Documentation Agent
Prompt Design Agent

---

## optimize_marketplace_listing

Description:
Improve Ghost Mart listing performance and clarity.

Triggered by:
listing_conversion_drop

Assigned agents:
Listing Optimizer Agent
Pricing Agent
Content Writer Agent

---

## build_integration

Description:
Design and implement a new external integration.

Triggered by:
integration_requested
sdk_feature_requested

Assigned agents:
Integration Agent
API Architect Agent
SDK Agent

---

## expand_vertical

Description:
Create a plan for entering a new target industry or niche.

Triggered by:
vertical_demand_spike
new_market_detected

Assigned agents:
Vertical Expansion Agent
Audience Research Agent
Company Factory Agent

## launch_new_company

Description:
Create a blueprint for an autonomous company.

Triggered by:
ecosystem_growth_opportunity
vertical_demand_spike

Assigned agents:
Company Factory Agent
Audience Research Agent
Company CEO Agent

---

## generate_content_cluster

Description:
Create a group of SEO content pages.

Triggered by:
keyword_opportunity_detected

Assigned agents:
Keyword Research Agent
Content Strategist Agent
Content Writer Agent

---
## create_service_page

Description:
Create a core revenue-driving page for a target business or company workflow.

Triggered by:
content_brief_ready
page_copy_needed

Assigned agents:
Content Strategist Agent
Content Writer Agent
Website Builder Agent

---

## create_blog_article

Description:
Create a supporting article to reinforce a content cluster or service page.

Triggered by:
content_brief_ready
keyword_opportunity_detected

Assigned agents:
Content Strategist Agent
Content Writer Agent

---

## optimize_existing_page

Description:
Improve an existing page that has softened in rankings or conversion performance.

Triggered by:
ranking_loss_detected
traffic_growth_opportunity
funnel_dropoff_detected

Assigned agents:
SEO CEO Agent
Content Writer Agent
Analytics Agent

---

## refresh_underperforming_page

Description:
Rebuild or substantially revise a page that is underperforming.

Triggered by:
ranking_loss_detected
output_quality_issue

Assigned agents:
Content Strategist Agent
Content Writer Agent
Website Builder Agent

---

## handle_runtime_error

Description:
Respond to runtime failures or queue bottlenecks.

Triggered by:
runtime_error_detected
queue_latency_high
system_bottleneck_detected

Assigned agents:
Runtime Monitor Agent
Runtime Architect Agent
Platform CEO Agent

---

## refresh_documentation

Description:
Create or update missing system documentation.

Triggered by:
documentation_gap_detected
feature_released

Assigned agents:
Documentation Agent
Prompt Design Agent

---

## optimize_marketplace_listing

Description:
Improve Ghost Mart listing performance and clarity.

Triggered by:
listing_conversion_drop

Assigned agents:
Listing Optimizer Agent
Pricing Agent
Content Writer Agent

---

## build_integration

Description:
Design and implement a new external integration.

Triggered by:
integration_requested
sdk_feature_requested

Assigned agents:
Integration Agent
API Architect Agent
SDK Agent

---

## expand_vertical

Description:
Create a plan for entering a new target industry or niche.

Triggered by:
vertical_demand_spike
new_market_detected

Assigned agents:
Vertical Expansion Agent
Audience Research Agent
Company Factory Agent

## publish_marketplace_listing

Description:
Add a new skill or agent to Ghost Mart.

Triggered by:
new_skill_ready

Assigned agents:
Listing Publisher Agent
Pricing Agent
Listing Optimizer Agent