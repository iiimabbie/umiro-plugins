import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, resolveConfig, type OpenAIIntentAnalyzerConfig } from "../src/config.js";
import { IntentAnalyzerFailure } from "../src/contract.js";
import { CLASSIFIER_SYSTEM_PROMPT } from "../src/prompt.js";
import { OpenAICompatibleChatBackend } from "../src/openai-compatible.js";
import { readBoundedBody } from "../src/bounded-body.js";

const config = (extra: Record<string, unknown> = {}) => parseConfig({ protocol: "openai-chat-completions", baseUrl: "https://example.test/v1", model: "tiny", ...extra }) as OpenAIIntentAnalyzerConfig;
const analysis = { schemaVersion: 2, primaryIntent: "chat", actionMode: "read_only", needsMemory: false, needsExternalInformation: false, userExplicitlyRequestedExecution: false, shouldReply: true, selectedToolNames: [] };
const response = (content: string, init?: ResponseInit) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" }, ...init });

test("config applies defaults and normalizes URL", () => {
  assert.deepEqual(config(), { protocol: "openai-chat-completions", baseUrl: "https://example.test/v1/", model: "tiny", timeoutMs: 1500, maxInputCharacters: 12000, maxResponseBytes: 32768, responseFormat: "prompt-only" });
  assert.equal((parseConfig({ protocol: "openai-chat-completions", baseUrl: "http://localhost:1", model: "m", responseFormat: "json-object" }) as OpenAIIntentAnalyzerConfig).responseFormat, "json-object");
  for (const value of ["ftp://example.test", "example.test", "", "  "]) assert.throws(() => config({ baseUrl: value }));
  assert.throws(() => config({ timeoutMs: 99 }));
  assert.throws(() => config({ maxResponseBytes: 255 }));
  assert.throws(() => config({ extra: true }));
  assert.deepEqual(parseConfig({ protocol: "jev", baseUrl: "https://example.test", model: "jev-latest" }), { protocol: "jev", baseUrl: "https://example.test/", model: "jev-latest", timeoutMs: 1500, maxInputCharacters: 12000, maxResponseBytes: 32768 });
  assert.throws(() => resolveConfig({ protocol: "unknown" }));
  assert.throws(() => resolveConfig({ protocol: 123 }));
});

test("empty and partial configuration resolve to an inert installation", () => {
  assert.deepEqual(resolveConfig({}), { missingFields: ["protocol", "baseUrl", "model"] });
  assert.deepEqual(resolveConfig({ protocol: "openai-chat-completions" }), { missingFields: ["baseUrl", "model"] });
  assert.equal(resolveConfig({ protocol: "openai-chat-completions", baseUrl: "http://localhost:1/v1", model: "tiny" }).config?.model, "tiny");
});

test("backend sends the bounded OpenAI-compatible request without auth by default", async () => {
  let seen: { url: string; init: RequestInit | undefined } | undefined;
  const backend = new OpenAICompatibleChatBackend(config(), undefined, async (url, init) => { seen = { url: String(url), init }; return response(JSON.stringify(analysis)); });
  assert.deepEqual(await backend.analyze({ text: "hello" }, new AbortController().signal), analysis);
  assert.equal(seen?.url, "https://example.test/v1/chat/completions");
  const body = JSON.parse(String(seen?.init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "tiny"); assert.equal(body.temperature, 0); assert.equal(body.stream, false);
  assert.equal((body.messages as { role: string; content: string }[])[1]?.content, "hello");
  assert.equal((seen?.init?.headers as Record<string, string>).authorization, undefined);
  assert.equal(body.response_format, undefined);
  assert.ok(CLASSIFIER_SYSTEM_PROMPT.includes("Return exactly one JSON object"));
});

test("backend supports json-object and trimmed Bearer auth", async () => {
  let init: RequestInit | undefined;
  const backend = new OpenAICompatibleChatBackend(config({ responseFormat: "json-object" }), "  secret-value  ", async (_url, request) => { init = request; return response(JSON.stringify(analysis)); });
  await backend.analyze({ text: "hello" }, new AbortController().signal);
  assert.equal((init?.headers as Record<string, string>).authorization, "Bearer secret-value");
  assert.deepEqual((JSON.parse(String(init?.body)) as Record<string, unknown>).response_format, { type: "json_object" });
});

test("backend classifies malformed responses, HTTP errors and bounded bodies", async () => {
  const signal = new AbortController().signal;
  const malformed = new OpenAICompatibleChatBackend(config(), undefined, async () => new Response("{}"));
  await assert.rejects(() => malformed.analyze({ text: "x" }, signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "protocol_error");
  let canceled = false;
  const errorBody = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  const http = new OpenAICompatibleChatBackend(config(), undefined, async () => new Response(errorBody, { status: 500 }));
  await assert.rejects(() => http.analyze({ text: "x" }, signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "http_error");
  assert.equal(canceled, true);
  const tooLarge = new OpenAICompatibleChatBackend(config({ maxResponseBytes: 256 }), undefined, async () => new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(400) } }] })));
  await assert.rejects(() => tooLarge.analyze({ text: "x" }, signal), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "response_too_large");
});

test("bounded reader rejects chunked bodies over the limit", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } });
  await assert.rejects(() => readBoundedBody(new Response(body), 3), (error: unknown) => error instanceof IntentAnalyzerFailure && error.category === "response_too_large");
});

test("bounded reader responds when an upstream abort interrupts a pending read", async () => {
  const controller = new AbortController();
  const reason = new Error("upstream cancelled");
  const body = new ReadableStream<Uint8Array>({ start() {} });
  const pending = readBoundedBody(new Response(body), 100, controller.signal);
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(pending, reason);
});
