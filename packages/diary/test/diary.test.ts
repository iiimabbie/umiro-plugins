import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlugin, JOURNAL_PROMPT } from "../src/index.js";
import type { ScheduledTrigger, SearchDocument } from "../src/umiro-api.js";

const authority = { capabilities: ["journal.read", "journal.write", "memory.search", "memory.write", "memory.remove", "owner.profile.write", "people.write", "people.remove", "tool.catalog"], visibility: { kind: "all" }, instructionAuthority: "full" };
const toolContext = { operationId: "operation", signal: new AbortController().signal };

test("journal tools project canonical transcript and atomically replace one daily file", async () => {
  const root = await mkdtemp(join(tmpdir(), "umiro-diary-"));
  const projections = new Map<string, readonly SearchDocument[]>();
  const created: Array<Record<string, unknown>> = []; const updated: Array<Record<string, unknown>> = []; const toggled: Array<[string, boolean]> = [];
  const trigger = (input: Record<string, any>): ScheduledTrigger => ({ id: "tool:umiro-plugin-diary.daily-journal", name: String(input.name), enabled: Boolean(input.enabled), schedule: input.schedule, timezone: String(input.timezone), input: input.input, misfirePolicy: input.misfirePolicy, maxAttempts: input.maxAttempts, retryBackoffMs: input.retryBackoffMs });
  try {
    const plugin = createPlugin({
      pluginId: "diary", namespace: "diary", permissionCeiling: authority, config: { workspacePath: root, timezone: "Asia/Taipei", schedule: "5 23 * * *", model: "journal" }, getSecret: () => undefined,
      services: {
        conversationHistory: { async transcriptByDate(input) { return { ...input, conversations: 1, messages: 2, text: "主人: 今天去散步\nAssistant: 風很舒服", truncated: false }; } },
        searchDocuments: { async replaceSource(sourceId, documents) { projections.set(sourceId, documents); }, async removeSource() {} },
        scheduler: {
          async create(input, key) { created.push({ ...input, key }); return trigger(input as never); }, async list() { return []; },
          async setEnabled(id, enabled) { toggled.push([id, enabled]); return { ...trigger({ name: "Daily journal", enabled, schedule: { kind: "cron", expression: "5 23 * * *" }, timezone: "Asia/Taipei", input: {} as never, misfirePolicy: "coalesce", maxAttempts: 3, retryBackoffMs: 15_000 }), enabled }; },
          async update(id, patch) { updated.push({ id, ...patch }); return { ...trigger({ ...patch, enabled: true }), id }; },
        },
      },
    });
    await plugin.start?.();
    assert.equal(created.length, 1);
    assert.equal(created[0]?.key, "umiro-plugin-diary.daily-journal");
    assert.equal((created[0]?.input as { model?: string }).model, "journal");
    assert.equal(updated[0]?.timezone, "Asia/Taipei");
    assert.match(String((updated[0]?.input as { prompt?: string }).prompt), /first-person/);
    assert.match(String((updated[0]?.input as { prompt?: string }).prompt), /Configured journal timezone: Asia\/Taipei/);

    const tools = new Map(plugin.contributions.tools?.map(tool => [tool.name, tool]));
    assert.deepEqual([...tools.keys()], ["journal_transcript_by_date", "journal_read", "journal_write"]);
    const transcript = await tools.get("journal_transcript_by_date")!.execute({ date: "2026-09-18" }, toolContext);
    assert.equal(transcript.ok && (transcript.output as { messages: number }).messages, 2);
    const written = await tools.get("journal_write")!.execute({ date: "2026-09-18", content: "# 今天\n\n我和主人去散步。" }, toolContext);
    assert.equal(written.ok, true); assert.equal(written.effectStatus, "confirmed");
    assert.equal(await readFile(join(root, "memory", "2026-09-18.md"), "utf8"), "# 今天\n\n我和主人去散步。\n");
    assert.equal(projections.get("memory/2026-09-18.md")?.[0]?.sourceId, "memory/2026-09-18.md");
    assert.deepEqual(projections.get("memory/2026-09-18.md")?.[0]?.visibility, { kind: "restricted", principalIds: ["owner"], labels: [], resources: [] });
    const read = await tools.get("journal_read")!.execute({ date: "2026-09-18" }, toolContext);
    assert.equal(read.ok && (read.output as { content: string }).content, "# 今天\n\n我和主人去散步。\n");
    await plugin.stop?.();
    assert.deepEqual(toggled, [["tool:umiro-plugin-diary.daily-journal", false]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("disabled journal leaves an existing durable schedule disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "umiro-diary-disabled-")); let disabled = false;
  try {
    const existing: ScheduledTrigger = { id: "tool:umiro-plugin-diary.daily-journal", name: "Daily journal", enabled: true, schedule: { kind: "cron", expression: "55 23 * * *" }, timezone: "UTC", input: {}, misfirePolicy: "coalesce", maxAttempts: 3, retryBackoffMs: 15_000 };
    const plugin = createPlugin({ pluginId: "diary", namespace: "diary", permissionCeiling: authority, config: { workspacePath: root, scheduleEnabled: false, timezone: "UTC" }, getSecret: () => undefined, services: { conversationHistory: { async transcriptByDate(input) { return { ...input, conversations: 0, messages: 0, text: "", truncated: false }; } }, scheduler: { async create() { throw new Error("must not create"); }, async list() { return [existing]; }, async setEnabled(_id, enabled) { disabled = !enabled; return { ...existing, enabled }; }, async update() { throw new Error("must not update"); } } } });
    await plugin.start?.(); assert.equal(disabled, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal prompt preserves the personal-diary contract", () => {
  assert.match(JOURNAL_PROMPT, /your own diary/);
  assert.match(JOURNAL_PROMPT, /not read like a changelog/);
  assert.match(JOURNAL_PROMPT, /journal_transcript_by_date/);
  assert.match(JOURNAL_PROMPT, /previous three journal days/);
  assert.match(JOURNAL_PROMPT, /Do not stop after Step 1/);
});
