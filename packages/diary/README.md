# Diary

Umiro plugin for an automated agent diary workflow. It is not a manual note database.

Every day, a durable scheduled Run:

1. reads that local day's clean dialogue from canonical Umiro conversation history;
2. rewrites `workspace/memory/YYYY-MM-DD.md` as the agent's first-person diary in its established persona;
3. reviews the current day and previous three journal days for durable owner, memory, and people updates.

The transcript projection omits tool calls, tool results, runtime bookkeeping, transport metadata, and raw timestamps. Existing journal files are never treated as factual input for rewriting the same day. Journal tools and search projections are owner-only; writes are atomic.

Install from the plugin repository:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace diary
```

The default schedule is `55 23 * * *` in the host timezone. Configure it when a different timezone, model, or limit is required:

```bash
umo plugin configure https://github.com/iiimabbie/umiro-plugins --workspace diary \
  --config '{"timezone":"Asia/Taipei","schedule":"55 23 * * *","model":"your-model-id","maxTranscriptCharacters":80000}'
```

Set `"scheduleEnabled": false` to keep the plugin enabled while pausing only its daily workflow. Disabling the plugin itself removes its tools and searchable projections and disables its schedule; removing it also removes that schedule. Generated journal files remain as user data.
