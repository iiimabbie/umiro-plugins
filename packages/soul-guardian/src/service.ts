import { createHash } from "node:crypto";
import type { PluginStateStore } from "./umiro-api.js";
import type { SoulGuardianApproveResult, SoulGuardianCheckResult, SoulGuardianConfig, SoulGuardianItem, SoulGuardianTarget } from "./types.js";
import { SoulGuardianWorkspace } from "./workspace-files.js";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function statePath(prefix: string, target: string): string {
  return `${prefix}/${target}`;
}

function unifiedDiff(oldText: string, newText: string, path: string): string {
  const oldLines = oldText.split("\n"); const newLines = newText.split("\n");
  return [`--- approved/${path}`, `+++ ${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)].join("\n");
}

function text(bytes: Uint8Array, path: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new TypeError(`Soul Guardian diff only supports UTF-8 text files: ${path}`); }
}

function changedLineCount(before: string, after: string): number {
  const left = before.split("\n"); const right = after.split("\n");
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let leftEnd = left.length; let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) { leftEnd--; rightEnd--; }
  const a = left.slice(start, leftEnd); const b = right.slice(start, rightEnd);
  if (a.length * b.length > 1_000_000) return a.length + b.length;
  let previous = new Uint32Array(b.length + 1);
  for (const line of a) {
    const current = new Uint32Array(b.length + 1);
    for (let index = 1; index <= b.length; index++) current[index] = line === b[index - 1] ? previous[index - 1]! + 1 : Math.max(previous[index]!, current[index - 1]!);
    previous = current;
  }
  return a.length + b.length - 2 * previous[b.length]!;
}

export class SoulGuardianService {
  private readonly workspace: SoulGuardianWorkspace;
  private readonly targets: readonly SoulGuardianTarget[];

  constructor(config: SoulGuardianConfig, private readonly state: PluginStateStore) {
    this.workspace = new SoulGuardianWorkspace(config.workspacePath);
    const deduplicated = new Map<string, SoulGuardianTarget>();
    for (const target of config.targets) deduplicated.set(target.path, { ...target });
    this.targets = [...deduplicated.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  start(): Promise<void> {
    return this.workspace.start();
  }

  async status(): Promise<readonly SoulGuardianItem[]> {
    const items: SoulGuardianItem[] = [];
    for (const target of this.targets) {
      const [current, approved] = await Promise.all([
        this.workspace.read(target.path),
        this.state.read(statePath("approved", target.path)),
      ]);
      if (!current) {
        items.push({ ...target, status: "missing", ...(approved ? { approvedSha256: sha256(approved) } : {}) });
      } else if (!approved) {
        items.push({ ...target, status: "unapproved", currentSha256: sha256(current) });
      } else {
        const currentSha256 = sha256(current);
        const approvedSha256 = sha256(approved);
        let changedLines: number | undefined;
        if (currentSha256 !== approvedSha256) {
          try { changedLines = changedLineCount(text(approved, target.path), text(current, target.path)); } catch { /* Binary files still receive hash-based drift alerts. */ }
        }
        items.push({
          ...target,
          status: currentSha256 === approvedSha256 ? "ok" : "drift",
          currentSha256,
          approvedSha256,
          ...(changedLines !== undefined ? { changedLines } : {}),
        });
      }
    }
    return items;
  }

  async approve(paths: readonly string[], approvedAt = new Date().toISOString()): Promise<SoulGuardianApproveResult> {
    const approved: Array<{ path: string; sha256: string }> = []; const skipped: string[] = [];
    for (const target of this.select(paths)) {
      const current = await this.workspace.read(target.path);
      if (!current) throw new Error(`cannot approve missing target: ${target.path}`);
      const key = statePath("approved", target.path);
      const previous = await this.state.read(key);
      const currentSha256 = sha256(current);
      if (previous && sha256(previous) === currentSha256) { skipped.push(target.path); continue; }
      if (previous) {
        const historyKey = statePath(`history/${approvedAt.replace(/[^0-9TZ]/g, "")}`, target.path);
        await this.state.writeAtomic(historyKey, previous);
      }
      await this.state.writeAtomic(key, current);
      approved.push({ path: target.path, sha256: currentSha256 });
    }
    return { approved, skipped };
  }

  async restore(paths: readonly string[], quarantineAt = new Date().toISOString()): Promise<readonly string[]> {
    const restored: string[] = [];
    for (const target of this.select(paths)) {
      const approved = await this.state.read(statePath("approved", target.path));
      if (!approved) throw new Error(`cannot restore target without an approved snapshot: ${target.path}`);
      const current = await this.workspace.read(target.path);
      if (current) {
        const quarantineKey = statePath(`quarantine/${quarantineAt.replace(/[^0-9TZ]/g, "")}`, target.path);
        await this.state.writeAtomic(quarantineKey, current);
      }
      await this.workspace.writeAtomic(target.path, approved);
      restored.push(target.path);
    }
    return restored;
  }

  async diff(paths: readonly string[], maxCharacters = 12_000): Promise<{ readonly paths: readonly string[]; readonly diff: string; readonly truncated: boolean }> {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > 20_000) throw new TypeError("maxCharacters must be between 1000 and 20000");
    const selected = this.select(paths); const sections: string[] = [];
    for (const target of selected) {
      const [current, approved] = await Promise.all([this.workspace.read(target.path), this.state.read(statePath("approved", target.path))]);
      if (!current && !approved) { sections.push(`--- approved/${target.path}\n+++ ${target.path}\n(file and baseline are both missing)`); continue; }
      const before = approved ? text(approved, target.path) : "";
      const after = current ? text(current, target.path) : "";
      sections.push(before === after ? `--- approved/${target.path}\n+++ ${target.path}\n(no difference)` : unifiedDiff(before, after, target.path));
    }
    const full = sections.join("\n\n");
    return { paths: selected.map(target => target.path), diff: full.slice(0, maxCharacters), truncated: full.length > maxCharacters };
  }

  async check(): Promise<SoulGuardianCheckResult> {
    const items = await this.status();
    const actionable = items.filter(item => item.status !== "ok");
    const fingerprint = actionable.length === 0
      ? "clean"
      : sha256(Buffer.from(actionable.map(item => `${item.path}:${item.status}:${item.currentSha256 ?? ""}`).sort().join("\n"))).slice(0, 32);
    return { ok: actionable.length === 0, items, fingerprint };
  }

  history(path: string) {
    this.select([path]);
    return this.state.list("history").then(entries => entries.filter(entry => entry.key.endsWith(`/${path}`)));
  }

  private select(paths: readonly string[]): readonly SoulGuardianTarget[] {
    const requested = new Set(paths);
    const selected = this.targets.filter(target => requested.has(target.path));
    if (selected.length !== requested.size) {
      const known = new Set(selected.map(target => target.path));
      const invalid = [...requested].filter(path => !known.has(path));
      throw new TypeError(`unknown Soul Guardian targets: ${invalid.join(", ")}`);
    }
    return selected;
  }
}
