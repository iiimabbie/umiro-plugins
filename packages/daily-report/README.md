# daily-report

A Umiro plugin that renders structured daily information as a Discord ANSI report and publishes it to a configured channel.

## Features

- Registers the owner-only `daily_report_publish` tool.
- Registers the owner-only `/daily-report-setting` Discord command.
- Stores runtime settings in `workspace/config/plugins/daily-report.yaml`.
- Publishes a new message or updates the report already sent for the same calendar date.
- Keeps ANSI rendering inside the plugin instead of returning control sequences to the model.

## Configuration

The plugin starts disabled and without a destination channel. Configure it in Discord:

```text
/daily-report-setting
/daily-report-setting time:08:00
/daily-report-setting channel:<Discord channel>
/daily-report-setting timezone:Asia/Taipei
/daily-report-setting enabled:false
```

A generated configuration looks like this:

```yaml
channel_id: "YOUR_DISCORD_CHANNEL_ID"
last_report:
  date_key: ""
  message_id: ""
schedules:
  publish-daily-report:
    enabled: false
    schedule: "0 8 * * *"
    timezone: Asia/Taipei
```

The schedule and timezone are registered when Umiro loads the plugin. Restart Umiro after changing either value.

## Report sections

The default workflow asks the agent to gather only relevant information for:

- Weather for the owner's configured location
- Today's calendar
- Important mail
- Reminders and deadlines
- Important upcoming events
- A concise daily summary

The plugin contains no account credentials, destination channel, home address, or other deployment-specific data. Those values must stay in the local Umiro workspace.
