import type { GoogleClient } from "./client.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars";
interface Event { id?: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string } }

const calendarUrl = (calendarId: string, suffix = "") => `${BASE}/${encodeURIComponent(calendarId)}/events${suffix}`;

export class CalendarInputError extends TypeError {}

export interface EventFields { readonly summary?: string; readonly start?: string; readonly end?: string; readonly allDay?: boolean; readonly description?: string; readonly location?: string }

function eventBody(fields: EventFields, clearOppositeBoundary = false): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.summary !== undefined) body.summary = fields.summary;
  if (fields.allDay !== undefined && (fields.start === undefined || fields.end === undefined)) throw new CalendarInputError("changing an event's all-day mode requires both start and end");
  if (fields.start !== undefined) body.start = fields.allDay
    ? { date: calendarDate(fields.start, "start"), ...(clearOppositeBoundary ? { dateTime: null } : {}) }
    : { dateTime: dateTime(fields.start, "start"), ...(clearOppositeBoundary ? { date: null } : {}) };
  if (fields.end !== undefined) body.end = fields.allDay
    ? { date: calendarDate(fields.end, "end"), ...(clearOppositeBoundary ? { dateTime: null } : {}) }
    : { dateTime: dateTime(fields.end, "end"), ...(clearOppositeBoundary ? { date: null } : {}) };
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.location !== undefined) body.location = fields.location;
  return body;
}

function calendarDate(value: string, field: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new CalendarInputError(`${field} must be a YYYY-MM-DD date for an all-day event`);
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) throw new CalendarInputError(`${field} must be a valid YYYY-MM-DD date for an all-day event`);
  return value;
}

function dateTime(value: string, field: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  if (!match || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new CalendarInputError(`${field} must be an ISO 8601 date-time with a time and timezone`);
  calendarDate(match[1]!, field);
  return value;
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
    const updated = await this.client.request<Event>(calendarUrl(calendarId, `/${encodeURIComponent(eventId)}`), { method: "PATCH", json: eventBody(fields, true), signal });
    return `Event updated: "${updated.summary}" (${updated.id})`;
  }

  async deleteEvent(calendarId: string, eventId: string, signal: AbortSignal): Promise<string> {
    await this.client.request(calendarUrl(calendarId, `/${encodeURIComponent(eventId)}`), { method: "DELETE", responseType: "void", signal });
    return `Event deleted (${eventId})`;
  }
}
