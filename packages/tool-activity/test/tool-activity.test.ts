import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ActivityTracker, createPlugin, renderActivity, resolveOptions } from "../src/index.js";
import type { DiscordPluginService, JsonObject } from "../src/umiro-api.js";

/** Deterministic clock whose timers fire only when the test advances it. */
function fakeClock() {
  let now = 1_000_000; let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimer = ((fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;
  const clearTimer = ((id: unknown) => { timers.delete(id as number); }) as typeof clearTimeout;
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at); timers.delete(due[0]); due[1].fn();
      await new Promise(resolve => setImmediate(resolve));
    }
    now = target;
    await new Promise(resolve => setImmediate(resolve));
  };
  return { now: () => now, setTimer, clearTimer, advance, pendingTimers: () => timers.size };
}

interface Call { readonly op: "send" | "edit" | "delete"; readonly channelId: string; readonly messageId?: string; readonly content?: string }
function fakeDiscord(options: { failEdit?: boolean; failDelete?: boolean; failSend?: boolean } = {}) {
  const calls: Call[] = []; let nextMessage = 1;
  const discord: DiscordPluginService = {
    async sendMessage({ channelId, content }) { if (options.failSend) throw new Error("send failed"); calls.push({ op: "send", channelId, content }); return { messageId: `msg-${nextMessage++}` }; },
    async editMessage({ channelId, messageId, content }) { if (options.failEdit) throw new Error("edit failed"); calls.push({ op: "edit", channelId, messageId, content }); },
    async deleteMessage({ channelId, messageId }) { if (options.failDelete) throw new Error("delete failed"); calls.push({ op: "delete", channelId, messageId }); },
  };
  return { discord, calls };
}

const discordRun = (runId: string, channelId = "chan-1"): JsonObject => ({ runId, destination: { kind: "discord", channelId } });
const toolStarted = (runId: string, operationId: string, tool: string): JsonObject => ({ ...discordRun(runId), operationId, tool, state: "executing" });
const toolCompleted = (runId: string, operationId: string, tool: string, state = "succeeded"): JsonObject => ({ ...discordRun(runId), operationId, tool, state });

function setup(discordOptions?: Parameters<typeof fakeDiscord>[0], config: JsonObject = {}) {
  const clock = fakeClock(); const { discord, calls } = fakeDiscord(discordOptions);
  const warnings: string[] = [];
  const tracker = new ActivityTracker({ discord, options: resolveOptions(config), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, logger: { debug() {}, info() {}, warn(event) { warnings.push(event); }, error() {} } });
  return { clock, calls, tracker, warnings };
}

test("manifest hooks match the plugin instance", async () => {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../umiro.plugin.json", import.meta.url)), "utf8")) as { contributes: { hooks: string[] } };
  const plugin = createPlugin({ pluginId: "tool-activity", namespace: "tool-activity", permissionCeiling: {}, config: {}, services: { discord: fakeDiscord().discord }, getSecret: () => undefined });
  assert.deepEqual(plugin.contributions.hooks?.map(hook => hook.id), manifest.contributes.hooks);
  assert.deepEqual(plugin.contributions.hooks?.map(hook => hook.event), ["tool.started", "tool.completed", "step.completed", "run.completed", "delivery.completed", "delivery.failed"]);
  assert.throws(() => createPlugin({ pluginId: "tool-activity", namespace: "tool-activity", permissionCeiling: {}, config: {}, getSecret: () => undefined }), /Discord plugin service/);
});

test("renderActivity formats lines and keeps the tail under the cap", () => {
  assert.equal(renderActivity([], 100), "…");
  assert.equal(renderActivity([{ kind: "tool", operationId: "1", tool: "web_fetch", status: "running" }, { kind: "note", text: "checking" }, { kind: "tool", operationId: "2", tool: "read_file", status: "ok" }, { kind: "tool", operationId: "3", tool: "bash", status: "err" }], 1900), "→ web_fetch\n> checking\n✓ read_file\n✗ bash");
  const long = Array.from({ length: 10 }, (_, index) => ({ kind: "tool" as const, operationId: String(index), tool: `tool_${index}`, status: "ok" as const }));
  const rendered = renderActivity(long, 30);
  assert.ok(rendered.length <= 30 && rendered.endsWith("✓ tool_9") && !rendered.includes("tool_0"));
  assert.equal(renderActivity([{ kind: "note", text: "x".repeat(50) }], 10), "x".repeat(10));
});

