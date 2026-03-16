import { eventBus, EventBus } from '../packages/core/src/event_bus';

beforeEach(() => {
  eventBus.reset();
});

describe('eventBus', () => {
  describe('on / emit', () => {
    it('calls registered handler when event is emitted', () => {
      const handler = jest.fn();
      eventBus.on('skill.invocation.started', handler);
      eventBus.emit('skill.invocation.started', { id: 'inv_1' } as never);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ id: 'inv_1' });
    });

    it('calls multiple handlers for the same event', () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      eventBus.on('skill.invocation.started', h1);
      eventBus.on('skill.invocation.started', h2);
      eventBus.emit('skill.invocation.started', { id: 'inv_1' } as never);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('does not call handlers for different events', () => {
      const handler = jest.fn();
      eventBus.on('signal.received', handler);
      eventBus.emit('plan.created', { id: 'plan_1' } as never);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does nothing when no handlers are registered for the event', () => {
      expect(() => eventBus.emit('artifact.created', { id: 'art_1' } as never)).not.toThrow();
    });
  });

  describe('off', () => {
    it('removes a specific handler', () => {
      const handler = jest.fn();
      eventBus.on('skill.invocation.started', handler);
      eventBus.off('skill.invocation.started', handler);
      eventBus.emit('skill.invocation.started', { id: 'inv_1' } as never);
      expect(handler).not.toHaveBeenCalled();
    });

    it('only removes the specified handler, not others', () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      eventBus.on('skill.invocation.started', h1);
      eventBus.on('skill.invocation.started', h2);
      eventBus.off('skill.invocation.started', h1);
      eventBus.emit('skill.invocation.started', { id: 'inv_1' } as never);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('does nothing when removing a handler that was never registered', () => {
      const handler = jest.fn();
      expect(() => eventBus.off('signal.received', handler)).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears all listeners', () => {
      const handler = jest.fn();
      eventBus.on('signal.received', handler);
      eventBus.on('plan.created', handler);
      eventBus.reset();
      eventBus.emit('signal.received', { id: 'sig_1' } as never);
      eventBus.emit('plan.created', { id: 'plan_1' } as never);
      expect(handler).not.toHaveBeenCalled();
    });

    it('clears event history on reset', () => {
      eventBus.emit('signal.received', { id: 'sig_1' } as never);
      expect(eventBus.getHistory()).toHaveLength(1);
      eventBus.reset();
      expect(eventBus.getHistory()).toHaveLength(0);
    });
  });

  describe('skill invocation events', () => {
    it('emits skill.invocation.started', () => {
      const handler = jest.fn();
      eventBus.on('skill.invocation.started', handler);
      eventBus.emit('skill.invocation.started', { id: 'inv_1', status: 'running' } as never);
      expect(handler).toHaveBeenCalledWith({ id: 'inv_1', status: 'running' });
    });

    it('emits skill.invocation.completed', () => {
      const handler = jest.fn();
      eventBus.on('skill.invocation.completed', handler);
      eventBus.emit('skill.invocation.completed', { id: 'inv_1', status: 'completed' } as never);
      expect(handler).toHaveBeenCalledWith({ id: 'inv_1', status: 'completed' });
    });

    it('emits skill.invocation.failed', () => {
      const handler = jest.fn();
      eventBus.on('skill.invocation.failed', handler);
      eventBus.emit('skill.invocation.failed', { id: 'inv_1', status: 'failed' } as never);
      expect(handler).toHaveBeenCalledWith({ id: 'inv_1', status: 'failed' });
    });
  });

  describe('getHistory', () => {
    it('records emitted events in order', () => {
      eventBus.emit('signal.received', { id: 'sig_1' } as never);
      eventBus.emit('plan.created', { id: 'plan_1' } as never);
      eventBus.emit('job.queued', { id: 'job_1' } as never);

      const history = eventBus.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].event).toBe('signal.received');
      expect(history[1].event).toBe('plan.created');
      expect(history[2].event).toBe('job.queued');
    });

    it('records payload in history', () => {
      const payload = { id: 'sig_1', name: 'test' };
      eventBus.emit('signal.received', payload as never);
      const history = eventBus.getHistory();
      expect(history[0].payload).toEqual(payload);
    });

    it('assigns monotonically increasing eventIds', () => {
      eventBus.emit('signal.received', { id: 'sig_1' } as never);
      eventBus.emit('plan.created', { id: 'plan_1' } as never);
      const history = eventBus.getHistory();
      expect(history[1].eventId).toBeGreaterThan(history[0].eventId);
    });

    it('returns a copy so mutations do not affect the internal log', () => {
      eventBus.emit('signal.received', { id: 'sig_1' } as never);
      const h1 = eventBus.getHistory();
      h1.push({ eventId: 999, event: 'fake', payload: null, timestamp: 0 });
      expect(eventBus.getHistory()).toHaveLength(1);
    });
  });

  describe('subscriber error isolation', () => {
    it('does not halt emission when a subscriber throws', () => {
      const throwing = jest.fn(() => { throw new Error('boom'); });
      const safe = jest.fn();
      eventBus.on('signal.received', throwing);
      eventBus.on('signal.received', safe);
      expect(() => eventBus.emit('signal.received', { id: 'sig_1' } as never)).not.toThrow();
      expect(throwing).toHaveBeenCalledTimes(1);
      expect(safe).toHaveBeenCalledTimes(1);
    });
  });

  describe('type-safe EventBus with custom map', () => {
    it('supports custom event maps', () => {
      type MyMap = { 'custom.event': { value: number } };
      const bus = new EventBus<MyMap>();
      const handler = jest.fn();
      bus.on('custom.event', handler);
      bus.emit('custom.event', { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });
  });
});
