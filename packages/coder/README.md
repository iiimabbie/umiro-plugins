# Coder

Registers the `coder` subagent profile for Umiro V2: a software engineering subagent for one
bounded implementation or investigation task inside the agent workspace.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace coder
```

There is nothing to configure. Once the plugin is enabled, the supervising agent delegates
with the profile name instead of writing the child's role from scratch each time:

```
subagent_delegate({ profile: "coder", objective: "..." })
```

## What the profile fixes

Everything below lives in `umiro.plugin.json` and can be read before the plugin is installed.
It cannot be generated at runtime, and the supervising agent cannot override it.

| Field | Value |
|---|---|
| `instructions` | The child's entire standing prompt: scope, working method, actions that need the supervisor, and the report format |
| `model` | `default`. Change it to a profile ID defined in `config.profiles` to give the role its own model |
| `requiredTools` | `list_files`, `read_file`, `write_file`, `bash` — all from the built-in `host-tools` plugin |
| `authorityScope` | `filesystem.read`, `filesystem.write`, `shell.execute`, with `instructionAuthority: "none"` |
| `budgetCeiling` | 24 model turns, 80 tool calls, 15 minutes |
| `outputContract` | `text` |

## What the profile does not do

`requiredTools` is an availability gate, not an allowlist. Every Run sees every registered
tool, and what the child may actually do is decided by capability checks at execution time.
The lever that narrows the child is `authorityScope.capabilities`, and it only ever narrows:
the Core intersects it with the parent Run's authority, so a profile can never obtain a
capability the parent lacks, and `subagent.delegate` is removed from every child
unconditionally. Delegation is one level deep — a coder child cannot delegate further.

The child receives no persona, no memory, no conversation history, and no knowledge of who
asked or why. It sees the profile instructions plus the task the supervisor compiled, and
nothing else. Its reply goes back to the supervisor, never directly to a person.

## Report format

The child's final message is the only thing the supervisor sees. The instructions require
four sections:

```
RESULT: done | partial | blocked
CHANGES: one line per file created, modified or deleted
VERIFICATION: the commands run and their outcome, or `not verified` and why
NOTES: assumptions, omissions, and problems found but not fixed
```

`partial` and `blocked` both require NOTES to state what remains.

## Development

```bash
npm run typecheck
npm test
```

The tests validate the shipped manifest against the same limits the Plugin Host enforces —
instruction size, capability containment, positive budgets, duplicate IDs — so a manifest the
Host would reject fails here first.
