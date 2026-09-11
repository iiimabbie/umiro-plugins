export * from "./service.js";
export * from "./types.js";
import type { JsonObject, PluginInstance, PluginSetupContext, ToolDefinition, ToolExecutionResult } from "./umiro-api.js";
import { SoulGuardianService } from "./service.js";
import type { SoulGuardianConfig } from "./types.js";

const CAP = {
  status: "soul_guardian.status", check: "soul_guardian.check", history: "soul_guardian.history",
  approve: "soul_guardian.approve", restore: "soul_guardian.restore",
} as const;
const ok = (output: unknown): ToolExecutionResult => ({ ok: true, output: output as never, effectStatus: "confirmed" });
const fail = (error: unknown): ToolExecutionResult => ({ ok: false, effectStatus: "not_applicable", error: { code: "soul_guardian_error", message: error instanceof Error ? error.message : String(error), retryable: false } });
const paths = (input: JsonObject): string[] => Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === "string") : [];
const NOTIFIED_FINGERPRINT = "notification/fingerprint";

function boundedMessage(title: string, lines: readonly string[]): string {
  const content = [title, "", ...lines].join("\n");
  return content.length <= 2_000 ? content : `${content.slice(0, 1_997)}...`;
}

export function createPlugin(context: PluginSetupContext): PluginInstance {
  const config = context.config as unknown as SoulGuardianConfig;
  const service = new SoulGuardianService(config, context.state!);
  const runScheduledCheck = async (signal?: AbortSignal) => {
    const result = await service.check();
    if (!config.channelId) return;
    const discord = context.services?.discord;
    if (!discord) throw new Error("Soul Guardian channelId requires the Discord service");
    if (result.restored.length > 0) {
      await discord.sendMessage({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — 已自動還原檔案", result.restored.map(path => `• \`${path}\``)), ...(signal ? { signal } : {}) });
    }
    const actionable = result.items.filter(item => item.status !== "ok" && item.status !== "ignored");
    if (actionable.length === 0) {
      await context.state!.remove(NOTIFIED_FINGERPRINT);
      return;
    }
    const previous = await context.state!.read(NOTIFIED_FINGERPRINT);
    if (previous && new TextDecoder().decode(previous) === result.fingerprint) return;
    const lines = [
      ...actionable.map(item => `• \`${item.path}\` — ${item.status}（${item.mode}）`),
      "",
      "請檢查變更；需要接受新版或還原時，可要求 ümiro 執行 Soul Guardian 操作。",
    ];
    const ownerId = context.getSecret("UMIRO_OWNER_DISCORD_ID");
    const createButtonSet = discord.createButtonSet;
    const buttons = createButtonSet && ownerId ? [
      { id: "approve", label: "接受目前版本", style: "success" as const, actionTool: "soul_guardian_approve", actionArgs: { paths: actionable.map(item => item.path) } },
      { id: "restore", label: "還原已核准版本", style: "danger" as const, actionTool: "soul_guardian_restore", actionArgs: { paths: actionable.map(item => item.path) } },
    ] : undefined;
    if (buttons && createButtonSet && ownerId) {
      await createButtonSet({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — 偵測到檔案狀態異常", lines), allowedUserIds: [ownerId], expiresInMinutes: 24 * 60, buttons, ...(signal ? { signal } : {}) });
    } else {
      await discord.sendMessage({ channelId: config.channelId, content: boundedMessage("🛡️ Soul Guardian — 偵測到檔案狀態異常", lines), ...(signal ? { signal } : {}) });
    }
    await context.state!.writeAtomic(NOTIFIED_FINGERPRINT, new TextEncoder().encode(result.fingerprint));
  };
  const tool = (name: string, description: string, capability: string, inputSchema: Record<string, unknown>, policy: Pick<ToolDefinition["policy"], "interactionRequirement" | "approvalRequirement" | "sideEffect">, run: (input: JsonObject) => Promise<ToolExecutionResult>): ToolDefinition => ({
    name, description, inputSchema, policy: { capability, tier: "privileged", ...policy }, execute: run,
  });
  return {
    contributions: { tools: [
      tool("soul_guardian_status", "Show monitored file integrity status.", CAP.status, { type: "object", additionalProperties: false, properties: {} }, { interactionRequirement: "not_required", sideEffect: "none" }, async () => { try { return ok(await service.status()); } catch (e) { return fail(e); } }),
      tool("soul_guardian_check", "Check monitored files and restore restore-mode drift.", CAP.check, { type: "object", additionalProperties: false, properties: { noRestore: { type: "boolean" } } }, { interactionRequirement: "not_required", sideEffect: "idempotent" }, async input => { try { return ok(await service.check(input.noRestore === true)); } catch (e) { return fail(e); } }),
      tool("soul_guardian_history", "List approval history for a monitored file.", CAP.history, { type: "object", required: ["path"], properties: { path: { type: "string" } } }, { interactionRequirement: "not_required", sideEffect: "none" }, async input => { try { return ok(await service.history(String(input.path))); } catch (e) { return fail(e); } }),
      tool("soul_guardian_approve", "Approve current contents as the new baseline.", CAP.approve, { type: "object", required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } } } }, { interactionRequirement: "interactive_required", approvalRequirement: "required", sideEffect: "idempotent" }, async input => { try { return ok(await service.approve(paths(input))); } catch (e) { return fail(e); } }),
      tool("soul_guardian_restore", "Restore monitored files from their approved baseline.", CAP.restore, { type: "object", required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } } } }, { interactionRequirement: "interactive_required", approvalRequirement: "required", sideEffect: "idempotent" }, async input => { try { return ok(await service.restore(paths(input))); } catch (e) { return fail(e); } }),
    ], jobs: [{ id: "soul-guardian.check", schedule: config.schedule, ...(config.timezone ? { timezone: config.timezone } : {}), async run(job) { await runScheduledCheck(job.signal); } }],
    commands: [{ name: "soul-guardian", description: "Show Soul Guardian integrity status", ownerOnly: true, async execute() { return { items: await service.status() } as never; } }],
    },
    start: () => service.start(),
  };
}
