# umiro-plugins

Optional plugins for [Umiro](https://github.com/iiimabbie/umiro-agent).

## Packages

- `packages/coder` — Registers the `coder` subagent profile: a bounded software engineering subagent with a fixed prompt, tool set, authority scope and budget.
- `packages/daily-report` — Collects structured daily information, renders a Discord ANSI report, and publishes it on a configurable schedule.
- `packages/people` — Adds optional `PEOPLE.md`-based person recognition and maintenance tools for Umiro V2.
- `packages/soul-guardian` — Monitors explicitly configured workspace files and provides integrity tools for Umiro V2.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Runtime configuration and personal data belong in the Umiro workspace and must not be committed to this repository.
