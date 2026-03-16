import type { Signal } from '../../core/src/runtime_loop';
import { findStrategyForSignal } from '../../core/src/planner_registry';

export type PlannerAction =
  | 'generate_content_cluster'
  | 'optimize_existing_page'
  | 'create_new_skill'
  | 'handle_runtime_error';

export type PlannerDecision = {
  strategyId: string;
  plannerAction: PlannerAction;
  priority: number;
  requiredAgents: string[];
  expectedOutputs: string[];
};

const SIGNAL_TO_ACTION_MAP: Record<string, PlannerAction> = {
  keyword_opportunity_detected: 'generate_content_cluster',
  ranking_loss_detected: 'optimize_existing_page',
  marketplace_gap_detected: 'create_new_skill',
  runtime_error_detected: 'handle_runtime_error',
};

const ACTION_METADATA: Record<
  PlannerAction,
  { priority: number; requiredAgents: string[]; expectedOutputs: string[] }
> = {
  generate_content_cluster: {
    priority: 2,
    requiredAgents: ['content_agent'],
    expectedOutputs: ['cluster_outline'],
  },
  optimize_existing_page: {
    priority: 1,
    requiredAgents: ['seo_agent'],
    expectedOutputs: ['optimized_page_sections'],
  },
  create_new_skill: {
    priority: 3,
    requiredAgents: ['skill_agent'],
    expectedOutputs: ['skill_package'],
  },
  handle_runtime_error: {
    priority: 0,
    requiredAgents: ['diagnostic_agent'],
    expectedOutputs: ['error_report'],
  },
};

const UNRESOLVED_STRATEGY_ID = 'unresolved';

export function routeSignal(signal: Signal): PlannerDecision {
  const action = SIGNAL_TO_ACTION_MAP[signal.name];

  if (!action) {
    throw new Error(`Unsupported signal name: ${signal.name}`);
  }

  const strategy = findStrategyForSignal(signal.name);
  const meta = ACTION_METADATA[action];

  return {
    strategyId: strategy?.id ?? UNRESOLVED_STRATEGY_ID,
    plannerAction: action,
    ...meta,
  };
}

export function routeSignalToPlannerAction(signal: Signal): PlannerAction {
  return routeSignal(signal).plannerAction;
}
