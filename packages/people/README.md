# People

External Umiro V2 recognition plugin backed by `PEOPLE.md`. It selects relevant person cards from trusted Discord identity facts, mentions, replies, aliases, and recent conversation continuity, and contributes controlled tools for maintaining the file.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace people
umiro plugin configure https://github.com/iiimabbie/umiro-plugins --workspace people --config '{"workspacePath":"/path/to/workspace","recentTurns":8,"inlineLimit":12000}'
```

Discord identity to Principal mapping remains part of Umiro's adapter/security boundary. This plugin adds human-recognition context only and cannot grant authority.
