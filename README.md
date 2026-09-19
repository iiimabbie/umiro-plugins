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
- `packages/intent-analyzer` — Optionally classifies the current prompt with an OpenAI-compatible small model and adds advisory intent context. It does not authorize actions or choose tools/models.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Runtime configuration and personal data belong in the Umiro workspace and must not be committed to this repository.

### intent-analyzer

This plugin sends only the current turn's prompt to an OpenAI-compatible Chat Completions endpoint. Its strict, allowlisted result is advisory metadata (`role=intent`); it never grants permission, selects a tool or model, or stores durable data. Endpoint failures and timeouts are fail-open, so the ordinary Umiro run continues without the intent block.

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

For a hosted endpoint, use its OpenAI-compatible base URL and model and configure the Umiro secret `UMIRO_INTENT_API_KEY`; the plugin sends it as a Bearer token. Jev can be used when its endpoint supports this same OpenAI-compatible Chat Completions protocol. A different Jev wire protocol is not supported by this version.
