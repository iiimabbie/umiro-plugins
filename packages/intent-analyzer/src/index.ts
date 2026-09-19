import type { PluginInstance, PluginSetupContext } from "./umiro-api.js";
import { resolveConfig } from "./config.js";
import { OpenAICompatibleChatBackend } from "./openai-compatible.js";
import { createIntentAnalyzerProvider } from "./provider.js";

const INACTIVE_PROVIDER = {
  id: "intent.analysis",
  role: "intent",
  priority: 600,
  async load() { return []; },
} as const;

export function createPlugin(context: PluginSetupContext): PluginInstance {
  const resolved = resolveConfig(context.config);
  if (!resolved.config) {
    try { context.logger?.info("intent.analysis.unconfigured", "Intent analyzer is installed but inactive until configuration is complete", { missingFields: [...resolved.missingFields] }); } catch { /* optional setup logging must not block startup */ }
    return {
      contributions: { contextProviders: [INACTIVE_PROVIDER] },
      async health() { return { status: "ok", detail: "installed but inactive until configured" }; },
    };
  }
  const config = resolved.config;
  const backend = new OpenAICompatibleChatBackend(config, context.getSecret("UMIRO_INTENT_API_KEY"));
  return {
    contributions: { contextProviders: [createIntentAnalyzerProvider(config, backend, context.logger)] },
    async health() { return { status: "ok" }; },
  };
}
