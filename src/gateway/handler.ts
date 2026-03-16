/**
 * Eighteen Gateway Handler — Message Processing + Tool Dispatch
 *
 * Processes incoming messages from any channel (Telegram, Discord, etc.),
 * sends them to the LLM, and routes tool calls through the Pope-Claw
 * bridge or executes them locally.
 */

import { PopeClawRouter } from "../pope-claw/router";
import { ToolCallResult } from "../pope-claw/types";
import { executeLocalTool } from "../tools/index";
import { handleFailure, fetchRunLogs } from "../pope-claw/error-recovery";
import { loadConfig } from "../pope-claw/index";
import { SoulIdentity } from "./soul-loader";
import { createProvider, LLMProvider } from "../providers/index";

export interface HandlerConfig {
  bridge: PopeClawRouter | null;
  soul: SoulIdentity | null;
}

export interface MessageContext {
  text: string;
  sessionId: string;
  channelType: string;
  sendReply: (text: string) => Promise<void>;
}

export type MessageHandler = (ctx: MessageContext) => Promise<void>;

/** Create the main message handler */
export function createHandler(config: HandlerConfig): MessageHandler {
  const { bridge, soul } = config;
  const provider = createProvider();

  return async (ctx: MessageContext): Promise<void> => {
    const { text, sessionId, sendReply } = ctx;

    // Build system prompt from Soul identity
    const systemPrompt = soul
      ? `${soul.personality}\n\n${soul.identity}\n\n${soul.style}`
      : "You are a helpful AI assistant.";

    try {
      // Send to LLM and get response (may include tool calls)
      const response = await provider.callAgent({
        systemPrompt,
        userMessage: text,
        sessionId,
        onToolCall: async (toolName: string, toolArgs: Record<string, unknown>) => {
          return await dispatchTool(bridge, toolName, toolArgs, sessionId, sendReply);
        },
      });

      await sendReply(response);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[handler] Error processing message: ${errorMsg}`);
      await sendReply("I encountered an error processing your request. Please try again.");
    }
  };
}

/** Route a tool call through Pope-Claw (remote) or local execution */
async function dispatchTool(
  bridge: PopeClawRouter | null,
  toolName: string,
  toolArgs: Record<string, unknown>,
  sessionId: string,
  sendReply: (text: string) => Promise<void>
): Promise<ToolCallResult> {
  // Check if this tool should go through GitHub Actions
  if (bridge && bridge.isRemoteTool(toolName)) {
    // Send thinking indicator
    await sendReply(`Executing \`${toolName}\` via secure sandbox...`);

    const request = {
      tool: toolName,
      args: toolArgs,
      sessionId,
      callbackUrl: "",
    };

    const result = await bridge.route(request);

    if (result && !result.success) {
      // Trigger error recovery
      const config = loadConfig();
      if (config && result.runId) {
        const [owner, repo] = config.remoteTool.repo.split("/");
        const logs = await fetchRunLogs(owner, repo, result.runId);
        const recovery = await handleFailure(config, request, result.runId, logs, 1);

        if (recovery.shouldAskDirector) {
          await sendReply(recovery.summary);
        }
      }
    }

    return result || {
      tool: toolName,
      success: false,
      output: "",
      error: "Bridge returned no result",
    };
  }

  // Local tool execution
  return executeLocalTool(toolName, toolArgs);
}
