export * from "./service.js";
export * from "./types.js";
import type { JsonObject, PluginInstance, PluginSetupContext, ToolDefinition, ToolExecutionResult } from "./umiro-api.js";
import { SoulGuardianService } from "./service.js";
import type { SoulGuardianConfig } from "./types.js";
import type { SoulGuardianApproveResult } from "./types.js";

const CAP = {
  status: "soul_guardian.status", check: "soul_guardian.check", diff: "soul_guardian.diff", history: "soul_guardian.history",
  approve: "soul_guardian.approve", restore: "soul_guardian.restore",
} as const;
const ok = (output: unknown): ToolExecutionResult => ({ ok: true, output: output as never, effectStatus: "confirmed" });
const readOk = (output: unknown): ToolExecutionResult => ({ ok: true, output: output as never, effectStatus: "not_applicable" });
const fail = (error: unknown): ToolExecutionResult => ({ ok: false, effectStatus: "not_applicable", error: { code: "soul_guardian_error", message: error instanceof Error ? error.message : String(error), retryable: false } });
const paths = (input: JsonObject): string[] => Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === "string") : [];
const NOTIFIED_FINGERPRINT = "notification/fingerprint";
type GuardianButton = { id: string; label: string; style: "primary" | "secondary" | "success" | "danger"; actionTool: string; actionArgs: JsonObject; disableAllOnComplete?: boolean };

function boundedMessage(title: string, lines: readonly string[]): string {
  const content = [title, "", ...lines].join("\n");
  return content.length <= 2_000 ? content : `${content.slice(0, 1_997)}...`;
}

function approveResult(result: SoulGuardianApproveResult): string {
  const lines = [
    ...result.approved.map(item => `✅ ${item.path}: sha256=${item.sha256.slice(0, 16)}...`),
    ...result.skipped.map(path => `⏭️ ${path}: already at baseline (skipped)`),
  ];
  return lines.join("\n") || "No files needed approval; all selected files are already at baseline.";
}

