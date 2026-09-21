export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

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
export interface SearchDocument { readonly id: string; readonly sourceType: string; readonly sourceId: string; readonly text: string; readonly visibility: { readonly kind: "all" } | { readonly kind: "restricted"; readonly principalIds: readonly string[]; readonly labels: readonly string[]; readonly resources: readonly { readonly kind: string; readonly id: string }[] }; readonly occurredAt?: string }
export interface ScheduledTrigger { readonly id: string; readonly name: string; readonly enabled: boolean; readonly schedule: { readonly kind: "cron"; readonly expression: string } | { readonly kind: "once"; readonly at: string }; readonly timezone: string; readonly input: JsonObject; readonly destination?: JsonObject; readonly misfirePolicy: "catch_up" | "coalesce" | "skip"; readonly maxAttempts: number; readonly retryBackoffMs: number }
export interface SchedulerControl {
  create(input: { readonly name: string; readonly enabled: boolean; readonly schedule: { readonly kind: "cron"; readonly expression: string }; readonly timezone: string; readonly jobRef: string; readonly input: JsonObject; readonly creatorPrincipalId: string; readonly creatorRoles: readonly ("owner" | "member" | "guest" | "system")[]; readonly authority: unknown; readonly misfirePolicy: "catch_up" | "coalesce" | "skip"; readonly maxAttempts: number; readonly retryBackoffMs: number }, idempotencyKey?: string): Promise<ScheduledTrigger>;
  list(): Promise<readonly ScheduledTrigger[]>;
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTrigger>;
  update(id: string, patch: { readonly name: string; readonly schedule: { readonly kind: "cron"; readonly expression: string }; readonly timezone: string; readonly input: JsonObject; readonly misfirePolicy: "catch_up" | "coalesce" | "skip"; readonly maxAttempts: number; readonly retryBackoffMs: number }): Promise<ScheduledTrigger>;
}
export interface PluginLogger { debug(event: string, message: string, data?: JsonObject): void; info(event: string, message: string, data?: JsonObject): void; warn(event: string, message: string, data?: JsonObject): void; error(event: string, message: string, data?: JsonObject): void }
export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly logger?: PluginLogger;
  readonly services?: {
    readonly scheduler?: SchedulerControl;
    readonly conversationHistory?: { transcriptByDate(input: { readonly date: string; readonly timezone: string; readonly maxCharacters?: number }): Promise<{ readonly date: string; readonly timezone: string; readonly conversations: number; readonly messages: number; readonly text: string; readonly truncated: boolean }> };
    readonly searchDocuments?: { replaceSource(sourceId: string, documents: readonly SearchDocument[]): Promise<void>; removeSource(sourceId: string): Promise<void> };
  };
  getSecret(name: string): string | undefined;
}
export interface PluginControlPanelDocumentSummary { readonly id: string; readonly title: string; readonly occurredAt?: string }
export interface PluginControlPanelDocument { readonly id: string; readonly title: string; readonly content: string; readonly occurredAt?: string }
export interface PluginControlPanelViewDefinition {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly kind: "read-only-markdown-collection";
  list(): Promise<readonly PluginControlPanelDocumentSummary[]>;
  read(id: string): Promise<PluginControlPanelDocument | undefined>;
}
export interface PluginInstance { readonly contributions: { readonly tools?: readonly ToolDefinition[]; readonly controlPanelViews?: readonly PluginControlPanelViewDefinition[] }; start?(): Promise<void>; stop?(): Promise<void> }
