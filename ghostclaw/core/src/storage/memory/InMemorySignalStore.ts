import type { ISignalStore } from '../interfaces/ISignalStore';
import type { Signal } from '../../runtime_loop';

export class InMemorySignalStore implements ISignalStore {
  private readonly signals = new Map<string, Signal>();

  create(signal: Signal): Signal {
    this.signals.set(signal.id, signal);
    return signal;
  }

  getById(id: string): Signal | undefined {
    return this.signals.get(id);
  }

  listAll(): Signal[] {
    return Array.from(this.signals.values());
  }

  reset(): void {
    this.signals.clear();
  }
}
