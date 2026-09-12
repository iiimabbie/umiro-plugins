import type { Fetch, GoogleOAuth } from "./auth.js";

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) { super(message); this.name = "GoogleApiError"; }
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  readonly json?: unknown;
  readonly body?: BodyInit;
  readonly contentType?: string;
  readonly responseType?: "json" | "text" | "void";
  readonly signal?: AbortSignal;
}

/** Minimal authenticated REST client over the Google APIs. */
export class GoogleClient {
  constructor(private readonly auth: GoogleOAuth, private readonly fetchImpl: Fetch = (input, init) => fetch(input, init)) {}

  async request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) target.searchParams.append(key, String(item));
      else target.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { authorization: `Bearer ${await this.auth.accessToken()}` };
    let body = options.body;
    if (options.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.json); }
    else if (options.contentType) headers["content-type"] = options.contentType;
    const response = await this.fetchImpl(target.toString(), { method: options.method ?? "GET", headers, ...(body !== undefined ? { body } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) throw new GoogleApiError(await describeFailure(response), response.status, response.status === 429 || response.status >= 500);
    if (options.responseType === "void" || response.status === 204) { await response.arrayBuffer().catch(() => undefined); return undefined as T; }
    if (options.responseType === "text") return await response.text() as T;
    return await response.json() as T;
  }
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (message) return `Google API ${response.status}: ${message}`;
  } catch { /* not JSON */ }
  return `Google API ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
}
