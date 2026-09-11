import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginStateStore } from "../src/umiro-api.js";
import { createPlugin } from "../src/index.js";

class MemoryState implements PluginStateStore {
  rows = new Map<string, Uint8Array>();
  async read(key: string) { return this.rows.get(key); }
  async writeAtomic(key: string, value: Uint8Array) { this.rows.set(key, value); }
  async remove(key: string) { return this.rows.delete(key); }
  async list(prefix = "") { return [...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.byteLength })); }
}

test("one Soul Guardian entry contributes tools, a job and a command", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "umiro-sg-"));
  await writeFile(join(workspace, "SOUL.md"), "persona");
  const notifications: string[] = [];
  const plugin = createPlugin({ pluginId: "soul-guardian", namespace: "soul-guardian", permissionCeiling: { capabilities: [], visibility: { kind: "all" }, instructionAuthority: "none" }, config: { workspacePath: workspace, schedule: "0 8 * * *", timezone: "Asia/Taipei", channelId: "123456789012345678", targets: [{ path: "SOUL.md", mode: "alert" }] }, state: new MemoryState(), services: { discord: { async sendMessage(input) { notifications.push(`${input.channelId}:${input.content}`); return { messageId: String(notifications.length) }; } } }, getSecret: () => undefined });
  await plugin.start?.();
  assert.equal(plugin.contributions.tools?.length, 5);
  const policies = Object.fromEntries(plugin.contributions.tools!.map(tool => [tool.name, tool.policy]));
  assert.equal(policies.soul_guardian_check?.sideEffect, "idempotent");
  assert.equal(policies.soul_guardian_approve?.interactionRequirement, "interactive_required");
  assert.equal(policies.soul_guardian_restore?.interactionRequirement, "interactive_required");
  assert.equal(policies.soul_guardian_approve?.approvalRequirement, "required");
  assert.equal(policies.soul_guardian_restore?.approvalRequirement, "required");
  assert.equal(plugin.contributions.jobs?.[0]?.id, "soul-guardian.check");
  assert.equal(plugin.contributions.jobs?.[0]?.timezone, "Asia/Taipei");
  assert.equal(plugin.contributions.commands?.[0]?.name, "soul-guardian");

  const job = plugin.contributions.jobs![0]!;
  await job.run({ jobId: job.id });
  await job.run({ jobId: job.id });
  assert.equal(notifications.length, 1);
  assert.match(notifications[0]!, /123456789012345678:.*SOUL\.md.*unapproved/s);

  const approve = plugin.contributions.tools!.find(tool => tool.name === "soul_guardian_approve")!;
  const approved = await approve.execute({ paths: ["SOUL.md"] }, { operationId: "approve", signal: new AbortController().signal });
  assert.equal(approved.ok, true);
  await job.run({ jobId: job.id });
  await writeFile(join(workspace, "SOUL.md"), "changed persona");
  await job.run({ jobId: job.id });
  await job.run({ jobId: job.id });
  assert.equal(notifications.length, 2);
  assert.match(notifications[1]!, /SOUL\.md.*drift/s);
});

test("drift notification publishes owner-only approval buttons when the service is available", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "umiro-sg-buttons-"));
  await writeFile(join(workspace, "SOUL.md"), "persona");
  const buttonSets: Array<{ allowedUserIds: readonly string[]; buttons: readonly { actionTool: string }[] }> = [];
  const plugin = createPlugin({
    pluginId: "soul-guardian", namespace: "soul-guardian", permissionCeiling: { capabilities: [], visibility: { kind: "all" }, instructionAuthority: "none" },
    config: { workspacePath: workspace, schedule: "0 8 * * *", channelId: "123456789012345678", targets: [{ path: "SOUL.md", mode: "alert" }] }, state: new MemoryState(),
    services: { discord: {
      async sendMessage() { throw new Error("plain notification should not be used when buttons are available"); },
      async createButtonSet(input) { buttonSets.push({ allowedUserIds: input.allowedUserIds, buttons: input.buttons }); return { messageId: "message", buttonSetId: "set", expiresAt: "2026-09-12T00:00:00.000Z" }; },
    } }, getSecret: name => name === "UMIRO_OWNER_DISCORD_ID" ? "owner" : undefined,
  });
  await plugin.start?.();
  await plugin.contributions.jobs![0]!.run({ jobId: "soul-guardian.check" });
  await writeFile(join(workspace, "SOUL.md"), "changed");
  await plugin.contributions.jobs![0]!.run({ jobId: "soul-guardian.check" });
  assert.equal(buttonSets.length, 2);
  assert.deepEqual(buttonSets[1]!.allowedUserIds, ["owner"]);
  assert.deepEqual(buttonSets[1]!.buttons.map(button => button.actionTool), ["soul_guardian_approve", "soul_guardian_restore"]);
});
