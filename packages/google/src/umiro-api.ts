export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface ResourceRef { readonly kind: string; readonly id: string }
export type ToolExecutionResult =
  | { readonly ok: true; readonly output: JsonValue; readonly effectStatus: "not_applicable" | "confirmed" }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }; readonly effectStatus: "not_applicable" | "confirmed" | "unknown"; readonly output?: JsonValue };
export interface ToolExecutionContext { readonly execution: { readonly actor: { readonly id: string } }; readonly operationId: string; readonly signal: AbortSignal }
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly policy: { readonly capability: string; readonly tier: "common" | "sensitive" | "privileged"; readonly interactionRequirement: "not_required" | "interactive_required"; readonly sideEffect: "none" | "idempotent" | "non_idempotent"; readonly resource?: (input: JsonObject) => ResourceRef | undefined };
  readonly execute: (input: JsonObject, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}
export interface CommandContext { readonly userId: string; readonly channelId?: string; readonly guildId?: string; readonly signal?: AbortSignal }
export interface PluginCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly ownerOnly?: boolean;
  readonly ephemeral?: boolean;
  readonly options?: readonly { readonly name: string; readonly description: string; readonly type: "string" | "integer" | "boolean" | "channel"; readonly required?: boolean }[];
  readonly execute: (input: JsonObject, context?: CommandContext) => Promise<JsonObject>;
}
export interface PluginLogger { debug(event: string, message: string, data?: JsonObject): void; info(event: string, message: string, data?: JsonObject): void; warn(event: string, message: string, data?: JsonObject): void; error(event: string, message: string, data?: JsonObject): void }
export interface PluginStateStore {
  read(key: string): Promise<Uint8Array | undefined>;
  writeAtomic(key: string, value: Uint8Array, options?: { readonly expiresAt?: string }): Promise<void>;
  remove(key: string): Promise<boolean>;
}
/** Artifact bytes access is not yet part of the Core plugin services; `read` is consumed when the host provides it. */
export interface PluginArtifactService {
  read?(input: { readonly artifactId: string; readonly principalId: string }): Promise<{ readonly bytes: Uint8Array; readonly filename?: string; readonly mediaType: string } | undefined>;
}
export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly state?: PluginStateStore;
  readonly services?: { readonly artifacts?: PluginArtifactService };
  readonly logger?: PluginLogger;
  getSecret(name: string): string | undefined;
}
export interface PluginInstance {
  readonly contributions: { readonly tools?: readonly ToolDefinition[]; readonly commands?: readonly PluginCommandDefinition[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health?(): Promise<{ readonly status: "ok" | "degraded" | "failed"; readonly detail?: string }>;
}
