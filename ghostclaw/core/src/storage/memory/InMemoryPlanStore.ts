import type { IPlanStore } from '../interfaces/IPlanStore';
import type { Plan } from '../../runtime_loop';

export class InMemoryPlanStore implements IPlanStore {
  private readonly plans = new Map<string, Plan>();

  create(plan: Plan): Plan {
    this.plans.set(plan.id, plan);
    return plan;
  }

  getById(id: string): Plan | undefined {
    return this.plans.get(id);
  }

  listAll(): Plan[] {
    return Array.from(this.plans.values());
  }

  listBySignalId(signalId: string): Plan[] {
    return Array.from(this.plans.values()).filter((p) => p.signalId === signalId);
  }

  reset(): void {
    this.plans.clear();
  }
}
