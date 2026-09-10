import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PluginInstance, PluginManifest, PluginSetupContext, SubagentProfileDefinition } from "./umiro-api.js";

/** Mirrors the Host's manifest limits so a rejected manifest fails here, in this
 * repository's own tests, rather than at install time on someone else's machine. */
export const PROFILE_LIMITS = { maxProfiles: 16, maxInstructionCharacters: 8_000, maxTotalInstructionCharacters: 32_000 } as const;

const ID = /^[a-z][a-z0-9_.-]{0,127}$/;

export function renderInstructions(profile: SubagentProfileDefinition): string {
  return profile.instructions.join("\n");
}

/** Static checks only. Whether a required tool or model profile actually exists is
 * decided by the Host at registration time and cannot be answered from here. */
export function validateSubagentProfiles(manifest: PluginManifest): void {
  const profiles = manifest.contributes.subagentProfiles ?? [];
  if (profiles.length > PROFILE_LIMITS.maxProfiles) throw new TypeError(`manifest declares more than ${PROFILE_LIMITS.maxProfiles} subagent profiles`);
  const declared = new Set(manifest.permissions.capabilities);
  const seen = new Set<string>();
  let total = 0;
  for (const profile of profiles) {
    if (!ID.test(profile.id)) throw new TypeError(`invalid subagent profile id: ${profile.id}`);
    if (seen.has(profile.id)) throw new TypeError(`duplicate subagent profile id: ${profile.id}`);
    seen.add(profile.id);
    if (!profile.description.trim()) throw new TypeError(`subagent profile ${profile.id} requires a description`);
    if (!profile.instructions.length) throw new TypeError(`subagent profile ${profile.id} requires instructions`);
    if (profile.instructions.some(line => typeof line !== "string")) throw new TypeError(`subagent profile ${profile.id} instructions must be strings`);
    if (!renderInstructions(profile).trim()) throw new TypeError(`subagent profile ${profile.id} instructions are blank`);
    const length = renderInstructions(profile).length;
    if (length > PROFILE_LIMITS.maxInstructionCharacters) throw new TypeError(`subagent profile ${profile.id} instructions exceed ${PROFILE_LIMITS.maxInstructionCharacters} characters`);
    total += length;
    for (const name of profile.requiredTools ?? []) if (!ID.test(name)) throw new TypeError(`subagent profile ${profile.id} requires an invalid tool name: ${name}`);
    for (const capability of profile.authorityScope?.capabilities ?? []) {
      if (!declared.has(capability)) throw new TypeError(`subagent profile ${profile.id} requests undeclared capability ${capability}`);
    }
    if ((profile.authorityScope?.capabilities ?? []).includes("subagent.delegate")) throw new TypeError(`subagent profile ${profile.id} must not request subagent.delegate`);
    for (const [name, value] of Object.entries(profile.budgetCeiling ?? {})) {
      if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(`subagent profile ${profile.id} budget ${name} must be a positive safe integer`);
    }
  }
  if (total > PROFILE_LIMITS.maxTotalInstructionCharacters) throw new TypeError(`subagent profile instructions exceed ${PROFILE_LIMITS.maxTotalInstructionCharacters} characters in total`);
}

export async function readManifest(): Promise<PluginManifest> {
  return JSON.parse(await readFile(fileURLToPath(new URL("../../umiro.plugin.json", import.meta.url)), "utf8")) as PluginManifest;
}

/** The profile lives entirely in the manifest, so this plugin contributes no runtime
 * surface. The entry exists because the Host loads and starts every enabled plugin. */
export function createPlugin(context: PluginSetupContext): PluginInstance {
  return {
    contributions: {},
    async start() {
      try {
        validateSubagentProfiles(await readManifest());
      } catch (error) {
        context.logger?.error("coder.manifest_invalid", "The coder manifest failed its own profile validation", { errorName: error instanceof Error ? error.name : "NonErrorThrown" });
        throw error;
      }
    },
  };
}
