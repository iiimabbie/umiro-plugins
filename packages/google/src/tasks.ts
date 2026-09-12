import type { GoogleClient } from "./client.js";

const BASE = "https://tasks.googleapis.com/tasks/v1/lists";
interface Task { id?: string; title?: string; status?: string; due?: string }

const tasksUrl = (listId: string, suffix = "") => `${BASE}/${encodeURIComponent(listId)}/tasks${suffix}`;

export class Tasks {
  constructor(private readonly client: GoogleClient) {}

  async list(input: { listId: string; showCompleted: boolean; maxResults: number }, signal: AbortSignal): Promise<string> {
    const response = await this.client.request<{ items?: Task[] }>(tasksUrl(input.listId), { query: { maxResults: input.maxResults, showCompleted: input.showCompleted, showHidden: input.showCompleted }, signal });
    const items = response.items ?? [];
    if (!items.length) return "No tasks.";
    return items.map(task => `${task.status === "completed" ? "[x]" : "[ ]"} [${task.id}] ${task.title}${task.due ? ` (due: ${task.due.split("T")[0]})` : ""}`).join("\n");
  }

  async create(listId: string, fields: { title: string; notes?: string; due?: string }, signal: AbortSignal): Promise<string> {
    const created = await this.client.request<Task>(tasksUrl(listId), { method: "POST", json: { title: fields.title, ...(fields.notes ? { notes: fields.notes } : {}), ...(fields.due ? { due: fields.due } : {}) }, signal });
    return `Task created: "${created.title}" (${created.id})`;
  }

  async complete(listId: string, taskId: string, signal: AbortSignal): Promise<string> {
    const updated = await this.client.request<Task>(tasksUrl(listId, `/${encodeURIComponent(taskId)}`), { method: "PATCH", json: { status: "completed" }, signal });
    return `Task completed: "${updated.title}"`;
  }

  async delete(listId: string, taskId: string, signal: AbortSignal): Promise<string> {
    await this.client.request(tasksUrl(listId, `/${encodeURIComponent(taskId)}`), { method: "DELETE", responseType: "void", signal });
    return `Task deleted (${taskId})`;
  }
}
