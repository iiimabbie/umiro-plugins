# Google

External Umiro V2 plugin for Gmail, Google Calendar, Google Tasks and Google Drive. It talks to the Google REST APIs directly with the Node `fetch` API and has no runtime dependencies.

Install from the plugin repository:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace google
```

## Setup

1. Create an OAuth client of type **Desktop app** in the Google Cloud console and enable the Gmail, Calendar, Tasks and Drive APIs for the project.
2. Provide the client credentials as the secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the gateway environment.
3. As the owner, run `/google-auth` in Discord. The reply contains an authorization link; approve it, then paste the full address the browser lands on (`http://127.0.0.1/?code=...`) back as `/google-auth callback:<url>`.

The refresh token is kept in the plugin state store under `oauth/token.json`; access tokens are refreshed automatically. The plugin has no configuration.

Requested scopes: `calendar`, `gmail.modify`, `drive`, `tasks`.

## Tools

| Tool | Capability | Tier |
|---|---|---|
| `google_gmail_search`, `google_gmail_read` | `google.gmail.read` | common |
| `google_gmail_send`, `google_gmail_create_draft` | `google.gmail.write` | sensitive |
| `google_calendar_list_events` | `google.calendar.read` | common |
| `google_calendar_create_event`, `google_calendar_update_event`, `google_calendar_delete_event` | `google.calendar.write` | sensitive |
| `google_tasks_list` | `google.tasks.read` | common |
| `google_tasks_create`, `google_tasks_complete`, `google_tasks_delete` | `google.tasks.write` | sensitive |
| `google_drive_search`, `google_drive_read` | `google.drive.read` | common |
| `google_drive_upload` | `google.drive.write` | sensitive |

Sensitive tools declare the resource they act on: `gmail-mailbox`/`me`, `google-calendar`/`<calendar_id>` (default `primary`), `google-tasklist`/`<task_list_id>` (default `@default`), and `google-drive`/`<folder_id>` (default `root`).

`google_drive_upload` takes either `content` (plain text) or `artifact_id` (an artifact from the conversation, such as a Discord attachment). Artifact uploads require the host to expose artifact reads to plugins; until then the tool reports that and `content` uploads keep working.

## Commands

- `/google-auth [callback]` — owner only, ephemeral. Without `callback` it reports the current state or returns the authorization link; with `callback` it exchanges the code and stores the token.

## Development

```bash
npm run typecheck --workspace packages/google
npm test --workspace packages/google
```

Tests run offline against an injected `fetch` and an in-memory state store.
