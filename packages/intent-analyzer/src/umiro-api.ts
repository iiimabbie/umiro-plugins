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

export interface InputEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly identity: { readonly transport: string; readonly externalId: string; readonly principalId: string | null; readonly displayName?: string };
  readonly conversation: { readonly transport: string; readonly externalId: string; readonly kind: "direct" | "channel" | "thread" };
  readonly content: readonly JsonValue[];
  readonly metadata?: JsonObject;
}

export interface TurnToolCandidate {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface TurnAnalyzerInput {
  readonly event: InputEvent;
  readonly text: string;
  readonly defaultShouldReply: boolean;
  readonly tools: readonly TurnToolCandidate[];
  readonly signal?: AbortSignal;
}

export interface TurnAnalysis {
  readonly shouldReply: boolean;
  readonly selectedToolNames: readonly string[];
  readonly contextBlocks: readonly ContextBlock[];
}

export interface TurnAnalyzer {
  readonly id: string;
  analyze(input: TurnAnalyzerInput): Promise<TurnAnalysis | undefined>;
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
  readonly contributions: { readonly contextProviders?: readonly ContextProvider[]; readonly turnAnalyzers?: readonly TurnAnalyzer[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health?(): Promise<{ readonly status: "ok" | "degraded" | "failed"; readonly detail?: string }>;
}
