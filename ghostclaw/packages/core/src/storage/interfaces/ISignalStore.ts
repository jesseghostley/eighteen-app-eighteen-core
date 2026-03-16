import type { Signal } from '../../runtime_loop';

export interface ISignalStore {
  create(signal: Signal): Signal;
  getById(id: string): Signal | undefined;
  listAll(): Signal[];
  reset(): void;
}
