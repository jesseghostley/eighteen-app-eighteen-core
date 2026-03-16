import { routeSignal, routeSignalToPlannerAction } from '../packages/planner/src/signal_router';
import type { Signal } from '../packages/core/src/runtime_loop';

function makeSignal(name: string): Signal {
  return { id: 'test_1', name, createdAt: Date.now() };
}

describe('routeSignal', () => {
  it('routes keyword_opportunity_detected to generate_content_cluster', () => {
    const decision = routeSignal(makeSignal('keyword_opportunity_detected'));
    expect(decision.plannerAction).toBe('generate_content_cluster');
    expect(decision.strategyId).toBe('rule_keyword_cluster_strategy');
  });

  it('routes ranking_loss_detected to optimize_existing_page', () => {
    const decision = routeSignal(makeSignal('ranking_loss_detected'));
    expect(decision.plannerAction).toBe('optimize_existing_page');
    expect(decision.strategyId).toBe('rule_ranking_loss_strategy');
  });

  it('routes marketplace_gap_detected to create_new_skill', () => {
    const decision = routeSignal(makeSignal('marketplace_gap_detected'));
    expect(decision.plannerAction).toBe('create_new_skill');
    expect(decision.strategyId).toBe('rule_marketplace_gap_strategy');
  });

  it('routes runtime_error_detected to handle_runtime_error', () => {
    const decision = routeSignal(makeSignal('runtime_error_detected'));
    expect(decision.plannerAction).toBe('handle_runtime_error');
    expect(decision.strategyId).toBe('rule_runtime_error_strategy');
  });

  it('throws for an unknown signal name', () => {
    expect(() => routeSignal(makeSignal('unknown_signal'))).toThrow(
      'Unsupported signal name: unknown_signal',
    );
  });
});

describe('routeSignalToPlannerAction', () => {
  it('returns the planner action for a known signal', () => {
    expect(routeSignalToPlannerAction(makeSignal('keyword_opportunity_detected'))).toBe(
      'generate_content_cluster',
    );
  });
});
