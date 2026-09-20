import type { PluginInstance, PluginSetupContext, TurnAnalyzer } from "./umiro-api.js";
import { resolveConfig, type IntentAnalyzerConfig } from "./config.js";
import { OpenAICompatibleChatBackend } from "./openai-compatible.js";
import { JevBackend } from "./jev.js";
import { createIntentTurnAnalyzer } from "./provider.js";

const INACTIVE_ANALYZER: TurnAnalyzer = {
  id: "intent.analysis",
  async analyze() { return undefined; },
};

function backendFor(config: IntentAnalyzerConfig, context: PluginSetupContext) {
  switch (config.protocol) {
    case "openai-chat-completions": return new OpenAICompatibleChatBackend(config, context.getSecret("UMIRO_INTENT_API_KEY"));
    case "jev": {
      const key = context.getSecret("TYPESAFE_API_KEY")?.trim();
      return key ? new JevBackend(config, key) : undefined;
    }
    default: return assertNever(config);
  }
}

function assertNever(value: never): never { throw new TypeError(`unsupported intent analyzer protocol: ${String(value)}`); }

export function createPlugin(context: PluginSetupContext): PluginInstance {
  const resolved = resolveConfig(context.config);
  if (!resolved.config) {
    try { context.logger?.info("intent.analysis.unconfigured", "Intent analyzer is installed but inactive until configuration is complete", { missingFields: [...resolved.missingFields] }); } catch { /* optional setup logging must not block startup */ }
    return { contributions: { turnAnalyzers: [INACTIVE_ANALYZER] }, async health() { return { status: "ok", detail: "installed but inactive until configured" }; } };
  }
  const backend = backendFor(resolved.config, context);
  if (!backend) {
    try { context.logger?.info("intent.analysis.unconfigured", "Jev intent analyzer is inactive until TYPESAFE_API_KEY is configured", { missingFields: ["TYPESAFE_API_KEY"] }); } catch { /* optional setup logging must not block startup */ }
    return { contributions: { turnAnalyzers: [INACTIVE_ANALYZER] }, async health() { return { status: "ok", detail: "configured but inactive until TYPESAFE_API_KEY is configured" }; } };
  }
  return {
    contributions: { turnAnalyzers: [createIntentTurnAnalyzer(resolved.config, backend, context.logger)] },
    async health() { return { status: "ok" }; },
  };
}
