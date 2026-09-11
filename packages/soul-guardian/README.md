# Soul Guardian

External Umiro V2 plugin that monitors explicitly configured workspace files, keeps approved baselines, reports drift, and optionally restores selected files.

It contributes five tools, the `soul-guardian.check` scheduled job, and the owner-only `/soul-guardian` command through one plugin entry. When the host provides the durable Discord button service, drift notifications include Owner-only, single-use approval buttons for accepting or restoring the affected files; otherwise the plugin safely falls back to a text notification.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace soul-guardian --config '{"schedule":"0 8,20 * * *","timezone":"Asia/Taipei","channelId":"123456789012345678","targets":[{"path":"SOUL.md","mode":"alert"},{"path":"OWNER.md","mode":"restore"}]}'
```

The installer supplies `workspacePath`. `schedule` is a cron expression, `timezone` is an optional IANA timezone, and `channelId` is the optional Discord channel or thread that receives deduplicated drift and restore notifications. Only complete file names listed in `targets` are monitored; each uses `restore`, `alert`, or `ignore` mode. Configuration, baselines, and personal data stay in the local Umiro installation.
