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
  const manifest = JSON.parse(await readFile(new URL("../../umiro.plugin.json", import.meta.url), "utf8")) as { configSchema?: { required?: unknown } };
  assert.equal(manifest.configSchema?.required, undefined);
});

test("an unconfigured installation stays enabled and contributes an inert provider", async () => {
  const plugin = createPlugin(setup());
  assert.deepEqual(await plugin.health?.(), { status: "ok", detail: "installed but inactive until configured" });
  const provider = plugin.contributions.contextProviders?.[0];
  assert.equal(provider?.id, "intent.analysis");
  assert.deepEqual(await provider?.load({ runId: "run", prompt: "hello", execution: { origin: { kind: "test" }, actor: { id: "user", kind: "human", roles: [] }, authority: {} } }), []);
});
