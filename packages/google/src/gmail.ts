import type { GoogleClient } from "./client.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type MessageHeader = { name?: string | null; value?: string | null };
interface MessagePart { mimeType?: string | null; body?: { data?: string | null }; parts?: MessagePart[]; headers?: MessageHeader[] }
interface Message { id?: string; payload?: MessagePart }

function decodeBody(body: { data?: string | null } | undefined): string {
  return body?.data ? Buffer.from(body.data, "base64url").toString("utf8") : "";
}

export function extractBody(payload: MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBody(payload.body);
  if (payload.parts) {
    for (const part of payload.parts) if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body);
    for (const part of payload.parts) { const nested = extractBody(part); if (nested) return nested; }
  }
  return decodeBody(payload.body);
}

function headerValue(headers: readonly MessageHeader[], name: string): string {
  return headers.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() || "";
}

function headerValues(headers: readonly MessageHeader[], name: string): string[] {
  return headers.filter(header => header.name?.toLowerCase() === name.toLowerCase()).map(header => header.value?.trim() || "").filter(Boolean);
}

function extractAddress(value: string): string {
  const angle = value.match(/<([^>]+)>/);
  return (angle ? angle[1]! : value).trim().toLowerCase();
}

/** Recipients actually reachable for this message, including forwarding hops.
 * Mail forwarded from another account keeps the original To while Delivered-To
 * records the mailbox it landed in, so both are needed to tell them apart. */
export function collectRecipients(headers: readonly MessageHeader[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const name of ["To", "Delivered-To", "X-Forwarded-To"]) {
    for (const raw of headerValues(headers, name)) {
      for (const part of raw.split(",")) {
        const value = part.trim(); if (!value) continue;
        const key = extractAddress(value); if (seen.has(key)) continue;
        seen.add(key); out.push(value);
      }
    }
  }
  return out;
}

export function formatSearchLine(id: string, headers: readonly MessageHeader[]): string {
  const recipients = collectRecipients(headers);
  return `[${id}] ${headerValue(headers, "Date") || "?"} | ${headerValue(headers, "From") || "?"} -> ${recipients.length ? recipients.join(", ") : "?"} | ${headerValue(headers, "Subject") || "(no subject)"}`;
}

export function formatMessageHeaderBlock(headers: readonly MessageHeader[]): string {
  const lines = [`From: ${headerValue(headers, "From") || "?"}`, `To: ${collectRecipients(headers).join(", ") || "?"}`];
  const cc = headerValue(headers, "Cc"); if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Date: ${headerValue(headers, "Date") || "?"}`, `Subject: ${headerValue(headers, "Subject") || "(no subject)"}`);
  return lines.join("\n");
}

function assertHeaderSafe(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new TypeError(`${field} must not contain line breaks`);
  return value;
}

export function encodeMessage(to: string, subject: string, body: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(assertHeaderSafe(subject, "subject"), "utf8").toString("base64")}?=`;
  return Buffer.from(`To: ${assertHeaderSafe(to, "to")}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body, "utf8").toString("base64")}`).toString("base64url");
}

export class Gmail {
  constructor(private readonly client: GoogleClient) {}

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<string> {
    const list = await this.client.request<{ messages?: { id: string }[] }>(`${BASE}/messages`, { query: { q: query, maxResults }, signal });
    const messages = list.messages ?? [];
    if (!messages.length) return "No messages found.";
    const lines: string[] = [];
    for (const message of messages) {
      const detail = await this.client.request<Message>(`${BASE}/messages/${encodeURIComponent(message.id)}`, { query: { format: "metadata", metadataHeaders: ["Subject", "From", "Date", "To", "Delivered-To", "X-Forwarded-To"] }, signal });
      lines.push(formatSearchLine(message.id, detail.payload?.headers ?? []));
    }
    return lines.join("\n");
  }

  async read(messageId: string, signal: AbortSignal): Promise<string> {
    const message = await this.client.request<Message>(`${BASE}/messages/${encodeURIComponent(messageId)}`, { query: { format: "full" }, signal });
    return `${formatMessageHeaderBlock(message.payload?.headers ?? [])}\n\n${extractBody(message.payload)}`;
  }

  async send(to: string, subject: string, body: string, signal: AbortSignal): Promise<string> {
    const sent = await this.client.request<{ id?: string }>(`${BASE}/messages/send`, { method: "POST", json: { raw: encodeMessage(to, subject, body) }, signal });
    return `Email sent (${sent.id ?? "?"})`;
  }

  async createDraft(to: string, subject: string, body: string, signal: AbortSignal): Promise<string> {
    const draft = await this.client.request<{ id?: string }>(`${BASE}/drafts`, { method: "POST", json: { message: { raw: encodeMessage(to, subject, body) } }, signal });
    return `Draft created (${draft.id ?? "?"})`;
  }
}