test("first tool posts the message, later events edit it under the throttle, and delivered final output deletes it", async () => {
  const { clock, calls, tracker } = setup();
  tracker.toolStarted(toolStarted("run-1", "op-1", "web_fetch"));
  await tracker.idle();
  assert.deepEqual(calls, [{ op: "send", channelId: "chan-1", content: "→ web_fetch" }]);
  tracker.toolCompleted(toolCompleted("run-1", "op-1", "web_fetch"));
  tracker.stepCompleted({ ...discordRun("run-1"), stepKind: "model_call", assistantText: "Now reading the file" });
  tracker.toolStarted(toolStarted("run-1", "op-2", "read_file"));
  await tracker.idle();
  assert.equal(calls.length, 1, "edits are throttled inside the interval");
  await clock.advance(1000);
  await tracker.idle();
  assert.deepEqual(calls.at(-1), { op: "edit", channelId: "chan-1", messageId: "msg-1", content: "✓ web_fetch\n> Now reading the file\n→ read_file" });
  tracker.toolCompleted(toolCompleted("run-1", "op-2", "read_file", "failed"));
  tracker.runCompleted({ ...discordRun("run-1"), state: "succeeded" });
  await tracker.idle();
  assert.deepEqual(calls.at(-1), { op: "edit", channelId: "chan-1", messageId: "msg-1", content: "✓ web_fetch\n> Now reading the file\n✗ read_file" });
  assert.ok(!calls.some(call => call.op === "delete"), "run completion does not prove final delivery");
  await tracker.deliveryCompleted({ ...discordRun("run-1"), deliveryId: "delivery-1", state: "delivered" });
  assert.deepEqual(calls.at(-1), { op: "delete", channelId: "chan-1", messageId: "msg-1" });
  assert.deepEqual(tracker.activeRunIds, []);
});

test("failed delivery stays visible until a later retry succeeds", async () => {
  const { calls, tracker } = setup();
  tracker.toolStarted(toolStarted("run-retry", "op-1", "web_fetch"));
  tracker.runCompleted({ ...discordRun("run-retry"), state: "succeeded" });
  await tracker.idle();
  tracker.deliveryFailed({ ...discordRun("run-retry"), deliveryId: "delivery-retry", state: "pending", willRetry: true });
  await tracker.idle();
  assert.ok(!calls.some(call => call.op === "delete"));
  assert.deepEqual(tracker.activeRunIds, ["run-retry"]);
  await tracker.deliveryCompleted({ ...discordRun("run-retry"), deliveryId: "delivery-retry", state: "delivered" });
  assert.equal(calls.filter(call => call.op === "delete").length, 1);
  assert.deepEqual(tracker.activeRunIds, []);
});

test("failed, cancelled and timed out runs keep the message as evidence", async () => {
  for (const state of ["failed", "cancelled", "timed_out"]) {
    const { clock, calls, tracker } = setup();
    tracker.toolStarted(toolStarted("run-x", "op-1", "bash"));
    tracker.runCompleted({ ...discordRun("run-x"), state });
    await tracker.idle(); await clock.advance(10_000); await tracker.idle();
    assert.ok(!calls.some(call => call.op === "delete"), `${state} keeps the message`);
    assert.deepEqual(tracker.activeRunIds, []);
  }
});

test("runs without a Discord destination and runs without tools are ignored", async () => {
  const { clock, calls, tracker } = setup();
  tracker.toolStarted({ runId: "run-s", destination: { kind: "scheduler" }, operationId: "op-1", tool: "bash", state: "executing" });
  tracker.toolStarted({ runId: "run-n", operationId: "op-1", tool: "bash", state: "executing" });
  tracker.stepCompleted({ ...discordRun("run-d"), assistantText: "thinking" });
  tracker.runCompleted({ ...discordRun("run-d"), state: "succeeded" });
  await tracker.idle(); await clock.advance(5000); await tracker.idle();
  assert.deepEqual(calls, []);
  assert.deepEqual(tracker.activeRunIds, []);
});

