/**
 * ghostMartSeedManifest — default package manifest for Ghost Mart V1.
 *
 * Canonical spec: ghostclaw_ghost_mart_launch_catalog.md
 * Runtime chain:  GhostMartInstaller.discover(ghostMartSeedManifest) populates the package store
 *                 at startup or during testing.
 *
 * Contains ~7 sample packages covering all three canonical package types:
 *   - skills     (keyword_research, seo_audit, content_generation)
 *   - agents     (seo_ceo_agent, content_writer_agent)
 *   - blueprints (ai_seo_agency, ai_marketing_agency)
 */

import type { GhostMartPackage } from './ghost_mart_package';

const NOW = 1700000000000; // fixed seed timestamp for deterministic manifests

export const ghostMartSeedManifest: GhostMartPackage[] = [
  // ─── Skills ────────────────────────────────────────────────────────────────

  {
    package_id: 'skill_keyword_research',
    name: 'Keyword Research Skill',
    version: '1.0.0',
    package_type: 'skill',
    description:
      'Discovers high-value keyword clusters from a seed topic using search volume and competition signals.',
    author: 'GhostClaw Core Team',
    dependencies: [],
    permissions_required: ['skill_registry.write', 'event_bus.emit'],
    workspace_scope: '*',
    install_status: 'available',
    category: 'seo',
    capabilities: ['research_keyword_cluster'],
    inputs: ['seed_topic', 'target_market'],
    outputs: ['keyword_cluster', 'search_volume_data'],
    install_command: 'install_skill keyword_research',
    created_at: NOW,
    updated_at: NOW,
  },

  {
    package_id: 'skill_seo_audit',
    name: 'SEO Audit Skill',
    version: '1.0.0',
    package_type: 'skill',
    description:
      'Runs a full on-page SEO audit against a URL, returning scores, issues, and recommended fixes.',
    author: 'GhostClaw Core Team',
    dependencies: [],
    permissions_required: ['skill_registry.write', 'event_bus.emit'],
    workspace_scope: '*',
    install_status: 'available',
    category: 'seo',
    capabilities: ['run_seo_audit'],
    inputs: ['url', 'audit_scope'],
    outputs: ['seo_score', 'issue_list', 'recommendations'],
    install_command: 'install_skill seo_audit',
    created_at: NOW,
    updated_at: NOW,
  },

  {
    package_id: 'skill_content_generation',
    name: 'Content Generation Skill',
    version: '1.0.0',
    package_type: 'skill',
    description:
      'Generates long-form articles, blog posts, or landing page copy from a brief and keyword cluster.',
    author: 'GhostClaw Core Team',
    dependencies: ['skill_keyword_research'],
    permissions_required: ['skill_registry.write', 'event_bus.emit'],
    workspace_scope: '*',
    install_status: 'available',
    category: 'content',
    capabilities: ['write_article', 'generate_landing_page'],
    inputs: ['content_brief', 'keyword_cluster'],
    outputs: ['article_draft', 'metadata'],
    install_command: 'install_skill content_generation',
    created_at: NOW,
    updated_at: NOW,
  },

  // ─── Agents ────────────────────────────────────────────────────────────────

  {
    package_id: 'agent_seo_ceo',
    name: 'SEO CEO Agent',
    version: '1.0.0',
    package_type: 'agent',
    description:
      'Autonomous SEO executive agent that orchestrates keyword research, content strategy, and ranking monitoring.',
    author: 'GhostClaw Core Team',
    dependencies: ['skill_keyword_research', 'skill_seo_audit'],
    permissions_required: [
      'agent_registry.write',
      'skill_registry.read',
      'event_bus.emit',
      'audit_log.write',
    ],
    workspace_scope: '*',
    install_status: 'available',
    category: 'seo',
    capabilities: [
      'research_keyword_cluster',
      'run_seo_audit',
      'monitor_rankings',
      'generate_seo_strategy',
    ],
    inputs: ['business_brief', 'target_keywords'],
    outputs: ['seo_strategy', 'content_calendar', 'ranking_report'],
    install_command: 'install_agent seo_ceo_agent',
    created_at: NOW,
    updated_at: NOW,
  },

  {
    package_id: 'agent_content_writer',
    name: 'Content Writer Agent',
    version: '1.0.0',
    package_type: 'agent',
    description:
      'Autonomous content writer that produces SEO-optimised articles, blog posts, and social copy.',
    author: 'GhostClaw Core Team',
    dependencies: ['skill_content_generation'],
    permissions_required: [
      'agent_registry.write',
      'skill_registry.read',
      'event_bus.emit',
      'audit_log.write',
    ],
    workspace_scope: '*',
    install_status: 'available',
    category: 'content',
    capabilities: ['write_article', 'draft_cluster_outline', 'generate_social_copy'],
    inputs: ['content_brief', 'tone_of_voice', 'keyword_cluster'],
    outputs: ['article_draft', 'social_posts', 'content_metadata'],
    install_command: 'install_agent content_writer_agent',
    created_at: NOW,
    updated_at: NOW,
  },

  // ─── Blueprints ────────────────────────────────────────────────────────────

  {
    package_id: 'blueprint_ai_seo_agency',
    name: 'AI SEO Agency Blueprint',
    version: '1.0.0',
    package_type: 'blueprint',
    description:
      'Turnkey autonomous SEO agency blueprint. Provisions SEO CEO Agent, Content Writer Agent, and all required skills into a preconfigured workspace.',
    author: 'GhostClaw Core Team',
    dependencies: [
      'agent_seo_ceo',
      'agent_content_writer',
      'skill_keyword_research',
      'skill_seo_audit',
      'skill_content_generation',
    ],
    permissions_required: [
      'blueprint.register',
      'workspace.write',
      'agent_registry.write',
      'skill_registry.write',
    ],
    workspace_scope: '*',
    install_status: 'available',
    category: 'automation',
    capabilities: [
      'research_keyword_cluster',
      'run_seo_audit',
      'write_article',
      'generate_seo_strategy',
      'monitor_rankings',
    ],
    inputs: ['company_brief', 'target_market', 'brand_guidelines'],
    outputs: ['seo_strategy', 'content_calendar', 'ranking_dashboard'],
    install_command: 'install_blueprint ai_seo_agency',
    created_at: NOW,
    updated_at: NOW,
  },

  {
    package_id: 'blueprint_ai_marketing_agency',
    name: 'AI Marketing Agency Blueprint',
    version: '1.0.0',
    package_type: 'blueprint',
    description:
      'Full-stack autonomous marketing agency blueprint. Covers SEO, content, social, and campaign automation.',
    author: 'GhostClaw Core Team',
    dependencies: [
      'agent_seo_ceo',
      'agent_content_writer',
      'skill_keyword_research',
      'skill_content_generation',
    ],
    permissions_required: [
      'blueprint.register',
      'workspace.write',
      'agent_registry.write',
      'skill_registry.write',
    ],
    workspace_scope: '*',
    install_status: 'available',
    category: 'automation',
    capabilities: [
      'research_keyword_cluster',
      'write_article',
      'generate_social_copy',
      'generate_seo_strategy',
      'run_campaign',
    ],
    inputs: ['brand_brief', 'budget', 'target_audience'],
    outputs: ['marketing_plan', 'content_calendar', 'campaign_performance_report'],
    install_command: 'install_blueprint ai_marketing_agency',
    created_at: NOW,
    updated_at: NOW,
  },
];
