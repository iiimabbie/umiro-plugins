# Soul Guardian

External Umiro V2 plugin that monitors explicitly configured workspace files, keeps approved baselines, reports drift, and optionally restores selected files.

It contributes five tools, the `soul-guardian.check` scheduled job, and the owner-only `/soul-guardian` command through one plugin entry.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace soul-guardian
umiro plugin configure https://github.com/iiimabbie/umiro-plugins --workspace soul-guardian --config '{"workspacePath":"/path/to/workspace","schedule":"0 8 * * *","targets":[{"path":"SOUL.md","mode":"alert"}]}'
```

Only complete file names listed in `targets` are monitored. Configuration, baselines, and personal data stay in the local Umiro installation.
