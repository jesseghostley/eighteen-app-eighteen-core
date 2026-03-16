import type {
  IPopeClawDispatcher,
  PopeClawExecutionResult,
} from './pope_claw_adapter';
import type { RemoteExecutionRequest } from './remote_execution';

/**
 * SimulatedSuccessDispatcher — a test dispatcher that always succeeds.
 * Useful for happy-path integration tests.
 */
export class SimulatedSuccessDispatcher implements IPopeClawDispatcher {
  readonly name = 'simulated-success';
  private readonly executions = new Map<string, PopeClawExecutionResult>();

  async dispatch(request: RemoteExecutionRequest): Promise<string> {
    const remoteRunId = `simulated_run_${request.request_id}`;
    this.executions.set(remoteRunId, {
      status: 'completed',
      stdout: `[simulated] executed: ${request.execution_type}`,
      stderr: '',
      exit_code: 0,
    });
    return remoteRunId;
  }

  async getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'> {
    const result = this.executions.get(remoteRunId);
    return result ? result.status : 'running';
  }

  async getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null> {
    return this.executions.get(remoteRunId) ?? null;
  }

  async cancel(_remoteRunId: string): Promise<boolean> {
    return true;
  }

  reset(): void {
    this.executions.clear();
  }
}

/**
 * SimulatedFailureDispatcher — a test dispatcher that always fails.
 * Useful for error-path testing.
 */
export class SimulatedFailureDispatcher implements IPopeClawDispatcher {
  readonly name = 'simulated-failure';
  private readonly failureMessage: string;
  private readonly executions = new Map<string, PopeClawExecutionResult>();

  constructor(failureMessage: string = 'Simulated execution failure') {
    this.failureMessage = failureMessage;
  }

  async dispatch(request: RemoteExecutionRequest): Promise<string> {
    const remoteRunId = `simulated_run_${request.request_id}`;
    this.executions.set(remoteRunId, {
      status: 'failed',
      stdout: '',
      stderr: this.failureMessage,
      exit_code: 1,
      error: this.failureMessage,
    });
    return remoteRunId;
  }

  async getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'> {
    const result = this.executions.get(remoteRunId);
    return result ? result.status : 'failed';
  }

  async getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null> {
    return this.executions.get(remoteRunId) ?? null;
  }

  async cancel(_remoteRunId: string): Promise<boolean> {
    return false;
  }

  reset(): void {
    this.executions.clear();
  }
}

/**
 * SimulatedTransientFailureDispatcher — a test dispatcher that fails
 * on the first N attempts and then succeeds.
 * Useful for testing retry logic.
 */
export class SimulatedTransientFailureDispatcher implements IPopeClawDispatcher {
  readonly name = 'simulated-transient-failure';
  private readonly failuresBeforeSuccess: number;
  private attemptCount = 0;
  private readonly executions = new Map<string, PopeClawExecutionResult>();

  constructor(failuresBeforeSuccess: number = 1) {
    this.failuresBeforeSuccess = failuresBeforeSuccess;
  }

  async dispatch(request: RemoteExecutionRequest): Promise<string> {
    const remoteRunId = `simulated_run_${request.request_id}`;
    this.attemptCount++;

    if (this.attemptCount <= this.failuresBeforeSuccess) {
      // Simulate a transient error (timeout) by throwing
      throw new Error('Connection timeout');
    } else {
      // Success on retry
      this.executions.set(remoteRunId, {
        status: 'completed',
        stdout: `[simulated] executed: ${request.execution_type} (succeeded after ${this.attemptCount - 1} failures)`,
        stderr: '',
        exit_code: 0,
      });
      return remoteRunId;
    }
  }

  async getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'> {
    const result = this.executions.get(remoteRunId);
    return result ? result.status : 'running';
  }

  async getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null> {
    return this.executions.get(remoteRunId) ?? null;
  }

  async cancel(_remoteRunId: string): Promise<boolean> {
    return true;
  }

  reset(): void {
    this.executions.clear();
    this.attemptCount = 0;
  }
}

/**
 * SimulatedPermanentFailureDispatcher — a test dispatcher that always fails
 * with a permanent (non-retryable) error.
 * Useful for testing permanent failure handling.
 */
export class SimulatedPermanentFailureDispatcher implements IPopeClawDispatcher {
  readonly name = 'simulated-permanent-failure';
  private readonly executions = new Map<string, PopeClawExecutionResult>();

  async dispatch(request: RemoteExecutionRequest): Promise<string> {
    const remoteRunId = `simulated_run_${request.request_id}`;
    this.executions.set(remoteRunId, {
      status: 'failed',
      stdout: '',
      stderr: 'Execution rejected by policy validation',
      exit_code: 1,
      error: 'Execution rejected by policy validation',
    });
    return remoteRunId;
  }

  async getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'> {
    const result = this.executions.get(remoteRunId);
    return result ? result.status : 'failed';
  }

  async getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null> {
    return this.executions.get(remoteRunId) ?? null;
  }

  async cancel(_remoteRunId: string): Promise<boolean> {
    return false;
  }

  reset(): void {
    this.executions.clear();
  }
}

/**
 * SimulatedControlledDispatcher — a test dispatcher that allows manual
 * control of execution behavior through method calls.
 * Useful for testing specific scenarios.
 */
export class SimulatedControlledDispatcher implements IPopeClawDispatcher {
  readonly name = 'simulated-controlled';
  private readonly executions = new Map<string, PopeClawExecutionResult>();
  private _nextResult: PopeClawExecutionResult = {
    status: 'completed',
    stdout: '[controlled] default success',
    stderr: '',
    exit_code: 0,
  };

  setNextResult(result: PopeClawExecutionResult): void {
    this._nextResult = result;
  }

  async dispatch(request: RemoteExecutionRequest): Promise<string> {
    const remoteRunId = `simulated_run_${request.request_id}`;
    this.executions.set(remoteRunId, { ...this._nextResult });
    return remoteRunId;
  }

  async getExecutionStatus(remoteRunId: string): Promise<'running' | 'completed' | 'failed'> {
    const result = this.executions.get(remoteRunId);
    return result ? result.status : 'running';
  }

  async getExecutionResult(remoteRunId: string): Promise<PopeClawExecutionResult | null> {
    return this.executions.get(remoteRunId) ?? null;
  }

  async cancel(_remoteRunId: string): Promise<boolean> {
    return true;
  }

  reset(): void {
    this.executions.clear();
    this._nextResult = {
      status: 'completed',
      stdout: '[controlled] default success',
      stderr: '',
      exit_code: 0,
    };
  }
}