test("concurrent runs get separate messages keyed by runId", async () => {
  const { clock, calls, tracker } = setup();
  tracker.toolStarted(toolStarted("run-a", "op-a", "bash", ));
  tracker.toolStarted(toolStarted("run-b", "op-b", "web_fetch"));
  await tracker.idle();
  assert.deepEqual(calls.map(call => [call.op, call.content]), [["send", "→ bash"], ["send", "→ web_fetch"]]);
  tracker.runCompleted({ ...discordRun("run-a"), state: "succeeded" });
  await tracker.idle();
  await tracker.deliveryCompleted({ ...discordRun("run-a"), deliveryId: "delivery-a", state: "delivered" });
  assert.deepEqual(calls.filter(call => call.op === "delete"), [{ op: "delete", channelId: "chan-1", messageId: "msg-1" }]);
  assert.deepEqual(tracker.activeRunIds, ["run-b"]);
});

test("Discord failures are logged and never surface; the final edit is not throttled", async () => {
  const failing = setup({ failEdit: true, failDelete: true });
  failing.tracker.toolStarted(toolStarted("run-e", "op-1", "bash"));
  await failing.tracker.idle();
  failing.tracker.toolCompleted(toolCompleted("run-e", "op-1", "bash"));
  failing.tracker.runCompleted({ ...discordRun("run-e"), state: "succeeded" });
  await failing.tracker.idle();
  await failing.tracker.deliveryCompleted({ ...discordRun("run-e"), deliveryId: "delivery-e", state: "delivered" });
  assert.deepEqual(failing.warnings, ["tool-activity.update_failed", "tool-activity.delete_failed"]);
  assert.equal(failing.clock.pendingTimers(), 0);

  const unsendable = setup({ failSend: true });
  unsendable.tracker.toolStarted(toolStarted("run-u", "op-1", "bash"));
  unsendable.tracker.runCompleted({ ...discordRun("run-u"), state: "succeeded" });
  await unsendable.tracker.idle();
  await unsendable.tracker.deliveryCompleted({ ...discordRun("run-u"), deliveryId: "delivery-u", state: "delivered" });
  assert.deepEqual(unsendable.calls, []);
  assert.deepEqual(unsendable.tracker.activeRunIds, []);
});

test("hook wrappers swallow handler errors and delivery completion waits for the final edit", async () => {
  const clock = fakeClock(); const { discord, calls } = fakeDiscord();
  let released!: () => void; const gate = new Promise<void>(resolve => { released = resolve; });
  const slow: DiscordPluginService = { ...discord, async editMessage(input) { await gate; return discord.editMessage(input); } };
  const warnings: string[] = [];
  const plugin = createPlugin({ pluginId: "tool-activity", namespace: "tool-activity", permissionCeiling: {}, config: {}, services: { discord: slow }, logger: { debug() {}, info() {}, warn(event) { warnings.push(event); }, error() {} }, getSecret: () => undefined }, clock);
  const hook = (event: string) => plugin.contributions.hooks!.find(item => item.event === event)!;
  const context = { event: "", pluginId: "tool-activity" };
  await hook("tool.started").handle(toolStarted("run-h", "op-1", "bash"), context);
  await hook("tool.completed").handle(toolCompleted("run-h", "op-1", "bash"), context);
  await hook("run.completed").handle({ ...discordRun("run-h"), state: "succeeded" }, context);
  assert.equal(calls.filter(call => call.op === "delete").length, 0, "run.completed resolved while the final edit is still blocked");
  const delivered = hook("delivery.completed").handle({ ...discordRun("run-h"), deliveryId: "delivery-h", state: "delivered" }, context);
  released();
  await delivered;
  assert.deepEqual(calls.map(call => call.op), ["send", "edit", "delete"]);
  await hook("tool.started").handle({ runId: 5 } as unknown as JsonObject, context);
  assert.deepEqual(warnings, []);
});

test("options fall back to defaults for missing or invalid config", () => {
  assert.deepEqual(resolveOptions({}), { editIntervalMs: 1000, maxCharacters: 1900 });
  assert.deepEqual(resolveOptions({ editIntervalMs: 250, maxCharacters: 500 }), { editIntervalMs: 250, maxCharacters: 500 });
});
