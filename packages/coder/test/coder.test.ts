import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_LIMITS, createPlugin, readManifest, renderInstructions, validateSubagentProfiles } from "../src/index.js";
import type { PluginManifest, SubagentProfileDefinition } from "../src/umiro-api.js";

const setup = { pluginId: "coder", namespace: "coder", permissionCeiling: {}, config: {}, getSecret: () => undefined };

async function coderProfile(): Promise<SubagentProfileDefinition> {
  const profile = (await readManifest()).contributes.subagentProfiles?.find(entry => entry.id === "coder");
  assert.ok(profile, "manifest must declare the coder profile");
  return profile;
}

function withProfile(manifest: PluginManifest, profile: SubagentProfileDefinition): PluginManifest {
  return { ...manifest, contributes: { subagentProfiles: [profile] } };
}

test("the shipped manifest passes the profile limits the Host enforces", async () => {
  validateSubagentProfiles(await readManifest());
});

test("the plugin contributes no runtime surface and validates its manifest on start", async () => {
  const plugin = createPlugin(setup);
  assert.deepEqual(plugin.contributions, {});
  await plugin.start?.();
});

test("the coder profile declares the tools its instructions tell the child to use", async () => {
  const profile = await coderProfile();
  const instructions = renderInstructions(profile);
  for (const name of ["list_files", "read_file", "write_file", "bash"]) {
    assert.ok(profile.requiredTools?.includes(name), `requiredTools must declare ${name}`);
    assert.ok(instructions.includes(name), `instructions must name ${name}`);
  }
});

test("the coder profile requests no capability beyond reading, writing and running in the workspace", async () => {
  const profile = await coderProfile();
  assert.deepEqual([...(profile.authorityScope?.capabilities ?? [])].sort(), ["filesystem.read", "filesystem.write", "shell.execute"]);
  assert.equal(profile.authorityScope?.instructionAuthority, "none");
});

test("the coder profile bounds turns, tool calls and duration", async () => {
  const profile = await coderProfile();
  assert.ok((profile.budgetCeiling?.maxModelTurns ?? 0) > 0);
  assert.ok((profile.budgetCeiling?.maxToolCalls ?? 0) > 0);
  assert.ok((profile.budgetCeiling?.maxDurationMs ?? 0) > 0);
});

test("the coder instructions state the four report sections the supervisor parses", async () => {
  const instructions = renderInstructions(await coderProfile());
  for (const section of ["RESULT:", "CHANGES:", "VERIFICATION:", "NOTES:"]) assert.ok(instructions.includes(section), `instructions must define ${section}`);
});

test("a profile requesting a capability the manifest does not declare is rejected", async () => {
  const manifest = await readManifest();
  const profile = { ...await coderProfile(), authorityScope: { capabilities: ["filesystem.read", "web.fetch"] } };
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, profile)), /undeclared capability web\.fetch/);
});

test("a profile requesting subagent.delegate is rejected even when the manifest declares it", async () => {
  const manifest = await readManifest();
  const permissions = { ...manifest.permissions, capabilities: [...manifest.permissions.capabilities, "subagent.delegate"] };
  const profile = { ...await coderProfile(), authorityScope: { capabilities: ["subagent.delegate"] } };
  assert.throws(() => validateSubagentProfiles(withProfile({ ...manifest, permissions }, profile)), /must not request subagent\.delegate/);
});

test("blank, oversized and duplicate declarations are rejected", async () => {
  const manifest = await readManifest();
  const profile = await coderProfile();
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, { ...profile, instructions: [] })), /requires instructions/);
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, { ...profile, instructions: ["valid", "   "] })), /blank element/);
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, { ...profile, description: " " })), /requires a description/);
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, { ...profile, instructions: ["x".repeat(PROFILE_LIMITS.maxInstructionCharacters + 1)] })), /exceed 8000 characters/);
  assert.throws(() => validateSubagentProfiles({ ...manifest, contributes: { subagentProfiles: [profile, profile] } }), /duplicate subagent profile id: coder/);
});

test("a non-positive budget is rejected", async () => {
  const manifest = await readManifest();
  const profile = { ...await coderProfile(), budgetCeiling: { maxToolCalls: 0 } };
  assert.throws(() => validateSubagentProfiles(withProfile(manifest, profile)), /budget maxToolCalls must be a positive safe integer/);
});
