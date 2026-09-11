import { renderActivity, type ActivityLine } from "./render.js";
import type { DiscordPluginService, JsonObject, PluginHookDefinition, PluginInstance, PluginLogger, PluginSetupContext } from "./umiro-api.js";

export { renderActivity } from "./render.js";

export interface ToolActivityOptions { readonly editIntervalMs: number; readonly maxCharacters: number }
export const DEFAULT_OPTIONS: ToolActivityOptions = { editIntervalMs: 1000, maxCharacters: 1900 };

interface RunActivity {
  readonly channelId: string;
  readonly lines: ActivityLine[];
  messageId?: string;
  dirty: boolean;
  inflight: Promise<void> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastEditAt: number;
  finished: boolean;
}

interface TrackerDeps { readonly discord: DiscordPluginService; readonly logger?: PluginLogger; readonly options: ToolActivityOptions; readonly now?: () => number; readonly setTimer?: typeof setTimeout; readonly clearTimer?: typeof clearTimeout }

const str = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
function discordChannel(payload: JsonObject): string | undefined {
  const destination = payload.destination;
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) return undefined;
  const record = destination as JsonObject;
  return record.kind === "discord" ? str(record.channelId) : undefined;
}

/** One temporary Discord message per Run, edited under a throttle and removed once the final reply is out. */
export class ActivityTracker {
  private readonly runs = new Map<string, RunActivity>();
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
  }

  get activeRunIds(): readonly string[] { return [...this.runs.keys()]; }

  toolStarted(payload: JsonObject): void {
    const runId = str(payload.runId); const channelId = discordChannel(payload); const tool = str(payload.tool); const operationId = str(payload.operationId);
    if (!runId || !channelId || !tool || !operationId) return;
    let run = this.runs.get(runId);
    if (!run) { run = { channelId, lines: [], dirty: false, inflight: undefined, timer: undefined, lastEditAt: 0, finished: false }; this.runs.set(runId, run); }
    if (run.finished) return;
    run.lines.push({ kind: "tool", operationId, tool, status: "running" });
    this.markDirty(runId, run);
  }

  toolCompleted(payload: JsonObject): void {
    const runId = str(payload.runId); const operationId = str(payload.operationId);
    if (!runId || !operationId) return;
    const run = this.runs.get(runId);
    if (!run || run.finished) return;
    const status = payload.state === "succeeded" ? "ok" : "err";
    const line = run.lines.find(item => item.kind === "tool" && item.operationId === operationId);
    if (line && line.kind === "tool") line.status = status;
    else { const tool = str(payload.tool); if (tool) run.lines.push({ kind: "tool", operationId, tool, status }); else return; }
    this.markDirty(runId, run);
  }

  stepCompleted(payload: JsonObject): void {
    const runId = str(payload.runId); const text = str(payload.assistantText);
    if (!runId || !text) return;
    const run = this.runs.get(runId);
    if (!run || run.finished) return;
    run.lines.push({ kind: "note", text });
    this.markDirty(runId, run);
  }

  /** Returns immediately: final rendering never holds up the Run's durable completion. */
  runCompleted(payload: JsonObject): void {
    const runId = str(payload.runId);
    if (!runId) return;
    const run = this.runs.get(runId);
    if (!run) return;
    run.finished = true;
    if (run.timer) { this.clearTimer(run.timer); run.timer = undefined; }
    this.track(this.finalize(runId, run, payload.state === "succeeded"));
  }

  async deliveryCompleted(payload: JsonObject): Promise<void> {
    const runId = str(payload.runId); const channelId = discordChannel(payload);
    if (!runId || !channelId) return;
    const run = this.runs.get(runId);
    if (!run || !run.finished || run.channelId !== channelId) return;
    await this.flush(runId, run, true);
    this.runs.delete(runId);
    await this.remove(runId, run);
  }

  /** A failed delivery remains eligible for retry, so its activity message stays visible. */
  deliveryFailed(payload: JsonObject): void {
    const runId = str(payload.runId); const channelId = discordChannel(payload);
    if (!runId || !channelId) return;
    const run = this.runs.get(runId);
    if (!run || !run.finished || run.channelId !== channelId) return;
  }

  /** Resolves once every in-flight Discord call has settled. */
  async idle(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending]); }

  private readonly pending = new Set<Promise<void>>();
  private track(task: Promise<void>): void { const tracked: Promise<void> = task.finally(() => { this.pending.delete(tracked); }); this.pending.add(tracked); }

  private async finalize(runId: string, run: RunActivity, succeeded: boolean): Promise<void> {
    await this.flush(runId, run, true);
    if (!succeeded) this.runs.delete(runId);
  }

  private async remove(runId: string, run: RunActivity): Promise<void> {
    if (!run.messageId) return;
    try { await this.deps.discord.deleteMessage({ channelId: run.channelId, messageId: run.messageId }); }
    catch (error) { this.warn("tool-activity.delete_failed", "Could not delete the activity message", runId, error); }
  }

  /** Stops timers without touching Discord; messages left behind are evidence of an interrupted host. */
  dispose(): void {
    for (const run of this.runs.values()) { if (run.timer) this.clearTimer(run.timer); run.finished = true; }
    this.runs.clear();
  }

  private markDirty(runId: string, run: RunActivity): void {
    run.dirty = true;
    this.track(this.flush(runId, run, false));
  }

  private async flush(runId: string, run: RunActivity, immediate: boolean): Promise<void> {
    if (run.inflight) { if (immediate) await run.inflight; else return; }
    if (!run.dirty) return;
    const wait = run.lastEditAt + this.deps.options.editIntervalMs - this.now();
    if (!immediate && run.messageId && wait > 0) {
      if (!run.timer) run.timer = this.setTimer(() => { run.timer = undefined; this.track(this.flush(runId, run, false)); }, wait);
      return;
    }
    if (run.timer) { this.clearTimer(run.timer); run.timer = undefined; }
    run.dirty = false;
    run.inflight = this.push(runId, run, renderActivity(run.lines, this.deps.options.maxCharacters)).finally(() => { run.inflight = undefined; });
    await run.inflight;
    if (run.dirty) await this.flush(runId, run, immediate);
  }

  private async push(runId: string, run: RunActivity, content: string): Promise<void> {
    try {
      if (run.messageId) await this.deps.discord.editMessage({ channelId: run.channelId, messageId: run.messageId, content });
      else run.messageId = (await this.deps.discord.sendMessage({ channelId: run.channelId, content })).messageId;
      run.lastEditAt = this.now();
    } catch (error) {
      this.warn("tool-activity.update_failed", "Could not update the activity message", runId, error);
    }
  }

  private warn(event: string, message: string, runId: string, error: unknown): void {
    this.deps.logger?.warn(event, message, { runId, errorName: error instanceof Error ? error.name : "NonErrorThrown" });
  }
}

