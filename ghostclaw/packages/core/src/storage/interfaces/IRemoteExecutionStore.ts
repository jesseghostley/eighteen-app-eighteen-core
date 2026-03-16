import type { RemoteExecutionRequest, RemoteExecutionResult, RemoteExecutionStatus } from '../../remote_execution';

export interface IRemoteExecutionStore {
  saveRequest(request: RemoteExecutionRequest): RemoteExecutionRequest;
  getRequestById(requestId: string): RemoteExecutionRequest | undefined;
  listAll(): RemoteExecutionRequest[];
  listByJobId(jobId: string): RemoteExecutionRequest[];
  listByWorkspaceId(workspaceId: string): RemoteExecutionRequest[];
  listByStatus(status: RemoteExecutionStatus): RemoteExecutionRequest[];
  updateStatus(requestId: string, status: RemoteExecutionStatus): RemoteExecutionRequest | undefined;
  saveResult(result: RemoteExecutionResult): RemoteExecutionResult;
  getResultByRequestId(requestId: string): RemoteExecutionResult | undefined;
  reset(): void;
}
