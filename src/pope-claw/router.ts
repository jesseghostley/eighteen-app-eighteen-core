/**
 * Pope-Claw Router — Tool Routing (Local vs GitHub)
 *
 * The core decision engine: checks if a tool call should run
 * locally (fast) or be dispatched to GitHub Actions (audited).
 */

import { PopeClawConfig, ToolCallRequest, ToolCallResult } from "./types";
import { dispatchToGitHub } from "./github-dispatch";
import { logAuditEntry } from "./audit-logger";

export class PopeClawRouter {
  private config: PopeClawConfig;

  constructor(config: PopeClawConfig) {
    this.config = config;
  }

  /** Check if a tool should be routed through GitHub Actions */
  isRemoteTool(toolName: string): boolean {
    if (!this.config.remoteTool.enabled) return false;
    return this.config.remoteTools.includes(toolName);
  }

  /** Check if a tool should be executed locally */
  isLocalTool(toolName: string): boolean {
    return this.config.localTools.includes(toolName);
  }

  /**
   * Route a tool call to the appropriate executor.
   * Remote tools go through GitHub Actions; local tools return null
   * so the gateway can handle them with the existing execution path.
   */
  async route(request: ToolCallRequest): Promise<ToolCallResult | null> {
    if (!this.isRemoteTool(request.tool)) {
      // Local tool — let the gateway handle it directly
      return null;
    }

    const startTime = Date.now();

    try {
      const result = await dispatchToGitHub(this.config, request);
      const duration = Date.now() - startTime;

      await logAuditEntry({
        timestamp: new Date().toISOString(),
        tool: request.tool,
        status: result.success ? "SUCCESS" : "FAILED",
        summary: result.success
          ? `Executed ${request.tool} successfully`
          : `${request.tool} failed: ${result.error}`,
        runId: result.runId,
        commitSha: result.commitSha,
      });

      return { ...result, duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await logAuditEntry({
        timestamp: new Date().toISOString(),
        tool: request.tool,
        status: "FAILED",
        summary: `Dispatch error: ${errorMessage}`,
      });

      return {
        tool: request.tool,
        success: false,
        output: "",
        error: errorMessage,
        duration,
      };
    }
  }
}
