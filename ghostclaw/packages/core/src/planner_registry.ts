import type { PlannerStrategy } from '../../shared/src/types/planner_strategy';

const strategyRegistry: Map<string, PlannerStrategy> = new Map();

export function registerPlannerStrategy(strategy: PlannerStrategy): void {
  strategyRegistry.set(strategy.id, strategy);
}

export function listPlannerStrategies(): PlannerStrategy[] {
  return Array.from(strategyRegistry.values());
}

export function getPlannerStrategy(id: string): PlannerStrategy | undefined {
  return strategyRegistry.get(id);
}

export function findStrategyForSignal(signalName: string): PlannerStrategy | undefined {
  return Array.from(strategyRegistry.values()).find(
    (strategy) =>
      strategy.status === 'active' && strategy.supportedSignals.includes(signalName),
  );
}

const seedStrategies: PlannerStrategy[] = [
  {
    id: 'rule_keyword_cluster_strategy',
    name: 'Keyword Cluster Strategy',
    description: 'Generates a content cluster plan in response to keyword opportunity signals.',
    supportedSignals: ['keyword_opportunity_detected'],
    strategyType: 'rule',
    status: 'active',
  },
  {
    id: 'rule_ranking_loss_strategy',
    name: 'Ranking Loss Strategy',
    description: 'Optimizes existing pages in response to ranking loss signals.',
    supportedSignals: ['ranking_loss_detected'],
    strategyType: 'rule',
    status: 'active',
  },
  {
    id: 'rule_marketplace_gap_strategy',
    name: 'Marketplace Gap Strategy',
    description: 'Creates new skills in response to marketplace gap signals.',
    supportedSignals: ['marketplace_gap_detected'],
    strategyType: 'rule',
    status: 'active',
  },
  {
    id: 'rule_runtime_error_strategy',
    name: 'Runtime Error Strategy',
    description:
      'Handles runtime error signals by triggering diagnostic and repair workflows.',
    supportedSignals: ['runtime_error_detected'],
    strategyType: 'rule',
    status: 'active',
  },
];

seedStrategies.forEach(registerPlannerStrategy);
