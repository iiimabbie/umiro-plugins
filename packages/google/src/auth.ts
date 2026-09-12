import type { PluginLogger, PluginStateStore } from "./umiro-api.js";

export const TOKEN_STATE_KEY = "oauth/token.json";
export const REDIRECT_URI = "http://127.0.0.1";
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/tasks",
];
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Access tokens are refreshed this long before Google's reported expiry. */
const EXPIRY_MARGIN_MS = 60_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface StoredToken {
  readonly refresh_token: string;
  readonly access_token?: string;
  readonly expiry_date?: number;
  readonly scope?: string;
  readonly token_type?: string;
}

export interface OAuthOptions {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly state: PluginStateStore | undefined;
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly logger?: PluginLogger;
}

export class GoogleAuthError extends Error {
  constructor(message: string, readonly code: "not_configured" | "not_authorized" | "state_unavailable" | "token_exchange_failed" | "token_refresh_failed") { super(message); this.name = "GoogleAuthError"; }
}

export function extractCode(input: string): string {
  try { return new URL(input).searchParams.get("code") ?? input; } catch { return input.trim(); }
}

interface TokenResponse { readonly access_token?: string; readonly refresh_token?: string; readonly expires_in?: number; readonly scope?: string; readonly token_type?: string; readonly error?: string; readonly error_description?: string }

/** OAuth 2.0 installed-app flow with the refresh token persisted in Plugin state. */
export class GoogleOAuth {
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private cached: StoredToken | undefined;
  private refreshing: Promise<string> | undefined;

  constructor(private readonly options: OAuthOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  get configured(): boolean { return Boolean(this.options.clientId && this.options.clientSecret); }

  private credentials(): { clientId: string; clientSecret: string } {
    const { clientId, clientSecret } = this.options;
    if (!clientId || !clientSecret) throw new GoogleAuthError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set", "not_configured");
    return { clientId, clientSecret };
  }

  private store(): PluginStateStore {
    if (!this.options.state) throw new GoogleAuthError("plugin state store is unavailable; the refresh token cannot be persisted", "state_unavailable");
    return this.options.state;
  }

  async loadToken(): Promise<StoredToken | undefined> {
    if (this.cached) return this.cached;
    const raw = await this.options.state?.read(TOKEN_STATE_KEY);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<StoredToken>;
      if (typeof parsed.refresh_token !== "string" || !parsed.refresh_token) return undefined;
      this.cached = parsed as StoredToken;
      return this.cached;
    } catch (error) {
      this.options.logger?.warn("google.token_unreadable", "Stored Google token is not valid JSON; re-authorization is required", { errorName: error instanceof Error ? error.name : "NonErrorThrown" });
      return undefined;
    }
  }

  private async saveToken(token: StoredToken): Promise<void> {
    await this.store().writeAtomic(TOKEN_STATE_KEY, new TextEncoder().encode(JSON.stringify(token)));
    this.cached = token;
  }

  async isAuthorized(): Promise<boolean> { return (await this.loadToken()) !== undefined; }

  authorizationUrl(): string {
    const { clientId } = this.credentials();
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" });
    return `${AUTH_ENDPOINT}?${params}`;
  }

  private async tokenRequest(body: Record<string, string>, failure: "token_exchange_failed" | "token_refresh_failed"): Promise<TokenResponse> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    const payload = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
      throw new GoogleAuthError(`Google token request failed: ${detail}`, failure);
    }
    return payload;
  }

  private expiry(payload: TokenResponse): number | undefined {
    return typeof payload.expires_in === "number" ? this.now() + payload.expires_in * 1000 : undefined;
  }

  /** Exchange the callback URL (or bare code) for tokens and persist them. */
  async exchangeCode(input: string): Promise<void> {
    const { clientId, clientSecret } = this.credentials();
    this.store();
    const payload = await this.tokenRequest({ code: extractCode(input), client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }, "token_exchange_failed");
    if (!payload.refresh_token) throw new GoogleAuthError("Google did not return a refresh token; revoke the app's access and authorize again", "token_exchange_failed");
    const expiry = this.expiry(payload);
    await this.saveToken({ refresh_token: payload.refresh_token, access_token: payload.access_token!, ...(expiry !== undefined ? { expiry_date: expiry } : {}), ...(payload.scope ? { scope: payload.scope } : {}), ...(payload.token_type ? { token_type: payload.token_type } : {}) });
  }

  async revoke(): Promise<boolean> {
    this.cached = undefined;
    return this.options.state ? this.options.state.remove(TOKEN_STATE_KEY) : false;
  }

  /** A valid access token, refreshed through the stored refresh token when stale. */
  async accessToken(): Promise<string> {
    const token = await this.loadToken();
    if (!token) throw new GoogleAuthError("Google API is not authorized; run /google-auth first", "not_authorized");
    if (token.access_token && token.expiry_date !== undefined && token.expiry_date - EXPIRY_MARGIN_MS > this.now()) return token.access_token;
    this.refreshing ??= this.refresh(token).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async refresh(token: StoredToken): Promise<string> {
    const { clientId, clientSecret } = this.credentials();
    const payload = await this.tokenRequest({ refresh_token: token.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }, "token_refresh_failed");
    const expiry = this.expiry(payload);
    await this.saveToken({ ...token, access_token: payload.access_token!, ...(expiry !== undefined ? { expiry_date: expiry } : {}), ...(payload.refresh_token ? { refresh_token: payload.refresh_token } : {}) });
    this.options.logger?.info("google.token_refreshed", "Google access token refreshed");
    return payload.access_token!;
  }
}