export function resolveOptions(config: JsonObject): ToolActivityOptions {
  const int = (value: unknown, fallback: number) => typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return { editIntervalMs: int(config.editIntervalMs, DEFAULT_OPTIONS.editIntervalMs), maxCharacters: int(config.maxCharacters, DEFAULT_OPTIONS.maxCharacters) };
}

export function createPlugin(context: PluginSetupContext, deps: { readonly now?: () => number; readonly setTimer?: typeof setTimeout; readonly clearTimer?: typeof clearTimeout } = {}): PluginInstance {
  const discord = context.services?.discord;
  if (!discord) throw new Error("tool-activity requires the Discord plugin service");
  const tracker = new ActivityTracker({ discord, options: resolveOptions(context.config), ...(context.logger ? { logger: context.logger } : {}), ...deps });
  const hook = (id: string, event: string, handle: (payload: JsonObject) => void | Promise<void>): PluginHookDefinition => ({ id: `tool-activity.${id}`, event, async handle(payload) {
    try { await handle(payload); }
    catch (error) { context.logger?.warn("tool-activity.hook_failed", "Activity hook failed", { event, errorName: error instanceof Error ? error.name : "NonErrorThrown" }); }
  } });
  return {
    contributions: { hooks: [
      hook("tool_started", "tool.started", payload => tracker.toolStarted(payload)),
      hook("tool_completed", "tool.completed", payload => tracker.toolCompleted(payload)),
      hook("step_completed", "step.completed", payload => tracker.stepCompleted(payload)),
      hook("run_completed", "run.completed", payload => tracker.runCompleted(payload)),
      hook("delivery_completed", "delivery.completed", payload => tracker.deliveryCompleted(payload)),
      hook("delivery_failed", "delivery.failed", payload => tracker.deliveryFailed(payload)),
    ] },
    async stop() { tracker.dispose(); },
    async health() { return { status: "ok", detail: `${tracker.activeRunIds.length} active run(s)` }; },
  };
}
