import type { RuntimeEventMap } from './runtime_events';

export type EventHistoryEntry = {
  /** Auto-incrementing event ID for ordering and deduplication. */
  eventId: number;
  event: string;
  payload: unknown;
  timestamp: number;
};

type EventHandler<T = unknown> = (payload: T) => void;

let _nextEventId = 1;

export class EventBus<TEventMap extends object = RuntimeEventMap> {
  private readonly listeners = new Map<string, EventHandler[]>();
  private readonly _history: EventHistoryEntry[] = [];

  emit<K extends keyof TEventMap & string>(event: K, payload: TEventMap[K]): void {
    this._history.push({
      eventId: _nextEventId++,
      event,
      payload,
      timestamp: Date.now(),
    });

    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }

    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (err) {
        console.warn(
          `[EventBus] Subscriber for "${event}" threw an error:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  on<K extends keyof TEventMap & string>(event: K, handler: EventHandler<TEventMap[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.push(handler as EventHandler);
    } else {
      this.listeners.set(event, [handler as EventHandler]);
    }
  }

  off<K extends keyof TEventMap & string>(event: K, handler: EventHandler<TEventMap[K]>): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }
    const updated = handlers.filter((h) => h !== (handler as EventHandler));
    if (updated.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, updated);
    }
  }

  /**
   * Returns an ordered copy of all events emitted on this bus instance since
   * the last reset().  Useful for asserting emission order in tests.
   */
  getHistory(): EventHistoryEntry[] {
    return [...this._history];
  }

  /**
   * Clears all listeners and the event history.
   * Intended for test isolation only.
   */
  reset(): void {
    this.listeners.clear();
    this._history.length = 0;
    _nextEventId = 1;
  }
}

export const eventBus = new EventBus();
