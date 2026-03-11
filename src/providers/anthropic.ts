/**
 * Anthropic Provider — Claude LLM Integration
 *
 * Sends messages to Claude and handles tool_use responses,
 * executing tool calls through the provided callback.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ToolCallResult } from "../pope-claw/types";
import { getToolDefinitions } from "../tools/index";

const MODEL = process.env.EIGHTEEN_MODEL || "claude-sonnet-4-20250514";

export interface AgentCallOptions {
  systemPrompt: string;
  userMessage: string;
  sessionId: string;
  onToolCall: (toolName: string, toolArgs: Record<string, unknown>) => Promise<ToolCallResult>;
}

/** Call the Claude agent, handle tool use loops, return final text response */
export async function callAgent(options: AgentCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const client = new Anthropic({ apiKey });
  const tools = getToolDefinitions();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: options.userMessage },
  ];

  // Tool use loop — keep calling until we get a text response
  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: options.systemPrompt,
      tools: tools as Anthropic.Tool[],
      messages,
    });

    // Collect text parts and tool use parts
    const textParts: string[] = [];
    const toolUseParts: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUseParts.push(block);
      }
    }

    // If no tool calls, return the text response
    if (toolUseParts.length === 0 || response.stop_reason === "end_turn") {
      return textParts.join("\n") || "(no response)";
    }

    // Add assistant response to messages
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseParts) {
      const result = await options.onToolCall(
        toolUse.name,
        toolUse.input as Record<string, unknown>
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.success
          ? result.output
          : `Error: ${result.error}`,
        is_error: !result.success,
      });
    }

    // Add tool results to messages
    messages.push({ role: "user", content: toolResults });
  }

  return "(max tool iterations reached)";
}
