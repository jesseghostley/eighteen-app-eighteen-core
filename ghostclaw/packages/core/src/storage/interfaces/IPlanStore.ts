import type { Plan } from '../../runtime_loop';

export interface IPlanStore {
  create(plan: Plan): Plan;
  getById(id: string): Plan | undefined;
  listAll(): Plan[];
  listBySignalId(signalId: string): Plan[];
  reset(): void;
}