export function createPlugin(context: PluginSetupContext): PluginInstance {
  const config = context.config as unknown as SoulGuardianConfig;
  const service = new SoulGuardianService(config, context.state!);
  const runScheduledCheck = async (signal?: AbortSignal) => {
    const result = await service.check();
    if (!config.channelId) return;
    const discord = context.services?.discord;
    if (!discord) throw new Error("Soul Guardian channelId requires the Discord service");
    const actionable = result.items.filter(item => item.status !== "ok");
    if (actionable.length === 0) {
      await context.state!.remove(NOTIFIED_FINGERPRINT);
      return;
    }
    const previous = await context.state!.read(NOTIFIED_FINGERPRINT);
    if (previous && new TextDecoder().decode(previous) === result.fingerprint) return;
    const ownerId = context.getSecret("UMIRO_OWNER_DISCORD_ID");
    const createButtonSet = discord.createButtonSet;
    const manageable = actionable.filter(item => item.currentSha256 || item.approvedSha256);
    if (createButtonSet && ownerId && manageable.length) {
      for (let offset = 0; offset < manageable.length; offset += 24) {
        const batch = manageable.slice(offset, offset + 24);
        const buttons: GuardianButton[] = batch.flatMap((item, index): GuardianButton[] => {
          const id = offset + index;
          const labelPath = item.path.length <= 68 ? item.path : `…${item.path.slice(-67)}`;
          return item.currentSha256 ? [{ id: `approve_${id}`, label: `Approve ${labelPath}`, style: "success", actionTool: "soul_guardian_approve", actionArgs: { paths: [item.path] } }] : [];
        });
        const approvePaths = batch.filter(item => item.currentSha256).map(item => item.path);
        if (approvePaths.length > 1) buttons.push({ id: `approve_all_${offset / 24}`, label: "Approve All", style: "primary", actionTool: "soul_guardian_approve", actionArgs: { paths: approvePaths }, disableAllOnComplete: true });
        const drift = batch.filter(item => item.status === "drift");
        const unapproved = batch.filter(item => item.status === "unapproved");
        const missing = batch.filter(item => item.status === "missing");
        const lines: string[] = [];
        if (drift.length) lines.push("The following monitored files have changed since last approval:", "", ...drift.map(item => item.changedLines === undefined ? `• \`${item.path}\`` : `• \`${item.path}\` — ${item.changedLines} lines changed`));
        if (unapproved.length) lines.push(...(lines.length ? [""] : []), "The following monitored files do not have an approved baseline:", "", ...unapproved.map(item => `• \`${item.path}\``));
        if (missing.length) lines.push(...(lines.length ? [""] : []), "The following monitored files are missing:", "", ...missing.map(item => `• \`${item.path}\``));
        lines.push("", "Review the changes. Approve a new baseline with the buttons, or ask ümiro to inspect the diff and restore the file if the change is unwanted.");
        await createButtonSet({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — drift detected", lines), allowedUserIds: [ownerId], expiresInMinutes: 24 * 60, buttons, ...(signal ? { signal } : {}) });
      }
      const errors = actionable.filter(item => !item.currentSha256 && !item.approvedSha256);
      if (errors.length) await discord.sendMessage({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — 需要手動處理", errors.map(item => `• \`${item.path}\` — ${item.status}`)), ...(signal ? { signal } : {}) });
    } else {
      const lines = [...actionable.map(item => `• \`${item.path}\` — ${item.status}`), "", "請手動檢查並處理這些檔案。"];
      await discord.sendMessage({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — 偵測到檔案狀態異常", lines), ...(signal ? { signal } : {}) });
    }
    await context.state!.writeAtomic(NOTIFIED_FINGERPRINT, new TextEncoder().encode(result.fingerprint));
  };
  const tool = (name: string, description: string, capability: string, inputSchema: Record<string, unknown>, policy: Pick<ToolDefinition["policy"], "interactionRequirement" | "approvalRequirement" | "sideEffect">, run: (input: JsonObject) => Promise<ToolExecutionResult>): ToolDefinition => ({
    name, description, inputSchema, policy: { capability, tier: "privileged", ...policy }, execute: run,
  });
  return {
    contributions: { tools: [
      tool("soul_guardian_status", "Show every monitored file, its integrity state, and current/approved hashes.", CAP.status, { type: "object", additionalProperties: false, properties: {} }, { interactionRequirement: "not_required", sideEffect: "none" }, async () => { try { return readOk(await service.status()); } catch (e) { return fail(e); } }),
      tool("soul_guardian_check", "Run deterministic integrity checking and report drift. This never approves or restores files automatically.", CAP.check, { type: "object", additionalProperties: false, properties: {} }, { interactionRequirement: "not_required", sideEffect: "none" }, async () => { try { return readOk(await service.check()); } catch (e) { return fail(e); } }),
      tool("soul_guardian_diff", "Read a bounded unified diff between approved baselines and current monitored UTF-8 files. Use this before explaining drift or recommending approve/restore.", CAP.diff, { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string" } }, maxCharacters: { type: "integer", minimum: 1000, maximum: 20000 } } }, { interactionRequirement: "not_required", sideEffect: "none" }, async input => { try { return readOk(await service.diff(paths(input), typeof input.maxCharacters === "number" ? input.maxCharacters : undefined)); } catch (e) { return fail(e); } }),
      tool("soul_guardian_history", "List historical approved snapshots for a monitored file.", CAP.history, { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" } } }, { interactionRequirement: "not_required", sideEffect: "none" }, async input => { try { return readOk(await service.history(String(input.path))); } catch (e) { return fail(e); } }),
      tool("soul_guardian_approve", "Approve current monitored file contents as the new baseline. OWNER-ONLY: call only after the Owner explicitly requests approval or clicks an exact approve button; never self-approve changes based on your own judgment.", CAP.approve, { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string" } } } }, { interactionRequirement: "interactive_required", approvalRequirement: "required", sideEffect: "idempotent" }, async input => { try { return ok(approveResult(await service.approve(paths(input)))); } catch (e) { return fail(e); } }),
      tool("soul_guardian_restore", "Restore monitored files from approved baselines after the Owner explicitly requests it; current contents are quarantined first. OWNER-ONLY.", CAP.restore, { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string" } } } }, { interactionRequirement: "interactive_required", approvalRequirement: "required", sideEffect: "idempotent" }, async input => { try { return ok(await service.restore(paths(input))); } catch (e) { return fail(e); } }),
    ], jobs: [{ id: "soul-guardian.check", schedule: config.schedule, ...(config.timezone ? { timezone: config.timezone } : {}), async run(job) { await runScheduledCheck(job.signal); } }],
    commands: [{ name: "soul-guardian", description: "Show Soul Guardian integrity status", ownerOnly: true, async execute() { return { items: await service.status() } as never; } }],
    },
    start: () => service.start(),
  };
}
