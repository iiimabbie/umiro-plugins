export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface ContextRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly execution: {
    readonly origin: { readonly kind: string; readonly [key: string]: JsonValue };
    readonly actor: { readonly id: string; readonly kind: "human" | "system"; readonly roles: readonly string[]; readonly identities?: readonly { readonly transport: string; readonly externalId: string }[] };
    readonly authority: unknown;
  };
  readonly inputEvent?: {
    readonly id: string;
    readonly occurredAt: string;
    readonly identity: { readonly transport: string; readonly externalId: string; readonly principalId: string | null };
    readonly conversation: { readonly transport: string; readonly externalId: string; readonly kind: "direct" | "channel" | "thread" };
    readonly content: readonly ({ readonly type: "text"; readonly text: string } | { readonly type: "artifact_reference"; readonly artifactId: string })[];
    readonly metadata?: JsonObject;
  };
  readonly recentTurns?: readonly { readonly actorIdentity?: { readonly transport: string; readonly externalId: string }; readonly content: readonly ({ readonly type: "text"; readonly text: string } | { readonly type: "artifact_reference"; readonly artifactId: string })[] }[];
  readonly recentHistory?: readonly { readonly turn: { readonly conversationId: string; readonly actorPrincipalId: string; readonly content: readonly ({ readonly type: "text"; readonly text: string } | { readonly type: "artifact_reference"; readonly artifactId: string })[] }; readonly assistantText?: string }[];
  readonly signal?: AbortSignal;
}
export interface ContextProvider {
  readonly id: string;
  readonly role: string;
  readonly priority: number;
  load(request: ContextRequest): Promise<readonly { readonly id: string; readonly providerId: string; readonly role: string; readonly content: string; readonly source: { readonly kind: string; readonly ref: string }; readonly influence: "instruction" | "information"; readonly instructionAuthority: "none" | "constrained" | "full" }[]>;
}
export type ToolExecutionResult =
  | { readonly ok: true; readonly output: JsonValue; readonly effectStatus: "not_applicable" | "confirmed" }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }; readonly effectStatus: "not_applicable" | "confirmed" | "unknown"; readonly output?: JsonValue };
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly policy: { readonly capability: string; readonly tier: "common" | "sensitive" | "privileged"; readonly interactionRequirement: "not_required" | "interactive_required"; readonly sideEffect: "none" | "idempotent" | "non_idempotent" };
  readonly execute: (input: JsonObject, context: { readonly operationId: string; readonly signal: AbortSignal }) => Promise<ToolExecutionResult>;
}
export interface PluginLogger { debug(event: string, message: string, data?: JsonObject): void; info(event: string, message: string, data?: JsonObject): void; warn(event: string, message: string, data?: JsonObject): void; error(event: string, message: string, data?: JsonObject): void }
export interface PluginSetupContext { readonly pluginId: string; readonly namespace: string; readonly permissionCeiling: unknown; readonly config: JsonObject; readonly logger: PluginLogger; getSecret(name: string): string | undefined }
export interface PluginInstance {
  readonly contributions: { readonly tools?: readonly ToolDefinition[]; readonly contextProviders?: readonly ContextProvider[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
