/**
 * OpenRouter Provider — Multi-Model LLM Integration
 *
 * Uses OpenRouter's OpenAI-compatible API to access any model:
 * - Claude (anthropic/claude-sonnet-4-20250514)
 * - GPT-5 (openai/gpt-5)
 * - Gemini (google/gemini-2.0-pro)
 * - Qwen3-Coder (qwen/qwen3-coder-480b-a35b-instruct)
 * - Qwen3.5 (qwen/qwen3.5-397b-a17b)
 * - Qwen3-Max-Thinking (qwen/qwen3-max-thinking)
 * - And hundreds more via OpenRouter
 *
 * OpenRouter provides a single API key and endpoint that routes to
 * any supported model, making the framework truly model-agnostic.
 */

import { LLMProvider, AgentCallOptions, ProviderConfig } from "./types";
import { getToolDefinitions } from "../tools/index";

// Node 18+ has global fetch; declare it for TypeScript
declare const fetch: typeof globalThis.fetch;

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterChoice {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: OpenRouterToolCall[];
  };
  finish_reason: string;
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async callAgent(options: AgentCallOptions): Promise<string> {
    const tools = getToolDefinitions();

    // Convert tool definitions to OpenAI function-calling format
    const openaiTools: OpenRouterTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const messages: OpenRouterMessage[] = [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userMessage },
    ];

    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;

      const response = await this.chat(messages, openaiTools);
      const choice = response.choices[0];

      if (!choice) {
        return "(no response from model)";
      }

      const { message } = choice;
      const toolCalls = message.tool_calls;

      // If no tool calls, return the text content
      if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
        return message.content || "(no response)";
      }

      // Add assistant message with tool calls to history
      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: toolCalls,
      });

      // Execute each tool call and add results
      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await options.onToolCall(toolCall.function.name, args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.success ? result.output : `Error: ${result.error}`,
        });
      }
    }

    return "(max tool iterations reached)";
  }

  private async chat(
    messages: OpenRouterMessage[],
    tools: OpenRouterTool[]
  ): Promise<OpenRouterResponse> {
    const baseUrl = this.config.baseUrl || "https://openrouter.ai/api/v1";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        "HTTP-Referer": "https://github.com/eighteen-app/eighteen-core",
        "X-Title": "Eighteen Core",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        messages,
        tools,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    return (await response.json()) as OpenRouterResponse;
  }
}
