# Tool Activity

External Umiro V2 plugin that shows tool usage while a Run is in progress. It
posts one temporary Discord message per Run when the first tool starts and keeps
it updated as an accumulated list.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace tool-activity
```

## Behaviour

- Only Runs whose delivery destination is `{ "kind": "discord", "channelId": ... }` are shown; every other Run is ignored.
- Lines show the actual tool name: `→ <tool>` while executing, `✓ <tool>` when the operation succeeded, `✗ <tool>` for any other outcome.
- Assistant text published between model steps (`step.completed` with `assistantText`, capped at 300 characters by the host) is inserted as a `> ` quote line.
- The message is capped at `maxCharacters` (default 1900); older lines are dropped from the top so the newest activity stays visible.
- Edits are serialized per Run and spaced at least `editIntervalMs` (default 1000 ms) apart. Progress hooks return without waiting for Discord, so rate limits never slow tool execution, and every Discord failure is only logged.
- The temporary message is never edited into the final reply. The final reply is a separate message sent by the host.
- A successful Run leaves the activity message in place until Core emits `delivery.completed` for its final reply. Only then is the temporary message deleted.
- Failed Delivery attempts and Run outcomes `failed`, `cancelled` or `timed_out` leave the message in place as operational evidence.
- Concurrent Runs each get their own message, keyed by `runId`.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `editIntervalMs` | 1000 | Minimum spacing between edits of one message |
| `maxCharacters` | 1900 | Message length cap |

Requires the host Discord service (`services.discord`) and the `discord.message.write` and `discord.message.delete` capabilities.

## Development

```bash
npm run typecheck --workspace packages/tool-activity
npm test --workspace packages/tool-activity
```

Tests run against a fake Discord service and a deterministic clock.
