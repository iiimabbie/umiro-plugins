import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, type OpenAIIntentAnalyzerConfig } from "../src/config.js";
import { IntentAnalyzerFailure, type IntentAnalyzerBackend } from "../src/contract.js";
import { createIntentTurnAnalyzer } from "../src/provider.js";
import type { PluginLogger, TurnAnalyzerInput } from "../src/umiro-api.js";

const config = parseConfig({ protocol: "openai-chat-completions", baseUrl: "http://localhost/v1", model: "tiny" }) as OpenAIIntentAnalyzerConfig;
const request = (text: string, tools: TurnAnalyzerInput["tools"] = [], signal?: AbortSignal): TurnAnalyzerInput => ({ event: { id: "event-1", occurredAt: new Date().toISOString(), identity: { transport: "test", externalId: "user", principalId: null }, conversation: { transport: "test", externalId: "conversation", kind: "direct" }, content: [] }, text, defaultShouldReply: true, tools, ...(signal ? { signal } : {}) });
const valid = { schemaVersion: 2, primaryIntent: "code_analysis", actionMode: "read_only", needsMemory: false, needsExternalInformation: true, userExplicitlyRequestedExecution: false, shouldReply: true, selectedToolNames: ["search"], confidence: 0.7 };
function logger(records: unknown[]): PluginLogger { return { debug: (event, message, data) => records.push({ level: "debug", event, message, data }), info: (event, message, data) => records.push({ level: "info", event, message, data }), warn: (event, message, data) => records.push({ level: "warn", event, message, data }), error: (event, message, data) => records.push({ level: "error", event, message, data }) }; }
function backend(result: unknown, calls: string[] = []): IntentAnalyzerBackend { return { id: "test-backend", analyze: async ({ text }) => { calls.push(text); return result; } }; }

test("analyzer returns one advisory block and selected tools", async () => {
  const records: unknown[] = []; const analyzer = createIntentTurnAnalyzer(config, backend(valid), logger(records));
  const result = await analyzer.analyze(request("analyze this code", [{ name: "search", description: "Search", parameters: { type: "object" } }]));
  assert.equal(result?.shouldReply, true); assert.deepEqual(result?.selectedToolNames, ["search"]);
  const block = result?.contextBlocks[0]; assert.equal(block?.providerId, "intent.analysis"); assert.equal(block?.influence, "information"); assert.equal(block?.instructionAuthority, "none");
  assert.match(block?.content ?? "", /schemaVersion":2/); assert.equal((records[1] as { event: string }).event, "intent.analysis.completed");
});

test("analyzer passes every candidate once and discards unknown selections", async () => {
  let seen: unknown; const analyzer = createIntentTurnAnalyzer(config, { id: "test", analyze: async input => { seen = input; return { ...valid, selectedToolNames: ["search", "not-registered"] }; } });
  const result = await analyzer.analyze(request("find it", [{ name: "search", description: "Search", parameters: { type: "object" } }, { name: "write", description: "Write", parameters: { type: "object" } }]));
  assert.deepEqual(result?.selectedToolNames, ["search"]); assert.deepEqual((seen as { tools: unknown[] }).tools, [{ name: "search", description: "Search", parameters: { type: "object" } }, { name: "write", description: "Write", parameters: { type: "object" } }]);
});

test("explicit actions with no selected business tools retain the empty selection", async () => {
  const records: unknown[] = [];
  const contradictory = { ...valid, actionMode: "mutate", userExplicitlyRequestedExecution: true, selectedToolNames: [] };
  const analyzer = createIntentTurnAnalyzer(config, backend(contradictory), logger(records));
  const result = await analyzer.analyze(request("edit it", [{ name: "write_file", description: "Write a file", parameters: { type: "object" } }]));
  assert.deepEqual(result?.selectedToolNames, []);
  assert.equal((records[1] as { event: string }).event, "intent.analysis.completed");
});

test("catalog is excluded from direct analyzer candidates", async () => {
  let seen: unknown;
  const analyzer = createIntentTurnAnalyzer(config, { id: "test", analyze: async input => { seen = input; return { ...valid, selectedToolNames: [] }; } });
  await analyzer.analyze(request("find a tool", [{ name: "tool_catalog", description: "Catalog", parameters: { type: "object" } }]));
  assert.deepEqual((seen as { tools: unknown[] }).tools, []);
});

test("empty, oversized and over-cap candidate input skips backend", async () => {
  const calls: string[] = []; const analyzer = createIntentTurnAnalyzer({ ...config, maxInputCharacters: 3 }, backend(valid, calls));
  assert.equal(await analyzer.analyze(request("  ")), undefined); assert.equal(await analyzer.analyze(request("four")), undefined);
  const many = Array.from({ length: 129 }, (_, index) => ({ name: `tool-${index}`, description: "x", parameters: { type: "object" } }));
  assert.equal(await analyzer.analyze(request("ok", many)), undefined); assert.deepEqual(calls, []);
});

test("catalog does not count toward the analyzer candidate limit", async () => {
  const calls: string[] = [];
  const tools = Array.from({ length: 128 }, (_, index) => ({ name: `tool-${index}`, description: "x", parameters: { type: "object" } }));
  tools.push({ name: "tool_catalog", description: "Catalog", parameters: { type: "object" } });
  const analyzer = createIntentTurnAnalyzer(config, backend({ ...valid, selectedToolNames: [] }, calls));
  assert.deepEqual((await analyzer.analyze(request("analyze", tools)))?.selectedToolNames, []);
  assert.deepEqual(calls, ["analyze"]);
});

test("analyzer fail-opens malformed and backend errors but preserves cancellation", async () => {
  assert.equal(await createIntentTurnAnalyzer(config, backend({ ...valid, shouldReply: "yes" })).analyze(request("x")), undefined);
  assert.equal(await createIntentTurnAnalyzer(config, { id: "broken", analyze: async () => { throw new IntentAnalyzerFailure("http_error", "do not log this body"); } }).analyze(request("x")), undefined);
  const controller = new AbortController(); const cancelled = new Error("cancelled"); controller.abort(cancelled);
  await assert.rejects(() => createIntentTurnAnalyzer(config, backend(valid)).analyze(request("x", [], controller.signal)), cancelled);
});

test("logger failures do not alter analyzer behavior", async () => {
  const throwingLogger: PluginLogger = { debug() { throw new Error("debug logger failed"); }, info() { throw new Error("info logger failed"); }, warn() { throw new Error("warn logger failed"); }, error() { throw new Error("error logger failed"); } };
  const result = await createIntentTurnAnalyzer(config, backend(valid), throwingLogger).analyze(request("hello", [{ name: "search", description: "Search", parameters: { type: "object" } }]));
  assert.equal(result?.contextBlocks.length, 1);
});
