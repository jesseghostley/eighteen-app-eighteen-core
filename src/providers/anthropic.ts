/**
 * Anthropic Provider — Direct Claude LLM Integration
 *
 * Sends messages to Claude via the Anthropic SDK and handles
 * tool_use responses in a loop.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, AgentCallOptions, ProviderConfig } from "./types";
import { getToolDefinitions } from "../tools/index";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async callAgent(options: AgentCallOptions): Promise<string> {
    const client = new Anthropic({ apiKey: this.config.apiKey });
    const tools = getToolDefinitions();

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: options.userMessage },
    ];

    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;

      const response = await client.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        system: options.systemPrompt,
        tools: tools as Anthropic.Tool[],
        messages,
      });

      const textParts: string[] = [];
      const toolUseParts: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolUseParts.push(block);
        }
      }

      if (toolUseParts.length === 0 || response.stop_reason === "end_turn") {
        return textParts.join("\n") || "(no response)";
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseParts) {
        const result = await options.onToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.success ? result.output : `Error: ${result.error}`,
          is_error: !result.success,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    return "(max tool iterations reached)";
  }
}
