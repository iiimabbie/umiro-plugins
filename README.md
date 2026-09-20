# umiro-plugins

Optional plugins for [Umiro](https://github.com/iiimabbie/umiro-agent).

## Packages

- `packages/coder` — Registers the `coder` subagent profile: a bounded software engineering subagent with a fixed prompt, tool set, authority scope and budget.
- `packages/google` — Gmail, Calendar, Tasks and Drive tools plus the `/google-auth` OAuth command for Umiro V2.
- `packages/daily-report` — Collects structured daily information, renders a Discord ANSI report, and publishes it on a configurable schedule.
- `packages/diary` — Reconstructs the agent's first-person daily journal from canonical conversation history on a durable schedule.
- `packages/people` — Adds optional `PEOPLE.md`-based person recognition and maintenance tools for Umiro V2.
- `packages/tool-activity` — Shows the tools a Run is using in a temporary Discord message that is removed after the final reply.
- `packages/soul-guardian` — Monitors explicitly configured workspace files and provides integrity tools for Umiro V2.
- `packages/intent-analyzer` — Optionally analyzes the current prompt once with an OpenAI-compatible or Jev backend, selecting reply intent and visible tools as untrusted advisory metadata. It does not authorize actions.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Runtime configuration and personal data belong in the Umiro workspace and must not be committed to this repository.

### intent-analyzer

This plugin sends only the current turn's prompt and model-facing tool definitions to the selected backend. Its strict, allowlisted result is advisory metadata (`role=intent`); it never grants permission or executes tools. Endpoint failures and timeouts are fail-open, so the ordinary Umiro run continues with deterministic fallback.

Install first without configuration; the restart remains healthy and the provider stays inactive until it is configured:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace intent-analyzer
```

Example local, no-auth configuration to apply after that restart:

```json
{
  "protocol": "openai-chat-completions",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "model": "your-small-instruct-model",
  "timeoutMs": 1500,
  "responseFormat": "prompt-only"
}
```

For a hosted OpenAI-compatible endpoint, use its base URL and model and configure `UMIRO_INTENT_API_KEY`. For Jev, use `https://api.typesafe.ai` with `jev-latest` and configure `TYPESAFE_API_KEY`; the Jev backend calls `/v1/systemone` using the documented TypeSafe `state`/`questions` contract.
