# Soul Guardian

External Umiro V2 plugin that monitors explicitly configured workspace files, keeps approved baselines, reports drift, and optionally restores selected files.

It contributes six tools, including a bounded UTF-8 baseline diff, the `soul-guardian.check` scheduled job, and the owner-only `/soul-guardian` command through one plugin entry. When the host provides the durable Discord button service, drift notifications include one Owner-only, single-use `Approve <path>` button per changed file plus `Approve All` for multi-file batches. A button click is itself the explicit interactive approval and completes the exact operation without a second confirmation prompt. Unwanted changes can be inspected with `soul_guardian_diff` and restored through `soul_guardian_restore`; otherwise the plugin safely falls back to a text notification.

Install from the plugin repository:

```bash
umiro plugin install https://github.com/iiimabbie/umiro-plugins --workspace soul-guardian --config '{"schedule":"0 8,20 * * *","timezone":"Asia/Taipei","channelId":"123456789012345678","targets":[{"path":"SOUL.md"},{"path":"OWNER.md"}]}'
```

The installer supplies `workspacePath`. `schedule` is a cron expression, `timezone` is an optional IANA timezone, and `channelId` is the optional Discord channel or thread that receives deduplicated drift notifications. Only complete file names listed in `targets` are monitored. Scheduled checks are always alert-only and never modify files; the Owner can ask the agent to inspect `soul_guardian_diff`, approve a new baseline, or restore an approved snapshot at any time. Configuration, baselines, and personal data stay in the local Umiro installation.
