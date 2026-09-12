# People

External Umiro V2 recognition plugin backed by `PEOPLE.md`. It selects relevant person cards from trusted Discord identity facts, mentions, replies, aliases, and recent conversation continuity, and contributes controlled tools for maintaining the file.

Install from the plugin repository:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace people
umo plugin configure https://github.com/iiimabbie/umiro-plugins --workspace people --config '{"workspacePath":"/path/to/workspace","recentTurns":8,"inlineLimit":12000}'
```

## PEOPLE.md format

`PEOPLE.md` is created in the configured workspace from a template on first start, and is
never overwritten if it already exists. Only three structures are parsed:

| Structure | Required | Purpose |
|---|---|---|
| `## <name>` | yes | Starts one person entry; everything until the next `##` is that entry |
| `- Discord ID: <digits>` | no | Matches the person to message authors, mentions and reply targets |
| `- 別名: ["A", "B"]` | no | Alternative names matched against message text. Legacy `A／B（C）` also parses |

Any other `- key: value` line is free-form and passed through unchanged, so field names are
a per-deployment choice rather than a schema. Text before the first `##` is ignored and does
not reach the prompt.

Entries are selected per turn by author, mention, reply target, alias match, and recent
conversation continuity, bounded by `maxEntries` and `maxCharacters`. Selection does not
depend on who is speaking: everyone appearing in a turn is retrieved so that recognition
survives turns started by someone other than the owner.

File contents are untrusted background data. They are rendered with `instructionAuthority:
"none"`, forged boundary markers are neutralised, and nothing in the file can grant
permission or act as an instruction. Whether any of it may be repeated back to a given
person is an authorization decision made outside this plugin.

Discord identity to Principal mapping remains part of Umiro's adapter/security boundary. This plugin adds human-recognition context only and cannot grant authority.
