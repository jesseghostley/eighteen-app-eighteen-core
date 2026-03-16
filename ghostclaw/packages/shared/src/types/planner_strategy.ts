export type StrategyType = 'rule' | 'ai' | 'hybrid';

export type StrategyStatus = 'active' | 'inactive';

export type PlannerStrategy = {
  id: string;
  name: string;
  description: string;
  supportedSignals: string[];
  strategyType: StrategyType;
  status: StrategyStatus;
};
