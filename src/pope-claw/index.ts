/**
 * Pope-Claw Bridge — Module Entry Point
 *
 * The core innovation of eighteen-core: routes destructive tool calls
 * through GitHub Actions for sandboxed, git-audited execution.
 *
 * Usage:
 *   import { createPopeClawBridge } from "@eighteen/pope-claw";
 *   const bridge = createPopeClawBridge(config);
 *   const result = await bridge.route(toolCallRequest);
 */

import * as fs from "fs";
import * as path from "path";
import { PopeClawConfig, ToolCallRequest, ToolCallResult } from "./types";
import { PopeClawRouter } from "./router";
import { createWebhookRouter } from "./webhook-server";

export { PopeClawRouter } from "./router";
export { createWebhookRouter, waitForCallback } from "./webhook-server";
export { logAuditEntry, formatCommitMessage } from "./audit-logger";
export { handleFailure, classifyFailure, summarizeFailure } from "./error-recovery";
export * from "./types";

/** Default config path */
const CONFIG_PATH = path.join(
  process.env.HOME || "~",
  ".eighteen",
  "pope-claw.json"
);

/** Load pope-claw config from disk */
export function loadConfig(configPath: string = CONFIG_PATH): PopeClawConfig | null {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as PopeClawConfig;
  } catch {
    return null;
  }
}

/** Create and return a configured Pope-Claw bridge */
export function createPopeClawBridge(config?: PopeClawConfig): PopeClawRouter | null {
  const resolvedConfig = config || loadConfig();

  if (!resolvedConfig) {
    console.log("[pope-claw] No config found — bridge disabled");
    return null;
  }

  if (!resolvedConfig.remoteTool.enabled) {
    console.log("[pope-claw] Bridge disabled in config");
    return null;
  }

  console.log(`[pope-claw] Bridge enabled — routing to ${resolvedConfig.remoteTool.repo}`);
  return new PopeClawRouter(resolvedConfig);
}
