import { extname } from "node:path";
import type { GoogleClient } from "./client.js";

const BASE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const READ_LIMIT = 10_000;
interface File { id?: string; name?: string; mimeType?: string; modifiedTime?: string; size?: string; webViewLink?: string }

const EXT_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar", ".7z": "application/x-7z-compressed",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
  ".json": "application/json", ".xml": "application/xml", ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".ts": "text/typescript",
};

export function guessMime(filename: string): string { return EXT_MIME[extname(filename).toLowerCase()] ?? "application/octet-stream"; }

/** Drive search query with the user's term embedded as a Drive string literal. */
export function nameContainsQuery(term: string): string { return `name contains '${term.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }

/** Builds a multipart/related body for the Drive upload endpoint. */
export function multipartUpload(metadata: Record<string, unknown>, mimeType: string, bytes: Uint8Array): { body: Blob; contentType: string } {
  const boundary = `umiro-${crypto.randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`, "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return { body: new Blob([head, Buffer.from(bytes), tail]), contentType: `multipart/related; boundary=${boundary}` };
}

export class Drive {
  constructor(private readonly client: GoogleClient) {}

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<string> {
    const response = await this.client.request<{ files?: File[] }>(BASE, { query: { q: nameContainsQuery(query), pageSize: maxResults, fields: "files(id, name, mimeType, modifiedTime, size)", orderBy: "modifiedTime desc" }, signal });
    const files = response.files ?? [];
    if (!files.length) return "No files found.";
    return files.map(file => `[${file.id}] ${file.name} (${file.mimeType}) modified: ${file.modifiedTime}`).join("\n");
  }

  async read(fileId: string, signal: AbortSignal): Promise<string> {
    const id = encodeURIComponent(fileId);
    const meta = await this.client.request<File>(`${BASE}/${id}`, { query: { fields: "mimeType, name" }, signal });
    const content = (meta.mimeType ?? "").startsWith("application/vnd.google-apps.")
      ? await this.client.request<string>(`${BASE}/${id}/export`, { query: { mimeType: "text/plain" }, responseType: "text", signal })
      : await this.client.request<string>(`${BASE}/${id}`, { query: { alt: "media" }, responseType: "text", signal });
    return `[${meta.name}]\n${content.slice(0, READ_LIMIT)}`;
  }

  async upload(input: { name: string; bytes: Uint8Array; mimeType: string; folderId?: string }, signal: AbortSignal): Promise<string> {
    const { body, contentType } = multipartUpload({ name: input.name, ...(input.folderId ? { parents: [input.folderId] } : {}) }, input.mimeType, input.bytes);
    const file = await this.client.request<File>(UPLOAD, { method: "POST", query: { uploadType: "multipart", fields: "id, name, size, mimeType, webViewLink" }, body, contentType, signal });
    return ["File uploaded to Google Drive:", `  id:          ${file.id}`, `  name:        ${file.name}`, `  size:        ${file.size ?? "unknown"} bytes`, `  mimeType:    ${file.mimeType}`, `  webViewLink: ${file.webViewLink ?? "N/A"}`].join("\n");
  }
}
