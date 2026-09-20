import type { ContextBlock, PluginLogger, TurnAnalysis, TurnAnalyzer, TurnAnalyzerInput } from "./umiro-api.js";
import type { IntentAnalyzerBackend, IntentAnalysis, ToolCandidate } from "./contract.js";
import { IntentAnalyzerFailure } from "./contract.js";
import type { IntentAnalyzerConfig } from "./config.js";
import { validateIntentAnalysis } from "./schema.js";

const MAX_TOOL_CANDIDATES = 128;
const MAX_ANALYSIS_REQUEST_BYTES = 256 * 1024;

function log(logger: PluginLogger | undefined, level: "debug" | "info" | "warn", event: string, message: string, data: Record<string, string | number | boolean>): void {
  try { logger?.[level](event, message, data); } catch { /* observability must not alter request behavior */ }
}

export function createIntentTurnAnalyzer(config: IntentAnalyzerConfig, backend: IntentAnalyzerBackend, logger?: PluginLogger): TurnAnalyzer {
  return {
    id: "intent.analysis",
    async analyze(request: TurnAnalyzerInput): Promise<TurnAnalysis | undefined> {
      if (request.signal?.aborted) throw request.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      if (!request.text.trim() || request.text.length > config.maxInputCharacters) return undefined;
      if (request.tools.length > MAX_TOOL_CANDIDATES) return undefined;
      const tools: ToolCandidate[] = request.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters) }));
      if (new TextEncoder().encode(JSON.stringify({ text: request.text, tools })).byteLength > MAX_ANALYSIS_REQUEST_BYTES) return undefined;
      const started = Date.now();
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
      log(logger, "debug", "intent.analysis.started", "Intent analysis started", { eventId: request.event.id, backend: backend.id });
      try {
        const analysis = validateIntentAnalysis(await backend.analyze({ text: request.text, tools }, signal));
        const allowed = new Set(tools.map(tool => tool.name));
        const selectedToolNames = analysis.selectedToolNames.filter(name => allowed.has(name));
        const normalized: IntentAnalysis = { ...analysis, selectedToolNames };
        const block: ContextBlock = {
          id: `intent.analysis:${request.event.id}`,
          providerId: "intent.analysis",
          role: "intent",
          content: `<intent-analysis trust="untrusted-data" advisory="true">\n${JSON.stringify(normalized)}\n</intent-analysis>`,
          source: { kind: "intent-analysis", ref: request.event.id, metadata: { backend: backend.id, schemaVersion: 2 } },
          influence: "information", instructionAuthority: "none", retention: "normal",
        };
        log(logger, "info", "intent.analysis.completed", "Intent analysis completed", { eventId: request.event.id, backend: backend.id, latencyMs: Date.now() - started, shouldReply: normalized.shouldReply, selectedToolCount: selectedToolNames.length });
        return { shouldReply: normalized.shouldReply, selectedToolNames, contextBlocks: [block] };
      } catch (error) {
        if (request.signal?.aborted) throw error;
        const category = error instanceof IntentAnalyzerFailure ? error.category : (timeoutSignal.aborted ? "timeout" : "network_error");
        log(logger, "warn", "intent.analysis.failed", "Intent analysis failed; continuing with deterministic fallback", { eventId: request.event.id, backend: backend.id, latencyMs: Date.now() - started, category });
        return undefined;
      }
    },
  };
}
