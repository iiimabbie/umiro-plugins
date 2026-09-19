import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";
import { IntentAnalyzerFailure, type IntentAnalyzerBackend } from "../src/contract.js";
import { createIntentAnalyzerProvider } from "../src/provider.js";
import type { ContextRequest, PluginLogger } from "../src/umiro-api.js";

const config = parseConfig({ protocol: "openai-chat-completions", baseUrl: "http://localhost/v1", model: "tiny" });
const request = (prompt: string, signal?: AbortSignal): ContextRequest => ({ runId: "run-1", prompt, execution: { origin: { kind: "test" }, actor: { id: "user", kind: "human", roles: [] }, authority: {} }, ...(signal ? { signal } : {}) });
const valid = { schemaVersion: 1, primaryIntent: "code_analysis", actionMode: "read_only", needsMemory: false, needsExternalInformation: true, userExplicitlyRequestedExecution: false, confidence: 0.7 };
function logger(records: unknown[]): PluginLogger { return { debug: (event, message, data) => records.push({ level: "debug", event, message, data }), info: (event, message, data) => records.push({ level: "info", event, message, data }), warn: (event, message, data) => records.push({ level: "warn", event, message, data }), error: (event, message, data) => records.push({ level: "error", event, message, data }) }; }
function backend(result: unknown, calls: string[] = []): IntentAnalyzerBackend { return { id: "test-backend", analyze: async ({ text }) => { calls.push(text); return result; } }; }

test("provider returns one advisory block with fixed trust metadata", async () => {
  const records: unknown[] = []; const provider = createIntentAnalyzerProvider(config, backend(valid), logger(records));
  const blocks = await provider.load(request("analyze this code"));
  assert.equal(blocks.length, 1); const block = blocks[0]!;
  assert.equal(block.id, "intent.analysis:run-1"); assert.equal(block.role, "intent"); assert.equal(block.providerId, "intent.analysis");
  assert.equal(block.influence, "information"); assert.equal(block.instructionAuthority, "none"); assert.equal(block.retention, "normal");
  assert.match(block.content, /<intent-analysis trust="untrusted-data" advisory="true">/); assert.doesNotMatch(block.content, /rationale|recommendedTool/);
  assert.deepEqual(block.source, { kind: "intent-analysis", ref: "run-1", metadata: { backend: "test-backend", schemaVersion: 1 } });
  assert.equal((records[1] as { event: string }).event, "intent.analysis.completed");
});

test("provider skips empty and oversized input without backend calls", async () => {
  const calls: string[] = []; const records: unknown[] = []; const limited = { ...config, maxInputCharacters: 3 };
  const provider = createIntentAnalyzerProvider(limited, backend(valid, calls), logger(records));
  assert.deepEqual(await provider.load(request("  ")), []); assert.deepEqual(await provider.load(request("four")), []); assert.deepEqual(calls, []);
  assert.deepEqual((records as { data?: { reason?: string } }[]).map(record => record.data?.reason), ["empty_input", "input_too_large"]);
});

test("provider fail-opens for schema and backend errors, but preserves cancellation", async () => {
  const records: unknown[] = []; const invalid = createIntentAnalyzerProvider(config, backend({ ...valid, needsMemory: "false" }), logger(records));
  assert.deepEqual(await invalid.load(request("x")), []);
  const failed = createIntentAnalyzerProvider(config, { id: "test", analyze: async () => { throw new IntentAnalyzerFailure("http_error", "do not log this body"); } }, logger(records));
  assert.deepEqual(await failed.load(request("x")), []);
  const controller = new AbortController(); const cancelled = new Error("cancelled"); const upstream = createIntentAnalyzerProvider(config, { id: "test", analyze: async () => { throw cancelled; } }, logger(records));
  controller.abort(cancelled); await assert.rejects(() => upstream.load(request("x", controller.signal)), cancelled);
  const serialized = JSON.stringify(records); assert.doesNotMatch(serialized, /do not log this body|cancelled/);
});

test("provider turns timeout into empty context", async () => {
  const timeoutConfig = { ...config, timeoutMs: 100 };
  const provider = createIntentAnalyzerProvider(timeoutConfig, { id: "slow", analyze: async (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
  assert.deepEqual(await provider.load(request("slow")), []);
});

test("logger failures never change success or fail-open behavior", async () => {
  const throwingLogger: PluginLogger = {
    debug() { throw new Error("debug logger failed"); },
    info() { throw new Error("info logger failed"); },
    warn() { throw new Error("warn logger failed"); },
    error() { throw new Error("error logger failed"); },
  };
  const success = createIntentAnalyzerProvider(config, backend(valid), throwingLogger);
  assert.equal((await success.load(request("hello"))).length, 1);
  const failed = createIntentAnalyzerProvider(config, { id: "broken", analyze: async () => { throw new Error("upstream failed"); } }, throwingLogger);
  assert.deepEqual(await failed.load(request("hello")), []);
});
