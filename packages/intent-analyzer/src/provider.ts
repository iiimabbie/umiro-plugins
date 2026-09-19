import type { ContextBlock, ContextProvider, ContextRequest, PluginLogger } from "./umiro-api.js";
import type { IntentAnalyzerBackend, IntentAnalysis, FailureCategory } from "./contract.js";
import { IntentAnalyzerFailure } from "./contract.js";
import type { IntentAnalyzerConfig } from "./config.js";
import { validateIntentAnalysis } from "./schema.js";

function log(logger: PluginLogger | undefined, level: "debug" | "info" | "warn" | "error", event: string, message: string, data: Record<string, string | number | boolean>): void {
  try { logger?.[level](event, message, data); } catch { /* observability must not alter request behavior */ }
}
function category(error: unknown): FailureCategory {
  return error instanceof IntentAnalyzerFailure ? error.category : "network_error";
}

export function createIntentAnalyzerProvider(config: IntentAnalyzerConfig, backend: IntentAnalyzerBackend, logger?: PluginLogger): ContextProvider {
  return {
    id: "intent.analysis", role: "intent", priority: 600,
    async load(request: ContextRequest): Promise<readonly ContextBlock[]> {
      if (request.signal?.aborted) throw request.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      const started = Date.now();
      const text = request.prompt;
      if (!text.trim()) { log(logger, "debug", "intent.analysis.skipped", "Intent analysis skipped for empty input", { runId: request.runId, reason: "empty_input" }); return []; }
      if (text.length > config.maxInputCharacters) { log(logger, "debug", "intent.analysis.skipped", "Intent analysis skipped because input is too large", { runId: request.runId, reason: "input_too_large" }); return []; }
      log(logger, "debug", "intent.analysis.started", "Intent analysis started", { runId: request.runId, backend: backend.id, model: config.model });
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
      try {
        const result = validateIntentAnalysis(await backend.analyze({ text }, signal));
        const analysis: IntentAnalysis = result;
        const block: ContextBlock = {
          id: `intent.analysis:${request.runId}`,
          providerId: "intent.analysis",
          role: "intent",
          content: `<intent-analysis trust="untrusted-data" advisory="true">\n${JSON.stringify(analysis)}\n</intent-analysis>`,
          source: { kind: "intent-analysis", ref: request.runId, metadata: { backend: backend.id, schemaVersion: 1 } },
          influence: "information", instructionAuthority: "none", retention: "normal",
        };
        const data: Record<string, string | number | boolean> = { runId: request.runId, backend: backend.id, model: config.model, latencyMs: Date.now() - started, primaryIntent: analysis.primaryIntent, actionMode: analysis.actionMode };
        if (analysis.confidence !== undefined) data.confidence = analysis.confidence;
        log(logger, "info", "intent.analysis.completed", "Intent analysis completed", data);
        return [block];
      } catch (error) {
        if (request.signal?.aborted) throw error;
        if (timeoutSignal.aborted) { log(logger, "warn", "intent.analysis.timeout", "Intent analysis timed out", { runId: request.runId, backend: backend.id, model: config.model, latencyMs: Date.now() - started }); return []; }
        log(logger, "warn", "intent.analysis.failed", "Intent analysis failed; continuing without intent context", { runId: request.runId, backend: backend.id, model: config.model, latencyMs: Date.now() - started, category: category(error) });
        return [];
      }
    },
  };
}
