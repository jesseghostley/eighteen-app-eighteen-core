/**
 * Provider Factory — Create the Right LLM Provider
 *
 * Resolves configuration from environment variables and returns
 * the appropriate provider instance.
 *
 * Usage:
 *   import { createProvider } from "./providers";
 *   const provider = createProvider();
 *   const response = await provider.callAgent({ ... });
 *
 * Environment:
 *   EIGHTEEN_PROVIDER=openrouter   → Use OpenRouter (access any model)
 *   EIGHTEEN_PROVIDER=anthropic    → Use Anthropic SDK directly (default)
 *   EIGHTEEN_MODEL=qwen/qwen3-coder-480b-a35b-instruct → Model to use
 */

import { LLMProvider, resolveProviderConfig } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenRouterProvider } from "./openrouter";

export { LLMProvider, AgentCallOptions } from "./types";

export function createProvider(): LLMProvider {
  const config = resolveProviderConfig();

  switch (config.provider) {
    case "openrouter":
      console.log(`[provider] OpenRouter → ${config.model}`);
      return new OpenRouterProvider(config);

    case "anthropic":
      console.log(`[provider] Anthropic → ${config.model}`);
      return new AnthropicProvider(config);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
