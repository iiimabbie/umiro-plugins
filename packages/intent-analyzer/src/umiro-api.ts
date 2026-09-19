export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface ContextRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly execution: { readonly origin: { readonly kind: string; readonly [key: string]: JsonValue }; readonly actor: { readonly id: string; readonly kind: "human" | "system"; readonly roles: readonly string[] }; readonly authority: unknown };
  readonly signal?: AbortSignal;
}

export interface ContextBlock {
  readonly id: string;
  readonly providerId: string;
  readonly role: string;
  readonly content: string;
  readonly source: { readonly kind: string; readonly ref: string; readonly metadata?: JsonObject };
  readonly influence: "instruction" | "information";
  readonly instructionAuthority: "none" | "scoped" | "full";
  readonly retention?: "essential" | "normal";
}

export interface ContextProvider {
  readonly id: string;
  readonly role: string;
  readonly priority: number;
  load(request: ContextRequest): Promise<readonly ContextBlock[]>;
}

export interface PluginLogger {
  debug(event: string, message: string, data?: JsonObject): void;
  info(event: string, message: string, data?: JsonObject): void;
  warn(event: string, message: string, data?: JsonObject): void;
  error(event: string, message: string, data?: JsonObject): void;
}

export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly logger?: PluginLogger;
  getSecret(name: string): string | undefined;
}

export interface PluginInstance {
  readonly contributions: { readonly contextProviders?: readonly ContextProvider[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health?(): Promise<{ readonly status: "ok" | "degraded" | "failed"; readonly detail?: string }>;
}
