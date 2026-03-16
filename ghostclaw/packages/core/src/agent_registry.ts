export type AgentDefinition = {
  agentName: string;
  capabilities: string[];
};

class InMemoryAgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  registerAgent(agentName: string, capabilities: string[]): AgentDefinition {
    const definition: AgentDefinition = { agentName, capabilities };
    this.agents.set(agentName, definition);
    return definition;
  }

  getAgent(agentName: string): AgentDefinition | undefined {
    return this.agents.get(agentName);
  }

  findAgentForJob(jobType: string): AgentDefinition | undefined {
    return Array.from(this.agents.values()).find((agent) =>
      agent.capabilities.includes(jobType),
    );
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}

export const agentRegistry = new InMemoryAgentRegistry();

agentRegistry.registerAgent('KeywordResearchAgent', ['research_keyword_cluster']);
agentRegistry.registerAgent('ContentStrategistAgent', ['draft_cluster_outline']);
agentRegistry.registerAgent('ContentWriterAgent', ['write_article']);
agentRegistry.registerAgent('WebsiteBuilderAgent', ['generate_metadata', 'generate_schema']);
agentRegistry.registerAgent('RuntimeMonitorAgent', ['monitor_runtime_health']);
agentRegistry.registerAgent('SkillBuilderAgent', ['scaffold_skill_package', 'refresh_page_sections']);
agentRegistry.registerAgent('DiagnosticsAgent', ['run_diagnostics']);
