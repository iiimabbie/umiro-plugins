import { GoogleAuthError, GoogleOAuth, type Fetch } from "./auth.js";
import { Calendar } from "./calendar.js";
import { GoogleApiError, GoogleClient } from "./client.js";
import { Drive, guessMime } from "./drive.js";
import { Gmail } from "./gmail.js";
import { Tasks } from "./tasks.js";
import type { JsonObject, PluginCommandDefinition, PluginInstance, PluginSetupContext, ResourceRef, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./umiro-api.js";

export { GoogleOAuth, GoogleAuthError, TOKEN_STATE_KEY } from "./auth.js";
export { GoogleClient, GoogleApiError } from "./client.js";

export interface CreatePluginOptions { readonly fetch?: Fetch; readonly now?: () => number }

type Policy = ToolDefinition["policy"];
const str = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const num = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
const calendarId = (input: JsonObject) => str(input.calendar_id) ?? "primary";
const taskListId = (input: JsonObject) => str(input.task_list_id) ?? "@default";

const mailbox: ResourceRef = { kind: "gmail-mailbox", id: "me" };
const read = (capability: string): Policy => ({ capability, tier: "common", interactionRequirement: "not_required", sideEffect: "none" });
const write = (capability: string, sideEffect: "idempotent" | "non_idempotent", resource: (input: JsonObject) => ResourceRef): Policy => ({ capability, tier: "sensitive", interactionRequirement: "not_required", sideEffect, resource });

function failure(error: unknown): ToolExecutionResult {
  if (error instanceof GoogleAuthError) return { ok: false, effectStatus: "not_applicable", error: { code: `google_${error.code}`, message: error.message, retryable: false } };
  if (error instanceof GoogleApiError) return { ok: false, effectStatus: error.status >= 500 ? "unknown" : "not_applicable", error: { code: "google_api_error", message: error.message, retryable: error.retryable }, output: { status: error.status } };
  if (error instanceof Error && error.name === "AbortError") return { ok: false, effectStatus: "unknown", error: { code: "aborted", message: "operation aborted", retryable: true } };
  return { ok: false, effectStatus: "unknown", error: { code: "google_plugin_error", message: error instanceof Error ? error.message : String(error), retryable: false } };
}

export function createPlugin(context: PluginSetupContext, options: CreatePluginOptions = {}): PluginInstance {
  const auth = new GoogleOAuth({ clientId: context.getSecret("GOOGLE_CLIENT_ID"), clientSecret: context.getSecret("GOOGLE_CLIENT_SECRET"), state: context.state, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.now ? { now: options.now } : {}), ...(context.logger ? { logger: context.logger } : {}) });
  const client = new GoogleClient(auth, options.fetch);
  const gmail = new Gmail(client); const calendar = new Calendar(client, options.now); const tasks = new Tasks(client); const drive = new Drive(client);

  const tool = (definition: Omit<ToolDefinition, "execute"> & { execute: (input: JsonObject, context: ToolExecutionContext) => Promise<string> }): ToolDefinition => ({
    ...definition,
    async execute(input, executionContext) {
      try { return { ok: true, output: await definition.execute(input, executionContext), effectStatus: definition.policy.sideEffect === "none" ? "not_applicable" : "confirmed" }; }
      catch (error) { return failure(error); }
    },
  });

  const mailSchema = { type: "object", additionalProperties: false, required: ["to", "subject", "body"], properties: { to: { type: "string", minLength: 3, description: "Recipient email address" }, subject: { type: "string", description: "Email subject" }, body: { type: "string", description: "Email body (plain text)" } } };
  const eventProperties = { summary: { type: "string", description: "Event title" }, start: { type: "string", description: "Start time in ISO 8601 format" }, end: { type: "string", description: "End time in ISO 8601 format" }, description: { type: "string", description: "Event description" }, location: { type: "string", description: "Event location" }, calendar_id: { type: "string", description: "Calendar ID (default: primary)" } };
  const eventFields = (input: JsonObject) => ({ ...(str(input.summary) !== undefined ? { summary: String(input.summary) } : {}), ...(str(input.start) ? { start: String(input.start) } : {}), ...(str(input.end) ? { end: String(input.end) } : {}), ...(typeof input.description === "string" ? { description: input.description } : {}), ...(typeof input.location === "string" ? { location: input.location } : {}) });

  const tools: ToolDefinition[] = [
    tool({ name: "google_gmail_search", description: "Search Gmail messages. Each result shows date, sender, the recipient addresses the message was actually delivered to (including forwarding hops), and subject, so mail forwarded from several mailboxes can be told apart.", inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, description: "Gmail search query (same syntax as the Gmail search bar)" }, max_results: { type: "integer", minimum: 1, maximum: 100, description: "Max messages to return (default: 10)" } } }, policy: read("google.gmail.read"), execute: (input, { signal }) => gmail.search(String(input.query), num(input.max_results, 10), signal) }),
    tool({ name: "google_gmail_read", description: "Read a specific Gmail message by ID. Returns sender, recipient addresses (including forwarding hops), date, subject and the full text body.", inputSchema: { type: "object", additionalProperties: false, required: ["message_id"], properties: { message_id: { type: "string", minLength: 1, description: "Message ID" } } }, policy: read("google.gmail.read"), execute: (input, { signal }) => gmail.read(String(input.message_id), signal) }),
    tool({ name: "google_gmail_send", description: "Send an email immediately. IRREVERSIBLE: it reaches real recipients and cannot be recalled. Confirm recipient, subject, and body with the owner before calling; if there is any doubt, use google_gmail_create_draft instead and let the owner send it.", inputSchema: mailSchema, policy: write("google.gmail.write", "non_idempotent", () => mailbox), execute: (input, { signal }) => gmail.send(String(input.to), String(input.subject), String(input.body), signal) }),
    tool({ name: "google_gmail_create_draft", description: "Create an email draft in Gmail without sending it. Safe alternative to google_gmail_send when the owner should review the wording first.", inputSchema: mailSchema, policy: write("google.gmail.write", "non_idempotent", () => mailbox), execute: (input, { signal }) => gmail.createDraft(String(input.to), String(input.subject), String(input.body), signal) }),

    tool({ name: "google_calendar_list_events", description: "List upcoming calendar events. Returns events from now (or a given start time) up to a given end time.", inputSchema: { type: "object", additionalProperties: false, properties: { start: { type: "string", description: "Start time in ISO 8601 format (default: now)" }, end: { type: "string", description: "End time in ISO 8601 format (default: 7 days from now)" }, calendar_id: { type: "string", description: "Calendar ID (default: primary)" }, max_results: { type: "integer", minimum: 1, maximum: 250, description: "Max events to return (default: 20)" } } }, policy: read("google.calendar.read"), execute: (input, { signal }) => calendar.listEvents({ calendarId: calendarId(input), ...(str(input.start) ? { start: String(input.start) } : {}), ...(str(input.end) ? { end: String(input.end) } : {}), maxResults: num(input.max_results, 20) }, signal) }),
    tool({ name: "google_calendar_create_event", description: "Create a calendar event.", inputSchema: { type: "object", additionalProperties: false, required: ["summary", "start", "end"], properties: eventProperties }, policy: write("google.calendar.write", "non_idempotent", input => ({ kind: "google-calendar", id: calendarId(input) })), execute: (input, { signal }) => calendar.createEvent(calendarId(input), eventFields(input), signal) }),
    tool({ name: "google_calendar_update_event", description: "Update an existing calendar event. Only provided fields will be changed.", inputSchema: { type: "object", additionalProperties: false, required: ["event_id"], properties: { event_id: { type: "string", minLength: 1, description: "Event ID to update" }, ...eventProperties } }, policy: write("google.calendar.write", "idempotent", input => ({ kind: "google-calendar", id: calendarId(input) })), execute: (input, { signal }) => calendar.updateEvent(calendarId(input), String(input.event_id), eventFields(input), signal) }),
    tool({ name: "google_calendar_delete_event", description: "Delete a calendar event. IRREVERSIBLE: there is no undo and attendees are notified of the cancellation. Confirm the event_id belongs to the intended event (list it first) before calling.", inputSchema: { type: "object", additionalProperties: false, required: ["event_id"], properties: { event_id: { type: "string", minLength: 1, description: "Event ID to delete" }, calendar_id: { type: "string", description: "Calendar ID (default: primary)" } } }, policy: write("google.calendar.write", "idempotent", input => ({ kind: "google-calendar", id: calendarId(input) })), execute: (input, { signal }) => calendar.deleteEvent(calendarId(input), String(input.event_id), signal) }),

    tool({ name: "google_tasks_list", description: "List tasks from a task list. Shows incomplete tasks by default.", inputSchema: { type: "object", additionalProperties: false, properties: { task_list_id: { type: "string", description: "Task list ID (default: @default)" }, show_completed: { type: "boolean", description: "Include completed tasks (default: false)" }, max_results: { type: "integer", minimum: 1, maximum: 100, description: "Max tasks to return (default: 20)" } } }, policy: read("google.tasks.read"), execute: (input, { signal }) => tasks.list({ listId: taskListId(input), showCompleted: input.show_completed === true, maxResults: num(input.max_results, 20) }, signal) }),
    tool({ name: "google_tasks_create", description: "Create a new task.", inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, description: "Task title" }, notes: { type: "string", description: "Task notes/details" }, due: { type: "string", description: "Due date in ISO 8601 format (e.g. 2026-04-25T00:00:00Z)" }, task_list_id: { type: "string", description: "Task list ID (default: @default)" } } }, policy: write("google.tasks.write", "non_idempotent", input => ({ kind: "google-tasklist", id: taskListId(input) })), execute: (input, { signal }) => tasks.create(taskListId(input), { title: String(input.title), ...(str(input.notes) ? { notes: String(input.notes) } : {}), ...(str(input.due) ? { due: String(input.due) } : {}) }, signal) }),
    tool({ name: "google_tasks_complete", description: "Mark a task as completed.", inputSchema: { type: "object", additionalProperties: false, required: ["task_id"], properties: { task_id: { type: "string", minLength: 1, description: "Task ID" }, task_list_id: { type: "string", description: "Task list ID (default: @default)" } } }, policy: write("google.tasks.write", "idempotent", input => ({ kind: "google-tasklist", id: taskListId(input) })), execute: (input, { signal }) => tasks.complete(taskListId(input), String(input.task_id), signal) }),
    tool({ name: "google_tasks_delete", description: "Delete a task permanently. IRREVERSIBLE. To mark a task done instead, use google_tasks_complete, which is what is usually wanted.", inputSchema: { type: "object", additionalProperties: false, required: ["task_id"], properties: { task_id: { type: "string", minLength: 1, description: "Task ID" }, task_list_id: { type: "string", description: "Task list ID (default: @default)" } } }, policy: write("google.tasks.write", "idempotent", input => ({ kind: "google-tasklist", id: taskListId(input) })), execute: (input, { signal }) => tasks.delete(taskListId(input), String(input.task_id), signal) }),

    tool({ name: "google_drive_search", description: "Search files in Google Drive by name.", inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, description: "File name keyword" }, max_results: { type: "integer", minimum: 1, maximum: 100, description: "Max files to return (default: 10)" } } }, policy: read("google.drive.read"), execute: (input, { signal }) => drive.search(String(input.query), num(input.max_results, 10), signal) }),
    tool({ name: "google_drive_read", description: "Read the text content of a Google Drive file (Google Docs, Sheets, or plain text files).", inputSchema: { type: "object", additionalProperties: false, required: ["file_id"], properties: { file_id: { type: "string", minLength: 1, description: "File ID" } } }, policy: read("google.drive.read"), execute: (input, { signal }) => drive.read(String(input.file_id), signal) }),
    tool({ name: "google_drive_upload", description: "Upload a file to Google Drive. Provide either `content` (plain text) or `artifact_id` (an artifact from the conversation, such as a Discord attachment), but not both.", inputSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, description: "File name on Google Drive (e.g. 'report.pdf')" }, content: { type: "string", description: "File content as plain text. Mutually exclusive with artifact_id." }, artifact_id: { type: "string", minLength: 1, description: "ID of an artifact to upload. Mutually exclusive with content." }, mime_type: { type: "string", description: "MIME type. Defaults to the artifact's media type, else inferred from the file extension." }, folder_id: { type: "string", description: "Google Drive parent folder ID (optional)." } } }, policy: write("google.drive.write", "non_idempotent", input => ({ kind: "google-drive", id: str(input.folder_id) ?? "root" })), async execute(input, executionContext) {
      const content = typeof input.content === "string" ? input.content : undefined; const artifactId = str(input.artifact_id);
      if (content !== undefined && artifactId) throw new TypeError("provide either `content` or `artifact_id`, not both");
      if (content === undefined && !artifactId) throw new TypeError("one of `content` or `artifact_id` is required");
      const name = String(input.name);
      let bytes: Uint8Array; let mimeType = str(input.mime_type);
      if (artifactId) {
        const artifacts = context.services?.artifacts;
        if (!artifacts?.read) throw new Error("the host does not provide artifact reads; upload with `content` instead");
        const artifact = await artifacts.read({ artifactId, principalId: executionContext.execution.actor.id });
        if (!artifact) throw new Error(`artifact not found or not accessible: ${artifactId}`);
        bytes = artifact.bytes; mimeType ??= artifact.mediaType;
      } else bytes = new TextEncoder().encode(content);
      return drive.upload({ name, bytes, mimeType: mimeType ?? guessMime(name), ...(str(input.folder_id) ? { folderId: String(input.folder_id) } : {}) }, executionContext.signal);
    } }),
  ];

  const authCommand: PluginCommandDefinition = {
    name: "google-auth",
    description: "Authorize Google API access (Gmail, Calendar, Tasks, Drive)",
    ownerOnly: true,
    ephemeral: true,
    options: [{ name: "callback", description: "The full URL the browser landed on after authorization", type: "string" }],
    async execute(input) {
      const callback = str(input.callback);
      if (!callback) {
        if (await auth.isAuthorized()) return { text: "Google API is already authorized." };
        if (!auth.configured) return { text: "Set the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets and restart first." };
        return { text: `Open this link to authorize:\n${auth.authorizationUrl()}\n\nAfter approving, the browser lands on \`http://127.0.0.1/?code=...\`. Paste the whole address back:\n\`/google-auth callback:<paste the full URL>\`` };
      }
      try { await auth.exchangeCode(callback); context.logger?.info("google.authorized", "Google OAuth completed"); return { text: "Google API authorized." }; }
      catch (error) { return { text: `Authorization failed: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  };

  return {
    contributions: { tools, commands: [authCommand] },
    async health() {
      if (!auth.configured) return { status: "degraded", detail: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set" };
      return (await auth.isAuthorized()) ? { status: "ok" } : { status: "degraded", detail: "not authorized; run /google-auth" };
    },
  };
}
