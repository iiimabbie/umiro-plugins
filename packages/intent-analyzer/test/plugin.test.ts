import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlugin } from "../src/index.js";
import type { PluginLogger, PluginSetupContext } from "../src/umiro-api.js";

const logger: PluginLogger = { debug() {}, info() {}, warn() {}, error() {} };
const setup = (config: Record<string, never> = {}): PluginSetupContext => ({
  pluginId: "intent-analyzer",
  namespace: "intent-analyzer",
  permissionCeiling: {},
  config,
  logger,
  getSecret: () => undefined,
});

test("manifest permits install without configuration", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../umiro.plugin.json", import.meta.url), "utf8")) as { configSchema?: { required?: unknown; properties?: { protocol?: { enum?: unknown[]; default?: unknown }; baseUrl?: { default?: unknown }; model?: { default?: unknown } } }; contributes?: { turnAnalyzers?: string[]; contextProviders?: string[] }; optionalSecrets?: string[] };
  assert.equal(manifest.configSchema?.required, undefined);
  assert.deepEqual(manifest.configSchema?.properties?.protocol?.enum, ["openai-chat-completions", "jev"]);
  assert.deepEqual(manifest.contributes, { turnAnalyzers: ["intent.analysis"] });
  assert.deepEqual(manifest.optionalSecrets, ["UMIRO_INTENT_API_KEY", "TYPESAFE_API_KEY"]);
  assert.equal(manifest.configSchema?.properties?.protocol?.default, "jev");
  assert.equal(manifest.configSchema?.properties?.baseUrl?.default, "https://api.typesafe.ai");
  assert.equal(manifest.configSchema?.properties?.model?.default, "jev-latest");
});

test("an unconfigured installation stays enabled and contributes an inert provider", async () => {
  const plugin = createPlugin(setup());
  assert.deepEqual(await plugin.health?.(), { status: "ok", detail: "installed but inactive until configured" });
  const analyzer = plugin.contributions.turnAnalyzers?.[0];
  assert.equal(analyzer?.id, "intent.analysis");
  assert.equal(await analyzer?.analyze({ event: { id: "event", occurredAt: new Date().toISOString(), identity: { transport: "test", externalId: "user", principalId: null }, conversation: { transport: "test", externalId: "conversation", kind: "direct" }, content: [] }, text: "hello", defaultShouldReply: true, tools: [] }), undefined);
});
