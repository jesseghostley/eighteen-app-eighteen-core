/**
 * Provider Types — Unified LLM Provider Interface
 *
 * Defines the contract that all LLM providers (Anthropic, OpenRouter, etc.)
 * must implement. This allows Eighteen Core to be model-agnostic.
 */

import { ToolCallResult } from "../pope-claw/types";

/** Tool definition in a provider-neutral format */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Options passed to the agent call */
export interface AgentCallOptions {
  systemPrompt: string;
  userMessage: string;
  sessionId: string;
  onToolCall: (toolName: string, toolArgs: Record<string, unknown>) => Promise<ToolCallResult>;
}

/** Any LLM provider must implement this interface */
export interface LLMProvider {
  readonly name: string;
  callAgent(options: AgentCallOptions): Promise<string>;
}

/** Supported provider types */
export type ProviderType = "anthropic" | "openrouter";

/** Provider configuration from environment */
export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Resolve provider config from environment variables.
 *
 * Env vars:
 *   EIGHTEEN_PROVIDER  — "anthropic" | "openrouter" (default: "anthropic")
 *   EIGHTEEN_MODEL     — model identifier (provider-specific default if unset)
 *   ANTHROPIC_API_KEY   — required for anthropic provider
 *   OPENROUTER_API_KEY  — required for openrouter provider
 *   OPENROUTER_BASE_URL — optional, defaults to https://openrouter.ai/api/v1
 */
export function resolveProviderConfig(): ProviderConfig {
  const provider = (process.env.EIGHTEEN_PROVIDER || "anthropic") as ProviderType;

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is not set");
    }
    return {
      provider,
      model: process.env.EIGHTEEN_MODEL || "anthropic/claude-sonnet-4-20250514",
      apiKey,
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    };
  }

  // Default: anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }
  return {
    provider: "anthropic",
    model: process.env.EIGHTEEN_MODEL || "claude-sonnet-4-20250514",
    apiKey,
  };
}
