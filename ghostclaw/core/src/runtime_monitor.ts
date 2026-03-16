import { agentRegistry } from './agent_registry';
import { jobQueue } from './job_queue';
import { listPlannerStrategies } from './planner_registry';
import { runtimeStore } from './runtime_loop';
import { skillInvocationStore, type SkillInvocation, type SkillInvocationStatus } from './skill_invocation';

function getJobCounts() {
  const jobs = jobQueue.list();

  return {
    totalJobs: jobs.length,
    queuedJobs: jobs.filter((job) => job.status === 'queued').length,
    runningJobs: jobs.filter((job) => job.status === 'running').length,
    completedJobs: jobs.filter((job) => job.status === 'completed').length,
    failedJobs: jobs.filter((job) => job.status === 'failed').length,
  };
}

function countInvocationsByStatus(invocations: SkillInvocation[]): Record<SkillInvocationStatus, number> {
  return invocations.reduce(
    (acc, inv) => {
      acc[inv.status] += 1;
      return acc;
    },
    { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } as Record<SkillInvocationStatus, number>,
  );
}

export function getRuntimeStatus() {
  const queueCounts = getJobCounts();
  const invocations = skillInvocationStore.listAll();

  return {
    totalSignals: runtimeStore.signals.length,
    totalPlans: runtimeStore.plans.length,
    ...queueCounts,
    totalArtifacts: runtimeStore.artifacts.length,
    registeredAgents: agentRegistry.listAgents().length,
    totalSkillInvocations: invocations.length,
    skillInvocationsByStatus: countInvocationsByStatus(invocations),
  };
}

export function getQueueStatus() {
  const queueCounts = getJobCounts();

  return {
    ...queueCounts,
    jobs: jobQueue.list(),
  };
}

export function getAgentStatus() {
  const agents = agentRegistry.listAgents();

  return {
    registeredAgents: agents.length,
    agentCapabilityMap: Object.fromEntries(
      agents.map((agent) => [agent.agentName, agent.capabilities]),
    ),
    agents,
  };
}

export function getPlannerStrategyStatus() {
  const strategies = listPlannerStrategies();
  const recentPlans = runtimeStore.plans.slice(-10);

  const strategyUsage: Record<string, number> = {};
  // Count total plans resolved per strategy across all plan history
  for (const plan of runtimeStore.plans) {
    strategyUsage[plan.strategyId] = (strategyUsage[plan.strategyId] ?? 0) + 1;
  }

  return {
    strategyCount: strategies.length,
    plannerStrategies: strategies,
    plannerStrategySummary: strategies.map((s) => ({
      id: s.id,
      name: s.name,
      strategyType: s.strategyType,
      status: s.status,
      supportedSignals: s.supportedSignals,
      plansResolved: strategyUsage[s.id] ?? 0,
    })),
    recentPlanStrategyUsage: recentPlans.map((p) => ({
      planId: p.id,
      strategyId: p.strategyId,
      strategyType: p.strategyType,
    })),
  };
}

export function getArtifactStatus() {
  return {
    totalArtifacts: runtimeStore.artifacts.length,
    artifacts: runtimeStore.artifacts,
  };
}

export function getSkillInvocationStatus() {
  const invocations = skillInvocationStore.listAll();

  return {
    totalInvocations: invocations.length,
    byStatus: countInvocationsByStatus(invocations),
    invocations,
  };
}
