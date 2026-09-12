import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractCode, TOKEN_STATE_KEY } from "../src/auth.js";
import { encodeMessage, collectRecipients, extractBody, formatSearchLine } from "../src/gmail.js";
import { multipartUpload, nameContainsQuery } from "../src/drive.js";
import { createPlugin } from "../src/index.js";
import type { JsonObject, PluginStateStore, ToolExecutionContext } from "../src/umiro-api.js";

interface Call { url: URL; method: string; headers: Record<string, string>; body?: string }

function memoryState(): PluginStateStore & { entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>();
  return { entries, async read(key) { return entries.get(key); }, async writeAtomic(key, value) { entries.set(key, value); }, async remove(key) { return entries.delete(key); } };
}

function mockFetch(routes: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const body = init?.body === undefined ? undefined : typeof init.body === "string" ? init.body : init.body instanceof Blob ? await init.body.text() : String(init.body);
    const call: Call = { url: new URL(input), method: init?.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) };
    calls.push(call);
    const result = routes(call);
    if (result instanceof Response) return result;
    if (typeof result === "string") return new Response(result, { status: 200, headers: { "content-type": "text/plain" } });
    return Response.json(result ?? {}, { status: 200 });
  };
  return { fetch, calls };
}

const execution: ToolExecutionContext = { execution: { actor: { id: "owner" } }, operationId: "op", signal: new AbortController().signal };
const authorizedToken = { refresh_token: "refresh-1", access_token: "access-1", expiry_date: Date.now() + 3_600_000 };

