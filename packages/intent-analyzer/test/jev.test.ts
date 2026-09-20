import test from "node:test";
import assert from "node:assert/strict";
import { JevBackend, buildJevQuestions } from "../src/jev.js";
import { IntentAnalyzerFailure } from "../src/contract.js";
import type { JevIntentAnalyzerConfig } from "../src/config.js";

const config: JevIntentAnalyzerConfig = { protocol: "jev", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1500, maxInputCharacters: 12000, maxResponseBytes: 32768 };
const tools = [{ name: "search", description: "Search documents", parameters: { type: "object", properties: { query: { type: "string" } } } }];
function answer(input: { readonly text: string; readonly tools?: typeof tools }, overrides: Record<string, unknown> = {}) {
  const { questions } = buildJevQuestions(input.tools ?? []);
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) answers[id] = question.type === "choice" ? { type: "choice", choice: id === "primary_intent" ? "research" : "read_only", probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, 1 / Object.keys(question.criteria).length])), confidence: 0.9 } : { type: "noul", noul: id === "should_reply" || id.startsWith("tool::") ? 0.9 : 0.1 };
  return { model: "jev-latest", answers: { ...answers, ...overrides }, usage: { input_tokens: 1, output_tokens: 1 } };
}

test("Jev backend sends one native System One request with all tool prompts", async () => {
  let seen: { url: string; init: RequestInit | undefined } | undefined;
  const input = { text: "find this", tools };
  const backend = new JevBackend(config, "fake-key", async (url, init) => { seen = { url: String(url), init }; return new Response(JSON.stringify(answer(input)), { headers: { "content-type": "application/json" } }); });
  const result = await backend.analyze(input, new AbortController().signal);
  assert.equal(seen?.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal((seen?.init?.headers as Record<string, string>).authorization, "Bearer fake-key");
  const body = JSON.parse(String(seen?.init?.body)) as { state: unknown; model: string; questions: Record<string, { type: string; instructions: string }> };
  assert.deepEqual(body.state, { request: "find this" }); assert.equal(body.model, "jev-latest"); assert.equal(body.questions["tool::search"]?.type, "noul"); assert.match(body.questions["tool::search"]?.instructions ?? "", /Search documents/); assert.match(body.questions["tool::search"]?.instructions ?? "", /parameters/); assert.doesNotMatch(JSON.stringify(body), /fake-key/);
  assert.deepEqual(result, { schemaVersion: 2, primaryIntent: "research", actionMode: "read_only", needsMemory: false, needsExternalInformation: false, userExplicitlyRequestedExecution: false, shouldReply: true, selectedToolNames: ["search"] });
});

test("Jev Noul uses strict greater-than half and rejects answer mismatches", async () => {
  const input = { text: "hello", tools: [] };
  const boundary = new JevBackend(config, "fake-key", async () => new Response(JSON.stringify(answer(input, { should_reply: { type: "noul", noul: 0.5 } }))));
  assert.equal((await boundary.analyze(input, new AbortController().signal)).shouldReply, false);
  const missing = new JevBackend(config, "fake-key", async () => new Response(JSON.stringify({ answers: {} })));
  await assert.rejects(() => missing.analyze(input, new AbortController().signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "protocol_error");
});

test("Jev backend fail categories cover HTTP, malformed and bounded responses", async () => {
  const input = { text: "hello", tools: [] };
  const http = new JevBackend(config, "fake-key", async () => new Response("{}", { status: 429 }));
  await assert.rejects(() => http.analyze(input, new AbortController().signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "http_error");
  const malformed = new JevBackend(config, "fake-key", async () => new Response("not-json"));
  await assert.rejects(() => malformed.analyze(input, new AbortController().signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "invalid_json");
  const tooLarge = new JevBackend({ ...config, maxResponseBytes: 256 }, "fake-key", async () => new Response("x".repeat(400)));
  await assert.rejects(() => tooLarge.analyze(input, new AbortController().signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "response_too_large");
});

test("Jev request body cap fails before the network", async () => {
  let called = false;
  const backend = new JevBackend(config, "fake-key", async () => { called = true; return new Response("{}"); });
  const huge = [{ name: "search", description: "x".repeat(270_000), parameters: { type: "object" } }];
  await assert.rejects(() => backend.analyze({ text: "hello", tools: huge }, new AbortController().signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "input_too_large");
  assert.equal(called, false);
});
