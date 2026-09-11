export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface PluginStateStore {
  read(key: string): Promise<Uint8Array | undefined>;
  writeAtomic(key: string, value: Uint8Array): Promise<void>;
  remove(key: string): Promise<boolean>;
  list(prefix?: string): Promise<readonly { readonly key: string; readonly size: number }[]>;
}

export interface ToolPolicy {
  readonly capability: string;
  readonly tier: "common" | "sensitive" | "privileged";
  readonly interactionRequirement: "not_required" | "interactive_required";
  readonly approvalRequirement?: "not_required" | "required";
  readonly sideEffect: "none" | "idempotent" | "non_idempotent";
}
export type ToolExecutionResult =
  | { readonly ok: true; readonly output: JsonValue; readonly effectStatus: "not_applicable" | "confirmed" }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }; readonly effectStatus: "not_applicable" | "confirmed" | "unknown"; readonly output?: JsonValue };
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly policy: ToolPolicy;
  readonly execute: (input: JsonObject, context: { readonly operationId: string; readonly signal: AbortSignal }) => Promise<ToolExecutionResult>;
}
export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly state?: PluginStateStore;
  readonly services?: {
    readonly discord?: {
      sendMessage(input: { readonly channelId: string; readonly content: string; readonly signal?: AbortSignal }): Promise<{ readonly messageId: string }>;
    };
  };
  getSecret(name: string): string | undefined;
}
export interface PluginInstance {
  readonly contributions: {
    readonly tools?: readonly ToolDefinition[];
    readonly jobs?: readonly { readonly id: string; readonly schedule: string; readonly timezone?: string; readonly run: (context: { readonly jobId: string; readonly signal?: AbortSignal }) => Promise<void> }[];
    readonly commands?: readonly { readonly name: string; readonly description: string; readonly ownerOnly?: boolean; readonly execute: (input: JsonObject) => Promise<JsonObject> }[];
  };
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
