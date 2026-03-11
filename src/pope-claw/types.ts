/**
 * Pope-Claw Bridge — Type Definitions
 *
 * Core interfaces for routing tool calls through GitHub Actions
 * and handling webhook callbacks.
 */

/** Bridge configuration loaded from ~/.eighteen/pope-claw.json */
export interface PopeClawConfig {
  remoteTool: {
    enabled: boolean;
    repo: string;           // e.g. "eighteen-app/eighteen-core"
    branch: string;         // e.g. "audit/main"
    workflowId: string;     // e.g. "pope-claw-exec.yml"
    callbackUrl: string;    // e.g. "https://host/api/pope-claw/callback"
    timeoutMs: number;      // max wait for Action completion (default 120000)
  };
  remoteTools: string[];    // tools routed to GitHub: ["exec", "bash", "write", "edit", "apply_patch"]
  localTools: string[];     // tools executed directly: ["read", "grep", "glob", "web_search", "message"]
  retryPolicy: {
    maxRetries: number;     // max auto-retries for transient failures (default 2)
    backoffMs: number[];    // backoff intervals: [30000, 90000]
  };
}

/** Inbound tool call from the agent runtime */
export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  callbackUrl: string;
}

/** Result returned from tool execution (local or remote) */
export interface ToolCallResult {
  tool: string;
  success: boolean;
  output: string;
  error?: string;
  runId?: number;           // GitHub Actions run ID (remote only)
  commitSha?: string;       // audit commit SHA (remote only)
  duration?: number;        // execution time in ms
}

/** Webhook callback payload from GitHub Actions */
export interface WebhookPayload {
  sessionId: string;
  tool: string;
  success: boolean;
  output: string;
  error?: string;
  runId: number;
  commitSha: string;
}

/** Audit log entry appended to PROJECT-LOG.md */
export interface AuditEntry {
  timestamp: string;
  tool: string;
  status: "SUCCESS" | "FAILED" | "RETRY";
  summary: string;
  runId?: number;
  commitSha?: string;
}

/** Error classification for retry policy */
export type FailureType = "transient" | "permanent";

/** Error recovery context passed to the LLM summarizer */
export interface ErrorContext {
  tool: string;
  runId: number;
  logs: string;
  exitCode: number;
  failureType: FailureType;
  retryCount: number;
}
