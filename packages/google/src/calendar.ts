import type { GoogleClient } from "./client.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars";
interface Event { id?: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string } }

const calendarUrl = (calendarId: string, suffix = "") => `${BASE}/${encodeURIComponent(calendarId)}/events${suffix}`;

export interface EventFields { readonly summary?: string; readonly start?: string; readonly end?: string; readonly description?: string; readonly location?: string }

function eventBody(fields: EventFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.summary !== undefined) body.summary = fields.summary;
  if (fields.start !== undefined) body.start = { dateTime: fields.start };
  if (fields.end !== undefined) body.end = { dateTime: fields.end };
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.location !== undefined) body.location = fields.location;
  return body;
}

export class Calendar {
  constructor(private readonly client: GoogleClient, private readonly now: () => number = Date.now) {}

  async listEvents(input: { calendarId: string; start?: string; end?: string; maxResults: number }, signal: AbortSignal): Promise<string> {
    const now = this.now();
    const response = await this.client.request<{ items?: Event[] }>(calendarUrl(input.calendarId), { query: { timeMin: input.start ?? new Date(now).toISOString(), timeMax: input.end ?? new Date(now + 7 * 86_400_000).toISOString(), maxResults: input.maxResults, singleEvents: true, orderBy: "startTime" }, signal });
    const events = response.items ?? [];
    if (!events.length) return "No upcoming events.";
    return events.map(event => `[${event.id}] ${event.start?.dateTime ?? event.start?.date ?? "?"} - ${event.summary || "(no title)"}${event.location ? ` @ ${event.location}` : ""}`).join("\n");
  }

  async createEvent(calendarId: string, fields: EventFields, signal: AbortSignal): Promise<string> {
    const created = await this.client.request<Event>(calendarUrl(calendarId), { method: "POST", json: eventBody(fields), signal });
    return `Event created: "${created.summary}" (${created.id})`;
  }

  async updateEvent(calendarId: string, eventId: string, fields: EventFields, signal: AbortSignal): Promise<string> {
    const updated = await this.client.request<Event>(calendarUrl(calendarId, `/${encodeURIComponent(eventId)}`), { method: "PATCH", json: eventBody(fields), signal });
    return `Event updated: "${updated.summary}" (${updated.id})`;
  }

  async deleteEvent(calendarId: string, eventId: string, signal: AbortSignal): Promise<string> {
    await this.client.request(calendarUrl(calendarId, `/${encodeURIComponent(eventId)}`), { method: "DELETE", responseType: "void", signal });
    return `Event deleted (${eventId})`;
  }
}
