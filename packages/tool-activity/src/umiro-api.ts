export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface PluginHookContext { readonly event: string; readonly pluginId: string; readonly signal?: AbortSignal }
export interface PluginHookDefinition { readonly id: string; readonly event: string; readonly handle: (payload: JsonObject, context: PluginHookContext) => Promise<void> }
export interface PluginLogger { debug(event: string, message: string, data?: JsonObject): void; info(event: string, message: string, data?: JsonObject): void; warn(event: string, message: string, data?: JsonObject): void; error(event: string, message: string, data?: JsonObject): void }
export interface DiscordPluginService {
  sendMessage(input: { readonly channelId: string; readonly content: string; readonly signal?: AbortSignal }): Promise<{ readonly messageId: string }>;
  editMessage(input: { readonly channelId: string; readonly messageId: string; readonly content: string; readonly signal?: AbortSignal }): Promise<void>;
  deleteMessage(input: { readonly channelId: string; readonly messageId: string; readonly signal?: AbortSignal }): Promise<void>;
}
export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly services?: { readonly discord?: DiscordPluginService };
  readonly logger?: PluginLogger;
  getSecret(name: string): string | undefined;
}
export interface PluginInstance {
  readonly contributions: { readonly hooks?: readonly PluginHookDefinition[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health?(): Promise<{ readonly status: "ok" | "degraded" | "failed"; readonly detail?: string }>;
}