function setup(routes: (call: Call) => unknown, options: { authorized?: boolean; configured?: boolean; artifacts?: JsonObject | undefined; now?: () => number } = {}) {
  const state = memoryState();
  if (options.authorized !== false) state.entries.set(TOKEN_STATE_KEY, new TextEncoder().encode(JSON.stringify(authorizedToken)));
  const { fetch, calls } = mockFetch(routes);
  const configured = options.configured !== false;
  const artifacts = options.artifacts === undefined ? undefined : { read: async ({ artifactId }: { artifactId: string }) => artifactId === "art-1" ? { bytes: new TextEncoder().encode("PDFDATA"), filename: "scan.pdf", mediaType: "application/pdf" } : undefined };
  const plugin = createPlugin({ pluginId: "google", namespace: "google", permissionCeiling: {}, config: {}, state, ...(artifacts ? { services: { artifacts } } : {}), getSecret: name => configured ? ({ GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" } as Record<string, string>)[name] : undefined }, { fetch, ...(options.now ? { now: options.now } : {}) });
  const tool = (name: string) => { const found = plugin.contributions.tools?.find(item => item.name === name); assert.ok(found, `tool ${name}`); return found; };
  const command = (name: string) => { const found = plugin.contributions.commands?.find(item => item.name === name); assert.ok(found, `command ${name}`); return found; };
  return { plugin, state, calls, tool, command };
}

test("manifest contributions match the plugin instance", async () => {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../umiro.plugin.json", import.meta.url)), "utf8")) as { contributes: { tools: string[]; commands: string[] }; permissions: { capabilities: string[] } };
  const { plugin } = setup(() => ({}));
  assert.deepEqual(plugin.contributions.tools?.map(tool => tool.name), manifest.contributes.tools);
  assert.deepEqual(plugin.contributions.commands?.map(command => command.name), manifest.contributes.commands);
  for (const tool of plugin.contributions.tools ?? []) {
    assert.ok(manifest.permissions.capabilities.includes(tool.policy.capability), `${tool.name} capability declared`);
    if (tool.policy.tier === "sensitive") assert.equal(typeof tool.policy.resource, "function", `${tool.name} declares a resource`);
    assert.equal(tool.policy.tier, tool.policy.sideEffect === "none" ? "common" : "sensitive", `${tool.name} tier`);
  }
});

test("gmail helpers keep V1 formatting and reject header injection", () => {
  const headers = [{ name: "From", value: "Alice <alice@example.com>" }, { name: "To", value: "Bob <bob@example.com>" }, { name: "Delivered-To", value: "bob@example.com" }, { name: "X-Forwarded-To", value: "carol@example.com" }, { name: "Subject", value: "Hi" }, { name: "Date", value: "Mon" }];
  assert.deepEqual(collectRecipients(headers), ["Bob <bob@example.com>", "carol@example.com"]);
  assert.equal(formatSearchLine("m1", headers), "[m1] Mon | Alice <alice@example.com> -> Bob <bob@example.com>, carol@example.com | Hi");
  assert.equal(extractBody({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: Buffer.from("<b>x</b>").toString("base64url") } }, { mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64url") } }] }), "plain");
  const raw = Buffer.from(encodeMessage("bob@example.com", "主旨", "內文"), "base64url").toString("utf8");
  assert.match(raw, /^To: bob@example.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.throws(() => encodeMessage("bob@example.com\r\nBcc: x@example.com", "s", "b"), /line breaks/);
});

test("drive helpers escape queries and build multipart bodies", async () => {
  assert.equal(nameContainsQuery("it's"), "name contains 'it\\'s'");
  const { body, contentType } = multipartUpload({ name: "a.txt" }, "text/plain", new TextEncoder().encode("hello"));
  const boundary = contentType.split("boundary=")[1]!;
  assert.equal(await body.text(), `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n{"name":"a.txt"}\r\n--${boundary}\r\ncontent-type: text/plain\r\n\r\nhello\r\n--${boundary}--`);
});

test("/google-auth walks the V1 flow and stores the refresh token in plugin state", async () => {
  const { command, state, calls } = setup(call => call.url.hostname === "oauth2.googleapis.com" ? { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 } : {}, { authorized: false });
  const auth = command("google-auth");
  assert.equal(auth.ownerOnly, true);
  const prompt = await auth.execute({});
  assert.match(String(prompt.text), /accounts\.google\.com\/o\/oauth2\/v2\/auth\?client_id=client-id/);
  assert.match(String(prompt.text), /access_type=offline/);
  const done = await auth.execute({ callback: "http://127.0.0.1/?code=4%2Fabc&scope=x" });
  assert.equal(done.text, "Google API authorized.");
  const exchange = calls.find(call => call.url.hostname === "oauth2.googleapis.com");
  assert.ok(exchange?.body?.includes("code=4%2Fabc") && exchange.body.includes("grant_type=authorization_code"));
  assert.equal(JSON.parse(new TextDecoder().decode(state.entries.get(TOKEN_STATE_KEY))).refresh_token, "refresh-2");
  assert.equal((await auth.execute({})).text, "Google API is already authorized.");
});

test("/google-auth explains missing secrets and failed exchanges", async () => {
  const unconfigured = setup(() => ({}), { authorized: false, configured: false });
  assert.match(String((await unconfigured.command("google-auth").execute({})).text), /GOOGLE_CLIENT_ID/);
  const failing = setup(() => Response.json({ error: "invalid_grant", error_description: "Bad code" }, { status: 400 }), { authorized: false });
  assert.match(String((await failing.command("google-auth").execute({ callback: "bad" })).text), /Authorization failed: .*Bad code/);
  assert.equal(extractCode("not a url"), "not a url");
});

test("tools fail closed before authorization", async () => {
  const { tool, calls } = setup(() => ({}), { authorized: false });
  const result = await tool("google_gmail_search").execute({ query: "x" }, execution);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error.code, "google_not_authorized"); assert.equal(result.effectStatus, "not_applicable"); }
  assert.equal(calls.length, 0);
});

test("expired access tokens are refreshed once and persisted", async () => {
  let now = authorizedToken.expiry_date + 1;
  const { tool, state, calls } = setup(call => call.url.hostname === "oauth2.googleapis.com" ? { access_token: "access-3", expires_in: 3600 } : { items: [] }, { now: () => now });
  const list = tool("google_tasks_list");
  await Promise.all([list.execute({}, execution), list.execute({}, execution)]);
  assert.equal(calls.filter(call => call.url.hostname === "oauth2.googleapis.com").length, 1);
  assert.equal(calls.find(call => call.url.hostname === "tasks.googleapis.com")?.headers.authorization, "Bearer access-3");
  const stored = JSON.parse(new TextDecoder().decode(state.entries.get(TOKEN_STATE_KEY)));
  assert.equal(stored.access_token, "access-3"); assert.equal(stored.refresh_token, "refresh-1");
  now += 1; await list.execute({}, execution);
  assert.equal(calls.filter(call => call.url.hostname === "oauth2.googleapis.com").length, 1);
});

test("gmail search and read call the REST endpoints with V1 semantics", async () => {
  const { tool } = setup(call => {
    if (call.url.pathname.endsWith("/messages")) { assert.equal(call.url.searchParams.get("q"), "from:alice"); assert.equal(call.url.searchParams.get("maxResults"), "10"); return { messages: [{ id: "m1" }] }; }
    if (call.url.searchParams.get("format") === "metadata") { assert.deepEqual(call.url.searchParams.getAll("metadataHeaders"), ["Subject", "From", "Date", "To", "Delivered-To", "X-Forwarded-To"]); return { payload: { headers: [{ name: "Subject", value: "S" }, { name: "From", value: "a@example.com" }, { name: "Date", value: "D" }, { name: "To", value: "b@example.com" }] } }; }
    return { payload: { headers: [{ name: "From", value: "a@example.com" }, { name: "To", value: "b@example.com" }, { name: "Subject", value: "S" }, { name: "Date", value: "D" }], body: { data: Buffer.from("body text").toString("base64url") }, mimeType: "text/plain" } };
  });
  const search = await tool("google_gmail_search").execute({ query: "from:alice" }, execution);
  assert.deepEqual(search, { ok: true, output: "[m1] D | a@example.com -> b@example.com | S", effectStatus: "not_applicable" });
  const read = await tool("google_gmail_read").execute({ message_id: "m1" }, execution);
  assert.ok(read.ok && String(read.output).endsWith("Subject: S\n\nbody text"));
});

test("gmail send and draft post encoded messages", async () => {
  const { tool, calls } = setup(call => ({ id: call.url.pathname.endsWith("/drafts") ? "d1" : "s1" }));
  const sent = await tool("google_gmail_send").execute({ to: "bob@example.com", subject: "Hi", body: "Hello" }, execution);
  assert.deepEqual(sent, { ok: true, output: "Email sent (s1)", effectStatus: "confirmed" });
  const draft = await tool("google_gmail_create_draft").execute({ to: "bob@example.com", subject: "Hi", body: "Hello" }, execution);
  assert.deepEqual(draft, { ok: true, output: "Draft created (d1)", effectStatus: "confirmed" });
  assert.equal(JSON.parse(calls[0]!.body!).raw, encodeMessage("bob@example.com", "Hi", "Hello"));
  assert.deepEqual(JSON.parse(calls[1]!.body!), { message: { raw: encodeMessage("bob@example.com", "Hi", "Hello") } });
  assert.deepEqual(tool("google_gmail_send").policy.resource?.({}), { kind: "gmail-mailbox", id: "me" });
});

test("calendar tools default to the primary calendar and only patch provided fields", async () => {
  const fixed = Date.UTC(2026, 0, 1);
  const { tool, calls } = setup(call => call.method === "GET" ? { items: [{ id: "e1", summary: "Standup", start: { dateTime: "2026-01-02T09:00:00Z" }, location: "Room" }] } : call.method === "DELETE" ? new Response(null, { status: 204 }) : { id: "e2", summary: "Lunch" }, { now: () => fixed });
  const list = await tool("google_calendar_list_events").execute({}, execution);
  assert.ok(list.ok && list.output === "[e1] 2026-01-02T09:00:00Z - Standup @ Room");
  assert.equal(calls[0]!.url.pathname, "/calendar/v3/calendars/primary/events");
  assert.equal(calls[0]!.url.searchParams.get("timeMin"), new Date(fixed).toISOString());
  assert.equal(calls[0]!.url.searchParams.get("timeMax"), new Date(fixed + 7 * 86_400_000).toISOString());
  const created = await tool("google_calendar_create_event").execute({ summary: "Lunch", start: "2026-01-02T12:00:00Z", end: "2026-01-02T13:00:00Z", calendar_id: "team@example.com" }, execution);
  assert.ok(created.ok && created.output === 'Event created: "Lunch" (e2)');
  assert.equal(calls[1]!.url.pathname, "/calendar/v3/calendars/team%40example.com/events");
  assert.deepEqual(JSON.parse(calls[1]!.body!), { summary: "Lunch", start: { dateTime: "2026-01-02T12:00:00Z" }, end: { dateTime: "2026-01-02T13:00:00Z" } });
  await tool("google_calendar_update_event").execute({ event_id: "e2", location: "Cafe" }, execution);
  assert.equal(calls[2]!.method, "PATCH"); assert.deepEqual(JSON.parse(calls[2]!.body!), { location: "Cafe" });
  const deleted = await tool("google_calendar_delete_event").execute({ event_id: "e2" }, execution);
  assert.deepEqual(deleted, { ok: true, output: "Event deleted (e2)", effectStatus: "confirmed" });
  assert.deepEqual(tool("google_calendar_delete_event").policy.resource?.({ calendar_id: "team@example.com" }), { kind: "google-calendar", id: "team@example.com" });
});

test("tasks tools use the @default list and V1 output", async () => {
  const { tool, calls } = setup(call => call.method === "GET" ? { items: [{ id: "t1", title: "Buy milk", status: "needsAction", due: "2026-04-25T00:00:00.000Z" }, { id: "t2", title: "Done", status: "completed" }] } : call.method === "DELETE" ? new Response(null, { status: 204 }) : { id: "t3", title: "New" });
  const list = await tool("google_tasks_list").execute({ show_completed: true }, execution);
  assert.ok(list.ok && list.output === "[ ] [t1] Buy milk (due: 2026-04-25)\n[x] [t2] Done");
  assert.equal(calls[0]!.url.pathname, "/tasks/v1/lists/%40default/tasks"); assert.equal(calls[0]!.url.searchParams.get("showHidden"), "true");
  const created = await tool("google_tasks_create").execute({ title: "New", notes: "n" }, execution);
  assert.ok(created.ok && created.output === 'Task created: "New" (t3)'); assert.deepEqual(JSON.parse(calls[1]!.body!), { title: "New", notes: "n" });
  const completed = await tool("google_tasks_complete").execute({ task_id: "t3" }, execution);
  assert.ok(completed.ok && completed.output === 'Task completed: "New"'); assert.deepEqual(JSON.parse(calls[2]!.body!), { status: "completed" });
  const deleted = await tool("google_tasks_delete").execute({ task_id: "t3", task_list_id: "list-9" }, execution);
  assert.ok(deleted.ok && deleted.output === "Task deleted (t3)"); assert.equal(calls[3]!.url.pathname, "/tasks/v1/lists/list-9/tasks/t3");
});

test("drive search, read and upload", async () => {
  const { tool, calls } = setup(call => {
    if (call.url.hostname === "www.googleapis.com" && call.url.pathname === "/drive/v3/files") return { files: [{ id: "f1", name: "notes.txt", mimeType: "text/plain", modifiedTime: "2026-01-01T00:00:00Z" }] };
    if (call.url.pathname === "/drive/v3/files/doc1") return call.url.searchParams.get("alt") === "media" ? "raw" : { name: "Doc", mimeType: "application/vnd.google-apps.document" };
    if (call.url.pathname === "/drive/v3/files/doc1/export") return "exported text";
    if (call.url.pathname === "/upload/drive/v3/files") return { id: "u1", name: "report.txt", size: "5", mimeType: "text/plain", webViewLink: "https://drive.example/u1" };
    throw new Error(`unexpected ${call.url}`);
  }, { artifacts: {} });
  const search = await tool("google_drive_search").execute({ query: "notes" }, execution);
  assert.ok(search.ok && search.output === "[f1] notes.txt (text/plain) modified: 2026-01-01T00:00:00Z");
  assert.equal(calls[0]!.url.searchParams.get("q"), "name contains 'notes'");
  const read = await tool("google_drive_read").execute({ file_id: "doc1" }, execution);
  assert.ok(read.ok && read.output === "[Doc]\nexported text");
  const upload = await tool("google_drive_upload").execute({ name: "report.txt", content: "hello", folder_id: "folder-1" }, execution);
  assert.ok(upload.ok && String(upload.output).includes("webViewLink: https://drive.example/u1"));
  const uploadCall = calls.at(-1)!;
  assert.equal(uploadCall.url.searchParams.get("uploadType"), "multipart");
  assert.match(uploadCall.headers["content-type"]!, /^multipart\/related; boundary=/);
  assert.ok(uploadCall.body!.includes('{"name":"report.txt","parents":["folder-1"]}') && uploadCall.body!.includes("content-type: text/plain\r\n\r\nhello"));
  assert.deepEqual(tool("google_drive_upload").policy.resource?.({ folder_id: "folder-1" }), { kind: "google-drive", id: "folder-1" });
  assert.deepEqual(tool("google_drive_upload").policy.resource?.({}), { kind: "google-drive", id: "root" });
});

test("drive upload from an artifact uses the host artifact service", async () => {
  const withArtifacts = setup(call => ({ id: "u2", name: call.body?.match(/"name":"([^"]+)"/)?.[1], mimeType: "application/pdf" }), { artifacts: {} });
  const upload = withArtifacts.tool("google_drive_upload");
  const ok = await upload.execute({ name: "scan.pdf", artifact_id: "art-1" }, execution);
  assert.ok(ok.ok && String(ok.output).includes("mimeType:    application/pdf"));
  assert.ok(withArtifacts.calls[0]!.body!.includes("content-type: application/pdf\r\n\r\nPDFDATA"));
  const missing = await upload.execute({ name: "x.pdf", artifact_id: "nope" }, execution);
  assert.ok(!missing.ok && /not found or not accessible/.test(missing.error.message));
  const both = await upload.execute({ name: "x.pdf", artifact_id: "art-1", content: "c" }, execution);
  assert.ok(!both.ok && /not both/.test(both.error.message));
  const neither = await upload.execute({ name: "x.pdf" }, execution);
  assert.ok(!neither.ok && /required/.test(neither.error.message));
  const withoutService = setup(() => ({}));
  const unsupported = await withoutService.tool("google_drive_upload").execute({ name: "x.pdf", artifact_id: "art-1" }, execution);
  assert.ok(!unsupported.ok && /does not provide artifact reads/.test(unsupported.error.message));
  assert.equal(withoutService.calls.length, 0);
});

test("API failures map to tool errors with retryability", async () => {
  const { tool } = setup(call => Response.json({ error: { message: call.url.pathname.includes("messages") ? "Rate limited" : "Boom" } }, { status: call.url.pathname.includes("messages") ? 429 : 500 }));
  const limited = await tool("google_gmail_search").execute({ query: "x" }, execution);
  assert.ok(!limited.ok && limited.error.retryable && limited.error.message === "Google API 429: Rate limited" && limited.effectStatus === "not_applicable");
  const failed = await tool("google_tasks_create").execute({ title: "t" }, execution);
  assert.ok(!failed.ok && failed.effectStatus === "unknown" && failed.error.message === "Google API 500: Boom");
});

test("health reports configuration and authorization state", async () => {
  assert.deepEqual(await setup(() => ({})).plugin.health?.(), { status: "ok" });
  assert.equal((await setup(() => ({}), { authorized: false }).plugin.health?.())?.status, "degraded");
  assert.match(String((await setup(() => ({}), { configured: false }).plugin.health?.())?.detail), /GOOGLE_CLIENT_ID/);
});
